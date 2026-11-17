"""
Transplant ONE arm chain from an FBX clip onto an existing GLB clip.

Same maths as copy_fbx_clip.py (rest-relative transfer), but scoped to a single
arm so the torso / legs / other arm keep the GLB clip's own curves byte for
byte.  The earlier cross / hook FBXs were exported under a different bone-axis
convention, so copying their body channels verbatim shifts the legs; copying
only the striking arm avoids that entirely.

    local_glb = rest_glb^-1 * rest_fbx * local_fbx        (arm chain only)
    everything else     = the GLB clip's existing curve

Optional --extend N straightens the elbow at the impact beat so the knuckles
travel further than the source animation allows (N = target extension angle in
degrees, e.g. 176).  The extra rotation is ramped in over --ramp frames around
the peak and undone symmetrically, so the guard and the retract are untouched.

Usage:
  Blender -b -P build/copy_fbx_arm.py -- \
      --fbx <clip.fbx> --clip cross --arm right --glb web/media/glb/boxer-man.glb \
      --out /tmp/cross.glb [--extend 176] [--ramp 3]
"""
import bpy
import math
import os
import sys
from mathutils import Quaternion, Vector, Matrix

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []


def arg(name, default=None):
    return argv[argv.index(name) + 1] if name in argv else default


FBX = arg("--fbx")
CLIP = arg("--clip", "cross")
ARM = arg("--arm", "right")
GLB = arg("--glb", "web/media/glb/boxer-man.glb")
OUT = arg("--out", "/tmp/clip.glb")
EXTEND = float(arg("--extend", "0") or 0)
RAMP = int(arg("--ramp", "3"))
FPS = 30
assert FBX, "--fbx is required"
assert ARM in ("left", "right"), "--arm must be left or right"

SIDE = "Left" if ARM == "left" else "Right"
CHAIN = [f"mixamorig:{SIDE}{p}" for p in ("Shoulder", "Arm", "ForeArm", "Hand")]
CHAIN_SHORT = {b.split(":")[1] for b in CHAIN}

bpy.ops.wm.read_homefile(use_empty=True)
bpy.context.scene.render.fps = FPS
bpy.context.scene.render.fps_base = 1.0
bpy.ops.import_scene.gltf(filepath=GLB)
rig = bpy.data.objects.get("rig")
mesh = bpy.data.objects.get("tripo_node_89183709")
ad = rig.animation_data or rig.animation_data_create()
print(f"[arm] glb bones={len(rig.data.bones)} arms={ARM} chain={sorted(CHAIN_SHORT)}")

# --- keep the GLB clip's own curves as the base ------------------------------
base_act = bpy.data.actions[CLIP]
ad.action = base_act
if hasattr(ad, "action_slot") and base_act.slots:
    ad.action_slot = base_act.slots[0]
f0, f1 = (int(round(v)) for v in base_act.frame_range)
print(f"[arm] base clip '{CLIP}' frames {f0}..{f1}")
base = {}
for f in range(f0, f1 + 1):
    bpy.context.scene.frame_set(f)
    bpy.context.view_layer.update()
    for pb in rig.pose.bones:
        base.setdefault(pb.name, []).append(
            (pb.rotation_quaternion.copy(), pb.location.copy(), pb.scale.copy())
        )


def rest_local(arm):
    out = {}
    for b in arm.data.bones:
        loc = b.matrix_local.copy()
        if b.parent is not None:
            loc = b.parent.matrix_local.inverted() @ loc
        out[b.name] = loc.to_quaternion()
    return out


rg = rest_local(rig)

# --- import the FBX ---------------------------------------------------------
before = set(bpy.data.actions.keys())
bpy.ops.import_scene.fbx(filepath=FBX)
src_act = [bpy.data.actions[n] for n in bpy.data.actions.keys() if n not in before][0]
f_arm = next(o for o in bpy.data.objects if o.type == "ARMATURE" and o is not rig)
fad = f_arm.animation_data or f_arm.animation_data_create()
fad.action = src_act
if hasattr(fad, "action_slot") and src_act.slots:
    fad.action_slot = src_act.slots[0]
sf0, sf1 = (int(round(v)) for v in src_act.frame_range)
print(f"[arm] source frames {sf0}..{sf1}")

rs = rest_local(f_arm)
corr = {}
for name in rg:
    if name in rs:
        corr[name] = rg[name].inverted() @ rs[name]
arm_corr = {n: corr[n] for n in CHAIN if n in corr}
print("[arm] rest corrections: " + ", ".join(f"{n.split(':')[1]}={math.degrees(q.angle):.1f}d" for n, q in arm_corr.items()) or "(none)")

raw = {}
for f in range(sf0, sf1 + 1):
    bpy.context.scene.frame_set(f)
    bpy.context.view_layer.update()
    for pb in f_arm.pose.bones:
        raw.setdefault(pb.name, []).append(
            (pb.rotation_quaternion.copy(), pb.location.copy(), pb.scale.copy())
        )

n = min(f1 - f0 + 1, sf1 - sf0 + 1)
if n < f1 - f0 + 1:
    print(f"[arm] WARNING source shorter than clip; only {n} frames transplanted")

# --- replace the clip -------------------------------------------------------
ad.action = None
for tr in list(ad.nla_tracks):
    if tr.name == CLIP:
        ad.nla_tracks.remove(tr)
if CLIP in bpy.data.actions.keys():
    bpy.data.actions.remove(bpy.data.actions[CLIP])

new_act = bpy.data.actions.new(CLIP)
new_act.use_fake_user = True
ad.action = new_act
if hasattr(ad, "action_slot") and new_act.slots:
    ad.action_slot = new_act.slots[0]


def extension(pb):
    s = pb["mixamorig:" + SIDE + "Arm"].head.copy()
    e = pb["mixamorig:" + SIDE + "ForeArm"].head.copy()
    w = pb["mixamorig:" + SIDE + "Hand"].head.copy()
    v1, v2 = (e - s).normalized(), (w - e).normalized()
    return 180 - math.degrees(v1.angle(v2))


# first pass: write every channel, arm chain from the FBX, the rest from the GLB
for i, f in enumerate(range(f0, f1 + 1)):
    for pb in rig.pose.bones:
        q, loc, scl = base[pb.name][i]
        if pb.name in CHAIN_SHORT and pb.name in raw:
            q, loc, scl = raw[pb.name][min(i, len(raw[pb.name]) - 1)]
            q = arm_corr.get(pb.name, Quaternion((1, 0, 0, 0))) @ q
        pb.rotation_quaternion = q
        pb.location = loc
        pb.scale = scl
        pb.keyframe_insert("rotation_quaternion", frame=f)
        pb.keyframe_insert("location", frame=f)
        pb.keyframe_insert("scale", frame=f)

# --- optional: push the elbow further open at the impact beat ---------------
# Only frames whose extension already exceeds STRAIGHT_FROM (i.e. the arm is
# most of the way out) get corrected, and the correction is proportional to
# how extended the arm already is — the guard and the wind-up stay untouched.
STRAIGHT_FROM = 90.0
if EXTEND > 0:
    ext = []
    for f in range(f0, f1 + 1):
        bpy.context.scene.frame_set(f)
        bpy.context.view_layer.update()
        ext.append((f, extension(rig.pose.bones)))
    peak_f, peak_ext = max(ext, key=lambda t: t[1])
    print(f"[arm] peak extension {peak_ext:.1f}deg at f{peak_f}; target {EXTEND:.0f}deg")
    fore = rig.pose.bones["mixamorig:" + SIDE + "ForeArm"]
    n_fixed = 0
    for f, e in ext:
        if e >= EXTEND or e <= STRAIGHT_FROM:
            continue
        wgt = min(1.0, (e - STRAIGHT_FROM) / max(peak_ext - STRAIGHT_FROM, 1e-3)) ** 1.5
        bpy.context.scene.frame_set(f)
        bpy.context.view_layer.update()
        pb = rig.pose.bones
        s = pb["mixamorig:" + SIDE + "Arm"].head.copy()
        el = pb["mixamorig:" + SIDE + "ForeArm"].head.copy()
        h = pb["mixamorig:" + SIDE + "Hand"].head.copy()
        v1, v2 = (el - s).normalized(), (h - el).normalized()
        axis = v2.cross(v1)
        if axis.length < 1e-6:
            continue
        axis.normalize()
        delta = math.radians((EXTEND - e) * wgt)
        rot = Matrix.Rotation(delta, 4, axis)
        m = fore.matrix.copy()
        fore.matrix = Matrix.Translation(m.translation) @ rot @ Matrix.Translation(-m.translation) @ m
        bpy.context.view_layer.update()
        fore.keyframe_insert("rotation_quaternion", frame=f)
        n_fixed += 1
    after = []
    for f in range(f0, f1 + 1):
        bpy.context.scene.frame_set(f)
        bpy.context.view_layer.update()
        after.append((f, extension(rig.pose.bones)))
    pf, pe = max(after, key=lambda t: t[1])
    print(f"[arm] extended {n_fixed} frames; after: peak {pe:.1f}deg at f{pf} "
          + " ".join(f"f{f}:{a:.0f}" for f, a in after if a > STRAIGHT_FROM))

# --- cleanup + export -------------------------------------------------------
for o in list(bpy.data.objects):
    if o.type == "ARMATURE" and o is not rig:
        bpy.data.objects.remove(o, do_unlink=True)
for an in list(bpy.data.actions.keys()):
    if an not in before:
        bpy.data.actions.remove(bpy.data.actions[an])

track = ad.nla_tracks.new()
track.name = CLIP
strip = track.strips.new(CLIP, int(new_act.frame_range[0]), new_act)
strip.name = CLIP
track.mute = True
base_idle = bpy.data.actions["idle"]
ad.action = base_idle
if hasattr(ad, "action_slot") and base_idle.slots:
    ad.action_slot = base_idle.slots[0]

bpy.ops.object.select_all(action="DESELECT")
rig.select_set(True)
if mesh:
    mesh.select_set(True)
bpy.context.view_layer.objects.active = rig
bpy.ops.export_scene.gltf(
    filepath=OUT,
    export_format="GLB",
    use_selection=True,
    export_apply=False,
    export_animations=True,
    export_animation_mode="ACTIONS",
    export_nla_strips=False,
    export_bake_animation=False,
    export_skins=True,
    export_morph=False,
    export_yup=True,
    export_image_format="AUTO",
)
print(f"[arm] wrote {OUT} {os.path.getsize(OUT) / 1024:.0f} KB")
