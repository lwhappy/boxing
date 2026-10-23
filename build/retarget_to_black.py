"""Retarget a Mixamo action from the red rig (33 bones) onto the black rig (41 bones).

Rest-relative retarget: for every shared bone,
    B_dst = Rd^-1 @ Rs @ B_src
so the pose keeps the same *offset from rest* instead of copying absolute local
values. Root bone translation is scaled by the rig height ratio so the character
does not sink / float. Missing bones on the destination (thumbs) stay at rest.

usage:
  Blender -b -P build/retarget_to_black.py -- \
      --blend resources/Untitled-with-idle.blend \
      --fbx "animations-red/Receiving A Big Uppercut-open-arm.fbx" \
      --name black-receive-big-uppercut-arm-open \
      --out-blend resources/Untitled-with-uppercut.blend \
      --out-glb resources/glb/3.glb
"""
import bpy
import sys
import os
from mathutils import Matrix, Vector

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []


def arg(name, default=None):
    return argv[argv.index(name) + 1] if name in argv else default


blend_path = arg("--blend", "resources/Untitled-with-idle.blend")
fbx_path = arg("--fbx")
new_name = arg("--name", "black-retarget")
out_blend = arg("--out-blend", "resources/Untitled-retarget.blend")
out_glb = arg("--out-glb", "resources/glb/3.glb")
strip_start = float(arg("--strip-start", "122"))

bpy.ops.wm.open_mainfile(filepath=blend_path)
scene = bpy.context.scene
dst = bpy.data.objects["Armature"]
print("DST", dst.name, len(dst.data.bones), "bones")

before = set(bpy.data.objects)
bpy.ops.import_scene.fbx(filepath=fbx_path)
added = [o for o in bpy.data.objects if o not in before]
src = [o for o in added if o.type == "ARMATURE"][0]
src_meshes = [o for o in added if o.type == "MESH"]
print("SRC", src.name, len(src.data.bones), "bones; meshes", [m.name for m in src_meshes])

src_action = src.animation_data.action if src.animation_data else None
assert src_action, "source has no active action"
f0, f1 = int(round(src_action.frame_range[0])), int(round(src_action.frame_range[1]))
print("SRC ACTION", src_action.name, f0, f1, "fps", scene.render.fps)

shared = [b.name for b in dst.data.bones if src.data.bones.get(b.name)]
missing = [b.name for b in dst.data.bones if not src.data.bones.get(b.name)]
print("SHARED", len(shared), "MISSING_ON_DST", len(missing), missing)

# height ratio from the hip height, used to scale root translation
rs_hips = src.data.bones["mixamorig:Hips"].matrix_local.translation
rd_hips = dst.data.bones["mixamorig:Hips"].matrix_local.translation
k = rd_hips.length / rs_hips.length
print("HIPS src", [round(v, 4) for v in rs_hips], "dst", [round(v, 4) for v in rd_hips], "ratio", round(k, 4))

# fresh action on the black rig
if dst.animation_data is None:
    dst.animation_data_create()
dst.animation_data.action = None
act = bpy.data.actions.new(new_name)
act.use_fake_user = True
dst.animation_data.action = act

root_name = "mixamorig:Hips"
for pb in dst.pose.bones:
    pb.rotation_mode = "QUATERNION"

inserted = 0
for f in range(f0, f1 + 1):
    scene.frame_set(f)
    for pb in dst.pose.bones:
        sb = src.pose.bones.get(pb.name)
        if sb is None:
            continue
        Rs = sb.bone.matrix_local
        Rd = pb.bone.matrix_local
        Bs = sb.matrix_basis
        Bd = Rd.inverted() @ Rs @ Bs
        loc, quat, scale = Bd.decompose()
        if pb.name == root_name:
            loc = Bs.to_translation() * k
            loc = (Rd.to_3x3().inverted() @ loc)
        pb.location = loc
        pb.rotation_quaternion = quat
        pb.scale = (1.0, 1.0, 1.0)
        pb.keyframe_insert("location", frame=f, group=pb.name)
        pb.keyframe_insert("rotation_quaternion", frame=f, group=pb.name)
        pb.keyframe_insert("scale", frame=f, group=pb.name)
        inserted += 1
print("KEYED", inserted, "bone-frames")

# clean up the imported rig + meshes so the file stays tidy
for ob in added:
    bpy.data.objects.remove(ob, do_unlink=True)

# put it on its own NLA track
ad = dst.animation_data
ad.action = None
track = ad.nla_tracks.new()
track.name = new_name
strip = track.strips.new(new_name, int(strip_start), act)
strip.name = new_name
strip.action_frame_start = f0
strip.action_frame_end = f1
strip.frame_start = strip_start
strip.frame_end = strip_start + (f1 - f0)
strip.blend_type = "REPLACE"
print("NLA:", [(t.name, [(s.action.name, s.frame_start, s.frame_end) for s in t.strips]) for t in ad.nla_tracks])

bpy.ops.wm.save_as_mainfile(filepath=os.path.abspath(out_blend))
print("SAVED", out_blend)

os.makedirs(os.path.dirname(os.path.abspath(out_glb)), exist_ok=True)
bpy.ops.export_scene.gltf(
    filepath=os.path.abspath(out_glb),
    export_format="GLB",
    export_animations=True,
    export_animation_mode="ACTIONS",
    export_anim_single_armature=True,
    export_bake_animation=False,
    export_frame_range=False,
    export_force_sampling=True,
    export_optimize_animation_size=False,
    export_apply=False,
    export_yup=True,
    export_materials="EXPORT",
    export_skins=True,
)
print("EXPORTED", out_glb, os.path.getsize(out_glb))
