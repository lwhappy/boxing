# export_timeline_manifest.py
# 导出当前 .blend 的 NLA 条带 + Sequencer 音频条带时间信息为 JSON，
# 供 three.js 按时间轴编排动画与音效（glTF/GLB 本身不含这些数据）。
#
# 用法（命令行 headless）：
#   blender -b your.blend --python export_timeline_manifest.py -- \
#       --out /abs/path/timeline-manifest.json
#
# 也可以在 Blender Scripting 工作区直接运行（无 --out 参数时默认写到 blend 同目录）。

import bpy
import json
import os
import sys


def get_out_path():
    argv = sys.argv
    if "--" in argv:
        args = argv[argv.index("--") + 1:]
        for i, a in enumerate(args):
            if a == "--out" and i + 1 < len(args):
                return os.path.abspath(args[i + 1])
    base = bpy.data.filepath or "untitled.blend"
    return os.path.join(os.path.dirname(base),
                        os.path.splitext(os.path.basename(base))[0] + ".timeline.json")


def main():
    scene = bpy.context.scene
    fps = scene.render.fps / scene.render.fps_base
    manifest = {
        "blendFile": bpy.data.filepath,
        "fps": fps,
        "frameStart": scene.frame_start,
        "frameEnd": scene.frame_end,
        "durationSec": (scene.frame_end - scene.frame_start) / fps,
        "nla": [],   # NLA 动画条带
        "audio": [], # Sequencer 音频条带
    }

    # --- NLA strips（所有带动画数据的对象） ---
    for obj in bpy.data.objects:
        ad = obj.animation_data
        if not ad:
            continue
        for track in ad.nla_tracks:
            for strip in track.strips:
                if not strip.action:
                    continue
                manifest["nla"].append({
                    "object": obj.name,
                    "track": track.name,
                    "strip": strip.name,
                    "action": strip.action.name,
                    "frameStart": strip.frame_start,
                    "frameEnd": strip.frame_end,
                    "startSec": round(strip.frame_start / fps, 4),
                    "endSec": round(strip.frame_end / fps, 4),
                })

    # --- Sequencer sound strips ---
    if scene.sequence_editor:
        se = scene.sequence_editor
        # Blender 4.x+ 为 strips_all，旧版为 sequences_all
        all_strips = getattr(se, "strips_all", None) or getattr(se, "sequences_all", [])
        for strip in all_strips:
            if strip.type != 'SOUND':
                continue
            snd = strip.sound
            filepath = bpy.path.abspath(snd.filepath) if snd else ""
            manifest["audio"].append({
                "strip": strip.name,
                "file": os.path.basename(filepath),
                "fileAbs": filepath,
                "frameStart": strip.frame_start,                # 时间轴上的起始帧
                "frameFinalStart": strip.frame_final_start,     # 实际可见起始（含裁剪）
                "frameFinalEnd": strip.frame_final_end,
                "frameOffsetStart": strip.frame_offset_start,   # 音频被裁掉的头部帧数
                "startSec": round(strip.frame_final_start / fps, 4),
                "offsetSec": round(strip.frame_offset_start / fps, 4),
            })

    out = get_out_path()
    with open(out, "w", encoding="utf-8") as f:
        json.dump(manifest, f, ensure_ascii=False, indent=2)

    print(f"\n[export_timeline_manifest] wrote {out}")
    print(f"  NLA strips: {len(manifest['nla'])}, audio strips: {len(manifest['audio'])}")


main()
