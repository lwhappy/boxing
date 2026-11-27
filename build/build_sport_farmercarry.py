"""Build web/media/glb/sport-farmercarry.glb — the Tripo man walking with two dumbbells.

Farmer's carry needs no new mocap: it IS a walk, and the walk donor ships the
full legs/spine/torso pass. It also ships a normal arm swing and a forward
root translation:

  * arms  — after retargeting, the upper-arm / forearm / hand chain is pinned
            to ONE constant basis (computed once from the rest T-pose): arms
            hang straight down with a slight outward angle, no swing. Because
            the basis is constant and relative to the shoulder, the arms still
            ride the torso as it turns — they just never swing on their own.
  * drift — the donated clip translates the hips ~0.7 m forward over one cycle.
            That translation is projected out of every baked hips position
            (only the component along the walk direction), so the loop walks on
            the spot and keeps its vertical bob.

Source rig:  /Users/justrun/project/boxing-game/sport/rig/man.fbx
             (Tripo "男运动健将" mesh, 25k verts, Mixamo 65-bone skeleton, 0.01 scale)
Clip donor:  /Users/justrun/project/boxing-game/sport/rig/Walking.fbx
             (Mixamo walk, 38 frames @ 24 fps, full root motion)

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
import math
import os
from mathutils import Matrix, Vector

RIG = "/Users/justrun/project/boxing-game/sport/rig/man.fbx"
CLIPS = [
    ("carry", "/Users/justrun/project/boxing-game/sport/rig/Walking.fbx"),
    # bend down + take hold + stand up — the same pickup the back-squat page
    # uses; the intro plays once before the carry loop (bells start ON THE
    # FLOOR, then ride the palms once both hands arrive)
    ("grab-bar", "/Users/justrun/project/boxing-game/sport/rig/Back Squat grabbar.fbx"),
]
OUT = "/Users/justrun/project/boxing-3/web/media/glb/sport-farmercarry.glb"
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

    # --- root motion: a travelling walk translated the hips ~0.7 m forward
    #     over one cycle. Project that component out of every baked hips
    #     position (keeping the perpendicular bob/sway) so the loop walks on
    #     the spot instead of sliding off the camera. ---
    hip_pts = []
    for f in range(fr0, fr1 + 1):
        bpy.context.scene.frame_set(f)
        bpy.context.view_layer.update()
        hip_pts.append((M_target @ donor.pose.bones["mixamorig:Hips"].matrix).to_translation())
    drift = hip_pts[-1] - hip_pts[0]
    hip_fix = [Vector((0.0, 0.0, 0.0)) for _ in hip_pts]
    if drift.length > 1e-4:
        u = drift.normalized()
        s0 = hip_pts[0].dot(u)
        hip_fix = [-((p.dot(u) - s0)) * u for p in hip_pts]
        unit = rig.matrix_world.to_scale().x
        print(f"[sport] {name}: root travel {drift.length * unit:.3f} m over "
              f"{len(hip_pts)} frames -> cancelled (in-place loop)")

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
        # cancel the walk's forward travel: shift the WHOLE pose rigidly. Only
        # the hips (the root) needs its own matrix changed — but every bone's
        # matrix must carry the same offset, otherwise each child bone's
        # parent-relative basis absorbs the difference and the limbs stay
        # behind while the pelvis walks off.
        fix = hip_fix[sf - fr0]
        for m in desired_map.values():
            m.translation = m.translation + fix
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
        wd = (M_n @ (M_target @ bd.matrix)).to_translation()
        # the hips carry the deliberate in-place correction; the arm chain is
        # overridden on purpose later, so neither is a retarget error
        wd = wd + (M_n.to_3x3() @ hip_fix[mid_f - fr0])
        err = (ws - wd).length
        if err > worst:
            worst, worst_b = err, b.name
        max_scl = max(max_scl, max(abs(s - 1.0) for s in b.scale))
    print(f"[sport] check {name} f{mid_f}: worst bone err {worst * 100:.2f}cm "
          f"({worst_b})  max |scale-1| {max_scl:.4f}")
    ad_n.action = None
    ad_d.action = None

    # the grab clip opens with the hands at waist height miming a HELD bar
    # (a "putting the bar down" preamble). Cut it so the clip opens already
    # mid-bend, reaching for the bar that lies on the floor.
    if name == "grab-bar":
        cut = 40
        for fcu in fcurves(new_act):
            for kp in fcu.keyframe_points:
                kp.co.x -= cut
                kp.handle_left.x -= cut
                kp.handle_right.x -= cut
            while fcu.keyframe_points and fcu.keyframe_points[0].co.x < 0:
                fcu.keyframe_points.remove(fcu.keyframe_points[0])
            fcu.update()
        print(f"[sport] {name}: trimmed {cut} frames -> "
              f"{tuple(round(x, 1) for x in new_act.frame_range)}")

    # drop the donor armature + meshes, keep only the baked action
    for o in list(bpy.data.objects):
        if o in objs_before or o is rig or o is mesh:
            continue
        bpy.data.objects.remove(o, do_unlink=True)

# --- arm override -----------------------------------------------------------
# A farmer's carry is walked with the arms locked at the sides: no swing, just
# a natural hang. The walk donor animates the whole arm chain every frame, so
# rather than follow it we DERIVE one constant basis per arm from the rest
# T-pose — arm rotated to hang straight down with a touch of abduction and a
# touch of forward lean — and stamp that same basis on every frame. A constant
# basis is rigid relative to the shoulder, so the arms still ride the torso as
# it turns through the gait, they just never swing on their own.
carry_act = bpy.data.actions["carry"]
ad.action = None
for b in rig.pose.bones:
    b.location = (0, 0, 0)
    b.rotation_mode = "QUATERNION"
    b.rotation_quaternion = (1, 0, 0, 0)
    b.scale = (1, 1, 1)
bpy.context.view_layer.update()

rest_rel_inv = {}
for b in rig.pose.bones:
    if b.parent is not None:
        rest_rel = b.parent.bone.matrix_local.inverted() @ b.bone.matrix_local
    else:
        rest_rel = b.bone.matrix_local.copy()
    rest_rel_inv[b.name] = rest_rel.inverted()


def wpos(name):
    return (rig.matrix_world @ rig.pose.bones[name].matrix).to_translation()


def set_basis(pb, basis):
    loc, quat, scl = basis.decompose()
    pb.location = loc
    pb.rotation_mode = "QUATERNION"
    pb.rotation_quaternion = quat
    pb.scale = scl


def world_turn(pb, point, rot):
    """Rotate a bone about a world point, return its new basis matrix."""
    if hasattr(rot, "to_matrix"):
        rot = rot.to_matrix().to_4x4()
    mw = rig.matrix_world @ pb.matrix
    mw_new = (Matrix.Translation(point) @ rot
              @ Matrix.Translation(-point) @ mw)
    desired = rig.matrix_world.inverted() @ mw_new
    return rest_rel_inv[pb.name] @ (pb.parent.matrix.inverted() @ desired)


UP = (wpos("mixamorig:Head") - wpos("mixamorig:Hips")).normalized()
DOWN = -UP
SIDE_R = wpos("mixamorig:RightUpLeg") - wpos("mixamorig:LeftUpLeg")
SIDE_R -= UP * SIDE_R.dot(UP)
SIDE_R.normalize()
FWD = UP.cross(SIDE_R)
if (wpos("mixamorig:LeftToeBase") - wpos("mixamorig:LeftFoot")).dot(FWD) < 0:
    FWD = -FWD

ABDUCT = 0.11      # how far the upper arm clears the ribs (fraction of arm len)
LEAN_FWD = 0.02    # a hair forward so the bells hang clear of the thighs

keep = {}
for side, sgn in (("Left", -1.0), ("Right", 1.0)):
    arm = rig.pose.bones[f"mixamorig:{side}Arm"]
    fore = rig.pose.bones[f"mixamorig:{side}ForeArm"]
    h0, h1 = wpos(arm.name), wpos(fore.name)
    d = (h1 - h0).normalized()
    target = (DOWN + sgn * ABDUCT * SIDE_R + LEAN_FWD * FWD).normalized()
    set_basis(arm, world_turn(arm, h0, d.rotation_difference(target)))
    for pb in (rig.pose.bones[f"mixamorig:{side}ForeArm"],
               rig.pose.bones[f"mixamorig:{side}Hand"]):
        set_basis(pb, Matrix.Identity(4))       # straight elbow, neutral wrist
    bpy.context.view_layer.update()

    hand = f"mixamorig:{side}Hand"

    # --- close the fist first: every phalanx is a plain local-X rotation
    #     (+60/+75/+45 progressive curl), which is the hinge the Mixamo finger
    #     bones actually bend on. Doing it in bone space is what makes it
    #     symmetric on both hands; the world-space "rotate toward the palm
    #     normal" attempt kept the fingers half open on one side. ---
    fingers = {}
    for finger in ("Index", "Middle", "Ring", "Pinky"):
        for seg, deg in enumerate((60, 75, 45), start=1):
            pb = rig.pose.bones[f"mixamorig:{side}Hand{finger}{seg}"]
            pb.rotation_mode = "QUATERNION"
            pb.rotation_quaternion = Matrix.Rotation(math.radians(deg), 4, "X").to_quaternion()
            fingers[pb.name] = pb.rotation_quaternion.copy()
    for seg, deg in ((1, 32), (2, 26)):          # thumb folds over the bar
        pb = rig.pose.bones[f"mixamorig:{side}HandThumb{seg}"]
        pb.rotation_mode = "QUATERNION"
        pb.rotation_quaternion = Matrix.Rotation(math.radians(deg), 4, "X").to_quaternion()
        fingers[pb.name] = pb.rotation_quaternion.copy()
    bpy.context.view_layer.update()

    # --- roll the wrist so the palm faces the thigh. The palm side is now
    #     whatever side the curled fingertips landed on — no guessing at
    #     cross-product handedness. ---
    wrist = Vector(wpos(hand))
    palm_c = (wrist + Vector(wpos(f"mixamorig:{side}HandMiddle1"))) * 0.5
    tips = [Vector(wpos(f"mixamorig:{side}Hand{f}4"))
            for f in ("Index", "Middle", "Ring", "Pinky")]
    palm_side = sum((t - palm_c for t in tips), Vector()) / len(tips)
    if palm_side.length < 1e-6:
        continue
    palm_side.normalize()
    axe = (Vector(wpos(f"mixamorig:{side}ForeArm")) - wrist).normalized()
    want = SIDE_R if sgn < 0 else -SIDE_R        # toward the body midline
    want = (want - axe * want.dot(axe))
    if want.length < 1e-6:
        continue
    want.normalize()
    ang = palm_side.angle(want)
    if palm_side.cross(want).dot(axe) < 0:
        ang = -ang
    set_basis(rig.pose.bones[hand],
              world_turn(rig.pose.bones[hand], wrist, Matrix.Rotation(ang, 4, axe)))
    bpy.context.view_layer.update()

    # sanity: a closed fist puts every fingertip within ~3 cm of the palm
    tips_after = {f: round((Vector(wpos(f"mixamorig:{side}Hand{f}4")) - palm_c).length, 3)
                  for f in ("Index", "Middle", "Ring", "Pinky")}
    print(f"[sport] {side} fist tips->palm {tips_after}  wrist roll "
          f"{round(ang * 57.2958):+d}deg")

    keep[side] = {
        "arm": rig.pose.bones[f"mixamorig:{side}Arm"].rotation_quaternion.copy(),
        "hand": rig.pose.bones[hand].rotation_quaternion.copy(),
        "fingers": fingers,
        "roll_deg": round(ang * 57.2958, 1),
    }
    print(f"[sport] {side} arm: abduction {ABDUCT * 100:.0f}%  wrist roll "
          f"{keep[side]['roll_deg']:+.0f}deg  fingers curled {len(fingers)}")

ad.action = carry_act
fr_c0, fr_c1 = int(carry_act.frame_range[0]), int(carry_act.frame_range[1])
for f in range(fr_c0, fr_c1 + 1):
    bpy.context.scene.frame_set(f)
    for side in ("Left", "Right"):
        arm = rig.pose.bones[f"mixamorig:{side}Arm"]
        fore = rig.pose.bones[f"mixamorig:{side}ForeArm"]
        hand = rig.pose.bones[f"mixamorig:{side}Hand"]
        for pb in (arm, fore, hand):
            pb.rotation_mode = "QUATERNION"
            pb.location = (0, 0, 0)
            pb.scale = (1, 1, 1)
        arm.rotation_quaternion = keep[side]["arm"]
        fore.rotation_quaternion = (1, 0, 0, 0)
        hand.rotation_quaternion = keep[side]["hand"]
        for nm, q in keep[side]["fingers"].items():
            pb = rig.pose.bones[nm]
            pb.rotation_mode = "QUATERNION"
            pb.location = (0, 0, 0)
            pb.scale = (1, 1, 1)
            pb.rotation_quaternion = q
        for pb in (arm, fore, hand):
            pb.keyframe_insert("location", frame=f)
            pb.keyframe_insert("rotation_quaternion", frame=f)
            pb.keyframe_insert("scale", frame=f)
        for nm in keep[side]["fingers"]:
            pb = rig.pose.bones[nm]
            pb.keyframe_insert("location", frame=f)
            pb.keyframe_insert("rotation_quaternion", frame=f)
            pb.keyframe_insert("scale", frame=f)
print(f"[sport] arms locked down over {fr_c1 - fr_c0 + 1} frames")

# The dumbbells are NOT baked here: bone-parented props get their offsets
# scrambled by the export-time rest reset (the barbell lesson). The stage
# script builds them in three.js and pins them to the palms every frame.

# --- the character rest reset happens below; the bar keeps its bone-relative
#     transform and follows Spine2 through every baked pose ---


for a in list(bpy.data.actions):
    if a.name not in {"carry", "grab-bar"}:
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
