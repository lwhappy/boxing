"""
Append one Mixamo FBX action to boxer-man.glb as a new named clip.

The fighter rig in boxer-man.glb is a standard 33-bone mixamorig rig, so an FBX
authored on the same skeleton can be dropped straight in: import the existing
GLB, import the FBX, keep only its action, rename it, hang it on an NLA track
next to the other clips and re-export every action as its own glTF animation.

Usage:
  Blender -b -P build/append_fbx_clip.py -- \
      --fbx /Users/justrun/Downloads/action-Kick.fbx --name kick \
      --glb web/media/glb/boxer-man.glb --out /tmp/boxer-man.kick.glb
"""
import bpy
import sys
import os

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []


def arg(name, default=None):
    return argv[argv.index(name) + 1] if name in argv else default


FBX = arg("--fbx", "/Users/justrun/Downloads/action-Kick.fbx")
NAME = arg("--name", "kick")
GLB = arg("--glb", "web/media/glb/boxer-man.glb")
OUT = arg("--out", "/tmp/boxer-man.out.glb")

bpy.ops.wm.read_homefile(use_empty=True)
# 30 fps keeps the round trip exact: the source clips are 30 fps data, and so
# is the FBX, so no clip gets re-quantised on the way back out
bpy.context.scene.render.fps = 30
bpy.context.scene.render.fps_base = 1.0
bpy.ops.import_scene.gltf(filepath=GLB)

rig = bpy.data.objects.get("rig")
assert rig and rig.type == "ARMATURE", "rig armature not found"
mesh = bpy.data.objects.get("tripo_node_89183709")
FPS = bpy.context.scene.render.fps
print(f"[append] scene fps={FPS} rig bones={len(rig.data.bones)} actions={len(bpy.data.actions)}")

before = set(bpy.data.actions.keys())
bpy.ops.import_scene.fbx(filepath=FBX)
new_actions = [bpy.data.actions[n] for n in bpy.data.actions.keys() if n not in before]
print(f"[append] imported actions: {[a.name for a in new_actions]}")
assert new_actions, "no action in FBX"
act = new_actions[0]
act.name = NAME
act.use_fake_user = True
print(f"[append] action frames={tuple(act.frame_range)} dur={(act.frame_range[1]-act.frame_range[0])/FPS:.3f}s")

# the FBX importer switches the scene frame rate to the file's own rate; that
# would re-time every existing clip on export, so pull the times back to FPS
fps_after = bpy.context.scene.render.fps
k = FPS / fps_after
if abs(k - 1.0) > 1e-6:
    for f in (act.fcurves if not act.is_action_layered else act.layers[0].strips[0].channelbags[0].fcurves):
        for kp in f.keyframe_points:
            kp.co.x *= k
            kp.handle_left.x *= k
            kp.handle_right.x *= k
        f.update()
    bpy.context.scene.render.fps = FPS
    print(f"[append] retimed {fps_after}fps -> {FPS}fps (x{k:.3f}), frames now {tuple(act.frame_range)}")

# drop the throw-away FBX armature, keep only the action
for o in list(bpy.data.objects):
    if o.type == "ARMATURE" and o is not rig:
        bpy.data.objects.remove(o, do_unlink=True)


def fcurves(a):
    return a.fcurves if not a.is_action_layered else a.layers[0].strips[0].channelbags[0].fcurves


fcs = fcurves(act)
bad = [f.data_path for f in fcs if not f.data_path.startswith('pose.bones["mixamorig:')]
print(f"[append] fcurves={len(fcs)} non-rig paths={len(bad)} {bad[:3]}")

# bind it to the fighter rig so the exporter sees it as part of the rig's clips
ad = rig.animation_data or rig.animation_data_create()
ad.action = act
if hasattr(ad, "action_slot") and act.slots:
    ad.action_slot = act.slots[0]

track = ad.nla_tracks.new()
track.name = NAME
strip = track.strips.new(NAME, int(act.frame_range[0]), act)
strip.name = NAME
track.mute = True
ad.action = bpy.data.actions["idle"]
if hasattr(ad, "action_slot") and bpy.data.actions["idle"].slots:
    ad.action_slot = bpy.data.actions["idle"].slots[0]

# re-export the whole fighter with every action
bpy.ops.object.select_all(action="DESELECT")
rig.select_set(True)
if mesh:
    mesh.select_set(True)
bpy.context.view_layer.objects.active = rig

bpy.ops.export_scene.gltf(
    filepath=OUT,
    export_format="GLB",
    use_selection=True,
    export_apply=False,
    export_animations=True,
    export_animation_mode="ACTIONS",
    export_nla_strips=False,
    export_bake_animation=False,
    export_skins=True,
    export_morph=False,
    export_yup=True,
    export_image_format="AUTO",
)
print(f"[append] wrote {OUT} size={os.path.getsize(OUT)/1024:.0f} KB")
