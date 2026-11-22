/*
 * Benefits of boxing & kickboxing — hero animation.
 *
 * A kickboxer stands right in guard. Word plates drift in from the left
 * ("DISEASE", "WEAK", "HOPELESS" on hanging speed balls, "FAIL" on a standing
 * dummy) and she destroys each with a real strike — jab, cross, kick,
 * punch-knee combo — then a sparring partner floats in and she finishes him
 * with a flying kick. Strike labels pop at the glove on every contact.
 * The scene has no background: the canvas is transparent and the page shows
 * through.
 *
 * The strike targets are placed exactly: at boot each attack clip is scrubbed
 * to its baked contact frame (peak bone extension, probed from the pack) and
 * the strike bone's world position becomes the plate's resting anchor, so the
 * glove always lands dead-center on the word.
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const canvas = document.getElementById('bb-canvas');
const stageEl = document.getElementById('bb-stage');
const loadingEl = document.getElementById('bb-loading');
const loadingText = document.getElementById('bb-loading-text');
const errorEl = document.getElementById('bb-error');
const replayBtn = document.getElementById('bb-replay');

/* ---------- renderer / scene ---------- */
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.42;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 60);
camera.position.set(0, 1.05, 4.0);

const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.enablePan = false;
controls.minDistance = 2.0;
controls.maxDistance = 12;
controls.target.set(0, 0.95, 0);

scene.add(new THREE.HemisphereLight(0xdcebff, 0x4a4640, 2.9));
const keyLight = new THREE.DirectionalLight(0xffe8d2, 4.2);
keyLight.position.set(2.2, 3.2, 2.6);
keyLight.castShadow = true;
keyLight.shadow.mapSize.set(1024, 1024);
keyLight.shadow.camera.left = -5; keyLight.shadow.camera.right = 5;
keyLight.shadow.camera.top = 5; keyLight.shadow.camera.bottom = -5;
scene.add(keyLight);
const rimLight = new THREE.DirectionalLight(0x9cc6ff, 2.5);
rimLight.position.set(-2.4, 2.0, -2.6);
scene.add(rimLight);
const fillLight = new THREE.DirectionalLight(0xffffff, 1.8);
fillLight.position.set(0, 1.4, 4);
scene.add(fillLight);

/* invisible floor that only catches the soft shadows — no visible background */
const floor = new THREE.Mesh(
  new THREE.CircleGeometry(9, 64),
  new THREE.ShadowMaterial({ opacity: 0.20 })
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
const BONES = ['Head', 'LeftHand', 'RightHand', 'LeftToeBase', 'RightToeBase', 'RightLeg'];

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

class Fighter {
  constructor(dir) {           // dir: +1 faces right (+x), -1 faces left (-x)
    this.group = new THREE.Group();
    this.group.rotation.y = (dir > 0 ? 1 : -1) * Math.PI / 2;
    this.mixer = null;
    this.actions = {};
    this.bones = {};
    this.ready = false;
    this.baseX = 0;
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
    this.model = root;
    root.updateMatrixWorld(true);

    for (const n of BONES) this.bones[n] = findBone(root, n);
    this.mixer = new THREE.AnimationMixer(root);
    for (const clip of gltf.animations) {
      if (/Layer0$/.test(clip.name)) continue;   // static bind-pose take
      const act = this.mixer.clipAction(clip);
      act.enabled = true;
      this.actions[clip.name] = act;
    }

    /* bind pose is Z-up and lying flat (Mixamo FBX heritage) — rotate, then
     * measure the real skinned height off a guard frame and normalise to 1.75 m */
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
    console.log(`[bb] ${name}: bindH=${h0.toFixed(2)}m scale=${s.toFixed(2)}`);
    this.mixer.stopAllAction();
    this.ready = true;
  }
  play(name, { fade = 0.2, clamp = false, rate = 1, start = 0 } = {}) {
    const next = this.actions[name];
    if (!next) return;
    const dominant = next.getEffectiveWeight() > 0.4;
    const looping = name === 'guard';
    next.reset();
    next.clampWhenFinished = !looping && clamp;
    next.setLoop(looping ? THREE.LoopRepeat : THREE.LoopOnce, looping ? Infinity : 1);
    next.time = Math.min(Math.max(0, start), Math.max(0, next.getClip().duration - 0.02));
    next.setEffectiveTimeScale(TS * rate);
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

/* ---------- cast ---------- */
const woman = new Fighter(-1);   // faces left, at the right side of the stage
const man = new Fighter(+1);     // her final sparring partner

const WOMAN_X = 0.62;
const MAN_X = -0.05;
const MAN_WAIT_X = -3.4;

woman.group.position.set(WOMAN_X, 0, 0);
man.group.position.set(MAN_WAIT_X, 0, 0);
scene.add(woman.group, man.group);

/* ---------- choreography ----------
 * Each strike: `at` = contact time (s), clip fires early enough that the baked
 * contact frame lands exactly at `at`. Targets drift in so they reach the
 * anchor (the strike bone's probed world position) at the same instant. */
const CLIP_DUR = {
  'jab': 1.067, 'cross': 0.90, 'kick': 1.633, 'combo-knee': 5.70, 'flying-kick': 1.533,
  guard: 5.033, 'knocked-out': 4.93,
};
const STRIKES = [
  { key: 'disease',  word: 'DISEASE',  kind: 'ball', clip: 'jab',   bone: 'LeftHand',    frac: 0.563, label: 'JAB',   at: 2.0 },
  { key: 'weak',     word: 'WEAK',     kind: 'ball', clip: 'cross', bone: 'RightHand',   frac: 0.411, label: 'CROSS', at: 3.7 },
  { key: 'hopeless', word: 'HOPELESS', kind: 'ball', clip: 'kick',  bone: 'LeftToeBase', frac: 0.410, label: 'KICK',  at: 5.5 },
  { key: 'fail',     word: 'FAIL',     kind: 'post', clip: 'combo-knee', bone: 'RightLeg', frac: 1.60 / 5.70, label: 'KNEE', at: 7.5 },
  { key: 'partner',  clip: 'flying-kick', bone: 'LeftToeBase', frac: 0.470, label: 'FLYING KICK', at: 10.9 },
];
const TS = 1.0;
const MAN_IN_T = 8.6;      // partner floats in
const MAN_IN_DUR = 0.9;
const KO_PUSH = -0.30;     // he is driven back as he drops
const END_T = 13.4;

/* timeline entries derived from STRIKES */
const TL = [
  { t: 0, who: 'w', clip: 'guard' },
  ...STRIKES.filter(s => s.key !== 'partner').map(s => ({
    t: s.at - s.frac * CLIP_DUR[s.clip],
    who: 'w', clip: s.clip, clamp: true, fade: 0.14, strike: s.key,
  })),
  /* after the knee combo's retraction, back to guard */
  { t: 8.05, who: 'w', clip: 'guard', fade: 0.2 },
  { t: 0, who: 'm', clip: 'guard' },
  { t: MAN_IN_T - 0.05, who: 'm', show: true },   // he waits offstage until his entrance
  { t: MAN_IN_T, who: 'm', moveX: MAN_X, dur: MAN_IN_DUR },
  /* flying kick — start time derived from its contact frame */
  {
    t: STRIKES[4].at - STRIKES[4].frac * CLIP_DUR['flying-kick'],
    who: 'w', clip: 'flying-kick', clamp: true, fade: 0.14, strike: 'partner', fly: true,
  },
  { t: 11.75, who: 'w', clip: 'guard', fade: 0.2 },
];
/* ---------- engine ---------- */
let clock0 = null;
let vt = null;             // virtual time for deterministic QA
let fired = [];
let moves = [];            // position tweens { who, from, to, t0, t1 }
let labels = [];           // active strike labels { el, pos: Vector3, born }
let done = false;

function boutT() { return vt !== null ? vt : (performance.now() - clock0) / 1000; }
function whoOf(w) { return w === 'm' ? man : woman; }

function tweenX(who, to, dur, t0) {
  const f = whoOf(who);
  moves.push({ who, from: f.baseX, to, t0, t1: t0 + dur });
}

/* ---------- word plates ---------- */
const PLATE_LIFT = { ball: 0.10, post: 0.34 };   // plate sits above the bone anchor
const DRIFT = 2.4;        // world units of approach
const DRIFT_DUR = 2.0;    // seconds of approach

const targets = STRIKES.filter(s => s.word).map(s => {
  const el = document.createElement('div');
  el.className = `bt-target ${s.kind}`;
  el.textContent = s.word;
  el.setAttribute('aria-hidden', 'true');
  el.style.opacity = '0';
  stageEl.appendChild(el);
  return { el, strike: s, anchor: null, shattered: false };
});
const targetOf = (key) => targets.find(t => t.strike.key === key);

function placePlate(tg, t) {
  const s = tg.strike;
  if (!s.anchor) return;
  if (tg.shattered) return;
  const spawnT = s.at - DRIFT_DUR;
  if (t < spawnT) { tg.el.style.opacity = '0'; return; }
  const p = Math.min(1, (t - spawnT) / DRIFT_DUR);
  const e = p * p * (3 - 2 * p);                       // smoothstep
  const bob = (1 - p) * 0.05 * Math.sin(t * 4.2 + s.at * 2.1);
  _tv.set(
    s.anchor.x - DRIFT * (1 - e),
    s.anchor.y + PLATE_LIFT[s.kind] + bob,
    s.anchor.z
  );
  projectTo(_tv, tg.el);
  tg.el.style.opacity = String(Math.min(1, p * 4));
}

function projectTo(v, el) {
  const q = v.clone().project(camera);
  const r = stageEl.getBoundingClientRect();
  el.style.transform = `translate(-50%,-50%)`;
  el.style.left = ((q.x * 0.5 + 0.5) * r.width) + 'px';
  el.style.top = ((-q.y * 0.5 + 0.5) * r.height) + 'px';
  el.style.display = q.z < 1 ? 'block' : 'none';
}

/* ---------- strike labels ---------- */
function showLabel(text, pos) {
  const el = document.createElement('div');
  el.className = 'bt-callout show';
  el.textContent = text;
  el.setAttribute('aria-hidden', 'true');
  stageEl.appendChild(el);
  labels.push({ el, pos: pos.clone(), born: boutT() });
}
function updateLabels(t) {
  for (let i = labels.length - 1; i >= 0; i--) {
    const l = labels[i];
    if (t - l.born > 1.0) { l.el.remove(); labels.splice(i, 1); continue; }
    _tv.copy(l.pos); _tv.y += 0.22;
    projectTo(_tv, l.el);
  }
}

/* ---------- impact FX ---------- */
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
const fxLive = [];
function spawnImpact(pos, kind) {
  const flashScale = kind === 'ko' ? 0.95 : 0.55;
  const sparks = kind === 'ko' ? 12 : 8;
  const born = boutT();
  const flash = new THREE.Sprite(new THREE.SpriteMaterial({ map: texFlash, transparent: true, depthTest: false, opacity: 1 }));
  flash.position.copy(pos);
  flash.scale.setScalar(flashScale);
  flash.renderOrder = 20;
  scene.add(flash);
  fxLive.push({ s: flash, life: 0, ttl: 0.32, flash: true, base: flashScale, born });
  for (let i = 0; i < sparks; i++) {
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: texSpark, transparent: true, depthTest: false, opacity: 1 }));
    sp.position.copy(pos);
    sp.scale.setScalar(0.09 + Math.random() * 0.07);
    sp.renderOrder = 21;
    const vel = new THREE.Vector3((Math.random() - 0.5) * 2.4, Math.random() * 1.6 + 0.4, (Math.random() - 0.5) * 2.4);
    scene.add(sp);
    fxLive.push({ s: sp, vel, life: 0, ttl: 0.45, flash: false, born });
  }
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

/* camera shake */
let shakeT = 0, shakeDur = 0, shakeAmp = 0;
function shake(kind) {
  shakeT = kind === 'ko' ? 0.5 : 0.32;
  shakeDur = shakeT;
  shakeAmp = kind === 'ko' ? 0.08 : 0.04;
}
const _shakeOff = new THREE.Vector3();
function shakeOffset() {
  if (shakeT <= 0) return null;
  const p = shakeT / shakeDur;
  const a = shakeAmp * p * p;
  return _shakeOff.set((Math.random() - 0.5) * 2 * a, (Math.random() - 0.5) * 2 * a, 0);
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
      else                       { noise(0.05, 1200, 1.0, 0.4); noise(0.2, 250, 0.8, 0.5); thud(85, 30, 0.5, 0.9); }
    },
  };
})();
document.addEventListener('pointerdown', () => AudioFX.unlock());

/* ---------- anchors: probe each strike's contact-frame bone position ----------
 * With the woman standing at her final position, scrub each attack clip to the
 * contact frame and read the strike bone's world position — that is where the
 * word plate must arrive. */
async function probeAnchors() {
  woman.mixer.stopAllAction();
  for (const s of STRIKES) {
    const clip = woman.actions[s.clip].getClip();
    const act = woman.mixer.clipAction(clip);
    act.reset().setEffectiveWeight(1).play();
    woman.mixer.setTime(Math.min(clip.duration - 0.01, s.frac * clip.duration));
    woman.model.updateMatrixWorld(true);
    const b = woman.bones[s.bone];
    s.anchor = b ? b.getWorldPosition(new THREE.Vector3()).clone() : null;
    s.bonePos = s.anchor ? s.anchor.clone() : null;
    woman.mixer.stopAllAction();
  }
  woman.play('guard', { fade: 0 });
  console.log('[bb] anchors', STRIKES.map(s => `${s.key}=${s.anchor ? s.anchor.toArray().map(v => +v.toFixed(2)).join(',') : 'null'}`).join('  '));
}

/* ---------- contacts ---------- */
const contacts = STRIKES.map(s => ({ s, t: s.at, fired: false }));

function fireContact(c) {
  c.fired = true;
  const s = c.s;
  const w = whoOf('w');
  const b = w.bones[s.bone];
  const pos = b ? b.getWorldPosition(new THREE.Vector3()) : (s.anchor || new THREE.Vector3());
  const kind = s.key === 'partner' ? 'ko' : (s.clip === 'kick' || s.clip === 'combo-knee' || s.clip === 'flying-kick' ? 'kick' : 'punch');
  spawnImpact(pos, kind);
  AudioFX.hit(kind);
  shake(kind);
  showLabel(s.label, pos);
  if (s.word) {
    const tg = targetOf(s.key);
    tg.shattered = true;
    tg.el.classList.add('shatter');
  }
  if (s.key === 'partner') {
    /* he is out — the KO clip enters mid-buckle so he drops right away */
    man.play('knocked-out', { start: 1.7, clamp: true, fade: 0.08 });
    tweenX('m', man.baseX + KO_PUSH, 0.6, boutT());
  }
}

/* ---------- show control ---------- */
function updateShow(dt = 0) {
  if (clock0 === null || done) return;
  const t = boutT();

  for (let i = 0; i < TL.length; i++) {
    if (fired[i] || t < TL[i].t) continue;
    fired[i] = true;
    const b = TL[i];
    const f = whoOf(b.who);
    if (b.show) f.group.visible = true;
    if (b.clip) f.play(b.clip, { clamp: !!b.clamp, fade: b.fade ?? 0.14, rate: b.rate || 1, start: b.start || 0 });
    if (b.moveX !== undefined) tweenX(b.who, b.moveX, b.dur || 0.6, t);
    if (b.fly) {
      /* land the toe exactly on the partner's head: travel = head x - anchor x */
      const s = STRIKES[4];
      const headX = man.baseX + 0.06;
      const travel = s.anchor ? (headX - s.anchor.x) : -0.62;
      tweenX('w', WOMAN_X + travel, 0.55, t + 0.12);
    }
  }

  /* position tweens */
  man.hopY = 0; woman.hopY = 0;
  for (let i = moves.length - 1; i >= 0; i--) {
    const mv = moves[i];
    const f = whoOf(mv.who);
    const p = Math.min(1, Math.max(0, (t - mv.t0) / Math.max(0.001, mv.t1 - mv.t0)));
    f.baseX = mv.from + (mv.to - mv.from) * (p * p * (3 - 2 * p));
    if (p >= 1) moves.splice(i, 1);
  }
  man.group.position.x = man.baseX;
  woman.group.position.x = woman.baseX;

  /* camera follow: ease toward the midpoint of the visible action */
  const active = contacts.find(c => !c.fired);
  const focusX = active && active.s.word && active.s.anchor
    ? Math.min(0.45, Math.max(-0.55, (woman.baseX + active.s.anchor.x) / 2))
    : Math.min(0.45, Math.max(-0.55, (woman.baseX + (man.baseX > MAN_WAIT_X ? man.baseX : woman.baseX)) / 2));
  followX += (focusX - followX) * (vt !== null ? 1 : Math.min(1, dt * 3));
  controls.target.x = followX;
  camera.position.x = followX;

  for (const c of contacts) {
    if (!c.fired && t >= c.t) fireContact(c);
  }

  if (t >= END_T) done = true;
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
  const need = portrait ? 1.9 : 2.1;
  const z = Math.min(portrait ? 8.0 : 5.0,
                     Math.max(portrait ? 4.4 : 3.4, need / (tanH * camera.aspect)));
  const cy = 1.02;
  camera.position.set(followX, cy, z);
  controls.target.set(followX, cy, 0);
  camera.updateProjectionMatrix();
}
new ResizeObserver(() => {
  const w = canvas.clientWidth || canvas.parentElement.clientWidth;
  const h = canvas.clientHeight || canvas.parentElement.clientHeight;
  renderer.setSize(w, h, false);
  frameCamera();
}).observe(stageEl);

/* ---------- loop ---------- */
const clock = new THREE.Clock();
function tick() {
  try {
    const dt = Math.min(0.05, clock.getDelta());
    const t = boutT();
    updateShow(dt);
    woman.mixer && woman.mixer.update(dt);
    man.mixer && man.mixer.update(dt);
    updateFx(vt !== null ? 0 : dt);
    if (shakeT > 0) shakeT -= dt;
    controls.update();
    const off = shakeOffset();
    if (off) camera.position.add(off);
    renderer.render(scene, camera);
    if (off) camera.position.sub(off);
    for (const tg of targets) placePlate(tg, t);
    updateLabels(t);
    requestAnimationFrame(tick);
  } catch (e) {
    window.__tickErr = String(e && e.stack || e);
    console.error('[bb] tick crashed:', e);
  }
}

/* ---------- boot ---------- */
function resetShow() {
  vt = 0;
  clock0 = performance.now();
  fired = []; moves = []; done = false;
  for (const c of contacts) c.fired = false;
  for (const tg of targets) {
    tg.shattered = false;
    tg.el.classList.remove('shatter');
    tg.el.style.opacity = '0';
  }
  for (const l of labels) l.el.remove();
  labels = [];
  clearFx();
  shakeT = 0;
  woman.baseX = WOMAN_X; man.baseX = MAN_WAIT_X;
  woman.group.position.set(WOMAN_X, 0, 0);
  man.group.position.set(MAN_WAIT_X, 0, 0);
  man.group.visible = false;
  woman.stopAll(); man.stopAll();
  woman.play('guard', { fade: 0 });
  man.play('guard', { fade: 0 });
}

(async () => {
  try {
    loadingText.textContent = 'Loading the kickboxer…';
    await woman.load('./models/woman.glb', 'woman');
    loadingText.textContent = 'Loading the partner…';
    await man.load('./models/man.glb', 'man');
    loadingEl.hidden = true;
    resetShow();
    await probeAnchors();
    clock0 = performance.now();   // restart the clock after probing
    vt = null;
    tick();
  } catch (e) {
    console.error(e);
    loadingEl.hidden = true;
    errorEl.hidden = false;
  }
})();

replayBtn.addEventListener('click', async () => {
  AudioFX.unlock();
  resetShow();
  await probeAnchors();
  clock0 = performance.now();
  vt = null;
});

/* ---------- QA hooks (deterministic virtual-time stepping) ---------- */
function stepTo(t) {
  resetShow();
  const dt = 1 / 60;
  for (let tt = 0; tt <= t; tt += dt) {
    vt = tt;
    updateShow(dt);
    woman.mixer.update(dt);
    man.mixer.update(dt);
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
  for (const tg of targets) placePlate(tg, t);
  updateLabels(t);
}
function weightScan() {
  resetShow();
  const dt = 1 / 120;
  const sum = (f) => Object.values(f.actions).reduce((s, a) => s + a.getEffectiveWeight(), 0);
  let minW = 9, minM = 9, atW = 0, atM = 0;
  for (let t = 0; t <= END_T + 1; t += dt) {
    vt = t;
    updateShow(dt);
    woman.mixer.update(dt);
    man.mixer.update(dt);
    const sw = sum(woman), sm = sum(man);
    if (sw < minW) { minW = sw; atW = t; }
    if (sm < minM) { minM = sm; atM = t; }
  }
  return { woman: { minW: +minW.toFixed(3), at: +atW.toFixed(2) }, man: { minW: +minM.toFixed(3), at: +atM.toFixed(2) } };
}
window.__bb = { woman, man, camera, contacts, targets, stepTo, weightScan, get anchors() { return STRIKES.map(s => ({ key: s.key, anchor: s.anchor && s.anchor.toArray().map(v => +v.toFixed(2)) })); } };
