"""
Export combo actions directly from index.blend as GLB files.
This preserves textures because we open the original blend file (which has packed textures)
and export GLB directly, without going through FBX intermediate.

Usage:
  Blender -b -P build/export_combo_glb.py -- --blend motion-combine/index.blend --out-dir web/media/glb
"""
import bpy
import sys
import os
import math
from mathutils import Vector, Quaternion

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []

def arg(name, default=None):
    return argv[argv.index(name) + 1] if name in argv else default

BLEND_FILE = arg("--blend", "/Users/justrun/project/boxing-3/motion-combine/index.blend")
OUT_DIR = arg("--out-dir", "/Users/justrun/project/boxing-3/web/media/glb")
ARMATURE_NAME = "Armature"

ACTION_CUTS = {
    "idle":              (67, 8),
    "jab":               (20, 8),
    "cross":             (25, 8),
    "lead-hand-hook":    (24, 8),
    "back-hand-hook":    (25, 8),
    "lead-hand-uppercut": (24, 8),
    "back-hand-uppercut": (25, 8),
}

COMBOS = [
    ("combo_jab_cross",                       ["idle", "jab", "cross"]),
    ("combo_jab_cross_leadhook_rearhook",      ["idle", "jab", "cross", "lead-hand-hook", "back-hand-hook"]),
    ("combo_jab_jab_cross",                    ["idle", "jab", "jab", "cross"]),
    ("combo_jab_cross_hook",                   ["idle", "jab", "cross", "lead-hand-hook"]),
    ("combo_jab_cross_leadhook_cross",         ["idle", "jab", "cross", "lead-hand-hook", "cross"]),
    ("combo_jab_cross_leaduppercut",           ["idle", "jab", "cross", "lead-hand-uppercut"]),
    ("combo_jab_rearuppercut_leadhook",        ["idle", "jab", "back-hand-uppercut", "lead-hand-hook"]),
    ("combo_jab_cross_leadhook_cross_dup",    ["idle", "jab", "cross", "lead-hand-hook", "cross"]),
    ("combo_cross_leadhook_cross",             ["idle", "cross", "lead-hand-hook", "cross"]),
]

# Also export the original combined_idle_jab_cross_leadhook if it exists as an action
EXTRA_ACTIONS = [
    ("combined_idle_jab_cross_leadhook", "idle_jab_cross_leadhook"),
]


def get_action_fcurves(action):
    return action.layers[0].strips[0].channelbags[0].fcurves


def sample_action_pose(action, frame):
    fcurves = get_action_fcurves(action)
    bone_data = {}
    for fc in fcurves:
        dp = fc.data_path
        if 'pose.bones[' not in dp:
            continue
        bone_start = dp.index('["') + 2
        bone_end = dp.index('"]', bone_start)
        bone_name = dp[bone_start:bone_end]
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
    return t * t * t * (t * (t * 6 - 15) + 10)


def blend_value(a, b, t):
    return a + (b - a) * t


def blend_quat(a, b, t):
    aw, ax, ay, az = a
    bw, bx, by, bz = b
    dot = aw * bw + ax * bx + ay * by + az * bz
    if dot < 0.0:
        bw, bx, by, bz = -bw, -bx, -by, -bz
        dot = -dot
    if dot > 0.9995:
        result = [blend_value(aw, bw, t), blend_value(ax, bx, t),
                  blend_value(ay, by, t), blend_value(az, bz, t)]
    else:
        theta_0 = math.acos(max(-1.0, min(1.0, dot)))
        sin_theta_0 = math.sin(theta_0)
        theta = theta_0 * t
        sin_theta = math.sin(theta)
        s0 = math.cos(theta) - dot * sin_theta / sin_theta_0
        s1 = sin_theta / sin_theta_0
        result = [s0 * aw + s1 * bw, s0 * ax + s1 * bx,
                  s0 * ay + s1 * by, s0 * az + s1 * bz]
    norm = math.sqrt(sum(c * c for c in result))
    if norm > 0:
        result = [c / norm for c in result]
    return result


def blend_pose(pose_a, pose_b, t):
    bf = smootherstep(t)
    result = {}
    all_bones = set(pose_a.keys()) | set(pose_b.keys())
    for bone in all_bones:
        a = pose_a.get(bone)
        b = pose_b.get(bone)
        if a is None:
            result[bone] = {k: list(v) for k, v in b.items()}
            continue
        if b is None:
            result[bone] = {k: list(v) for k, v in a.items()}
            continue
        blended = {}
        blended['location'] = [blend_value(a['location'][i], b['location'][i], bf) for i in range(3)]
        blended['rotation_quaternion'] = blend_quat(a['rotation_quaternion'], b['rotation_quaternion'], bf)
        blended['scale'] = [blend_value(a['scale'][i], b['scale'][i], bf) for i in range(3)]
        result[bone] = blended
    return result


def offset_pose_hips(pose, offset):
    if 'mixamorig:Hips' not in pose:
        return pose
    new_pose = dict(pose)
    hips = dict(pose['mixamorig:Hips'])
    hips['location'] = [hips['location'][i] + offset[i] for i in range(3)]
    new_pose['mixamorig:Hips'] = hips
    return new_pose


def build_combo_action(armature, combo_name, action_sequence):
    """Build a combined action and return it."""
    print(f"\nBuilding combo: {combo_name}")
    print(f"  Sequence: {' -> '.join(action_sequence)}")

    pose_bones = armature.pose.bones

    segment_info = []
    current_frame = 1

    for action_name in action_sequence:
        action = bpy.data.actions.get(action_name)
        if not action:
            print(f"ERROR: Action '{action_name}' not found!")
            return None

        cut_frame, blend_frames = ACTION_CUTS[action_name]
        action_start = int(action.frame_range[0])
        action_end = int(action.frame_range[1])
        segment_end = min(cut_frame + blend_frames, action_end)
        num_frames = segment_end - action_start + 1

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
            'frame_start': current_frame,
        })
        current_frame += num_frames

    cumulative_world = [0.0, 0.0, 0.0]
    for seg_idx, seg in enumerate(segment_info):
        if seg_idx == 0:
            seg['offset'] = [0.0, 0.0, 0.0]
        else:
            seg['offset'] = [
                cumulative_world[0] - seg['start_hips'][0],
                cumulative_world[1] - seg['start_hips'][1],
                0.0,
            ]
        cumulative_world = [
            seg['cut_hips'][0] + seg['offset'][0],
            seg['cut_hips'][1] + seg['offset'][1],
            seg['cut_hips'][2] + seg['offset'][2],
        ]
        print(f"  {seg['name']}: offset={seg['offset']}")

    all_frames = []
    for seg_idx, seg in enumerate(segment_info):
        action = seg['action']
        action_start = seg['start_frame']
        cut_frame = seg['cut_frame']
        segment_end = seg['segment_end']
        blend_frames = seg['blend_frames']
        seg_offset = seg['offset']
        cut_offset = seg['cut_offset']

        if seg_idx < len(segment_info) - 1:
            next_seg = segment_info[seg_idx + 1]
            next_offset = next_seg['offset']
            next_action = next_seg['action']
            next_start_pose = sample_action_pose(next_action, int(next_action.frame_range[0]))
        else:
            next_offset = seg_offset
            next_start_pose = None

        for local_f in range(seg['num_frames']):
            src_frame = action_start + local_f
            target_frame = seg['frame_start'] + local_f
            pose = sample_action_pose(action, src_frame)

            if local_f <= cut_offset:
                if 'mixamorig:Hips' in pose:
                    hips = pose['mixamorig:Hips']
                    hips['location'] = [hips['location'][i] + seg_offset[i] for i in range(3)]
            else:
                blend_t = (local_f - cut_offset) / max(1, blend_frames)
                blend_t = min(1.0, blend_t)
                if next_start_pose is not None:
                    if 'mixamorig:Hips' in pose:
                        hips = pose['mixamorig:Hips']
                        hips['location'] = [hips['location'][i] + seg_offset[i] for i in range(3)]
                    next_pose_offset = offset_pose_hips(next_start_pose, next_offset)
                    pose = blend_pose(pose, next_pose_offset, blend_t)
                else:
                    if 'mixamorig:Hips' in pose:
                        hips = pose['mixamorig:Hips']
                        hips['location'] = [hips['location'][i] + seg_offset[i] for i in range(3)]

            all_frames.append((target_frame, pose))

    total_frames = len(all_frames)
    print(f"  Total frames: {total_frames}")

    # Collect all fcurve specs
    template_action = bpy.data.actions.get(action_sequence[0])
    template_fcurves = get_action_fcurves(template_action)
    fcurve_specs = [(fc.data_path, fc.array_index) for fc in template_fcurves]

    for action_name in action_sequence[1:]:
        action = bpy.data.actions.get(action_name)
        for fc in get_action_fcurves(action):
            spec = (fc.data_path, fc.array_index)
            if spec not in fcurve_specs:
                fcurve_specs.append(spec)

    # Clear animation data
    if armature.animation_data:
        for track in list(armature.animation_data.nla_tracks):
            armature.animation_data.nla_tracks.remove(track)
        armature.animation_data.action = None

    # Create new action
    action_name_str = f"combo_{combo_name}"
    new_action = bpy.data.actions.new(action_name_str)
    armature.animation_data_create()
    armature.animation_data.action = new_action

    if len(new_action.slots) == 0:
        slot = new_action.slots.new(id_type='OBJECT', name='ArmatureSlot')
    else:
        slot = new_action.slots[0]
    armature.animation_data.action_slot = slot

    if len(new_action.layers) == 0:
        layer = new_action.layers.new(name="Layer")
    else:
        layer = new_action.layers[0]

    if len(layer.strips) == 0:
        strip = layer.strips.new(type='KEYFRAME')
    else:
        strip = layer.strips[0]

    channelbag = None
    for cb in strip.channelbags:
        if cb.slot_handle == slot.handle:
            channelbag = cb
            break
    if channelbag is None:
        channelbag = strip.channelbags.new(slot)

    for spec_idx, (data_path, array_idx) in enumerate(fcurve_specs):
        bone_start = data_path.index('["') + 2
        bone_end = data_path.index('"]', bone_start)
        bone_name = data_path[bone_start:bone_end]
        data_type = data_path.split('.')[-1]

        values = []
        for frame_num, pose in all_frames:
            if bone_name in pose and data_type in pose[bone_name]:
                values.append(pose[bone_name][data_type][array_idx])
            else:
                if data_type == 'rotation_quaternion' and array_idx == 0:
                    values.append(1.0)
                elif data_type == 'scale':
                    values.append(1.0)
                else:
                    values.append(0.0)

        try:
            fc = channelbag.fcurves.new(data_path=data_path, index=array_idx)
        except RuntimeError:
            fc = None
            for existing_fc in channelbag.fcurves:
                if existing_fc.data_path == data_path and existing_fc.array_index == array_idx:
                    fc = existing_fc
                    break
            if fc is None:
                continue

        for frame_idx, val in enumerate(values):
            frame = float(frame_idx + 1)
            kp = fc.keyframe_points.insert(frame, val)
            if kp:
                kp.interpolation = 'BEZIER'
                kp.handle_left_type = 'AUTO'
                kp.handle_right_type = 'AUTO'

    new_action.frame_range[0] = 1
    new_action.frame_range[1] = float(total_frames)
    bpy.context.scene.frame_start = 1
    bpy.context.scene.frame_end = total_frames

    print(f"  Action created: {new_action.name}, {len(get_action_fcurves(new_action))} fcurves")
    return new_action


def export_combo_glb(armature, action, out_path, action_name_in_glb):
    """Export the armature+meshes as GLB with only the given action."""
    print(f"  Exporting GLB: {out_path}")

    # Delete all other actions so only our combo action gets exported
    actions_to_remove = [a for a in bpy.data.actions if a != action]
    for a in actions_to_remove:
        bpy.data.actions.remove(a)

    # Set up NLA track for the action
    ad = armature.animation_data or armature.animation_data_create()

    # Clear existing NLA tracks
    for t in list(ad.nla_tracks):
        ad.nla_tracks.remove(t)

    # Add our action as NLA strip
    track = ad.nla_tracks.new()
    track.name = action_name_in_glb
    strip = track.strips.new(action_name_in_glb, 1, action)
    strip.name = action_name_in_glb
    strip.action_frame_start = 1
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

    os.makedirs(os.path.dirname(os.path.abspath(out_path)), exist_ok=True)

    # Export GLB with same settings as export_with_idle.py
    bpy.ops.export_scene.gltf(
        filepath=os.path.abspath(out_path),
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
    print(f"  GLB exported: {out_path}, size={os.path.getsize(out_path) / 1024:.1f} KB")


def main():
    print("=" * 60)
    print("DIRECT COMBO GLB EXPORT")
    print("=" * 60)

    bpy.ops.wm.open_mainfile(filepath=BLEND_FILE)
    armature = bpy.data.objects.get(ARMATURE_NAME)
    if not armature:
        print(f"ERROR: Armature '{ARMATURE_NAME}' not found in {BLEND_FILE}")
        return

    print(f"Opened: {BLEND_FILE}")
    print(f"Armature: {armature.name}, bones={len(armature.data.bones)}")
    print(f"Actions: {[a.name for a in bpy.data.actions]}")
    print(f"Materials: {[m.name for m in bpy.data.materials if m.users > 0]}")

    success = 0
    fail = 0

    for combo_name, action_sequence in COMBOS:
        # Reload fresh for each combo
        bpy.ops.wm.open_mainfile(filepath=BLEND_FILE)
        armature = bpy.data.objects.get(ARMATURE_NAME)

        try:
            action = build_combo_action(armature, combo_name, action_sequence)
            if action:
                out_path = os.path.join(OUT_DIR, f"{combo_name}.glb")
                export_combo_glb(armature, action, out_path, combo_name)
                success += 1
            else:
                fail += 1
        except Exception as e:
            fail += 1
            print(f"  ERROR: {e}")
            import traceback
            traceback.print_exc()

    # Also handle the original combined_idle_jab_cross_leadhook if present
    for action_name, glb_name in EXTRA_ACTIONS:
        bpy.ops.wm.open_mainfile(filepath=BLEND_FILE)
        armature = bpy.data.objects.get(ARMATURE_NAME)
        action = bpy.data.actions.get(action_name)
        if action:
            try:
                out_path = os.path.join(OUT_DIR, f"{glb_name}.glb")
                export_combo_glb(armature, action, out_path, glb_name)
                success += 1
            except Exception as e:
                fail += 1
                print(f"  ERROR exporting {action_name}: {e}")
        else:
            print(f"  SKIP: action '{action_name}' not found")

    print(f"\n{'=' * 60}")
    print(f"DONE: {success} succeeded, {fail} failed")
    print(f"{'=' * 60}")


if __name__ == '__main__':
    main()
