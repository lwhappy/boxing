"""
Build the two fighter GLBs for the "benefits of boxing & kickboxing" page.

Source: /tmp/bbzip/boxing benefit/   (contents of boxing benefit.zip)
  character-rig/man.fbx, woman.fbx — Tripo/Mixamo rigs (0.01 unit scale, 33 bones,
  skinned mesh + texture)
  Punching-jab-action.fbx / Punching-across-action.fbx / Mma Kick.fbx /
  Flying Kick.fbx / action-guard.fbx / action-Knocked Out.fbx

Every clip lives in its own FBX, so: import the character rig, import each
animation FBX, keep its action (retimed to 30 fps), hang it on a muted NLA
track of the character rig, drop the temp armature, export with
export_animation_mode='ACTIONS' so each action becomes its own glTF clip.

Usage:
  Blender -b -P build/build_benefit_glb.py
"""
import bpy
import os

SRC = "/tmp/bbzip/boxing benefit"
OUT_DIR = "/Users/justrun/project/boxing-3/web/training/benefits-of-boxing/models"
os.makedirs(OUT_DIR, exist_ok=True)

FIGHTERS = [
    {
        "rig": os.path.join(SRC, "character-rig/woman.fbx"),
        "out": os.path.join(OUT_DIR, "woman.glb"),
        "clips": [
            ("action-guard.fbx", "guard"),
            ("Punching-jab-action.fbx", "jab"),
            ("Punching-across-action.fbx", "cross"),
            ("Mma Kick.fbx", "kick"),
            ("Flying Kick.fbx", "flying-kick"),
        ],
    },
    {
        "rig": os.path.join(SRC, "character-rig/man.fbx"),
        "out": os.path.join(OUT_DIR, "man.glb"),
        "clips": [
            ("action-guard.fbx", "guard"),
            ("action-Knocked Out.fbx", "knocked-out"),
        ],
    },
]

FPS = 30.0


def fcurves(a):
    if a.is_action_layered:
        return a.layers[0].strips[0].channelbags[0].fcurves
    return a.fcurves


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
    """Drop the hips' horizontal location channels so every clip plays in
    place; channel 1 (vertical) keeps the flying-kick arc and the KO fall."""
    dropped = 0
    for f in list(fcurves(act)):
        if f.data_path == 'pose.bones["mixamorig:Hips"].location' and f.array_index in (0, 2):
            if act.is_action_layered:
                act.layers[0].strips[0].channelbags[0].fcurves.remove(f)
            else:
                act.fcurves.remove(f)
            dropped += 1
    if dropped:
        print(f"    stripped {dropped} horizontal hips channels")


for spec in FIGHTERS:
    print(f"\n=== {os.path.basename(spec['out'])} ===")
    bpy.ops.wm.read_homefile(use_empty=True)
    bpy.context.scene.render.fps = int(FPS)
    bpy.context.scene.render.fps_base = 1.0
    bpy.ops.import_scene.fbx(filepath=spec["rig"])

    rig = next(o for o in bpy.data.objects if o.type == "ARMATURE")
    meshes = [o for o in bpy.data.objects if o.type == "MESH"]
    print(f"  rig={rig.name} bones={len(rig.data.bones)} meshes={[(m.name, len(m.data.vertices)) for m in meshes]}")

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
        print(f"  clip {name:12s} frames={fr[0]:.0f}..{fr[1]:.0f} dur={(fr[1]-fr[0])/FPS:.2f}s")

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
