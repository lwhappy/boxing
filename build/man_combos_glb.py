"""
Build web/media/glb/man-combos.glb: the man.fbx character carrying all ten
combo clips from the old red-corner combo GLBs.

Every source GLB is a single concatenated combo animation on the same Tripo /
Mixamo 33-bone rig as index.glb, so each clip gets the same rest-relative
transfer used for the home stage:

    local_tgt = rest_local_tgt^-1 * rest_local_src * local_src

The output holds one animation per source GLB, named after the file stem, so
combo-stage.js can pick it with AnimationClip.findByName().

Usage:
  Blender -b -P build/man_combos_glb.py
"""
import bpy
import os
import math
import glob
from mathutils import Quaternion

MAN = "/Users/justrun/project/boxing-game/package/character-rig/man.fbx"
SRC_GLOB = "web/media/glb/*.glb"
OUT = "web/media/glb/man-combos.glb"
SKIP = {"man-home.glb", "man-combos.glb", "boxer-man.glb", "boxer-woman.glb"}
FPS = 30

bpy.ops.wm.read_homefile(use_empty=True)
bpy.context.scene.render.fps = FPS
bpy.context.scene.render.fps_base = 1.0

sources = sorted(p for p in glob.glob(SRC_GLOB)
                 if os.path.basename(p) not in SKIP
                 and (os.path.basename(p).startswith("combo")
                      or os.path.basename(p).startswith("combined")))
print(f"[cmb] {len(sources)} source combo GLBs")

# --- target rig ---------------------------------------------------------------
bpy.ops.import_scene.fbx(filepath=MAN, automatic_bone_orientation=False)
tgt = next(o for o in bpy.data.objects if o.type == "ARMATURE")
mesh = next(o for o in bpy.data.objects if o.type == "MESH" and o.parent is tgt)
print(f"[cmb] tgt rig={tgt.name} mesh={mesh.name}")


def rest_local(arm, b):
    loc = b.matrix_local.copy()
    if b.parent is not None:
        loc = b.parent.matrix_local.inverted() @ loc
    return loc.to_quaternion()


tgt_rest = {b.name: rest_local(tgt, b) for b in tgt.data.bones}

sampled = {}
for path in sources:
    stem = os.path.splitext(os.path.basename(path))[0]
    before = set(bpy.data.objects)
    before_acts = set(bpy.data.actions)
    bpy.ops.import_scene.gltf(filepath=path)
    src = next(o for o in bpy.data.objects
               if o.type == "ARMATURE" and o not in before)
    act = next(a for a in bpy.data.actions if a not in before_acts)
    sad = src.animation_data or src.animation_data_create()
    sad.action = act
    if act.slots:
        sad.action_slot = act.slots[0]
    f0, f1 = (int(math.ceil(v)) for v in act.frame_range)
    corr = {}
    for b in src.data.bones:
        if b.name in tgt_rest:
            corr[b.name] = tgt_rest[b.name].inverted() @ rest_local(src, b)
    frames = {}
    for f in range(f0, f1 + 1):
        bpy.context.scene.frame_set(f)
        bpy.context.view_layer.update()
        for pb in src.pose.bones:
            frames.setdefault(pb.name, []).append(
                (pb.rotation_quaternion.copy(), pb.location.copy(),
                 pb.scale.copy()))
    sampled[stem] = (f0, f1, corr, frames)
    print(f"[cmb] sampled {stem}: {f1 - f0 + 1} frames "
          f"({f1 / FPS:.1f}s), max rest corr "
          f"{max(math.degrees(q.angle) for q in corr.values()):.1f} deg")
    # drop the source rig and its actions so names never collide
    for o in list(bpy.data.objects):
        if o is src or (o.type == "MESH" and o.parent is src):
            bpy.data.objects.remove(o, do_unlink=True)
    for a in list(bpy.data.actions):
        if a not in before_acts:
            bpy.data.actions.remove(a)

# --- write the actions on the man rig ----------------------------------------
tad = tgt.animation_data or tgt.animation_data_create()
for stem in sorted(sampled):
    f0, f1, corr, frames = sampled[stem]
    act = bpy.data.actions.new(stem)
    act.use_fake_user = True
    tad.action = act
    if act.slots:
        tad.action_slot = act.slots[0]
    for i, f in enumerate(range(f0, f1 + 1)):
        for bname, series in frames.items():
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
    print(f"[cmb] wrote '{stem}' {f1 - f0 + 1} frames")

tad.action = bpy.data.actions[sorted(sampled)[0]]
first = bpy.data.actions[sorted(sampled)[0]]
if first.slots:
    tad.action_slot = first.slots[0]

for img in bpy.data.images:
    if img.size[0] > 2048:
        print(f"[cmb] downscale {img.name} {img.size[:]}")
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
print(f"[cmb] wrote {OUT} {os.path.getsize(OUT) / 1e6:.2f} MB")
