"""
打印场景里所有 NLA strip 的位置信息（Blender 5.x）

用途：把 Blender 里摆好的 sound strip 位置换算成「相对某个动画条起点」的秒数，
供 three.js 页面按动画时间点触发音效。

用法：Blender -> Scripting 工作区 -> Open 选中本文件 -> Run Script
输出：控制台里一行 NLA_DUMP {...} 的 JSON，整行复制发给 AI 即可。
"""

import bpy
import json

out = {
    "fps": bpy.context.scene.render.fps,
    "strips": [],
    "actions": [],
}

for obj in bpy.data.objects:
    ad = getattr(obj, "animation_data", None)
    if not ad:
        continue
    for track in ad.nla_tracks:
        for s in track.strips:
            entry = {
                "object": obj.name,
                "obj_type": obj.type,
                "track": track.name,
                "strip": s.name,
                "kind": s.type,
                "start": round(s.frame_start, 2),
                "end": round(s.frame_end, 2),
            }
            if s.type == "CLIP":
                entry["action"] = s.action.name if s.action else None
                if s.action:
                    entry["action_frame_start"] = round(s.action_frame_start, 2)
            elif s.type == "SOUND":
                entry["sound"] = s.sound.name if s.sound else None
                entry["file"] = s.sound.filepath if s.sound else None
                entry["volume"] = round(getattr(s, "volume", 1.0), 3)
            out["strips"].append(entry)

for a in bpy.data.actions:
    fr = a.frame_range
    out["actions"].append({
        "name": a.name,
        "frame_start": round(fr[0], 2),
        "frame_end": round(fr[1], 2),
    })

print("NLA_DUMP " + json.dumps(out, ensure_ascii=False))
print("=== 把上面这一整行 NLA_DUMP 开头的 JSON 复制发给 AI ===")
