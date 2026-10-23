"""Compare a Mixamo FBX action against the working .blend's black rig.

Checks:
  1. bone set + rest (matrix_local) difference between FBX armature and blend Armature
  2. max per-channel difference between the FBX action and an existing action

usage:
  Blender -b -P build/compare_fbx_action.py -- --blend resources/Untitled.blend \
      --fbx "path.fbx" --action black-idle-arm-open
"""
import bpy
import sys
import json
from mathutils import Matrix

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []


def arg(name, default=None):
    return argv[argv.index(name) + 1] if name in argv else default


blend_path = arg("--blend", "resources/Untitled.blend")
fbx_path = arg("--fbx")
ref_action_name = arg("--action")

bpy.ops.wm.open_mainfile(filepath=blend_path)

black = bpy.data.objects["Armature"]
rest_black = {b.name: b.matrix_local.copy() for b in black.data.bones}

existing = list(bpy.data.actions)
print("EXISTING ACTIONS:", [a.name for a in existing])

bpy.ops.import_scene.fbx(filepath=fbx_path)
new_arms = [o for o in bpy.context.selected_objects if o.type == "ARMATURE"]
if not new_arms:
    new_arms = [o for o in bpy.data.objects if o.type == "ARMATURE" and o.name not in ("Armature", "Armature.001")]
fb = new_arms[0]
print("FBX ARMATURE:", fb.name, "bones", len(fb.data.bones), "scale", tuple(round(v, 5) for v in fb.scale))

fbx_bones = [b.name for b in fb.data.bones]
print("SAME_BONE_SET:", set(fbx_bones) == set(rest_black.keys()))

worst = []
for name, m in rest_black.items():
    b = fb.data.bones.get(name)
    if not b:
        worst.append((name, "MISSING", 0, 0))
        continue
    d = (m.translation - b.matrix_local.translation).length
    rq = m.to_quaternion().rotation_difference(b.matrix_local.to_quaternion())
    worst.append((name, "ok", round(d, 6), round(rq.angle * 57.2958, 3)))
worst.sort(key=lambda x: -x[2])
print("REST_TRANS_MAX:", worst[:5])
print("REST_ROT_MAX:", sorted(worst, key=lambda x: -x[3])[:5])

new_actions = [a for a in bpy.data.actions if a not in existing]
print("NEW ACTIONS:", [(a.name, [round(v, 1) for v in a.frame_range]) for a in new_actions])

def curves_of(action):
    out = {}
    try:
        for layer in action.layers:
            for strip in layer.strips:
                for bag in strip.channelbags:
                    for fc in bag.fcurves:
                        out[(fc.data_path, fc.array_index)] = fc
    except Exception as e:
        print("curve read error", e)
    return out


if new_actions and ref_action_name and bpy.data.actions.get(ref_action_name):
    a_new = new_actions[0]
    a_ref = bpy.data.actions[ref_action_name]
    cn, cr = curves_of(a_new), curves_of(a_ref)
    print("CURVES new/ref:", len(cn), len(cr))
    common = set(cn) & set(cr)
    print("COMMON CURVES:", len(common))
    maxdiff = 0.0
    where = None
    for k in common:
        fa, fb_ = cn[k], cr[k]
        for f in (1, 10, 20, 30, 40, 50, 60, 67):
            va, vb = fa.evaluate(f), fb_.evaluate(f)
            d = abs(va - vb)
            if d > maxdiff:
                maxdiff, where = d, (k, f, round(va, 4), round(vb, 4))
    print("MAX_CHANNEL_DIFF:", round(maxdiff, 6), "at", where)

print("===DONE===")
