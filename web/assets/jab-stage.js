/* SilentJab — moves/jab.html cinematic stage
 *
 * Solo jab show on the page model (the "white rig" sculpt):
 *   1. fullscreen (fixed, transparent) — she stands centre, throws the
 *      homepage-hero jab and FREEZES at the reach frame while the five hero
 *      callouts (same copy as the homepage) draw in with leader lines;
 *   2. when every callout is up she stays frozen centre-stage and Replay /
 *      Close buttons appear at the bottom of the stage. Replay restarts the
 *      show; Close docks the canvas into the article flow as a small
 *      borderless stage that keeps the same annotated pose (drag to orbit);
 *   3. the small stage's Replay goes back to the fullscreen show.
 *
 * Mouse actions during the show are off (fixed-camera cinematic); the wheel
 * scrolls the page. Once docked the small stage can be orbited by drag
 * (rotate only — wheel still scrolls). Deterministic timeline with stepTo(t).
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const canvas = document.getElementById('stage-canvas');
const stageEl = canvas.parentElement;
const loadingEl = document.getElementById('stage-loading');
const loadingText = document.getElementById('stage-loading-text');
const errorEl = document.getElementById('stage-error');
const replayBtn = document.getElementById('jab-replay');
const bigReplayBtn = document.getElementById('jab-replay-big');
const closeBtn = document.getElementById('jab-close');

/* page woman: the "white rig" sculpt — mesh + rig + retargeted clips
 * (guard / jab / jab-fight / idle), built by build/build_jab_woman.py from
 * rig-character-white.fbx; guard/idle come from the user's Mixamo FBX donors
 * (build/donor_guard.fbx, build/donor_idle4.fbx), the jab from the in-repo
 * rigs — all resampled in Blender because the rigs' per-bone rest rotations
 * differ. Only the solo jab clip is used here. */
const WOMAN_URL = new URL('../media/glb/jab-woman.glb?v=3', import.meta.url).href;

const STAGGER = 0.72;      // callout card interval (s)
const HOLD = 1.0;          // hold after all callouts are shown (user spec: 1 s)
const ARM_STRAIGHTEN = 0.9; // corrective blend at full reach (user: straighter lead arm)

/* the five homepage-hero jab callouts, verbatim */
const CALLS = [
  ['Left fist', 'Lead hand snaps straight out, twisting inward the instant it lands.'],
  ['Right fist', 'Rear hand stays locked at the jaw — chin tucked, head covered.'],
  ['Waist', 'A short hip turn adds snap; the core braces instead of leaning in.'],
  ['Lead leg', 'Lead foot steps in to close the distance before the fist arrives.'],
  ['Rear leg', 'Rear foot stays planted at 45°, holding the base balanced.'],
];
const ANCHOR_KEYS = ['LeftHand', 'RightHand', 'Hips', 'LeftFoot', 'RightFoot'];
const SLOTS = [
  { side: 'l', top: 13 },
  { side: 'r', top: 13 },
  { side: 'l', top: 40 },
  { side: 'l', top: 69 },
  { side: 'r', top: 55 },
];

/* ---------- overlay: callout cards + leader lines + word badge ---------- */
const ui = document.createElement('div');
ui.className = 'hero-ui';
ui.innerHTML = '<svg class="hero-lines"></svg><div class="hero-callouts"></div>'
  + '<div class="hero-word"></div>';
stageEl.appendChild(ui);
const svg = ui.querySelector('.hero-lines');
const callsBox = ui.querySelector('.hero-callouts');
const wordEl = ui.querySelector('.hero-word');

const callEls = SLOTS.map((slot) => {
  const el = document.createElement('div');
  el.className = 'hero-callout';
  el.innerHTML = '<span class="tag"></span><span class="txt"></span>';
  callsBox.appendChild(el);
  return el;
});

/* cards sit well in from the screen edge so the leader lines stay short
 * (user spec: at least half the old length) */
function applyCardInset() {
  const w = stageEl.clientWidth || window.innerWidth || 1280;
  /* phones: cards hug the edges so the leader lines stay long */
  const inset = w < 700 ? 10 : Math.max(10, Math.min(w * 0.16, 260));
  callEls.forEach((el, i) => {
    el.style[SLOTS[i].side === 'l' ? 'left' : 'right'] = inset.toFixed(0) + 'px';
  });
}

/* cards never overlap: same column-packing as the homepage hero, minus the
 * dots row and control bar this page does not have */
function layoutCallouts() {
  applyCardInset();
  const h = callsBox.clientHeight || stageEl.clientHeight;
  if (!h) return;
  const minTop = Math.max(4, h * 0.022);
  const limit = h * 0.97;
  for (const side of ['l', 'r']) {
    const order = SLOTS.map((s, i) => ({ s, i }))
      .filter(x => x.s.side === side)
      .sort((a, b) => a.s.top - b.s.top);
    const plan = (gap) => {
      const tops = [];
      let prevBottom = null;
      for (const { s, i } of order) {
        const slotTop = (s.top / 100) * h;
        const top = prevBottom === null ? slotTop : Math.max(slotTop, prevBottom + gap);
        tops.push(top);
        prevBottom = top + (callEls[i].offsetHeight || 0);
      }
      return { tops, bottom: prevBottom };
    };
    let p = null;
    for (const gap of [10, 8, 6, 4, 2]) {
      const cand = plan(gap);
      const shift = Math.min(Math.max(0, cand.bottom - limit), Math.max(0, cand.tops[0] - minTop));
      for (let k = 0; k < cand.tops.length; k++) cand.tops[k] -= shift;
      cand.bottom -= shift;
      if (cand.bottom <= limit + 0.5) { p = cand; break; }
    }
    if (!p) p = plan(2);
    order.forEach(({ i }, k) => { callEls[i].style.top = (p.tops[k] / h * 100).toFixed(2) + '%'; });
  }
}
window.addEventListener('resize', () => requestAnimationFrame(layoutCallouts));

const lineEls = SLOTS.map(() => {
  const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
  const line = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
  const dot = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
  dot.setAttribute('r', '3.4');
  g.appendChild(line);
  g.appendChild(dot);
  g.style.opacity = '0';
  g.style.transition = 'opacity 0.28s ease';
  svg.appendChild(g);
  return { g, line, dot };
});

function hideCallouts() {
  shown = 0;
  callEls.forEach((el) => el.classList.remove('show'));
  lineEls.forEach((l) => { l.g.style.opacity = '0'; });
  wordEl.classList.remove('show');
}
function revealAt(i) {
  callEls[i].classList.add('show');
  lineEls[i].g.style.opacity = '1';
}
function prefillCallouts() {
  for (let i = 0; i < callEls.length; i++) {
    callEls[i].querySelector('.tag').textContent = CALLS[i][0];
    callEls[i].querySelector('.txt').textContent = CALLS[i][1];
  }
  layoutCallouts();
}

/* ---------- renderer / scene ---------- */
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.42;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 60);
const camPos = new THREE.Vector3(0, 1.2, 4.5);
const camTgt = new THREE.Vector3(0, 0.95, 0);

/* drag-to-orbit, enabled only on the docked small stage. The cinematic show
 * drives the camera itself (camPos/camTgt), so the controls stay disabled
 * until dock(). Rotate only: the wheel must keep scrolling the article, and
 * pan has no job here. touch-action is relaxed back to pan-y so a vertical
 * swipe on the docked canvas still scrolls the page on phones. */
const controls = new OrbitControls(camera, canvas);
controls.enabled = false;
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.enableZoom = false;
controls.enablePan = false;
controls.rotateSpeed = 0.85;
controls.minDistance = 2.0;
controls.maxDistance = 7.5;
controls.minPolarAngle = 0.45;
controls.maxPolarAngle = Math.PI / 2 + 0.12;   // never dip below the floor
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

function resize() {
  const w = stageEl.clientWidth || 1;
  const h = stageEl.clientHeight || 1;
  renderer.setSize(w, h, false);
  camera.aspect = w / Math.max(1, h);
  camera.updateProjectionMatrix();
}
new ResizeObserver(resize).observe(stageEl);
resize();

/* ---------- shared helpers ---------- */
function forceOpaque(mat) {
  if (!mat || !mat.transparent) return;
  mat.transparent = false;
  mat.depthWrite = true;
  mat.alphaTest = 0;
}
/* three r170 + Tripo baked textures under MeshStandardMaterial produce blotchy
 * artifacts — swap to MeshPhongMaterial exactly like the homepage stage */
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
        forceOpaque(m);
      }
    }
    if (o.isMesh) { o.frustumCulled = false; o.castShadow = false; }
  });
}
const _nv = new THREE.Vector3();
function boneByName(root, key) {
  const norm = (s) => s.replace(/[^a-z]/gi, '').toLowerCase();
  const want = norm(key);
  let found = null;
  root.traverse((o) => {
    if (!found && o.isBone && norm(o.name).endsWith(want)) found = o;
  });
  return found;
}
function lowestSkinnedPoint(root) {
  let low = Infinity;
  const tv = new THREE.Vector3();
  root.traverse((o) => {
    if (!o.isMesh || !o.geometry) return;
    const pos = o.geometry.attributes.position;
    const step = Math.max(1, Math.floor(pos.count / 3000));
    for (let i = 0; i < pos.count; i += step) {
      tv.fromBufferAttribute(pos, i);
      if (o.isSkinnedMesh) o.applyBoneTransform(i, tv);
      tv.applyMatrix4(o.matrixWorld);
      if (tv.y < low) low = tv.y;
    }
  });
  return Number.isFinite(low) ? low : 0;
}
function play(f, name, { fade = 0.2, clamp = false, loop = false } = {}) {
  const next = f.actions[name];
  if (!next) return;
  next.reset();
  next.setLoop(loop ? THREE.LoopRepeat : THREE.LoopOnce, loop ? Infinity : 1);
  next.clampWhenFinished = clamp;
  next.setEffectiveTimeScale(1);
  next.setEffectiveWeight(1);
  if (fade > 0) next.fadeIn(fade);
  next.play();
  for (const a of Object.values(f.actions)) {
    if (a === next) continue;
    const w = a.getEffectiveWeight();
    if (w > 0.001) a.fadeOut(Math.max(fade, 0.001));
    else if (a.enabled) a.stop();
  }
}

/* ---------- loading ---------- */
const FILE_COUNT = 1;
let loadDone = 0;
function prog(e) {
  if (!e.total) return;
  loadDone++;
  loadingText.textContent = `Loading 3D models — ${Math.min(100, Math.round(((loadDone - 1) + (e.loaded / e.total)) / FILE_COUNT * 100))}%`;
}
function loadGLB(url) {
  return new Promise((res, rej) => new GLTFLoader().load(url, res, prog, rej));
}

loadGLB(WOMAN_URL).then((wg) => {
  try { build(wg); }
  catch (err) { fail(err); }
}).catch(fail);

function fail(err) {
  stageEl.classList.remove('jab-live');
  loadingEl.classList.add('hidden');
  errorEl.hidden = false;
  errorEl.textContent = 'Failed to load the 3D model.\n' + (err && err.message ? err.message : err);
  console.error('[jab-stage]', err);
}

/* ---------- fighter ---------- */
const woman = { group: new THREE.Group(), mixer: null, actions: {}, bones: {} };
scene.add(woman.group);

const _sv = new THREE.Vector3();

/* The page clip's lead arm keeps a bend at the elbow through the jab (baked
 * into the source animation — 60.5° short of straight at the reach frame).
 * We can't edit the GLB, so we straighten the arm procedurally: rotate the
 * forearm onto the upper-arm axis every frame the pose is evaluated, blended
 * by ARM_STRAIGHTEN at full reach and ramped in over the extension so the
 * guard wind-up keeps its natural fold. */
const _sa = new THREE.Vector3(), _sb = new THREE.Vector3(), _sc = new THREE.Vector3();
const _sd = new THREE.Vector3(), _se = new THREE.Vector3();
const _sq = new THREE.Quaternion(), _sq2 = new THREE.Quaternion(), _sq3 = new THREE.Quaternion();
/* world-space delta -> parent-local delta: L' = (P⁻¹·D·P)·L */
function worldDeltaToLocal(bone, worldDelta, out) {
  bone.parent.getWorldQuaternion(_sq2);
  return out.copy(_sq2).invert().multiply(worldDelta).multiply(_sq2);
}
const smooth = (u) => { u = Math.min(1, Math.max(0, u)); return u * u * (3 - 2 * u); };
/* correction weight grows over the final ~40% of the punch so the arm only
 * straightens as it extends toward the reach frame */
function straightenWeight(clipT) {
  const t0 = jabImpact * 0.6;
  return ARM_STRAIGHTEN * smooth((clipT - t0) / Math.max(1e-4, jabImpact - t0));
}
function straightenLeadArm(clipT) {
  const sh = woman.bones.LeftArm, el = woman.bones.LeftForeArm, hd = woman.bones.LeftHand;
  if (!sh || !el || !hd) return;
  const w = straightenWeight(clipT === undefined ? jabImpact : clipT);
  if (w <= 0) return;
  woman.group.updateMatrixWorld(true);
  sh.getWorldPosition(_sa);
  el.getWorldPosition(_sb);
  hd.getWorldPosition(_sc);
  /* NOTE: the copy targets (_sd/_se) must differ from the subtract operands —
   * an earlier draft aliased them (`_sa.copy(_sb).sub(_sa)`) which produced a
   * zero vector and silently disabled the whole corrective. */
  const upper = _sd.copy(_sb).sub(_sa).normalize();   // shoulder -> elbow
  const fore = _se.copy(_sc).sub(_sb).normalize();    // elbow -> hand
  _sq.setFromUnitVectors(fore, upper);                // world correction
  _sq3.identity().slerp(_sq, w);
  worldDeltaToLocal(el, _sq3, _sq);
  el.quaternion.premultiply(_sq);
  el.updateMatrixWorld(true);
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

/* the woman: normalize to 1.75 m off a guard frame, ground the soles, face
 * LEFT (-X). The sculpt comes out of the exporter Y-up (upright) while the
 * older FBX-derived rigs were Z-up and lying flat, so stand it up only when
 * the bind pose really is flat. */
function buildWoman(gltf) {
  const root = gltf.scene;
  fixMaterials(root);
  woman.root = root;
  woman.group.add(root);
  woman.group.rotation.y = -Math.PI / 2;
  root.updateMatrixWorld(true);
  {
    const pts = samplePose(root, 4000);
    const ext = (k) => Math.max(...pts.map((p) => p[k])) - Math.min(...pts.map((p) => p[k]));
    if (ext('y') < ext('z')) {
      root.rotation.x = -Math.PI / 2;
      root.updateMatrixWorld(true);
      console.log('[jab] woman rig was Z-up flat — stood it up');
    }
  }
  for (const n of [...ANCHOR_KEYS, 'LeftArm', 'LeftForeArm']) woman.bones[n] = boneByName(root, n);
  woman.mixer = new THREE.AnimationMixer(root);
  for (const clip of gltf.animations) {
    if (/Layer0$/.test(clip.name)) continue;
    const act = woman.mixer.clipAction(clip);
    act.enabled = true;
    woman.actions[clip.name] = act;
  }
  /* snapshot the bind-pose local quaternions BEFORE anything plays — the
   * runtime retarget below is expressed against them */
  woman.restQ = new Map();
  woman.restPos = new Map();
  root.traverse((o) => {
    if (o.isBone) {
      woman.restQ.set(o.name, o.quaternion.clone());
      woman.restPos.set(o.name, o.position.clone());
    }
  });
  const guard = woman.actions.guard || Object.values(woman.actions)[0];
  guard.reset().play();
  woman.mixer.setTime(0.5);
  let pts = samplePose(root);
  const h0 = Math.max(...pts.map(p => p.y)) - Math.min(...pts.map(p => p.y));
  root.scale.setScalar(1.75 / h0);
  root.updateMatrixWorld(true);
  pts = samplePose(root);
  root.position.y -= Math.min(...pts.map(p => p.y));
  root.updateMatrixWorld(true);
  woman.mixer.stopAllAction();
}

/* ---------- choreography probes ---------- */
let jabDur = 1.0;
let jabImpact = 0.6;      // intro-clip time of the reach frame

function probe() {
  const hand = woman.bones.LeftHand;

  /* the solo jab: find the reach frame to freeze on */
  const wAct = woman.actions.jab;
  jabDur = wAct.getClip().duration;
  wAct.reset().setEffectiveTimeScale(1).setEffectiveWeight(1).play();
  let best = { t: 0, x: Infinity };
  for (let i = 0; i <= 64; i++) {
    const t = (jabDur * i) / 64;
    woman.mixer.setTime(t);
    straightenLeadArm(t);
    woman.group.updateMatrixWorld(true);
    hand.getWorldPosition(_sv);
    if (_sv.x < best.x) best = { t, x: _sv.x };
  }
  jabImpact = best.t;
  woman.mixer.stopAllAction();
}

/* ---------- show state ---------- */
let phase = 'load';       // intro | reveal | paused | docked
let showT = 0;
let revT = 0, shown = 0;

function freezeWoman() {
  const wa = woman.actions.jab;
  wa.time = Math.min(jabImpact, jabDur);
  woman.mixer.update(0);
  straightenLeadArm(jabImpact);   // full weight at the frozen reach pose
  woman.group.updateMatrixWorld(true);
}

/* Close: dock the canvas into the article flow. She settles into her idle,
 * angled 45° out toward the viewer, callout annotations gone (user spec) —
 * Replay returns to the full annotated show. */
function dock() {
  phase = 'docked';
  stageEl.classList.remove('jab-live', 'jab-paused');
  stageEl.classList.add('jab-docked');
  replayBtn.hidden = false;
  hideCallouts();
  /* docked look: facing screen-right angled out toward the viewer. Yaw
   * swept 90..180 deg earlier; the user then asked for a further 45 deg
   * right turn from 112.5 deg -> 67.5 deg (3PI/8): nose to screen-right,
   * ~22 deg off profile toward the camera, face and gloves visible */
  woman.group.rotation.y = Math.PI * 0.375;
  woman.mixer.stopAllAction();
  play(woman, 'idle', { fade: 0.3, loop: true });
  resize();
  /* hand the camera over to the user on a front 3/4 view. NOTE: the view
   * direction must be captured BEFORE copying the target into
   * camera.position — copy-then-subtract aliases to a zero vector and
   * OrbitControls then re-clamps the degenerate camera to a random spot. */
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
  revT = 0; shown = 0;
  hideCallouts();
  stageEl.classList.remove('jab-docked', 'jab-paused');
  stageEl.classList.add('jab-live');
  replayBtn.hidden = true;
  /* scripted camera takes over again — when coming back from the docked
   * stage, start the easing from wherever the user had orbited to, so the
   * return is a smooth sweep, not a snap */
  if (wasDocked) {
    camPos.copy(camera.position);
    camTgt.copy(controls.target);
  } else {
    camPos.set(0, 1.2, 4.5);
    camTgt.set(0, 0.95, 0);
  }
  controls.enabled = false;
  woman.group.position.set(0, 0, 0);
  woman.group.rotation.y = -Math.PI / 2;   // back to the show-facing yaw
  woman.mixer.stopAllAction();
  play(woman, 'jab', { fade: 0, clamp: true });
  resize();
}

function advance(dt) {
  showT += dt;
  if (phase === 'intro') {
    if (woman.mixer) woman.mixer.update(dt);
    const wa = woman.actions.jab;
    straightenLeadArm(wa ? wa.time : undefined);   // keep the lead arm straight
    if (wa && wa.time >= jabImpact - 1e-3) {
      freezeWoman();
      phase = 'reveal';
      revT = 0; shown = 0;
      wordEl.textContent = 'JAB';
      wordEl.classList.add('pos-a');
      /* only while the reveal is actually on screen — a fast stepTo() jump
       * would otherwise fire this rAF after hideCallouts() and the word
       * would haunt the docked stage */
      requestAnimationFrame(() => { if (phase !== 'intro') wordEl.classList.add('show'); });
      prefillCallouts();
    }
  } else if (phase === 'reveal') {
    revT += dt;
    while (shown < 5 && revT >= shown * STAGGER) revealAt(shown++);
    if (shown === 5 && revT >= 5 * STAGGER + HOLD) {
      /* every callout is up: hold the annotated pose centre-stage and offer
       * Replay / Close at the bottom of the stage */
      phase = 'paused';
      stageEl.classList.add('jab-paused');
    }
  } else if (phase === 'docked') {
    /* idle keeps looping on the small stage */
    if (woman.mixer) woman.mixer.update(dt);
  }
  /* 'paused': frozen annotated pose, nothing to advance */
}

/* ---------- camera ---------- */
const _want = { pos: new THREE.Vector3(), tgt: new THREE.Vector3() };
function computeCamera() {
  const aspect = camera.aspect || 1;
  const tanH = Math.tan(camera.fov * Math.PI / 360);
  const portrait = aspect < 0.8;   // phones: a step further away
  /* solo: she fills the frame like the homepage hero demo — but a step back
   * from the very first fullscreen cut (user: a smaller figure) */
  const zH = 1.55 / tanH;                      // ~3.1m visible height at fov 38
  const zW = 1.00 / (tanH * aspect);
  const z = Math.max(4.2, zH, zW) * (portrait ? 1.2 : 1);
  _want.tgt.set(-0.15, 0.92, 0);
  _want.pos.set(_want.tgt.x + z * 0.30, _want.tgt.y + z * 0.12, z);
}
function updateCamera(dt) {
  if (controls.enabled) {
    /* docked + user camera: damping needs update() every frame */
    controls.update();
    headFill.position.copy(camera.position).sub(controls.target).setLength(6).add(controls.target);
    headFill.target.position.copy(controls.target);
    return;
  }
  computeCamera();
  const k = vt !== null ? 1 : 1 - Math.exp(-dt * 3.2);
  camPos.lerp(_want.pos, k);
  camTgt.lerp(_want.tgt, k);
  camera.position.copy(camPos);
  camera.lookAt(camTgt);
  headFill.position.copy(camera.position).sub(camTgt).setLength(6).add(camTgt);
  headFill.target.position.copy(camTgt);
}

/* ---------- callout projection ---------- */
function updateCallouts() {
  if (!shown) return;
  const w = stageEl.clientWidth;
  const h = stageEl.clientHeight;
  if (!w || !h) return;
  for (let i = 0; i < 5; i++) {
    if (i >= shown) continue;
    const bone = woman.bones[ANCHOR_KEYS[i]];
    if (!bone) continue;
    bone.getWorldPosition(_sv);
    _sv.project(camera);
    const ax = (_sv.x * 0.5 + 0.5) * w;
    const ay = (-_sv.y * 0.5 + 0.5) * h;
    const el = callEls[i];
    const cw = el.offsetWidth || 160;
    const ch = el.offsetHeight || 52;
    const onRight = el.offsetLeft > w / 2;
    const lx = onRight ? el.offsetLeft : el.offsetLeft + cw;
    const ly = el.offsetTop + ch / 2;
    const dir = onRight ? 1 : -1;
    const l = lineEls[i];
    l.line.setAttribute('points',
      `${ax.toFixed(1)},${ay.toFixed(1)} ${(ax + dir * 18).toFixed(1)},${ay.toFixed(1)} ${lx.toFixed(1)},${ly.toFixed(1)}`);
    l.dot.setAttribute('cx', ax.toFixed(1));
    l.dot.setAttribute('cy', ay.toFixed(1));
  }
}

/* ---------- loop ---------- */
const clock = new THREE.Clock();
let running = false;
let vt = null;            // QA virtual time — set while stepping

let frames = 0;           // QA: proves the loop is alive
function render() {
  frames++;
  updateCallouts();
  renderer.render(scene, camera);
}

function frame() {
  const dt = Math.min(clock.getDelta(), 0.05);
  if (phase !== 'load') advance(dt);
  updateCamera(dt);
  render();
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

replayBtn.addEventListener('click', resetShow);      // docked -> big show
bigReplayBtn.addEventListener('click', resetShow);   // big stage: replay
closeBtn.addEventListener('click', dock);            // big stage: dock small

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

function build(wg) {
  buildWoman(wg);
  probe();
  loadingEl.classList.add('hidden');
  layoutCallouts();
  resetShow();
  startLoop();

  window.__jab = {
    get phase() { return phase; },
    get t() { return showT; },
    jabImpact,
    woman, camera, THREE, samplePose,
    get frames() { return frames; },
    get running() { return running; },
    renderer,
    stepTo(target) {
      stopLoop();              // exact-time QA: no wall-clock interleaving
      const dt = 1 / 30;
      let guard = 0;
      vt = 0;
      while (showT < target - 1e-6 && guard++ < 3000) advance(dt);
      vt = null;
      updateCamera(1 / 30);
      render();
    },
    restart: () => { resetShow(); startLoop(); },
    resume: () => startLoop(),
  };
}
