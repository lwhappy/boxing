"""
Retarget a Mixamo FBX action onto the boxer-man.glb rig, rotation-only.

The source FBX (Tripo-style export) has a garbage rest pose, so a pose-space
or rest-space rigid fit is impossible. Instead:
  1. build a body basis for each rig: up = hips->head, right = shoulder line,
     fwd = right x up (verified: GLB fwd maps to world +Z, toward the bag)
  2. C = basis_glb @ basis_fbx^-1  (pure rotation between armature spaces)
  3. per frame: world rotation per bone = C @ fbx pose rotation; convert to
     GLB-local deltas against the GLB rest; bake rotation channels
  4. hips location stays at rest (existing clips carry no hips translation)

Usage:
  Blender -b -P build/retarget_fbx_clip.py -- \
      --fbx <path.fbx> --name jab \
      --glb web/media/glb/boxer-man.glb --out /tmp/boxer-man.out.glb
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
NAME = arg("--name", "jab")
GLB = arg("--glb", "web/media/glb/boxer-man.glb")
OUT = arg("--out", "/tmp/boxer-man.out.glb")
FPS = 30
assert FBX, "--fbx is required"

bpy.ops.wm.read_homefile(use_empty=True)
bpy.context.scene.render.fps = FPS
bpy.context.scene.render.fps_base = 1.0
bpy.ops.import_scene.gltf(filepath=GLB)

rig = bpy.data.objects.get("rig")
assert rig and rig.type == "ARMATURE", "rig armature not found"
mesh = bpy.data.objects.get("tripo_node_89183709")
print(f"[retarget] glb bones={len(rig.data.bones)} actions={len(bpy.data.actions)}")

# --- drop the old take ------------------------------------------------------
ad = rig.animation_data or rig.animation_data_create()
if ad.action and ad.action.name == NAME:
    ad.action = None
for tr in list(ad.nla_tracks):
    if tr.name == NAME:
        ad.nla_tracks.remove(tr)
old = bpy.data.actions.get(NAME)
if old:
    bpy.data.actions.remove(old)
    print(f"[retarget] removed old '{NAME}'")

# --- import the FBX ---------------------------------------------------------
before = set(bpy.data.actions.keys())
bpy.ops.import_scene.fbx(filepath=FBX)
new_actions = [bpy.data.actions[n] for n in bpy.data.actions.keys() if n not in before]
assert new_actions, "no action in FBX"
act = new_actions[0]
f0, f1 = int(math.ceil(act.frame_range[0])), int(math.floor(act.frame_range[1]))
print(f"[retarget] fbx action frames {f0}..{f1}")

fbx_arm = next(o for o in bpy.data.objects if o.type == "ARMATURE" and o is not rig)

pairs = []
for gb in rig.data.bones:
    if fbx_arm.data.bones.get(gb.name):
        pairs.append((gb.name, rig.pose.bones[gb.name], fbx_arm.pose.bones[gb.name]))
print(f"[retarget] matched {len(pairs)}/{len(rig.data.bones)} bones")

# --- body-basis rotation fit ------------------------------------------------


def basis(hips, head, larm, rarm):
    up = (Vector(head) - Vector(hips))
    up.normalize()
    r = Vector(rarm) - Vector(larm)          # character's left -> right
    r -= up * r.dot(up)
    r.normalize()
    f = r.cross(up)
    f.normalize()
    return r, up, f


B_G = ("Hips", "Head", "LeftArm", "RightArm")
rg, ug, fg = basis(*[rig.data.bones["mixamorig:" + b].head_local for b in B_G])
# the FBX rest pose is garbage (feet 58 units apart vertically), so build its
# basis from the frame-1 pose instead — that one is a real stance
scene = bpy.context.scene
scene.frame_set(f0)
bpy.context.view_layer.update()
rf, uf, ff = basis(*[fbx_arm.pose.bones["mixamorig:" + b].head for b in B_G])
Mf = Matrix((rf, uf, ff)).transposed()   # columns = fbx basis
Mg = Matrix((rg, ug, fg)).transposed()   # columns = glb basis
C3 = Mg @ Mf.inverted()
C4 = Matrix.Diagonal((1, 1, 1, 1))
for i in range(3):
    for j in range(3):
        C4[i][j] = C3[i][j]
det = C3.determinant()
print(f"[retarget] basis fit det={det:.4f}")
assert abs(det - 1.0) < 1e-4, "basis fit is not a pure rotation"
print(f"[retarget] fbx fwd in glb space: {tuple(round(v, 2) for v in (C3 @ ff))}")
print(f"[retarget] fbx up  in glb space: {tuple(round(v, 2) for v in (C3 @ uf))}")

# --- rest local rotations ---------------------------------------------------
rest_local = {}
for name, gp, fp in pairs:
    b = rig.data.bones[name]
    par = b.parent
    loc = b.matrix_local.copy()
    if par is not None:
        loc = par.matrix_local.inverted() @ loc
    rest_local[name] = loc.to_quaternion()


def local_rest_of(name):
    return rest_local[name]


# --- bake rotations ---------------------------------------------------------
scene = bpy.context.scene
bpy.context.view_layer.objects.active = rig
rig.select_set(True)

new_act = bpy.data.actions.new(NAME)
new_act.use_fake_user = True
ad.action = new_act
if hasattr(ad, "action_slot") and new_act.slots:
    ad.action_slot = new_act.slots[0]

# parent-first order
order = []
done = set()
while len(order) < len(pairs):
    for name, gp, fp in pairs:
        if name in done:
            continue
        par = rig.data.bones[name].parent
        if par is None or par.name in done:
            order.append((name, gp, fp))
            done.add(name)

qworld = {}  # assigned world-space rotation per bone
for f in range(f0, f1 + 1):
    scene.frame_set(f)
    bpy.context.view_layer.update()
    for name, gp, fp in order:
        qw = (C4 @ fp.matrix.copy()).to_quaternion()
        par = gp.parent
        qpar = qworld.get(par.name, Quaternion((1, 0, 0, 0))) if par else Quaternion((1, 0, 0, 0))
        total_local = qpar.inverted() @ qw
        delta = rest_local[name].inverted() @ total_local
        delta.normalize()
        gp.rotation_quaternion = delta
        gp.location = (0, 0, 0)
        gp.scale = (1, 1, 1)
        gp.keyframe_insert("rotation_quaternion", frame=f)
        gp.keyframe_insert("location", frame=f)
        gp.keyframe_insert("scale", frame=f)
        qworld[name] = qw

print(f"[retarget] baked {f1 - f0 + 1} frames x {len(order)} bones (rotation-only)")
fr = new_act.frame_range
print(f"[retarget] '{NAME}' frames={tuple(fr)} dur={(fr[1]-fr[0])/FPS:.3f}s")

# sanity: sample the fist path in world space
scene.frame_set(f0)
bpy.context.view_layer.update()
hand = rig.pose.bones.get("mixamorig:LeftHand")
if hand:
    mw = rig.matrix_world @ hand.matrix
    print(f"[retarget] frame{f0} LeftHand world={tuple(round(v, 3) for v in mw.translation)}")
mid = (f0 + f1) // 2
scene.frame_set(mid)
bpy.context.view_layer.update()
mw = rig.matrix_world @ hand.matrix
print(f"[retarget] frame{mid} LeftHand world={tuple(round(v, 3) for v in mw.translation)}")

# --- drop the throw-away FBX armature, hang the clip ------------------------
for o in list(bpy.data.objects):
    if o.type == "ARMATURE" and o is not rig:
        bpy.data.objects.remove(o, do_unlink=True)

track = ad.nla_tracks.new()
track.name = NAME
strip = track.strips.new(NAME, int(fr[0]), new_act)
strip.name = NAME
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
print(f"[retarget] wrote {OUT} size={os.path.getsize(OUT)/1024:.0f} KB")
