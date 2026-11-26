"""Build web/media/glb/sport-backsquat.glb — the Tripo man + idle + back-squat clips (+ a modelled barbell).

Source rig:  /Users/justrun/project/boxing-game/sport/rig/man.fbx
             (Tripo "男运动健将" mesh, 25k verts, Mixamo 65-bone skeleton, 0.01 scale)
Clip donors: /Users/justrun/project/boxing-game/sport/rig/Idle.fbx
             /Users/justrun/project/boxing-game/sport/rig/Push Up.fbx

The donor FBX armatures ship in a DIFFERENT world orientation than the sculpt's
(sculpt Armature rot.x = +90°), so verbatim action copies play upside down —
the same rig-space mismatch the fight-man merge hit. Every donor action is
therefore RESAMPLED (build_jab_woman.py semantics): at each frame the donor
bone's armature-space matrix is mapped through M_map = M_sculpt⁻¹ · M_donor and
re-expressed in the sculpt bone's own parent frame — a true retarget.

Textures are rebuilt down to base-colour + normal at 2048 and exported as JPEG.

Usage: Blender -b -P build/build_sport_backsquat.py
"""
import bpy
import os
from mathutils import Matrix

RIG = "/Users/justrun/project/boxing-game/sport/rig/man.fbx"
CLIPS = [
    ("idle", "/Users/justrun/project/boxing-game/sport/rig/Idle.fbx"),
    ("back-squat", "/Users/justrun/Downloads/Back Squat.fbx"),
]
OUT = "/Users/justrun/project/boxing-3/web/media/glb/sport-backsquat.glb"
MAXTEX = 2048
FPS = 30.0


def fcurves(a):
    if a.is_action_layered:
        return a.layers[0].strips[0].channelbags[0].fcurves
    return a.fcurves


def retime(act):
    fps_after = bpy.context.scene.render.fps
    k = FPS / fps_after
    if abs(k - 1.0) > 1e-6:
        for f in fcurves(act):
            for kp in f.keyframe_points:
                kp.co.x *= k
                kp.handle_left.x *= k
                kp.handle_right.x *= k
            f.update()
        print(f"    retimed {fps_after} -> {FPS} fps")
    bpy.context.scene.render.fps = int(FPS)


bpy.ops.wm.read_homefile(use_empty=True)
bpy.context.scene.render.fps = int(FPS)
bpy.context.scene.render.fps_base = 1.0

# --- the character ---
bpy.ops.import_scene.fbx(filepath=RIG)
rig = next(o for o in bpy.data.objects if o.type == "ARMATURE")
mesh = next(o for o in bpy.data.objects if o.type == "MESH")
print(f"[sport] rig={rig.name} bones={len(rig.data.bones)} mesh={mesh.name} "
      f"verts={len(mesh.data.vertices)}")
print(f"[sport] sculpt armature euler={[round(v, 3) for v in rig.matrix_world.to_euler()]}")
if rig.animation_data:
    rig.animation_data_clear()
for a in list(bpy.data.actions):
    bpy.data.actions.remove(a)

known = {rig}
ad = rig.animation_data_create()

for name, path in CLIPS:
    bpy.context.scene.render.fps = 24
    before = set(bpy.data.actions.keys())
    objs_before = set(bpy.data.objects)
    bpy.ops.import_scene.fbx(filepath=path)
    donor = next(o for o in bpy.data.objects
                 if o.type == "ARMATURE" and o not in known)
    known.add(donor)
    new = [bpy.data.actions[n] for n in bpy.data.actions.keys() if n not in before]
    assert new, f"no action imported from {path}"
    act = new[0]
    retime(act)
    fr = act.frame_range
    print(f"[sport] donor {name}: euler={[round(v, 3) for v in donor.matrix_world.to_euler()]} "
          f"frames {tuple(round(x, 1) for x in fr)} dur={(fr[1] - fr[0]) / FPS:.2f}s")

    M_n = rig.matrix_world.copy()
    M_d = donor.matrix_world.copy()

    # The two rigs are the same Mixamo skeleton but were authored
    # independently: the donor armature space is Y-up (standard Mixamo) while
    # the sculpt's is Z-up, even though BOTH armature objects carry the same
    # rot.x=+90 FBX import rotation. So in world space the donor rest pose
    # stands upright while the sculpt's hangs upside down — the correction
    # is a global rotX(+90 deg) plus uniform scale k (verified numerically:
    # proximal rest joints match to ~4mm). A Kabsch similarity fit is NOT
    # usable here: mid-limb rest directions genuinely differ (~0.4 rad), and
    # a least-squares similarity over those degenerates (negative scale).
    import numpy as np

    k = ((M_n @ rig.pose.bones["mixamorig:Hips"].bone.matrix_local)
         .to_translation().length /
         (M_d @ donor.pose.bones["mixamorig:Hips"].bone.matrix_local)
         .to_translation().length)
    G = Matrix.Scale(k, 4) @ Matrix.Rotation(1.5707963268, 4, "X")

    # report the residual on proximal joints as proof the mapping is right
    names = [b.name for b in rig.pose.bones if donor.pose.bones.get(b.name)]
    prox = [n for n in names if any(t in n for t in (
        "Hips", "Spine", "Neck", "Head", "UpLeg", "Leg", "Foot",
        "Shoulder", "Arm", "ForeArm"))]
    resid = []
    for n in prox:
        pd = (M_d @ donor.pose.bones[n].bone.matrix_local).to_translation()
        ps = (M_n @ rig.pose.bones[n].bone.matrix_local).to_translation()
        resid.append(((G @ pd.to_4d()) - ps.to_4d()).length)
    resid = np.array(resid)
    print(f"[sport] {name}: G rotX(+90) k={k:.4f}  proximal rest fit "
          f"max={resid.max() * 100:.2f}cm mean={resid.mean() * 100:.2f}cm")

    # donor imported clips live on a muted NLA track — assign directly to evaluate
    ad_d = donor.animation_data
    ad_d.action = None
    for track in ad_d.nla_tracks:
        track.mute = True
    ad_d.action = act

    fr0, fr1 = int(act.frame_range[0]), int(act.frame_range[1])
    M_target = M_n.inverted() @ G @ M_d
    ad_n = rig.animation_data

    for a in bpy.data.actions:
        if a.name == name:
            a.name = f"donor_{name}"
    new_act = bpy.data.actions.new(name)
    new_act.use_fake_user = True
    ad_n.action = new_act

    # manual basis computation (see build_jab_woman.py for the full rationale:
    # pose_bone.matrix assignment inherits the previous clip's leftover pose)
    rest_rel_inv = {}
    for b in rig.pose.bones:
        if b.parent is not None:
            rest_rel = b.parent.bone.matrix_local.inverted() @ b.bone.matrix_local
        else:
            rest_rel = b.bone.matrix_local.copy()
        rest_rel_inv[b.name] = rest_rel.inverted()

    desired_map = {}
    for f in range(fr0 - 1, fr1 + 1):
        sf = max(f, fr0)
        bpy.context.scene.frame_set(sf)
        bpy.context.view_layer.update()
        for b in rig.pose.bones:
            db = donor.pose.bones.get(b.name)
            if db is None:
                continue
            # donor armature-space pose -> world -> registered -> sculpt
            # armature space; per-bone basis then stays small (no stretch)
            desired_map[b.name] = (M_target @ db.matrix).copy()
        for b in rig.pose.bones:
            if b.name not in desired_map:
                continue
            desired = desired_map[b.name]
            if b.parent is not None and b.parent.name in desired_map:
                rel = desired_map[b.parent.name].inverted() @ desired
            else:
                rel = desired
            basis_mat = rest_rel_inv[b.name] @ rel
            loc, quat, scl = basis_mat.decompose()
            b.location = loc
            b.rotation_quaternion = quat
            b.scale = scl
            b.keyframe_insert("location", frame=f)
            b.keyframe_insert("rotation_quaternion", frame=f)
            b.keyframe_insert("scale", frame=f)
    print(f"[sport] retargeted {name} ({fr1 - fr0 + 1} frames)")

    ad_n.action = None
    track = ad_n.nla_tracks.new()
    track.name = name
    strip = track.strips.new(name, int(new_act.frame_range[0]), new_act)
    strip.name = name
    track.mute = True

    # --- numeric self-check: sculpt posed with the baked action must match
    #     the donor pose (registered positions over ALL bones) and carry no
    #     stretch (scales ~1). NOTE: the donor action must stay assigned, or
    #     the donor pose freezes at the last baked frame and the comparison
    #     silently compares different frames (that false alarm once cost a
    #     whole debugging cycle) ---
    ad_n.action = new_act
    mid_f = int((fr0 + fr1) / 2)
    bpy.context.scene.frame_set(mid_f)
    bpy.context.view_layer.update()
    worst = 0.0
    worst_b = ""
    max_scl = 0.0
    for b in rig.pose.bones:
        bd = donor.pose.bones.get(b.name)
        if bd is None:
            continue
        ws = (M_n @ b.matrix).to_translation()
        wd = (G @ M_d @ bd.matrix).to_translation()
        err = (ws - wd).length
        if err > worst:
            worst, worst_b = err, b.name
        max_scl = max(max_scl, max(abs(s - 1.0) for s in b.scale))
    print(f"[sport] check {name} f{mid_f}: worst bone err {worst * 100:.2f}cm "
          f"({worst_b})  max |scale-1| {max_scl:.4f}")
    ad_n.action = None
    ad_d.action = None

    # drop the donor armature + meshes, keep only the baked action
    for o in list(bpy.data.objects):
        if o in objs_before or o is rig or o is mesh:
            continue
        bpy.data.objects.remove(o, do_unlink=True)

# --- the barbell: modelled from scratch (the donor FBX ships no prop) ---
# Pose the rig on a mid-back-squat frame, measure the hand-to-hand line and
# build shaft + plates around it, then bone-parent the result to Spine2 so it
# rides the whole squat. Bone-relative parenting survives the rest reset and
# exports as a plain node under the Spine2 joint.
bar_act = bpy.data.actions["back-squat"]
ad.action = bar_act
mid_bs = int((bar_act.frame_range[0] + bar_act.frame_range[1]) / 2)
bpy.context.scene.frame_set(mid_bs)
bpy.context.view_layer.update()

def world_of(bone_name):
    b = rig.pose.bones[bone_name]
    return (rig.matrix_world @ b.matrix).to_translation()

pH_l = world_of("mixamorig:LeftHand")
pH_r = world_of("mixamorig:RightHand")
hd = (pH_r - pH_l).length
axis = (pH_r - pH_l).normalized()
print(f"[sport] barbell: hands {hd:.3f} apart at f{mid_bs}")

from mathutils import Vector

bar_mat = bpy.data.materials.new("bar_steel")
bar_mat.use_nodes = True
bbs = next(n for n in bar_mat.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
bbs.inputs["Base Color"].default_value = (0.035, 0.035, 0.04, 1.0)
bbs.inputs["Metallic"].default_value = 0.9
bbs.inputs["Roughness"].default_value = 0.35

def add_cyl(name, r, depth, loc, rot_z_axis=axis):
    bpy.ops.mesh.primitive_cylinder_add(
        vertices=48, radius=r, depth=depth, location=loc)
    ob = bpy.context.active_object
    ob.name = name
    q = Vector(rot_z_axis).to_track_quat("Z", "Y")
    ob.rotation_mode = "QUATERNION"
    ob.rotation_quaternion = q
    ob.data.materials.append(bar_mat)
    return ob

half = hd / 2 + hd * 0.60          # shaft runs past the plates on both sides
plate_r = hd * 0.30
plate_t = hd * 0.05
plate_at = hd / 2 + hd * 0.20
shaft = add_cyl("bar_shaft", hd * 0.022, half * 2, (pH_l + pH_r) / 2)
parts = [shaft]
for sgn in (-1, 1):
    off = axis * (plate_at * sgn)
    parts.append(add_cyl(f"plate{sgn}", plate_r, plate_t,
                         (pH_l + pH_r) / 2 + off))
    parts.append(add_cyl(f"collar{sgn}", hd * 0.035, hd * 0.07,
                         (pH_l + pH_r) / 2 + axis * (hd / 2 + hd * 0.06) * sgn))
bpy.ops.object.select_all(action="DESELECT")
for ob in parts:
    ob.select_set(True)
bpy.context.view_layer.objects.active = shaft
bpy.ops.object.join()
bar = bpy.context.active_object
bar.name = "Barbell"

ad.action = bar_act
bpy.context.view_layer.update()
# bone-parent to Spine2, preserving the current world transform (manual BONE
# parenting: final = rig.MW @ bone.matrix @ parent_inv @ basis)
bar.parent = rig
bar.parent_type = "BONE"
bar.parent_bone = "mixamorig:Spine2"
mw = bar.matrix_world.copy()
spine = rig.pose.bones["mixamorig:Spine2"]
bar.matrix_parent_inverse = spine.matrix.inverted()
bar.matrix_basis = rig.matrix_world.inverted() @ mw
bpy.ops.object.select_all(action="DESELECT")
print(f"[sport] barbell joined: verts={len(bar.data.vertices)} parent_bone={bar.parent_bone}")

# --- the character rest reset happens below; the bar keeps its bone-relative
#     transform and follows Spine2 through every baked pose ---


for a in list(bpy.data.actions):
    if a.name not in {"idle", "back-squat"}:
        bpy.data.actions.remove(a)
for track in list(ad.nla_tracks):
    if track.strips and track.strips[0].action is None:
        ad.nla_tracks.remove(track)
# export the REST (T-pose) node transforms: the runtime muscle-mask pass reads
# bind-pose geometry + bone positions, so the GLB must not ship an idle pose
ad.action = None
for b in rig.pose.bones:
    b.location = (0, 0, 0)
    b.rotation_quaternion = (1, 0, 0, 0)
    b.rotation_euler = (0, 0, 0)
    b.scale = (1, 1, 1)

# The sculpt armature space is Z-up (Tripo quirk) while the donors are Y-up,
# so in Blender world the figure hangs with its head along -Y; exporting
# that verbatim lays the athlete flat in glTF. Stand the whole rig up with a
# world-space rotX(-90) on the armature object: the parented mesh follows,
# and the baked actions (armature-space) are unaffected.
Rup = Matrix.Rotation(-1.5707963268, 4, "X")
rig.matrix_world = Rup @ rig.matrix_world
bpy.context.view_layer.update()
head_w = (rig.matrix_world @ rig.pose.bones["mixamorig:Head"].bone.matrix_local).to_translation()
hips_w = (rig.matrix_world @ rig.pose.bones["mixamorig:Hips"].bone.matrix_local).to_translation()
print(f"[sport] stood up: hips y={hips_w.y:.3f} head y={head_w.y:.3f} "
      f"(head above hips: {head_w.y > hips_w.y})")

# --- material: base colour + normal only, JPEG friendly ---
old_mat = mesh.material_slots[0].material
old_nt = old_mat.node_tree
base_img = normal_img = None
for link in old_nt.links:
    if link.from_node.type != "TEX_IMAGE" or not link.from_node.image:
        continue
    if link.to_node.type == "BSDF_PRINCIPLED" and link.to_socket.name == "Base Color":
        base_img = link.from_node.image
    elif link.to_node.type == "NORMAL_MAP":
        normal_img = link.from_node.image
print(f"[sport] maps: base={base_img and base_img.name} normal={normal_img and normal_img.name}")

mat = bpy.data.materials.new("sport_man")
mat.use_nodes = True
nt = mat.node_tree
bsdf = next(n for n in nt.nodes if n.type == "BSDF_PRINCIPLED")
bsdf.inputs["Metallic"].default_value = 0.0
bsdf.inputs["Roughness"].default_value = 0.7
if base_img:
    base_img.alpha_mode = "NONE"
    tx = nt.nodes.new("ShaderNodeTexImage")
    tx.image = base_img
    tx.location = (-600, 300)
    nt.links.new(tx.outputs["Color"], bsdf.inputs["Base Color"])
if normal_img:
    normal_img.colorspace_settings.name = "Non-Color"
    tx = nt.nodes.new("ShaderNodeTexImage")
    tx.image = normal_img
    tx.location = (-600, -60)
    nm = nt.nodes.new("ShaderNodeNormalMap")
    nm.location = (-300, -60)
    nt.links.new(tx.outputs["Color"], nm.inputs["Color"])
    nt.links.new(nm.outputs["Normal"], bsdf.inputs["Normal"])
for attr, val in (("blend_method", "OPAQUE"), ("surface_render_method", "DITHERED")):
    if hasattr(mat, attr):
        try:
            setattr(mat, attr, val)
        except Exception:
            pass

mesh.data.materials.clear()
mesh.data.materials.append(mat)

used = {i.name for i in (base_img, normal_img) if i}
for img in list(bpy.data.images):
    if img.name not in used:
        bpy.data.images.remove(img)
        continue
    w, h = img.size
    if max(w, h) > MAXTEX:
        kk = MAXTEX / max(w, h)
        img.scale(int(w * kk), int(h * kk))
        print(f"[sport] resized {img.name} {w}x{h} -> {img.size[0]}x{img.size[1]}")
bpy.data.materials.remove(old_mat)

bpy.ops.object.select_all(action="DESELECT")
rig.select_set(True)
mesh.select_set(True)
bar.select_set(True)          # the barbell rides under Spine2 — export it too
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
    export_image_format="JPEG",
    export_jpeg_quality=86,
)
print(f"[sport] wrote {OUT} size={os.path.getsize(OUT) / 1024 / 1024:.2f} MB")
