"""Render the cross impact frame (right-arm close-up) from two GLBs, Workbench.

usage:
  Blender -b -P build/render_cross_cmp.py
"""
import bpy
import os
import sys
from mathutils import Vector

FILES = [("before", "/tmp/cross_before_true.glb"), ("after", "/tmp/cross_arm.glb")]
CLIP = "cross"
F = 21
OUT = "/tmp/armcmp"
os.makedirs(OUT, exist_ok=True)


def render(path, tag):
    bpy.ops.wm.read_homefile(use_empty=True)
    bpy.context.scene.render.fps = 30
    bpy.ops.import_scene.gltf(filepath=path)
    rig = bpy.data.objects["rig"]
    ad = rig.animation_data or rig.animation_data_create()
    act = bpy.data.actions[CLIP]
    ad.action = act
    if hasattr(ad, "action_slot") and act.slots:
        ad.action_slot = act.slots[0]
    bpy.context.scene.frame_set(F)
    bpy.context.view_layer.update()

    pb = rig.pose.bones
    s = (rig.matrix_world @ pb["mixamorig:RightArm"].matrix).translation
    w = (rig.matrix_world @ pb["mixamorig:RightHand"].matrix).translation
    mid = (s + w) / 2
    print("[r] mid", [round(v, 3) for v in mid])

    scene = bpy.context.scene
    cam_data = bpy.data.cameras.new("cam")
    cam_data.type = "ORTHO"
    cam_data.ortho_scale = 0.55
    cam = bpy.data.objects.new("cam", cam_data)
    scene.collection.objects.link(cam)
    target = bpy.data.objects.new("cam_target", None)
    scene.collection.objects.link(target)
    target.location = mid
    con = cam.constraints.new("TRACK_TO")
    con.target = target
    con.track_axis = "TRACK_NEGATIVE_Z"
    con.up_axis = "UP_Y"
    scene.camera = cam

    def shoot(name, offset):
        cam.location = Vector(mid) + Vector(offset)
        scene.render.filepath = f"{OUT}/{name}.png"
        scene.render.resolution_x = 560
        scene.render.resolution_y = 560
        bpy.ops.render.render(write_still=True)
        print("[r] wrote", scene.render.filepath)

    scene.render.engine = "BLENDER_WORKBENCH"
    scene.display.shading.light = "STUDIO"
    scene.display.shading.color_type = "MATERIAL"
    scene.display.render_aa = "8"

    # fighter faces roughly -Y; side view from +X, three-quarter from front-right
    shoot(f"cmp_{tag}_side", (1.3, 0, 0))
    shoot(f"cmp_{tag}_q34", (0.9, -0.9, 0.35))


for tag, path in FILES:
    render(path, tag)
print("[r] done")
