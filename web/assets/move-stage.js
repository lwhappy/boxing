/* SilentJab — shared cinematic move stage for the moves/ pages
 *
 * A config-driven generalization of the jab page's solo show (jab-stage.js):
 *   1. fullscreen (fixed, transparent) — she throws the page's move and
 *      FREEZES at the reach frame while five callout cards draw in with
 *      leader lines;
 *   2. every callout up → she stays frozen centre-stage with Replay / Close
 *      at the bottom; Replay restarts, Close docks the canvas into the
 *      article flow as a small borderless corner widget playing her idle
 *      (drag to orbit);
 *   3. the docked widget's Replay returns to the fullscreen show.
 *
 * Each page supplies window.MOVE_STAGE before this script:
 *   {
 *     glb:        '../media/glb/cross-woman.glb?v=1',
 *     move:       'cross',            // clip name to perform
 *     word:       'CROSS',            // badge text over the frozen pose
 *     probeBone:  'RightHand',        // hand tracked for the reach frame
 *     straighten: 'Right' | 'Left' | null,  // arm to straighten at reach
 *     callouts: [ [tag, text, anchorBone, side('l'|'r'), topPct], ... ]  // 5
 *   }
 *
 * Wheel still scrolls (zoom off); drag orbits the frozen pose and the docked
 * widget; touch-action pan-y keeps vertical swipes scrolling on phones.
 * Deterministic timeline with stepTo(t) for QA.
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const CFG = window.MOVE_STAGE || {};
const MOVE = CFG.move || 'cross';
const WORD = CFG.word || (MOVE || '').toUpperCase();
/* show-facing yaw: default -90° puts her in left profile (nose to screen-left).
 * Pages can override — e.g. the lead hook rotates toward the camera so the
 * punching (lead) arm reads clearly instead of hiding behind the body. */
const SHOW_YAW = (typeof CFG.yaw === 'number') ? CFG.yaw : -Math.PI / 2;

const canvas = document.getElementById('stage-canvas');
/* stageEl is the render surface (canvas box): renderer sizing, callout
 * projection and the hero-ui overlay all anchor here. hostEl is the stage
 * container that carries the phase classes (jab-live / jab-paused /
 * jab-docked) the CSS keys off — they must not be the same node now that
 * the canvas is wrapped in .jab-canvas-box. */
const stageEl = canvas.parentElement;
const hostEl = stageEl.closest('.jab-stage') || stageEl;
const loadingEl = document.getElementById('stage-loading');
const loadingText = document.getElementById('stage-loading-text');
const errorEl = document.getElementById('stage-error');
const replayBtn = document.getElementById('jab-replay');
const bigReplayBtn = document.getElementById('jab-replay-big');
const closeBtn = document.getElementById('jab-close');

const WOMAN_URL = new URL(CFG.glb, import.meta.url).href;

const STAGGER = 0.72;      // callout card interval (s)
const HOLD = 1.0;          // hold after all callouts are shown
const ARM_STRAIGHTEN = 0.9; // corrective blend at full reach (straight punches only)

/* the five callouts for THIS move, straight from the page config */
const CALLS = (CFG.callouts || []).slice(0, 5);
const ANCHOR_KEYS = CALLS.map((c) => c[2]);
const SLOTS = CALLS.map((c) => ({ side: c[3], top: c[4] }));

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

/* cards sit well in from the screen edge so the leader lines stay short */
function applyCardInset() {
  const w = stageEl.clientWidth || window.innerWidth || 1280;
  const inset = w < 700 ? 10 : Math.max(10, Math.min(w * 0.16, 260));
  callEls.forEach((el, i) => {
    el.style[SLOTS[i].side === 'l' ? 'left' : 'right'] = inset.toFixed(0) + 'px';
  });
}

/* cards never overlap: same column-packing as the homepage hero */
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
  playTick(i);
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

/* drag-to-orbit, enabled once the pose freezes and while docked. Rotate
 * only: the wheel must keep scrolling the article. */
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

/* ---------- keep the site chrome clickable ----------
 * The live show is a fixed overlay; at full height its canvas would sit on
 * top of the sticky header and breadcrumb row and swallow their clicks. So
 * the overlay starts BELOW those bars: --show-top (px) is measured here and
 * the .jab-live CSS anchors top/bottom to it. Falls back to 0 (true
 * fullscreen) on pages without the site chrome. */
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
  hostEl.classList.remove('jab-live');
  loadingEl.classList.add('hidden');
  errorEl.hidden = false;
  errorEl.textContent = 'Failed to load the 3D model.\n' + (err && err.message ? err.message : err);
  console.error('[move-stage]', err);
}

/* ---------- fighter ---------- */
const woman = { group: new THREE.Group(), mixer: null, actions: {}, bones: {} };
scene.add(woman.group);

const _sv = new THREE.Vector3();

/* Which arm (if any) gets the straight-at-reach corrective: straight punches
 * (jab / cross) ship with a baked elbow bend that reads wrong frozen at full
 * extension; hooks and uppercuts keep their bend by design (straighten:null). */
const STRAIGHTEN = CFG.straighten || null;
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
  const t0 = moveImpact * 0.6;
  return ARM_STRAIGHTEN * smooth((clipT - t0) / Math.max(1e-4, moveImpact - t0));
}
function straightenPunchArm(clipT) {
  if (!STRAIGHTEN) return;
  const sh = woman.bones[STRAIGHTEN + 'Arm'];
  const el = woman.bones[STRAIGHTEN + 'ForeArm'];
  const hd = woman.bones[STRAIGHTEN + 'Hand'];
  if (!sh || !el || !hd) return;
  const w = straightenWeight(clipT === undefined ? moveImpact : clipT);
  if (w <= 0) return;
  woman.group.updateMatrixWorld(true);
  sh.getWorldPosition(_sa);
  el.getWorldPosition(_sb);
  hd.getWorldPosition(_sc);
  /* NOTE: the copy targets (_sd/_se) must differ from the subtract operands —
   * an aliased draft produced a zero vector and silently disabled the fix. */
  const upper = _sd.copy(_sb).sub(_sa).normalize();   // shoulder -> elbow
  const fore = _se.copy(_sc).sub(_sb).normalize();    // elbow -> hand
  _sq.setFromUnitVectors(fore, upper);                // world correction
  _sq3.identity().slerp(_sq, w);
  worldDeltaToLocal(el, _sq3, _sq);
  el.quaternion.premultiply(_sq);
  el.updateMatrixWorld(true);
}

/* ---------- sfx: Web Audio synthesis, no asset files ---------- */
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
/* autoplay policy: the show starts without a gesture, so the first run may
 * be silent until the user clicks/taps anything — unlock from then on */
for (const ev of ['pointerdown', 'keydown', 'touchstart']) {
  window.addEventListener(ev, ac, { passive: true });
}
/* punch whoosh: band-passed noise burst, pitch sweeps up through the
 * extension — the "hu" of the thrown punch */
function playWhoosh() {
  const ctx = ac();
  if (!ctx || ctx.state !== 'running') return;
  const dur = 0.28;
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
  bp.frequency.exponentialRampToValueAtTime(1400, t0 + dur * 0.6);
  bp.frequency.exponentialRampToValueAtTime(500, t0 + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.linearRampToValueAtTime(0.45, t0 + dur * 0.35);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  src.connect(bp).connect(g).connect(ctx.destination);
  src.start(t0);
  src.stop(t0 + dur);
}
/* callout reveal: short ascending blip, one per card */
function playTick(i) {
  const ctx = ac();
  if (!ctx || ctx.state !== 'running') return;
  const t0 = ctx.currentTime;
  const f = 620 + i * 90;
  const o = ctx.createOscillator();
  o.type = 'sine';
  o.frequency.setValueAtTime(f, t0);
  o.frequency.exponentialRampToValueAtTime(f * 1.5, t0 + 0.07);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(0.2, t0 + 0.012);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.12);
  o.connect(g).connect(ctx.destination);
  o.start(t0);
  o.stop(t0 + 0.14);
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
 * LEFT (-X). GLB clip conventions differ per donor source: clips baked from
 * glTF donors lie flat (Z-up) like the sculpt's bind — those need the root
 * stood up (-90° X); clips baked from Mixamo FBX donors are already upright
 * in glTF space (Y-up) and must NOT be rotated. Detect off the GUARD CLIP
 * pose (the bind pose lies for both), not the bind. */
function buildWoman(gltf) {
  const root = gltf.scene;
  fixMaterials(root);
  woman.root = root;
  woman.group.add(root);
  woman.group.rotation.y = SHOW_YAW;
  root.updateMatrixWorld(true);
  for (const n of new Set([...ANCHOR_KEYS, 'LeftArm', 'LeftForeArm', 'RightArm', 'RightForeArm'])) {
    woman.bones[n] = boneByName(root, n);
  }
  woman.mixer = new THREE.AnimationMixer(root);
  for (const clip of gltf.animations) {
    if (/Layer0$/.test(clip.name)) continue;
    const act = woman.mixer.clipAction(clip);
    act.enabled = true;
    woman.actions[clip.name] = act;
  }
  /* snapshot the bind-pose local quaternions BEFORE anything plays */
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
  let pts = samplePose(root, 4000);
  const ext = (k) => Math.max(...pts.map((p) => p[k])) - Math.min(...pts.map((p) => p[k]));
  if (ext('y') < ext('z')) {
    root.rotation.x = -Math.PI / 2;
    root.updateMatrixWorld(true);
    console.log('[move] clips were Z-up flat — stood the root up');
    pts = samplePose(root, 4000);
  }
  /* normalize on the IDLE pose, not the guard: docked plays this idle — the
   * same clip the jab page docks with. The target height is calibrated so
   * the resulting rig scale equals the jab page's (1.927): jab scales 1.75
   * off its (glTF-donor) guard pose, whose raw height differs from this
   * FBX-donor idle — a naive 1.75 target here made the docked figure ~8%
   * larger than jab's, clipping head and feet at the 2.9 m docked camera. */
  const idleAct = woman.actions.idle || guard;
  idleAct.reset().play();
  woman.mixer.setTime(0.5);
  pts = samplePose(root, 4000);
  const h0 = ext('y');
  root.scale.setScalar(1.72 / h0);
  root.updateMatrixWorld(true);
  pts = samplePose(root);
  root.position.y -= Math.min(...pts.map(p => p.y));
  root.updateMatrixWorld(true);
  /* the FBX-donor clips carry the donor armature's bind offset, which lands
   * as a ~1.1 m horizontal shift (the glTF donors sit centred on the origin).
   * Centre the idle pose so the hips sit at world x/z 0 — like the jab page —
   * keeping the big-stage framing centred and the docked yaw pivoting in
   * place. Only x/z: the grounding above owns the vertical. */
  const hipsB = woman.bones.Hips || boneByName(root, 'mixamorig:Hips');
  if (hipsB) {
    const hv = new THREE.Vector3();
    hipsB.getWorldPosition(hv);
    const dl = hv.multiplyScalar(-1).applyQuaternion(woman.group.quaternion.clone().invert());
    root.position.x += dl.x;
    root.position.z += dl.z;
    root.updateMatrixWorld(true);
  }
  woman.mixer.stopAllAction();
}

/* ---------- choreography probes ---------- */
let moveDur = 1.0;
let moveImpact = 0.6;     // intro-clip time of the reach frame
let moveFreeze = 0.6;     // intro-clip time of the frozen pose (>= moveImpact)

function probe() {
  const hand = woman.bones[CFG.probeBone || ANCHOR_KEYS[0]];

  /* find the reach frame to freeze on: the tracked hand's most forward point
   * along the show-facing direction. (The old metric — min world x — assumed
   * the default -90° left profile; pages overriding yaw need the general
   * form. For SHOW_YAW=-π/2 the forward vector is exactly -X.) */
  const wAct = woman.actions[MOVE];
  moveDur = wAct.getClip().duration;
  wAct.reset().setEffectiveTimeScale(1).setEffectiveWeight(1).play();
  const fwd = new THREE.Vector3(Math.sin(SHOW_YAW), 0, Math.cos(SHOW_YAW));
  let best = { t: 0, d: -Infinity };
  for (let i = 0; i <= 64; i++) {
    const t = (moveDur * i) / 64;
    woman.mixer.setTime(t);
    straightenPunchArm(t);
    woman.group.updateMatrixWorld(true);
    hand.getWorldPosition(_sv);
    const d = _sv.x * fwd.x + _sv.z * fwd.z;
    if (d > best.d) best = { t, d };
  }
  moveImpact = best.t;

  /* optional late freeze (CFG.freezeBone): hold the pose past the reach until
   * the follow-through settles — e.g. the lead hook keeps turning after the
   * fist arrives, and freezing at the reach catches the pivoting rear foot
   * mid-air. Track that bone until it drops back to the planted reference
   * foot's height (ground level); fall back to the lowest point found. */
  moveFreeze = moveImpact;
  if (CFG.freezeBone) {
    const bones = [CFG.freezeBone, CFG.freezeRefBone].filter(Boolean)
      .map((n) => boneByName(woman.root, n)).filter(Boolean);
    if (bones.length) {
      wAct.reset().play();
      /* baseline: each tracked bone's height at the clip start (guard — feet
       * flat on the floor). The rear foot pivots through a hook and only
       * truly settles well after the fist lands; ankle height alone reads
       * "level" too early because the pivot mostly rotates the foot —
       * track the toe bone too (freezeRefBone) and require BOTH back down. */
      const base = bones.map((b) => {
        woman.mixer.setTime(0);
        woman.group.updateMatrixWorld(true);
        b.getWorldPosition(_sa);
        return _sa.y;
      });
      const TOL = 0.015;
      const step = (moveDur - moveImpact) / 96;
      /* a momentary dip (mid weight-shift bounce) reads "level" for ~0.2s
       * while the foot is still visually pivoted — require the settle to
       * HOLD for 0.3s before trusting it, else keep waiting for the true
       * stance (the clip tail after the last bounce) */
      const need = Math.max(1, Math.ceil(0.3 / step));
      let run = 0, hit = null;
      for (let i = 0; i <= 96; i++) {
        const t = moveImpact + step * i;
        woman.mixer.setTime(t);
        woman.group.updateMatrixWorld(true);
        let ok = true;
        for (let bi = 0; bi < bones.length; bi++) {
          bones[bi].getWorldPosition(_sa);
          if (_sa.y > base[bi] + TOL) { ok = false; break; }
        }
        if (ok) {
          if (hit === null) hit = t;
          if (++run >= need) break;      // settled and holding
        } else {
          hit = null; run = 0;           // bounced again — keep waiting
        }
      }
      moveFreeze = hit === null ? moveDur : hit;
      console.log('[move] freeze at', moveFreeze.toFixed(2), 'of', moveDur.toFixed(2),
        '(reach', moveImpact.toFixed(2) + ')');
    }
    woman.mixer.stopAllAction();
  }
  /* explicit freeze time override (CFG.freezeAt, seconds into the clip):
   * beats the auto-detection when a page wants an exact frame (e.g. tuned
   * by eye against a reference pose) */
  if (typeof CFG.freezeAt === 'number') moveFreeze = CFG.freezeAt;
  /* freeze where a bone tops out (CFG.freezeHighest, e.g. an uppercut's
   * fist at the peak of its vertical drive): argmax world y over the clip */
  if (CFG.freezeHighest) {
    const hb = boneByName(woman.root, CFG.freezeHighest);
    if (hb) {
      wAct.reset().play();
      let best = { t: moveImpact, y: -Infinity };
      for (let i = 0; i <= 96; i++) {
        const t = (moveDur * i) / 96;
        woman.mixer.setTime(t);
        woman.group.updateMatrixWorld(true);
        hb.getWorldPosition(_sa);
        if (_sa.y > best.y) best = { t, y: _sa.y };
      }
      moveFreeze = best.t;
      console.log('[move] freeze at highest', CFG.freezeHighest, moveFreeze.toFixed(2));
    }
    woman.mixer.stopAllAction();
  }
  woman.mixer.stopAllAction();
}

/* ---------- show state ---------- */
let phase = 'load';       // intro | reveal | paused | docked
let showT = 0;
let revT = 0, shown = 0;
let whooshed = false;     // one whoosh per show run

function freezeWoman() {
  const wa = woman.actions[MOVE];
  wa.time = Math.min(moveFreeze, moveDur);
  woman.mixer.update(0);
  straightenPunchArm(moveImpact);   // full weight at the frozen reach pose
  woman.group.updateMatrixWorld(true);
}

/* Close: dock the canvas into the article flow. She settles into her idle,
 * angled out toward the viewer, callout annotations gone — Replay returns
 * to the full annotated show. */
function dock() {
  phase = 'docked';
  hostEl.classList.remove('jab-live', 'jab-paused');
  hostEl.classList.add('jab-docked');
  replayBtn.hidden = false;
  hideCallouts();
  woman.group.rotation.y = Math.PI * 0.375;   // nose to screen-right, ~22° off profile
  woman.mixer.stopAllAction();
  /* docked pose: the same glTF-donor idle the jab page's docked widget plays
   * (baked into every move GLB by build_jab_woman.py) */
  play(woman, woman.actions.idle ? 'idle' : 'guard', { fade: 0.3, loop: true });
  resize();
  /* hand the camera over to the user on a front 3/4 view. NOTE: the view
   * direction must be captured BEFORE copying the target into
   * camera.position — copy-then-subtract aliases to a zero vector. */
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
  whooshed = false;
  hideCallouts();
  hostEl.classList.remove('jab-docked', 'jab-paused');
  hostEl.classList.add('jab-live');
  replayBtn.hidden = true;
  /* scripted camera takes over again — when coming back from the docked
   * stage, start the easing from wherever the user had orbited to */
  if (wasDocked) {
    camPos.copy(camera.position);
    camTgt.copy(controls.target);
  } else {
    camPos.set(0, 1.2, 4.5);
    camTgt.set(0, 0.95, 0);
  }
  controls.enabled = false;
  woman.group.position.set(0, 0, 0);
  woman.group.rotation.y = SHOW_YAW;   // back to the show-facing yaw
  woman.mixer.stopAllAction();
  play(woman, MOVE, { fade: 0, clamp: true });
  applyShowTop();
  resize();
}

function advance(dt) {
  showT += dt;
  if (phase === 'intro') {
    if (woman.mixer) woman.mixer.update(dt);
    const wa = woman.actions[MOVE];
    straightenPunchArm(wa ? wa.time : undefined);
    /* whoosh once as the punch starts extending */
    if (wa && !whooshed && wa.time >= moveImpact - 0.18) {
      whooshed = true;
      playWhoosh();
    }
    if (wa && wa.time >= moveFreeze - 1e-3) {
      freezeWoman();
      phase = 'reveal';
      revT = 0; shown = 0;
      /* pose is frozen from here on: hand the camera to the user */
      controls.target.copy(camTgt);
      controls.enabled = true;
      controls.update();
      wordEl.textContent = WORD;
      wordEl.classList.add('pos-a');
      /* only while the reveal is actually on screen — a fast stepTo() jump
       * would otherwise fire this rAF after hideCallouts() */
      requestAnimationFrame(() => { if (phase !== 'intro') wordEl.classList.add('show'); });
      prefillCallouts();
    }
  } else if (phase === 'reveal') {
    revT += dt;
    while (shown < 5 && revT >= shown * STAGGER) revealAt(shown++);
    if (shown === 5 && revT >= 5 * STAGGER + HOLD) {
      /* every callout is up: hold the annotated pose and offer
       * Replay / Close at the bottom of the stage */
      phase = 'paused';
      hostEl.classList.add('jab-paused');
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
  /* solo: she fills the frame like the homepage hero demo — a step back so
   * the figure does not crowd the callouts */
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

  window.__move = {
    get phase() { return phase; },
    get t() { return showT; },
    moveImpact,
    moveFreeze,
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
