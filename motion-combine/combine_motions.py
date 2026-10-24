"""
Motion Combination Script v2 for index.blend
Combines idle, jab, cross, lead-hand-hook into a single seamless action.

Approach: Directly construct fcurves and keyframe points in a new action,
bypassing the keyframe_insert API which has slot issues in Blender 5.x.
"""

import bpy
import math
import os
import mathutils
from mathutils import Vector, Quaternion

# ============================================================
# CONFIGURATION
# ============================================================

# Paths are resolved relative to this script so the folder can be moved freely.
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
BLEND_FILE = os.path.join(SCRIPT_DIR, "index.blend")
OUTPUT_FBX = os.path.join(SCRIPT_DIR, "combined_idle_jab_cross_leadhook.fbx")
OUTPUT_BLEND = os.path.join(SCRIPT_DIR, "combined.blend")

ARMATURE_NAME = "Armature"

# Action order and cut parameters
# - cut_frame: last frame to keep from this action's "active" portion (punch + impact)
# - blend_frames: number of transition frames to blend end of this action into start of next
ACTIONS = [
    ("idle",           67, 8),   # full idle (cyclic guard stance), 8-frame blend into jab
    ("jab",            20, 8),   # punch peaks ~F11-17, keep to F20, 8-frame blend into cross
    ("cross",           25, 8),   # punch peaks ~F16-21, keep to F25, 8-frame blend into lead-hook
    ("lead-hand-hook", 24, 6),   # punch peaks ~F14-20, keep to F24, 6-frame blend to end
]

# ============================================================
# HELPER FUNCTIONS
# ============================================================

def get_action_fcurves(action):
    """Get fcurves from a layered action (Blender 5.x API)."""
    return action.layers[0].strips[0].channelbags[0].fcurves

def find_fcurve(action, data_path, array_idx):
    for fc in get_action_fcurves(action):
        if fc.data_path == data_path and fc.array_index == array_idx:
            return fc
    return None

def sample_action_pose(action, frame):
    """Sample all bone transforms from an action at a given frame.
    Returns dict: bone_name -> {
        location: [x, y, z],
        rotation_quaternion: [w, x, y, z],
        scale: [x, y, z]
    }
    """
    fcurves = get_action_fcurves(action)
    bone_data = {}
    
    for fc in fcurves:
        dp = fc.data_path
        if 'pose.bones[' not in dp:
            continue
        
        # Extract bone name
        bone_start = dp.index('["') + 2
        bone_end = dp.index('"]', bone_start)
        bone_name = dp[bone_start:bone_end]
        
        # Extract data type
        data_type = dp.split('.')[-1]
        
        if bone_name not in bone_data:
            bone_data[bone_name] = {
                'location': [0.0, 0.0, 0.0],
                'rotation_quaternion': [1.0, 0.0, 0.0, 0.0],
                'scale': [1.0, 1.0, 1.0],
            }
        
        idx = fc.array_index
        val = fc.evaluate(frame)
        
        if data_type in bone_data[bone_name]:
            bone_data[bone_name][data_type][idx] = val
    
    return bone_data

def smootherstep(t):
    """Ken Perlin's smootherstep: 6t^5 - 15t^4 + 10t^3"""
    return t * t * t * (t * (t * 6 - 15) + 10)

def blend_value(a, b, t):
    """Linear blend."""
    return a + (b - a) * t

def blend_quat(a, b, t):
    """Spherical linear interpolation between two quaternions.
    a, b are lists: [w, x, y, z]
    """
    # Normalize input
    import math
    aw, ax, ay, az = a
    bw, bx, by, bz = b
    
    dot = aw * bw + ax * bx + ay * by + az * bz
    
    # If the dot product is negative, negate one quaternion for shortest path
    if dot < 0.0:
        bw, bx, by, bz = -bw, -bx, -by, -bz
        dot = -dot
    
    # If very close, use linear interpolation
    if dot > 0.9995:
        result = [blend_value(aw, bw, t), blend_value(ax, bx, t),
                  blend_value(ay, by, t), blend_value(az, bz, t)]
    else:
        theta_0 = math.acos(dot)
        sin_theta_0 = math.sin(theta_0)
        theta = theta_0 * t
        sin_theta = math.sin(theta)
        s0 = math.cos(theta) - dot * sin_theta / sin_theta_0
        s1 = sin_theta / sin_theta_0
        result = [s0 * aw + s1 * bw, s0 * ax + s1 * bx,
                  s0 * ay + s1 * by, s0 * az + s1 * bz]
    
    # Normalize result
    norm = math.sqrt(sum(c * c for c in result))
    if norm > 0:
        result = [c / norm for c in result]
    
    return result

def blend_pose(pose_a, pose_b, t):
    """Blend two poses. t=0 -> pure A, t=1 -> pure B."""
    bf = smootherstep(t)
    result = {}
    
    all_bones = set(pose_a.keys()) | set(pose_b.keys())
    
    for bone in all_bones:
        a = pose_a.get(bone)
        b = pose_b.get(bone)
        
        if a is None:
            result[bone] = dict(b)
            continue
        if b is None:
            result[bone] = dict(a)
            continue
        
        blended = {}
        blended['location'] = [blend_value(a['location'][i], b['location'][i], bf) for i in range(3)]
        blended['rotation_quaternion'] = blend_quat(a['rotation_quaternion'], b['rotation_quaternion'], bf)
        blended['scale'] = [blend_value(a['scale'][i], b['scale'][i], bf) for i in range(3)]
        
        result[bone] = blended
    
    return result

def offset_pose_hips(pose, offset):
    """Add offset to Hips location in a pose."""
    if 'mixamorig:Hips' not in pose:
        return pose
    new_pose = dict(pose)
    hips = dict(pose['mixamorig:Hips'])
    hips['location'] = [hips['location'][i] + offset[i] for i in range(3)]
    new_pose['mixamorig:Hips'] = hips
    return new_pose

# ============================================================
# MAIN COMBINATION LOGIC
# ============================================================

def combine_actions():
    armature = bpy.data.objects.get(ARMATURE_NAME)
    if not armature:
        print(f"ERROR: Armature '{ARMATURE_NAME}' not found!")
        return None, 0
    
    pose_bones = armature.pose.bones
    bone_names = [pb.name for pb in pose_bones]
    
    # Build the combined timeline
    # all_frames: list of (frame_number, pose_dict)
    all_frames = []
    
    # Segment tracking for root motion
    segment_info = []
    current_frame = 1
    
    for action_idx, (action_name, cut_frame, blend_frames) in enumerate(ACTIONS):
        action = bpy.data.actions.get(action_name)
        if not action:
            print(f"WARNING: Action '{action_name}' not found!")
            continue
        
        action_start = int(action.frame_range[0])
        action_end = int(action.frame_range[1])
        segment_end = min(cut_frame + blend_frames, action_end)
        num_frames = segment_end - action_start + 1
        
        # Sample start and cut poses for root motion calc
        start_pose = sample_action_pose(action, action_start)
        cut_pose = sample_action_pose(action, cut_frame)
        
        start_hips = start_pose['mixamorig:Hips']['location']
        cut_hips = cut_pose['mixamorig:Hips']['location']
        
        segment_info.append({
            'name': action_name,
            'action': action,
            'start_frame': action_start,
            'cut_frame': cut_frame,
            'segment_end': segment_end,
            'num_frames': num_frames,
            'cut_offset': cut_frame - action_start,
            'start_hips': start_hips,
            'cut_hips': cut_hips,
            'blend_frames': blend_frames,
            'frame_start': current_frame,  # first frame in combined timeline
        })
        
        current_frame += num_frames
    
    # Calculate root motion offsets for each segment
    cumulative_world = [0.0, 0.0, 0.0]  # Where character "is" in world space
    
    for seg_idx, seg in enumerate(segment_info):
        if seg_idx == 0:
            seg['offset'] = [0.0, 0.0, 0.0]
        else:
            # This segment should start where the previous segment's cut frame left off
            seg['offset'] = [
                cumulative_world[0] - seg['start_hips'][0],
                cumulative_world[1] - seg['start_hips'][1],
                0.0,  # Don't offset Z (height) - let it be natural
            ]
        
        # Update cumulative: where does the cut frame leave the character?
        cumulative_world = [
            seg['cut_hips'][0] + seg['offset'][0],
            seg['cut_hips'][1] + seg['offset'][1],
            seg['cut_hips'][2] + seg['offset'][2],
        ]
        
        print(f"Segment {seg['name']}: offset={seg['offset']}, cumulative_world={cumulative_world}")
    
    # Now build the actual frames
    for seg_idx, seg in enumerate(segment_info):
        action = seg['action']
        action_start = seg['start_frame']
        cut_frame = seg['cut_frame']
        segment_end = seg['segment_end']
        blend_frames = seg['blend_frames']
        seg_offset = seg['offset']
        cut_offset = seg['cut_offset']
        
        # Get next segment's offset for blend zone
        if seg_idx < len(segment_info) - 1:
            next_seg = segment_info[seg_idx + 1]
            next_offset = next_seg['offset']
            next_action = next_seg['action']
            next_action_start = next_seg['start_frame']
            next_start_pose = sample_action_pose(next_action, int(next_action.frame_range[0]))
        else:
            next_offset = seg_offset
            next_start_pose = None
        
        for local_f in range(seg['num_frames']):
            src_frame = action_start + local_f
            target_frame = seg['frame_start'] + local_f
            
            # Sample the pose at this source frame
            pose = sample_action_pose(action, src_frame)
            
            # Determine which zone we're in
            if local_f <= cut_offset:
                # Active zone (punch + impact)
                # Apply this segment's root offset
                if 'mixamorig:Hips' in pose:
                    hips = pose['mixamorig:Hips']
                    hips['location'] = [hips['location'][i] + seg_offset[i] for i in range(3)]
            else:
                # Blend zone (transitioning to next action)
                blend_t = (local_f - cut_offset) / max(1, blend_frames)
                blend_t = min(1.0, blend_t)
                
                if next_start_pose is not None:
                    # Blend from current action's pose to next action's start pose
                    # First, apply offset to the current action's pose
                    if 'mixamorig:Hips' in pose:
                        hips = pose['mixamorig:Hips']
                        hips['location'] = [hips['location'][i] + seg_offset[i] for i in range(3)]
                    
                    # Apply offset to the next action's start pose
                    next_pose_offset = offset_pose_hips(next_start_pose, next_offset)
                    
                    # Blend
                    pose = blend_pose(pose, next_pose_offset, blend_t)
                else:
                    # Last segment - apply offset and use as-is
                    if 'mixamorig:Hips' in pose:
                        hips = pose['mixamorig:Hips']
                        hips['location'] = [hips['location'][i] + seg_offset[i] for i in range(3)]
            
            all_frames.append((target_frame, pose))
    
    total_frames = len(all_frames)
    print(f"\nTotal combined frames: {total_frames}")
    
    # ---- CREATE THE BAKED ACTION BY DIRECTLY BUILDING FCURVES ----
    print(f"\n=== Creating baked action via direct fcurve construction ===")
    
    # Get the list of all fcurve data paths from the first action (they should all have the same)
    template_action = bpy.data.actions.get(ACTIONS[0][0])
    template_fcurves = get_action_fcurves(template_action)
    
    # Collect all unique (data_path, array_index) pairs
    fcurve_specs = []
    for fc in template_fcurves:
        fcurve_specs.append((fc.data_path, fc.array_index))
    
    # Also add any fcurves that might be in other actions but not in the first
    for action_name, _, _ in ACTIONS[1:]:
        action = bpy.data.actions.get(action_name)
        for fc in get_action_fcurves(action):
            spec = (fc.data_path, fc.array_index)
            if spec not in fcurve_specs:
                fcurve_specs.append(spec)
    
    print(f"Total fcurve specs: {len(fcurve_specs)}")
    
    # Remove existing animation data
    if armature.animation_data:
        for track in list(armature.animation_data.nla_tracks):
            armature.animation_data.nla_tracks.remove(track)
        armature.animation_data.action = None
    
    # Create new action
    new_action = bpy.data.actions.new("idle_jab_cross_leadhook_combined")
    armature.animation_data_create()
    armature.animation_data.action = new_action
    
    # Create slot for the armature
    if len(new_action.slots) == 0:
        slot = new_action.slots.new(id_type='OBJECT', name='ArmatureSlot')
    else:
        slot = new_action.slots[0]
    armature.animation_data.action_slot = slot
    
    # Ensure the action has at least one layer and strip
    if len(new_action.layers) == 0:
        layer = new_action.layers.new(name="Layer")
    else:
        layer = new_action.layers[0]
    
    if len(layer.strips) == 0:
        strip = layer.strips.new(type='KEYFRAME')
    else:
        strip = layer.strips[0]
    
    # Find or create the channelbag for our slot
    channelbag = None
    for cb in strip.channelbags:
        if cb.slot_handle == slot.handle:
            channelbag = cb
            break
    if channelbag is None:
        channelbag = strip.channelbags.new(slot)
    
    # Now create fcurves and keyframe points directly
    # Build a lookup: (data_path, array_idx) -> list of values per frame
    print("Building fcurve data...")
    
    # Create a lookup from pose data
    # For each fcurve spec, we need values at every frame
    for spec_idx, (data_path, array_idx) in enumerate(fcurve_specs):
        if spec_idx % 50 == 0:
            print(f"  Processing fcurve {spec_idx}/{len(fcurve_specs)}: {data_path}[{array_idx}]")
        
        # Extract bone name and data type from data_path
        # Format: pose.bones["mixamorig:Hips"].location
        bone_start = data_path.index('["') + 2
        bone_end = data_path.index('"]', bone_start)
        bone_name = data_path[bone_start:bone_end]
        data_type = data_path.split('.')[-1]
        
        # Collect values for this fcurve at every frame
        values = []
        for frame_num, pose in all_frames:
            if bone_name in pose and data_type in pose[bone_name]:
                values.append(pose[bone_name][data_type][array_idx])
            else:
                # Default value
                if data_type == 'rotation_quaternion' and array_idx == 0:
                    values.append(1.0)
                elif data_type == 'scale':
                    values.append(1.0)
                else:
                    values.append(0.0)
        
        # Create the fcurve
        try:
            fc = channelbag.fcurves.new(data_path=data_path, index=array_idx)
        except RuntimeError as e:
            # Fcurve might already exist, try to find it
            fc = None
            for existing_fc in channelbag.fcurves:
                if existing_fc.data_path == data_path and existing_fc.array_index == array_idx:
                    fc = existing_fc
                    break
            if fc is None:
                print(f"  WARNING: Could not create/find fcurve for {data_path}[{array_idx}]: {e}")
                continue
        
        # Set interpolation type to BEZIER for smooth curves
        # Add keyframe points
        for frame_idx, val in enumerate(values):
            frame = float(frame_idx + 1)  # 1-based frame numbers
            kp = fc.keyframe_points.insert(frame, val)
            if kp:
                kp.interpolation = 'BEZIER'
                # Set handle types to AUTO for smooth curves
                kp.handle_left_type = 'AUTO'
                kp.handle_right_type = 'AUTO'
    
    # Set frame range
    new_action.frame_range[0] = 1
    new_action.frame_range[1] = float(total_frames)
    
    # Set scene frame range
    bpy.context.scene.frame_start = 1
    bpy.context.scene.frame_end = total_frames
    
    print(f"\nAction created: {new_action.name}")
    print(f"Frame range: 1 - {total_frames}")
    
    # Verify
    new_fcurves = get_action_fcurves(new_action)
    print(f"Total fcurves in new action: {len(new_fcurves)}")
    
    # Check a sample fcurve
    for fc in new_fcurves:
        if 'Hips' in fc.data_path and 'location' in fc.data_path and fc.array_index == 1:
            kp = sorted(fc.keyframe_points, key=lambda k: k.co.x)
            vals = [round(k.co.y, 4) for k in kp[:10]]
            print(f"  Hips.location.Y first 10 values: {vals}")
            vals2 = [round(k.co.y, 4) for k in kp[20:30]]
            print(f"  Hips.location.Y frames 21-30: {vals2}")
            break
    
    for fc in new_fcurves:
        if 'RightArm' in fc.data_path and 'rotation_quaternion' in fc.data_path and fc.array_index == 0:
            kp = sorted(fc.keyframe_points, key=lambda k: k.co.x)
            vals = [round(k.co.y, 4) for k in kp[:10]]
            print(f"  RightArm.quat.W first 10 values: {vals}")
            break
    
    return new_action, total_frames


def export_fbx(output_path, total_frames):
    """Export the armature with the combined action as FBX."""
    print(f"\n=== Exporting FBX ===")
    print(f"  Output: {output_path}")
    
    armature = bpy.data.objects.get(ARMATURE_NAME)
    
    # Ensure ONLY our action is the animation source
    # Clear ALL NLA tracks (they may interfere with baking)
    if armature.animation_data:
        for track in list(armature.animation_data.nla_tracks):
            armature.animation_data.nla_tracks.remove(track)
        action = armature.animation_data.action
        if action:
            print(f"  Active action: {action.name}, frames: {action.frame_range}")
            print(f"  Total fcurves: {len(get_action_fcurves(action))}")
    
    # Set scene frame range
    bpy.context.scene.frame_start = 1
    bpy.context.scene.frame_end = total_frames
    
    # Delete all other actions to ensure no interference
    actions_to_remove = []
    for a in bpy.data.actions:
        if a != armature.animation_data.action:
            actions_to_remove.append(a)
    for a in actions_to_remove:
        print(f"  Removing old action: {a.name}")
        bpy.data.actions.remove(a)
    
    # Now bake a fresh action from the evaluated poses
    # This ensures a clean action that the FBX exporter can properly handle
    print(f"\n  Baking fresh action from evaluated poses...")
    
    # Select armature
    bpy.ops.object.select_all(action='DESELECT')
    armature.select_set(True)
    bpy.context.view_layer.objects.active = armature
    
    # Bake the animation using Blender's built-in baker
    # This creates a clean action with proper slot binding
    bpy.ops.nla.bake(
        frame_start=1,
        frame_end=total_frames,
        step=1,
        only_selected=False,
        visual_keying=True,
        clear_constraints=False,
        bake_types={'POSE'},
    )
    
    # The bake operator creates a new action and assigns it
    baked_action = armature.animation_data.action
    print(f"  Baked action: {baked_action.name}")
    print(f"  Baked frame range: {baked_action.frame_range}")
    
    if baked_action.is_action_layered:
        baked_fcurves = baked_action.layers[0].strips[0].channelbags[0].fcurves
    else:
        baked_fcurves = baked_action.fcurves if hasattr(baked_action, 'fcurves') else []
    print(f"  Baked fcurves: {len(baked_fcurves)}")
    
    # Verify
    for fc in baked_fcurves:
        if 'Hips' in fc.data_path and 'location' in fc.data_path and fc.array_index == 1:
            kp = sorted(fc.keyframe_points, key=lambda k: k.co.x)
            print(f"  Hips.Y: F1={kp[0].co.y:.4f}, F20={kp[19].co.y:.4f}, F91={kp[-1].co.y:.4f}")
            break
    
    # Select objects for export
    bpy.ops.object.select_all(action='DESELECT')
    armature.select_set(True)
    bpy.context.view_layer.objects.active = armature
    
    for obj in bpy.data.objects:
        if obj.type == 'MESH' and obj.parent == armature:
            obj.select_set(True)
    
    # Export FBX
    bpy.ops.export_scene.fbx(
        filepath=output_path,
        use_selection=True,
        object_types={'ARMATURE', 'MESH'},
        bake_anim=True,
        bake_anim_use_all_bones=True,
        bake_anim_force_startend_keying=True,
        bake_anim_step=1.0,
        bake_anim_simplify_factor=0,
        add_leaf_bones=False,
        use_armature_deform_only=False,
        bake_space_transform=True,
        axis_forward='-Y',
        axis_up='Z',
        apply_unit_scale=True,
        global_scale=1.0,
    )
    
    print(f"  FBX exported successfully!")


# ============================================================
# RUN
# ============================================================

if __name__ == '__main__':
    print("=" * 60)
    print("MOTION COMBINATION SCRIPT v2")
    print("=" * 60)
    
    action, total_frames = combine_actions()
    if action:
        export_fbx(OUTPUT_FBX, total_frames)
        
        bpy.ops.wm.save_as_mainfile(filepath=OUTPUT_BLEND)
        print(f"\nBlend file saved: {OUTPUT_BLEND}")
    
    print("\n" + "=" * 60)
    print("DONE!")
    print("=" * 60)
