"""
Build the two fighter GLBs for the "boxing vs kickboxing" training page.

Source: /Users/justrun/project/boxing-game/boxing vs kickboxing/
  character-rig/man.fbx, woman.fbx (Mixamo rigs + skin + textures)
  animation/*.fbx   (Mixamo clips on the standard mixamorig skeleton)

Every clip lives in its own FBX, so the flow is: import the character rig,
then for each animation FBX import it, grab its action, retime to 30 fps if
the importer changed the scene rate, rename, hang it on a muted NLA track of
the character rig and throw the temp armature away. Export with
export_animation_mode='ACTIONS' so each action becomes its own glTF clip.

Usage:
  Blender -b -P build/bvk_build_glb.py
"""
import bpy
import os

SRC = "/Users/justrun/project/boxing-game/boxing vs kickboxing"
OUT_DIR = "/Users/justrun/project/boxing-3/web/training/boxing-vs-kickboxing/models"
os.makedirs(OUT_DIR, exist_ok=True)

FIGHTERS = [
    {
        "rig": os.path.join(SRC, "character-rig/man.fbx"),
        "out": os.path.join(OUT_DIR, "boxer-man.glb"),
        "clips": [
            ("animation/action-guard.fbx", "guard"),
            ("animation/action-Block.fbx", "block"),
            ("animation/Step Backward.fbx", "step-backward"),
            ("animation/Long Step Forward.fbx", "step-forward"),
            ("animation/action-combo1-jab-cross.fbx", "jab-cross"),
            ("animation/left Uppercut.fbx", "uppercut"),
        ],
    },
    {
        "rig": os.path.join(SRC, "character-rig/woman.fbx"),
        "out": os.path.join(OUT_DIR, "kick-woman.glb"),
        "clips": [
            ("animation/action-guard.fbx", "guard"),
            ("animation/Roundhouse Kick.fbx", "roundhouse-kick"),
            ("animation/Flying Kick.fbx", "flying-kick"),
            ("animation/Receiving An Uppercut.fbx", "hit-uppercut"),
            ("animation/action-Knocked Out.fbx", "knock-out"),
        ],
    },
]

FPS = 30.0


def fcurves(a):
    return a.fcurves if not a.is_action_layered else a.layers[0].strips[0].channelbags[0].fcurves


def retimed_to_fps(act):
    fps_after = bpy.context.scene.render.fps
    k = FPS / fps_after
    if abs(k - 1.0) > 1e-6:
        for f in fcurves(act):
            for kp in f.keyframe_points:
                kp.co.x *= k
                kp.handle_left.x *= k
                kp.handle_right.x *= k
            f.update()
        bpy.context.scene.render.fps = FPS
        print(f"    retimed {fps_after}fps -> {FPS}fps (x{k:.3f})")


def strip_horizontal_root(act):
    """
    Drop the hips' horizontal location fcurves (channels 0 and 2 — lateral and
    forward/back in the Hips bone's local space) so every clip plays in place.
    Channel 1 (vertical) stays: it carries the flying-kick jump arc and the
    KO fall. Positioning between the fighters is done in JS instead.
    """
    fcs = fcurves(act)
    dropped = 0
    for f in list(fcs):
        if f.data_path == 'pose.bones["mixamorig:Hips"].location' and f.array_index in (0, 2):
            if act.is_action_layered:
                act.layers[0].strips[0].channelbags[0].fcurves.remove(f)
            else:
                act.fcurves.remove(f)
            dropped += 1
    if dropped:
        print(f"    stripped {dropped} horizontal hips location channels")


def hips_motion(act):
    """Report hips location range — tells us whether the clip moves the root."""
    for f in fcurves(act):
        if f.data_path == 'pose.bones["mixamorig:Hips"].location':
            lo = min(kp.co.y for kp in f.keyframe_points)
            hi = max(kp.co.y for kp in f.keyframe_points)
            return f"{f.array_index}: {lo:.3f}..{hi:.3f}"
    return "no hips location fcurve"


for spec in FIGHTERS:
    print(f"\n=== {os.path.basename(spec['out'])} ===")
    bpy.ops.wm.read_homefile(use_empty=True)
    bpy.context.scene.render.fps = int(FPS)
    bpy.context.scene.render.fps_base = 1.0
    bpy.ops.import_scene.fbx(filepath=spec["rig"])

    rig = next(o for o in bpy.data.objects if o.type == "ARMATURE")
    print(f"  rig={rig.name} bones={len(rig.data.bones)} scale={tuple(round(s, 4) for s in rig.scale)}")
    meshes = [o for o in bpy.data.objects if o.type == "MESH"]
    print(f"  meshes={[(m.name, len(m.data.vertices)) for m in meshes]}")

    for rel, name in spec["clips"]:
        before = set(bpy.data.actions.keys())
        bpy.ops.import_scene.fbx(filepath=os.path.join(SRC, rel))
        new = [bpy.data.actions[n] for n in bpy.data.actions.keys() if n not in before]
        assert new, f"no action in {rel}"
        act = new[0]
        retimed_to_fps(act)
        strip_horizontal_root(act)
        act.name = name
        act.use_fake_user = True
        fr = act.frame_range
        dur = (fr[1] - fr[0]) / bpy.context.scene.render.fps
        print(f"  clip {name:14s} frames={fr[0]:.0f}..{fr[1]:.0f} dur={dur:.2f}s hips[{hips_motion(act)}]")
        bad = [f.data_path for f in fcurves(act) if not f.data_path.startswith('pose.bones["mixamorig:')]
        if bad:
            print(f"    WARN non-rig paths: {bad[:3]}")

        # throw away the temp armature, keep the rig's meshes intact
        for o in list(bpy.data.objects):
            if o.type == "ARMATURE" and o is not rig:
                bpy.data.objects.remove(o, do_unlink=True)

        ad = rig.animation_data or rig.animation_data_create()
        ad.action = act
        track = ad.nla_tracks.new()
        track.name = name
        strip = track.strips.new(name, int(fr[0]), act)
        strip.name = name
        track.mute = True
        ad.action = None

    bpy.ops.object.select_all(action="DESELECT")
    rig.select_set(True)
    for m in meshes:
        m.select_set(True)
    bpy.context.view_layer.objects.active = rig

    bpy.ops.export_scene.gltf(
        filepath=spec["out"],
        export_format="GLB",
        use_selection=True,
        export_apply=True,
        export_animations=True,
        export_animation_mode="ACTIONS",
        export_skins=True,
        export_morph=False,
        export_yup=True,
        export_image_format="AUTO",
    )
    print(f"  wrote {spec['out']} size={os.path.getsize(spec['out']) / 1024:.0f} KB")

print("\nDONE")
