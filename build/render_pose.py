"""Render one pose of the working .blend with Workbench (fast, no lights needed).

usage:
  Blender -b -P build/render_pose.py -- --blend resources/Untitled-with-uppercut.blend \
      --frame 152 --out /tmp/pose.png --size 900
"""
import bpy
import sys
import os
from mathutils import Vector

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []


def arg(name, default=None):
    return argv[argv.index(name) + 1] if name in argv else default


blend_path = arg("--blend")
frame = int(arg("--frame", "152"))
out = arg("--out", "/tmp/pose.png")
size = int(arg("--size", "900"))

bpy.ops.wm.open_mainfile(filepath=blend_path)
scene = bpy.context.scene
scene.frame_set(frame)
bpy.context.view_layer.update()

# world bbox of every mesh
mn = Vector((1e9, 1e9, 1e9))
mx = Vector((-1e9, -1e9, -1e9))
for ob in bpy.data.objects:
    if ob.type != "MESH":
        continue
    for corner in ob.bound_box:
        p = ob.matrix_world @ Vector(corner)
        for i in range(3):
            mn[i] = min(mn[i], p[i])
            mx[i] = max(mx[i], p[i])
center = (mn + mx) / 2
span = (mx - mn)
print("BBOX", [round(v, 3) for v in mn], [round(v, 3) for v in mx], "center", [round(v, 3) for v in center])

cam_data = bpy.data.cameras.new("cam")
cam_data.type = "ORTHO"
cam_data.ortho_scale = max(span.x, span.z) * 1.15
cam = bpy.data.objects.new("cam", cam_data)
scene.collection.objects.link(cam)
cam.location = center + Vector((0, -4.0, 0))
target = bpy.data.objects.new("cam_target", None)
scene.collection.objects.link(target)
target.location = center
con = cam.constraints.new("TRACK_TO")
con.target = target
con.track_axis = "TRACK_NEGATIVE_Z"
con.up_axis = "UP_Y"
scene.camera = cam

scene.render.engine = "BLENDER_WORKBENCH"
scene.display.shading.light = "STUDIO"
scene.display.shading.color_type = "MATERIAL"
scene.display.shading.show_shadows = True
scene.display.render_aa = "8"
scene.render.resolution_x = size
scene.render.resolution_y = size
scene.render.film_transparent = False
scene.render.image_settings.file_format = "PNG"
scene.render.filepath = out

bpy.ops.render.render(write_still=True)
print("RENDERED", out, os.path.getsize(out) if os.path.exists(out) else "missing")
