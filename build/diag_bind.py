"""Inspect the armature/mesh object transforms and the REST (bind) pose in the blend,
to explain why the exported GLB's bind pose is 'lying down'.
"""
import bpy
import sys
import os
import math
from mathutils import Vector

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []

def arg(name, default=None):
    if name in argv:
        v = argv[argv.index(name) + 1]
        return v[0] if isinstance(v, list) else v
    return default

BLEND_FILE = arg("--blend", "/Users/justrun/project/boxing-3/motion-combine/index.blend")

bpy.ops.wm.open_mainfile(filepath=BLEND_FILE)

lines = []
def P(s):
    lines.append(str(s))

P("=" * 60)
P("SCENE OBJECTS")
P("=" * 60)
for ob in bpy.data.objects:
    P(f"  {ob.name:24s} type={ob.type:8s} parent={ob.parent.name if ob.parent else '-'}")
    P(f"      loc  = {tuple(round(v,4) for v in ob.location)}")
    P(f"      rot  = {tuple(round(math.degrees(v),3) for v in ob.rotation_euler)} deg")
    P(f"      scale= {tuple(round(v,4) for v in ob.scale)}")

arm = bpy.data.objects.get("Armature")
P("")
P("=" * 60)
P("REST POSE (bone .head in ARMATURE LOCAL space)")
P("=" * 60)
for bn in ("mixamorig:Hips", "mixamorig:Head", "mixamorig:LeftFoot", "mixamorig:RightFoot"):
    b = arm.data.bones.get(bn)
    if b:
        P(f"  {bn:24s} head_local={tuple(round(v,3) for v in b.head_local)}  tail_local={tuple(round(v,3) for v in b.tail_local)}")

P("")
P("REST POSE in WORLD space (armature matrix applied)")
P("=" * 60)
bpy.context.view_layer.update()
for bn in ("mixamorig:Hips", "mixamorig:Head", "mixamorig:LeftFoot", "mixamorig:RightFoot"):
    b = arm.data.bones.get(bn)
    if b:
        w = arm.matrix_world @ b.head_local
        P(f"  {bn:24s} head_world={tuple(round(v,3) for v in w)}")

P("")
P("Armature matrix_world:")
P(f"  {[[round(v,4) for v in r] for r in arm.matrix_world]}")

P("")
P("=" * 60)
P("SKEW / MESH TRANSFORMS")
P("=" * 60)
for ob in bpy.data.objects:
    if ob.type == 'MESH':
        P(f"  {ob.name:24s} parent={ob.parent.name if ob.parent else '-'} "
          f"mat_world_t={[round(v,4) for v in ob.matrix_world.translation]}")

print("\n".join(lines))
