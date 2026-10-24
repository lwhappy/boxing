"""
Export the combined.blend file as GLB with proper textures.
The combined.blend has a single 'Action' that needs to be renamed.
"""
import bpy
import sys
import os

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []

def arg(name, default=None):
    return argv[argv.index(name) + 1] if name in argv else default

BLEND_FILE = arg("--blend", "/Users/justrun/project/boxing-3/motion-combine/combined.blend")
OUT_PATH = arg("--out", "/Users/justrun/project/boxing-3/web/media/glb/combined_idle_jab_cross_leadhook.glb")
ACTION_NAME = arg("--action-name", "idle_jab_cross_leadhook")
ARMATURE_NAME = "Armature"

bpy.ops.wm.open_mainfile(filepath=BLEND_FILE)

armature = bpy.data.objects.get(ARMATURE_NAME)
if not armature:
    print(f"ERROR: Armature '{ARMATURE_NAME}' not found!")
    sys.exit(1)

print(f"Opened: {BLEND_FILE}")
print(f"Armature: {armature.name}, bones={len(armature.data.bones)}")
print(f"Actions: {[a.name for a in bpy.data.actions]}")
print(f"Materials: {[m.name for m in bpy.data.materials if m.users > 0]}")

# Get the action and rename it
action = None
if armature.animation_data and armature.animation_data.action:
    action = armature.animation_data.action
elif bpy.data.actions:
    action = bpy.data.actions[0]

if not action:
    print("ERROR: No action found!")
    sys.exit(1)

action.name = ACTION_NAME
print(f"Action: {action.name}, frames: {action.frame_range}")

# Set up NLA track for export
ad = armature.animation_data or armature.animation_data_create()

# Clear existing NLA tracks
for t in list(ad.nla_tracks):
    ad.nla_tracks.remove(t)

# Add action as NLA strip
track = ad.nla_tracks.new()
track.name = ACTION_NAME
strip = track.strips.new(ACTION_NAME, 1, action)
strip.name = ACTION_NAME
strip.action_frame_start = int(action.frame_range[0])
strip.action_frame_end = int(action.frame_range[1])
strip.frame_start = 1.0
strip.frame_end = float(action.frame_range[1])
strip.blend_type = "REPLACE"

# Clear active action so NLA drives everything
ad.action = None

# Select armature and mesh children
bpy.ops.object.select_all(action='DESELECT')
armature.select_set(True)
for obj in bpy.data.objects:
    if obj.type == 'MESH' and obj.parent == armature:
        obj.select_set(True)
bpy.context.view_layer.objects.active = armature

os.makedirs(os.path.dirname(os.path.abspath(OUT_PATH)), exist_ok=True)

# Export GLB
bpy.ops.export_scene.gltf(
    filepath=os.path.abspath(OUT_PATH),
    export_format="GLB",
    use_selection=True,
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
print(f"GLB exported: {OUT_PATH}, size={os.path.getsize(OUT_PATH) / 1024:.1f} KB")
