"""Sanity-check a retargeted action against its source.

Aligns both rigs on the same scene frame (NLA strips at the same start), then
compares per-bone world rotation (angle) and hip-relative position (normalised
by hip height) between source and destination.

usage:
  Blender -b -P build/compare_retarget.py -- --blend resources/Untitled-with-uppercut.blend \
      --fbx "animations-red/Receiving A Big Uppercut-open-arm.fbx" \
      --action black-receive-big-uppercut-arm-open --strip-start 122
"""
import bpy
import sys
from math import degrees
from mathutils import Vector

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []


def arg(name, default=None):
    return argv[argv.index(name) + 1] if name in argv else default


blend_path = arg("--blend", "resources/Untitled-with-uppercut.blend")
fbx_path = arg("--fbx")
action_name = arg("--action", "black-receive-big-uppercut-arm-open")
start = float(arg("--strip-start", "122"))

bpy.ops.wm.open_mainfile(filepath=blend_path)
scene = bpy.context.scene
dst = bpy.data.objects["Armature"]
act = bpy.data.actions[action_name]

# make sure the action drives the rig through NLA on the same timeline
ad = dst.animation_data
ad.action = None
found = None
for t in ad.nla_tracks:
    for s in t.strips:
        if s.action == act:
            found = s
if found is None:
    t = ad.nla_tracks.new()
    found = t.strips.new(action_name, int(start), act)
    found.action_frame_start = act.frame_range[0]
    found.action_frame_end = act.frame_range[1]
    found.frame_start = start
    found.frame_end = start + (act.frame_range[1] - act.frame_range[0])
print("DST strip", found.frame_start, found.frame_end, found.action_frame_start, found.action_frame_end)

before = set(bpy.data.objects)
bpy.ops.import_scene.fbx(filepath=fbx_path)
added = [o for o in bpy.data.objects if o not in before]
src = [o for o in added if o.type == "ARMATURE"][0]
src_action = src.animation_data.action
src.animation_data.action = None
t2 = src.animation_data.nla_tracks.new()
s2 = t2.strips.new("cmp", int(start), src_action)
s2.action_frame_start = src_action.frame_range[0]
s2.action_frame_end = src_action.frame_range[1]
s2.frame_start = start
s2.frame_end = start + (src_action.frame_range[1] - src_action.frame_range[0])
print("SRC strip", s2.frame_start, s2.frame_end)

hips_s = src.pose.bones["mixamorig:Hips"]
hips_d = dst.pose.bones["mixamorig:Hips"]
names = [b.name for b in dst.data.bones if src.data.bones.get(b.name)]

frames = [int(start + i) for i in (0, 15, 30, 45, 60, 73)]
rows = []
worst_rot = (0, None, None)
worst_pos = (0, None, None)
for f in frames:
    scene.frame_set(f)
    bpy.context.view_layer.update()
    hs = hips_s.matrix.translation.copy()
    hd = hips_d.matrix.translation.copy()
    qs_frame = hips_s.matrix.to_quaternion()
    qd_frame = hips_d.matrix.to_quaternion()
    for n in names:
        if n == "mixamorig:Hips":
            continue
        ps = qs_frame.inverted() @ (src.pose.bones[n].matrix.translation - hs)
        pd = qd_frame.inverted() @ (dst.pose.bones[n].matrix.translation - hd)
        err = (ps.normalized() - pd.normalized()).length if ps.length > 1e-6 else 0.0
        q1 = qs_frame.inverted() @ src.pose.bones[n].matrix.to_quaternion()
        q2 = qd_frame.inverted() @ dst.pose.bones[n].matrix.to_quaternion()
        ang = degrees(q1.rotation_difference(q2).angle)
        ang = min(ang, 360 - ang)
        if err > worst_pos[0]:
            worst_pos = (round(err, 4), n, f)
        if ang > worst_rot[0]:
            worst_rot = (round(ang, 2), n, f)
    rows.append({"frame": f, "src_hips": [round(v, 3) for v in hs], "dst_hips": [round(v, 3) for v in hd]})

print("FRAMES", rows)
print("WORST_ROT_DEG", worst_rot)
print("WORST_POS_DIR_ERR", worst_pos)

# full distribution over all sampled frames
allang = {}
allpos = {}
for f in frames:
    scene.frame_set(f)
    bpy.context.view_layer.update()
    hs = hips_s.matrix.translation.copy()
    hd = hips_d.matrix.translation.copy()
    qs_frame = hips_s.matrix.to_quaternion()
    qd_frame = hips_d.matrix.to_quaternion()
    for n in names:
        if n == "mixamorig:Hips":
            continue
        ps = qs_frame.inverted() @ (src.pose.bones[n].matrix.translation - hs)
        pd = qd_frame.inverted() @ (dst.pose.bones[n].matrix.translation - hd)
        e = (ps.normalized() - pd.normalized()).length if ps.length > 1e-6 else 0.0
        q1 = qs_frame.inverted() @ src.pose.bones[n].matrix.to_quaternion()
        q2 = qd_frame.inverted() @ dst.pose.bones[n].matrix.to_quaternion()
        a = degrees(q1.rotation_difference(q2).angle)
        a = min(a, 360 - a)
        allang[n] = max(allang.get(n, 0), a)
        allpos[n] = max(allpos.get(n, 0), e)

top_a = sorted(allang.items(), key=lambda x: -x[1])[:8]
top_p = sorted(allpos.items(), key=lambda x: -x[1])[:8]
print("TOP_ROT", [(n, round(v, 2)) for n, v in top_a])
print("TOP_POS", [(n, round(v, 3)) for n, v in top_p])
body = [v for n, v in allang.items() if not any(k in n for k in ("Hand", "Thumb", "Index", "Toe"))]
print("BODY_BONES", len(body), "max", round(max(body), 2), "mean", round(sum(body) / len(body), 2))

print("===DONE===")
