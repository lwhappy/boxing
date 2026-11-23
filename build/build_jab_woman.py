"""
Build the "white rig" woman GLB for moves/jab.html — mesh + rig + retargeted clips.

Source rig:  /Users/justrun/project/boxing-game/moves/rig-character-white.fbx
             (Tripo/Mixamo 33-bone rig, 0.01 armature scale, bone translations in cm)
Clip donors: web/training/benefits-of-boxing/models/woman.glb  (jab)
             web/media/glb/boxer-woman.glb                     (jab -> "jab-fight")
             build/donor_idle4.fbx                             (Mixamo idle -> "idle")
             build/donor_guard.fbx                             (Mixamo guard -> "guard")

The donor rigs' per-bone REST ROTATIONS differ from the sculpt's, and glTF
animation tracks REPLACE a bone's local quaternion, so donor clips cannot be
played on the sculpt as-is (limbs end up twisted). Instead every donor action
is resampled: at each frame the donor bone's armature-space matrix is copied
onto the sculpt's bone, expressed in its own parent frame — a true retarget.

Usage: Blender -b -P build/build_jab_woman.py -- --with-clips
"""
import bpy
import os
import sys

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
WITH_CLIPS = "--with-clips" in argv

# per-move variant: instead of the glb jab donors, bake an FBX punch clip
# (build_move_woman.py semantics on top of the proven jab pipeline):
#   --move-donor build/donor_cross.fbx --move-name cross --out web/media/glb/cross-woman.glb
MOVE_DONOR = None
MOVE_NAME = None
if "--move-donor" in argv:
    MOVE_DONOR = argv[argv.index("--move-donor") + 1]
    MOVE_NAME = argv[argv.index("--move-name") + 1]

SRC = "/Users/justrun/project/boxing-game/moves/rig-character-white.fbx"
ROOT = "/Users/justrun/project/boxing-3"
DONOR_MOVES = os.path.join(ROOT, "web/training/benefits-of-boxing/models/woman.glb")
DONOR_GAME = os.path.join(ROOT, "web/media/glb/boxer-woman.glb")
DONOR_IDLE = os.path.join(ROOT, "build/donor_idle4.fbx")
DONOR_GUARD = os.path.join(ROOT, "build/donor_guard.fbx")
OUT = os.path.join(ROOT, "web/media/glb/jab-man.glb")
if MOVE_DONOR:
    OUT = argv[argv.index("--out") + 1]   # after the default OUT above
MAXTEX = 2048
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
            f.keyframe_points.update() if False else None
            f.update()
        bpy.context.scene.render.fps = FPS
        print(f"    retimed {fps_after}fps -> {FPS}fps")


bpy.ops.wm.read_homefile(use_empty=True)
bpy.context.scene.render.fps = int(FPS)
bpy.context.scene.render.fps_base = 1.0

# --- the sculpt (rig + mesh, pose-only) ---
bpy.ops.import_scene.fbx(filepath=SRC)
rig_n = next(o for o in bpy.data.objects if o.type == "ARMATURE")
mesh_n = next(o for o in bpy.data.objects if o.type == "MESH")
if rig_n.animation_data:
    rig_n.animation_data_clear()
for a in list(bpy.data.actions):
    bpy.data.actions.remove(a)
print(f"[jab-man] sculpt rig={rig_n.name} bones={len(rig_n.data.bones)} "
      f"mesh verts={len(mesh_n.data.vertices)} polys={len(mesh_n.data.polygons)}")

if WITH_CLIPS:
    # --- clip donors (their armatures collide with the sculpt's 'Armature'
    # name, so track them by object identity, not by name) ---
    known = {rig_n}
    if MOVE_DONOR:
        # per-move variant: guard + the FBX move clip, plus the glTF 'idle'
        # (boxer-woman.glb) so the docked widget plays the exact same idle
        # as the jab page. NOTE: the glTF import must happen AFTER the FBX
        # donor imports — importing it first flips the FBX bake's rotation
        # convention (guard comes out upright instead of lying, which makes
        # the page's orientation check fire and rotate the FBX move clips
        # flat).
        rig_moves = None
        rig_game = None
    else:
        bpy.ops.import_scene.gltf(filepath=DONOR_MOVES)
        rig_moves = next(o for o in bpy.data.objects
                         if o.type == "ARMATURE" and o not in known)
        known.add(rig_moves)
        bpy.ops.import_scene.gltf(filepath=DONOR_GAME)
        rig_game = next(o for o in bpy.data.objects
                        if o.type == "ARMATURE" and o not in known)
        known.add(rig_game)

    def rig_actions(rig):
        """actions owned by this rig, via its NLA tracks (glTF importer layout)"""
        out = {}
        ad = rig.animation_data
        if ad:
            for track in ad.nla_tracks:
                for strip in track.strips:
                    if strip.action:
                        name = strip.action.name.split("|")[-1].split("/")[-1]
                        out.setdefault(name, strip.action)
        if ad and ad.action:
            name = ad.action.name.split("|")[-1].split("/")[-1]
            out.setdefault(name, ad.action)
        return out

    # the Mixamo FBX donors (33 bones, no mesh) ship 24fps keys. Import each
    # with the scene at 24fps, then retime its keys 24 -> 30 IMMEDIATELY —
    # retimed_to_fps reads the scene fps at call time, so doing it here (rather
    # than inside the bake loop) keeps every bake iteration at a known 30fps
    def import_fbx_donor(path):
        bpy.context.scene.render.fps = 24
        bpy.ops.import_scene.fbx(filepath=path)
        rig = next(o for o in bpy.data.objects
                   if o.type == "ARMATURE" and o not in known)
        known.add(rig)
        for a in rig_actions(rig).values():
            retimed_to_fps(a)          # 24 -> 30, restores scene fps to 30
        return rig

    rig_idle = None
    if os.path.exists(DONOR_IDLE):
        rig_idle = import_fbx_donor(DONOR_IDLE)
    rig_guard = None
    if os.path.exists(DONOR_GUARD):
        rig_guard = import_fbx_donor(DONOR_GUARD)
    rig_move = None
    if MOVE_DONOR:
        rig_move = import_fbx_donor(MOVE_DONOR)
    if MOVE_DONOR:
        # glTF idle donor LAST — see the convention note in the MOVE_DONOR
        # branch above (importing glTF before FBX flips the FBX bake)
        bpy.ops.import_scene.gltf(filepath=DONOR_GAME)
        rig_game = next(o for o in bpy.data.objects
                        if o.type == "ARMATURE" and o not in known)
        known.add(rig_game)
    # drop the donors' meshes up front so they never pollute the export
    for o in list(bpy.data.objects):
        if o.type == "MESH" and o.parent not in (None, rig_n) and o is not mesh_n:
            bpy.data.objects.remove(o, do_unlink=True)

    for r in (rig_moves, rig_game):
        if r is None:
            continue
        print(f"  donor {r.name}: matrix_world rot ok? "
              f"{[round(v, 3) for v in r.matrix_world.to_euler()]}")
    print(f"  sculpt armature euler: {[round(v, 3) for v in rig_n.matrix_world.to_euler()]}")

    ad_n = rig_n.animation_data_create()

    CLIPS = []
    if rig_guard is not None:
        acts_guard = rig_actions(rig_guard)
        print(f"  donor guard clips: {sorted(acts_guard)}")
        CLIPS.append((rig_guard, acts_guard, "Layer0", "guard"))
    if MOVE_DONOR:
        acts_move = rig_actions(rig_move)
        print(f"  donor move clips: {sorted(acts_move)}")
        CLIPS.append((rig_move, acts_move, "Layer0", MOVE_NAME))
    else:
        acts_moves = rig_actions(rig_moves)
        acts_game = rig_actions(rig_game)
        print(f"  donor moves clips: {sorted(acts_moves)}")
        print(f"  donor game clips: {sorted(acts_game)}")
        CLIPS.append((rig_moves, acts_moves, "jab", "jab"))
        CLIPS.append((rig_game, acts_game, "jab", "jab-fight"))
    if rig_idle is not None and not MOVE_DONOR:
        acts_idle = rig_actions(rig_idle)
        print(f"  donor idle clips: {sorted(acts_idle)}")
        CLIPS.append((rig_idle, acts_idle, "Layer0", "idle"))
    if MOVE_DONOR:
        # the jab page's docked idle, straight from the glTF donor
        acts_game = rig_actions(rig_game)
        print(f"  donor game clips: {sorted(acts_game)}")
        CLIPS.append((rig_game, acts_game, "idle", "idle"))

    M_n = rig_n.matrix_world.copy()
    hips_n = rig_n.pose.bones["mixamorig:Hips"]
    hips_rest = hips_n.bone.matrix_local.copy()          # armature-space rest
    hips_rest_mag = hips_rest.to_translation().length    # raw skeleton size proxy

    def find_clip(acts, name):
        """exact match first, then base-name match (importer suffixes .001...)"""
        if name in acts:
            return acts[name]
        for k, a in acts.items():
            if k.split(".")[0] == name and "cross" not in k:
                return a
        return None

    for donor_rig, donor_acts, src_name, out_name in CLIPS:
        act = find_clip(donor_acts, src_name)
        assert act, f"donor action {src_name} not found"
        retimed_to_fps(act)
        M_d = donor_rig.matrix_world.copy()
        # donor -> sculpt armature-space mapping (both armatures carry the same
        # 0.01 scale, so the product is a pure rotation)
        M_map = (M_n.inverted() @ M_d)
        R_map = M_map.to_3x3()
        for v in R_map:
            v.normalize()

        # the donor hips' raw rest height sets the size ratio: donor skeletons
        # ship at different unit scales (57cm vs 104cm hips for a ~1m vs ~1.8m
        # raw character), so hips motion must be scaled onto the sculpt
        hips_d = donor_rig.pose.bones["mixamorig:Hips"]
        hips_rest_d = hips_d.bone.matrix_local.copy()
        k = hips_rest_mag / hips_rest_d.to_translation().length
        print(f"  {out_name}: donor hips rest {hips_rest_d.to_translation().length:.1f}cm "
              f"-> sculpt {hips_rest_mag:.1f}cm (k={k:.3f})")

        # the imported donors keep every clip on a MUTED NLA track, so nothing
        # would evaluate while sampling — assign the wanted action directly
        ad_d = donor_rig.animation_data
        ad_d.action = None
        for track in ad_d.nla_tracks:
            track.mute = True
        ad_d.action = act

        fr0, fr1 = int(act.frame_range[0]), int(act.frame_range[1])
        ad_n.action = None
        # donor actions can share the output name (boxer-woman.glb ships
        # 'guard' and 'idle') — Blender would then name the baked action
        # '<name>.001' and the exporter would emit the RAW donor action
        # instead of the baked one (wrong skeleton convention). Rename the
        # donor's action out of the way first.
        for a in bpy.data.actions:
            if a.name == out_name:
                a.name = f"donor_{out_name}"
        new_act = bpy.data.actions.new(out_name)
        new_act.use_fake_user = True
        ad_n.action = new_act

        # Bake from frame 0: the glTF exporter mis-samples actions whose frame
        # range starts at frame > 0 (it emits frames 0..N-1 regardless, so the
        # first sample extrapolates garbage — an unsorted time entry that
        # throws three.js's binary-search interpolation off for the WHOLE
        # clip). Frame 0 simply repeats the donor's first pose.
        #
        # The basis is computed MANUALLY (pose_arm = parent_pose @ rest_rel @
        # basis) instead of relying on pose_bone.matrix assignment: the
        # setter's loc/rot/scale decomposition reads the parent chain's
        # *current* state, so early frames inherit whatever pose the previous
        # clip's bake left on the rig — garbage keys for the first few frames
        # that then flash on every loop wrap.
        rest_rel_inv = {}     # bone.name -> (rest_rel @ pose-rel rest) inverse
        rest_arm = {}         # bone.name -> armature-space rest matrix
        for b in rig_n.pose.bones:
            rest_arm[b.name] = b.bone.matrix_local.copy()
            if b.parent is not None:
                rest_rel = b.parent.bone.matrix_local.inverted() @ b.bone.matrix_local
            else:
                rest_rel = b.bone.matrix_local.copy()
            rest_rel_inv[b.name] = rest_rel.inverted()
        for f in range(fr0 - 1, fr1 + 1):
            sf = max(f, fr0)
            bpy.context.scene.frame_set(sf)
            bpy.context.view_layer.update()
            desired_map = {}
            for b in rig_n.pose.bones:
                db = donor_rig.pose.bones.get(b.name)
                if db is None:
                    continue
                # desired pose in sculpt armature space: the donor bone's
                # world matrix expressed in the sculpt's armature frame
                desired = M_map @ db.matrix
                if b.name == "mixamorig:Hips":
                    # rescale the hips motion onto the sculpt skeleton
                    rest_mapped = (M_map @ hips_rest_d).to_translation()
                    off = desired.to_translation() - rest_mapped
                    desired.translation = hips_rest.to_translation() + off * k
                desired_map[b.name] = desired.copy()
            for b in rig_n.pose.bones:
                if b.name not in desired_map:
                    continue
                desired = desired_map[b.name]
                if b.parent is not None and b.parent.name in desired_map:
                    rel = desired_map[b.parent.name].inverted() @ desired
                else:
                    rel = desired
                basis_mat = rest_rel_inv[b.name] @ rel
                b.rotation_quaternion = basis_mat.to_quaternion()
                if b.name == "mixamorig:Hips":
                    b.location = basis_mat.to_translation()
                b.keyframe_insert("rotation_quaternion", frame=f)
                if b.name == "mixamorig:Hips":
                    b.keyframe_insert("location", frame=f)
        print(f"  retargeted {src_name} ({fr1 - fr0 + 1} frames) -> {out_name}")

        ad_d.action = None

        ad_n.action = None
        track = ad_n.nla_tracks.new()
        track.name = out_name
        # strip start MUST match the action's own range start: the strip maps
        # action frames 1:1 onto the timeline from here, and the glTF exporter
        # samples through it. With the frame-0 key the action now starts at 0;
        # a strip at fr0(=1) would shift the sampled range to action frames
        # -1..N-1 — garbage extrapolation for the first ~4 frames that flashes
        # on every loop wrap of the docked idle.
        strip = track.strips.new(out_name, int(new_act.frame_range[0]), new_act)
        strip.name = out_name
        track.mute = True

    # donors are done — remove their rigs and meshes entirely
    for o in list(bpy.data.objects):
        if o is not rig_n and o is not mesh_n:
            bpy.data.objects.remove(o, do_unlink=True)

    # keep only the retargeted actions (donor actions are still in the
    # file and would all be exported in ACTIONS mode)
    keep = {"guard", "jab", "jab-fight", "idle"}
    if MOVE_NAME:
        keep = {"guard", "idle", MOVE_NAME}
    for a in list(bpy.data.actions):
        if a.name not in keep:
            bpy.data.actions.remove(a)
    for track in list(ad_n.nla_tracks):
        if track.strips and track.strips[0].action is None:
            ad_n.nla_tracks.remove(track)

# --- material: opaque base colour + normal only, JPEG-friendly ---
old_mat = mesh_n.material_slots[0].material
old_nt = old_mat.node_tree
base_img = normal_img = None
for link in old_nt.links:
    if link.from_node.type != "TEX_IMAGE" or not link.from_node.image:
        continue
    if link.to_node.type == "BSDF_PRINCIPLED" and link.to_socket.name == "Base Color":
        base_img = link.from_node.image
    elif link.to_node.type == "NORMAL_MAP":
        normal_img = link.from_node.image
print(f"  maps: base={base_img and base_img.name} normal={normal_img and normal_img.name}")

mat = bpy.data.materials.new("jab_woman")
mat.use_nodes = True
nt = mat.node_tree
bsdf = next(n for n in nt.nodes if n.type == "BSDF_PRINCIPLED")
bsdf.inputs["Metallic"].default_value = 0.0
bsdf.inputs["Roughness"].default_value = 0.72
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
        except Exception as e:
            print(f"  (skip {attr}={val}: {e})")

mesh_n.data.materials.clear()
mesh_n.data.materials.append(mat)

used = {i.name for i in (base_img, normal_img) if i}
for img in list(bpy.data.images):
    if img.name not in used:
        bpy.data.images.remove(img)
        continue
    w, h = img.size
    if max(w, h) > MAXTEX:
        k = MAXTEX / max(w, h)
        img.scale(int(w * k), int(h * k))
        print(f"  resized {img.name} {w}x{h} -> {img.size[0]}x{img.size[1]}")
bpy.data.materials.remove(old_mat)

bpy.ops.object.select_all(action="DESELECT")
rig_n.select_set(True)
mesh_n.select_set(True)
bpy.context.view_layer.objects.active = rig_n

bpy.ops.export_scene.gltf(
    filepath=OUT,
    export_format="GLB",
    use_selection=True,
    export_apply=True,
    export_animations=WITH_CLIPS,
    export_animation_mode="ACTIONS",
    export_skins=True,
    export_morph=False,
    export_yup=True,
    export_image_format="JPEG",
    export_jpeg_quality=88,
)
print(f"[jab-man] wrote {OUT} size={os.path.getsize(OUT) / 1024:.0f} KB")
