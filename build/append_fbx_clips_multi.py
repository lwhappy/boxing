"""Append one or more Mixamo FBX actions to a GLB that already holds clips.

Used for the combo stage: the shared man-combos.glb keeps every combo clip, and
new takes (e.g. the four-punch jab-cross take, a lead uppercut) are appended as
extra named clips so the page can chain them.

Usage:
  Blender -b -P build/append_fbx_clips_multi.py -- \
      --glb web/media/glb/man-combos.glb --out /tmp/man-combos.new.glb \
      --clip "jab_cross_x2=/path/action-combo1-jab-cross.fbx" \
      --clip "lead_uppercut=/path/Boxing - Boxing Lead Hand Uppercut.fbx"
"""
import bpy
import sys
import os

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []


def arg(name, default=None):
    return argv[argv.index(name) + 1] if name in argv else default


GLB = arg("--glb", "web/media/glb/man-combos.glb")
OUT = arg("--out", "/tmp/man-combos.out.glb")
SPECS = []
for i, a in enumerate(argv):
    if a == "--clip":
        name, path = argv[i + 1].split("=", 1)
        SPECS.append((name, path))

assert SPECS, "no --clip name=path given"

bpy.ops.wm.read_homefile(use_empty=True)
FPS = 30
bpy.context.scene.render.fps = FPS
bpy.context.scene.render.fps_base = 1.0
bpy.ops.import_scene.gltf(filepath=GLB)

rig = None
for o in bpy.data.objects:
    if o.type == "ARMATURE" and rig is None:
        rig = o
assert rig, "no armature in GLB"

# the GLB also carries a stray 42-vertex "Icosphere" helper — the skinned body
# is the mesh with the most vertices whose armature modifier points at the rig
mesh = None
best = -1
for o in bpy.data.objects:
    if o.type != "MESH":
        continue
    if o.parent is not rig and not any(m.type == "ARMATURE" and m.object is rig for m in o.modifiers):
        continue
    n = len(o.data.vertices)
    if n > best:
        best, mesh = n, o
assert mesh, "no skinned mesh bound to the rig"
print(f"[append] rig={rig.name} bones={len(rig.data.bones)} mesh={mesh.name if mesh else None}")
print(f"[append] existing actions: {sorted(bpy.data.actions.keys())}")
ad = rig.animation_data
print(f"[append] nla tracks: {[t.name for t in ad.nla_tracks] if ad else None} active={ad.action.name if ad and ad.action else None}")


def fcurves_of(a):
    return a.fcurves if not a.is_action_layered else a.layers[0].strips[0].channelbags[0].fcurves


for NAME, FBX in SPECS:
    before = set(bpy.data.actions.keys())
    objs_before = set(bpy.data.objects)
    bpy.ops.import_scene.fbx(filepath=FBX)
    new_actions = [bpy.data.actions[n] for n in bpy.data.actions.keys() if n not in before]
    assert new_actions, f"no action imported from {FBX}"
    act = new_actions[0]
    act.name = NAME
    act.use_fake_user = True

    # the FBX importer can switch the scene frame rate; pull the keys back
    fps_after = bpy.context.scene.render.fps
    k = FPS / fps_after
    if abs(k - 1.0) > 1e-6:
        for f in fcurves_of(act):
            for kp in f.keyframe_points:
                kp.co.x *= k
                kp.handle_left.x *= k
                kp.handle_right.x *= k
            f.update()
        bpy.context.scene.render.fps = FPS
    fr = act.frame_range
    print(f"[append] {NAME}: frames={tuple(round(x, 1) for x in fr)} dur={(fr[1] - fr[0]) / FPS:.2f}s fps={bpy.context.scene.render.fps}")

    # drop the throw-away FBX armature + its meshes, keep only the action
    for o in list(bpy.data.objects):
        if o in objs_before or o is rig or o is mesh:
            continue
        bpy.data.objects.remove(o, do_unlink=True)

    ad = rig.animation_data or rig.animation_data_create()
    ad.action = act
    if hasattr(ad, "action_slot") and act.slots:
        ad.action_slot = act.slots[0]

    track = ad.nla_tracks.new()
    track.name = NAME
    strip = track.strips.new(NAME, int(fr[0]), act)
    strip.name = NAME
    track.mute = True

# leave a neutral action active so the exporter does not treat one clip special
first = bpy.data.actions[sorted(bpy.data.actions.keys())[0]]
if ad:
    ad.action = first
    if hasattr(ad, "action_slot") and first.slots:
        ad.action_slot = first.slots[0]

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
print(f"[append] wrote {OUT} size={os.path.getsize(OUT) / 1024 / 1024:.1f} MB")
