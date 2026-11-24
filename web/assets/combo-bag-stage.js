/* SilentJab — heavy-bag combo stage (combos/ pages, cinematic variant)
 *
 * The fullscreen show is a HEAVY-BAG scene, not the bare moves stage:
 *   - the fighter enters from screen-right, throws the combo fast while
 *     advancing right -> left, and every punch that lands IMPULSES the bag
 *     (pendulum physics) with an impact flash + spark burst + thud;
 *   - the bag swings away (gets pushed along) and the fighter chases it;
 *   - after the combo the fighter settles into his idle, then the stage
 *     offers Replay / Close; Close docks the canvas bottom-left exactly like
 *     the moves pages (same docked scene: bag hidden, fighter idling).
 *
 * Clips all come from ONE GLB (combo3-man.glb: guard / idle / jab / cross /
 * leadhook — retargeted from the game donor so every clip shares the same
 * upright convention; mixing GLB files with different donor conventions made
 * clips from the other file play lying down).
 *
 * Page config: window.COMBO_BAG = { glb: '...' }.
 * QA: window.__move (same contract as move-stage.js).
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const CFG = window.COMBO_BAG || {};
const GLB_URL = CFG.glb || '../media/glb/combo3-man.glb?v=1';
const SPEED = 1.45;          // global punch playback speed-up
const INTRO_T = 0.55;        // guard beat before the combo starts
const SETTLE_T = 1.5;        // idle beat after the combo before the overlay

const canvas = document.getElementById('stage-canvas');
const stageEl = canvas.parentElement;
const hostEl = stageEl.closest('.jab-stage') || stageEl;
const loadingEl = document.getElementById('stage-loading');
const loadingText = document.getElementById('stage-loading-text');
const errorEl = document.getElementById('stage-error');
const replayBtn = document.getElementById('jab-replay');
const bigReplayBtn = document.getElementById('jab-replay-big');
const closeBtn = document.getElementById('jab-close');

/* ---------- renderer / scene ---------- */
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.42;

const scene = new THREE.Scene();
scene.fog = new THREE.Fog(0x05060a, 6.5, 17);
const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 60);
const camPos = new THREE.Vector3(1.4, 1.35, 5.2);
const camTgt = new THREE.Vector3(0.6, 1.05, 0);

const controls = new OrbitControls(camera, canvas);
controls.enabled = false;
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.enableZoom = false;
controls.enablePan = false;
controls.rotateSpeed = 0.85;
controls.minDistance = 2.0;
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

/* ---------- heavy-bag scene (live phase only) ---------- */
const gymGroup = new THREE.Group();
scene.add(gymGroup);

const floor = new THREE.Mesh(
  new THREE.CircleGeometry(13, 48),
  new THREE.MeshPhongMaterial({ color: 0x0a0c10, shininess: 6, specular: 0x101216 }));
floor.rotation.x = -Math.PI / 2;
gymGroup.add(floor);

/* ---------- heavy bag — same design as /training/simulator/ ---------- */
const steelMat = new THREE.MeshPhongMaterial({ color: 0x2e3740, shininess: 70, specular: 0x555e6a });
const leatherMat = new THREE.MeshPhongMaterial({ color: 0x4a342a, shininess: 34, specular: 0x2b2b28 });
const seamMat = new THREE.MeshPhongMaterial({ color: 0x0e0908, shininess: 8 });
const strapMat = new THREE.MeshPhongMaterial({ color: 0x120e0d, shininess: 12 });

const BAG_R = 0.27;
const BAG_BOTTOM = 0.42;
const BAG_TOP = 1.62;
const BAG_CENTER_H = (BAG_BOTTOM + BAG_TOP) / 2;   // base joint -> bag centre

const bagRoot = new THREE.Group();     // slides along the floor, pushed by hits
gymGroup.add(bagRoot);
const baseMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.36, 0.1, 40), steelMat);
baseMesh.position.y = 0.05;
bagRoot.add(baseMesh);
for (let i = 0; i < 6; i++) {
  const a = (i / 6) * Math.PI * 2;
  const bolt = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.016, 0.014, 8), steelMat);
  bolt.position.set(Math.cos(a) * 0.29, 0.104, Math.sin(a) * 0.29);
  bagRoot.add(bolt);
}
const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.085, 0.12, 0.24, 20), steelMat);
neck.position.y = 0.18;
bagRoot.add(neck);

const bagPivot = new THREE.Group();    // tilts around the base joint
bagPivot.position.y = BAG_BOTTOM;
bagRoot.add(bagPivot);
const bagY = (y) => y - BAG_BOTTOM;
const bodyH = BAG_TOP - BAG_BOTTOM;
const bagMesh = new THREE.Mesh(new THREE.CylinderGeometry(BAG_R * 0.95, BAG_R, bodyH, 48, 1, false), leatherMat);
bagMesh.position.y = bagY(BAG_BOTTOM + bodyH / 2);
bagPivot.add(bagMesh);
const dome = new THREE.Mesh(new THREE.SphereGeometry(BAG_R * 0.95, 40, 20, 0, Math.PI * 2, 0, Math.PI / 2), leatherMat);
dome.position.y = bagY(BAG_TOP); dome.scale.y = 0.42; bagPivot.add(dome);
const skirt = new THREE.Mesh(new THREE.SphereGeometry(BAG_R, 40, 20, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), leatherMat);
skirt.position.y = bagY(BAG_BOTTOM); skirt.scale.y = 0.45; bagPivot.add(skirt);
for (const y of [0.62, 0.98, 1.34, 1.56]) {
  const ring = new THREE.Mesh(new THREE.TorusGeometry(BAG_R * 0.995, 0.0045, 6, 64), seamMat);
  ring.rotation.x = Math.PI / 2; ring.position.y = bagY(y); bagPivot.add(ring);
}
for (let i = 0; i < 4; i++) {
  const a = (i / 4) * Math.PI * 2;
  const strap = new THREE.Mesh(new THREE.BoxGeometry(0.035, bodyH * 0.99, 0.012), strapMat);
  strap.position.set(Math.cos(a) * BAG_R * 0.99, bagY(BAG_BOTTOM + bodyH / 2), Math.sin(a) * BAG_R * 0.99);
  strap.rotation.y = -a;
  bagPivot.add(strap);
}
const collar = new THREE.Group();
const collarRing = new THREE.Mesh(new THREE.TorusGeometry(BAG_R * 1.06, 0.026, 10, 56), steelMat);
collarRing.rotation.x = Math.PI / 2;
const collarLip = new THREE.Mesh(new THREE.CylinderGeometry(BAG_R * 1.06, BAG_R * 1.06, 0.045, 48, 1, true), steelMat);
collarLip.position.y = -0.022;
const collarPlate = new THREE.Mesh(new THREE.CircleGeometry(BAG_R * 1.04, 48), leatherMat);
collarPlate.rotation.x = -Math.PI / 2; collarPlate.position.y = -0.03;
collar.add(collarRing, collarLip, collarPlate);
collar.position.y = bagY(BAG_TOP + 0.004);
bagPivot.add(collar);

/* bag state: tilt around the base joint + slide along the floor */
const bag = { th: 0, om: 0, vx: 0, x: 0, squash: 0 };
function bagStep(dt) {
  bag.om += (-9.8 / 0.9) * Math.sin(bag.th) * dt;
  bag.om *= Math.exp(-dt * 1.35);
  bag.th += bag.om * dt;
  if (bag.th > 0.5) { bag.th = 0.5; bag.om = Math.min(bag.om, 0); }
  if (bag.th < -0.5) { bag.th = -0.5; bag.om = Math.max(bag.om, 0); }
  bagPivot.rotation.z = bag.th;
  bag.vx *= Math.exp(-dt * 1.9);
  bag.x += bag.vx * dt;
  bagRoot.position.x = bag.x;
  /* hit squash relaxes back to 1 */
  if (bag.squash > 0) {
    bag.squash = Math.max(0, bag.squash - dt * 4.5);
    const s = 1 - 0.10 * bag.squash;
    bagMesh.scale.set(1 + 0.10 * bag.squash, s, 1 + 0.10 * bag.squash);
  }
}
function bagAxisX() { return bag.x + Math.sin(bag.th) * BAG_CENTER_H; }   // world x of bag centre

function hitBag(power) {
  bag.om -= power * 0.85;             // rock the bag back
  bag.vx -= 0.7 + power * 0.35;       // push it away (-X): the march right -> left
  bag.squash = 1;
}

/* ---------- impact fx: flash sprite + spark burst ---------- */
function radialTex(stops, size = 128) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  for (const [o, col] of stops) grad.addColorStop(o, col);
  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
const flashTex = radialTex([[0, 'rgba(255,255,255,1)'], [0.25, 'rgba(255,196,120,0.95)'], [0.6, 'rgba(255,120,40,0.35)'], [1, 'rgba(255,120,40,0)']]);
const sparkTex = radialTex([[0, 'rgba(255,240,220,1)'], [0.5, 'rgba(255,170,90,0.8)'], [1, 'rgba(255,170,90,0)']], 32);

const flashes = [];
for (let i = 0; i < 4; i++) {
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({
    map: flashTex, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0,
  }));
  sp.visible = false;
  gymGroup.add(sp);
  flashes.push({ sp, t: 1e9 });
}
function spawnFlash(p) {
  const f = flashes.find((x) => x.t > 0.3) || flashes[0];
  f.t = 0;
  f.sp.position.copy(p);
  f.sp.visible = true;
}
const sparks = [];
for (let i = 0; i < 18; i++) {
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({
    map: sparkTex, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0,
  }));
  sp.scale.setScalar(0.07);
  sp.visible = false;
  gymGroup.add(sp);
  sparks.push({ sp, v: new THREE.Vector3(), t: 1e9 });
}
function spawnSparks(p, dir) {
  let n = 0;
  for (const s of sparks) {
    if (s.t < 0.5) continue;
    s.t = 0;
    s.sp.position.copy(p);
    s.sp.visible = true;
    const spread = 1.6;
    s.v.set(
      dir.x * (1.4 + Math.random() * 1.8) + (Math.random() * 2 - 1) * spread,
      0.6 + Math.random() * 1.7,
      dir.z * (1.4 + Math.random() * 1.8) + (Math.random() * 2 - 1) * spread);
    if (++n >= 9) break;
  }
}
function fxStep(dt) {
  for (const f of flashes) {
    if (!f.sp.visible) continue;
    f.t += dt;
    const u = f.t / 0.26;
    if (u >= 1) { f.sp.visible = false; continue; }
    f.sp.scale.setScalar(0.35 + 0.85 * u);
    f.sp.material.opacity = 1 - u;
  }
  for (const s of sparks) {
    if (!s.sp.visible) continue;
    s.t += dt;
    const u = s.t / 0.45;
    if (u >= 1) { s.sp.visible = false; continue; }
    s.v.y -= 7.5 * dt;
    s.sp.position.addScaledVector(s.v, dt);
    s.sp.material.opacity = 1 - u;
  }
}

/* camera shake on hits */
let shakeT = 1e9;

/* ---------- sfx ---------- */
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
  g.gain.linearRampToValueAtTime(0.4, t0 + dur * 0.35);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  src.connect(bp).connect(g).connect(ctx.destination);
  src.start(t0);
  src.stop(t0 + dur);
}
function playThud(power = 1) {
  const ctx = ac();
  if (!ctx || ctx.state !== 'running') return;
  const t0 = ctx.currentTime;
  const o = ctx.createOscillator();
  o.type = 'sine';
  o.frequency.setValueAtTime(115, t0);
  o.frequency.exponentialRampToValueAtTime(46, t0 + 0.15);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.linearRampToValueAtTime(0.5 * power, t0 + 0.012);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.17);
  o.connect(g).connect(ctx.destination);
  o.start(t0);
  o.stop(t0 + 0.19);
  const dur = 0.06;
  const buf = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * dur), ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length);
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 950;
  const g2 = ctx.createGain();
  g2.gain.setValueAtTime(0.32 * power, t0);
  g2.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  src.connect(lp).connect(g2).connect(ctx.destination);
  src.start(t0);
}

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

/* ---------- loading ---------- */
let loadDone = 0;
function prog(e) {
  if (!e.total) return;
  loadDone++;
  loadingText.textContent = `Loading 3D model — ${Math.min(100, Math.round(e.loaded / e.total * 100))}%`;
}
function loadGLB(url) {
  return new Promise((res, rej) => new GLTFLoader().load(new URL(url, import.meta.url).href, res, prog, rej));
}

function fail(err) {
  hostEl.classList.remove('jab-live');
  loadingEl.classList.add('hidden');
  errorEl.hidden = false;
  errorEl.textContent = 'Failed to load the 3D model.\n' + (err && err.message ? err.message : err);
  console.error('[combo-bag]', err);
}

/* ---------- fighter ---------- */
const fighter = { group: new THREE.Group(), mixer: null, actions: {}, bones: {} };
scene.add(fighter.group);
const _sv = new THREE.Vector3();
const _sa = new THREE.Vector3();

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
    const w = a.getEffectiveWeight();
    if (w > 0.001) a.fadeOut(Math.max(fade, 0.001));
    else if (a.enabled) a.stop();
  }
}

function buildFighter(gltf) {
  const root = gltf.scene;
  fixMaterials(root);
  fighter.root = root;
  fighter.group.add(root);
  fighter.group.rotation.y = -Math.PI / 2;   // faces -X (screen-left, toward the bag)
  root.updateMatrixWorld(true);
  for (const n of ['LeftHand', 'RightHand', 'Hips']) fighter.bones[n] = boneByName(root, n);
  fighter.mixer = new THREE.AnimationMixer(root);
  for (const clip of gltf.animations) {
    if (/Layer0$/.test(clip.name)) continue;
    const act = fighter.mixer.clipAction(clip);
    act.enabled = true;
    fighter.actions[clip.name] = act;
  }
  fighter.restQ = new Map();
  fighter.restPos = new Map();
  root.traverse((o) => {
    if (o.isBone) { fighter.restQ.set(o.name, o.quaternion.clone()); fighter.restPos.set(o.name, o.position.clone()); }
  });
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

/* ---------- combo plan ---------- */
const STEPS = [
  { clip: 'jab',      fist: 'LeftHand',  cut: 0.62, power: 1.0 },
  { clip: 'cross',    fist: 'RightHand', cut: 0.65, power: 1.4 },
  { clip: 'leadhook', fist: 'LeftHand',  cut: 0.80, power: 1.9 },
];
/* the fighter stands slightly toward the camera so the bag never occludes
 * him — punches go in at a slight angle, like real bag work */
const FIGHTER_Z = 0.55;
const plan = [];          // per step: dur/peak (real seconds), reach
let comboDur = 0;

function probePlan() {
  const fwd = new THREE.Vector3(-1, 0, 0);   // faces -X
  for (const st of STEPS) {
    const act = fighter.actions[st.clip];
    const dur = act.getClip().duration;
    act.reset().setEffectiveTimeScale(1).setEffectiveWeight(1).play();
    let best = { t: 0, x: -Infinity };
    for (let i = 0; i <= 64; i++) {
      const t = (dur * i) / 64;
      fighter.mixer.setTime(t);
      fighter.group.updateMatrixWorld(true);
      fighter.bones[st.fist].getWorldPosition(_sv);
      const d = _sv.x * fwd.x + _sv.z * fwd.z;   // forward extension (bigger = further)
      if (d > best.x) best = { t, x: d };
    }
    fighter.mixer.stopAllAction();
    plan.push({
      ...st,
      dur,
      reach: best.x,                               // fist forward reach (m)
      peakClip: best.t,                            // clip time of full extension
      peakReal: (best.t * SPEED) || 0.001,
      realDur: (st.cut * dur) / SPEED,
    });
  }
  comboDur = plan.reduce((s, p) => s + p.realDur, 0);
  console.log('[combo-bag] plan', plan.map((p) =>
    `${p.clip} reach ${p.reach.toFixed(2)}m peak@${p.peakReal.toFixed(2)}s dur ${p.realDur.toFixed(2)}s`).join(' | '));
}

/* ---------- show state ---------- */
let phase = 'load';        // intro | combo | settle | paused | docked
let showT = 0;             // real seconds since resetShow
let stepIdx = -1;          // current punch index (-1 = intro)
let stepT = 0;             // real seconds into the current punch
let stepHit = false;       // contact fired for the current punch
let fighterX = 0;
let xFrom = 0, xTo = 0;    // travel lerp for the current punch
let settleT = 0;
let lastHitT = -1;

function predictedAxis() {
  const dtPeak = Math.max(0, plan[Math.max(0, stepIdx)].peakReal - stepT);
  return bagAxisX() + (bag.vx + bag.om * BAG_CENTER_H) * dtPeak;   // linear lead
}
function standoffX(step, axisAtPeak) {
  /* x such that the 3D distance fighter->bag centre equals reach-0.06 at
   * full extension (fist dents the surface by ~6cm); never closer than a
   * clear lateral gap so the fighter is never hidden behind the bag */
  const dNeed = Math.max(0.4, step.reach - 0.06);
  const dx = Math.sqrt(Math.max(0.01, dNeed * dNeed - FIGHTER_Z * FIGHTER_Z));
  return axisAtPeak + Math.max(dx, BAG_R + 0.36);
}
function faceYaw(fromX, toAxis) {
  const dx = toAxis - fromX;
  return Math.atan2(dx, -FIGHTER_Z);
}

let yawFrom = -Math.PI / 2, yawTo = -Math.PI / 2;

function startStep(k) {
  stepIdx = k;
  stepT = 0;
  stepHit = false;
  const st = plan[k];
  play(fighter, st.clip, { fade: 0.12, ts: SPEED });
  xFrom = fighterX;
  yawFrom = fighter.group.rotation.y;
  const axisAtPeak = predictedAxis();
  xTo = standoffX(st, axisAtPeak);
  yawTo = faceYaw(xTo, axisAtPeak);
  setTimeout(() => playWhoosh(), Math.max(0, st.peakReal * 1000 - 180));
}

function fireHit(st, point, dirFromAxis) {
  hitBag(st.power);
  spawnFlash(point);
  spawnSparks(point, dirFromAxis);
  playThud(0.7 + st.power * 0.4);
  shakeT = 0;
  lastHitT = showT;
}

function surfacePoint(fistWorld) {
  /* nearest point on the bag surface to the fist */
  bagMesh.getWorldPosition(_sa);
  const dir = _sv.copy(fistWorld).sub(_sa);
  dir.y = 0;
  if (dir.lengthSq() < 1e-6) dir.set(0, 0, 1);
  dir.normalize().multiplyScalar(BAG_R + 0.02);
  return _sa.clone().add(dir);
}

function tryContact(st) {
  const fist = fighter.bones[st.fist];
  fist.getWorldPosition(_sv);
  const p = _sv.clone();
  bagMesh.updateMatrixWorld(true);
  const local = bagMesh.worldToLocal(p.clone());
  const dist = Math.hypot(local.x, local.z);
  if (dist < BAG_R + 0.20 && Math.abs(local.y) < 0.75) {
    const dir = new THREE.Vector3(local.x, 0, local.z).normalize();
    dir.applyQuaternion(bagMesh.getWorldQuaternion(new THREE.Quaternion()));
    fireHit(st, p, dir);
    return true;
  }
  return false;
}

function advanceCombo(dt) {
  if (stepIdx < 0) return;
  const st = plan[stepIdx];
  stepT += dt;
  /* travel toward the punch target, easing into the peak */
  const u = Math.min(1, stepT / Math.max(0.001, st.peakReal));
  const e = u * u * (3 - 2 * u);
  fighterX = xFrom + (xTo - xFrom) * e;
  fighter.group.position.x = fighterX;
  fighter.group.rotation.y = yawFrom + (yawTo - yawFrom) * e;
  fighter.group.position.z = FIGHTER_Z;

  if (!stepHit) stepHit = tryContact(st);
  const act = fighter.actions[st.clip];
  if (!stepHit && stepT >= st.peakReal + 0.06) {
    /* fallback: fire at the nearest surface point even if the fist fell
     * short — the beat must land */
    const fist = fighter.bones[st.fist];
    fist.getWorldPosition(_sv);
    bagMesh.getWorldPosition(_sa);
    const dir = _sv.clone().sub(_sa); dir.y = 0;
    if (dir.lengthSq() < 1e-6) dir.set(-1, 0, 0);
    dir.normalize();
    fireHit(st, surfacePoint(_sv.clone()), dir);
    stepHit = true;
  }

  const done = stepT >= st.realDur;
  const isLast = stepIdx === plan.length - 1;
  if (done) {
    if (isLast) {
      phase = 'settle';
      settleT = 0;
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
  gymGroup.visible = false;
  fighter.group.position.set(0, 0, 0);
  fighter.group.rotation.y = Math.PI * 0.375;
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
  lastHitT = -1;
  bag.th = 0; bag.om = 0; bag.vx = 0; bag.x = 0; bag.squash = 0;
  bagRoot.position.x = 0;
  bagPivot.rotation.z = 0;
  bagMesh.scale.setScalar(1);
  for (const f of flashes) { f.sp.visible = false; f.t = 1e9; }
  for (const s of sparks) { s.sp.visible = false; s.t = 1e9; }
  gymGroup.visible = true;
  hostEl.classList.remove('jab-docked', 'jab-paused');
  hostEl.classList.add('jab-live');
  replayBtn.hidden = true;
  if (wasDocked) {
    camPos.copy(camera.position);
    camTgt.copy(controls.target);
  } else {
    camPos.set(1.4, 1.35, 5.2);
    camTgt.set(0.6, 1.05, 0);
  }
  controls.enabled = false;
  stepIdx = 0; stepT = 0;
  fighterX = standoffX(plan[0], 0) + 1.15;   // enters well to the right
  fighter.group.position.set(fighterX, 0, FIGHTER_Z);
  fighter.group.rotation.y = faceYaw(fighterX, 0);
  stepIdx = -1;
  fighter.mixer.stopAllAction();
  play(fighter, 'guard', { fade: 0.15, loop: true });
  applyShowTop();
  resize();
}

function advance(dt) {
  showT += dt;
  bagStep(dt);
  fxStep(dt);
  if (shakeT < 1) shakeT += dt;
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
      controls.target.copy(camTgt);
      controls.enabled = true;
      controls.update();
    }
  } else if (phase === 'docked') {
    fighter.mixer.update(dt);
  }
  /* 'paused': idle loops (mixer driven below), bag keeps swinging */
  if (phase === 'paused' && fighter.mixer) fighter.mixer.update(dt);
}

/* ---------- camera ---------- */
const _want = { pos: new THREE.Vector3(), tgt: new THREE.Vector3() };
function computeCamera() {
  const aspect = camera.aspect || 1;
  const tanH = Math.tan(camera.fov * Math.PI / 360);
  const portrait = aspect < 0.8;
  const mid = phase === 'docked' ? 0
    : fighterX * 0.65 + bagAxisX() * 0.35;
  const zH = 2.6 / tanH;
  const zW = 2.2 / (tanH * aspect);
  const z = Math.max(4.6, zH, zW) * (portrait ? 1.22 : 1);
  _want.tgt.set(mid, 1.1, 0);
  _want.pos.set(mid + z * 0.24, 1.7 + z * 0.07, z);
}
function updateCamera(dt) {
  if (controls.enabled) {
    controls.update();
    headFill.position.copy(camera.position).sub(controls.target).setLength(6).add(controls.target);
    headFill.target.position.copy(controls.target);
    return;
  }
  computeCamera();
  const k = 1 - Math.exp(-dt * 3.2);
  camPos.lerp(_want.pos, k);
  camTgt.lerp(_want.tgt, k);
  camera.position.copy(camPos);
  if (shakeT < 0.22) {
    const a = 0.035 * (1 - shakeT / 0.22);
    camera.position.x += (Math.random() * 2 - 1) * a;
    camera.position.y += (Math.random() * 2 - 1) * a;
  }
  camera.lookAt(camTgt);
  headFill.position.copy(camera.position).sub(camTgt).setLength(6).add(camTgt);
  headFill.target.position.copy(camTgt);
}

/* ---------- loop ---------- */
const clock = new THREE.Clock();
let running = false;
let vt = null;
let frames = 0;
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
    bag: { get th() { return bag.th; }, get axisX() { return bagAxisX(); } },
    get fighterX() { return fighterX; },
    restart: () => { resetShow(); startLoop(); },
    resume: () => startLoop(),
    stepTo(target) {
      stopLoop();
      const dt = 1 / 30;
      let guard = 0;
      vt = 0;
      while (showT < target - 1e-6 && guard++ < 3000) advance(dt);
      vt = null;
      updateCamera(1 / 30);
      renderer.render(scene, camera);
    },
  };
}

loadGLB(GLB_URL).then((gltf) => {
  try { build(gltf); }
  catch (err) { fail(err); }
}).catch(fail);
