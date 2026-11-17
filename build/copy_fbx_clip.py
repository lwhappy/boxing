"""
Copy one FBX action onto a GLB clip of the SAME skeleton, rest-corrected.

boxer-man.glb's rig and the Tripo/Mixamo-style FBX share bone names/hierarchy,
but their rest poses are not identical (e.g. the glb arms rest with a 26 deg
elbow bend, the fbx arms rest dead straight). A raw local-curve copy therefore
inherits that rest difference as a constant pose error (a jab that can never
straighten). The rest-relative transfer fixes it exactly:

    local_glb = rest_local_glb^-1 * rest_local_src * local_src

For bones whose rest already matches, the correction is identity, so nothing
else in the clip moves.

Usage:
  Blender -b -P build/copy_fbx_clip.py -- \
      --fbx <path.fbx> --clip jab \
      --glb web/media/glb/boxer-man.glb --out /tmp/clip.glb
"""
import bpy
import os
import sys
from mathutils import Quaternion

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []


def arg(name, default=None):
    return argv[argv.index(name) + 1] if name in argv else default


FBX = arg("--fbx")
CLIP = arg("--clip", "jab")
GLB = arg("--glb", "web/media/glb/boxer-man.glb")
OUT = arg("--out", "/tmp/clip.glb")
FPS = 30
assert FBX, "--fbx is required"

bpy.ops.wm.read_homefile(use_empty=True)
bpy.context.scene.render.fps = FPS
bpy.context.scene.render.fps_base = 1.0
bpy.ops.import_scene.gltf(filepath=GLB)

rig = bpy.data.objects.get("rig")
mesh = bpy.data.objects.get("tripo_node_89183709")
ad = rig.animation_data or rig.animation_data_create()
print(f"[copy] glb bones={len(rig.data.bones)} actions={len(bpy.data.actions)}")

# --- import the FBX ---------------------------------------------------------
before = set(bpy.data.actions.keys())
bpy.ops.import_scene.fbx(filepath=FBX)
src_act = [bpy.data.actions[n] for n in bpy.data.actions.keys() if n not in before][0]
f_arm = next(o for o in bpy.data.objects if o.type == "ARMATURE" and o is not rig)
fad = f_arm.animation_data or f_arm.animation_data_create()
fad.action = src_act
if hasattr(fad, "action_slot") and src_act.slots:
    fad.action_slot = src_act.slots[0]
f0, f1 = (int(round(v)) for v in src_act.frame_range)
print(f"[copy] source frames {f0}..{f1}")


# --- rest-local rotations ---------------------------------------------------
def rest_local(arm):
    out = {}
    for b in arm.data.bones:
        loc = b.matrix_local.copy()
        if b.parent is not None:
            loc = b.parent.matrix_local.inverted() @ loc
        out[b.name] = loc.to_quaternion()
    return out


rg = rest_local(rig)
rs = rest_local(f_arm)
corr = {}
for name in rg:
    if name in rs:
        corr[name] = rg[name].inverted() @ rs[name]
# only the arm chain rest differs in a way that matters (glb arms rest bent,
# fbx arms rest straight); applying the correction body-wide breaks the legs.
ARM_ONLY = [n for n in corr if "Left" in n and any(k in n for k in ("Shoulder", "Arm", "Hand"))]
for n in list(corr):
    if n not in ARM_ONLY:
        del corr[n]
changed = [n for n, q in corr.items() if q.angle > 0.001]
print(f"[copy] rest-corrected bones ({len(changed)}): {', '.join(sorted(changed))}")

# --- sample the source local channels --------------------------------------
raw = {}
for f in range(f0, f1 + 1):
    bpy.context.scene.frame_set(f)
    bpy.context.view_layer.update()
    for pb in f_arm.pose.bones:
        raw.setdefault(pb.name, []).append((pb.rotation_quaternion.copy(), pb.location.copy(), pb.scale.copy()))

# --- replace the clip -------------------------------------------------------
ad.action = None
for tr in list(ad.nla_tracks):
    if tr.name == CLIP:
        ad.nla_tracks.remove(tr)
for an in list(bpy.data.actions.keys()):
    if an == CLIP:
        bpy.data.actions.remove(bpy.data.actions[an])

new_act = bpy.data.actions.new(CLIP)
new_act.use_fake_user = True
ad.action = new_act
if hasattr(ad, "action_slot") and new_act.slots:
    ad.action_slot = new_act.slots[0]

written = 0
for i, f in enumerate(range(f0, f1 + 1)):
    for name, series in raw.items():
        pb = rig.pose.bones.get(name)
        if not pb:
            continue
        q, loc, scl = series[i]
        pb.rotation_quaternion = corr.get(name, Quaternion((1, 0, 0, 0))) @ q
        pb.location = loc
        pb.scale = scl
        pb.keyframe_insert("rotation_quaternion", frame=f)
        pb.keyframe_insert("location", frame=f)
        pb.keyframe_insert("scale", frame=f)
        written += 3
print(f"[copy] '{CLIP}' rebuilt over {f1 - f0 + 1} frames ({written} channels)")

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
base = bpy.data.actions["idle"]
ad.action = base
if hasattr(ad, "action_slot") and base.slots:
    ad.action_slot = base.slots[0]

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
print(f"[copy] wrote {OUT} {os.path.getsize(OUT) / 1024:.0f} KB")
