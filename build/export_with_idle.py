"""Attach an existing action back onto the black rig's NLA and export a new .glb.

The working .blend has 5 actions but only 4 NLA strips, so `black-idle-arm-open`
never reaches the glb. This re-adds it as its own NLA track, saves a *copy* of
the blend, and exports a fresh glb (original files untouched).

usage:
  Blender -b -P build/export_with_idle.py -- \
      --blend resources/Untitled.blend --action black-idle-arm-open \
      --out-blend resources/Untitled-with-idle.blend --out-glb resources/glb/2.glb
"""
import bpy
import sys
import os

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []


def arg(name, default=None):
    return argv[argv.index(name) + 1] if name in argv else default


blend_path = arg("--blend", "resources/Untitled.blend")
action_name = arg("--action", "black-idle-arm-open")
out_blend = arg("--out-blend", "resources/Untitled-with-idle.blend")
out_glb = arg("--out-glb", "resources/glb/2.glb")

bpy.ops.wm.open_mainfile(filepath=blend_path)

black = bpy.data.objects["Armature"]
act = bpy.data.actions.get(action_name)
assert act, "action not found: " + action_name

ad = black.animation_data or black.animation_data_create()

# already there? drop the duplicate track first
for t in list(ad.nla_tracks):
    for s in list(t.strips):
        if s.action == act:
            t.strips.remove(s)
    if not t.strips:
        ad.nla_tracks.remove(t)

track = ad.nla_tracks.new()
track.name = action_name
strip = track.strips.new(action_name, int(act.frame_range[0]), act)
strip.name = action_name
strip.action_frame_start = act.frame_range[0]
strip.action_frame_end = act.frame_range[1]
strip.frame_start = 2.0
strip.frame_end = 2.0 + (act.frame_range[1] - act.frame_range[0])
strip.blend_type = "REPLACE"
print("TRACK", track.name, "strip", strip.frame_start, strip.frame_end,
      "action", strip.action_frame_start, strip.action_frame_end)

print("NLA now:", [(t.name, [(s.action.name, s.frame_start, s.frame_end) for s in t.strips]) for t in ad.nla_tracks])

bpy.ops.wm.save_as_mainfile(filepath=os.path.abspath(out_blend))
print("SAVED", out_blend)

os.makedirs(os.path.dirname(os.path.abspath(out_glb)), exist_ok=True)
bpy.ops.export_scene.gltf(
    filepath=os.path.abspath(out_glb),
    export_format="GLB",
    export_animations=True,
    export_animation_mode="ACTIONS",
    export_anim_single_armature=True,
    export_bake_animation=False,
    export_frame_range=False,
    export_force_sampling=True,
    export_optimize_animation_size=False,
    export_apply=False,
    export_yup=True,
    export_materials="EXPORT",
    export_skins=True,
)
print("EXPORTED", out_glb, os.path.getsize(out_glb))
