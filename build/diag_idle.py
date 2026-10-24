"""
Diagnose the idle action in index.blend: where is the character actually standing?

Reports, per frame of the 'idle' action:
  - hips location
  - world-space head bone position (Y = height) -> tells us if the body is upright
  - world-space foot position
  - a "upright" metric: the angle of the spine vector from hips to head

usage: Blender -b -P build/diag_idle.py -- --blend motion-combine/index.blend
"""
import bpy
import sys
import math
from mathutils import Vector

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []

def arg(name, default=None):
    v = argv[argv.index(name) + 1]
    return v[0] if isinstance(v, list) else v

BLEND_FILE = arg("--blend", "/Users/justrun/project/boxing-3/motion-combine/index.blend")

bpy.ops.wm.open_mainfile(filepath=BLEND_FILE)
arm = bpy.data.objects.get("Armature")
scene = bpy.context.scene

print("ACTIONS:")
for a in bpy.data.actions:
    print(f"  {a.name}: range={tuple(a.frame_range)}")

idle = bpy.data.actions.get("idle")
if not idle:
    print("NO idle action")
    sys.exit(0)

arm.animation_data_create()
if arm.animation_data.action:
    arm.animation_data.action = None
for t in list(arm.animation_data.nla_tracks):
    arm.animation_data.nla_tracks.remove(t)

track = arm.animation_data.nla_tracks.new()
track.name = "probe"
strip = track.strips.new("probe", 1, idle)
strip.action_frame_start = int(idle.frame_range[0])
strip.action_frame_end = int(idle.frame_range[1])
strip.frame_start = 1.0
strip.frame_end = float(idle.frame_range[1])
strip.blend_type = "REPLACE"
arm.animation_data.action = None

f0, f1 = int(idle.frame_range[0]), int(idle.frame_range[1])
print(f"\nIDLE range: {f0}..{f1}")
print(f"{'frame':>6} {'hipsX':>8} {'hipsY':>8} {'hipsZ':>8} {'headY':>8} {'headZ':>8} {'footY':>8} {'spineTilt':>10} {'headZ-headY':>12}")

rows = []
for fr in range(f0, f1 + 1):
    scene.frame_set(fr)
    bpy.context.view_layer.update()
    dg = bpy.context.evaluated_depsgraph_get()
    arm_eval = arm.evaluated_get(dg)
    pb = arm_eval.pose.bones
    hips = pb.get("mixamorig:Hips")
    head = pb.get("mixamorig:Head")
    foot = pb.get("mixamorig:LeftFoot") or pb.get("mixamorig:Foot")
    if not (hips and head):
        print("missing bones")
        break
    h = hips.head.copy()
    hd = head.head.copy()
    f = foot.head.copy() if foot else Vector((0, 0, 0))
    spine = hd - h
    tilt = math.degrees(math.atan2(abs(spine.x), spine.z)) if spine.length > 1e-6 else 0.0
    rows.append((fr, h, hd, f, tilt))

lines = ["IDLE TABLE",
         f"{'frame':>6} {'hipsX':>8} {'hipsY':>8} {'hipsZ':>8} {'headY':>8} {'headZ':>8} {'footY':>8} {'spineTilt':>10} {'headZ-headY':>12}"]
for fr, h, hd, f, tilt in rows:
    lines.append(f"{fr:>6} {h.x:>8.3f} {h.y:>8.3f} {h.z:>8.3f} {hd.y:>8.3f} {hd.z:>8.3f} {f.y:>8.3f} {tilt:>10.1f} {hd.z-h.z:>12.3f}")

lines.append("--- summary ---")
if rows:
    lines.append(f"frame {rows[0][0]}: headY={rows[0][2].y:.3f} headZ={rows[0][2].z:.3f}  hipsZ={rows[0][1].z:.3f}")
    lines.append(f"frame {rows[-1][0]}: headY={rows[-1][2].y:.3f} headZ={rows[-1][2].z:.3f}  hipsZ={rows[-1][1].z:.3f}")
    lines.append(f"max headY over range: {max(r[2].y for r in rows):.3f}")

print("\n".join(lines))
