"""
Build web/media/glb/man-home.glb: the man.fbx character carrying index.glb's
seven home-stage clips (idle, jab, cross, lead/back hooks + uppercuts).

Both rigs are Tripo/Mixamo 33-bone skeletons at armature scale 0.01, but their
rest poses are not identical (median 5 deg, worst 14.5 deg on hands), so every
bone gets the rest-relative transfer:

    local_tgt = rest_local_tgt^-1 * rest_local_src * local_src

which reproduces the source world orientation exactly (verified below by
sampling world-space bone rotations per frame).

Order matters: sample + delete the SOURCE rig/actions BEFORE creating the
target actions, otherwise Blender renames the target actions to *.001 and the
cleanup pass deletes the corrected curves.

Usage:
  Blender -b -P build/man_home_glb.py
"""
import bpy
import os
import math
from mathutils import Quaternion

INDEX = "web/media/glb/index.glb"
MAN = "/Users/justrun/project/boxing-game/package/character-rig/man.fbx"
OUT = "web/media/glb/man-home.glb"
FPS = 30

bpy.ops.wm.read_homefile(use_empty=True)
bpy.context.scene.render.fps = FPS
bpy.context.scene.render.fps_base = 1.0

# --- source: index.glb (rig + 7 actions) ------------------------------------
bpy.ops.import_scene.gltf(filepath=INDEX)
src = next(o for o in bpy.data.objects if o.type == "ARMATURE")
src_acts = {a.name: a for a in bpy.data.actions}
print(f"[home] src clips: {sorted(src_acts)}")


def rest_local(arm, b):
    loc = b.matrix_local.copy()
    if b.parent is not None:
        loc = b.parent.matrix_local.inverted() @ loc
    return loc.to_quaternion()


# --- sample every clip into memory (before touching anything) ---------------
sad = src.animation_data or src.animation_data_create()
raw = {}
ranges = {}
for name, act in sorted(src_acts.items()):
    sad.action = act
    if act.slots:
        sad.action_slot = act.slots[0]
    f0, f1 = (int(math.ceil(v)) for v in act.frame_range)
    ranges[name] = (f0, f1)
    raw[name] = {}
    for f in range(f0, f1 + 1):
        bpy.context.scene.frame_set(f)
        bpy.context.view_layer.update()
        for pb in src.pose.bones:
            raw[name].setdefault(pb.name, []).append(
                (pb.rotation_quaternion.copy(), pb.location.copy(),
                 pb.scale.copy()))
print(f"[home] sampled {len(raw)} clips "
      f"({sum(len(v) for v in ranges.values())} frames total)")

# rest correction (needs both rests; computed now, applied later)
corr = {}
src_rest = {b.name: rest_local(src, b) for b in src.data.bones}

# --- target: man.fbx (rig + mesh) -------------------------------------------
bpy.ops.import_scene.fbx(filepath=MAN, automatic_bone_orientation=False)
tgt = next(o for o in bpy.data.objects if o.type == "ARMATURE" and o is not src)
mesh = next(o for o in bpy.data.objects if o.type == "MESH" and o.parent is tgt)
print(f"[home] tgt rig={tgt.name} mesh={mesh.name} "
      f"scale={tuple(round(s, 3) for s in tgt.scale)}")

tgt_rest = {b.name: rest_local(tgt, b) for b in tgt.data.bones}
corr = {n: tgt_rest[n].inverted() @ src_rest[n] for n in tgt_rest if n in src_rest}
moved = sorted(n for n, q in corr.items() if q.angle > 0.001)
print(f"[home] rest-corrected bones: {len(moved)} "
      f"(max {max(math.degrees(corr[n].angle) for n in moved):.1f} deg)")

# --- remove the source rig + its actions, THEN build target actions ---------
for o in list(bpy.data.objects):
    if o is src or (o.type == 'MESH' and o.parent is src):
        bpy.data.objects.remove(o, do_unlink=True)
for an in list(bpy.data.actions.keys()):
    bpy.data.actions.remove(bpy.data.actions[an])

tgt_ad = tgt.animation_data or tgt.animation_data_create()
for name in sorted(raw):
    f0, f1 = ranges[name]
    new_act = bpy.data.actions.new(name)
    new_act.use_fake_user = True
    tgt_ad.action = new_act
    if new_act.slots:
        tgt_ad.action_slot = new_act.slots[0]
    for i, f in enumerate(range(f0, f1 + 1)):
        for bname, series in raw[name].items():
            pb = tgt.pose.bones.get(bname)
            if not pb:
                continue
            q, loc, scl = series[i]
            pb.rotation_quaternion = corr.get(bname, Quaternion((1, 0, 0, 0))) @ q
            pb.location = loc
            pb.scale = scl
            pb.keyframe_insert("rotation_quaternion", frame=f)
            pb.keyframe_insert("location", frame=f)
            pb.keyframe_insert("scale", frame=f)
    print(f"[home] '{name}' {f1 - f0 + 1} frames")

# --- verify: world orientation match per frame -------------------------------
print("[home] verifying ...")
tad = tgt.animation_data or tgt.animation_data_create()
worst = 0.0
worst_at = None
for name in sorted(raw):
    f0, f1 = ranges[name]
    tad.action = bpy.data.actions[name]
    act = bpy.data.actions[name]
    if act.slots:
        tad.action_slot = act.slots[0]
    for f in range(f0, f1 + 1):
        bpy.context.scene.frame_set(f)
        bpy.context.view_layer.update()
        for pb in tgt.pose.bones:
            # reconstruct source world rotation from the sampled local channel
            q, loc, scl = raw[name][pb.name][f - f0]
            qc = corr.get(pb.name, Quaternion((1, 0, 0, 0))) @ q
            b = (tgt.matrix_world @ pb.matrix).to_quaternion()
            d = qc.rotation_difference(b)
            if d.w < 0:
                d = Quaternion((-d.w, -d.x, -d.y, -d.z))
            ang = math.degrees(d.angle)
            if ang > worst:
                worst, worst_at = ang, (name, f, pb.name)
print(f"[home] verify worst channel-vs-world diff: {worst:.2f} deg at {worst_at}")

# --- export -------------------------------------------------------------------
tgt_ad.action = bpy.data.actions["idle"]
idle_act = bpy.data.actions["idle"]
if idle_act.slots:
    tgt_ad.action_slot = idle_act.slots[0]

for img in bpy.data.images:
    if img.size[0] > 2048:
        print(f"[home] downscale {img.name} {img.size[:]}")
        img.scale(2048, 2048)

bpy.ops.object.select_all(action="DESELECT")
tgt.select_set(True)
mesh.select_set(True)
bpy.context.view_layer.objects.active = tgt
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
print(f"[home] wrote {OUT} {os.path.getsize(OUT) / 1e6:.2f} MB")
