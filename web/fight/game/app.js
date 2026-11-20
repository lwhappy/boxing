/* Boxing Training Game — /fight/game/ (index.html)
 *
 * Assets: ../../media/glb/boxer-man.glb + boxer-woman.glb
 *   each = 1 skinned boxer + 25 clips, exported from Blender at 30fps.
 *   clip: idle guard block hit-head hit-body defeat win taunt
 *         jab cross jab-cross combo1 lead-hook rear-hook
 *         lead-uppercut rear-uppercut elbow knee kick
 *         combo2-knee combo2-elbow (step clips are exported but unused: WASD
 *         translates the fighter directly, no locomotion clips)
 *
 * Impact times (seconds inside each clip) were measured in Blender by sampling the
 * striking bone's forward extension frame by frame — see /Users/justrun/project/boxing-game/build.
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { clone as skClone } from 'three/addons/utils/SkeletonUtils.js';

/* ------------------------------------------------------------------ data */

const HP_MAX = 100;
const TARGET_HEIGHT = 1.78;
const ARENA_X = 2.35;
const ARENA_Z = 1.0;
let MIN_GAP = 0.55;         // closest the pair can stand — tight enough that knees
                            // and uppercuts connect (verified per-attack at 0.55)
const MAX_GAP = 3.0;
const WALK = 1.45;          // m/s
const ATTACK_SPEED = 1.28;  // clip time scale while attacking
const RESULT_HOLD_MS = 3000;  // let the KO + victory animations play before the panel
const SAME_LINE_Z = 0.35;     // beyond this lateral offset the pair is "off line"
const KO_SEP_GAP = 1.9;       // distance the pair steps apart before the ending clips
const KO_SEP_SEC = 0.62;      // ...and how long that step-back takes

/** Each strike lists its own contacts: t = seconds into the clip, limb = the bone
 *  that lands it, aim = 'body' for strikes that come up under the guard.
 *  A combo switches hands (and knees) mid-clip, so one limb for the whole attack
 *  mis-judges every contact after the first — that is why the knee used to whiff:
 *  it was measured against the left glove at a frame where the knee was still down.
 *  Every t below was re-measured from the posed skeleton at a 0.6 m gap. */
const ATTACKS = {
  jab:             { label: 'Jab',   hits: [{ t: 0.50, limb: 'LeftHand', dmg: 5 }] },
  cross:           { label: 'Cross', hits: [{ t: 0.67, limb: 'RightHand', dmg: 5 }] },
  'jab-cross':     { label: 'Jab-Cross', hits: [{ t: 0.37, limb: 'LeftHand', dmg: 5 }] },
  combo1:          { label: 'Combo 1', hits: [
                       { t: 0.50, limb: 'LeftHand', dmg: 10 },
                       { t: 0.93, limb: 'LeftHand', dmg: 10 }] },
  'lead-hook':     { label: 'Lead Hook', hits: [{ t: 0.63, limb: 'LeftHand', dmg: 5 }] },
  'rear-hook':     { label: 'Rear Hook', hits: [{ t: 0.73, limb: 'RightHand', dmg: 5 }] },
  'lead-uppercut': { label: 'Lead Uppercut', hits: [{ t: 0.70, limb: 'LeftHand', dmg: 5 }] },
  'rear-uppercut': { label: 'Rear Uppercut', hits: [{ t: 0.70, limb: 'RightHand', dmg: 5 }] },
  elbow:           { label: 'Elbow', hits: [{ t: 0.67, limb: 'RightForeArm', dmg: 5 }] },
  /* the knee peaks at 1.00 s, 0.16 m from the defender's hips; judge it there
   * and against the midsection, not the chin */
  knee:            { label: 'Knee', hits: [{ t: 1.00, limb: 'RightLeg', dmg: 5, aim: 'body' }] },
  /* a high kick: the foot peaks at 0.70 s (1.03 m forward, 1.31 m off the
   * floor) — judge it just before that, when the boot reaches the chest/chin */
  kick:            { label: 'Kick', hits: [{ t: 0.65, limb: 'RightFoot', dmg: 5 }] },
  /* clinch → knee → right hand: the knee at 1.70 s is the one you see land */
  'combo2-knee':   { label: 'Combo 2', hits: [
                       { t: 1.03, limb: 'RightHand', dmg: 10 },
                       { t: 1.70, limb: 'RightLeg', dmg: 5, aim: 'body' },
                       { t: 2.40, limb: 'RightHand', dmg: 15 }] },
  'combo2-elbow':  { label: 'Combo 2', hits: [
                       { t: 0.60, limb: 'LeftHand', dmg: 10 },
                       { t: 3.04, limb: 'RightForeArm', dmg: 5 }] },
};

/* flat views kept for the AI (reads the first contact) and the HUD */
for (const a of Object.values(ATTACKS)) {
  a.t = a.hits.map((h) => h.t);
  a.limb = a.hits[0].limb;
  a.dmg = a.hits[0].dmg;
}

const KEY_ATTACK = {
  KeyY: 'jab', KeyU: 'cross', KeyI: 'jab-cross', KeyO: 'combo1', KeyP: 'combo2-knee',
  KeyH: 'combo2-elbow', KeyJ: 'lead-hook', KeyK: 'rear-hook', KeyL: 'lead-uppercut',
  KeyN: 'rear-uppercut', KeyM: 'elbow', Comma: 'kick', Period: 'knee',
};
const TOUCH_LABEL = {
  jab: 'JAB', cross: 'CROSS', 'jab-cross': 'JAB·CR', combo1: 'COMBO1',
  'lead-hook': 'L HOOK', 'rear-hook': 'R HOOK', 'lead-uppercut': 'L UPPER',
  'rear-uppercut': 'R UPPER', elbow: 'ELBOW', knee: 'KNEE', kick: 'KICK',
  'combo2-knee': 'COMBO2', 'combo2-elbow': 'CMB2·E',
};

const LEVELS = [
  { name: 'Beginner', cd: 1.55, react: 0.55, block: 0.14, speed: 0.82, combo: 0.10 },
  { name: 'Amateur',  cd: 1.00, react: 0.30, block: 0.38, speed: 1.00, combo: 0.28 },
  { name: 'Pro',      cd: 0.62, react: 0.15, block: 0.66, speed: 1.12, combo: 0.45 },
];

/* ------------------------------------------------------------------ audio */

const Sfx = {
  ctx: null, master: null, noise: null,
  init() {
    if (this.ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.85;
    this.master.connect(this.ctx.destination);
    const len = Math.floor(this.ctx.sampleRate * 0.4);
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
    this.noise = buf;
  },
  resume() { if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume(); },
  _noise(dur, freq, q, gain, type = 'lowpass') {
    const c = this.ctx, t = c.currentTime;
    const src = c.createBufferSource(); src.buffer = this.noise;
    const f = c.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
    const g = c.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
    src.connect(f); f.connect(g); g.connect(this.master);
    src.start(t); src.stop(t + dur + 0.02);
  },
  _tone(freq, dur, gain, type = 'sine', slide = 0) {
    const c = this.ctx, t = c.currentTime;
    const o = c.createOscillator(); o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(40, freq * slide), t + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
    o.connect(g); g.connect(this.master);
    o.start(t); o.stop(t + dur + 0.02);
  },
  punch(power = 1) {
    if (!this.ctx) return;
    this._noise(0.16, 380 * power, 1.2, 0.55);
    this._tone(96 * power, 0.14, 0.5, 'sine', 0.45);
  },
  body() {
    if (!this.ctx) return;
    this._noise(0.2, 240, 0.9, 0.6);
    this._tone(70, 0.18, 0.45, 'sine', 0.5);
  },
  block() {
    if (!this.ctx) return;
    this._noise(0.09, 1400, 2.5, 0.42, 'bandpass');
    this._tone(320, 0.06, 0.24, 'square', 0.7);
  },
  whiff() {
    if (!this.ctx) return;
    this._noise(0.14, 900, 0.7, 0.16, 'highpass');
  },
  taunt() {
    if (!this.ctx) return;
    this._tone(520, 0.09, 0.14, 'triangle', 1.4);
    setTimeout(() => this.ctx && this._tone(660, 0.1, 0.12, 'triangle', 1.3), 110);
  },
  ko() {
    if (!this.ctx) return;
    this._tone(140, 0.5, 0.5, 'sine', 0.35);
    this._noise(0.5, 200, 0.7, 0.5);
  },
  bell() {
    if (!this.ctx) return;
    this._tone(1180, 0.5, 0.22, 'sine', 1);
    setTimeout(() => this.ctx && this._tone(880, 0.6, 0.18, 'sine', 1), 160);
  },
};

/* ------------------------------------------------------------------ fx */

function canvas2d(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}

function makeTex(c) {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 4;
  return t;
}

function radialTex(draw) {
  const s = 128;
  const c = canvas2d(s, s);
  draw(c.getContext('2d'), s);
  return makeTex(c);
}

const FX_TEX = {
  flash: radialTex((g, s) => {
    const grad = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    grad.addColorStop(0, 'rgba(255,255,255,1)');
    grad.addColorStop(0.2, 'rgba(255,255,255,.9)');
    grad.addColorStop(0.5, 'rgba(255,255,255,.22)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, s, s);
  }),
  ring: radialTex((g, s) => {
    g.strokeStyle = 'rgba(255,255,255,1)';
    g.lineWidth = s * 0.05;
    g.beginPath();
    g.arc(s / 2, s / 2, s * 0.42, 0, Math.PI * 2);
    g.stroke();
  }),
  star: radialTex((g, s) => {
    g.translate(s / 2, s / 2);
    g.fillStyle = 'rgba(255,255,255,1)';
    const spikes = 8;
    g.beginPath();
    for (let i = 0; i < spikes * 2; i++) {
      const r = i % 2 === 0 ? s * 0.48 : s * 0.13;
      const a = (i / (spikes * 2)) * Math.PI * 2;
      g.lineTo(Math.cos(a) * r, Math.sin(a) * r);
    }
    g.closePath();
    g.fill();
  }),
  slash: radialTex((g, s) => {
    g.translate(s / 2, s / 2);
    g.strokeStyle = 'rgba(255,255,255,1)';
    g.lineCap = 'round';
    for (const rot of [0.62, -0.62]) {
      g.save();
      g.rotate(rot);
      g.lineWidth = s * 0.065;
      g.beginPath();
      g.moveTo(-s * 0.44, 0);
      g.lineTo(s * 0.44, 0);
      g.stroke();
      g.restore();
    }
  }),
};

/**
 * Pooled impact effects. Everything is additive and ignores depth so the burst
 * reads through gloves and heads instead of being hidden behind them.
 * A hit spawns: white core flash, comic star, crossing slashes, two shockwave
 * rings and a spray of instanced spark shards.
 */
class FX {
  constructor(scene) {
    this.scene = scene;
    this.group = new THREE.Group();
    scene.add(this.group);

    this.bursts = [];
    this.pool = [];
    for (let i = 0; i < 56; i++) {
      const mat = new THREE.SpriteMaterial({
        map: FX_TEX.flash, transparent: true, opacity: 0, depthWrite: false, depthTest: false,
        blending: THREE.AdditiveBlending, toneMapped: false,
      });
      const s = new THREE.Sprite(mat);
      s.visible = false;
      s.renderOrder = 20;
      this.group.add(s);
      this.pool.push(s);
    }

    this.maxSparks = 260;
    const geo = new THREE.BoxGeometry(0.017, 0.017, 0.1);
    const mat = new THREE.MeshBasicMaterial({
      transparent: true, opacity: 0.95, depthWrite: false, depthTest: false,
      blending: THREE.AdditiveBlending, toneMapped: false,
    });
    this.sparkMesh = new THREE.InstancedMesh(geo, mat, this.maxSparks);
    this.sparkMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.sparkMesh.frustumCulled = false;
    this.sparkMesh.count = 0;
    this.sparkMesh.renderOrder = 21;
    this.group.add(this.sparkMesh);
    this.sparks = [];

    this._d = new THREE.Object3D();
    this._v = new THREE.Vector3();
  }

  burst(kind, pos, color, from, to, dur, spin = 0) {
    const s = this.pool.pop();
    if (!s) return;
    const m = s.material;
    m.map = FX_TEX[kind] || FX_TEX.flash;
    m.color.setHex(color);
    m.opacity = 0;
    m.rotation = Math.random() * Math.PI * 2;
    s.position.copy(pos);
    s.scale.setScalar(from);
    s.visible = true;
    this.bursts.push({ s, life: 0, dur, from, to, spin });
  }

  /**
   * @param {THREE.Vector3} pos  world-space contact point
   * @param {{color?:number, dir?:THREE.Vector3, power?:number}} opts
   */
  impact(pos, { color = 0xffd76a, dir = null, power = 1 } = {}) {
    this.burst('flash', pos, 0xffffff, 0.16 * power, 0.95 * power, 0.17);
    this.burst('star', pos, color, 0.2 * power, 1.05 * power, 0.24, 3);
    this.burst('slash', pos, 0xffffff, 0.24 * power, 0.8 * power, 0.16);
    this.burst('ring', pos, color, 0.32 * power, 2.0 * power, 0.38);
    this.burst('ring', pos, 0xffffff, 0.14 * power, 1.05 * power, 0.26);

    const d = dir ? this._v.copy(dir).normalize().clone() : new THREE.Vector3(0, 0, 1);
    const n = Math.round(30 * power);
    for (let i = 0; i < n; i++) {
      const v = new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.28, Math.random() - 0.5)
        .normalize().addScaledVector(d, 1.15).normalize()
        .multiplyScalar((2.2 + Math.random() * 4.8) * power);
      if (this.sparks.length >= this.maxSparks) this.sparks.shift();
      this.sparks.push({
        p: pos.clone(),
        v,
        life: 0,
        max: 0.18 + Math.random() * 0.3,
        col: new THREE.Color(i % 4 === 0 ? 0xffffff : color),
      });
    }
  }

  update(dt) {
    for (let i = this.bursts.length - 1; i >= 0; i--) {
      const b = this.bursts[i];
      b.life += dt;
      const k = Math.min(1, b.life / b.dur);
      const e = 1 - Math.pow(1 - k, 3);
      b.s.scale.setScalar(b.from + (b.to - b.from) * e);
      // fade in fast, then out
      b.s.material.opacity = k < 0.12 ? k / 0.12 : 1 - (k - 0.12) / 0.88;
      if (b.spin) b.s.material.rotation += dt * b.spin;
      if (k >= 1) {
        b.s.visible = false;
        b.s.material.opacity = 0;
        this.pool.push(b.s);
        this.bursts.splice(i, 1);
      }
    }

    for (let i = this.sparks.length - 1; i >= 0; i--) {
      const s = this.sparks[i];
      s.life += dt;
      if (s.life >= s.max) { this.sparks.splice(i, 1); continue; }
      s.p.addScaledVector(s.v, dt);
      s.v.y -= 10 * dt;
      s.v.multiplyScalar(Math.pow(0.05, dt));
    }

    const cap = Math.min(this.sparks.length, this.maxSparks);
    for (let i = 0; i < cap; i++) {
      const s = this.sparks[i];
      const k = 1 - s.life / s.max;
      const speed = s.v.length();
      this._d.position.copy(s.p);
      this._v.copy(s.p).add(s.v);
      this._d.lookAt(this._v);
      const w = 0.65 + 0.95 * k;
      this._d.scale.set(w, w, 0.35 + speed * 0.14 * k);
      this._d.updateMatrix();
      this.sparkMesh.setMatrixAt(i, this._d.matrix);
      this.sparkMesh.setColorAt(i, s.col);
    }
    this.sparkMesh.count = cap;
    this.sparkMesh.instanceMatrix.needsUpdate = true;
    if (this.sparkMesh.instanceColor) this.sparkMesh.instanceColor.needsUpdate = true;
  }
}

/* ------------------------------------------------------------------ ring */

const RING_X = 3.0;
const RING_Z = 2.3;
const ROPE_Y = [0.46, 0.82, 1.18];

/** Printed ring canvas: weave, corner wedges, border rules, centre logo. */
function canvasTexture() {
  const s = 1024;
  const c = canvas2d(s, s);
  const g = c.getContext('2d');

  const grad = g.createLinearGradient(0, 0, s, s);
  grad.addColorStop(0, '#39495b');
  grad.addColorStop(0.5, '#2f3e4e');
  grad.addColorStop(1, '#26323f');
  g.fillStyle = grad;
  g.fillRect(0, 0, s, s);

  // canvas weave
  for (let i = 0; i < 24000; i++) {
    const a = Math.random() * 0.05;
    g.fillStyle = Math.random() < 0.5 ? `rgba(255,255,255,${a})` : `rgba(0,0,0,${a})`;
    g.fillRect(Math.random() * s, Math.random() * s, 2, 2);
  }

  // corner wedges: blue at −X, red at +X
  g.save();
  g.globalAlpha = 0.55;
  g.fillStyle = '#1e3f74';
  g.beginPath(); g.moveTo(0, 0); g.lineTo(s * 0.3, 0); g.lineTo(0, s * 0.3); g.closePath(); g.fill();
  g.beginPath(); g.moveTo(0, s); g.lineTo(s * 0.3, s); g.lineTo(0, s * 0.7); g.closePath(); g.fill();
  g.fillStyle = '#8c1f2c';
  g.beginPath(); g.moveTo(s, 0); g.lineTo(s * 0.7, 0); g.lineTo(s, s * 0.3); g.closePath(); g.fill();
  g.beginPath(); g.moveTo(s, s); g.lineTo(s * 0.7, s); g.lineTo(s, s * 0.7); g.closePath(); g.fill();
  g.restore();

  // border rules
  g.strokeStyle = 'rgba(255,255,255,.16)';
  g.lineWidth = 7;
  g.strokeRect(26, 26, s - 52, s - 52);
  g.strokeStyle = 'rgba(216,164,66,.55)';
  g.lineWidth = 3;
  g.strokeRect(44, 44, s - 88, s - 88);

  // centre circle + gold slash
  g.save();
  g.translate(s / 2, s / 2);
  g.beginPath();
  g.arc(0, 0, s * 0.2, 0, Math.PI * 2);
  g.fillStyle = 'rgba(255,255,255,.045)';
  g.fill();
  g.strokeStyle = 'rgba(255,255,255,.16)';
  g.lineWidth = 5;
  g.stroke();
  g.save();
  g.rotate(-0.5);
  g.fillStyle = 'rgba(216,164,66,.28)';
  g.fillRect(-14, -s * 0.155, 28, s * 0.31);
  g.restore();
  g.fillStyle = 'rgba(255,255,255,.2)';
  g.font = '700 40px ui-sans-serif, system-ui, sans-serif';
  g.textAlign = 'center';
  g.fillText('SILENTJAB', 0, -s * 0.245);
  g.fillText('SILENTJAB', 0, s * 0.29);
  g.restore();

  return makeTex(c);
}

function bannerTexture(withText = true) {
  const w = 1024, h = 192;
  const c = canvas2d(w, h);
  const g = c.getContext('2d');

  const grad = g.createLinearGradient(0, 0, 0, h);
  grad.addColorStop(0, '#171d26');
  grad.addColorStop(1, '#0a0d12');
  g.fillStyle = grad;
  g.fillRect(0, 0, w, h);

  g.save();
  g.globalAlpha = 0.07;
  g.strokeStyle = '#8fa6c0';
  g.lineWidth = 10;
  for (let x = -h; x < w + h; x += 62) {
    g.beginPath(); g.moveTo(x, 0); g.lineTo(x + h, h); g.stroke();
  }
  g.restore();

  g.fillStyle = 'rgba(216,164,66,.8)';
  g.fillRect(0, 9, w, 4);
  g.fillStyle = 'rgba(216,164,66,.3)';
  g.fillRect(0, h - 13, w, 2);

  if (withText) {
    g.textBaseline = 'middle';
    g.textAlign = 'center';
    g.fillStyle = '#d8a442';
    g.font = '800 58px ui-sans-serif, system-ui, sans-serif';
    g.fillText('SILENTJAB', w / 2, h / 2 + 3);
    g.fillStyle = 'rgba(200,214,228,.42)';
    g.font = '600 22px ui-sans-serif, system-ui, sans-serif';
    g.fillText('BOXING SIMULATOR', w * 0.135, h / 2 + 3);
    g.fillText('FREE SPARRING', w * 0.865, h / 2 + 3);
  }

  return makeTex(c);
}

/** Arena bowl seen behind the ring: dark bowl + suggestion of a crowd. */
function bowlTexture() {
  const w = 1024, h = 256;
  const c = canvas2d(w, h);
  const g = c.getContext('2d');

  const grad = g.createLinearGradient(0, 0, 0, h);
  grad.addColorStop(0, '#04060a');
  grad.addColorStop(0.5, '#080d13');
  grad.addColorStop(0.78, '#101822');
  grad.addColorStop(1, '#05070a');
  g.fillStyle = grad;
  g.fillRect(0, 0, w, h);

  for (let i = 0; i < 3000; i++) {
    const a = 0.03 + Math.random() * 0.1;
    g.fillStyle = Math.random() < 0.55
      ? `rgba(190,205,225,${a})`
      : `rgba(255,175,120,${a * 0.75})`;
    g.fillRect(Math.random() * w, h * 0.5 + Math.random() * h * 0.3, 2, 2);
  }

  const glow = g.createRadialGradient(w / 2, h * 0.72, 8, w / 2, h * 0.72, w * 0.55);
  glow.addColorStop(0, 'rgba(96,140,190,.12)');
  glow.addColorStop(1, 'rgba(96,140,190,0)');
  g.fillStyle = glow;
  g.fillRect(0, 0, w, h);

  return makeTex(c);
}

/**
 * Boxing ring: printed canvas, gold trim, skirt with a banner, four posts with
 * coloured pads and three sagging ropes per side. Rope sides facing the camera
 * fade out so they never sit between the lens and the fighters.
 */
class Ring {
  constructor(scene) {
    const G = this.group = new THREE.Group();
    scene.add(G);
    this.sides = [];

    const W = RING_X * 2;
    const D = RING_Z * 2;

    const canvasMesh = new THREE.Mesh(
      new THREE.BoxGeometry(W, 0.16, D),
      new THREE.MeshStandardMaterial({ map: canvasTexture(), roughness: 0.93, metalness: 0.01 }),
    );
    canvasMesh.position.y = -0.08;
    G.add(canvasMesh);

    const trim = new THREE.Mesh(
      new THREE.BoxGeometry(W + 0.12, 0.05, D + 0.12),
      new THREE.MeshStandardMaterial({
        color: 0xd8a442, roughness: 0.4, metalness: 0.55,
        emissive: 0x2a1a04, emissiveIntensity: 0.8,
      }),
    );
    trim.position.y = -0.185;
    G.add(trim);

    const apron = new THREE.Mesh(
      new THREE.BoxGeometry(W + 0.1, 1.06, D + 0.1),
      new THREE.MeshStandardMaterial({ color: 0x0c1016, roughness: 0.95 }),
    );
    apron.position.y = -0.73;
    G.add(apron);

    // skirt banners
    const bannerH = 0.84;
    const frontMat = new THREE.MeshBasicMaterial({ map: bannerTexture(true), toneMapped: false });
    const sideMat = new THREE.MeshBasicMaterial({ map: bannerTexture(false), toneMapped: false });
    for (const [z, rot] of [[D / 2 + 0.052, 0], [-D / 2 - 0.052, Math.PI]]) {
      const p = new THREE.Mesh(new THREE.PlaneGeometry(W, bannerH), frontMat);
      p.position.set(0, -0.62, z);
      p.rotation.y = rot;
      G.add(p);
    }
    for (const [x, rot] of [[W / 2 + 0.052, Math.PI / 2], [-W / 2 - 0.052, -Math.PI / 2]]) {
      const p = new THREE.Mesh(new THREE.PlaneGeometry(D, bannerH), sideMat);
      p.position.set(x, -0.62, 0);
      p.rotation.y = rot;
      G.add(p);
    }

    // posts, caps, turnbuckle pads
    const postMat = new THREE.MeshStandardMaterial({ color: 0xb6c0cb, roughness: 0.32, metalness: 0.85 });
    const postGeo = new THREE.CylinderGeometry(0.075, 0.075, 1.5, 14);
    const capGeo = new THREE.SphereGeometry(0.09, 12, 8);
    const padGeo = new THREE.BoxGeometry(0.23, 0.88, 0.23);
    const corners = [
      [-RING_X, -RING_Z, 0x1e3f74], [-RING_X, RING_Z, 0x1e3f74],
      [RING_X, -RING_Z, 0x8c1f2c], [RING_X, RING_Z, 0x8c1f2c],
    ];
    for (const [x, z, col] of corners) {
      const post = new THREE.Mesh(postGeo, postMat);
      post.position.set(x, 0.75, z);
      G.add(post);
      const cap = new THREE.Mesh(capGeo, postMat);
      cap.position.set(x, 1.5, z);
      G.add(cap);
      const pad = new THREE.Mesh(padGeo, new THREE.MeshStandardMaterial({ color: col, roughness: 0.72 }));
      pad.position.set(x - Math.sign(x) * 0.09, 0.84, z - Math.sign(z) * 0.09);
      G.add(pad);
    }

    // ropes (3 rows, slight sag)
    const ropeCols = [0xc8283c, 0xe7ebf0, 0x2b5aa8];
    const sideDefs = [
      { a: [-RING_X, RING_Z], b: [RING_X, RING_Z], n: new THREE.Vector3(0, 0, 1) },
      { a: [RING_X, -RING_Z], b: [-RING_X, -RING_Z], n: new THREE.Vector3(0, 0, -1) },
      { a: [RING_X, RING_Z], b: [RING_X, -RING_Z], n: new THREE.Vector3(1, 0, 0) },
      { a: [-RING_X, -RING_Z], b: [-RING_X, RING_Z], n: new THREE.Vector3(-1, 0, 0) },
    ];
    for (const side of sideDefs) {
      const mats = [];
      for (let row = 0; row < ROPE_Y.length; row++) {
        const mat = new THREE.MeshStandardMaterial({
          color: ropeCols[row], roughness: 0.5, metalness: 0.06,
          transparent: true, opacity: 1,
        });
        mats.push(mat);
        const pts = [];
        const N = 12;
        for (let k = 0; k <= N; k++) {
          const t = k / N;
          pts.push(new THREE.Vector3(
            side.a[0] + (side.b[0] - side.a[0]) * t,
            ROPE_Y[row] - Math.sin(Math.PI * t) * 0.035,
            side.a[1] + (side.b[1] - side.a[1]) * t,
          ));
        }
        const rope = new THREE.Mesh(
          new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 26, 0.027, 6, false),
          mat,
        );
        G.add(rope);
      }
      this.sides.push({ normal: side.n, mats });
    }
  }

  /** Fade the rope sides that sit between the camera and the fight. */
  update(camera, dt) {
    const view = new THREE.Vector3(camera.position.x, 0, camera.position.z).normalize();
    for (const side of this.sides) {
      const target = side.normal.dot(view) > 0.3 ? 0.13 : 1;
      for (const m of side.mats) {
        m.opacity += (target - m.opacity) * Math.min(1, dt * 7);
        m.depthWrite = m.opacity > 0.85;
      }
    }
  }
}

/** Venue shell: dark arena floor, curved bowl wall, overhead beams. */
function buildArena(scene) {
  const ground = new THREE.Mesh(
    new THREE.CircleGeometry(34, 64),
    new THREE.MeshStandardMaterial({ color: 0x06080b, roughness: 1 }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -1.27;
  scene.add(ground);

  const bowl = new THREE.Mesh(
    new THREE.CylinderGeometry(23, 23, 20, 48, 1, true),
    new THREE.MeshBasicMaterial({
      map: bowlTexture(), side: THREE.BackSide, fog: false, depthWrite: false,
    }),
  );
  bowl.position.y = 8;
  scene.add(bowl);

  for (const x of [-2.5, 2.5]) {
    const beam = new THREE.Mesh(
      new THREE.ConeGeometry(1.3, 7.2, 24, 1, true),
      new THREE.MeshBasicMaterial({
        color: 0xfff2d8, transparent: true, opacity: 0.035, side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
      }),
    );
    beam.position.set(x, 3.8, -1.4);
    scene.add(beam);
  }
}

/* ------------------------------------------------------------------ fighter */

const BONE_KEYS = ['Hips', 'Spine2', 'Head', 'Neck', 'LeftHand', 'RightHand',
  'LeftForeArm', 'RightForeArm', 'LeftLeg', 'RightLeg', 'LeftFoot', 'RightFoot'];
// loops continuously instead of holding the last frame: the defeated
// boxer's beat-down loop and the winner's celebration both start and end
// on the same pose, so they cycle seamlessly
const LOOPING = new Set(['defeat', 'win']);
const ONE_SHOT = new Set(['block', 'hit-head', 'hit-body', 'taunt']);

/**
 * Screen-relative movement, since the camera sits on +Z looking towards -Z:
 *   W = into the screen (-Z)   S = towards the viewer (+Z)
 *   A = screen left (-X)       D = screen right (+X)
 * 'sideL'/'sideR' are the AI's lateral shuffle and 'approach'/'retreat'
 * are resolved against the fighter's own facing inside update().
 */
const DIR_VEC = {
  fwd: [0, -1],
  back: [0, 1],
  left: [-1, 0],
  right: [1, 0],
  sideL: [0, 1],
  sideR: [0, -1],
};

const _sv = new THREE.Vector3();

/**
 * Lowest world-space Y of the skinned mesh in its current pose.
 * The ankle bone sits several centimetres above the sole, so aligning the
 * skeleton to the floor buries the boots under the mat. Sampling the actual
 * skinned vertices gives the real ground contact point.
 */
function lowestSkinnedPoint(root) {
  let low = Infinity;
  root.updateMatrixWorld(true);
  root.traverse((o) => {
    if (!o.isSkinnedMesh || !o.geometry?.attributes?.position) return;
    const pos = o.geometry.attributes.position;
    const step = Math.max(1, Math.floor(pos.count / 6000));   // sample ~6k verts
    for (let i = 0; i < pos.count; i += step) {
      _sv.fromBufferAttribute(pos, i);
      o.applyBoneTransform(i, _sv);
      o.localToWorld(_sv);
      if (_sv.y < low) low = _sv.y;
    }
  });
  return Number.isFinite(low) ? low : 0;
}

class Fighter {
  constructor(gltf, { sex, name, x, side }) {
    this.sex = sex;
    this.name = name;
    this.side = side;           // -1 = left corner (faces +X), +1 = right corner
    this.hp = HP_MAX;
    this.state = 'idle';
    this.guarding = false;
    this.pending = [];
    this.attackName = null;
    this.attackReturnAt = 0;
    this.blockUntil = 0;
    this.hitUntil = 0;
    this.moveDir = null;

    this.root = new THREE.Group();
    this.model = skClone(gltf.scene);

    // normalise height and drop the feet on the floor.
    // Skinned-mesh bounding boxes are unreliable here, so measure the
    // height from the skeleton itself (HeadTop_End minus lowest foot).
    // Tripo/Blender exports the whole body material as BLEND even though the
    // base colour alpha is fully opaque, which causes ghost-limb transparency
    // artifacts. Force it opaque at runtime as a safety net.
    this.model.traverse((o) => {
      if (o.isMesh || o.isSkinnedMesh) {
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        for (const m of mats) {
          if (!m) continue;
          m.transparent = false;
          m.alphaTest = 0;
          m.depthWrite = true;
          m.opacity = 1;
          m.needsUpdate = true;
        }
      }
    });
    this.model.traverse((o) => {
      if (o.isMesh) { o.frustumCulled = false; o.castShadow = false; o.receiveShadow = false; }
    });
    this.bones = {};
    this.model.traverse((o) => {
      if (!o.isBone) return;
      const k = o.name.replace(/^mixamorig[:_]?/, '');
      this.bones[k] = o;
    });
    this.model.updateMatrixWorld(true);
    const _w = new THREE.Vector3();
    const top = this.bones.HeadTop_End || this.bones.Head;
    const yTop = top ? top.getWorldPosition(_w).y : 1;
    const yFoot = Math.min(
      this.bones.LeftFoot ? this.bones.LeftFoot.getWorldPosition(_w).y : 0,
      this.bones.RightFoot ? this.bones.RightFoot.getWorldPosition(_w).y : 0,
    );
    const h = Math.max(0.001, yTop - yFoot);
    const s = TARGET_HEIGHT / h;
    this.model.scale.multiplyScalar(s);
    this.model.updateMatrixWorld(true);

    // Ground the soles, not the ankle bones: the boots reach well below the
    // foot bone, so bone alignment sinks the shoes into the mat and the feet
    // look like they are missing.
    const sole = lowestSkinnedPoint(this.model);
    this.model.position.y -= sole - 0.003;
    this.model.updateMatrixWorld(true);
    this.dbg = { rawH: +h.toFixed(3), scale: +s.toFixed(3), sole: +sole.toFixed(3) };
    this.root.add(this.model);
    this.root.position.set(x, 0, 0);
    this.root.rotation.y = side < 0 ? Math.PI / 2 : -Math.PI / 2;

    this.mixer = new THREE.AnimationMixer(this.model);
    this.actions = {};
    const hips = this.bones.Hips;
    for (const clip of gltf.animations) {
      const c = clip.clone();
      if (c.name !== 'defeat' && hips) stripDrift(c, hips);
      const a = this.mixer.clipAction(c);
      if (ONE_SHOT.has(c.name)) { a.setLoop(THREE.LoopOnce, 1); a.clampWhenFinished = true; }
      else if (LOOPING.has(c.name)) a.setLoop(THREE.LoopRepeat, Infinity);
      this.actions[c.name] = a;
    }
    this.current = this.actions.idle;
    this.current.reset().play();

    // soft contact shadow
    this.shadow = makeBlob(1.35);
    this.shadow.position.set(0, 0.012, 0);
    this.root.add(this.shadow);

    this._v = new THREE.Vector3();
  }

  /* ---------- state helpers ---------- */

  fade(name, dur = 0.16, timeScale = 1) {
    const next = this.actions[name];
    if (!next) return null;
    if (this.current === next && next.isRunning()) { next.timeScale = timeScale; return next; }
    next.reset();
    next.timeScale = timeScale;
    next.setEffectiveWeight(1);
    next.fadeIn(dur).play();
    if (this.current && this.current !== next) this.current.fadeOut(dur);
    this.current = next;
    return next;
  }

  toNeutral() {
    if (this.guarding) this.fade('guard', 0.18);
    else this.fade('idle', 0.2);
    this.state = this.guarding ? 'guard' : 'idle';
  }

  setGuard(on) {
    if (this.state === 'ko' || this.state === 'win') return;
    this.guarding = on;
    if (this.state === 'attack' || this.state === 'hit' || this.state === 'block') return;
    if (on && this.state !== 'guard') { this.fade('guard', 0.14); this.state = 'guard'; }
    if (!on && this.state === 'guard') { this.fade('idle', 0.18); this.state = 'idle'; }
  }

  attack(name) {
    if (!ATTACKS[name] || !this.actions[name]) return false;
    if (this.state === 'attack' || this.state === 'hit' || this.state === 'block' || this.state === 'ko' || this.state === 'win') return false;
    this.state = 'attack';
    this.attackName = name;
    const info = ATTACKS[name];
    const act = this.fade(name, 0.1, ATTACK_SPEED);
    if (!act) return false;
    this.pending = info.hits.map((h) => ({ ...h }));
    this.attackReturnAt = info.hits[info.hits.length - 1].t * 0.92 + 0.42;
    act.clampWhenFinished = true;
    Sfx.whiff();
    return true;
  }

  playBlock() {
    this.state = 'block';
    this.blockUntil = performance.now() + 420;
    const a = this.fade('block', 0.08, 1.15);
    a.clampWhenFinished = true;
  }

  playHit(zone) {
    this.state = 'hit';
    this.hitUntil = performance.now() + 340;
    const a = this.fade(zone === 'head' ? 'hit-head' : 'hit-body', 0.06, 1.2);
    a.clampWhenFinished = true;
  }

  playKO() {
    this.state = 'ko';
    this.guarding = false;
    // the defeat clip is a loopable beat-down pose: let it keep cycling
    const a = this.fade('defeat', 0.12, 1);
    a.clampWhenFinished = false;
    a.setLoop(THREE.LoopRepeat, Infinity);
  }

  playWin() {
    this.state = 'win';
    this.fade('win', 0.2, 1);
  }

  playTaunt() {
    if (this.state !== 'idle' && this.state !== 'guard') return false;
    this.state = 'taunt';
    const a = this.fade('taunt', 0.16, 1);
    a.clampWhenFinished = true;
    Sfx.taunt();
    return true;
  }

  move(dir) { this.moveDir = dir; }

  /* ---------- per frame ---------- */

  update(dt, now) {
    const st = this.state;

    if (st === 'block' && now > this.blockUntil) this.toNeutral();
    if (st === 'hit' && now > this.hitUntil) this.toNeutral();
    if (st === 'taunt' && !this.actions.taunt.isRunning()) this.toNeutral();

    if (st === 'attack') {
      const a = this.actions[this.attackName];
      const t = a.time;
      // short forward lunge into the punch (stops at the impact frame)
      if (this.pending.length && t < this.pending[0].t * 0.85) {
        const fwd = this.side < 0 ? 1 : -1;
        this.root.position.x += fwd * 0.45 * dt;
      }
      while (this.pending.length && t >= this.pending[0].t) {
        const hit = this.pending.shift();
        game.resolveStrike(this, hit);
      }
      if (t >= this.attackReturnAt || a.time >= a.getClip().duration - 0.02) {
        this.attackName = null;
        this.pending.length = 0;
        this.toNeutral();
      }
    }

    // locomotion (never while attacking / hit / ko).
    // Movement is screen-relative so the keys always mean the same thing on
    // screen: W pushes into the screen, S pulls out of it, A/D go left/right.
    // No step clips: the whole fighter slides, idle/guard keeps playing.
    if (st === 'idle' || st === 'guard') {
      const d = this.moveDir;
      if (d) {
        let vx = 0, vz = 0;
        if (d === 'approach' || d === 'retreat') {
          const fwd = this.side < 0 ? 1 : -1;      // AI: close/open the gap
          vx = d === 'approach' ? fwd : -fwd;
        } else if (DIR_VEC[d]) {
          vx = DIR_VEC[d][0];
          vz = DIR_VEC[d][1];
        }
        this.root.position.x += vx * WALK * dt;
        this.root.position.z += vz * WALK * dt;
      }
    }

    // keep inside the ring
    this.root.position.x = THREE.MathUtils.clamp(this.root.position.x, -ARENA_X, ARENA_X);
    this.root.position.z = THREE.MathUtils.clamp(this.root.position.z, -ARENA_Z, ARENA_Z);

    this.mixer.update(dt);
  }

  worldPoint(boneName, out) {
    const b = this.bones[boneName];
    if (!b) return out.set(0, 0, 0);
    return b.getWorldPosition(out);
  }

  dispose() {
    this.root.removeFromParent();
    this.mixer.stopAllAction();
  }
}

/** Remove the horizontal part of the hips translation so clips never drift away. */
function stripDrift(clip, hips) {
  const track = clip.tracks.find((t) => /Hips\.position$/.test(t.name));
  if (!track) return;
  hips.updateWorldMatrix(true, false);
  const q = new THREE.Quaternion();
  (hips.parent || hips).getWorldQuaternion(q);
  const qi = q.clone().invert();
  const base = new THREE.Vector3().fromArray(track.values, 0);
  const v = new THREE.Vector3();
  for (let i = 0; i < track.values.length; i += 3) {
    v.fromArray(track.values, i).sub(base).applyQuaternion(q);
    v.x = 0; v.z = 0;
    v.applyQuaternion(qi).add(base);
    v.toArray(track.values, i);
  }
}

function makeBlob(size) {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(64, 64, 4, 64, 64, 62);
  grd.addColorStop(0, 'rgba(0,0,0,.55)');
  grd.addColorStop(0.55, 'rgba(0,0,0,.22)');
  grd.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 128, 128);
  const tex = new THREE.CanvasTexture(c);
  const m = new THREE.Mesh(
    new THREE.PlaneGeometry(size, size),
    new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false }),
  );
  m.rotation.x = -Math.PI / 2;
  return m;
}

/* ------------------------------------------------------------------ ai */

class AI {
  constructor(fighter, level) {
    this.f = fighter;
    this.p = LEVELS[level] || LEVELS[1];
    this.cool = 1.2;
    this.think = 0;
    this.dir = null;
    this.dirT = 0;
    this.blockT = 0;
    this.tauntT = 9 + Math.random() * 6;
    this.offT = 0;
    this.lastBlockCheck = 0;
    // flipped the first time the foe takes a hit: from then on it fights back
    // for real — hands up, no taunts, no standing around off the centre line
    this.engaged = false;
    this.guardCycle = 0;
    this.guardUp = false;
  }

  update(dt, foe) {
    const f = this.f;
    if (f.state === 'ko' || f.state === 'win' || game.over) return;

    if (f.hp < HP_MAX) this.engaged = true;

    const gap = Math.abs(foe.root.position.x - f.root.position.x);
    const dz = Math.abs(foe.root.position.z - f.root.position.z);
    this.cool -= dt;
    this.tauntT -= dt;
    this.dirT -= dt;
    this.blockT -= dt;

    // --- off the centre line ----------------------------------------------
    // While the fight hasn't really started the pair only ever faces along X,
    // so a lateral (Z) offset means every punch would whiff — the old behaviour
    // was to idle and taunt. Once it has been hit the foe stops playing around:
    // it walks back onto the line and keeps throwing, even from a bad angle.
    if (dz > SAME_LINE_Z && !this.engaged) {
      f.move(null);
      if (f.guarding) f.setGuard(false);
      if (f.state === 'idle' || f.state === 'guard' || f.state === 'taunt') {
        this.offT -= dt;
        if (this.offT <= 0) {
          this.offT = 1.3 + Math.random() * 1.6;
          if (f.state === 'taunt') f.toNeutral();
          else if (Math.random() < 0.65) f.playTaunt();
        }
      }
      return;
    }
    this.offT = 0;

    // --- defensive reaction: read the incoming punch
    if (foe.state === 'attack' && foe.attackName) {
      const a = foe.actions[foe.attackName];
      const info = ATTACKS[foe.attackName];
      if (a && info) {
        const timeToHit = info.t[0] / ATTACK_SPEED - a.time;
        // a cornered/wounded foe reads punches far better than a fresh one
        const chance = this.engaged ? Math.min(0.95, this.p.block * 1.35) : this.p.block * 0.6;
        if (timeToHit > 0 && timeToHit < this.p.react && Math.random() < chance) {
          f.setGuard(true);
          this.blockT = 0.5;
        }
      }
    }
    if (this.blockT <= 0 && !this.engaged && f.guarding && f.state === 'guard') f.setGuard(false);

    // --- defensive mode: hands stay up between exchanges --------------------
    // Guard is held for a couple of seconds, then dropped for a beat so the
    // player still has a window to land something.
    if (this.engaged) {
      this.guardCycle -= dt;
      if (this.guardCycle <= 0) {
        this.guardUp = !this.guardUp;
        this.guardCycle = this.guardUp ? 1.6 + Math.random() * 1.0 : 0.45 + Math.random() * 0.3;
      }
      if (f.state === 'idle' && this.guardUp) f.setGuard(true);
      else if (f.state === 'guard' && !this.guardUp && this.blockT <= 0) f.setGuard(false);
    }

    // --- positioning
    if (this.engaged && dz > SAME_LINE_Z) {
      // engaged and off the centre line: walk back onto it, don't just stand there
      this.dir = foe.root.position.z > f.root.position.z ? 'sideL' : 'sideR';
    } else if (this.dirT <= 0) {
      this.dirT = 0.35 + Math.random() * 0.35;
      if (gap > 1.05) this.dir = 'approach';
      else if (gap < 0.62) this.dir = 'retreat';
      else this.dir = Math.random() < 0.35 ? (Math.random() < 0.5 ? 'sideL' : 'sideR') : null;
    }
    // The AI must never wander off the line on its own (that would freeze it
    // into permanent taunting), so cap its lateral drift; only the player's
    // movement should ever put the pair off line. Once engaged the cap is off —
    // walking back onto the line is the whole point.
    if (!this.engaged &&
        ((this.dir === 'sideL' && f.root.position.z > 0.28) ||
         (this.dir === 'sideR' && f.root.position.z < -0.28))) this.dir = null;
    f.move(f.state === 'idle' || f.state === 'guard' ? this.dir : null);

    // --- offence
    if (this.cool <= 0 && gap < (this.engaged ? 1.45 : 1.32) && (f.state === 'idle' || f.state === 'guard')) {
      const pool = Math.random() < this.p.combo
        ? ['combo1', 'combo2-knee', 'combo2-elbow', 'jab-cross']
        : ['jab', 'jab', 'cross', 'cross', 'lead-hook', 'rear-hook', 'lead-uppercut', 'rear-uppercut', 'elbow', 'knee'];
      const pick = pool[(Math.random() * pool.length) | 0];
      if (pick === 'knee' || pick === 'combo2-knee') { if (gap > 0.72) { this.cool = 0.3; return; } }
      if (f.attack(pick)) this.cool = this.p.cd * (0.8 + Math.random() * 0.5);
    }

    // --- taunt when the rival is far away (never once the fight is real)
    if (!this.engaged && this.tauntT <= 0 && gap > 1.6) {
      this.tauntT = 14 + Math.random() * 10;
      f.playTaunt();
    }
  }
}

/* ------------------------------------------------------------------ game */

const game = {
  scene: null, camera: null, renderer: null, fx: null, clock: null,
  player: null, foe: null, ai: null,
  over: true, started: false, level: 1, t0: 0,
  manGltf: null, womanGltf: null,
};

const gltfLoader = new GLTFLoader();

function loadGLB(url, onProgress) {
  return new Promise((res, rej) => gltfLoader.load(url, res, onProgress, rej));
}

async function boot() {
  const stage = document.getElementById('stage');
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' });
  // phones run at a slightly lower internal resolution — fill rate matters more
  // than sharpness there, and 1.5x keeps the fight smooth on mid-range GPUs
  const coarse = window.matchMedia('(pointer:coarse)').matches;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, coarse ? 1.5 : 1.75));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.08;
  stage.appendChild(renderer.domElement);
  game.renderer = renderer;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0a0c0f);
  scene.fog = new THREE.Fog(0x0a0c0f, 6.5, 13);
  game.scene = scene;

  const camera = new THREE.PerspectiveCamera(38, window.innerWidth / window.innerHeight, 0.1, 60);
  camera.position.set(0.55, 1.62, 4.35);
  camera.lookAt(0, 1.02, 0);
  game.camera = camera;
  scene.userData.cam = camera;
  frameCamera();

  // lighting: studio IBL + key + rim + a warm overhead pool on the canvas
  try {
    const pmrem = new THREE.PMREMGenerator(renderer);
    scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  } catch (e) { /* IBL optional */ }
  const hemi = new THREE.HemisphereLight(0xdce6ff, 0x1a1d22, 0.5);
  scene.add(hemi);
  const key = new THREE.DirectionalLight(0xffffff, 1.9);
  key.position.set(2.4, 4.2, 3.2);
  scene.add(key);
  const rim = new THREE.DirectionalLight(0x6ea8ff, 1.0);
  rim.position.set(-3, 2.6, -3.4);
  scene.add(rim);
  const spot = new THREE.SpotLight(0xfff3e0, 78, 13, Math.PI / 4.6, 0.72, 1.25);
  spot.position.set(0.4, 5.8, 1.3);
  spot.target.position.set(0, 0, 0);
  scene.add(spot, spot.target);

  // ring + venue
  buildArena(scene);
  game.ring = new Ring(scene);

  game.fx = new FX(scene);
  game.clock = new THREE.Clock();

  window.addEventListener('resize', onResize);
  bindUI();

  // load both fighters up front
  const st = document.getElementById('loadState');
  let got = 0;
  const prog = () => { got++; if (got === 2) { st.textContent = 'ready — pick a difficulty'; document.getElementById('startBtn').disabled = false; } };
  document.getElementById('startBtn').disabled = true;
  try {
    const [man, woman] = await Promise.all([
      // ?v=2: the kick clip replaced the headbutt — without a new URL a visitor
      // who cached the old model keeps a fighter that has no 'kick' action
      loadGLB('../../media/glb/boxer-man.glb?v=2', prog),
      loadGLB('../../media/glb/boxer-woman.glb?v=2', prog),
    ]);
    game.manGltf = man; game.womanGltf = woman;
    st.textContent = 'ready — pick a difficulty';
    document.getElementById('startBtn').disabled = false;

    // ?demo=man|woman&level=0..2 jumps straight into the ring (used for QA screenshots)
    const q = new URLSearchParams(location.search);
    if (q.get('gap')) MIN_GAP = Math.max(0.3, Math.min(1.2, Number(q.get('gap')) || MIN_GAP));
    if (q.get('demo')) {
      const sex = q.get('demo') === 'woman' ? 'woman' : 'man';
      const lv = Math.max(0, Math.min(2, Number(q.get('level') || 1)));
      document.querySelectorAll('.screen').forEach((s) => s.classList.remove('on'));
      startFight(sex, lv);
      if (q.get('move')) setTimeout(() => game.player.attack(q.get('move')), 900);
      const spamAtk = q.get('spam');
      setInterval(() => game.player && game.player.attack(spamAtk === '1' ? 'jab' : spamAtk), 1300);
      if (q.get('hp')) setTimeout(() => { if (game.foe) game.foe.hp = Number(q.get('hp')); updateHUD(); }, 1200);
      if (q.get('guard')) setInterval(() => game.player && game.player.setGuard(true), 250);
      if (q.get('touch')) buildTouch();     // QA: pads + rotate button without the menus
      game.spam = true;
    }
  } catch (e) {
    st.textContent = 'could not load the fighters — ' + (e.message || 'network error') +
      ' · try a hard refresh (' + (navigator.platform.includes('Mac') ? '⌘⇧R' : 'Ctrl+F5') + ')';
    console.error(e);
  }

  renderer.setAnimationLoop(tick);
}

/* Camera framing differs per viewport class: phones sit further back so the ring
 * (ropes, posts and both fighters' feet) stays in frame instead of filling it. */
let camBaseY = 1.62;
let camBaseZ = 4.35;

function frameCamera() {
  const w = window.innerWidth, h = window.innerHeight;
  const portrait = h > w;
  const short = h <= 500;
  camBaseY = portrait ? 1.98 : short ? 1.82 : 1.62;
  camBaseZ = portrait ? 6.1 : short ? 5.45 : 4.35;
  if (!game.camera) return;
  // Portrait phones keep a wider lens so the ring still fits vertically.
  game.camera.aspect = w / h;
  game.camera.fov = w / h < 1 ? 54 : 38;
  game.camera.updateProjectionMatrix();
  game.camera.position.set(0.55, camBaseY, camBaseZ);
  game.camera.lookAt(0, 1.02, 0);
}

function onResize() {
  if (!game.renderer) return;
  const w = window.innerWidth, h = window.innerHeight;
  game.renderer.setSize(w, h);
  frameCamera();
}

/* ---------- strike resolution ---------- */

const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _v3 = new THREE.Vector3();
const _v4 = new THREE.Vector3();
const _v5 = new THREE.Vector3();
const _v6 = new THREE.Vector3();

game.resolveStrike = function (att, hit) {
  const def = att.foe;
  if (!def || game.over) return;
  if (def.state === 'ko') return;
  const info = ATTACKS[att.attackName || ''];
  if (!info) return;

  /* each contact brings its own bone and value: a combo lands with a hand, then
   * a knee, then the other hand */
  const limb = (hit && hit.limb) || info.limb;
  const dmg = hit && hit.dmg != null ? hit.dmg : info.dmg;
  const aim = (hit && hit.aim) || 'auto';
  const p = att.worldPoint(limb, _v1).clone();
  const gap = Math.abs(def.root.position.x - att.root.position.x);

  // punch travel direction: attacker -> defender, lifted a little
  const dir = new THREE.Vector3(
    def.root.position.x - att.root.position.x,
    0.18,
    def.root.position.z - att.root.position.z,
  ).normalize();

  // out of range: swing and miss
  if (gap > 1.45) { log('whiff-far'); Sfx.whiff(); return; }

  const head = def.worldPoint('Head', _v2).clone().add(new THREE.Vector3(0, 0.06, 0));
  const chest = def.worldPoint('Spine2', _v3).clone();
  const belly = def.worldPoint('Spine', _v5).clone();
  const hips = def.worldPoint('Hips', _v6).clone();
  const lh = def.worldPoint('LeftHand', _v4).clone();
  const rh = def.worldPoint('RightHand', new THREE.Vector3()).clone();

  const dHead = p.distanceTo(head);
  const dChest = p.distanceTo(chest);
  const dGlove = Math.min(p.distanceTo(lh), p.distanceTo(rh));

  // glove contact = blocked, but only when the defender is actively covering up —
  // idle hands sit near the chin and would otherwise block everything. A knee
  // comes up under the hands, so it can never be caught on the gloves.
  const covering = def.state === 'guard' || def.state === 'block';
  if (aim !== 'body' && covering && dGlove < 0.34) {
    log('block ' + att.attackName + ' dG=' + dGlove.toFixed(2));
    def.playBlock();
    Sfx.block();
    game.fx.impact(p, { color: 0x9fd8ff, dir, power: 0.75 });
    popAt(p, 'BLOCK', 'block');
    hitstop(0.05);
    shake(0.03);
    return;
  }

  let zone = null;
  let at = null;
  if (aim === 'body') {
    /* body strikes (knee) are aimed at the trunk: an uppercut-like knee meets the
     * belly/hips, which sits a good half-metre below the chest bone, so judging it
     * against Spine2 threw away every clean hit. Take the nearest of the three. */
    const body = [
      { d: dChest, at: chest },
      { d: p.distanceTo(belly), at: belly },
      { d: p.distanceTo(hips), at: hips },
    ].sort((a, b) => a.d - b.d)[0];
    if (body.d < 0.42) { zone = 'body'; at = body.at; }
  } else {
    if (dHead < 0.38) { zone = 'head'; at = head; }
    else if (dChest < 0.48) { zone = 'body'; at = chest; }
  }
  if (!zone) {
    log('whiff ' + att.attackName + ' dH=' + dHead.toFixed(2) + ' dC=' + dChest.toFixed(2) + ' dG=' + dGlove.toFixed(2));
    Sfx.whiff(); return;
  }
  if (def.state === 'hit' && performance.now() < def.hitUntil) return;

  const power = zone === 'head' ? 1.3 : 1.05;
  def.hp = Math.max(0, def.hp - dmg);
  def.playHit(zone);
  // haptic feedback when you're the one getting hit
  if (def === game.player && navigator.vibrate) { try { navigator.vibrate(zone === 'head' ? 55 : 35); } catch (e) {} }

  // ---- impact feedback ----------------------------------------------------
  game.fx.impact(at, { color: zone === 'head' ? 0xffd76a : 0xff9d6a, dir, power });
  if (zone === 'head') Sfx.punch(1.15); else Sfx.body();
  popAt(at, '-' + dmg, zone === 'head' ? 'big' : '');

  hitstop(zone === 'head' ? 0.105 : 0.075);
  shake(zone === 'head' ? 0.11 : 0.07);
  camKick.addScaledVector(dir, zone === 'head' ? 0.075 : 0.045);
  camKick.y += zone === 'head' ? 0.03 : 0.015;

  if (def === game.player) screenFlash(zone === 'head' ? 0.34 : 0.22, 'rgba(255,90,80,.55)');
  else screenFlash(zone === 'head' ? 0.2 : 0.12, 'rgba(255,236,190,.5)');

  updateHUD();

  log(zone + ' ' + att.attackName + ' (' + limb + ') dmg ' + dmg);
  if (def.hp <= 0) {
    // knockout: everything cranked up
    game.fx.impact(at, { color: 0xffe08a, dir, power: 2.3 });
    hitstop(0.18);
    shake(0.18);
    camKick.addScaledVector(dir, 0.16);
    camKick.y += 0.05;
    screenFlash(0.55, 'rgba(255,220,150,.6)');
    endFight(att, def);
  }
};

/* ---- impact feedback helpers ---- */

let stopT = 0;                    // seconds of hit-stop left
const camKick = new THREE.Vector3();

/** Freeze the fight for a few frames — the single biggest "weight" cue. */
function hitstop(sec) { stopT = Math.max(stopT, sec); }

/** Brief full-screen bloom; warm for landing, red for taking one. */
function screenFlash(strength, color) {
  const el = document.getElementById('flash');
  if (!el) return;
  el.style.background =
    `radial-gradient(circle at 50% 46%, ${color}, rgba(0,0,0,0) 62%)`;
  el.animate([{ opacity: strength }, { opacity: 0 }], { duration: 240, easing: 'ease-out' });
}

const popPool = [];
/** Floating damage number projected from the contact point. */
function popAt(worldPos, text, cls) {
  const box = document.getElementById('pops');
  if (!box) return;
  const v = worldPos.clone().project(game.camera);
  const x = (v.x * 0.5 + 0.5) * window.innerWidth;
  const y = (-v.y * 0.5 + 0.5) * window.innerHeight;

  let el = popPool.pop();
  if (!el) el = document.createElement('div');
  el.className = 'pop ' + (cls || '');
  el.textContent = text;
  el.style.left = x + 'px';
  el.style.top = y + 'px';
  el.style.opacity = '1';
  box.appendChild(el);

  const drift = (Math.random() - 0.5) * 26;
  const anim = el.animate([
    { transform: 'translate(-50%,-50%) scale(.55)', opacity: 0 },
    { transform: 'translate(-50%,-58%) scale(1.18)', opacity: 1, offset: 0.18 },
    { transform: `translate(calc(-50% + ${drift}px),-135%) scale(1)`, opacity: 0 },
  ], { duration: 720, easing: 'cubic-bezier(.2,.7,.3,1)' });
  anim.onfinish = () => {
    el.remove();
    if (popPool.length < 12) popPool.push(el);
  };
}

const LOG = {};
function log(msg) { LOG[msg.split(' ')[0]] = (LOG[msg.split(' ')[0]] || 0) + 1; LOG.last = msg; }
let shakeT = 0;
function shake(k) { shakeT = Math.max(shakeT, k); }

/* ---------- fight lifecycle ---------- */

function startFight(sex, level) {
  const stage = game.scene;
  if (game.player) { game.player.dispose(); game.player = null; }
  if (game.foe) { game.foe.dispose(); game.foe = null; }

  const playerGltf = sex === 'man' ? game.manGltf : game.womanGltf;
  const foeGltf = sex === 'man' ? game.womanGltf : game.manGltf;
  const playerName = sex === 'man' ? 'Marcus' : 'Nadia';
  const foeName = sex === 'man' ? 'Nadia' : 'Marcus';

  const p = new Fighter(playerGltf, { sex, name: playerName, x: -0.55, side: -1 });
  const f = new Fighter(foeGltf, { sex: sex === 'man' ? 'woman' : 'man', name: foeName, x: 0.55, side: 1 });
  p.foe = f; f.foe = p;
  stage.add(p.root, f.root);

  game.player = p;
  game.foe = f;
  game.ai = new AI(f, level);
  game.level = level;
  game.over = false;
  game.sep = null;
  game.started = true;
  game.t0 = performance.now();

  document.getElementById('meName').textContent = playerName;
  document.getElementById('foeName').textContent = foeName;
  updateHUD();
  document.getElementById('hud').classList.add('on');
  document.getElementById('hint').style.display = window.matchMedia('(pointer:coarse)').matches ? 'none' : 'block';

  p.fade('idle', 0.001);
  f.fade('idle', 0.001);
  Sfx.bell();
  if (new URLSearchParams(location.search).get('debug')) {
    document.getElementById('hint').textContent =
      `debug ${p.name}: rawH=${p.dbg.rawH} scale=${p.dbg.scale} | ${f.name}: rawH=${f.dbg.rawH} scale=${f.dbg.scale}`;
  }
}

function endFight(winner, loser) {
  if (game.over) return;
  game.over = true;

  // freeze input so a held WASD key can't fight the step-back tween
  for (const k of Object.keys(held)) held[k] = false;
  game.player.move(null);
  game.foe.move(null);

  // A KO usually happens at punching range (~0.55m), which would put the
  // victory clip inside the body of the guy on the canvas. So both fighters
  // step back to a respectful distance first, THEN the ending clips start:
  // the loser drops where they end up, the winner celebrates from a safe gap.
  const p = game.player.root.position;
  const f = game.foe.root.position;
  const dir = Math.sign(f.x - p.x) || 1;
  const mid = THREE.MathUtils.clamp((p.x + f.x) / 2, -ARENA_X + KO_SEP_GAP / 2, ARENA_X - KO_SEP_GAP / 2);
  game.sep = {
    t: 0,
    dur: KO_SEP_SEC,
    p0: p.x, p1: mid - dir * (KO_SEP_GAP / 2),
    f0: f.x, f1: mid + dir * (KO_SEP_GAP / 2),
    done() {
      loser.playKO();
      Sfx.ko();
      setTimeout(() => winner.playWin(), 420);
    },
  };

  // Hold the final tableaux before the result panel: the pair steps apart,
  // the loser drops, the winner celebrates, then the (nearly transparent,
  // bottom-docked) panel fades in over the still-running scene.
  setTimeout(() => {
    const won = winner === game.player;
    const kicker = document.getElementById('overKicker');
    kicker.textContent = won ? 'you win' : '';
    kicker.style.display = won ? '' : 'none';
    document.getElementById('overTitle').textContent = won ? 'Knockout!' : 'You lose';
    document.getElementById('overText').textContent =
      `${winner.name} wins with ${winner.hp} / ${HP_MAX} left. Difficulty: ${LEVELS[game.level].name}.`;
    document.getElementById('over').classList.add('on');
    document.getElementById('hud').classList.remove('on');
  }, KO_SEP_SEC * 1000 + RESULT_HOLD_MS);
}

function updateHUD() {
  const p = game.player, f = game.foe;
  if (!p || !f) return;
  document.getElementById('meBar').style.width = (p.hp / HP_MAX) * 100 + '%';
  document.getElementById('foeBar').style.width = (f.hp / HP_MAX) * 100 + '%';
  document.getElementById('meHp').textContent = p.hp;
  document.getElementById('foeHp').textContent = f.hp;
}

/* ---------- input ---------- */

// Long-pressing a pad used to pop the context menu and start a text selection on
// the button labels / arrow glyphs. Both are suppressed for the whole page: there
// is nothing here a player needs to select or drag.
window.addEventListener('contextmenu', (e) => e.preventDefault());
window.addEventListener('selectstart', (e) => e.preventDefault());
window.addEventListener('dragstart', (e) => e.preventDefault());

const held = { fwd: false, back: false, left: false, right: false };

function movement() {
  const p = game.player;
  if (!p) return;
  if (p.state === 'attack' || p.state === 'hit' || p.state === 'ko' || p.state === 'win') { p.move(null); return; }
  let d = null;
  if (held.fwd) d = 'fwd';
  else if (held.back) d = 'back';
  else if (held.left) d = 'left';
  else if (held.right) d = 'right';
  p.move(d);
}

function onKey(e, down) {
  const p = game.player;
  if (!p || game.over) return;
  const code = e.code;
  if (code in KEY_ATTACK) {
    e.preventDefault();
    if (down) p.attack(KEY_ATTACK[code]);
    return;
  }
  /* ';' is a latch, exactly like the on-screen GUARD button: one tap puts the hands
   * up and they stay up, a second tap drops them. It used to mirror the key state,
   * so a normal tap (down + up) flashed the guard for a few milliseconds and the
   * pose was gone before you could see it. Auto-repeat must not toggle it either. */
  if (code === 'Semicolon') { e.preventDefault(); if (down && !e.repeat) p.setGuard(!p.guarding); return; }
  if (code === 'Quote') { e.preventDefault(); if (down) p.playTaunt(); return; }
  if (code === 'KeyW' || code === 'KeyS' || code === 'KeyA' || code === 'KeyD') {
    e.preventDefault();
    if (code === 'KeyW') held.fwd = down;
    if (code === 'KeyS') held.back = down;
    if (code === 'KeyA') held.left = down;
    if (code === 'KeyD') held.right = down;
    movement();
  }
}

/* ---------- ui ---------- */

/* In-card AdSense units (intro + select).
 * #select stays display:none until the player leaves the intro, and an <ins>
 * inside a hidden box measures 0×0 — Google never fills it. So each unit is
 * pushed the first time its screen actually becomes visible, in DOM order.
 * When Google answers "unfilled" (or never answers because the request was
 * blocked) the whole slot is dropped, so the card keeps its shape instead of
 * showing an empty strip. */
const adFilled = new WeakSet();
function fillAd(screen) {
  if (!screen || adFilled.has(screen)) return;
  const slot = screen.querySelector('.ad-slot');
  const ins = slot && slot.querySelector('ins.adsbygoogle');
  if (!ins) return;
  adFilled.add(screen);

  const id = (ins.getAttribute('data-ad-slot') || '').trim();
  if (!/^\d{9,10}$/.test(id)) { slot.classList.add('is-empty'); return; }

  if (!ins.getAttribute('data-adsbygoogle-status')) {
    try { (window.adsbygoogle = window.adsbygoogle || []).push({}); } catch (e) { /* loader missing */ }
  }
  const settle = () => {
    const st = ins.getAttribute('data-ad-status');
    if (st === 'unfilled') slot.classList.add('is-empty');
    else if (st === 'filled' || ins.querySelector('iframe')) slot.classList.remove('is-empty');
  };
  settle();
  new MutationObserver(settle).observe(ins, { attributes: true, attributeFilter: ['data-ad-status'], childList: true });
  // Google can answer late on slow links — only collapse when it stays silent for a long while.
  setTimeout(() => { if (!ins.getAttribute('data-ad-status') && !ins.querySelector('iframe')) slot.classList.add('is-empty'); }, 15000);
}

function bindUI() {
  let pickedSex = 'woman'; // woman pre-selected
  let level = 1;

  // reflect the default pick (Nadia) in the UI
  document.getElementById('pickState').textContent =
    'Nadia in the ring — rival takes the far corner';
  document.getElementById('goBtn').disabled = false;

  const intro = document.getElementById('intro');
  const select = document.getElementById('select');
  const over = document.getElementById('over');

  fillAd(intro);           // intro is on screen from the first frame

  document.getElementById('diffSeg').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-diff]');
    if (!b) return;
    level = Number(b.dataset.diff);
    [...e.currentTarget.children].forEach((c) => c.classList.toggle('on', c === b));
  });

  document.getElementById('startBtn').addEventListener('click', () => {
    Sfx.init(); Sfx.resume();
    intro.classList.remove('on');
    select.classList.add('on');
    fillAd(select);        // first show is the first moment the unit has a size
  });

  document.getElementById('picks').addEventListener('click', (e) => {
    const b = e.target.closest('.pick');
    if (!b) return;
    pickedSex = b.dataset.sex;
    [...document.getElementById('picks').children].forEach((c) => c.classList.toggle('on', c === b));
    document.getElementById('goBtn').disabled = false;
    document.getElementById('pickState').textContent =
      `${b.querySelector('.t').textContent} in the ring — rival takes the far corner`;
  });

  document.getElementById('backIntro').addEventListener('click', (e) => {
    e.preventDefault();
    select.classList.remove('on');
    intro.classList.add('on');
  });

  document.getElementById('goBtn').addEventListener('click', () => {
    if (!pickedSex) return;
    select.classList.remove('on');
    startFight(pickedSex, level);
    buildTouch();
  });

  document.getElementById('againBtn').addEventListener('click', () => {
    over.classList.remove('on');
    if (pickedSex) startFight(pickedSex, level);
  });

  window.addEventListener('keydown', (e) => onKey(e, true));
  window.addEventListener('keyup', (e) => onKey(e, false));

  // No auto-rotate and no rotate prompt: some browsers cannot rotate (or the
  // lock silently fails), so the game never forces a screen orientation. The
  // player toggles it from the button above the d-pad (see setupRotate()).
}

/* ---------- screen orientation ---------- */

function orientationNow() {
  return window.innerHeight > window.innerWidth ? 'portrait' : 'landscape';
}

/** Redraw the button: the phone glyph mirrors the orientation on screen now. */
function paintRot() {
  const rect = document.getElementById('rotRect');
  const bar = document.getElementById('rotBar');
  if (!rect) return;
  const landscape = orientationNow() === 'landscape';
  if (landscape) {
    rect.setAttribute('x', '4.2'); rect.setAttribute('y', '7.4');
    rect.setAttribute('width', '15.6'); rect.setAttribute('height', '8.4');
    rect.setAttribute('rx', '2.4');
    bar.setAttribute('d', 'M18 11v1.6');
  } else {
    rect.setAttribute('x', '5.4'); rect.setAttribute('y', '4');
    rect.setAttribute('width', '7'); rect.setAttribute('height', '16');
    rect.setAttribute('rx', '2.2');
    bar.setAttribute('d', 'M7.8 17.3h2.2');
  }
  const btn = document.getElementById('rot');
  if (btn) {
    const next = landscape ? 'portrait' : 'landscape';
    btn.setAttribute('aria-label', 'Switch to ' + next);
    btn.title = 'Switch to ' + next;
  }
}

/** Keep the button clear of the d-pad, whatever size the pad ends up. */
function placeRot() {
  const touch = document.getElementById('touch');
  const dpad = document.getElementById('dpad');
  if (!touch || !dpad) return;
  const r = dpad.getBoundingClientRect();
  const landscape = orientationNow() === 'landscape';
  if (landscape) {
    // wide screen: there is room beside the pad, so it stays on the floor line
    touch.style.setProperty('--rot-b', Math.round(window.innerHeight - r.bottom) + 'px');
    touch.style.setProperty('--rot-l', Math.round(r.right + 10) + 'px');
  } else {
    // narrow screen: stack it just above the pad, same left edge
    touch.style.setProperty('--rot-b', Math.round(window.innerHeight - r.top + 10) + 'px');
    touch.style.setProperty('--rot-l', '12px');
  }
}

let tipTimer = 0;
function rotTip() {
  const tip = document.getElementById('rotTip');
  if (!tip) return;
  placeRot();
  tip.classList.add('on');
  clearTimeout(tipTimer);
  tipTimer = setTimeout(() => tip.classList.remove('on'), 2200);
}

async function toggleOrientation() {
  const next = orientationNow() === 'portrait' ? 'landscape' : 'portrait';
  const root = document.documentElement;
  // Chrome/Safari only honour an orientation lock from fullscreen.
  try {
    if (root.requestFullscreen && !document.fullscreenElement) {
      await root.requestFullscreen({ navigationUI: 'hide' }).catch(() => {});
    }
  } catch (e) { /* fullscreen blocked — the lock will just fail below */ }

  let locked = false;
  try {
    if (screen.orientation && screen.orientation.lock) {
      await screen.orientation.lock(next);
      locked = true;
    }
  } catch (e) { locked = false; }

  // iOS Safari and some Android browsers refuse the lock: tell the player to
  // turn the phone instead of leaving a dead button.
  if (!locked) rotTip();
  setTimeout(paintRot, 260);
}

function setupRotate() {
  const btn = document.getElementById('rot');
  if (!btn) return;
  btn.addEventListener('click', (e) => { e.preventDefault(); toggleOrientation(); });
  paintRot();
  placeRot();
  window.addEventListener('resize', () => { placeRot(); paintRot(); });
  if (screen.orientation && screen.orientation.addEventListener) {
    screen.orientation.addEventListener('change', () => setTimeout(paintRot, 60));
  }
}

let touchBuilt = false;
let guardBtn = null;
let guardShown = false;
function buildTouch() {
  if (touchBuilt) return;
  if (!window.matchMedia('(pointer:coarse)').matches) return;
  touchBuilt = true;
  const acts = document.getElementById('acts');
  const order = ['jab', 'cross', 'jab-cross', 'combo1', 'lead-hook', 'rear-hook',
    'lead-uppercut', 'rear-uppercut', 'elbow', 'knee', 'kick', 'combo2-knee'];
  for (const name of order) {
    const b = document.createElement('button');
    b.textContent = TOUCH_LABEL[name] || name;
    b.addEventListener('pointerdown', (e) => { e.preventDefault(); game.player && game.player.attack(name); });
    acts.appendChild(b);
  }
  const guard = document.createElement('button');
  guard.textContent = 'GUARD';
  guard.className = 'wide';
  // Tap to hold the guard up, tap again to drop it. Holding the button down
  // would drop it the moment the thumb slides off (and phones fire pointerup
  // on any drift), so it is a latching toggle instead of press-and-hold.
  guard.addEventListener('click', (e) => {
    e.preventDefault();
    const p = game.player;
    if (!p) return;
    p.setGuard(!p.guarding);
    guard.classList.toggle('on', p.guarding);
  });
  guardBtn = guard;
  guardShown = false;
  acts.appendChild(guard);

  const taunt = document.createElement('button');
  taunt.textContent = 'TAUNT';
  taunt.className = 'wide';
  taunt.addEventListener('pointerdown', (e) => { e.preventDefault(); game.player && game.player.playTaunt(); });
  acts.appendChild(taunt);

  document.querySelectorAll('#dpad button[data-move]').forEach((b) => {
    const dir = b.dataset.move;
    const on = (e) => { e.preventDefault(); held[dir] = true; movement(); };
    const off = (e) => { e.preventDefault(); held[dir] = false; movement(); };
    b.addEventListener('pointerdown', on);
    b.addEventListener('pointerup', off);
    b.addEventListener('pointerleave', off);
    b.addEventListener('pointercancel', off);
  });

  document.getElementById('touch').classList.add('on');
  setupRotate();
}

/* ---------- loop ---------- */

const _camTarget = new THREE.Vector3(0, 1.02, 0);
function tick() {
  const realDt = Math.min(0.05, game.clock.getDelta());
  const now = performance.now();

  // the guard button is a latch — keep its lit state in step with the fighter
  // (rematch and knockdowns both drop the guard under it)
  if (guardBtn && game.player && game.player.guarding !== guardShown) {
    guardShown = game.player.guarding;
    guardBtn.classList.toggle('on', guardShown);
  }

  // hit-stop: the world (and the fighters' mixers) crawls for a few frames on
  // impact, while the FX and the camera keep running at full speed.
  let dt = realDt;
  if (stopT > 0) {
    stopT = Math.max(0, stopT - realDt);
    dt = realDt * 0.08;
  }

  if (game.started) {
    game.player.update(dt, now);
    game.foe.update(dt, now);
    game.ai.update(dt, game.player);

    // fighters always face each other
    for (const f of [game.player, game.foe]) {
      if (f.state === 'ko') continue;
      const other = f.foe;
      const dir = Math.sign(other.root.position.x - f.root.position.x) || 1;
      const want = dir > 0 ? Math.PI / 2 : -Math.PI / 2;
      f.root.rotation.y += (want - f.root.rotation.y) * Math.min(1, dt * 8);
    }

    // KO step-back: slide the pair apart before the ending clips start
    if (game.sep) {
      const s = game.sep;
      s.t += dt;
      const k = Math.min(1, s.t / s.dur);
      const e = 1 - Math.pow(1 - k, 3);   // ease-out
      game.player.root.position.x = s.p0 + (s.p1 - s.p0) * e;
      game.foe.root.position.x = s.f0 + (s.f1 - s.f0) * e;
      if (k >= 1) { game.sep = null; s.done(); }
    }

    // keep a minimum gap
    const gap = game.foe.root.position.x - game.player.root.position.x;
    const min = MIN_GAP;
    if (Math.abs(gap) < min) {
      const push = (min - Math.abs(gap)) / 2 * Math.sign(gap || 1);
      game.player.root.position.x -= push;
      game.foe.root.position.x += push;
      const max = MAX_GAP;
      const g2 = game.foe.root.position.x - game.player.root.position.x;
      if (Math.abs(g2) > max) {
        const back = (Math.abs(g2) - max) / 2 * Math.sign(g2);
        game.player.root.position.x += back;
        game.foe.root.position.x -= back;
      }
    }
    game.player.root.position.x = THREE.MathUtils.clamp(game.player.root.position.x, -ARENA_X, ARENA_X);
    game.foe.root.position.x = THREE.MathUtils.clamp(game.foe.root.position.x, -ARENA_X, ARENA_X);

    // clock
    const secs = Math.floor((now - game.t0) / 1000);
    document.getElementById('clock').textContent =
      `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`;

    if (new URLSearchParams(location.search).get('debug')) {
      document.getElementById('hint').textContent =
        `hp  ${game.player.name} ${game.player.hp}/${HP_MAX}  vs  ${game.foe.name} ${game.foe.hp}/${HP_MAX}` +
        `  |  states ${game.player.state}/${game.foe.state}  gap ${Math.abs(game.foe.root.position.x - game.player.root.position.x).toFixed(2)}` +
        `  |  ${JSON.stringify(LOG)}`;
    }
  }

  game.fx.update(realDt);
  if (game.ring) game.ring.update(game.camera, realDt);

  // camera: gentle follow of the pair + impact shake
  const midX = game.player ? (game.player.root.position.x + game.foe.root.position.x) / 2 : 0;
  _camTarget.set(midX * 0.35, 1.02, 0);
  game.camera.position.x += (0.55 + midX * 0.28 - game.camera.position.x) * Math.min(1, realDt * 3);
  game.camera.position.y += (camBaseY - game.camera.position.y) * Math.min(1, realDt * 3);
  game.camera.position.z += (camBaseZ - game.camera.position.z) * Math.min(1, realDt * 3);
  shakeT *= Math.pow(0.001, realDt);
  // impact kick: shove the camera along the punch, then let it spring back
  camKick.multiplyScalar(Math.pow(0.00035, realDt));
  game.camera.position.x += (Math.random() - 0.5) * shakeT + camKick.x;
  game.camera.position.y += (Math.random() - 0.5) * shakeT + camKick.y;
  game.camera.position.z += (Math.random() - 0.5) * shakeT * 0.5 + camKick.z;
  game.camera.lookAt(_camTarget);

  game.renderer.render(game.scene, game.camera);
}

boot();
window.__game = game;   // debug handle (harmless in production)
game.LOG = LOG;
game.setGap = (v) => { MIN_GAP = Math.max(0.3, Math.min(1.2, Number(v))); };
game.getGap = () => MIN_GAP;
