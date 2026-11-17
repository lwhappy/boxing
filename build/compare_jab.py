"""Compare the existing jab inside boxer-man.glb with the incoming FBX."""
import bpy

GLB = "/Users/justrun/project/boxing-3/web/media/glb/boxer-man.glb"
FBX = "/Users/justrun/project/boxing-game/package/animation/attack/action-jab-straight.fbx"

bpy.ops.wm.read_homefile(use_empty=True)
bpy.context.scene.render.fps = 30
bpy.ops.import_scene.gltf(filepath=GLB)


def fcs(a):
    return a.fcurves if not a.is_action_layered else a.layers[0].strips[0].channelbags[0].fcurves


def report(tag, a):
    f = fcs(a)
    paths = sorted({x.data_path for x in f})
    objlvl = [p for p in paths if not p.startswith("pose.bones")]
    fr = a.frame_range
    print(f"[cmp] {tag} '{a.name}' frames={tuple(round(v,1) for v in fr)} fcurves={len(f)} objlevel={objlvl}")
    for x in f:
        if x.data_path.endswith('.location') and '"Hips"' in x.data_path:
            v = [k.co[1] for k in x.keyframe_points]
            print(f"[cmp]   Hips.loc[{x.array_index}] {min(v):.2f}..{max(v):.2f}")


print("[cmp] actions:", [a.name for a in bpy.data.actions])
for name in ("jab", "idle", "kick"):
    a = bpy.data.actions.get(name)
    if a:
        report("GLB", a)

rig = bpy.data.objects.get("rig")
print("[cmp] rig scale:", tuple(round(v, 4) for v in rig.scale), "loc:", tuple(round(v, 3) for v in rig.location))
print("[cmp] rig bones:", len(rig.data.bones))
hip = rig.data.bones.get("mixamorig:Hips")
print("[cmp] hips head_local:", tuple(round(v, 4) for v in hip.head_local))

# incoming
before = set(bpy.data.actions.keys())
bpy.ops.import_scene.fbx(filepath=FBX)
new = [bpy.data.actions[n] for n in bpy.data.actions.keys() if n not in before]
for a in new:
    report("FBX", a)
for o in bpy.data.objects:
    if o.type == "ARMATURE" and o is not rig:
        print("[cmp] fbx armature:", o.name, "scale:", tuple(round(v, 4) for v in o.scale), "rot:", tuple(round(v, 3) for v in o.rotation_euler))
        h = o.data.bones.get("mixamorig:Hips")
        if h:
            print("[cmp] fbx hips head_local:", tuple(round(v, 4) for v in h.head_local))
