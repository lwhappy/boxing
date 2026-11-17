"""Quick report on a Mixamo FBX: fps, action name, frame range, bone names."""
import bpy
import sys

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
FBX = argv[0] if argv else "/Users/justrun/project/boxing-game/package/animation/attack/action-jab-straight.fbx"

bpy.ops.wm.read_homefile(use_empty=True)
print("[inspect] scene fps before:", bpy.context.scene.render.fps)
before = set(bpy.data.actions.keys())
bpy.ops.import_scene.fbx(filepath=FBX)
print("[inspect] scene fps after:", bpy.context.scene.render.fps, "/", bpy.context.scene.render.fps_base)

acts = [bpy.data.actions[n] for n in bpy.data.actions.keys() if n not in before]
for a in acts:
    fr = a.frame_range
    print(f"[inspect] action='{a.name}' frames={tuple(fr)} dur@30={(fr[1]-fr[0])/30:.3f}s dur@24={(fr[1]-fr[0])/24:.3f}s")
    fcs = a.fcurves if not a.is_action_layered else a.layers[0].strips[0].channelbags[0].fcurves
    paths = sorted({f.data_path for f in fcs})
    print(f"[inspect] fcurves={len(fcs)} bone_paths={len(paths)}")
    print("[inspect] sample:", paths[:4])
    roots = sorted({p.split('"')[1] for p in paths if 'pose.bones' in p})
    print(f"[inspect] bones={len(roots)}")
    print("[inspect] first bones:", roots[:6])
    # hips translation range tells us about root motion
    for f in fcs:
        if f.data_path.endswith('location') and 'Hips' in f.data_path:
            vals = [k.co[1] for k in f.keyframe_points]
            print(f"[inspect] {f.data_path}[{f.array_index}] min={min(vals):.3f} max={max(vals):.3f}")
    print("[inspect] keyframes:", int(fr[1] - fr[0]) + 1)

for o in bpy.data.objects:
    if o.type == "ARMATURE":
        print("[inspect] armature:", o.name, "bones:", len(o.data.bones), "rot:", tuple(round(v, 3) for v in o.rotation_euler), "scale:", tuple(round(v, 3) for v in o.scale))
        names = [b.name for b in o.data.bones]
        print("[inspect] bone naming sample:", names[:5])
