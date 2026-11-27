/*
 * Taekwondo vs Muay Thai — a scripted two-fighter bout with live health bars.
 * Same engine as /training/boxing-vs-kickboxing/ (fullscreen fixed-camera show,
 * docks into the article flow after the KO), new choreography:
 *
 *   Muay Thai (left, blue bar) starts at 100%. Taekwondo (right, orange bar)
 *   opens with a roundhouse kick  -> Muay Thai 60%
 *   a second roundhouse           -> Muay Thai 20%
 *   Muay Thai dashes in with a long step (close range) and drives a knee
 *   strike (played fast)          -> Taekwondo 100% -> 0%, falls on the spot.
 *
 * Each attack has a baked contact frame keyed to the attacker's strike bone
 * (toes / knee) and the defender's target bone; when it fires we drop the
 * health bar, spawn an impact flash + sparks between the bones, shake the
 * camera and play a synthesized hit sound.
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

const canvas = document.getElementById('tmt-canvas');
const stageEl = canvas.parentElement;
const loadingEl = document.getElementById('tmt-loading');
const loadingText = document.getElementById('tmt-loading-text');
const errorEl = document.getElementById('tmt-error');
const replayBtn = document.getElementById('tmt-replay');
const koEl = document.getElementById('ko');
const hpMuay = document.getElementById('hp-muay');
const hpTkd = document.getElementById('hp-tkd');

/* ---------- renderer / scene (same recipe as boxing-vs-kickboxing) ---------- */
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.42;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 60);

const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
controls.enableZoom = false;
controls.enableRotate = false;
controls.enablePan = false;
controls.minDistance = 2.2;
controls.maxDistance = 12;
controls.target.set(-0.2, 1.0, 0);
controls.update();

scene.add(new THREE.HemisphereLight(0xdcebff, 0x4a4640, 2.9));
try {
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
} catch (e) { /* IBL optional */ }
const keyLight = new THREE.DirectionalLight(0xffe8d2, 4.2);
keyLight.position.set(2.2, 3.2, 2.6);
keyLight.castShadow = true;
keyLight.shadow.mapSize.set(1024, 1024);
keyLight.shadow.camera.left = -4;
keyLight.shadow.camera.right = 4;
keyLight.shadow.camera.top = 4;
keyLight.shadow.camera.bottom = -4;
scene.add(keyLight);
const rimLight = new THREE.DirectionalLight(0x9cc6ff, 2.5);
rimLight.position.set(-2.4, 2.0, -2.6);
scene.add(rimLight);
const fillLight = new THREE.DirectionalLight(0xffffff, 1.8);
fillLight.position.set(0, 1.4, 4);
scene.add(fillLight);

const floor = new THREE.Mesh(
  new THREE.CircleGeometry(9, 64),
  new THREE.ShadowMaterial({ opacity: 0.22 })
);
floor.rotation.x = -Math.PI / 2;
floor.receiveShadow = true;
scene.add(floor);

/* ---------- fighters ---------- */
function forceOpaque(mat) {
  if (!mat || !mat.transparent) return;
  mat.transparent = false;
  mat.depthWrite = true;
  mat.alphaTest = 0;
}

function findBone(root, name) {
  return root.getObjectByName(name)
      || root.getObjectByName('mixamorig:' + name)
      || root.getObjectByName('mixamorig' + name)
      || null;
}
const BONE_NAMES = ['LeftHand', 'RightHand', 'LeftFoot', 'RightFoot',
  'LeftToeBase', 'RightToeBase', 'Head', 'Spine', 'Spine1', 'Spine2',
  'LeftLeg', 'RightLeg'];

class Fighter {
  constructor(dir) {           // dir: +1 faces right, -1 faces left
    this.group = new THREE.Group();
    this.group.rotation.y = (dir > 0 ? 1 : -1) * Math.PI / 2;
    this.mixer = null;
    this.actions = {};
    this.bones = {};
    this.head = null;
    this.ready = false;
    this.baseX = 0;
    this.nudgeX = 0;
    this.hopY = 0;
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

    for (const n of BONE_NAMES) this.bones[n] = findBone(root, n);
    this.head = this.bones['Head'];
    this.mixer = new THREE.AnimationMixer(root);
    for (const clip of gltf.animations) {
      if (/Layer0$/.test(clip.name)) continue;
      const act = this.mixer.clipAction(clip);
      act.enabled = true;
      this.actions[clip.name] = act;
    }

    // Bind pose is Z-up and lying flat (Mixamo FBX heritage) — normalize the
    // real skinned height to 1.75 m and drop the feet to y=0.
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
    console.log(`[tmt] ${name}: bindH=${h0.toFixed(2)}m scale=${s.toFixed(2)} clips=${Object.keys(this.actions).join(',')}`);
    this.mixer.stopAllAction();
    this.ready = true;
  }
  play(name, { fade = 0.2, clamp = false, rev = 0, rate = 1, start = 0 } = {}) {
    const next = this.actions[name];
    if (!next) return;
    const dominant = next.getEffectiveWeight() > 0.4;
    const looping = name === 'guard' && rev === 0;
    next.reset();
    next.clampWhenFinished = !looping && (clamp || rev > 0);
    next.setLoop(looping ? THREE.LoopRepeat : THREE.LoopOnce, looping ? Infinity : 1);
    if (rev > 0) {
      const from = start > 0 ? Math.min(start, next.getClip().duration - 0.02) : next.getClip().duration - 0.02;
      next.time = Math.max(0.01, from);
      next.setEffectiveTimeScale(-rev);
    } else {
      next.time = Math.min(Math.max(0, start), Math.max(0, next.getClip().duration - 0.02));
      next.setEffectiveTimeScale(TS * rate);
    }
    if (fade <= 0 || dominant) { next.setEffectiveWeight(1); next.play(); }
    else next.fadeIn(fade).play();
    for (const a of Object.values(this.actions)) {
      if (a === next) continue;
      const w = a.getEffectiveWeight();
      if (w > 0.001) a.fadeOut(fade > 0 ? fade : 0.001);
      else if (a.enabled) a.stop();
    }
  }
  stopAll() { this.mixer.stopAllAction(); }
}

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

const muay = new Fighter(+1);   // MUAY THAI, left, faces right
const tkd = new Fighter(-1);    // TAEKWONDO, right, faces left

const HOME = { m: -0.85, w: 0.45 };
let edgeX = 1.3;
const homeOut = () => ({ m: -edgeX, w: edgeX * 0.92 });
muay.group.position.set(homeOut().m, 0, 0);
tkd.group.position.set(homeOut().w, 0, 0);
scene.add(muay.group, tkd.group);

/* ---------- timeline ---------- */
const TS = 1.35;
const HOP_IN = { dur: 0.8, h: 0.5 };
const HOP_OUT = { dur: 0.8, h: 0.45 };

/* raw clip durations at 30 fps (from the Blender build log) */
const CLIP_DUR = {
  m: { guard: 5.0, 'step-forward': 1.0, 'illegal-knee': 2.27, 'step-backward': 0.83 },
  w: { guard: 5.0, 'roundhouse-front': 2.5, 'roundhouse-side': 2.5, 'knock-out': 4.93 },
};

/* Baked contacts: frac = fraction into the raw clip where the strike lands,
 * measured by bone-probe on the built GLBs at fight spacing (cdp_tmt_qa.mjs).
 * NOTE: roundhouse-front strikes with the LEFT foot, roundhouse-side with the
 * RIGHT — the takes chamber opposite legs. dx = small residual x-correction
 * applied to the attacker around the contact frame. hp = defender health. */
const HITS = {
  kick1: { frac: 0.41, atkBone: 'LeftToeBase', defBone: 'Spine2', dx: 0.02, fx: 'block', snd: 'kick', hp: 60 },
  kick2: { frac: 0.448, atkBone: 'RightToeBase', defBone: 'Spine2', dx: 0.04, fx: 'block', snd: 'kick', hp: 20 },
  knee:  { frac: 0.347, atkBone: 'RightLeg', defBone: 'Spine2', dx: 0.05, fx: 'ko', snd: 'ko', hp: 0, ko: true },
};

const TL = [
  { t: 0.0, who: 'm', clip: 'guard' },
  { t: 0.0, who: 'w', clip: 'guard' },

  /* both hop from the stage edge into the centre, then square up */
  { t: 0.2, who: 'm', moveTo: 'fight', hop: true, tweenDur: HOP_IN.dur, hopH: HOP_IN.h },
  { t: 0.2, who: 'w', moveTo: 'fight', hop: true, tweenDur: HOP_IN.dur, hopH: HOP_IN.h },

  /* --- kick 1: taekwondo roundhouse (left leg) into the muay thai body,
   *     health 100 -> 60; he is knocked half a step back --- */
  { t: 1.55, who: 'w', clip: 'roundhouse-front', x: 0.40, tweenDur: 0.5, clamp: true, hit: 'kick1' },
  { t: 2.50, who: 'm', clip: 'step-backward', move: -0.38, tweenDur: 0.38, fade: 0.1, clamp: true },
  { t: 3.00, who: 'm', clip: 'guard' },

  /* --- kick 2: the other leg chambers and lands before he resets, 60 -> 20 --- */
  { t: 3.55, who: 'w', clip: 'roundhouse-side', x: 0.25, tweenDur: 0.45, clamp: true, hit: 'kick2' },
  { t: 4.60, who: 'm', clip: 'step-backward', move: -0.30, tweenDur: 0.36, fade: 0.1, clamp: true },
  { t: 5.20, who: 'm', clip: 'guard' },
  { t: 5.05, who: 'w', clip: 'guard', fade: 0.25 },

  /* --- muay thai answers: an explosive step-in dash closes the distance
   *     right into taekwondo's blind zone --- */
  { t: 5.60, who: 'm', clip: 'step-forward', x: -0.12, tweenDur: 0.30, rate: 1.7, clamp: true },

  /* --- the knee: played fast (1.7x on top of the global 1.35x), health
   *     100 -> 0, taekwondo collapses on the spot --- */
  { t: 5.95, who: 'm', clip: 'illegal-knee', rate: 1.7, clamp: true, hit: 'knee' },
  { t: 7.15, who: 'm', clip: 'guard', fade: 0.2 },

  /* --- 1 s lying still, then the winner hops back to the screen edge and
   *     the fallen fighter stands up and follows --- */
  { t: 8.30, koOff: true },
  { t: 8.40, who: 'w', clip: 'knock-out', rev: 6.5, start: 3.68, fade: 0.2 }, // reversed = stand up
  { t: 8.55, who: 'm', moveTo: 'out', hop: true, tweenDur: HOP_OUT.dur, hopH: HOP_OUT.h },
  { t: 8.95, who: 'w', clip: 'guard', fade: 0.15 },
  { t: 9.25, who: 'w', moveTo: 'out', hop: true, tweenDur: HOP_OUT.dur, hopH: HOP_OUT.h },
];
const END_T = 10.20;
/* knee contact -> hand the head over to the knock-out clip right there; the
 * fall starts immediately (no separate hit-reaction clip for this fighter) */
const KO_FALL_DELAY = 0.06;

/* derived contact list */
const contacts = [];
for (const e of TL) {
  if (!e.hit || !e.clip) continue;
  const rawDur = CLIP_DUR[e.who][e.clip];
  const start = e.start || 0;
  const scale = TS * (e.rate || 1);
  const clipEnd = e.t + (rawDur - start) / scale;
  for (const hname of Array.isArray(e.hit) ? e.hit : [e.hit]) {
    const h = HITS[hname];
    contacts.push({
      t: e.t + Math.max(0, h.frac * rawDur - start) / scale, clipEnd,
      atk: e.who, def: e.who === 'm' ? 'w' : 'm',
      atkBone: h.atkBone, defBone: h.defBone, dx: h.dx || 0,
      fx: h.fx, snd: h.snd, hp: h.hp, ko: !!h.ko, fired: false,
    });
  }
}

/* ---------- health bars ---------- */
const hpEls = { m: hpMuay, w: hpTkd };
const hpState = { m: 100, w: 100 };
let flashTimer = 0;
function setHp(who, val, t) {
  hpState[who] = val;
  const el = hpEls[who];
  el.querySelector('.fill').style.width = val + '%';
  el.querySelector('.pct').textContent = val + '%';
  el.classList.add('flash');
  setTimeout(() => el.classList.remove('flash'), 450);
}
function resetHp() {
  hpState.m = 100; hpState.w = 100;
  for (const who of ['m', 'w']) {
    const el = hpEls[who];
    el.querySelector('.fill').style.width = '100%';
    el.querySelector('.pct').textContent = '100%';
  }
}

/* ---------- impact FX (flash + sparks) ---------- */
function makeRadialTex(stops, size = 128) {
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
const texFlash = makeRadialTex([
  [0, 'rgba(255,255,255,1)'],
  [0.25, 'rgba(255,214,120,0.95)'],
  [0.55, 'rgba(255,130,50,0.55)'],
  [1, 'rgba(255,110,40,0)'],
]);
const texSpark = makeRadialTex([
  [0, 'rgba(255,255,255,1)'],
  [0.4, 'rgba(255,200,110,0.9)'],
  [1, 'rgba(255,140,60,0)'],
], 64);

const FX_STYLE = {
  block: { flash: 0.5, sparks: 7, shake: 0.035, shakeT: 0.32 },
  punch: { flash: 0.55, sparks: 8, shake: 0.05, shakeT: 0.35 },
  ko:    { flash: 0.95, sparks: 12, shake: 0.1, shakeT: 0.55 },
};
const fxLive = [];
function spawnImpact(pos, kind, qaFrozen) {
  const st = FX_STYLE[kind] || FX_STYLE.punch;
  const born = boutT();
  const flash = new THREE.Sprite(new THREE.SpriteMaterial({
    map: texFlash, transparent: true, depthTest: false, opacity: 1,
  }));
  flash.position.copy(pos);
  flash.scale.setScalar(st.flash);
  flash.renderOrder = 20;
  scene.add(flash);
  fxLive.push({ s: flash, life: 0, ttl: 0.32, flash: true, base: st.flash, born });

  for (let i = 0; i < st.sparks; i++) {
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({
      map: texSpark, transparent: true, depthTest: false, opacity: 1,
    }));
    sp.position.copy(pos);
    sp.scale.setScalar(0.09 + Math.random() * 0.07);
    sp.renderOrder = 21;
    const vel = new THREE.Vector3(
      (Math.random() - 0.5) * 2.4, Math.random() * 1.6 + 0.4, (Math.random() - 0.5) * 2.4
    );
    scene.add(sp);
    fxLive.push({ s: sp, vel, life: 0, ttl: 0.45, flash: false, born });
  }
  if (qaFrozen) return;
}
function updateFx(dt) {
  for (let i = fxLive.length - 1; i >= 0; i--) {
    const f = fxLive[i];
    f.life += dt;
    const p = f.life / f.ttl;
    if (p >= 1) { scene.remove(f.s); f.s.material.dispose(); fxLive.splice(i, 1); continue; }
    if (!f.flash) {
      f.vel.y -= 5.5 * dt;
      f.s.position.addScaledVector(f.vel, dt);
    } else {
      f.s.scale.setScalar(f.base * (1 + p * 1.4));
    }
    f.s.material.opacity = 1 - p;
  }
}
function clearFx() {
  for (const f of fxLive) { scene.remove(f.s); f.s.material.dispose(); }
  fxLive.length = 0;
}

let shakeT = 0, shakeDur = 0, shakeAmp = 0;
function shake(kind) {
  const st = FX_STYLE[kind] || FX_STYLE.punch;
  shakeT = st.shakeT; shakeDur = st.shakeT; shakeAmp = st.shake;
}
const _shakeOff = new THREE.Vector3();
function shakeOffset() {
  if (shakeT <= 0) return null;
  const p = shakeT / shakeDur;
  const a = shakeAmp * p * p;
  _shakeOff.set((Math.random() - 0.5) * 2 * a, (Math.random() - 0.5) * 2 * a, (Math.random() - 0.5) * 2 * a);
  return _shakeOff;
}

/* ---------- hit sounds (synthesized) ---------- */
const AudioFX = (() => {
  let ctx = null, master = null;
  function ensure() {
    try {
      if (!ctx) {
        ctx = new (window.AudioContext || window.webkitAudioContext)();
        master = ctx.createGain();
        master.gain.value = 0.9;
        master.connect(ctx.destination);
      }
      if (ctx.state === 'suspended') ctx.resume();
      return ctx;
    } catch (e) { return null; }
  }
  function noise(dur, freq, q, vol) {
    const n = Math.ceil(ctx.sampleRate * dur);
    const buf = ctx.createBuffer(1, n, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, 2);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass'; f.frequency.value = freq; f.Q.value = q;
    const g = ctx.createGain(); g.gain.value = vol;
    src.connect(f); f.connect(g); g.connect(master);
    src.start();
  }
  function thud(f0, f1, dur, vol) {
    const now = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(f0, now);
    o.frequency.exponentialRampToValueAtTime(f1, now + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, now);
    g.gain.exponentialRampToValueAtTime(0.001, now + dur);
    o.connect(g); g.connect(master);
    o.start(now); o.stop(now + dur + 0.05);
  }
  return {
    unlock: ensure,
    hit(kind) {
      if (!ensure() || ctx.state !== 'running') return;
      if (kind === 'punch')      { noise(0.06, 900, 1.0, 0.5);  thud(150, 65, 0.12, 0.55); }
      else if (kind === 'kick')  { noise(0.08, 600, 1.0, 0.65); thud(120, 55, 0.15, 0.7); }
      else /* ko */              { noise(0.05, 1200, 1.0, 0.4); noise(0.2, 250, 0.8, 0.5); thud(85, 30, 0.5, 0.9); }
    },
  };
})();
document.addEventListener('pointerdown', () => AudioFX.unlock());
document.addEventListener('keydown', () => AudioFX.unlock());

/* ---------- engine ---------- */
let clock0 = null;
let vt = null;
let fired = [];
let moves = [];
let pending = [];
let done = false;

const whoOf = { m: muay, w: tkd };

function tweenX(who, delta, dur, hopH = 0) {
  const f = whoOf[who];
  moves.push({ who, from: f.baseX, to: f.baseX + delta, t0: boutT(), t1: boutT() + dur, h: hopH });
}

function boutT() { return vt !== null ? vt : (performance.now() - clock0) / 1000; }

function resetNudges() { muay.nudgeX = 0; tkd.nudgeX = 0; }

function startBout() {
  vt = null;
  const out = homeOut();
  muay.baseX = out.m; tkd.baseX = out.w;
  muay.group.position.set(out.m, 0, 0);
  tkd.group.position.set(out.w, 0, 0);
  muay.stopAll(); tkd.stopAll();
  muay.play('guard', { fade: 0 }); tkd.play('guard', { fade: 0 });
  clock0 = performance.now();
  fired = [];
  moves = [];
  pending = [];
  done = false;
  resetNudges();
  for (const c of contacts) c.fired = false;
  clearFx();
  shakeT = 0;
  koEl.classList.remove('on');
  resetHp();
}

function nudgeRamp(c, t) {
  if (t < c.t - 0.25) return 0;
  if (t < c.t) return (t - (c.t - 0.25)) / 0.25;
  if (t <= c.clipEnd) return 1;
  if (t < c.clipEnd + 0.4) return 1 - (t - c.clipEnd) / 0.4;
  return 0;
}

const _bpA = new THREE.Vector3();
const _bpD = new THREE.Vector3();
function fireContact(c, t) {
  c.fired = true;
  const atkF = whoOf[c.atk], defF = whoOf[c.def];
  const bA = atkF.bones[c.atkBone], bD = defF.bones[c.defBone];
  if (bA && bD) {
    bA.getWorldPosition(_bpA);
    bD.getWorldPosition(_bpD);
    const mid = _bpA.clone().add(_bpD).multiplyScalar(0.5);
    spawnImpact(mid, c.fx, vt !== null);
  }
  AudioFX.hit(c.snd);
  shake(c.fx);
  if (c.hp !== undefined) setHp(c.def, c.hp, t);
  if (c.ko) {
    koEl.classList.add('on');
    pending.push({
      t: t + KO_FALL_DELAY,
      fn: () => tkd.play('knock-out', { clamp: true, fade: 0.1 }),
    });
  }
}

function updateBout(dt = 0) {
  if (clock0 === null || done) return;
  const t = boutT();

  for (let i = 0; i < TL.length; i++) {
    if (fired[i] || t < TL[i].t) continue;
    fired[i] = true;
    const b = TL[i];
    if (b.ko) { koEl.classList.add('on'); continue; }
    if (b.koOff) { koEl.classList.remove('on'); continue; }
    const f = whoOf[b.who];
    if (b.clip) f.play(b.clip, {
      clamp: !!b.clamp, rev: b.rev || 0, rate: b.rate || 1, start: b.start || 0,
      fade: b.fade ?? (b.clamp ? 0.12 : 0.2),
    });
    if (b.moveTo) {
      const target = (b.moveTo === 'fight' ? HOME : homeOut())[b.who];
      tweenX(b.who, target - f.baseX, b.tweenDur || 0.6, b.hopH || 0);
    } else if (b.x !== undefined) {
      tweenX(b.who, b.x - f.baseX, b.tweenDur || 0.4, b.hopH || 0);
    } else if (b.move) {
      tweenX(b.who, b.move, b.tweenDur || (b.clip ? (CLIP_DUR[b.who][b.clip] / TS / (b.rate || 1)) : 0.6));
    }
  }

  for (let i = pending.length - 1; i >= 0; i--) {
    if (t >= pending[i].t) { const fn = pending[i].fn; pending.splice(i, 1); fn(); }
  }

  muay.hopY = 0; tkd.hopY = 0;
  for (let i = moves.length - 1; i >= 0; i--) {
    const mv = moves[i];
    const f = whoOf[mv.who];
    const p = Math.min(1, Math.max(0, (t - mv.t0) / Math.max(0.001, mv.t1 - mv.t0)));
    f.baseX = mv.from + (mv.to - mv.from) * (p * p * (3 - 2 * p));
    if (mv.h) f.hopY = mv.h * Math.sin(Math.PI * p);
    if (p >= 1) moves.splice(i, 1);
  }
  resetNudges();
  for (const c of contacts) {
    const r = nudgeRamp(c, t);
    if (r) whoOf[c.atk].nudgeX += c.dx * r * (c.atk === 'w' ? -1 : 1);
  }
  muay.group.position.x = muay.baseX + muay.nudgeX;
  tkd.group.position.x = tkd.baseX + tkd.nudgeX;
  muay.group.position.y = muay.hopY;
  tkd.group.position.y = tkd.hopY;

  const midX = (muay.group.position.x + tkd.group.position.x) / 2;
  const wantX = Math.min(0.1, Math.max(-0.55, midX));
  followX += (wantX - followX) * (vt !== null ? 1 : Math.min(1, dt * 4));
  controls.target.x = followX;
  camera.position.x = followX;

  for (const c of contacts) {
    if (!c.fired && t >= c.t) fireContact(c, t);
  }

  if (t >= END_T) {
    done = true;
    stageEl.classList.add('tmt-docked');
    replayBtn.hidden = false;
  }
}

/* ---------- camera framing ---------- */
let followX = 0;
function frameCamera() {
  const w = canvas.clientWidth || 1;
  const h = canvas.clientHeight || 1;
  camera.aspect = w / Math.max(1, h);
  const portrait = camera.aspect < 0.9;
  camera.fov = portrait ? 55 : 40;
  const tanH = Math.tan(camera.fov * Math.PI / 360);
  const need = portrait ? 2.4 : 2.8;
  const z = Math.min(portrait ? 7.8 : 7.0,
                     Math.max(portrait ? 5.2 : 3.5, need / (tanH * camera.aspect)));
  const hw = z * tanH * camera.aspect;
  edgeX = Math.min(hw - 0.45, 2.0);
  const cy = portrait ? 1.12 : 1.02;
  camera.position.set(followX, cy, z);
  controls.target.set(followX, cy, 0);
  camera.updateProjectionMatrix();
}
new ResizeObserver(() => {
  const w = canvas.clientWidth || canvas.parentElement.clientWidth;
  const h = canvas.clientHeight || canvas.parentElement.clientHeight;
  renderer.setSize(w, h, false);
  frameCamera();
}).observe(canvas.parentElement);

/* ---------- labels + health bars ---------- */
const v = new THREE.Vector3();
function placeHp(el, fighter) {
  if (!fighter.head || !fighter.ready) { el.style.display = 'none'; return; }
  const docked = stageEl.classList.contains('tmt-docked');
  fighter.head.getWorldPosition(v);
  v.y += docked ? 0.32 : 0.45;
  v.project(camera);
  const stage = canvas.parentElement.getBoundingClientRect();
  const x = (v.x * 0.5 + 0.5) * stage.width;
  const y = (-v.y * 0.5 + 0.5) * stage.height;
  el.style.display = v.z < 1 ? 'flex' : 'none';
  /* keep the whole kit inside the stage: name capsule must not clip at the top */
  const halfW = el.offsetWidth / 2, hgt = el.offsetHeight;
  el.style.left = Math.min(Math.max(x, halfW + 2), stage.width - halfW - 2) + 'px';
  el.style.top = Math.min(Math.max(y, hgt + 2), stage.height - 2) + 'px';
}

/* ---------- loop ---------- */
let stageVisible = true;
if ('IntersectionObserver' in window) {
  new IntersectionObserver(([en]) => { stageVisible = en.isIntersecting; },
    { rootMargin: '100px' }).observe(canvas.parentElement);
}
const clock = new THREE.Clock();
function tick() {
  try {
    const dt = Math.min(0.05, clock.getDelta());
    if (!stageVisible) { requestAnimationFrame(tick); return; }
    updateBout(dt);
    muay.mixer && muay.mixer.update(dt);
    tkd.mixer && tkd.mixer.update(dt);
    updateFx(vt !== null ? 0 : dt);
    if (shakeT > 0) shakeT -= dt;
    controls.update();
    const off = shakeOffset();
    if (off) camera.position.add(off);
    renderer.render(scene, camera);
    if (off) camera.position.sub(off);
    placeHp(hpMuay, muay);
    placeHp(hpTkd, tkd);
    requestAnimationFrame(tick);
  } catch (e) {
    window.__tickErr = String(e && e.stack || e);
    console.error('[tmt] tick crashed:', e);
  }
}

/* ---------- boot ---------- */
(async () => {
  try {
    loadingText.textContent = 'Loading the muay thai fighter…';
    await muay.load('./models/muay-man.glb?v=1', 'muay');
    loadingText.textContent = 'Loading the taekwondo fighter…';
    await tkd.load('./models/tkd-man.glb?v=1', 'tkd');
    for (const f of [muay, tkd]) {
      for (const a of Object.values(f.actions)) a.setEffectiveTimeScale(TS);
    }
    loadingEl.hidden = true;
    startBout();
    tick();
  } catch (e) {
    console.error(e);
    loadingEl.hidden = true;
    errorEl.textContent = 'Could not load the fighters. Please refresh and try again.';
    errorEl.hidden = false;
  }
})();

replayBtn.addEventListener('click', () => {
  AudioFX.unlock();
  replayBtn.hidden = true;
  stageEl.classList.remove('tmt-docked');
  void canvas.clientWidth;
  frameCamera();
  startBout();
});

/* debug hooks for QA automation */
function resetShow() {
  vt = 0;
  clock0 = performance.now();
  fired = []; moves = []; pending = []; done = false;
  resetNudges(); clearFx(); shakeT = 0;
  for (const c of contacts) c.fired = false;
  koEl.classList.remove('on');
  resetHp();
  const out = homeOut();
  muay.baseX = out.m; tkd.baseX = out.w;
  muay.group.position.set(out.m, 0, 0);
  tkd.group.position.set(out.w, 0, 0);
  muay.stopAll(); tkd.stopAll();
  muay.play('guard', { fade: 0 }); tkd.play('guard', { fade: 0 });
}
function stepTo(t) {
  resetShow();
  const dt = 1 / 60;
  for (let tt = 0; tt <= t; tt += dt) {
    vt = tt;
    updateBout(dt);
    muay.mixer.update(dt);
    tkd.mixer.update(dt);
  }
  vt = t;
  for (let i = fxLive.length - 1; i >= 0; i--) {
    if (t - fxLive[i].born > fxLive[i].ttl) {
      scene.remove(fxLive[i].s);
      fxLive[i].s.material.dispose();
      fxLive.splice(i, 1);
    }
  }
  renderer.render(scene, camera);
  placeHp(hpMuay, muay);
  placeHp(hpTkd, tkd);
}
/* QA: play one attack clip at fight positions and report the contact frame —
 * the raw-clip time where the strike bone is closest to the target bone. */
async function probeContact(who, clip, atkBone, defBone, xAtk) {
  const f = whoOf[who];
  f.baseX = xAtk !== undefined ? xAtk : HOME[who];
  f.group.position.x = f.baseX;
  const other = who === 'm' ? tkd : muay;
  other.baseX = HOME[other === muay ? 'm' : 'w'];
  other.group.position.x = other.baseX;
  f.stopAll(); other.stopAll();
  f.play(clip, { fade: 0 });
  const dt = 1 / 120;
  let best = { d: 1e9, tt: 0 };
  const A = new THREE.Vector3(), D = new THREE.Vector3();
  for (let tt = 0; tt < CLIP_DUR[who][clip] + 0.5; tt += dt) {
    f.mixer.update(dt);
    f.group.updateMatrixWorld(true);
    other.group.updateMatrixWorld(true);
    if (!f.bones[atkBone] || !other.bones[defBone]) return { err: 'bone missing' };
    f.bones[atkBone].getWorldPosition(A);
    other.bones[defBone].getWorldPosition(D);
    const d = A.distanceTo(D);
    if (d < best.d) best = { d: +d.toFixed(3), tt: +tt.toFixed(2), frac: +((tt * TS) / CLIP_DUR[who][clip]).toFixed(3) };
  }
  f.stopAll(); other.play('guard', { fade: 0 });
  return best;
}
window.__tmt = { muay, tkd, camera, scene, THREE, contacts, hpState, setHp, stepTo, probeContact, get clock0() { return clock0; } };
