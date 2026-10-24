"""
Convert all combo FBX files to GLB format for web use.
Each FBX is imported, the action is baked, and exported as a single GLB.
"""
import bpy
import os
import sys

MOTION_DIR = "/Users/justrun/project/boxing-3/motion-combine"
GLB_DIR = "/Users/justrun/project/boxing-3/web/media/glb"

# All 10 combo FBX files to convert
COMBO_FILES = [
    "combined_idle_jab_cross_leadhook.fbx",
    "combo_jab_cross.fbx",
    "combo_jab_cross_leadhook_rearhook.fbx",
    "combo_jab_jab_cross.fbx",
    "combo_jab_cross_hook.fbx",
    "combo_jab_cross_leadhook_cross.fbx",
    "combo_jab_cross_leaduppercut.fbx",
    "combo_jab_rearuppercut_leadhook.fbx",
    "combo_jab_cross_leadhook_cross_dup.fbx",
    "combo_cross_leadhook_cross.fbx",
]

# Action name to use in the GLB (single action per file)
ACTION_NAMES = {
    "combined_idle_jab_cross_leadhook.fbx": "idle_jab_cross_leadhook",
    "combo_jab_cross.fbx": "idle_jab_cross",
    "combo_jab_cross_leadhook_rearhook.fbx": "idle_jab_cross_leadhook_rearhook",
    "combo_jab_jab_cross.fbx": "idle_jab_jab_cross",
    "combo_jab_cross_hook.fbx": "idle_jab_cross_leadhook",
    "combo_jab_cross_leadhook_cross.fbx": "idle_jab_cross_leadhook_cross",
    "combo_jab_cross_leaduppercut.fbx": "idle_jab_cross_leaduppercut",
    "combo_jab_rearuppercut_leadhook.fbx": "idle_jab_rearuppercut_leadhook",
    "combo_jab_cross_leadhook_cross_dup.fbx": "idle_jab_cross_leadhook_cross",
    "combo_cross_leadhook_cross.fbx": "idle_cross_leadhook_cross",
}

for fbx_file in COMBO_FILES:
    fbx_path = os.path.join(MOTION_DIR, fbx_file)
    glb_name = fbx_file.replace(".fbx", ".glb")
    glb_path = os.path.join(GLB_DIR, glb_name)
    
    print(f"\n{'=' * 60}")
    print(f"Converting: {fbx_file} -> {glb_name}")
    print(f"{'=' * 60}")
    
    # Start fresh
    bpy.ops.wm.read_homefile(use_empty=True)
    
    # Import the FBX
    bpy.ops.import_scene.fbx(filepath=fbx_path)
    
    # Find the armature
    armature = None
    for obj in bpy.data.objects:
        if obj.type == 'ARMATURE':
            armature = obj
            break
    
    if not armature:
        print(f"  ERROR: No armature found in {fbx_file}")
        continue
    
    print(f"  Armature: {armature.name}, bones: {len(armature.data.bones)}")
    
    # Get the action
    if armature.animation_data and armature.animation_data.action:
        action = armature.animation_data.action
        # Rename the action to the desired name
        action_name = ACTION_NAMES.get(fbx_file, "combo")
        action.name = action_name
        print(f"  Action: {action.name}, frames: {action.frame_range}")
        
        # For layered actions, we need to make sure the action is properly set
        # The FBX import may create a legacy action
        if not action.is_action_layered:
            # Legacy action - fcurves are directly accessible
            print(f"  Legacy action, fcurves: {len(action.fcurves)}")
    
    # Set scene frame range
    if armature.animation_data and armature.animation_data.action:
        fr = armature.animation_data.action.frame_range
        bpy.context.scene.frame_start = int(fr[0])
        bpy.context.scene.frame_end = int(fr[1])
    
    # Make the armature active and selected
    bpy.ops.object.select_all(action='DESELECT')
    armature.select_set(True)
    bpy.context.view_layer.objects.active = armature
    
    # Select mesh children
    for obj in bpy.data.objects:
        if obj.type == 'MESH' and obj.parent == armature:
            obj.select_set(True)
    
    # Export as GLB
    bpy.ops.export_scene.gltf(
        filepath=glb_path,
        export_format='GLB',
        use_selection=True,
        export_apply=True,
        export_animations=True,
        export_animation_mode='ACTIONS',
        export_skins=True,
        export_morph=False,
        export_yup=True,
    )
    
    print(f"  GLB exported: {glb_path}")
    print(f"  Size: {os.path.getsize(glb_path) / 1024:.1f} KB")

print(f"\n{'=' * 60}")
print("ALL CONVERSIONS COMPLETE!")
print(f"{'=' * 60}")
