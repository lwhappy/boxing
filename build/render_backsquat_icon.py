"""Render web/assets/img/sport/fig-backsquat.png — cream silhouette of the
back-squat pose (bottom of the rep, bar on shoulders), matching the moves icons (200x260 RGBA, transparent bg).

Loads the built sport-backsquat.glb, samples the push-up clip for the frame
with the lowest hips (bottom of the rep), and renders a flat workbench
silhouette with an orthographic side camera.
"""
import bpy
import os
import mathutils

GLB = "/Users/justrun/project/boxing-3/web/media/glb/sport-backsquat.glb"
OUT = "/Users/justrun/project/boxing-3/web/assets/img/sport/fig-backsquat.png"
CREAM = (0.898, 0.855, 0.741)  # matches moves icons

bpy.ops.wm.read_homefile(use_empty=True)
bpy.ops.import_scene.gltf(filepath=GLB)

rig = next(o for o in bpy.data.objects if o.type == "ARMATURE")
meshes = [o for o in bpy.data.objects if o.type == "MESH"]
ad = rig.animation_data
act = next((a for a in bpy.data.actions if "squat" in a.name.lower()), None) or \
    bpy.data.actions[-1]
print(f"[icon] action={act.name} range={tuple(act.frame_range)}")
ad.action = act

# pick the DEEPEST frame (lowest hips z) — the recognizable squat silhouette
hips = rig.pose.bones.get("Hips") or next(
    b for b in rig.pose.bones if "hips" in b.name.lower())
best_f, best_z = None, 1e9
for f in range(int(act.frame_range[0]), int(act.frame_range[1]) + 1):
    bpy.context.scene.frame_set(f)
    bpy.context.view_layer.update()
    z = hips.matrix.to_translation().z
    if z < best_z:
        best_z, best_f = z, f
print(f"[icon] deepest frame {best_f} hips z={best_z:.3f}")
bpy.context.scene.frame_set(best_f)
bpy.context.view_layer.update()

# frame the figure with an orthographic camera on the world +X side;
# everything in WORLD space (the rig carries a 0.01 object scale)
mins = [1e9] * 3
maxs = [-1e9] * 3
for o in bpy.data.objects:
    if o.type != "MESH":
        continue
    if "tripo" not in o.name.lower():
        o.hide_render = True
        continue
    deps = bpy.context.evaluated_depsgraph_get()
    oe = o.evaluated_get(deps)
    mw = oe.matrix_world
    me = oe.to_mesh()
    for v in me.vertices:
        p = mw @ v.co
        for i in range(3):
            mins[i] = min(mins[i], p[i])
            maxs[i] = max(maxs[i], p[i])
    oe.to_mesh_clear()
print(f"[icon] world bbox y={mins[1]:.3f}..{maxs[1]:.3f} z={mins[2]:.3f}..{maxs[2]:.3f}")

scene = bpy.context.scene
scene.render.engine = "BLENDER_WORKBENCH"
scene.display.shading.light = "FLAT"
scene.display.shading.color_type = "SINGLE"
scene.display.shading.single_color = CREAM
scene.render.film_transparent = True
scene.render.resolution_x = 200
scene.render.resolution_y = 260
scene.render.image_settings.file_format = "PNG"
scene.render.image_settings.color_mode = "RGBA"

# ortho camera looking down -X at the figure's side
cx = (mins[1] + maxs[1]) / 2
cz = (mins[2] + maxs[2]) / 2
size_x = maxs[1] - mins[1]  # body length (horizontal in pose)
size_z = maxs[2] - mins[2]
cam_data = bpy.data.cameras.new("icon_cam")
cam_data.type = "ORTHO"
span = max(size_x, size_z * 260 / 200) * 1.32
cam_data.ortho_scale = span
cam = bpy.data.objects.new("icon_cam", cam_data)
scene.collection.objects.link(cam)
cam.location = (maxs[0] + 5, cx, cz)
cam.rotation_euler = mathutils.Vector((-1, 0, 0)).to_track_quat("-Z", "Y").to_euler()
scene.camera = cam

# delete any lights/cameras that came with the GLB (workbench ignores lights,
# but keep the scene clean)
scene.world = bpy.data.worlds.new("w") if scene.world is None else scene.world

scene.render.filepath = OUT
bpy.ops.render.render(write_still=True)
print(f"[icon] wrote {OUT} size={os.path.getsize(OUT)}")
