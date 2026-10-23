"""Export one action of the black rig as a standalone Mixamo-style FBX (with skin + textures).

usage:
  Blender -b -P build/export_action_fbx.py -- \
      --blend resources/Untitled-with-uppercut.blend \
      --action black-receive-big-uppercut-arm-open \
      --out animations-black/black-receive-big-uppercut-arm-open.fbx
"""
import bpy
import sys
import os

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []


def arg(name, default=None):
    return argv[argv.index(name) + 1] if name in argv else default


blend_path = arg("--blend", "resources/Untitled-with-uppercut.blend")
action_name = arg("--action")
out = arg("--out")
rig_name = arg("--rig", "Armature")

bpy.ops.wm.open_mainfile(filepath=blend_path)
arm = bpy.data.objects[rig_name]
act = bpy.data.actions[action_name]

# drive the rig with exactly this action, and silence the NLA so nothing else leaks in
ad = arm.animation_data
for t in ad.nla_tracks:
    t.mute = True
ad.use_tweak_mode = False
ad.action = act
print("ACTION", act.name, [round(v, 1) for v in act.frame_range], "fcurves via slots")

# the FBX baker bakes the SCENE range, not the action range
scene = bpy.context.scene
scene.frame_start = int(round(act.frame_range[0]))
scene.frame_end = int(round(act.frame_range[1]))
scene.frame_set(scene.frame_start)
print("SCENE RANGE", scene.frame_start, scene.frame_end)
print("MESHES", [o.name for o in bpy.data.objects if o.type == "MESH" and o.parent == arm])

bpy.ops.object.select_all(action="DESELECT")
arm.select_set(True)
kids = [o for o in bpy.data.objects if o.type == "MESH" and o.parent == arm]
for m in kids:
    m.select_set(True)
bpy.context.view_layer.objects.active = arm

os.makedirs(os.path.dirname(os.path.abspath(out)), exist_ok=True)
bpy.ops.export_scene.fbx(
    filepath=os.path.abspath(out),
    use_selection=True,
    object_types={"ARMATURE", "MESH"},
    apply_scale_options="FBX_SCALE_ALL",
    axis_forward="-Z",
    axis_up="Y",
    use_mesh_modifiers=False,
    mesh_smooth_type="OFF",
    add_leaf_bones=False,
    primary_bone_axis="Y",
    secondary_bone_axis="X",
    bake_anim=True,
    bake_anim_use_all_bones=True,
    bake_anim_use_nla_strips=False,
    bake_anim_use_all_actions=False,
    bake_anim_force_startend_keying=True,
    bake_anim_step=1.0,
    bake_anim_simplify_factor=0.0,
    path_mode="COPY",
    embed_textures=True,
    use_custom_props=False,
)
print("EXPORTED", out, os.path.getsize(out))
