"""Print bone list + vertex-group list of a Mixamo FBX, and the thumb-related gaps.

usage: Blender -b -P build/vgroups.py -- --fbx path.fbx
"""
import bpy
import sys

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
path = argv[argv.index("--fbx") + 1]

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.fbx(filepath=path)

arm = [o for o in bpy.data.objects if o.type == "ARMATURE"][0]
mesh = [o for o in bpy.data.objects if o.type == "MESH"][0]
bones = [b.name.split(":")[-1] for b in arm.data.bones]
groups = [g.name.split(":")[-1] for g in mesh.vertex_groups]

print("BONES", len(bones))
print("VGROUPS", len(groups))
print("BONE_ONLY", sorted(set(bones) - set(groups)))
print("GROUP_ONLY", sorted(set(groups) - set(bones)))
print("THUMB_BONES", [b for b in bones if "Thumb" in b])
print("INDEX_BONES", [b for b in bones if "Index" in b])
print("HAS_THUMB_GROUP", [g for g in groups if "Thumb" in g])

# how strongly the fingers are weighted: max weight per finger group
import statistics
for name in sorted(set(bones) & set(groups)):
    if "Hand" not in name:
        continue
    idx = mesh.vertex_groups[name].index
    ws = []
    for v in mesh.data.vertices:
        for ge in v.groups:
            if ge.group == idx:
                ws.append(ge.weight)
    print("WG", name, "verts", len(ws), "max", round(max(ws), 3) if ws else 0)
print("===END===")
