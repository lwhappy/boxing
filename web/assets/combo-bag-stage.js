/* SilentJab — combo air stage (combos/ pages)
 *
 * Plays ONE pre-composed combo clip straight from man-combos.glb (the same
 * file every other combos page uses) — no per-punch stitching, so the motion
 * is continuous and the fighter never snaps backward between punches.
 *
 * The fullscreen show is a TRANSPARENT fixed overlay anchored BELOW the site
 * header + breadcrumb row (--show-top measured in JS): the fighter stands
 * center-screen and throws the combo IN THE AIR — no bag, no annotations —
 * at a fast pace, with a whoosh on every punch. When it ends the stage docks
 * bottom-left exactly like the moves pages.
 *
 * Page config: window.COMBO_AIR = { glb, clip, trimStart }.
 * QA: window.__move.
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const CFG = window.COMBO_AIR || {};
const GLB_URL = CFG.glb || '../media/glb/man-combos.glb?v=1';
const CLIP_NAME = CFG.clip || 'combo_jab_cross_hook';
const TRIM_START = typeof CFG.trimStart === 'number' ? CFG.trimStart : 1.5;  // cut pre-punch guard
const TRIM_END = typeof CFG.trimEnd === 'number' ? CFG.trimEnd : 0;          // cut post-combo recovery shuffle
const SPEED = 1.5;           // global playback speed-up ("快一点")
const SETTLE_T = 1.2;        // hold on the last frame before the paused overlay

const canvas = document.getElementById('stage-canvas');
const stageEl = canvas.parentElement;
const hostEl = stageEl.closest('.jab-stage') || stageEl;
const loadingEl = document.getElementById('stage-loading');
const loadingText = document.getElementById('stage-loading-text');
const errorEl = document.getElementById('stage-error');
const replayBtn = document.getElementById('jab-replay');
const bigReplayBtn = document.getElementById('jab-replay-big');
const closeBtn = document.getElementById('jab-close');

/* ---------- renderer / scene (transparent) ---------- */
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setClearColor(0x000000, 0);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.42;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 60);

const controls = new OrbitControls(camera, canvas);
controls.enabled = false;
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.enableZoom = false;
controls.enablePan = false;
controls.rotateSpeed = 0.85;
controls.minDistance = 1.8;
controls.maxDistance = 8.5;
controls.minPolarAngle = 0.35;
controls.maxPolarAngle = Math.PI / 2 + 0.12;
canvas.style.touchAction = 'pan-y';

scene.add(new THREE.HemisphereLight(0xe6f0ff, 0x4a4640, 2.9));
const key = new THREE.DirectionalLight(0xffe8d2, 4.0);
key.position.set(2.2, 3.2, 2.6);
scene.add(key);
const rim = new THREE.DirectionalLight(0x86b8ff, 3.2);
rim.position.set(-2.4, 2.0, -2.6);
scene.add(rim);
const fill = new THREE.DirectionalLight(0xffffff, 1.0);
fill.position.set(0, 1.4, 4);
scene.add(fill);
const headFill = new THREE.DirectionalLight(0xeaf2ff, 1.5);
scene.add(headFill, headFill.target);

/* ---------- sizing + site chrome click-through ---------- */
function resize() {
  const w = stageEl.clientWidth || 1;
  const h = stageEl.clientHeight || 1;
  renderer.setSize(w, h, false);
  camera.aspect = w / Math.max(1, h);
  camera.updateProjectionMatrix();
}
new ResizeObserver(resize).observe(stageEl);
resize();

function chromeBottom() {
  for (const sel of ['.breadcrumbs', '.site-head']) {
    const el = document.querySelector(sel);
    if (!el) continue;
    const r = el.getBoundingClientRect();
    if (r.height > 0) return Math.max(0, Math.round(r.bottom));
  }
  return 0;
}
function applyShowTop() {
  hostEl.style.setProperty('--show-top', chromeBottom() + 'px');
}
window.addEventListener('resize', applyShowTop);
window.addEventListener('scroll', applyShowTop, { passive: true });
applyShowTop();

/* ---------- sfx: whoosh on every punch ---------- */
let audioCtx = null;
function ac() {
  if (!audioCtx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    try { audioCtx = new AC(); } catch { return null; }
  }
  if (audioCtx.state === 'suspended') audioCtx.resume().catch(() => {});
  return audioCtx;
}
for (const ev of ['pointerdown', 'keydown', 'touchstart']) {
  window.addEventListener(ev, ac, { passive: true });
}
function playWhoosh() {
  const ctx = ac();
  if (!ctx || ctx.state !== 'running') return;
  const dur = 0.24;
  const buf = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * dur), ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const bp = ctx.createBiquadFilter();
  bp.type = 'bandpass';
  bp.Q.value = 1.1;
  const t0 = ctx.currentTime;
  bp.frequency.setValueAtTime(420, t0);
  bp.frequency.exponentialRampToValueAtTime(1500, t0 + dur * 0.55);
  bp.frequency.exponentialRampToValueAtTime(520, t0 + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.linearRampToValueAtTime(0.42, t0 + dur * 0.35);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  src.connect(bp).connect(g).connect(ctx.destination);
  src.start(t0);
  src.stop(t0 + dur);
}

/* ---------- loading ---------- */
function loadGLB(url) {
  return new Promise((res, rej) => new GLTFLoader().load(new URL(url, import.meta.url).href, res,
    (e) => { if (e.total) loadingText.textContent = `Loading 3D model — ${Math.min(100, Math.round(e.loaded / e.total * 100))}%`; },
    rej));
}

function fail(err) {
  hostEl.classList.remove('jab-live');
  loadingEl.classList.add('hidden');
  errorEl.hidden = false;
  errorEl.textContent = 'Failed to load the 3D model.\n' + (err && err.message ? err.message : err);
  console.error('[combo-air]', err);
}

/* ---------- fighter ---------- */
const fighter = { group: new THREE.Group(), mixer: null, actions: {}, bones: {} };
scene.add(fighter.group);
const _sv = new THREE.Vector3();

function fixMaterials(root) {
  root.traverse((o) => {
    if (o.isMesh && o.material) {
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      for (let mi = 0; mi < mats.length; mi++) {
        let m = mats[mi];
        if (m.isMeshStandardMaterial) {
          m = new THREE.MeshPhongMaterial({
            map: mats[mi].map || null,
            normalMap: mats[mi].normalMap || null,
            normalScale: mats[mi].normalScale ? mats[mi].normalScale.clone() : undefined,
            color: mats[mi].color.clone(),
            side: mats[mi].side,
            transparent: mats[mi].transparent,
            opacity: mats[mi].opacity,
            alphaTest: mats[mi].alphaTest,
            shininess: 16,
            specular: new THREE.Color(0x181818),
          });
          if (Array.isArray(o.material)) o.material[mi] = m;
          else o.material = m;
        }
        m.transparent = false;
        m.opacity = 1;
        if (m.transparent) { m.transparent = false; m.depthWrite = true; m.alphaTest = 0; }
      }
    }
    if (o.isMesh) { o.frustumCulled = false; o.castShadow = false; }
  });
}
function boneByName(root, key) {
  const norm = (s) => s.replace(/[^a-z]/gi, '').toLowerCase();
  const want = norm(key);
  let found = null;
  root.traverse((o) => {
    if (!found && o.isBone && norm(o.name).endsWith(want)) found = o;
  });
  return found;
}
function samplePose(root, budget = 9000) {
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
  const pts = [];
  for (const o of meshes) {
    const pos = o.geometry.attributes.position;
    for (let i = 0; i < pos.count; i += step) {
      _sv.fromBufferAttribute(pos, i);
      if (o.isSkinnedMesh) o.applyBoneTransform(i, _sv);
      _sv.applyMatrix4(o.matrixWorld);
      pts.push(_sv.clone());
    }
  }
  return pts;
}

function buildFighter(gltf) {
  const root = gltf.scene;
  fixMaterials(root);
  fighter.root = root;
  fighter.group.add(root);
  /* 3/4 view: this rig punches toward -Z, so +PI/2+0.35 turns the punch
   * direction to screen-left with the chest angled toward the camera
   * (world punch dir ≈ (-0.94, 0, +0.34) — same as the old combo3-man) */
  fighter.group.rotation.y = Math.PI / 2 + 0.35;
  root.updateMatrixWorld(true);
  for (const n of ['LeftHand', 'RightHand', 'Hips']) fighter.bones[n] = boneByName(root, n);
  fighter.mixer = new THREE.AnimationMixer(root);
  for (const clip of gltf.animations) {
    if (/Layer0$/.test(clip.name)) continue;
    const act = fighter.mixer.clipAction(clip);
    act.enabled = true;
    fighter.actions[clip.name] = act;
  }
  /* CRITICAL: this rig's bind pose is HORIZONTAL (the character lies down) —
   * never fade an action in from weight 0 (the skeleton collapses from the
   * floor back to standing). Always hard-cut at full weight. */
  const refClip = Object.values(fighter.actions)[0];
  refClip.reset().setEffectiveWeight(1).play();
  fighter.mixer.setTime(0.5);
  fighter.mixer.update(0);
  let pts = samplePose(root, 4000);
  const ext = (k) => Math.max(...pts.map((p) => p[k])) - Math.min(...pts.map((p) => p[k]));
  if (ext('y') < ext('z')) {
    root.rotation.x = -Math.PI / 2;
    root.updateMatrixWorld(true);
    pts = samplePose(root, 4000);
  }
  /* normalize on a standing pose so the docked widget matches the other pages */
  const h0 = ext('y');
  root.scale.setScalar(1.72 / h0);
  root.updateMatrixWorld(true);
  pts = samplePose(root);
  root.position.y -= Math.min(...pts.map((p) => p.y));
  root.updateMatrixWorld(true);
  const hipsB = fighter.bones.Hips || boneByName(root, 'mixamorig:Hips');
  if (hipsB) {
    const hv = new THREE.Vector3();
    hipsB.getWorldPosition(hv);
    const dl = hv.multiplyScalar(-1).applyQuaternion(fighter.group.quaternion.clone().invert());
    root.position.x += dl.x;
    root.position.z += dl.z;
    root.updateMatrixWorld(true);
  }
  fighter.mixer.stopAllAction();
}

/* ---------- single composed combo clip ---------- */
/* Trim the first `startSec` seconds off a clip (lightweight subclip). */
function trimClipStart(sourceClip, startSec) {
  const newTracks = [];
  for (const track of sourceClip.tracks) {
    const times = track.times;
    const values = track.values;
    const itemSize = track.ValueItemSize || values.length / times.length;
    let firstIdx = -1, lastIdx = -1;
    for (let i = 0; i < times.length; i++) {
      if (times[i] >= startSec) { if (firstIdx === -1) firstIdx = i; lastIdx = i; }
    }
    if (firstIdx === -1) continue;
    if (firstIdx > 0) firstIdx--;
    const count = lastIdx - firstIdx + 1;
    const newTimes = new Float32Array(count);
    const newValues = new values.constructor(count * itemSize);
    for (let i = 0; i < count; i++) {
      const srcIdx = firstIdx + i;
      newTimes[i] = Math.max(0, times[srcIdx] - startSec);
      for (let j = 0; j < itemSize; j++) newValues[i * itemSize + j] = values[srcIdx * itemSize + j];
    }
    newTracks.push(new track.constructor(track.name, newTimes, newValues, track.getInterpolation()));
  }
  return new THREE.AnimationClip(sourceClip.name + '_trimmed', sourceClip.duration - startSec, newTracks);
}

let comboClip = null;

/* Trim everything AFTER `endSec` off a clip (keys beyond the end are simply
 * dropped; the interpolator clamps on the last kept key). Used to cut the
 * recovery shuffle the composed clip does after the final punch — it reads
 * as a stutter-step at 1.5x. */
function trimClipEnd(sourceClip, endSec) {
  const newTracks = [];
  for (const track of sourceClip.tracks) {
    const times = track.times;
    const values = track.values;
    const itemSize = track.ValueItemSize || values.length / times.length;
    let lastIdx = -1;
    for (let i = 0; i < times.length; i++) {
      if (times[i] <= endSec) lastIdx = i;
    }
    if (lastIdx < 0) continue;
    const count = lastIdx + 1;
    const newTimes = new Float32Array(count);
    const newValues = new values.constructor(count * itemSize);
    newTimes.set(times.subarray(0, count));
    newValues.set(values.subarray(0, count * itemSize));
    newTracks.push(new track.constructor(track.name, newTimes, newValues, track.getInterpolation()));
  }
  return new THREE.AnimationClip(sourceClip.name + '_cut', Math.min(endSec, sourceClip.duration), newTracks);
}

function buildComboClip(gltf) {
  let clip = THREE.AnimationClip.findByName(gltf.animations, CLIP_NAME) || gltf.animations[0];
  if (TRIM_START > 0 && clip.duration > TRIM_START + 0.5) clip = trimClipStart(clip, TRIM_START);
  if (TRIM_END > 0 && clip.duration > TRIM_END) clip = trimClipEnd(clip, TRIM_END);
  comboClip = clip;
  const act = fighter.mixer.clipAction(clip);
  act.enabled = true;
  fighter.actions.combo = act;
  console.log('[combo-air] clip', clip.name, 'dur', clip.duration.toFixed(2) + 's');
}

/* detect punch moments (full hand extension) in the composed clip to time the
 * whooshes — no manual per-punch data needed */
let whooshTimes = [];

function probeWhooshes() {
  const act = fighter.actions.combo;
  const dur = comboClip.duration;
  act.reset().setEffectiveTimeScale(1).setEffectiveWeight(1).play();
  const th = fighter.group.rotation.y;
  const fwd = new THREE.Vector3(Math.sin(th), 0, Math.cos(th));
  const N = 160;
  const hands = [];
  for (let i = 0; i <= N; i++) {
    fighter.mixer.setTime((dur * i) / N);
    fighter.mixer.update(0);
    fighter.group.updateMatrixWorld(true);
    const row = [];
    for (const n of ['LeftHand', 'RightHand']) {
      fighter.bones[n].getWorldPosition(_sv);
      row.push(_sv.dot(fwd));
    }
    hands.push(row);
  }
  fighter.mixer.stopAllAction();
  let maxV = 0;
  for (const row of hands) for (const v of row) maxV = Math.max(maxV, v);
  const raw = [];
  for (let i = 2; i < N - 1; i++) {
    for (let h = 0; h < 2; h++) {
      const v = hands[i][h];
      if (v > 0.55 * maxV && v > hands[i - 1][h] && v >= hands[i + 1][h]) {
        raw.push({ t: (dur * i) / N, v });
      }
    }
  }
  /* one whoosh per punch: keep the STRONGEST peak in every 0.45s window
   * (raw local maxima also fire on the arm coil between punches) */
  raw.sort((a, b) => b.v - a.v);
  whooshTimes = [];
  for (const p of raw) {
    if (whooshTimes.every((q) => Math.abs(q - p.t) > 0.45)) whooshTimes.push(p.t);
  }
  whooshTimes.sort((a, b) => a - b);
  console.log('[combo-air] whooshes at', whooshTimes.map((t) => t.toFixed(2)).join(', '));
}

/* ---------- show state ---------- */
let phase = 'load';        // combo | settle | paused | docked
let showT = 0;             // real seconds since resetShow
let settleT = 0;
let whooshIdx = 0;
let frames = 0;
let hipsX = 0;             // smoothed world x of the hips (for camera follow)

function resetShow() {
  phase = 'combo';
  showT = 0;
  settleT = 0;
  whooshIdx = 0;
  hipsX = 0;
  hostEl.classList.remove('jab-docked', 'jab-paused');
  hostEl.classList.add('jab-live');
  replayBtn.hidden = true;
  camera.position.set(0.55, 1.35, 4.4);
  controls.enabled = false;
  fighter.group.rotation.y = Math.PI / 2 + 0.35;
  fighter.group.position.set(0, 0, 0);
  /* HARD cut into the first frame of the clip — never fade (see bind-pose
   * note in buildFighter). */
  fighter.mixer.stopAllAction();
  const act = fighter.actions.combo;
  act.reset().setEffectiveTimeScale(SPEED).setEffectiveWeight(1);
  act.setLoop(THREE.LoopOnce, 1);
  act.clampWhenFinished = true;
  act.play();
  fighter.mixer.setTime(0);
  fighter.mixer.update(0);
  fighter.root.updateMatrixWorld(true);
  applyShowTop();
  resize();
}

function advance(dt) {
  showT += dt;
  const act = fighter.actions.combo;
  if (phase === 'combo') {
    fighter.mixer.update(dt);
    fighter.root.updateMatrixWorld(true);
    fighter.bones.Hips.getWorldPosition(_sv);
    hipsX = _sv.x;
    while (whooshIdx < whooshTimes.length && act.time >= whooshTimes[whooshIdx]) {
      playWhoosh();
      whooshIdx++;
    }
    if (act.time >= act.getClip().duration - 1e-4) {
      phase = 'settle';
      settleT = 0;
    }
  } else if (phase === 'settle') {
    fighter.mixer.update(dt);      // clamped: holds the final frame
    settleT += dt;
    if (settleT >= SETTLE_T) {
      phase = 'paused';
      hostEl.classList.add('jab-paused');
      controls.enabled = true;
      /* hand over to orbit at the fighter's final position */
      controls.target.set(hipsX * 0.8, 1.0, 0);
      controls.update();
    }
  } else if (phase === 'docked' || phase === 'paused') {
    fighter.mixer.update(dt);
  }
}

function dock() {
  phase = 'docked';
  hostEl.classList.remove('jab-live', 'jab-paused');
  hostEl.classList.add('jab-docked');
  replayBtn.hidden = false;
  fighter.group.rotation.y = Math.PI * 0.375;
  /* the combo's forward travel lives INSIDE the hips track — recenter the
   * group so the fighter stands mid-frame in the small widget */
  fighter.root.updateMatrixWorld(true);
  fighter.bones.Hips.getWorldPosition(_sv);
  fighter.group.position.x -= _sv.x;
  fighter.group.position.z -= _sv.z;
  fighter.mixer.stopAllAction();
  /* hold the final pose (no idle clip in this GLB) */
  const act = fighter.actions.combo;
  act.reset().setEffectiveTimeScale(SPEED).setEffectiveWeight(1);
  act.setLoop(THREE.LoopOnce, 1);
  act.clampWhenFinished = true;
  act.play();
  fighter.mixer.setTime(act.getClip().duration);
  fighter.mixer.update(0);
  resize();
  controls.target.set(0, 0.95, 0);
  _sv.copy(camera.position).sub(controls.target).setLength(2.9);
  camera.position.copy(controls.target).add(_sv);
  controls.enabled = true;
  controls.update();
}

/* ---------- camera (follows the fighter's forward travel, portrait aware) ---------- */
const _want = { pos: new THREE.Vector3(), tgt: new THREE.Vector3() };
let camFollowX = 0;
function computeCamera() {
  const aspect = camera.aspect || 1;
  const tanH = Math.tan(camera.fov * Math.PI / 360);
  /* fit a 2.4m-tall / 2.6m-wide action bubble, whichever needs more distance */
  const z = Math.max(3.6, 2.4 / (2 * tanH), 2.6 / (2 * tanH * aspect));
  const mid = camFollowX * 0.8;
  _want.tgt.set(mid, 1.02, 0);
  _want.pos.set(0.55 + mid, 1.32, z);
}
function updateCamera(dt) {
  if (controls.enabled) {
    controls.update();
    headFill.position.copy(camera.position).sub(controls.target).setLength(6).add(controls.target);
    headFill.target.position.copy(controls.target);
    return;
  }
  if (phase === 'combo') {
    camFollowX += (hipsX - camFollowX) * (1 - Math.exp(-dt * 2.2));
  } else if (phase !== 'settle') {
    camFollowX = 0;
  }
  computeCamera();
  camera.position.copy(_want.pos);
  camTgt.copy(_want.tgt);
  camera.lookAt(camTgt);
  headFill.position.copy(camera.position).sub(camTgt).setLength(6).add(camTgt);
  headFill.target.position.copy(camTgt);
}
const camTgt = new THREE.Vector3(0, 1.0, 0);

/* ---------- loop ---------- */
const clock = new THREE.Clock();
let running = false;
function frame() {
  const dt = Math.min(clock.getDelta(), 0.05);
  if (phase !== 'load') advance(dt);
  updateCamera(dt);
  frames++;
  renderer.render(scene, camera);
}
function startLoop() {
  if (running) return;
  clock.getDelta();
  renderer.setAnimationLoop(frame);
  running = true;
}
function stopLoop() {
  if (!running) return;
  renderer.setAnimationLoop(null);
  running = false;
}

replayBtn.addEventListener('click', () => { resetShow(); startLoop(); });
bigReplayBtn.addEventListener('click', () => { resetShow(); startLoop(); });
closeBtn.addEventListener('click', dock);

let visible = true;
if ('IntersectionObserver' in window) {
  new IntersectionObserver(([entry]) => {
    visible = entry.isIntersecting;
    if (visible && !document.hidden && phase !== 'load') startLoop();
    else if (running) stopLoop();
  }, { rootMargin: '120px' }).observe(stageEl);
}
document.addEventListener('visibilitychange', () => {
  if (document.hidden && running) stopLoop();
  else if (!document.hidden && visible && phase !== 'load') startLoop();
});

function build(gltf) {
  buildFighter(gltf);
  buildComboClip(gltf);
  probeWhooshes();
  loadingEl.classList.add('hidden');
  resetShow();
  startLoop();

  window.__move = {
    get phase() { return phase; },
    get t() { return showT; },
    get clipDur() { return comboClip.duration; },
    whooshTimes,
    get frames() { return frames; },
    get running() { return running; },
    woman: fighter, camera, THREE,
    restart: () => { resetShow(); startLoop(); },
    resume: () => startLoop(),
    stepTo(target) {
      stopLoop();
      const dt = 1 / 30;
      let guard = 0;
      while (showT < target - 1e-6 && guard++ < 3000) { advance(dt); updateCamera(dt); }
      updateCamera(1 / 30);
      renderer.render(scene, camera);
    },
  };
}

loadGLB(GLB_URL).then((gltf) => {
  try { build(gltf); }
  catch (err) { fail(err); }
}).catch(fail);
