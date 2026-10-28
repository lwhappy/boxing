/* SilentJab — Fight page stage (attack vs defence, config-driven demo)
 *
 * Reads window.FIGHT from ./assets/fight-config.js (single config file):
 *   glb       — model path, or an array of paths (the Next button cycles
 *               through them; a single path is simply re-fetched)
 *   active    — enabled punch names, e.g. ['jab']; all other buttons disabled
 *   message   — caption shown above the stage
 *   fps       — authored frame rate of the clips (30 for these Blender exports)
 *   hitFrame  — { move: frame } impact triggers at (frame - 1) / fps seconds
 *               into the attack clip, e.g. jab frame 13 -> 0.4s
 *   hitDelay  — fallback seconds AFTER the clip finishes (moves without a
 *               hitFrame entry)
 *   camera    — { position, target, fov } or useGlbCamera: true for the
 *               init-camera pose from the GLB
 *   controls  — { rotate, zoom, pan, minDistance, maxDistance }
 *
 * Model contract (from Blender export):
 *   - armature nodes named `attack-armature` / `defence-armature` at their
 *     exported positions (the page never moves them)
 *   - clips named `attack-*` / `defence-*` (ownership by name prefix)
 *   - an empty named `ancher1` on the defender (impact effect position)
 *
 * Flow: both characters idle on load. Clicking an enabled punch plays
 * `attack-{name}` once; at the configured hit moment the defender plays
 * `defence-hit` once and an impact effect flashes on `ancher1` (it follows
 * the anchor as the head snaps back). Everything settles back to the idles.
 * The scene can be orbited by mouse drag.
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

/* ---------- config ---------- */
const CFG = window.FIGHT || {};
const FPS = Math.max(1, Number(CFG.fps) || 30) || 30;
const HIT_DELAY = Math.max(0, Number(CFG.hitDelay ?? 1) || 0);

/* The 6 punch buttons. `clips` are candidate clip names tried in order —
 * exports name them inconsistently ("attack-cross" vs "attack-cross2"),
 * so the first clip that exists in the GLB wins. `match` are the config
 * aliases accepted in window.FIGHT.active. */
const PUNCHES = [
  { key: 'jab',           label: 'Jab',           match: ['jab'],           clips: ['attack-jab'] },
  { key: 'cross',         label: 'Cross',         match: ['cross'],         clips: ['attack-cross', 'attack-cross2'] },
  { key: 'lead-hook',     label: 'Lead Hook',     match: ['lead hook', 'lead-hook', 'leadhook'], clips: ['attack-lead-hook'] },
  { key: 'rear-hook',     label: 'Rear Hook',     match: ['rear hook', 'rear-hook', 'rearhook'], clips: ['attack-rear-hook', 'attack-rear-hook2'] },
  { key: 'lead-uppercut', label: 'Lead Uppercut', match: ['lead uppercut', 'lead-uppercut', 'leaduppercut'], clips: ['attack-lead-uppercut'] },
  { key: 'rear-uppercut', label: 'Rear Uppercut', match: ['rear uppercut', 'rear-uppercut', 'rearuppercut'], clips: ['attack-rear-uppercut'] },
];

/* first clip of `punch` that exists on the attack character (null if none) */
function clipFor(punch) {
  const a = chars['attack'];
  if (!a) return null;
  for (const name of punch.clips) if (a.actions[name]) return name;
  return null;
}

/* ---------- DOM ---------- */
const canvas = document.getElementById('fight-canvas');
const barEl = document.getElementById('fight-bar');
const loadingEl = document.getElementById('fight-loading');
const loadingText = document.getElementById('fight-loading-text');
const errorEl = document.getElementById('fight-error');
const msgEl = document.getElementById('fight-message');
const soundBtn = document.getElementById('fight-sound');

/* ---------- renderer / scene ---------- */
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.25;

const scene = new THREE.Scene();

const camera = new THREE.PerspectiveCamera(30, 1, 0.05, 100);

/* ---------- aspect-aware framing ----------
 * The shot is composed for the desktop stage (16 / 9.5): two fighters side by
 * side, filling ~88% of the frame width. A phone stage is 4 / 3.2, so the very
 * same vertical lens covers much less width — the pair then overflows both
 * edges and reads as "too big". Keep the horizontal coverage identical to the
 * desktop shot by widening the lens on narrow viewports.
 * Widening the FOV is used instead of dollying back on purpose: OrbitControls
 * owns the camera distance, so moving it here would reset the visitor's zoom
 * every time the mobile URL bar collapses. */
const REF_ASPECT = 16 / 9.5;      // aspect the camera pose was composed for
const MAX_FIT_FOV = 46;           // stop before the perspective gets fish-eyed
let baseFov = camera.fov;         // lens before fitting (config / GLB / 30)
let fitAspectRef = 0;             // aspect the current FOV was fitted to

function fittedFov(aspect) {
  if (CFG.fitNarrow === false || !(aspect > 0) || aspect >= REF_ASPECT) return baseFov;
  const spread = (REF_ASPECT / aspect) * (CFG.narrowExtra || 1);
  const halfTan = Math.tan((baseFov * Math.PI) / 360) * spread;
  return Math.min(MAX_FIT_FOV, (2 * Math.atan(halfTan) * 180) / Math.PI);
}

function applyFraming() {
  const aspect = camera.aspect;
  /* only re-fit when the aspect really changed (>4%): the mobile URL bar
   * collapsing resizes the canvas by a few percent and must not nudge the lens */
  if (!fitAspectRef || Math.abs(aspect - fitAspectRef) / fitAspectRef > 0.04) {
    fitAspectRef = aspect;
    const fov = fittedFov(aspect);
    if (Math.abs(fov - camera.fov) > 0.01) camera.fov = fov;
  }
  camera.updateProjectionMatrix();
}

/* mouse orbit — enabled once the camera pose is known */
const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.enablePan = CFG.controls?.pan !== undefined ? !!CFG.controls.pan : false;
controls.enableZoom = CFG.controls?.zoom !== undefined ? !!CFG.controls.zoom : true;
controls.enableRotate = CFG.controls?.rotate !== undefined ? !!CFG.controls.rotate : true;
if (CFG.controls?.minDistance) controls.minDistance = CFG.controls.minDistance;
if (CFG.controls?.maxDistance) controls.maxDistance = CFG.controls.maxDistance;
controls.update();

/* lights — same setup as home-stage.js for visual consistency */
scene.add(new THREE.HemisphereLight(0xd9e8ff, 0x3a3630, 2.0));
const keyLight = new THREE.DirectionalLight(0xffe8d2, 3.4);
keyLight.position.set(2.2, 3.2, 2.6);
scene.add(keyLight);
const rimLight = new THREE.DirectionalLight(0x86b8ff, 2.0);
rimLight.position.set(-2.4, 2.0, -2.6);
scene.add(rimLight);
const fillLight = new THREE.DirectionalLight(0xffffff, 0.9);
fillLight.position.set(0, 1.4, 4);
scene.add(fillLight);

/* ---------- resize ---------- */
function resize() {
  const w = canvas.clientWidth || canvas.parentElement.clientWidth;
  const h = canvas.clientHeight || canvas.parentElement.clientHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / Math.max(1, h);
  applyFraming();
}
new ResizeObserver(resize).observe(canvas.parentElement);
resize();

/* ---------- state ---------- */
let model = null;               // gltf.scene
let ancher1 = null;             // defender's impact anchor
let bodySize = 0.9;             // fighting height (effect scaling)
let phase = 'idle';             // idle → attacking → hitting
let settleTimer = 0;
let pendingHit = null;          // { action, at } — fires when action.time >= at
let loadingToken = 0;           // invalidates stale GLB loads after a refresh
const chars = {};               // 'attack' | 'defence' → { root, mixer, actions }

/* ---------- helpers ---------- */
function forceOpaque(mat) {
  if (!mat || !mat.transparent) return;
  mat.transparent = false;
  mat.depthWrite = true;
  mat.alphaTest = 0;
  mat.needsUpdate = true;
}

function showError(msg) {
  loadingEl.classList.add('hidden');
  errorEl.hidden = false;
  errorEl.textContent = msg;
  console.error('[fight]', msg);
}

/* play a one-shot clip on a character, then blend back to its idle.
 * Invariant: the character's total animation weight must stay at 1 —
 * if it ever dips below 1 the mixer blends toward the BIND POSE, which
 * for these Tripo exports is the model lying flat on the ground. */
function playOnce(charKey, clipName, onDone) {
  const c = chars[charKey];
  if (!c || !c.actions[clipName]) return false;
  const action = c.actions[clipName];
  const idle = c.actions[c.idleClip];
  if (c.currentAction && c.currentAction !== action) c.currentAction.fadeOut(0.12);
  action.reset();
  action.setLoop(THREE.LoopOnce, 1);
  /* hold the final frame after finishing (weight stays 1) so the blend
   * back to idle never exposes the bind pose */
  action.clampWhenFinished = true;
  action.fadeIn(0.12).play();
  c.currentAction = action;
  c.current = clipName;
  c.onShotDone = () => {
    /* cross-fade: action 1→0 while idle 0→1, weights sum to 1 throughout.
     * (fadeIn schedules an absolute 0→1 ramp, so no manual weight reset —
     * setEffectiveWeight(0) would zero the BASE weight and pin the idle
     * at zero forever since fadeIn multiplies into it.) */
    action.fadeOut(0.22);
    if (idle) {
      idle.reset();
      idle.fadeIn(0.22).play();
      c.currentAction = idle;
      c.current = c.idleClip;
    }
    if (onDone) onDone();
  };
  return true;
}

/* one-shot completion: fire when the mixer stops (weight 0 after fade-out) */
function wireFinished(charKey) {
  const c = chars[charKey];
  if (!c) return;
  c.mixer.addEventListener('finished', () => {
    if (c.onShotDone) { const f = c.onShotDone; c.onShotDone = null; f(); }
  });
}

/* ---------- attacker root poses ----------
 * Each punch is authored in Blender at its own armature transform (that is
 * what makes the fist reach the defender's head). CFG.attackPoses holds the
 * converted glTF transforms; we tween the attack ROOT between poses — the
 * mixer only drives bones under the root, so both can run at once. */
const POSES = CFG.attackPoses || {};
let poseTween = null;           // { root, fromP, toP, fromQ, toQ, t, dur, then }

function poseOk(pose) {
  return !!(pose && Array.isArray(pose.t) && Array.isArray(pose.q));
}

function applyPose(root, pose) {
  if (!poseOk(pose)) return false;
  root.position.set(pose.t[0], pose.t[1], pose.t[2]);
  root.quaternion.set(pose.q[0], pose.q[1], pose.q[2], pose.q[3]);
  return true;
}

function tweenPose(root, pose, dur, then) {
  if (!poseOk(pose)) { if (then) then(); return; }
  poseTween = {
    root,
    fromP: root.position.clone(),
    toP: new THREE.Vector3(pose.t[0], pose.t[1], pose.t[2]),
    fromQ: root.quaternion.clone(),
    toQ: new THREE.Quaternion(pose.q[0], pose.q[1], pose.q[2], pose.q[3]),
    t: 0, dur: Math.max(0.01, dur), then
  };
}

function updatePoseTween(dt) {
  if (!poseTween) return;
  poseTween.t += dt;
  const k = Math.min(1, poseTween.t / poseTween.dur);
  const e = k * k * (3 - 2 * k);            /* smoothstep */
  poseTween.root.position.lerpVectors(poseTween.fromP, poseTween.toP, e);
  poseTween.root.quaternion.slerpQuaternions(poseTween.fromQ, poseTween.toQ, e);
  if (k >= 1) { const done = poseTween; poseTween = null; if (done.then) done.then(); }
}

/* real skinned bounds — Box3.setFromObject only uses bind-pose geometry,
 * which is flat for these tripo exports. Sample deformed vertices instead. */
const _sv = new THREE.Vector3();
function sampleBounds(root, budget = 6000) {
  root.updateMatrixWorld(true);
  const meshes = [];
  let total = 0;
  root.traverse((o) => {
    if (!o.isMesh || !o.geometry) return;
    const pos = o.geometry.attributes && o.geometry.attributes.position;
    if (!pos || !pos.count) return;
    meshes.push(o);
    total += pos.count;
  });
  const step = Math.max(1, Math.floor(total / budget));
  const box = new THREE.Box3();
  const min = new THREE.Vector3(Infinity, Infinity, Infinity);
  const max = new THREE.Vector3(-Infinity, -Infinity, -Infinity);
  for (const o of meshes) {
    const pos = o.geometry.attributes.position;
    for (let i = 0; i < pos.count; i += step) {
      _sv.fromBufferAttribute(pos, i);
      if (o.isSkinnedMesh) o.applyBoneTransform(i, _sv);
      _sv.applyMatrix4(o.matrixWorld);
      min.min(_sv); max.max(_sv);
    }
  }
  box.set(min, max);
  return box;
}

/* ---------- camera ---------- */
function setupCamera(root, center, bodySize) {
  const cfgCam = CFG.camera || {};
  const target = new THREE.Vector3(...(cfgCam.target || [center.x, center.y, center.z]));

  if (!CFG.useGlbCamera && Array.isArray(cfgCam.position) && cfgCam.position.length === 3) {
    /* config camera wins */
    camera.position.set(...cfgCam.position);
    if (cfgCam.fov) baseFov = cfgCam.fov;
  } else {
    /* GLB init-camera: keep its position, focal length and clipping planes,
     * aim at the fighters (the authored rotation points away from them) */
    const camNode = root.getObjectByName('init-camera');
    if (camNode && camNode.isCamera) {
      camNode.updateWorldMatrix(true, false);
      camera.position.setFromMatrixPosition(camNode.matrixWorld);
      if (camNode.isPerspectiveCamera && !cfgCam.fov) {
        baseFov = camNode.fov;
        camera.near = camNode.near;
        camera.far = camNode.far;
      }
      camera.updateProjectionMatrix();
    } else {
      console.warn('[fight] no init-camera node in the GLB; using the side fallback view');
      /* Side-on view matching the reference shot: both fighters seen from
       * the side (defender left / attacker right), camera at chest height
       * looking straight along -Z, both bodies fully in frame. */
      baseFov = 30;
      camera.position.set(center.x, center.y + bodySize * 0.08, center.z + bodySize * 1.62);
      target.set(center.x, center.y - bodySize * 0.02, center.z);
      camera.updateProjectionMatrix();
    }
  }

  /* re-fit the lens to the current viewport (a phone gets a wider one) */
  fitAspectRef = 0;
  applyFraming();

  camera.updateMatrixWorld(true);
  controls.target.copy(target);
  controls.update();
  console.log('[fight] camera at', camera.position.toArray().map((n) => +n.toFixed(2)).join(', '),
    'target', target.toArray().map((n) => +n.toFixed(2)).join(', '),
    'fov', +camera.fov.toFixed(1), '(base', +baseFov.toFixed(1) + ')');
}

/* ---------- load GLB ---------- */
const GLB_SRC = Array.isArray(CFG.glb) ? CFG.glb[0] : CFG.glb;
function disposeModel() {
  pendingHit = null;
  for (const e of effects) {
    scene.remove(e.sprite); scene.remove(e.light);
    e.sprite.material.dispose();
  }
  effects.length = 0;
  for (const c of Object.values(chars)) c.mixer.stopAllAction();
  for (const k of Object.keys(chars)) delete chars[k];
  if (model) {
    scene.remove(model);
    model.traverse((o) => {
      if (o.isMesh) {
        o.geometry?.dispose();
        const mats = Array.isArray(o.material) ? o.material : (o.material ? [o.material] : []);
        for (const m of mats) { for (const tex of Object.values(m)) if (tex && tex.isTexture) tex.dispose(); m.dispose(); }
      }
    });
    model = null;
  }
  ancher1 = null;
}

function load() {
  const src = GLB_SRC;
  if (!src) { showError('No glb configured. Set window.FIGHT.glb in assets/fight-config.js.'); return; }
  let glbUrl;
  try { glbUrl = new URL(src, document.baseURI).href; } catch { glbUrl = src; }
  console.log('[fight] loading', src);

  const token = ++loadingToken;
  loadingEl.classList.remove('hidden');
  errorEl.hidden = true;
  loadingText.textContent = 'Loading 3D model…';

  new GLTFLoader().load(
    glbUrl,
    (gltf) => { if (token === loadingToken) onLoaded(gltf); },
    (e) => {
      if (token !== loadingToken || !e.total) return;
      loadingText.textContent = `Loading 3D model — ${(Math.min(1, e.loaded / e.total) * 100).toFixed(0)}%`;
    },
    (err) => {
      if (token !== loadingToken) return;
      showError('Failed to load: ' + src + '\n' + (err && err.message ? err.message : err));
    }
  );
}

function onLoaded(gltf) {
  disposeModel();
  model = gltf.scene;
  model.traverse((o) => {
    if (o.isMesh && o.material) {
      for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
        forceOpaque(m);
        m.envMapIntensity = 0.6;
      }
    }
  });
  scene.add(model);

  /* 1. find the two armatures. Exports use "attack-armature" /
   * "defence-armature"; the combined Tripo export names them plainly
   * "attack" / "defence", so fall back to a prefix match on root children. */
  const atkRoot = model.getObjectByName('attack-armature') ||
    model.children.find((c) => /^attack/i.test(c.name || ''));
  const defRoot = model.getObjectByName('defence-armature') ||
    model.children.find((c) => /^defence/i.test(c.name || ''));
  if (!atkRoot || !defRoot) {
    showError('Expected "attack-armature" and "defence-armature" nodes in the GLB, found: '
      + model.children.map((c) => c.name).join(', '));
    return;
  }

  /* Layout contract: the red defender stands on the LEFT of the stage and
   * the black attacker on the RIGHT (i.e. defence.x < attack.x in world
   * space, camera looking down -Z). The Blender export already places them
   * so; this is a guard that swaps their X positions if an export flips it.
   * (We move whole roots — clips stay bound to their own armature.) */
  model.updateMatrixWorld(true);
  const atkX = new THREE.Vector3().setFromMatrixPosition(atkRoot.matrixWorld).x;
  const defX = new THREE.Vector3().setFromMatrixPosition(defRoot.matrixWorld).x;
  if (defX > atkX) {
    console.warn('[fight] defence/attack are flipped — swapping X positions');
    atkRoot.position.setX(defX);
    defRoot.position.setX(atkX);
  }

  /* 2. clips: ownership by name prefix (attack-* / defence-*) */
  const clips = gltf.animations || [];
  const take = (root, re) => clips.filter((c) => re.test(c.name));
  const mkChar = (root, key, idleClip, re) => {
    const mixer = new THREE.AnimationMixer(root);
    const actions = {};
    for (const clip of take(root, re)) actions[clip.name] = mixer.clipAction(clip);
    const idle = actions[idleClip];
    if (idle) { idle.play(); }
    else console.warn('[fight] missing idle clip', idleClip, 'for', key);
    chars[key] = { root, mixer, actions, idleClip, current: idleClip, currentAction: idle, onShotDone: null };
    wireFinished(key);
    return chars[key];
  };
  mkChar(atkRoot, 'attack', 'attack-idle', /^attack[-_.]/i);
  mkChar(defRoot, 'defence', 'defence-idle', /^defence[-_.]/i);

  /* put the attacker on its idle stance (exports leave the root wherever
   * Blender had it — usually the last-punched pose, not the guard) */
  if (!applyPose(atkRoot, POSES.stance) && POSES.stance) {
    console.warn('[fight] attackPoses.stance is malformed — attacker keeps the exported pose');
  }

  /* 3. impact anchor on the defender. The contract is the empty named
   * `ancher1`, authored on the defender's neck bone in Blender and placed
   * at the impact point — hit effects and their follow target use it
   * directly. The head bone is only a fallback for exports without it. */
  let ancherNode = null;
  model.traverse((o) => { if (!ancherNode && /^ancher/i.test(o.name || '')) ancherNode = o; });
  if (ancherNode) {
    ancher1 = ancherNode;
  } else {
    let headBone = null;
    defRoot.traverse((o) => { if (!headBone && o.isBone && /mixamorigHead(_\d+)?$/.test(o.name || '')) headBone = o; });
    if (headBone) {
      ancher1 = headBone;
      console.log('[fight] no ancher* node — using defender head bone as impact anchor');
    }
  }
  if (!ancher1) console.warn('[fight] no ancher* node found — impact effect skipped');

  /* Settle one idle frame before measuring anything: skinning matrices are
   * only valid after the mixer has run once, otherwise the sampled bounds
   * are computed from unposed bones. */
  for (const c of Object.values(chars)) c.mixer.update(0.05);
  model.updateMatrixWorld(true);

  /* 4. camera (config pose, or GLB init-camera) + orbit controls target */
  const bounds = sampleBounds(model);
  const center = bounds.getCenter(new THREE.Vector3());
  bodySize = Math.max(0.4, bounds.max.y - bounds.min.y);
  setupCamera(model, center, bodySize);

  /* 5. UI: message + buttons from config */
  if (msgEl && CFG.message) {
    msgEl.textContent = CFG.message;
    msgEl.hidden = false;
  }
  buildButtons();

  loadingEl.classList.add('hidden');
  barEl.hidden = false;

  /* debug handle */
  window.__fight = {
    ready: true,
    model, camera, chars, ancher1, controls,
    phase: () => phase,
    clips: clips.map((c) => c.name),
    playPunch: (key) => clickPunch(PUNCHES.find((p) => p.key === key)),
    spawnHit: () => { if (ancher1) spawnHit(ancher1); },
    effects: () => effects.length,
    sound: () => SFX.stats()
  };
  console.log('[fight] clips:', clips.map((c) => c.name).join(', '));
}

/* ---------- impact effect (white core + orange ring flash on ancher1) ---------- */
const effects = [];
let sparkTex = null;

function getSparkTexture() {
  if (sparkTex) return sparkTex;
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  const cx = 64;
  /* soft core — warm enough to read against the pale stage */
  const rad = g.createRadialGradient(cx, cx, 2, cx, cx, 42);
  rad.addColorStop(0, 'rgba(255,255,255,1)');
  rad.addColorStop(0.28, 'rgba(255,206,140,1)');
  rad.addColorStop(0.62, 'rgba(255,132,48,0.85)');
  rad.addColorStop(1, 'rgba(255,110,30,0)');
  g.fillStyle = rad;
  g.fillRect(0, 0, 128, 128);
  /* star rays */
  g.strokeStyle = 'rgba(255,190,120,0.95)';
  g.lineWidth = 4;
  g.lineCap = 'round';
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + 0.35;
    g.beginPath();
    g.moveTo(cx + Math.cos(a) * 10, cx + Math.sin(a) * 10);
    g.lineTo(cx + Math.cos(a) * 54, cx + Math.sin(a) * 54);
    g.stroke();
  }
  /* ring */
  g.strokeStyle = 'rgba(255,120,36,1)';
  g.lineWidth = 7;
  g.beginPath();
  g.arc(cx, cx, 46, 0, Math.PI * 2);
  g.stroke();
  sparkTex = new THREE.CanvasTexture(c);
  return sparkTex;
}

function spawnHit(anchorObj) {
  const mat = new THREE.SpriteMaterial({
    map: getSparkTexture(), transparent: true, depthTest: false, depthWrite: false
  });
  const sprite = new THREE.Sprite(mat);
  sprite.renderOrder = 20;
  scene.add(sprite);

  const light = new THREE.PointLight(0xffb066, 0, bodySize * 1.2);
  scene.add(light);

  /* the effect follows the anchor: the defender's head snaps back during
   * defence-hit, so a fixed world position would drift off the head */
  effects.push({ sprite, light, follow: anchorObj, t: 0, dur: 0.5, size: bodySize });
}

function updateEffects(dt) {
  for (let i = effects.length - 1; i >= 0; i--) {
    const e = effects[i];
    e.t += dt;
    const k = e.t / e.dur;
    if (k >= 1) {
      scene.remove(e.sprite); scene.remove(e.light);
      e.sprite.material.dispose();
      effects.splice(i, 1);
      continue;
    }
    if (e.follow) {
      e.follow.updateWorldMatrix(true, false);
      e.sprite.position.setFromMatrixPosition(e.follow.matrixWorld);
      e.light.position.copy(e.sprite.position);
    }
    const ease = 1 - Math.pow(1 - k, 2);
    e.sprite.scale.setScalar(e.size * (0.20 + ease * 0.40));
    e.sprite.material.opacity = 1 - k * k;
    e.light.intensity = (1 - k) * e.size * 8;
  }
}

/* ---------- impact sound ---------- */
/* One decoded sample through WebAudio. The context is created and the buffer
 * decoded eagerly (allowed while it is still suspended), but playback only
 * becomes audible after the first user gesture resumes it — so clickPunch()
 * calls unlock() from inside the click handler. The mute choice is stored in
 * localStorage, therefore `sound.on` in the config only sets the first-visit
 * default. */
const SFX = (() => {
  const cfg = CFG.sound || {};
  const src = cfg.impact || './media/audio/punch-impact.wav';
  const volume = Math.min(1, Math.max(0, Number(cfg.volume ?? 0.85)));
  const KEY = 'silentjab.fight.muted';

  let ctx = null, buffer = null, ready = null, failed = false, plays = 0;
  let muted = readMuted();

  function readMuted() {
    try {
      const v = localStorage.getItem(KEY);
      if (v === '1') return true;
      if (v === '0') return false;
    } catch (e) { /* storage blocked — fall back to the config default */ }
    return cfg.on === false;
  }

  function audioContext() {
    if (ctx) return ctx;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) { failed = true; return null; }
    try { ctx = new AC(); } catch (e) { failed = true; return null; }
    return ctx;
  }

  function markUnavailable() {
    if (!soundBtn) return;
    soundBtn.disabled = true;
    soundBtn.title = 'Impact sound unavailable in this browser';
  }

  /* create + decode up front so the very first hit is not silent */
  function warm() {
    if (ready || failed) return ready;
    const c = audioContext();
    if (!c) { markUnavailable(); return null; }
    ready = fetch(src)
      .then((r) => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.arrayBuffer(); })
      .then((raw) => c.decodeAudioData(raw))
      .then((b) => { buffer = b; return b; })
      .catch((err) => {
        failed = true;
        console.warn('[fight] impact sound unavailable:', (err && err.message) || err);
        markUnavailable();
        return null;
      });
    return ready;
  }

  /* browsers suspend audio until a gesture — call this from a click handler */
  function unlock() {
    warm();
    const c = audioContext();
    if (c && c.state === 'suspended') c.resume().catch(() => {});
  }

  function play() {
    if (muted || failed) return;
    const c = audioContext();
    if (!c || !buffer) { warm(); return; }
    if (c.state === 'suspended') c.resume().catch(() => {});
    const node = c.createBufferSource();
    node.buffer = buffer;
    /* slight random detune + level: repeated hits must not sound machine-gunned */
    node.playbackRate.value = 0.94 + Math.random() * 0.12;
    const gain = c.createGain();
    gain.gain.value = volume * (0.82 + Math.random() * 0.18);
    node.connect(gain).connect(c.destination);
    node.start();
    plays++;
  }

  function setMuted(v) {
    muted = !!v;
    try { localStorage.setItem(KEY, muted ? '1' : '0'); } catch (e) {}
    if (!soundBtn) return;
    soundBtn.classList.toggle('is-muted', muted);
    soundBtn.setAttribute('aria-pressed', muted ? 'false' : 'true');
    soundBtn.title = muted ? 'Hit sound is off — click to turn it on'
                           : 'Hit sound is on — click to mute';
    const label = soundBtn.querySelector('.txt');
    if (label) label.textContent = muted ? 'Muted' : 'Sound';
  }

  return {
    warm, unlock, play, setMuted,
    isMuted: () => muted,
    available: () => !failed,
    stats: () => ({
      muted, failed, plays,
      decoded: !!buffer,
      ctxState: ctx ? ctx.state : null
    })
  };
})();

/* ---------- buttons ---------- */
function normName(s) { return String(s || '').trim().toLowerCase(); }

/* normalize a config key to a punch key: "lead hook" -> "lead-hook" */
function normKey(s) { return normName(s).replace(/\s+/g, '-'); }

function buildButtons() {
  const activeCfg = new Set((Array.isArray(CFG.active) ? CFG.active : []).map(normName));
  barEl.innerHTML = '';

  for (let i = 0; i < PUNCHES.length; i++) {
    const punch = PUNCHES[i];
    const clipName = clipFor(punch);
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'fight-btn';
    btn.dataset.key = punch.key;

    const num = document.createElement('span');
    num.className = 'fight-btn-num';
    num.textContent = String(i + 1);
    const label = document.createElement('span');
    label.className = 'fight-btn-label';
    label.textContent = punch.label;
    btn.append(num, label);

    const inConfig = punch.match.some((m) => activeCfg.has(normName(m)));
    if (inConfig && clipName) {
      btn.classList.add('active');
      btn.dataset.clip = clipName;
      btn.title = `${i + 1}: ${punch.label}`;
      btn.addEventListener('click', () => clickPunch(punch));
    } else {
      btn.classList.add('disabled');
      btn.disabled = true;
      btn.title = clipName ? 'Disabled in this demo (edit active in assets/fight-config.js)'
                           : `Clip not found in the GLB (tried: ${punch.clips.join(', ')})`;
      if (inConfig && !clipName) console.warn('[fight] config enables "%s" but no clip matched (tried: %s)',
        punch.label, punch.clips.join(', '));
    }
    barEl.appendChild(btn);
  }
}

function lockButtons(locked) {
  for (const btn of barEl.querySelectorAll('.fight-btn:not(.disabled)')) {
    btn.disabled = locked;
  }
  barEl.classList.toggle('locked', locked);
}

/* the stage's top-left "Sound" toggle */
if (soundBtn) {
  soundBtn.hidden = false;
  SFX.setMuted(SFX.isMuted());
  soundBtn.addEventListener('click', () => {
    const turnOff = !SFX.isMuted();
    SFX.setMuted(turnOff);
    /* turning it back on plays one sample so the visitor hears the change */
    if (!turnOff) { SFX.unlock(); SFX.play(); }
    soundBtn.blur();
  });
}

/* ---------- hit timing ---------- */
/* Config hitFrame accepts both "jab" and "lead hook" spellings.
 * Time = (frame - 1) / fps. jab frame 13 @30fps -> 0.4s into the clip. */
function hitTimeFor(punch) {
  const table = CFG.hitFrame || {};
  for (const alias of punch.match) {
    const f = Number(table[alias] ?? table[normKey(alias)]);
    if (f >= 2) return (f - 1) / FPS;
  }
  return null; /* fall back to hitDelay after the clip finishes */
}

/* ---------- click flow ---------- */
function clickPunch(punch) {
  if (!punch || phase !== 'idle') return;
  const clipName = clipFor(punch);
  if (!clipName) return;
  const attack = chars['attack'];

  phase = 'attacking';
  lockButtons(true);
  if (msgEl && CFG.message) msgEl.textContent = CFG.message;

  /* this runs inside a click handler → the one place audio can be unlocked */
  SFX.unlock();

  const hitAt = hitTimeFor(punch);
  const action = attack.actions[clipName];

  const startClip = () => {
    playOnce('attack', clipName, () => {
      /* back to the guard stance while the idle blend runs */
      tweenPose(attack.root, POSES.stance, 0.32);
      /* no hitFrame configured → old behaviour: hit after the clip finishes */
      if (hitAt == null) {
        setTimeout(() => { if (phase === 'attacking') fireHit(); }, HIT_DELAY * 1000);
      }
      /* else: pendingHit in the render loop fires mid-clip at hitAt */
    });

    if (hitAt != null) {
      pendingHit = { action, at: hitAt, fired: false };
      console.log('[fight] %s: frame %s @%sfps → hit at %ss into the clip',
        punch.key, Math.round(hitAt * FPS) + 1, FPS, hitAt.toFixed(2));
    }
  };

  /* step into the authored pose first, then throw (short tween — the clip
   * itself starts from its guard so the blend reads as a setup step) */
  if (!poseOk(POSES[punch.key])) startClip();
  else tweenPose(attack.root, POSES[punch.key], 0.16, startClip);
}

/* impact moment: the defender reacts and the effect flashes on the anchor.
 * If the GLB has no `defence-hit` clip (e.g. the combined Tripo export),
 * the spark + sound still fire and the page just settles back to idle. */
function settleAfterHit() {
  phase = 'idle';
  clearTimeout(settleTimer);
  settleTimer = setTimeout(() => { if (phase === 'idle') lockButtons(false); }, 250);
}

function fireHit() {
  pendingHit = null;
  phase = 'hitting';
  if (ancher1) spawnHit(ancher1);
  SFX.play();
  const def = chars['defence'];
  if (def && def.actions['defence-hit']) {
    playOnce('defence', 'defence-hit', settleAfterHit);
  } else {
    settleAfterHit();
  }
}

/* ---------- render loop ---------- */
const clock = new THREE.Clock();
renderer.setAnimationLoop(() => {
  const dt = clock.getDelta();
  for (const c of Object.values(chars)) c.mixer.update(dt);
  updatePoseTween(dt);

  /* mid-clip impact: fire when the attack action reaches the hit frame */
  if (pendingHit && !pendingHit.fired) {
    if (pendingHit.action.time >= pendingHit.at) {
      pendingHit.fired = true;
      fireHit();
    }
  }

  updateEffects(dt);
  controls.update();
  renderer.render(scene, camera);
});

/* ---------- start ---------- */
load();
/* Warm the impact sample on the first gesture instead of at load time: an
 * AudioContext created without one is born suspended (and some browsers log a
 * warning), while decoding 47 KB takes a few ms — well inside the 0.4 s that
 * separates the click from the first hit. */
window.addEventListener('pointerdown', () => SFX.warm(), { once: true });
window.addEventListener('keydown', () => SFX.warm(), { once: true });
