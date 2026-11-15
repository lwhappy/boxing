/* Boxing Training Game — /fight/game/ (index.html)
 *
 * Assets: ../../media/glb/boxer-man.glb + boxer-woman.glb
 *   each = 1 skinned boxer + 25 clips, exported from Blender at 30fps.
 *   clip: idle guard block hit-head hit-body defeat win taunt
 *         jab cross jab-cross combo1 lead-hook rear-hook
 *         lead-uppercut rear-uppercut elbow knee headbutt
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

const HP_MAX = 200;
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

/** t = seconds from clip start to the moment the strike lands (measured in Blender). */
const ATTACKS = {
  jab:             { dmg: 5,  t: [0.50],         limb: 'LeftHand',     label: 'Jab' },
  cross:           { dmg: 5,  t: [0.67],         limb: 'RightHand',    label: 'Cross' },
  'jab-cross':     { dmg: 5,  t: [0.37],         limb: 'LeftHand',     label: 'Jab-Cross' },
  combo1:          { dmg: 10, t: [0.50, 0.93],   limb: 'LeftHand',     label: 'Combo 1' },
  'lead-hook':     { dmg: 5,  t: [0.63],         limb: 'LeftHand',     label: 'Lead Hook' },
  'rear-hook':     { dmg: 5,  t: [0.73],         limb: 'RightHand',    label: 'Rear Hook' },
  'lead-uppercut': { dmg: 5,  t: [0.70],         limb: 'LeftHand',     label: 'Lead Uppercut' },
  'rear-uppercut': { dmg: 5,  t: [0.70],         limb: 'RightHand',    label: 'Rear Uppercut' },
  elbow:           { dmg: 5,  t: [0.67],         limb: 'RightForeArm', label: 'Elbow' },
  knee:            { dmg: 5,  t: [0.47, 0.93],   limb: 'RightLeg',     label: 'Knee' },
  headbutt:        { dmg: 5,  t: [0.87],         limb: 'Head',         label: 'Headbutt' },
  'combo2-knee':   { dmg: 15, t: [1.03, 2.40],   limb: 'LeftHand',     label: 'Combo 2' },
  'combo2-elbow':  { dmg: 15, t: [0.60, 2.97],   limb: 'LeftHand',     label: 'Combo 2' },
};

const KEY_ATTACK = {
  KeyY: 'jab', KeyU: 'cross', KeyI: 'jab-cross', KeyO: 'combo1', KeyP: 'combo2-knee',
  KeyH: 'combo2-elbow', KeyJ: 'lead-hook', KeyK: 'rear-hook', KeyL: 'lead-uppercut',
  KeyN: 'rear-uppercut', KeyM: 'elbow', Comma: 'headbutt', Period: 'knee',
};
const TOUCH_LABEL = {
  jab: 'JAB', cross: 'CROSS', 'jab-cross': 'JAB·CR', combo1: 'COMBO1',
  'lead-hook': 'L HOOK', 'rear-hook': 'R HOOK', 'lead-uppercut': 'L UPPER',
  'rear-uppercut': 'R UPPER', elbow: 'ELBOW', knee: 'KNEE', headbutt: 'HEAD',
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

class FX {
  constructor(scene) {
    this.scene = scene;
    this.pool = [];
    this.live = [];
    const geo = new THREE.RingGeometry(0.05, 0.075, 28);
    for (let i = 0; i < 8; i++) {
      const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
        color: 0xffe27a, transparent: true, opacity: 0, side: THREE.DoubleSide,
        depthWrite: false, blending: THREE.AdditiveBlending,
      }));
      m.visible = false;
      scene.add(m);
      this.pool.push(m);
    }
  }
  ring(pos, color = 0xffe27a, scale = 1) {
    const m = this.pool.pop();
    if (!m) return;
    m.material.color.setHex(color);
    m.position.copy(pos);
    m.visible = true;
    m.userData.t = 0;
    m.userData.scale = 0.55 * scale;
    m.scale.setScalar(0.55 * scale);
    m.lookAt(this.scene.userData.cam || pos.clone().add(new THREE.Vector3(0, 0, 1)));
    this.live.push(m);
  }
  spark(pos, color = 0xffffff) {
    const m = this.pool.pop();
    if (!m) return;
    m.material.color.setHex(color);
    m.position.copy(pos);
    m.visible = true;
    m.userData.t = 0;
    m.userData.scale = 0.34;
    m.scale.setScalar(0.34);
    this.live.push(m);
  }
  update(dt) {
    for (let i = this.live.length - 1; i >= 0; i--) {
      const m = this.live[i];
      m.userData.t += dt;
      const k = m.userData.t / 0.34;
      if (k >= 1) {
        m.visible = false; m.material.opacity = 0; this.live.splice(i, 1); this.pool.push(m);
        continue;
      }
      m.scale.setScalar(m.userData.scale + k * 1.5);
      m.material.opacity = (1 - k) * 0.9;
    }
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
    this.pending = info.t.map((t) => t);
    this.attackReturnAt = info.t[info.t.length - 1] * 0.92 + 0.42;
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
      if (this.pending.length && t < this.pending[0] * 0.85) {
        const fwd = this.side < 0 ? 1 : -1;
        this.root.position.x += fwd * 0.45 * dt;
      }
      while (this.pending.length && t >= this.pending[0]) {
        this.pending.shift();
        game.resolveStrike(this);
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

  // lighting: studio IBL + key + rim
  try {
    const pmrem = new THREE.PMREMGenerator(renderer);
    scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  } catch (e) { /* IBL optional */ }
  const hemi = new THREE.HemisphereLight(0xdce6ff, 0x1a1d22, 0.55);
  scene.add(hemi);
  const key = new THREE.DirectionalLight(0xffffff, 2.1);
  key.position.set(2.4, 4.2, 3.2);
  scene.add(key);
  const rim = new THREE.DirectionalLight(0x6ea8ff, 1.15);
  rim.position.set(-3, 2.6, -3.4);
  scene.add(rim);

  // ring floor
  const floor = new THREE.Mesh(
    new THREE.CircleGeometry(4.2, 64),
    new THREE.MeshStandardMaterial({ color: 0x15181d, roughness: 0.92, metalness: 0.04 }),
  );
  floor.rotation.x = -Math.PI / 2;
  scene.add(floor);

  const line = new THREE.Mesh(
    new THREE.RingGeometry(3.05, 3.12, 72),
    new THREE.MeshBasicMaterial({ color: 0x2c333c }),
  );
  line.rotation.x = -Math.PI / 2;
  line.position.y = 0.004;
  scene.add(line);

  const mat = new THREE.Mesh(
    new THREE.CircleGeometry(1.55, 48),
    new THREE.MeshStandardMaterial({ color: 0x1b2027, roughness: 0.85 }),
  );
  mat.rotation.x = -Math.PI / 2;
  mat.position.y = 0.002;
  scene.add(mat);

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
      loadGLB('../../media/glb/boxer-man.glb', prog),
      loadGLB('../../media/glb/boxer-woman.glb', prog),
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
      game.spam = true;
    }
  } catch (e) {
    st.textContent = 'could not load the fighters — ' + (e.message || 'network error') +
      ' · try a hard refresh (' + (navigator.platform.includes('Mac') ? '⌘⇧R' : 'Ctrl+F5') + ')';
    console.error(e);
  }

  renderer.setAnimationLoop(tick);
}

function onResize() {
  if (!game.renderer) return;
  const w = window.innerWidth, h = window.innerHeight;
  game.renderer.setSize(w, h);
  game.camera.aspect = w / h;
  const fov = w / h < 1 ? 52 : 38;
  game.camera.fov = fov;
  game.camera.updateProjectionMatrix();
}

/* ---------- strike resolution ---------- */

const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _v3 = new THREE.Vector3();
const _v4 = new THREE.Vector3();

game.resolveStrike = function (att) {
  const def = att.foe;
  if (!def || game.over) return;
  if (def.state === 'ko') return;
  const info = ATTACKS[att.attackName || ''];
  if (!info) return;

  const p = att.worldPoint(info.limb, _v1).clone();
  const gap = Math.abs(def.root.position.x - att.root.position.x);

  // out of range: swing and miss
  if (gap > 1.45) { log('whiff-far'); Sfx.whiff(); return; }

  const head = def.worldPoint('Head', _v2).clone().add(new THREE.Vector3(0, 0.06, 0));
  const chest = def.worldPoint('Spine2', _v3).clone();
  const lh = def.worldPoint('LeftHand', _v4).clone();
  const rh = def.worldPoint('RightHand', new THREE.Vector3()).clone();

  const dHead = p.distanceTo(head);
  const dChest = p.distanceTo(chest);
  const dGlove = Math.min(p.distanceTo(lh), p.distanceTo(rh));

  // glove contact = blocked, but only when the defender is actively covering up —
  // idle hands sit near the chin and would otherwise block everything
  const covering = def.state === 'guard' || def.state === 'block';
  if (covering && dGlove < 0.34) {
    log('block ' + att.attackName + ' dG=' + dGlove.toFixed(2));
    def.playBlock();
    Sfx.block();
    game.fx.spark(p, 0x9fd8ff);
    return;
  }

  let zone = null;
  if (dHead < 0.38) zone = 'head';
  else if (dChest < 0.48) zone = 'body';
  if (!zone) { log('whiff ' + att.attackName + ' dH=' + dHead.toFixed(2) + ' dC=' + dChest.toFixed(2) + ' dG=' + dGlove.toFixed(2)); Sfx.whiff(); return; }
  if (def.state === 'hit' && performance.now() < def.hitUntil) return;

  def.hp = Math.max(0, def.hp - info.dmg);
  def.playHit(zone);
  // haptic feedback when you're the one getting hit
  if (def === game.player && navigator.vibrate) { try { navigator.vibrate(zone === 'head' ? 45 : 30); } catch (e) {} }
  if (zone === 'head') { Sfx.punch(1.15); game.fx.ring(head, 0xffd76a, 1); }
  else { Sfx.body(); game.fx.ring(chest, 0xff9d6a, 1.1); }
  game.fx.spark(p, 0xffffff);
  updateHUD();
  shake(0.05);

  log(zone + ' ' + att.attackName + ' dmg ' + info.dmg);
  if (def.hp <= 0) endFight(att, def);
};

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
    document.getElementById('overKicker').textContent = won ? 'you win' : 'you lose';
    document.getElementById('overTitle').textContent = won ? 'Knockout!' : 'You hit the canvas';
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
  if (code === 'Semicolon') { e.preventDefault(); p.setGuard(down); return; }
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
    lockLandscape();
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

  // rotate prompt on phones
  const rot = document.getElementById('rotate');
  const checkRot = () => {
    const portrait = window.innerHeight > window.innerWidth;
    const coarse = window.matchMedia('(pointer:coarse)').matches;
    rot.classList.toggle('on', portrait && coarse && game.started);
  };
  window.addEventListener('resize', checkRot);
  window.addEventListener('orientationchange', () => setTimeout(checkRot, 250));
  setInterval(checkRot, 800);
}

function lockLandscape() {
  const root = document.documentElement;
  if (!window.matchMedia('(pointer:coarse)').matches) return;
  try {
    if (root.requestFullscreen) root.requestFullscreen({ navigationUI: 'hide' }).catch(() => {});
  } catch (e) {}
  try {
    if (screen.orientation && screen.orientation.lock) screen.orientation.lock('landscape').catch(() => {});
  } catch (e) {}
}

let touchBuilt = false;
function buildTouch() {
  if (touchBuilt) return;
  if (!window.matchMedia('(pointer:coarse)').matches) return;
  touchBuilt = true;
  const acts = document.getElementById('acts');
  const order = ['jab', 'cross', 'jab-cross', 'combo1', 'lead-hook', 'rear-hook',
    'lead-uppercut', 'rear-uppercut', 'elbow', 'knee', 'headbutt', 'combo2-knee'];
  for (const name of order) {
    const b = document.createElement('button');
    b.textContent = TOUCH_LABEL[name] || name;
    b.addEventListener('pointerdown', (e) => { e.preventDefault(); game.player && game.player.attack(name); });
    acts.appendChild(b);
  }
  const guard = document.createElement('button');
  guard.textContent = 'GUARD';
  guard.className = 'wide';
  guard.addEventListener('pointerdown', (e) => { e.preventDefault(); game.player && game.player.setGuard(true); });
  guard.addEventListener('pointerup', () => { game.player && game.player.setGuard(false); });
  guard.addEventListener('pointercancel', () => { game.player && game.player.setGuard(false); });
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
}

/* ---------- loop ---------- */

const _camTarget = new THREE.Vector3(0, 1.02, 0);
function tick() {
  const dt = Math.min(0.05, game.clock.getDelta());
  const now = performance.now();

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

  game.fx.update(dt);

  // camera: gentle follow of the pair + impact shake
  const midX = game.player ? (game.player.root.position.x + game.foe.root.position.x) / 2 : 0;
  _camTarget.set(midX * 0.35, 1.02, 0);
  game.camera.position.x += (0.55 + midX * 0.28 - game.camera.position.x) * Math.min(1, dt * 3);
  game.camera.position.y += (1.62 - game.camera.position.y) * Math.min(1, dt * 3);
  shakeT *= Math.pow(0.001, dt);
  game.camera.position.x += (Math.random() - 0.5) * shakeT;
  game.camera.position.y += (Math.random() - 0.5) * shakeT;
  game.camera.lookAt(_camTarget);

  game.renderer.render(game.scene, game.camera);
}

boot();
window.__game = game;   // debug handle (harmless in production)
game.LOG = LOG;
game.setGap = (v) => { MIN_GAP = Math.max(0.3, Math.min(1.2, Number(v))); };
game.getGap = () => MIN_GAP;
