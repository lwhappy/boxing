/* SilentJab — combo air stage (combos/ pages)
 *
 * The fullscreen show is a TRANSPARENT fixed overlay anchored BELOW the site
 * header + breadcrumb row (--show-top measured in JS): the fighter stands
 * center-screen and throws the combo IN THE AIR — no bag, no annotations —
 * at a fast pace. When the combo ends the stage docks bottom-left exactly
 * like the moves pages (same docked widget: fighter idling).
 *
 * Clips all come from ONE GLB (combo3-man.glb: guard / idle / jab / cross /
 * leadhook — retargeted from the game donor so every clip shares the same
 * upright convention). Page config: window.COMBO_AIR = { glb: '...' }.
 * QA: window.__move (same contract as move-stage.js).
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const CFG = window.COMBO_AIR || window.COMBO_BAG || {};
const GLB_URL = CFG.glb || '../media/glb/combo3-man.glb?v=1';
const SPEED = 1.5;           // global punch playback speed-up ("快一点")
const JAB_TRIM = 0.3;        // cut the jab's pre-punch torso wind-up rotation
const INTRO_T = 0.4;         // guard beat before the combo starts
const SETTLE_T = 1.2;        // idle beat after the combo before the overlay

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
function play(f, name, { fade = 0.2, clamp = false, loop = false, ts = 1 } = {}) {
  const next = f.actions[name];
  if (!next) return;
  next.reset();
  next.setLoop(loop ? THREE.LoopRepeat : THREE.LoopOnce, loop ? Infinity : 1);
  next.clampWhenFinished = clamp;
  next.setEffectiveTimeScale(ts);
  next.setEffectiveWeight(1);
  if (fade > 0) next.fadeIn(fade);
  next.play();
  for (const a of Object.values(f.actions)) {
    if (a === next) continue;
    /* stop() does NOT clear the cached _effectiveWeight — checking
     * getEffectiveWeight() would "fade out" dead actions and fadeIn()
     * RE-ACTIVATES them (stale clips blend into the show = the boot-time
     * somersault). Only fade actions that are actually running. */
    if (a.isRunning()) a.fadeOut(Math.max(fade, 0.001));
    else a.stop();
  }
}

function buildFighter(gltf) {
  const root = gltf.scene;
  fixMaterials(root);
  fighter.root = root;
  fighter.group.add(root);
  /* 3/4 view: faces screen-left, chest turned slightly toward the camera */
  fighter.group.rotation.y = -Math.PI / 2 + 0.35;
  root.updateMatrixWorld(true);
  for (const n of ['LeftHand', 'RightHand', 'Hips']) fighter.bones[n] = boneByName(root, n);
  fighter.mixer = new THREE.AnimationMixer(root);
  for (const clip of gltf.animations) {
    if (/Layer0$/.test(clip.name)) continue;
    const act = fighter.mixer.clipAction(clip);
    act.enabled = true;
    fighter.actions[clip.name] = act;
  }
  const guard = fighter.actions.guard || Object.values(fighter.actions)[0];
  guard.reset().play();
  fighter.mixer.setTime(0.5);
  let pts = samplePose(root, 4000);
  const ext = (k) => Math.max(...pts.map((p) => p[k])) - Math.min(...pts.map((p) => p[k]));
  if (ext('y') < ext('z')) {
    root.rotation.x = -Math.PI / 2;
    root.updateMatrixWorld(true);
    pts = samplePose(root, 4000);
  }
  /* normalize on the idle pose exactly like move-stage.js (target calibrated
   * to the jab page's rig scale 1.927) so the docked widget matches */
  const idleAct = fighter.actions.idle || guard;
  idleAct.reset().play();
  fighter.mixer.setTime(0.5);
  pts = samplePose(root, 4000);
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

/* ---------- combo plan (in the air) ---------- */
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

const STEPS = [
  { clip: 'jab',      cut: 0.62 },
  { clip: 'cross',    cut: 0.65 },
  { clip: 'leadhook', cut: 0.80 },
];
const plan = [];          // per step: dur, realDur, offVec (hips drift at cut), anchorVec
let comboDur = 0;
const finalAnchorVec = new THREE.Vector3();

function probePlan() {
  let anchor = new THREE.Vector3();
  let prevOffCut = null;
  for (const st of STEPS) {
    const act = fighter.actions[st.clip];
    const dur = act.getClip().duration;
    /* measure the hips drift from the group origin at clip start and at the
     * cut point — the baked clips lunge then return, and a trimmed clip even
     * STARTS mid-lunge. Anchor each clip so the hips stay continuous with
     * the previous punch (and with the intro guard) — the fighter then only
     * ever moves FORWARD, never snapping back. */
    act.reset().setEffectiveTimeScale(1).setEffectiveWeight(1).play();
    fighter.mixer.setTime(0.001);
    fighter.group.updateMatrixWorld(true);
    fighter.bones.Hips.getWorldPosition(_sv);
    /* horizontal drift only — the baked vertical bob must stay relative to
     * the floor or the whole group would be dragged down/up by the anchor */
    const offStart = _sv.clone().sub(fighter.group.position).setY(0);
    fighter.mixer.setTime(st.cut * dur);
    fighter.group.updateMatrixWorld(true);
    fighter.bones.Hips.getWorldPosition(_sv);
    const offCut = _sv.clone().sub(fighter.group.position).setY(0);
    fighter.mixer.stopAllAction();
    /* anchor_k: prev hips end == this clip's hips start. The first clip
     * starts from the guard position at weight ~0 during its fade-in, so
     * compensating its own start offset there would overshoot — anchor it
     * at the origin instead. */
    if (prevOffCut) anchor = anchor.clone().add(prevOffCut).sub(offStart);
    else anchor = new THREE.Vector3(0, 0, 0);
    prevOffCut = offCut;
    plan.push({ ...st, dur, realDur: (st.cut * dur) / SPEED, anchorVec: anchor.clone() });
  }
  finalAnchorVec.copy(anchor).add(prevOffCut);
  comboDur = plan.reduce((s, p) => s + p.realDur, 0);
  console.log('[combo-air] plan', plan.map((p) =>
    `${p.clip} dur ${p.realDur.toFixed(2)}s anchor ${p.anchorVec.x.toFixed(2)},${p.anchorVec.z.toFixed(2)}`).join(' | '));
}

/* ---------- show state ---------- */
let phase = 'load';        // intro | combo | settle | paused | docked
let showT = 0;             // real seconds since resetShow
let stepIdx = -1;          // current punch index (-1 = intro)
let stepT = 0;             // real seconds into the current punch
let settleT = 0;
let frames = 0;
const _fwd = new THREE.Vector3();

function facingDir() {
  return _fwd.set(Math.sin(fighter.group.rotation.y), 0, Math.cos(fighter.group.rotation.y));
}

function startStep(k) {
  stepIdx = k;
  stepT = 0;
  /* stand at this punch's anchor so the body keeps its forward progress
   * instead of snapping back to the clip origin */
  fighter.group.position.copy(plan[k].anchorVec);
  play(fighter, plan[k].clip, { fade: 0.12, ts: SPEED });
  setTimeout(playWhoosh, Math.max(0, plan[k].realDur * 450));
}

function advanceCombo(dt) {
  if (stepIdx < 0) return;
  stepT += dt;
  const st = plan[stepIdx];
  if (stepT >= st.realDur) {
    if (stepIdx === plan.length - 1) {
      phase = 'settle';
      settleT = 0;
      /* keep the fighter at his final forward position while he idles */
      fighter.group.position.copy(finalAnchorVec);
      fighter.mixer.stopAllAction();
      play(fighter, fighter.actions.idle ? 'idle' : 'guard', { fade: 0.3, loop: true });
    } else {
      startStep(stepIdx + 1);
    }
  }
}

function dock() {
  phase = 'docked';
  hostEl.classList.remove('jab-live', 'jab-paused');
  hostEl.classList.add('jab-docked');
  replayBtn.hidden = false;
  /* the widget frames the ORIGIN — bring the fighter back home or he stands
   * outside the small canvas (invisible) after his forward march */
  fighter.group.position.set(0, 0, 0);
  fighter.group.rotation.y = Math.PI * 0.375;
  camFollowX = 0;
  fighter.mixer.stopAllAction();
  play(fighter, fighter.actions.idle ? 'idle' : 'guard', { fade: 0.3, loop: true });
  resize();
  controls.target.set(0, 0.95, 0);
  _sv.copy(camera.position).sub(controls.target).setLength(2.9);
  camera.position.copy(controls.target).add(_sv);
  controls.enabled = true;
  controls.update();
}

function resetShow() {
  const wasDocked = controls.enabled;
  phase = 'intro';
  showT = 0;
  stepIdx = -1;
  stepT = 0;
  settleT = 0;
  hostEl.classList.remove('jab-docked', 'jab-paused');
  hostEl.classList.add('jab-live');
  replayBtn.hidden = true;
  if (wasDocked) {
    camera.position.copy(camPos);
  } else {
    camera.position.set(0.55, 1.35, 4.4);
  }
  controls.enabled = false;
  fighter.group.position.set(0, 0, 0);
  fighter.group.rotation.y = -Math.PI / 2 + 0.35;
  /* HARD cut into guard (no fade): the skeleton is holding whatever pose the
   * last sampling pass left behind (e.g. leadhook mid-recovery) — fading in
   * from that reads as a whole-body tumble during the first ~0.15s. */
  fighter.mixer.stopAllAction();
  const g = fighter.actions.guard || Object.values(fighter.actions)[0];
  g.reset().setEffectiveTimeScale(1).setEffectiveWeight(1);
  g.setLoop(THREE.LoopRepeat, Infinity);
  g.play();
  fighter.mixer.setTime(0.2);
  fighter.mixer.update(0);
  applyShowTop();
  resize();
}

function advance(dt) {
  showT += dt;
  if (phase === 'intro') {
    fighter.mixer.update(dt);
    if (showT >= INTRO_T) {
      phase = 'combo';
      startStep(0);
    }
  } else if (phase === 'combo') {
    fighter.mixer.update(dt);
    advanceCombo(dt);
  } else if (phase === 'settle') {
    fighter.mixer.update(dt);
    settleT += dt;
    if (settleT >= SETTLE_T) {
      phase = 'paused';
      hostEl.classList.add('jab-paused');
      controls.enabled = true;
      /* hand over to orbit at the same framing the follow camera ended on —
       * otherwise the fighter (who marched forward) drops out of frame */
      controls.target.set(camFollowX * 0.55, 1.0, 0);
      controls.update();
    }
  } else if (phase === 'docked' || phase === 'paused') {
    fighter.mixer.update(dt);
  }
}

/* ---------- camera (follows the fighter's forward advance, portrait aware) ---------- */
const _want = { pos: new THREE.Vector3(), tgt: new THREE.Vector3() };
let camFollowX = 0;        // smoothed fighter progress
function computeCamera() {
  const aspect = camera.aspect || 1;
  const tanH = Math.tan(camera.fov * Math.PI / 360);
  /* fit a 2.4m-tall / 2.6m-wide action bubble, whichever needs more distance */
  const z = Math.max(3.6, 2.4 / (2 * tanH), 2.6 / (2 * tanH * aspect));
  const mid = camFollowX * 0.55;
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
  if (phase === 'combo' || phase === 'settle') {
    camFollowX += (fighter.group.position.x - camFollowX) * (1 - Math.exp(-dt * 2.2));
  } else if (phase === 'intro') {
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
const camPos = new THREE.Vector3(0.55, 1.35, 4.4);

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
  /* the jab clip opens with a large torso wind-up rotation — trim it so the
   * punch fires fast and the first second reads as a jab, not a turn */
  const jabAct = fighter.actions.jab;
  if (jabAct) {
    const src = jabAct.getClip();
    if (src.duration > JAB_TRIM + 0.4) {
      fighter.actions.jab = fighter.mixer.clipAction(trimClipStart(src, JAB_TRIM));
    }
  }
  probePlan();
  loadingEl.classList.add('hidden');
  resetShow();
  startLoop();

  window.__move = {
    get phase() { return phase; },
    get t() { return showT; },
    plan,
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
