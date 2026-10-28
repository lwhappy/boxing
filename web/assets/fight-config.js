/* ======================================================================
 * Fight page — SINGLE CONFIG FILE
 * ----------------------------------------------------------------------
 * Everything the fight demo needs is defined here. Edit this file and
 * refresh the page to see the changes.
 * ====================================================================== */
window.FIGHT = {

  /* ---- model ---- */
  /* Path to the GLB. Each GLB must contain:
   *   - nodes "attack-armature" and "defence-armature"
   *   - clips "attack-*" / "defence-*" (attack-idle, attack-jab, ...)
   *   - an empty "ancher1" on the defender (impact point)
   */
  glb: './media/glb/all.glb',

  /* ---- attacker poses (per move) ---- */
  /* Root transform of the attack armature for every punch, in glTF space
   * (three.js world units / quaternion). Converted from the Blender
   * transforms authored per action (Z-up -> Y-up: t_gltf = (bx, bz, -by),
   * q_gltf = C^-1 · R_blender · C with C = +90° about X — calibrated to
   * match the exported node 1e-6). Applying the authored pose before the
   * clip plays is what makes each fist land on the defender's head.
   * `stance` is where the attacker idles between punches (jab pose). */
  attackPoses: {
    stance:         { t: [0.48217, 0, 0],        q: [0.54792, -0.44697, 0.44697, 0.54792] },
    jab:            { t: [0.48217, 0, 0],        q: [0.54792, -0.44697, 0.44697, 0.54792] },
    cross:          { t: [0.29527, 0, 0.22209],  q: [0.47972, -0.51949, 0.51949, 0.47972] },
    'lead-hook':    { t: [0.31819, 0, 0.08203],  q: [0.54792, -0.44697, 0.44697, 0.54792] },
    'rear-hook':    { t: [0.04853, 0, 0.52064],  q: [0.26414, -0.65592, 0.65592, 0.26414] },
    'lead-uppercut':{ t: [0.22708, 0, 0.36808],  q: [0.42090, -0.56819, 0.56819, 0.42090] },
    'rear-uppercut':{ t: [0.13493, 0, 0.30617],  q: [0.42090, -0.56819, 0.56819, 0.42090] }
  },

  /* ---- buttons ---- */
  /* Which punch buttons are enabled. Everything else is disabled.
   * Valid: 'jab', 'cross', 'lead hook', 'rear hook',
   *        'lead uppercut', 'rear uppercut'.
   * A button also stays disabled if its clip is missing from the GLB. */
  active: ['jab', 'cross', 'lead hook', 'rear hook', 'lead uppercut', 'rear uppercut'],

  /* Caption shown above the stage. */
  message: 'Pick a punch — watch it land',

  /* ---- hit timing ---- */
  /* Frame rate the clips were authored at (Blender export fps). */
  fps: 30,

  /* Impact frame per move: the hit effect + sound fire when the attack
   * clip reaches this frame. Time = (frame - 1) / fps.
   * Measured as the hand's closest approach to the defender's head bone
   * with the move's pose applied (build/cdp_pose_measure.mjs). A move
   * missing here falls back to `hitDelay` (seconds AFTER the clip ends). */
  hitFrame: {
    jab: 14,              /* attack-jab */
    cross: 37,            /* attack-cross2 */
    'lead-hook': 18,
    'rear-hook': 35,      /* attack-rear-hook2 */
    'lead-uppercut': 25,
    'rear-uppercut': 23
  },
  hitDelay: 1.0,

  /* ---- camera ---- */
  /* position/target in world units, fov in degrees (null = keep the
   * GLB init-camera lens). Set `useGlbCamera: true` to fall back to the
   * init-camera pose from the GLB instead. */
  useGlbCamera: false,
  camera: {
    /* side-on view: defender left / attacker right, both fully in frame,
     * camera level at mid-body height (matches the Blender reference shot) */
    position: [0.11, 0.48, 1.98],
    target: [0.11, 0.46, 0.05],
    fov: null
  },

  /* ---- impact sound ---- */
  /* Plays the moment the punch lands (same instant as the effect).
   * The toggle at the top-left of the stage remembers the visitor's
   * choice in localStorage, so `on` only sets the FIRST-visit default. */
  sound: {
    on: true,
    impact: './media/audio/punch-impact.wav',
    volume: 0.85            /* 0 … 1 */
  },

  /* ---- mouse controls ---- */
  controls: {
    rotate: true,     /* left-drag orbits the scene */
    zoom: true,       /* wheel zooms */
    pan: false,       /* right-drag pans */
    minDistance: 1.2,
    maxDistance: 6
  }
};
