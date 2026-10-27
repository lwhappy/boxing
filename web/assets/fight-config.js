/* ======================================================================
 * Fight page — SINGLE CONFIG FILE
 * ----------------------------------------------------------------------
 * Everything the fight demo needs is defined here. Edit this file and
 * refresh the page (or click the "Next" button at the top-right of the
 * stage to load the next GLB / re-pull the current one from disk).
 * ====================================================================== */
window.FIGHT = {

  /* ---- model ---- */
  /* Path to the GLB — a single path, or an array of paths that the
   * "Next" button cycles through. Each GLB must contain:
   *   - nodes "attack-armature" and "defence-armature"
   *   - clips "attack-*" / "defence-*" (attack-idle, attack-jab, ...)
   *   - an empty "ancher1" on the defender (impact point)
   */
  glb: './media/glb/med-head-jab2.glb',

  /* ---- buttons ---- */
  /* Which punch buttons are enabled. Everything else is disabled.
   * Valid: 'jab', 'cross', 'lead hook', 'rear hook',
   *        'lead uppercut', 'rear uppercut'
   */
  active: ['jab'],

  /* Caption shown above the stage. */
  message: 'How to throw a jab',

  /* ---- hit timing ---- */
  /* Frame rate the clips were authored at (Blender export fps).
   * jab clip = 46 frames @ 30fps = 1.5333s. */
  fps: 30,

  /* Impact frame per move: the hit effect + defence-hit fire when the
   * attack clip reaches this frame. Time = (frame - 1) / fps.
   * Example: jab frame 13 -> (13-1)/30 = 0.4s into the clip.
   * A move missing here falls back to `hitDelay` (seconds AFTER the
   * attack clip finishes). */
  hitFrame: {
    jab: 13
  },
  hitDelay: 1.0,

  /* ---- camera ---- */
  /* position/target in world units, fov in degrees (null = keep the
   * GLB init-camera lens). Set `useGlbCamera: true` to fall back to the
   * init-camera pose from the GLB instead. */
  useGlbCamera: false,
  camera: {
    position: [0.85, 0.92, 2.35],
    target: [0, 0.56, 0],
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
