/*
 * Boxing vs Kickboxing — a scripted two-fighter bout.
 *
 * Man (BOXING) stands left, woman (KICKBOXING) right, both in guard. The
 * kickboxer opens at long range (roundhouse kick -> flying kick), the boxer
 * blocks on his gloves, then closes the distance and finishes with a
 * jab-cross-uppercut knockout. A timeline drives clip crossfades plus small
 * position tweens so the strikes visibly land on target.
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const canvas = document.getElementById('bvk-canvas');
const loadingEl = document.getElementById('bvk-loading');
const loadingText = document.getElementById('bvk-loading-text');
const errorEl = document.getElementById('bvk-error');
const barEl = document.getElementById('bvk-bar');
const replayBtn = document.getElementById('bvk-replay');
const koEl = document.getElementById('ko');
const tagBoxing = document.getElementById('tag-boxing');
const tagKick = document.getElementById('tag-kickboxing');

/* ---------- renderer / scene ---------- */
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.25;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 60);

const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.enablePan = false;
controls.minDistance = 2.2;
controls.maxDistance = 12;
controls.target.set(0, 1.0, 0);
controls.update();

scene.add(new THREE.HemisphereLight(0xd9e8ff, 0x3a3630, 2.0));
const keyLight = new THREE.DirectionalLight(0xffe8d2, 3.4);
keyLight.position.set(2.2, 3.2, 2.6);
keyLight.castShadow = true;
keyLight.shadow.mapSize.set(1024, 1024);
keyLight.shadow.camera.left = -4;
keyLight.shadow.camera.right = 4;
keyLight.shadow.camera.top = 4;
keyLight.shadow.camera.bottom = -4;
scene.add(keyLight);
const rimLight = new THREE.DirectionalLight(0x86b8ff, 2.0);
rimLight.position.set(-2.4, 2.0, -2.6);
scene.add(rimLight);
const fillLight = new THREE.DirectionalLight(0xffffff, 0.9);
fillLight.position.set(0, 1.4, 4);
scene.add(fillLight);

/* soft floor disc */
const floor = new THREE.Mesh(
  new THREE.CircleGeometry(3.4, 48),
  new THREE.MeshStandardMaterial({ color: 0xe8ecf2, roughness: 1, metalness: 0 })
);
floor.rotation.x = -Math.PI / 2;
floor.receiveShadow = true;
scene.add(floor);
const ring = new THREE.Mesh(
  new THREE.RingGeometry(3.15, 3.4, 64),
  new THREE.MeshBasicMaterial({ color: 0xc9d2de })
);
ring.rotation.x = -Math.PI / 2;
ring.position.y = 0.002;
scene.add(ring);

/* ---------- fighters ---------- */
function forceOpaque(mat) {
  if (!mat || !mat.transparent) return;
  mat.transparent = false;
  mat.depthWrite = true;
  mat.alphaTest = 0;
}

class Fighter {
  constructor(dir) {           // dir: +1 faces right, -1 faces left
    this.group = new THREE.Group();
    this.group.rotation.y = (dir > 0 ? 1 : -1) * Math.PI / 2;
    this.mixer = null;
    this.actions = {};
    this.head = null;
    this.ready = false;
  }
  async load(url, name) {
    const gltf = await new GLTFLoader().loadAsync(url);
    const root = gltf.scene;
    root.traverse((o) => {
      if (o.isMesh) {
        o.castShadow = true;
        o.frustumCulled = false;
        forceOpaque(o.material);
      }
    });
    this.group.add(root);
    root.updateMatrixWorld(true);

    // glTF export strips the ':' from mixamorig names — try both spellings
    this.head = root.getObjectByName('mixamorig:Head') || root.getObjectByName('mixamorigHead') || null;
    this.mixer = new THREE.AnimationMixer(root);
    for (const clip of gltf.animations) {
      const act = this.mixer.clipAction(clip);
      act.enabled = true;
      this.actions[clip.name] = act;
    }

    // The bind pose is Z-up and lying flat (Mixamo FBX heritage) — the clips
    // themselves carry the stand-up. Sample a guard frame to measure the real
    // skinned height, normalize to a 1.75 m fighter, then drop feet to y=0.
    // NOTE: this export pipeline leaves the animated "up" along +Z (unlike
    // man-home.glb which was fixed at build time), so rotate the rig first.
    root.rotation.x = -Math.PI / 2;
    root.updateMatrixWorld(true);
    const first = this.actions['guard'] || Object.values(this.actions)[0];
    first.reset().play();
    this.mixer.setTime(0.5);
    let pts = samplePose(root);
    const h0 = Math.max(...pts.map(p => p.y)) - Math.min(...pts.map(p => p.y));
    const s = 1.75 / h0;
    root.scale.setScalar(s);
    root.updateMatrixWorld(true);
    pts = samplePose(root);
    root.position.y = -Math.min(...pts.map(p => p.y));
    root.updateMatrixWorld(true);
    console.log(`[bvk] ${name}: bindH=${h0.toFixed(2)}m scale=${s.toFixed(2)}`);
    this.mixer.stopAllAction();
    this.ready = true;
  }
  play(name, { fade = 0.2, clamp = false } = {}) {
    const next = this.actions[name];
    if (!next) return;
    next.reset();
    next.clampWhenFinished = clamp;
    next.setLoop(clamp ? THREE.LoopOnce : THREE.LoopRepeat);
    if (fade <= 0) { next.setEffectiveWeight(1); next.play(); }
    else next.fadeIn(fade).play();
    for (const a of Object.values(this.actions)) {
      if (a !== next && a.isRunning()) a.fadeOut(Math.max(fade, 0.001));
    }
  }
  stopAll() { this.mixer.stopAllAction(); }
}

/* skinned-mesh world vertices (sparsely sampled) — bones-only bounds miss
 * hair and shoe tops, and geometry bounds ignore skinning entirely */
const _tv = new THREE.Vector3();
function samplePose(model, budget = 9000) {
  model.updateMatrixWorld(true);
  const meshes = [];
  let total = 0;
  model.traverse((o) => {
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
      _tv.fromBufferAttribute(pos, i);
      if (o.isSkinnedMesh) o.applyBoneTransform(i, _tv);
      _tv.applyMatrix4(o.matrixWorld);
      pts.push(_tv.clone());
    }
  }
  return pts;
}

const man = new Fighter(+1);      // BOXING, left, faces right
const woman = new Fighter(-1);    // KICKBOXING, right, faces left

/* home positions (x along the ring line) */
const HOME = { man: -0.85, woman: 0.85 };
man.group.position.set(HOME.man, 0, 0);
woman.group.position.set(HOME.woman, 0, 0);
scene.add(man.group, woman.group);

/* ---------- timeline ----------
 * { t, who, clip, move?, clamp? }  — move tweens group x by `move` over the
 * clip duration; omitted clip = position-only move.
 */
const CLIP_DUR = {
  m:   { guard: 5.0, block: 1.6, 'step-backward': 0.83, 'step-forward': 1.0, 'jab-cross': 2.17, uppercut: 1.33 },
  w: { guard: 5.0, 'roundhouse-kick': 2.5, 'flying-kick': 1.5, 'hit-uppercut': 1.67, 'knock-out': 4.93 },
};

const TL = [
  { t: 0.0,  who: 'm', clip: 'guard' },
  { t: 0.0,  who: 'w', clip: 'guard' },

  /* --- kickboxer opens at long range --- */
  { t: 1.5,  who: 'w', clip: 'roundhouse-kick', move: -0.32 },
  { t: 2.3,  who: 'm', clip: 'block' },                       // gloves meet the kick
  { t: 3.7,  who: 'm', clip: 'step-backward', move: -0.55 },  // shove the range back out

  { t: 4.7,  who: 'w', clip: 'flying-kick', move: -0.85 },    // leaps in
  { t: 4.85, who: 'm', clip: 'block' },                       // meets it on the gloves
  { t: 6.1,  who: 'w', clip: 'guard' },
  { t: 6.35, who: 'w', move: 0.55 },                           // backs off to punch range

  /* --- boxer closes and finishes --- */
  { t: 6.7,  who: 'm', clip: 'step-forward', move: 0.62 },
  { t: 7.8,  who: 'm', clip: 'jab-cross' },
  { t: 10.0, who: 'm', clip: 'uppercut' },
  { t: 10.45, who: 'w', clip: 'hit-uppercut' },                // chin snaps back
  { t: 12.1, who: 'w', clip: 'knock-out', clamp: true },
  { t: 11.6, who: 'm', clip: 'guard' },
  { t: 13.9, ko: true },
];
const END_T = 15.5;

/* ---------- engine ---------- */
let clock0 = null;      // performance.now() of bout start (ms)
let vt = null;          // virtual time override — deterministic QA stepping
let fired = [];
let moves = [];         // active position tweens { who, from, to, t0, t1 }
let done = false;

const whoOf = { m: man, w: woman };

function tweenX(who, delta, dur) {
  const f = whoOf[who];
  moves.push({ who, from: f.group.position.x, to: f.group.position.x + delta, t0: boutT(), t1: boutT() + dur });
}

function boutT() { return vt !== null ? vt : (performance.now() - clock0) / 1000; }

function startBout() {
  man.group.position.set(HOME.man, 0, 0);
  woman.group.position.set(HOME.woman, 0, 0);
  man.stopAll(); woman.stopAll();
  man.play('guard', { fade: 0 }); woman.play('guard', { fade: 0 });
  clock0 = performance.now();
  fired = [];
  moves = [];
  done = false;
  koEl.classList.remove('on');
}

function updateBout() {
  if (clock0 === null || done) return;
  const t = boutT();

  for (let i = 0; i < TL.length; i++) {
    if (fired[i] || t < TL[i].t) continue;
    fired[i] = true;
    const b = TL[i];
    if (b.ko) { koEl.classList.add('on'); continue; }
    const f = whoOf[b.who];
    if (b.clip) f.play(b.clip, { clamp: !!b.clamp, fade: b.clamp ? 0.12 : 0.2 });
    if (b.move) tweenX(b.who, b.move, (b.clip ? (CLIP_DUR[b.who][b.clip] || 1) : 0.6));
  }

  for (let i = moves.length - 1; i >= 0; i--) {
    const mv = moves[i];
    const f = whoOf[mv.who];
    const p = Math.min(1, Math.max(0, (t - mv.t0) / Math.max(0.001, mv.t1 - mv.t0)));
    f.group.position.x = mv.from + (mv.to - mv.from) * (p * p * (3 - 2 * p));  // smoothstep
    if (p >= 1) moves.splice(i, 1);
  }

  if (t >= END_T) done = true;
}

/* ---------- camera framing ---------- */
function frameCamera() {
  const w = canvas.clientWidth || 1;
  const h = canvas.clientHeight || 1;
  camera.aspect = w / Math.max(1, h);
  const portrait = camera.aspect < 0.9;
  camera.fov = portrait ? 55 : 40;
  const z = portrait ? 6.6 : 4.8;
  camera.position.set(0.15, 1.55, z);
  camera.updateProjectionMatrix();
}
new ResizeObserver(() => {
  const w = canvas.clientWidth || canvas.parentElement.clientWidth;
  const h = canvas.clientHeight || canvas.parentElement.clientHeight;
  renderer.setSize(w, h, false);
  frameCamera();
}).observe(canvas.parentElement);

/* ---------- labels ---------- */
const v = new THREE.Vector3();
function placeTag(el, fighter) {
  if (!fighter.head || !fighter.ready) { el.style.display = 'none'; return; }
  fighter.head.getWorldPosition(v);
  v.y += 0.32;
  v.project(camera);
  const stage = canvas.parentElement.getBoundingClientRect();
  const x = (v.x * 0.5 + 0.5) * stage.width;
  const y = (-v.y * 0.5 + 0.5) * stage.height;
  el.style.display = v.z < 1 ? 'block' : 'none';
  el.style.left = x + 'px';
  el.style.top = y + 'px';
}

/* ---------- loop ---------- */
const clock = new THREE.Clock();
function tick() {
  try {
    const dt = Math.min(0.05, clock.getDelta());
    updateBout();
    man.mixer && man.mixer.update(dt);
    woman.mixer && woman.mixer.update(dt);
    controls.update();
    renderer.render(scene, camera);
    placeTag(tagBoxing, man);
    placeTag(tagKick, woman);
    requestAnimationFrame(tick);
  } catch (e) {
    window.__tickErr = String(e && e.stack || e);
    console.error('[bvk] tick crashed:', e);
  }
}

/* ---------- boot ---------- */
(async () => {
  try {
    loadingText.textContent = 'Loading the boxer…';
    await man.load('./models/boxer-man.glb', 'man');
    loadingText.textContent = 'Loading the kickboxer…';
    await woman.load('./models/kick-woman.glb', 'woman');
    loadingEl.hidden = true;
    barEl.hidden = false;
    startBout();
    tick();
  } catch (e) {
    console.error(e);
    loadingEl.hidden = true;
    errorEl.textContent = 'Could not load the fighters. Please refresh and try again.';
    errorEl.hidden = false;
  }
})();

replayBtn.addEventListener('click', () => startBout());

/* debug hooks for QA automation */
function stepTo(t) {
  vt = 0;
  clock0 = performance.now();
  fired = []; moves = []; done = false;
  koEl.classList.remove('on');
  man.group.position.set(HOME.man, 0, 0);
  woman.group.position.set(HOME.woman, 0, 0);
  man.stopAll(); woman.stopAll();
  man.play('guard', { fade: 0 }); woman.play('guard', { fade: 0 });
  const dt = 1 / 60;
  for (let tt = 0; tt <= t; tt += dt) {
    vt = tt;
    updateBout();
    man.mixer.update(dt);
    woman.mixer.update(dt);
  }
  vt = t;
  renderer.render(scene, camera);
  placeTag(tagBoxing, man);
  placeTag(tagKick, woman);
}
window.__bvk = { man, woman, camera, scene, THREE, get clock0() { return clock0; }, stepTo };
