"""
Replace the 'headbutt' clip in the fighter GLBs with the action-Kick FBX.

The HEAD attack on /fight/game/ becomes a real kick: the headbutt clip is
removed from both fighters and the Mixamo kick action is appended as a new
'kick' clip (the man GLB's old kick clip is replaced by this exact FBX so
both fighters use the same take).

Usage:
  Blender -b -P build/swap_headbutt_kick.py -- \
      --fbx /Users/justrun/project/boxing-game/package/animation/attack/action-Kick.fbx
"""
import bpy
import sys
import os

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []


def arg(name, default=None):
    return argv[argv.index(name) + 1] if name in argv else default


FBX = arg("--fbx", "/Users/justrun/project/boxing-game/package/animation/attack/action-Kick.fbx")
GLBS = [
    "web/media/glb/boxer-woman.glb",  # man was already re-exported successfully
]
FPS = 30

bpy.context.scene.render.fps = FPS
bpy.context.scene.render.fps_base = 1.0

for GLB in GLBS:
    bpy.ops.wm.read_homefile(use_empty=True)
    bpy.context.scene.render.fps = FPS
    bpy.context.scene.render.fps_base = 1.0
    bpy.ops.import_scene.gltf(filepath=GLB)

    rig = bpy.data.objects.get("rig")
    assert rig and rig.type == "ARMATURE", f"{GLB}: rig armature not found"
    meshes = [o for o in bpy.data.objects if o.type == "MESH"]
    print(f"[swap] {GLB}: bones={len(rig.data.bones)} meshes={[m.name for m in meshes]} actions={sorted(bpy.data.actions.keys())}")

    # drop the headbutt clip (and any old kick take on the man) — action + NLA track
    for name in ("headbutt", "kick"):
        act = bpy.data.actions.get(name)
        if act:
            bpy.data.actions.remove(act)
        ad = rig.animation_data
        if ad:
            for track in list(ad.nla_tracks):
                if track.name == name or (track.strips and track.strips[0] and track.strips[0].action is None and track.name == name):
                    ad.nla_tracks.remove(track)
    print(f"[swap] {GLB}: dropped headbutt/kick, left={sorted(bpy.data.actions.keys())}")

    # import the kick FBX
    before = set(bpy.data.actions.keys())
    bpy.ops.import_scene.fbx(filepath=FBX)
    new_actions = [bpy.data.actions[n] for n in bpy.data.actions.keys() if n not in before]
    assert new_actions, f"{GLB}: no action in FBX"
    act = new_actions[0]
    act.name = "kick"
    act.use_fake_user = True
    print(f"[swap] {GLB}: kick frames={tuple(act.frame_range)} dur={(act.frame_range[1]-act.frame_range[0])/FPS:.3f}s")

    # the FBX importer may switch the scene fps; pull the keyframes back to 30
    fps_after = bpy.context.scene.render.fps
    k = FPS / fps_after
    fcs = act.fcurves if not act.is_action_layered else act.layers[0].strips[0].channelbags[0].fcurves
    if abs(k - 1.0) > 1e-6:
        for f in fcs:
            for kp in f.keyframe_points:
                kp.co.x *= k
                kp.handle_left.x *= k
                kp.handle_right.x *= k
            f.update()
        bpy.context.scene.render.fps = FPS
        print(f"[swap] {GLB}: retimed {fps_after}fps -> {FPS}fps (x{k:.3f})")
    bad = [f.data_path for f in fcs if not f.data_path.startswith('pose.bones["mixamorig:')]
    print(f"[swap] {GLB}: fcurves={len(fcs)} non-rig paths={len(bad)} {bad[:3]}")
    assert not bad, f"{GLB}: kick action is not on the mixamorig rig"

    # drop the throw-away FBX armature, keep only the action
    for o in list(bpy.data.objects):
        if o.type == "ARMATURE" and o is not rig:
            bpy.data.objects.remove(o, do_unlink=True)

    # bind the action to the fighter rig on a muted NLA track, like the other clips
    ad = rig.animation_data or rig.animation_data_create()
    ad.action = act
    if hasattr(ad, "action_slot") and act.slots:
        ad.action_slot = act.slots[0]
    track = ad.nla_tracks.new()
    track.name = "kick"
    strip = track.strips.new("kick", int(act.frame_range[0]), act)
    strip.name = "kick"
    track.mute = True
    idle = bpy.data.actions.get("idle")
    ad.action = idle
    if hasattr(ad, "action_slot") and idle and idle.slots:
        ad.action_slot = idle.slots[0]

    bpy.ops.object.select_all(action="DESELECT")
    rig.select_set(True)
    for m in meshes:
        m.select_set(True)
    bpy.context.view_layer.objects.active = rig

    out = GLB  # in place
    bpy.ops.export_scene.gltf(
        filepath=out,
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
    print(f"[swap] wrote {out} size={os.path.getsize(out)/1024:.0f} KB")

print("[swap] done")
