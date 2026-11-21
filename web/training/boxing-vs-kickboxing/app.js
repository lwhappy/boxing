/*
 * Boxing vs Kickboxing — a scripted two-fighter bout with bone-anchored contact.
 *
 * Man (BOXING) stands left, woman (KICKBOXING) right, both in guard. The
 * kickboxer opens at long range (roundhouse kick -> flying kick), the boxer
 * blocks on his gloves, then closes the distance and finishes with a
 * jab-cross-uppercut knockout. Strikes are landed for real: each attack has a
 * baked contact frame keyed to the attacker's strike bone (toes / gloves) and
 * the defender's target bone (gloves / head); when that frame fires we spawn
 * an impact flash + sparks exactly between the two bones, shake the camera
 * and play a synthesized hit sound. Clips play at 1.35x and the schedule is
 * compressed so the bout reads fast.
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const canvas = document.getElementById('bvk-canvas');
const stageEl = canvas.parentElement;
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
controls.target.set(-0.2, 1.0, 0);
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

/* transparent arena floor — invisible except for the soft shadows the
 * fighters cast on the page behind (the page background shows through) */
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
const BONE_NAMES = ['LeftHand', 'RightHand', 'LeftFoot', 'RightFoot', 'LeftToeBase', 'RightToeBase', 'Head'];

class Fighter {
  constructor(dir) {           // dir: +1 faces right, -1 faces left
    this.group = new THREE.Group();
    this.group.rotation.y = (dir > 0 ? 1 : -1) * Math.PI / 2;
    this.mixer = null;
    this.actions = {};
    this.bones = {};
    this.head = null;
    this.ready = false;
    this.baseX = 0;           // choreography x (tweens drive this)
    this.nudgeX = 0;          // transient contact correction, added on top
    this.hopY = 0;            // hop arc height while a hop move is active
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
    for (const n of BONE_NAMES) this.bones[n] = findBone(root, n);
    this.head = this.bones['Head'];
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
      if (a === next) continue;
      if (a.isRunning()) a.fadeOut(Math.max(fade, 0.001));
      else a.stop();   // finished clamped actions never fade out (their weight
                       // interpolation is frozen) — cut them so the new clip
                       // actually takes over (e.g. standing up after knock-out)
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

/* fight positions (x along the fight line). The kickboxer stands close enough
 * that her kicks and his punches actually reach — offsets tuned from bone
 * trajectory probes (build/cdp_bvk_contact.mjs). */
const HOME = { m: -0.85, w: 0.45 };
/* screen-edge waiting positions: fighters wait here in guard, hop into the
 * center to fight, hop back after the KO. edgeX adapts to the viewport
 * (recomputed by frameCamera so nobody waits off-screen). */
let edgeX = 1.3;
const homeOut = () => ({ m: -edgeX, w: edgeX * 0.92 });
man.group.position.set(homeOut().m, 0, 0);
woman.group.position.set(homeOut().w, 0, 0);
scene.add(man.group, woman.group);

/* ---------- timeline ----------
 * { t, who, clip, moveTo?, tweenDur?, hop?, clamp?, fade?, hit? } — t in
 * real seconds. Clips play at TS x speed, so real clip duration = CLIP_DUR/TS.
 * `hit` names a contact in HITS below; contact time = t + frac*clipDur.
 */

/* Show flow: both fighters wait at the stage edge in guard, hop into the
 * center to fight, KO'd kickboxer stays down for 1s after the fall, then both
 * hop back to the edge and idle in guard. Replay hops them in again.
 * moveTo: 'fight' | 'out' — hop/tween toward those home positions. */
const TS = 1.35;
const INTRO_T = 1.2;          // fight entries start after the hop-in lands
const KO_HOLD = 1.0;          // extra hold after the fall ends, then hop back
const HOP_IN = { dur: 0.8, h: 0.5 };
const HOP_OUT = { dur: 0.8, h: 0.45 };

const CLIP_DUR = {
  m:   { guard: 5.0, block: 1.6, 'step-backward': 0.83, 'step-forward': 1.0, 'jab-cross': 2.17, uppercut: 1.33 },
  w: { guard: 5.0, 'roundhouse-kick': 2.5, 'flying-kick': 1.5, 'hit-uppercut': 1.67, 'knock-out': 4.93 },
};

/* Baked contacts, measured from bone probes (world-space min distance between
 * the strike bone and the target bone during each clip, at the current HOME
 * positions). dx = small residual x-correction applied to the attacker just
 * before the contact frame (ramped in, held to clip end, eased back out). */
const HITS = {
  roundhouse: { frac: 0.443, atkBone: 'RightToeBase', defBone: 'LeftHand', dx: 0.065, fx: 'block', snd: 'kick' },
  flying:     { frac: 0.167, atkBone: 'LeftToeBase',  defBone: 'LeftHand', dx: -0.344, fx: 'block', snd: 'kick' },
  jab:        { frac: 0.27,  atkBone: 'LeftHand',     defBone: 'Head',     dx: 0.013,  fx: 'punch', snd: 'punch' },
  cross:      { frac: 0.353, atkBone: 'RightHand',    defBone: 'Head',     dx: 0.065,  fx: 'punch', snd: 'punch' },
  uppercut:   { frac: 0.39,  atkBone: 'LeftHand',     defBone: 'Head',     dx: 0,      fx: 'ko',    snd: 'ko', ko: true },
};

const TL = [
  { t: 0.0,  who: 'm', clip: 'guard' },
  { t: 0.0,  who: 'w', clip: 'guard' },

  /* --- both hop from the stage edge into the center --- */
  { t: 0.2,  who: 'm', moveTo: 'fight', hop: true, tweenDur: HOP_IN.dur, hopH: HOP_IN.h },
  { t: 0.2,  who: 'w', moveTo: 'fight', hop: true, tweenDur: HOP_IN.dur, hopH: HOP_IN.h },

  /* --- kickboxer opens at long range --- */
  { t: 2.3,  who: 'w', clip: 'roundhouse-kick', move: -0.32, hit: 'roundhouse' },
  { t: 2.45, who: 'm', clip: 'block' },                        // gloves meet the kick
  { t: 3.8,  who: 'm', clip: 'step-backward', move: -0.55 },   // shove the range back out

  { t: 5.1,  who: 'w', clip: 'flying-kick', move: -1.2, tweenDur: 0.7, hit: 'flying' }, // leaps in
  { t: 5.2,  who: 'm', clip: 'block' },                        // meets it on the gloves
  { t: 6.35, who: 'w', clip: 'guard' },
  { t: 6.65, who: 'w', move: 1.2, tweenDur: 0.6 },             // backs off to punch range

  /* --- boxer closes and finishes --- */
  { t: 6.8,  who: 'm', clip: 'step-forward', move: 0.98 },
  { t: 7.5,  who: 'm', clip: 'jab-cross', hit: ['jab', 'cross'] },
  { t: 9.5,  who: 'm', clip: 'uppercut', hit: 'uppercut' },    // reaction fired on contact
  { t: 10.7, who: 'm', clip: 'guard' },
  { t: 12.2, ko: true },                                       // big KO slam

  /* --- KO hold, then both hop back to the stage edge --- */
  { t: 15.4, koOff: true },
  { t: 15.4, who: 'w', clip: 'guard', fade: 0.45 },            // she gets up
  { t: 15.6, who: 'm', moveTo: 'out', hop: true, tweenDur: HOP_OUT.dur, hopH: HOP_OUT.h },
  { t: 16.0, who: 'w', moveTo: 'out', hop: true, tweenDur: HOP_OUT.dur, hopH: HOP_OUT.h },
];
const END_T = 17.0;
const KO_FALL_DELAY = 0.87;   // uppercut contact -> knock-out clip

/* derived contact list */
const contacts = [];
for (const e of TL) {
  if (!e.hit || !e.clip) continue;
  const cd = CLIP_DUR[e.who][e.clip] / TS;
  for (const hname of Array.isArray(e.hit) ? e.hit : [e.hit]) {
    const h = HITS[hname];
    contacts.push({
      t: e.t + h.frac * cd, clipEnd: e.t + cd,
      atk: e.who, def: e.who === 'm' ? 'w' : 'm',
      atkBone: h.atkBone, defBone: h.defBone, dx: h.dx || 0,
      fx: h.fx, snd: h.snd, ko: !!h.ko, fired: false,
    });
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
  block: { flash: 0.5,  sparks: 7,  shake: 0.035, shakeT: 0.32 },
  punch: { flash: 0.55, sparks: 8,  shake: 0.05,  shakeT: 0.35 },
  ko:    { flash: 0.95, sparks: 12, shake: 0.1,   shakeT: 0.55 },
};
const fxLive = [];   // { s: Sprite, vel, life, ttl, flash }
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
  if (qaFrozen) return;   // QA stepping: freeze at spawn frame
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

/* camera shake — applied as a render-time offset so OrbitControls stay clean */
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

/* ---------- hit sounds (synthesized, no assets) ---------- */
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
let clock0 = null;      // performance.now() of bout start (ms)
let vt = null;          // virtual time override — deterministic QA stepping
let fired = [];
let moves = [];         // active position tweens { who, from, to, t0, t1 }
let pending = [];       // { t, fn } — contact-triggered follow-ups
let done = false;

const whoOf = { m: man, w: woman };

function tweenX(who, delta, dur, hopH = 0) {
  const f = whoOf[who];
  moves.push({ who, from: f.baseX, to: f.baseX + delta, t0: boutT(), t1: boutT() + dur, h: hopH });
}

function boutT() { return vt !== null ? vt : (performance.now() - clock0) / 1000; }

function resetNudges() { man.nudgeX = 0; woman.nudgeX = 0; }

function startBout() {
  vt = null;                // clear QA virtual time so boutT() runs live again
  const out = homeOut();
  man.baseX = out.m; woman.baseX = out.w;
  man.group.position.set(out.m, 0, 0);
  woman.group.position.set(out.w, 0, 0);
  man.stopAll(); woman.stopAll();
  man.play('guard', { fade: 0 }); woman.play('guard', { fade: 0 });
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
  if (c.ko) {
    pending.push({ t: t, fn: () => woman.play('hit-uppercut', { fade: 0.05 }) });
    pending.push({ t: t + KO_FALL_DELAY, fn: () => woman.play('knock-out', { clamp: true, fade: 0.1 }) });
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
    if (b.clip) f.play(b.clip, { clamp: !!b.clamp, fade: b.fade ?? (b.clamp ? 0.12 : 0.2) });
    if (b.moveTo) {
      const target = (b.moveTo === 'fight' ? HOME : homeOut())[b.who];
      tweenX(b.who, target - f.baseX, b.tweenDur || 0.6, b.hopH || 0);
    } else if (b.move) {
      tweenX(b.who, b.move, b.tweenDur || (b.clip ? (CLIP_DUR[b.who][b.clip] / TS) : 0.6));
    }
  }

  for (let i = pending.length - 1; i >= 0; i--) {
    if (t >= pending[i].t) { const fn = pending[i].fn; pending.splice(i, 1); fn(); }
  }

  /* position: tweens drive baseX (hops add a y arc), contact nudges add on top */
  man.hopY = 0; woman.hopY = 0;
  for (let i = moves.length - 1; i >= 0; i--) {
    const mv = moves[i];
    const f = whoOf[mv.who];
    const p = Math.min(1, Math.max(0, (t - mv.t0) / Math.max(0.001, mv.t1 - mv.t0)));
    f.baseX = mv.from + (mv.to - mv.from) * (p * p * (3 - 2 * p));  // smoothstep
    if (mv.h) f.hopY = mv.h * Math.sin(Math.PI * p);
    if (p >= 1) moves.splice(i, 1);
  }
  resetNudges();
  for (const c of contacts) {
    const r = nudgeRamp(c, t);
    if (r) whoOf[c.atk].nudgeX += c.dx * r;
  }
  man.group.position.x = man.baseX + man.nudgeX;
  woman.group.position.x = woman.baseX + woman.nudgeX;
  man.group.position.y = man.hopY;
  woman.group.position.y = woman.hopY;

  /* camera follow: ease toward the midpoint between the fighters (clamped)
   * so the bout stays centered on screen; in QA stepping it snaps instantly */
  const midX = (man.group.position.x + woman.group.position.x) / 2;
  const wantX = Math.min(0.1, Math.max(-0.55, midX));
  followX += (wantX - followX) * (vt !== null ? 1 : Math.min(1, dt * 4));
  controls.target.x = followX;
  camera.position.x = followX;

  for (const c of contacts) {
    if (!c.fired && t >= c.t) fireContact(c, t);
  }

  if (t >= END_T) {
    done = true;
    /* dock the canvas back into the article flow so it stops covering the
     * text — fighters idle at the edges inside the docked stage */
    stageEl.classList.add('bvk-docked');
  }
}

/* ---------- camera framing ----------
 * Fullscreen transparent canvas. The camera sits close so the fighters fill
 * a large share of the screen, and gently tracks the midpoint between them
 * (clamped) so the action stays centered — on narrow phone screens that
 * follow keeps the whole bout in frame. */
let followX = 0;
function frameCamera() {
  const w = canvas.clientWidth || 1;
  const h = canvas.clientHeight || 1;
  camera.aspect = w / Math.max(1, h);
  const portrait = camera.aspect < 0.9;
  camera.fov = portrait ? 55 : 40;
  const tanH = Math.tan(camera.fov * Math.PI / 360);
  /* zoom so the full choreography span fits horizontally, but never further
   * out than these caps — that is what makes the fighters read "big" */
  const need = portrait ? 1.6 : 1.75;
  const z = Math.min(portrait ? 8.5 : 5.0,
                     Math.max(portrait ? 4.5 : 3.0, need / (tanH * camera.aspect)));
  const hw = z * tanH * camera.aspect;      // visible half-width at z=0
  edgeX = Math.min(hw - 0.45, 2.0);         // screen-edge waiting spots
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
    updateBout(dt);
    man.mixer && man.mixer.update(dt);
    woman.mixer && woman.mixer.update(dt);
    updateFx(vt !== null ? 0 : dt);
    if (shakeT > 0) shakeT -= dt;
    controls.update();
    const off = shakeOffset();
    if (off) camera.position.add(off);
    renderer.render(scene, camera);
    if (off) camera.position.sub(off);
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
    for (const f of [man, woman]) {
      for (const a of Object.values(f.actions)) a.setEffectiveTimeScale(TS);
    }
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

replayBtn.addEventListener('click', () => {
  AudioFX.unlock();
  stageEl.classList.remove('bvk-docked');   // go fullscreen again for the show
  void canvas.clientWidth;                  // flush layout so frameCamera sees
  frameCamera();                            // the new fullscreen size right away
  startBout();
});

/* debug hooks for QA automation */
function stepTo(t) {
  vt = 0;
  clock0 = performance.now();
  fired = []; moves = []; pending = []; done = false;
  resetNudges(); clearFx(); shakeT = 0;
  for (const c of contacts) c.fired = false;
  koEl.classList.remove('on');
  const out = homeOut();
  man.baseX = out.m; woman.baseX = out.w;
  man.group.position.set(out.m, 0, 0);
  woman.group.position.set(out.w, 0, 0);
  man.stopAll(); woman.stopAll();
  man.play('guard', { fade: 0 }); woman.play('guard', { fade: 0 });
  const dt = 1 / 60;
  for (let tt = 0; tt <= t; tt += dt) {
    vt = tt;
    updateBout(dt);
    man.mixer.update(dt);
    woman.mixer.update(dt);
  }
  vt = t;
  /* drop FX whose life would already have ended — matches live playback */
  for (let i = fxLive.length - 1; i >= 0; i--) {
    if (t - fxLive[i].born > fxLive[i].ttl) {
      scene.remove(fxLive[i].s);
      fxLive[i].s.material.dispose();
      fxLive.splice(i, 1);
    }
  }
  renderer.render(scene, camera);
  placeTag(tagBoxing, man);
  placeTag(tagKick, woman);
}
window.__bvk = { man, woman, camera, scene, THREE, contacts, get clock0() { return clock0; }, stepTo };
