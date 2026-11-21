"""Probe an FBX action: duration + hand-to-head geometry per frame.

Blender -b -P build/probe_action_fbx.py -- <fbx> [<fbx> ...]
"""
import bpy, sys, os

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []

for path in argv:
    bpy.ops.wm.read_homefile(use_empty=True)
    bpy.context.scene.render.fps = 30
    bpy.ops.import_scene.fbx(filepath=path)
    arms = [o for o in bpy.data.objects if o.type == "ARMATURE"]
    print("=" * 70)
    print("FILE", os.path.basename(path), "| armatures", len(arms))
    if not arms:
        continue
    arm = arms[0]
    actions = list(bpy.data.actions)
    print("bones", len(arm.data.bones), "| actions", [a.name for a in actions])
    act = arm.animation_data.action if arm.animation_data else None
    if act is None and actions:
        act = actions[0]
    if act is None:
        print("no action"); continue
    fr = act.frame_range
    fps = bpy.context.scene.render.fps
    print(f"action={act.name} frames={tuple(round(x,1) for x in fr)} dur={(fr[1]-fr[0])/fps:.2f}s fps={fps}")

    names = {b.name.replace("mixamorig:", "").replace("mixamorig", ""): b.name for b in arm.data.bones}
    def bn(k):
        for cand in (k, "mixamorig:" + k, "mixamorig" + k):
            if cand in arm.pose.bones:
                return cand
        return None

    hd, lh, rh = bn("Head"), bn("LeftHand"), bn("RightHand")
    hips = bn("Hips")
    if not (hd and lh and rh):
        print("missing bones", hd, lh, rh); continue
    scene = bpy.context.scene
    rows = []
    f0, f1 = int(fr[0]), int(fr[1])
    for f in range(f0, f1 + 1):
        scene.frame_set(f)
        pb = arm.pose.bones
        # armature-space positions
        head = arm.matrix_world @ pb[hd].head
        h_i = arm.matrix_world @ pb[hips].head
        l = arm.matrix_world @ pb[lh].head
        r = arm.matrix_world @ pb[rh].head
        rows.append((f, (l - h_i).length, (r - h_i).length, (l - head).length, (r - head).length))
    for row in rows[::3]:
        print(f"f{row[0]:4d} t={(row[0]-f0)/fps:5.2f} L-hips={row[1]:.2f} R-hips={row[2]:.2f} L-head={row[3]:.2f} R-head={row[4]:.2f}")
