"""
Surgical jab swap: replace ONLY the left-arm chain rotation of an existing GLB
clip with a retargeted FBX, leaving hips / spine / legs / right arm / head and
every other clip untouched.

This exists because a full-body retarget (retarget_fbx_clip.py) also imports the
source clip's footwork, which made the fighter's legs slide. Here the source is
used purely as a "left arm motion donor".

Usage:
  Blender -b -P build/retarget_arm_only.py -- \
      --fbx <path.fbx> --clip jab \
      --glb web/media/glb/boxer-man.glb --out /tmp/boxer-man.arm.glb
"""
import bpy
import sys
import os
import math
from mathutils import Matrix, Vector, Quaternion

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []


def arg(name, default=None):
    return argv[argv.index(name) + 1] if name in argv else default


FBX = arg("--fbx")
CLIP = arg("--clip", "jab")
GLB = arg("--glb", "web/media/glb/boxer-man.glb")
OUT = arg("--out", "/tmp/boxer-man.arm.glb")
# left-arm chain only, root-first. Right arm / spine / legs stay original.
ARM_CHAIN = ["LeftShoulder", "LeftArm", "LeftForeArm", "LeftHand"]
FPS = 30
assert FBX, "--fbx is required"

bpy.ops.wm.read_homefile(use_empty=True)
scene = bpy.context.scene
scene.render.fps = FPS
scene.render.fps_base = 1.0
bpy.ops.import_scene.gltf(filepath=GLB)

rig = bpy.data.objects.get("rig")
assert rig and rig.type == "ARMATURE", "rig armature not found"
mesh = bpy.data.objects.get("tripo_node_89183709")
print(f"[arm] glb bones={len(rig.data.bones)} actions={len(bpy.data.actions)}")

ad = rig.animation_data or rig.animation_data_create()
src = bpy.data.actions.get(CLIP)
assert src, f"clip '{CLIP}' not found"

# --- 1. snapshot the original clip, every bone, every frame -----------------
ad.action = src
if hasattr(ad, "action_slot") and src.slots:
    ad.action_slot = src.slots[0]

fr0, fr1 = (int(round(v)) for v in src.frame_range)
names = [b.name for b in rig.data.bones]
print(f"[arm] '{CLIP}' frames {fr0}..{fr1} ({(fr1 - fr0) / FPS:.3f}s), bones={len(names)}")

snap = {n: [] for n in names}
for f in range(fr0, fr1 + 1):
    scene.frame_set(f)
    bpy.context.view_layer.update()
    for n in names:
        pb = rig.pose.bones[n]
        snap[n].append((
            pb.rotation_quaternion.copy(),
            pb.location.copy(),
            pb.scale.copy(),
        ))

has_loc = any(q[1].length > 1e-6 for per in snap.values() for q in per)
has_scl = any((Vector(q[2]) - Vector((1, 1, 1))).length > 1e-6 for per in snap.values() for q in per)
print(f"[arm] original clip has location={has_loc} scale={has_scl}")

# --- 2. import FBX and compute the arm-chain local deltas -------------------
before = set(bpy.data.actions.keys())
bpy.ops.import_scene.fbx(filepath=FBX)
new_actions = [bpy.data.actions[n] for n in bpy.data.actions.keys() if n not in before]
assert new_actions, "no action in FBX"
act = new_actions[0]
f0, f1 = int(math.ceil(act.frame_range[0])), int(math.floor(act.frame_range[1]))
print(f"[arm] fbx frames {f0}..{f1} ({(f1 - f0) / FPS:.3f}s)")
assert (f1 - f0) == (fr1 - fr0), "clip lengths differ; time remap not implemented"

fbx_arm = next(o for o in bpy.data.objects if o.type == "ARMATURE" and o is not rig)


def basis(hips, head, larm, rarm):
    up = (Vector(head) - Vector(hips))
    up.normalize()
    r = Vector(rarm) - Vector(larm)
    r -= up * r.dot(up)
    r.normalize()
    f = r.cross(up)
    f.normalize()
    return r, up, f


B_G = ("Hips", "Head", "LeftArm", "RightArm")
rg, ug, fg = basis(*[rig.data.bones["mixamorig:" + b].head_local for b in B_G])
scene.frame_set(f0)
bpy.context.view_layer.update()
rf, uf, ff = basis(*[fbx_arm.pose.bones["mixamorig:" + b].head for b in B_G])
Mf = Matrix((rf, uf, ff)).transposed()
Mg = Matrix((rg, ug, fg)).transposed()
C3 = Mg @ Mf.inverted()
C4 = Matrix.Diagonal((1, 1, 1, 1))
for i in range(3):
    for j in range(3):
        C4[i][j] = C3[i][j]
print(f"[arm] basis fit det={C3.determinant():.4f} fwd->{tuple(round(v, 2) for v in (C3 @ ff))}")
assert abs(C3.determinant() - 1.0) < 1e-4

# rest-local rotation of every glb bone
rest_local = {}
for b in rig.data.bones:
    loc = b.matrix_local.copy()
    if b.parent is not None:
        loc = b.parent.matrix_local.inverted() @ loc
    short = b.name[len("mixamorig:"):] if b.name.startswith("mixamorig:") else b.name
    rest_local[short] = loc.to_quaternion()

# parent-first order over the fbx skeleton (needed for qworld bookkeeping)
order = []
done = set()
while len(order) < len(fbx_arm.pose.bones):
    for pb in fbx_arm.pose.bones:
        if pb.name in done:
            continue
        if pb.parent is None or pb.parent.name in done:
            order.append(pb)
            done.add(pb.name)

arm_deltas = {n: [] for n in ARM_CHAIN}
for f in range(f0, f1 + 1):
    scene.frame_set(f)
    bpy.context.view_layer.update()
    qworld = {}
    for pb in order:
        qw = (C4 @ pb.matrix.copy()).to_quaternion()
        qworld[pb.name] = qw
        if pb.name.startswith("mixamorig:"):
            short = pb.name[len("mixamorig:"):]
            if short in ARM_CHAIN:
                par = pb.parent
                qpar = qworld[par.name] if par is not None else Quaternion((1, 0, 0, 0))
                total_local = qpar.inverted() @ qw
                delta = rest_local[short].inverted() @ total_local
                delta.normalize()
                arm_deltas[short].append(delta)

for n in ARM_CHAIN:
    assert len(arm_deltas[n]) == (f1 - f0 + 1), f"{n}: {len(arm_deltas[n])} samples"
print(f"[arm] sampled deltas for {', '.join(ARM_CHAIN)}")

# --- 3. rebuild the clip: original everywhere, donated arm chain ------------
ad.action = None
for tr in list(ad.nla_tracks):
    if tr.name == CLIP:
        ad.nla_tracks.remove(tr)
bpy.data.actions.remove(src)

new_act = bpy.data.actions.new(CLIP)
new_act.use_fake_user = True
ad.action = new_act
if hasattr(ad, "action_slot") and new_act.slots:
    ad.action_slot = new_act.slots[0]

N = fr1 - fr0 + 1
for i in range(N):
    f = fr0 + i
    for n in names:
        pb = rig.pose.bones[n]
        short = n[len("mixamorig:"):] if n.startswith("mixamorig:") else n
        if short in ARM_CHAIN:
            pb.rotation_quaternion = arm_deltas[short][i]
        else:
            q, l, s = snap[n][i]
            pb.rotation_quaternion = q
            if has_loc:
                pb.location = l
            if has_scl:
                pb.scale = s
        pb.keyframe_insert("rotation_quaternion", frame=f)
        if has_loc:
            pb.keyframe_insert("location", frame=f)
        if has_scl:
            pb.keyframe_insert("scale", frame=f)

print(f"[arm] rebuilt '{CLIP}' {N} frames x {len(names)} bones")

# --- 4. verify: legs/hips must be identical to the original ----------------
scene.frame_set(fr0)
bpy.context.view_layer.update()
for probe in ("mixamorig:LeftFoot", "mixamorig:RightFoot", "mixamorig:Hips"):
    if probe in rig.pose.bones:
        p = rig.matrix_world @ rig.pose.bones[probe].head
        print(f"[arm] frame{fr0} {probe.split(':')[1]} world={tuple(round(v, 4) for v in p)}")

# --- 5. export -------------------------------------------------------------
for o in list(bpy.data.objects):
    if o.type == "ARMATURE" and o is not rig:
        bpy.data.objects.remove(o, do_unlink=True)
# drop any action the FBX import left behind (e.g. 'Armature|mixamo.com|Layer0')
for an in list(bpy.data.actions.keys()):
    if an not in before:
        bpy.data.actions.remove(bpy.data.actions[an])
        print(f"[arm] dropped leftover action '{an}'")

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
print(f"[arm] wrote {OUT} size={os.path.getsize(OUT) / 1024:.0f} KB")
