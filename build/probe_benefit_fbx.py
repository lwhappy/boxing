"""Quick inspection of the 'boxing benefit' FBX pack: rigs + clips."""
import bpy
import os
import sys

SRC = "/tmp/bbzip/boxing benefit"

def clear():
    bpy.ops.wm.read_homefile(use_empty=True)


def report(path, label):
    clear()
    bpy.context.scene.render.fps = 30
    try:
        bpy.ops.import_scene.fbx(filepath=path)
    except Exception as e:
        print(f"{label}: IMPORT FAILED {e}")
        return
    rigs = [o for o in bpy.data.objects if o.type == "ARMATURE"]
    meshes = [o for o in bpy.data.objects if o.type == "MESH"]
    print(f"\n--- {label} ({os.path.basename(path)}, {os.path.getsize(path)/1024/1024:.1f} MB) ---")
    for r in rigs:
        print(f"  rig {r.name} bones={len(r.data.bones)} scale={tuple(round(s,3) for s in r.scale)}")
        names = [b.name for b in r.data.bones]
        print(f"  bones[0:6]={names[:6]}")
        print(f"  has hips={'mixamorig:Hips' in names or any('Hips' in n for n in names)}")
    for m in meshes:
        print(f"  mesh {m.name} verts={len(m.data.vertices)} mods={[md.type for md in m.modifiers]} mats={[ms.name for ms in m.data.materials][:4]}")
    acts = list(bpy.data.actions)
    for a in acts[:3]:
        fr = a.frame_range
        print(f"  action {a.name} frames={fr[0]:.0f}..{fr[1]:.0f} ({(fr[1]-fr[0])/30:.2f}s)")


for f in ["character-rig/woman.fbx", "character-rig/man.fbx"]:
    report(os.path.join(SRC, f), "RIG")

for f in ["action-guard.fbx", "Punching-jab-action.fbx", "Punching-across-action.fbx",
          "Mma Kick.fbx", "Flying Kick.fbx", "action-Knocked Out.fbx"]:
    report(os.path.join(SRC, f), "CLIP")

print("\nDONE")
