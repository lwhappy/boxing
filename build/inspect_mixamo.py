"""Inspect a Mixamo FBX or the working .blend: armatures, bones, actions, NLA.

usage:
  Blender -b -P build/inspect_mixamo.py -- --fbx path.fbx
  Blender -b -P build/inspect_mixamo.py -- --blend path.blend
"""
import bpy
import sys
import json

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []


def dump_scene(tag):
    out = {"tag": tag, "objects": [], "armatures": [], "actions": [], "nla": []}
    for ob in bpy.data.objects:
        row = {"name": ob.name, "type": ob.type, "parent": ob.parent.name if ob.parent else None}
        if ob.type == "MESH":
            row["verts"] = len(ob.data.vertices)
            row["vgroups"] = len(ob.vertex_groups)
        if ob.type == "ARMATURE":
            row["bones"] = len(ob.data.bones)
            row["bone_names"] = [b.name for b in ob.data.bones]
            row["scale"] = [round(v, 5) for v in ob.scale]
            if ob.animation_data:
                a = ob.animation_data.action
                row["active_action"] = a.name if a else None
                row["nla_tracks"] = [
                    {
                        "track": t.name,
                        "strips": [
                            {"name": s.name, "type": s.type, "action": getattr(s, "action", None).name if getattr(s, "action", None) else None,
                             "start": round(s.frame_start, 2), "end": round(s.frame_end, 2),
                             "action_start": round(s.action_frame_start, 2) if hasattr(s, "action_frame_start") else None,
                             "action_end": round(s.action_frame_end, 2) if hasattr(s, "action_frame_end") else None}
                            for s in t.strips
                        ],
                    }
                    for t in ob.animation_data.nla_tracks
                ]
        out["objects"].append(row)
    for a in bpy.data.actions:
        fr = a.frame_range
        n = 0
        try:
            for layer in a.layers:
                for strip in layer.strips:
                    for bag in strip.channelbags:
                        n += len(bag.fcurves)
        except Exception:
            pass
        out["actions"].append({"name": a.name, "frames": [round(fr[0], 2), round(fr[1], 2)], "fcurves": n})
    out["fps"] = bpy.context.scene.render.fps
    print("===JSON_BEGIN===")
    print(json.dumps(out, ensure_ascii=False))
    print("===JSON_END===")


if "--fbx" in argv:
    path = argv[argv.index("--fbx") + 1]
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.fbx(filepath=path)
    dump_scene("fbx:" + path)
elif "--blend" in argv:
    path = argv[argv.index("--blend") + 1]
    bpy.ops.wm.open_mainfile(filepath=path)
    dump_scene("blend:" + path)
