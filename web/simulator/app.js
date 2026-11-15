/**
 * Heavy Bag Lab — a boxing simulator stage.
 *
 * - one fighter (media/glb/boxer-man.glb) working a static heavy bag
 * - every punch clip is measured at load time: the frame where the fist is
 *   furthest forward becomes the impact frame, and the bag is positioned so
 *   that the fist lands exactly on its surface
 * - on impact a light ring blooms on the bag, the bag takes a small
 *   spring-loaded sway, and the technique text types itself in — the clip keeps
 *   playing to the end, then falls back to the guard loop
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MOVES, MOVE_BY_ID } from './copy.js';

/* ------------------------------------------------------------------ utils */
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const lerp = (a, b, t) => a + (b - a) * t;
const damp = (a, b, lambda, dt) => lerp(a, b, 1 - Math.exp(-lambda * dt));
const rand = (a, b) => a + Math.random() * (b - a);
const mobile = () => window.matchMedia('(max-width: 900px)').matches;

/* ------------------------------------------------------------------ audio */
const Sound = {
  ctx: null, master: null, on: true, humGain: null,
  init() {
    if (this.ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.85;
    this.master.connect(this.ctx.destination);
    // shared echo for the "chirp" layer
    this.delay = this.ctx.createDelay(0.5);
    this.delay.delayTime.value = 0.11;
    this.fb = this.ctx.createGain();
    this.fb.gain.value = 0.26;
    this.delay.connect(this.fb); this.fb.connect(this.delay);
    this.delay.connect(this.master);
    this.startHum();
  },
  resume() { this.ctx && this.ctx.state === 'suspended' && this.ctx.resume(); },
  startHum() {
    const c = this.ctx;
    this.humGain = c.createGain();
    this.humGain.gain.value = 0.0001;
    const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 380;
    const o1 = c.createOscillator(); o1.type = 'sine'; o1.frequency.value = 55;
    const o2 = c.createOscillator(); o2.type = 'sine'; o2.frequency.value = 82.7;
    const g2 = c.createGain(); g2.gain.value = 0.35;
    const lfo = c.createOscillator(); lfo.type = 'sine'; lfo.frequency.value = 0.07;
    const lfoG = c.createGain(); lfoG.gain.value = 0.0009;
    o1.connect(lp); o2.connect(g2); g2.connect(lp); lp.connect(this.humGain);
    this.humGain.connect(this.master);
    lfo.connect(lfoG); lfoG.connect(this.humGain.gain);
    o1.start(); o2.start(); lfo.start();
    this.humGain.gain.setTargetAtTime(0.012, c.currentTime, 2.5);
  },
  noise(dur) {
    const c = this.ctx, n = Math.floor(c.sampleRate * dur);
    const b = c.createBuffer(1, n, c.sampleRate);
    const d = b.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
    const s = c.createBufferSource(); s.buffer = b; return s;
  },
  thud(power = 1) {
    if (!this.ctx || !this.on) return;
    const c = this.ctx, t = c.currentTime;
    const o = c.createOscillator(), g = c.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(96 * power, t);
    o.frequency.exponentialRampToValueAtTime(38, t + 0.22);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.62 * power, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.42);
    o.connect(g); g.connect(this.master); o.start(t); o.stop(t + 0.5);
    // leather crack
    const n = this.noise(0.16);
    const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 1150; bp.Q.value = 1.1;
    const ng = c.createGain();
    ng.gain.setValueAtTime(0.5 * power, t);
    ng.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);
    n.connect(bp); bp.connect(ng); ng.connect(this.master); n.start(t);
    // sub drop
    const s = c.createOscillator(), sg = c.createGain();
    s.type = 'triangle'; s.frequency.setValueAtTime(55, t); s.frequency.exponentialRampToValueAtTime(28, t + 0.5);
    sg.gain.setValueAtTime(0.0001, t); sg.gain.exponentialRampToValueAtTime(0.4, t + 0.02);
    sg.gain.exponentialRampToValueAtTime(0.0001, t + 0.6);
    s.connect(sg); sg.connect(this.master); s.start(t); s.stop(t + 0.65);
  },
  chirp(f = 2600, vol = 0.05) {
    if (!this.ctx || !this.on) return;
    const c = this.ctx, t = c.currentTime;
    const o = c.createOscillator(), g = c.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(f, t);
    o.frequency.exponentialRampToValueAtTime(f * rand(1.5, 2.1), t + 0.07);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.1);
    o.connect(g); g.connect(this.master); g.connect(this.delay);
    o.start(t); o.stop(t + 0.12);
  },
  sweep() {
    if (!this.ctx || !this.on) return;
    const c = this.ctx, t = c.currentTime;
    const n = this.noise(0.42);
    const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 3.2;
    bp.frequency.setValueAtTime(420, t); bp.frequency.exponentialRampToValueAtTime(4200, t + 0.34);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.13, t + 0.05);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.4);
    n.connect(bp); bp.connect(g); g.connect(this.master); n.start(t);
  },
  blip(f = 1500, vol = 0.045) {
    if (!this.ctx || !this.on) return;
    const c = this.ctx, t = c.currentTime;
    const o = c.createOscillator(), g = c.createGain();
    o.type = 'square'; o.frequency.value = f;
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.05);
    o.connect(g); g.connect(this.master); o.start(t); o.stop(t + 0.06);
  },
  click() {
    if (!this.ctx || !this.on) return;
    this.blip(920, 0.05);
    this.chirp(1800, 0.03);
  }
};

/* ------------------------------------------------------------------ stage */
const canvas = document.getElementById('stage');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, mobile() ? 1.6 : 1.9));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.02;

const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(0x04060a, 0.062);

const camera = new THREE.PerspectiveCamera(38, 1, 0.05, 90);
camera.position.set(3, 1.7, -1.8);
camera.lookAt(0, 1.0, 0.6);

/* lights — warm key, cold rim, red kicker, no shadow maps (cheap + clean) */
scene.add(new THREE.HemisphereLight(0x1e3c52, 0x04060a, 0.75));
const key = new THREE.DirectionalLight(0xfff0dd, 2.35); key.position.set(-2.6, 3.6, 3.4); scene.add(key);
const rim = new THREE.DirectionalLight(0x74dcff, 2.9); rim.position.set(2.8, 2.4, -2.8); scene.add(rim);
const kick = new THREE.DirectionalLight(0xff4a4a, 0.85); kick.position.set(3.4, 1.1, 2.4); scene.add(kick);
const bagLight = new THREE.PointLight(0x74dcff, 2.2, 4, 2); scene.add(bagLight);

/* ------------------------------------------------------------------ floor */
const FLOOR_SIZE = 34;
const floorMat = new THREE.ShaderMaterial({
  transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  uniforms: { uTime: { value: 0 }, uCol: { value: new THREE.Color(0x4fc8ee) }, uBag: { value: new THREE.Vector2(0, 1.1) } },
  vertexShader: `
    varying vec3 vP;
    void main(){ vP = (modelMatrix * vec4(position,1.0)).xyz;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
  fragmentShader: `
    uniform float uTime; uniform vec3 uCol; uniform vec2 uBag; varying vec3 vP;
    float gridLine(vec2 p, float s){
      vec2 q = p / s; vec2 g = abs(fract(q - 0.5) - 0.5) / fwidth(q);
      return 1.0 - min(min(g.x, g.y), 1.0);
    }
    void main(){
      float d = length(vP.xz - uBag);
      float fade = smoothstep(11.0, 1.0, d);
      float g = gridLine(vP.xz, 0.5) * 0.28 + gridLine(vP.xz, 2.5) * 0.55;
      float ph = fract(uTime * 0.18);
      float rp = ph * 7.0;
      float ring = smoothstep(0.10, 0.0, abs(d - rp)) * (1.0 - ph);
      float band = smoothstep(0.5, 0.0, abs(d - 2.4)) * 0.25;
      float a = (g * 0.5 + ring * 1.1 + band + 0.02) * fade;
      vec3 col = uCol * (g * 0.35 + ring * 0.9 + band * 0.6 + 0.02);
      col += vec3(0.06, 0.1, 0.15) * fade * 0.4;
      gl_FragColor = vec4(col, a * 0.95);
    }`
});
const floor = new THREE.Mesh(new THREE.PlaneGeometry(FLOOR_SIZE, FLOOR_SIZE, 1, 1), floorMat);
floor.rotation.x = -Math.PI / 2;
floor.position.y = 0.001;
scene.add(floor);

/* light pools under fighter + bag */
function poolTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(64, 64, 2, 64, 64, 62);
  grd.addColorStop(0, 'rgba(140,230,255,.85)');
  grd.addColorStop(0.45, 'rgba(90,190,230,.28)');
  grd.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grd; g.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(c);
}
const poolTex = poolTexture();
const poolMat = new THREE.MeshBasicMaterial({ map: poolTex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0.5 });
const fighterPool = new THREE.Mesh(new THREE.PlaneGeometry(2.1, 2.1), poolMat);
fighterPool.rotation.x = -Math.PI / 2; fighterPool.position.y = 0.004; scene.add(fighterPool);
const bagPool = new THREE.Mesh(new THREE.PlaneGeometry(2.0, 2.0), poolMat.clone());
bagPool.material.opacity = 0.62;
bagPool.rotation.x = -Math.PI / 2; bagPool.position.y = 0.004; scene.add(bagPool);

/* ------------------------------------------------------------------ dust */
const DUST = 420;
const dustGeo = new THREE.BufferGeometry();
const dustPos = new Float32Array(DUST * 3);
const dustSeed = new Float32Array(DUST);
for (let i = 0; i < DUST; i++) {
  const r = rand(0.4, 6.5), a = rand(0, Math.PI * 2);
  dustPos[i * 3] = Math.cos(a) * r;
  dustPos[i * 3 + 1] = rand(0.05, 3.1);
  dustPos[i * 3 + 2] = Math.sin(a) * r + 0.4;
  dustSeed[i] = rand(0, 100);
}
dustGeo.setAttribute('position', new THREE.BufferAttribute(dustPos, 3));
const dust = new THREE.Points(dustGeo, new THREE.PointsMaterial({
  size: 0.016, color: 0x9fdcf2, transparent: true, opacity: 0.5,
  blending: THREE.AdditiveBlending, depthWrite: false, sizeAttenuation: true
}));
scene.add(dust);

/* ------------------------------------------------------------------ rings */
const RING_MAT = () => new THREE.MeshBasicMaterial({ color: 0x7ae2ff, transparent: true, opacity: 0.22, blending: THREE.AdditiveBlending, depthWrite: false });
const orbiters = [];
function addOrbiter(radius, y, tilt, speed, opacity = 0.22, color = 0x7ae2ff) {
  const m = new THREE.Mesh(new THREE.TorusGeometry(radius, 0.0045, 6, 128), RING_MAT());
  m.material.color.setHex(color); m.material.opacity = opacity;
  m.position.y = y; m.rotation.x = Math.PI / 2 + tilt;
  scene.add(m);
  orbiters.push({ m, speed, base: m.rotation.z });
  return m;
}
const fighterRings = [
  addOrbiter(0.62, 0.28, rand(-0.13, 0.13), 0.22),
  addOrbiter(0.78, 1.05, rand(-0.2, 0.2), -0.14, 0.16),
  addOrbiter(0.95, 1.72, rand(-0.1, 0.1), 0.09, 0.1)
];

/* ------------------------------------------------------------------ bag */
const BAG = { r: 0.275, bottom: 0.36, top: 1.58, x: 0.05, z: 1.14 };
const bagRoot = new THREE.Group();
scene.add(bagRoot);

const metal = new THREE.MeshStandardMaterial({ color: 0x151a21, roughness: 0.42, metalness: 0.72 });
const dark = new THREE.MeshStandardMaterial({ color: 0x0d1117, roughness: 0.7, metalness: 0.25 });
const glow = (c, o = 1) => new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: o, blending: THREE.AdditiveBlending, depthWrite: false });

/* base plate */
const base = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.4, 0.09, 48), metal);
base.position.y = 0.045; bagRoot.add(base);
const baseRing = new THREE.Mesh(new THREE.TorusGeometry(0.35, 0.006, 6, 96), glow(0x7ae2ff, 0.55));
baseRing.rotation.x = Math.PI / 2; baseRing.position.y = 0.092; bagRoot.add(baseRing);

/* the tilting part: everything above the base pivots at the base */
const bagPivot = new THREE.Group();
bagPivot.position.y = BAG.bottom;
bagRoot.add(bagPivot);
const bagY = (y) => y - BAG.bottom;

const bodyH = BAG.top - BAG.bottom;
const body = new THREE.Mesh(new THREE.CylinderGeometry(BAG.r * 0.94, BAG.r, bodyH, 56, 1, false), new THREE.MeshStandardMaterial({
  color: 0x191e26, roughness: 0.52, metalness: 0.35
}));
body.position.y = bagY(BAG.bottom + bodyH / 2); bagPivot.add(body);

/* top dome + bottom skirt */
const dome = new THREE.Mesh(new THREE.SphereGeometry(BAG.r * 0.94, 48, 24, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x1b2129, roughness: 0.5, metalness: 0.4 }));
dome.position.y = bagY(BAG.top); dome.scale.y = 0.34; bagPivot.add(dome);

/* glowing seams */
for (const y of [0.52, 0.86, 1.2, 1.5]) {
  const ring = new THREE.Mesh(new THREE.TorusGeometry(BAG.r * 0.985, 0.0035, 6, 96), glow(0x63d8ff, y === 1.5 ? 0.5 : 0.22));
  ring.rotation.x = Math.PI / 2; ring.position.y = bagY(y); bagPivot.add(ring);
}
/* vertical seam */
const seam = new THREE.Mesh(new THREE.BoxGeometry(0.006, bodyH * 0.96, 0.006), glow(0x63d8ff, 0.28));
seam.position.set(0, bagY(BAG.bottom + bodyH / 2), BAG.r * 0.99); bagPivot.add(seam);

/* the collar / lid that receives uppercuts */
const collar = new THREE.Group();
bagPivot.add(collar);
const collarTopY = BAG.top + 0.035;
const collarRing = new THREE.Mesh(new THREE.TorusGeometry(BAG.r * 1.12, 0.028, 10, 72), new THREE.MeshStandardMaterial({ color: 0x222a34, roughness: 0.32, metalness: 0.9 }));
collarRing.rotation.x = Math.PI / 2;
const collarGlow = new THREE.Mesh(new THREE.TorusGeometry(BAG.r * 1.12, 0.008, 6, 72), glow(0x7ae2ff, 0.85));
collarGlow.rotation.x = Math.PI / 2;
const collarDisc = new THREE.Mesh(new THREE.CircleGeometry(BAG.r * 1.08, 48), glow(0x8fe8ff, 0.3));
collarDisc.rotation.x = Math.PI / 2; collarDisc.position.y = -0.004;
const collarDisc2 = new THREE.Mesh(new THREE.CircleGeometry(BAG.r * 1.08, 48), glow(0x8fe8ff, 0.14));
collarDisc2.rotation.x = -Math.PI / 2; collarDisc2.position.y = 0.004;
collar.add(collarRing, collarGlow, collarDisc, collarDisc2);
collar.position.y = bagY(collarTopY);
const studs = [];
for (let i = 0; i < 4; i++) {
  const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
  const s = new THREE.Mesh(new THREE.SphereGeometry(0.014, 10, 8), glow(0xffffff, 0.75));
  s.position.set(Math.cos(a) * BAG.r * 1.12, 0.012, Math.sin(a) * BAG.r * 1.12);
  collar.add(s); studs.push(s);
}

/* ruler marks down the side of the bag (measuring column) */
const rulerMat = glow(0x7ae2ff, 0.4);
for (let i = 0; i < 14; i++) {
  const y = 0.44 + i * 0.08;
  const long = i % 5 === 0;
  const t = new THREE.Mesh(new THREE.BoxGeometry(long ? 0.055 : 0.03, 0.0035, 0.0035), rulerMat);
  const a = -Math.PI * 0.32;
  t.position.set(Math.cos(a) * BAG.r * 1.005, bagY(y), Math.sin(a) * BAG.r * 1.005);
  t.rotation.y = -a;
  bagPivot.add(t);
}

/* impact ring pool — depthTest off: it reads as a holographic marker stamped
   over everything, so the contact point stays visible even when the fighter's
   own body crosses in front of the bag */
const rings = [];
for (let i = 0; i < 6; i++) {
  const m = new THREE.Mesh(new THREE.TorusGeometry(0.1, 0.012, 8, 64), glow(0xff6b6b, 0.9));
  m.material.depthTest = false;
  m.renderOrder = 90;
  m.visible = false; scene.add(m);
  rings.push({ m, life: 0 });
}
/* sparks */
const SPARKS = 64;
const sparkGeo = new THREE.BufferGeometry();
const sparkPos = new Float32Array(SPARKS * 3);
const sparkVel = new Float32Array(SPARKS * 3);
sparkGeo.setAttribute('position', new THREE.BufferAttribute(sparkPos, 3));
const sparkMat = new THREE.PointsMaterial({ size: 0.028, color: 0xffb3a0, transparent: true, opacity: 1, blending: THREE.AdditiveBlending, depthWrite: false });
const sparks = new THREE.Points(sparkGeo, sparkMat);
sparks.visible = false;
scene.add(sparks);
let sparkLife = 0;

/* ------------------------------------------------------------------ fighter */
let model, mixer, clips = {}, rig, handBones = {};
const MEASURE = {};        // id -> { impact, contact:Vector3, dur, delta:Vector3, radial:Vector3, dist }
const state = { id: null, action: null, impact: 0, hit: false, delta: new THREE.Vector3(), deltaCur: new THREE.Vector3() };

async function loadFighter() {
  const gltf = await new GLTFLoader().loadAsync('../media/glb/boxer-man.glb');
  model = gltf.scene;
  const box = new THREE.Box3().setFromObject(model);
  const h = box.max.y - box.min.y;
  const s = 1.78 / h;
  model.scale.setScalar(s);
  model.position.y = -box.min.y * s;
  rig = new THREE.Group();
  rig.add(model);
  scene.add(rig);

  mixer = new THREE.AnimationMixer(model);
  for (const c of gltf.animations) clips[c.name] = c;

  const bone = (n) => model.getObjectByName('mixamorig:' + n) || model.getObjectByName('mixamorig' + n) || model.getObjectByName(n);
  handBones.LeftHand = bone('LeftHand'); handBones.RightHand = bone('RightHand');
  handBones.LeftForeArm = bone('LeftForeArm'); handBones.RightForeArm = bone('RightForeArm');
  handBones.Head = bone('Head');

  model.updateMatrixWorld(true);
  measureAll();
  return s;
}

/** find the impact frame of each punch + where the fist actually is */
function measureAll() {
  const tmpA = new THREE.Vector3(), tmpB = new THREE.Vector3(), tmpC = new THREE.Vector3();
  const origin = new THREE.Vector3(0, 0, 0);
  mixer.stopAllAction();
  for (const mv of MOVES) {
    const clip = clips[mv.clip];
    if (!clip) continue;
    const act = mixer.clipAction(clip);
    act.reset().play();
    mixer.timeScale = 1;
    const hand = handBones[mv.hit];
    const fore = handBones[mv.hit ? mv.hit.replace('Hand', 'ForeArm') : 'LeftForeArm'];
    if (!hand) { act.stop(); continue; }
    let best = { z: -9, t: 0 };
    const N = 110;
    for (let i = 0; i <= N; i++) {
      const t = (clip.duration * i) / N;
      act.time = t;
      mixer.update(0);
      model.updateMatrixWorld(true);
      hand.getWorldPosition(tmpA);
      if (tmpA.z > best.z) best = { z: tmpA.z, t, p: tmpA.clone() };
    }
    // contact point = wrist pushed forward along the forearm axis (knuckles)
    act.time = best.t; mixer.update(0); model.updateMatrixWorld(true);
    hand.getWorldPosition(tmpA);
    if (fore) { fore.getWorldPosition(tmpB); tmpC.copy(tmpA).sub(tmpB).normalize(); } else tmpC.set(0, 0, 1);
    const contact = tmpA.clone().addScaledVector(tmpC, 0.155);
    MEASURE[mv.id] = { impact: best.t, dur: clip.duration, contact, wrist: tmpA.clone(), reach: contact.distanceTo(origin) };
    act.stop();
  }

  /* ---- bag placement: minimise the worst distance error over all punches ---- */
  const hitIds = MOVES.filter((m) => m.hit && MEASURE[m.id]).map((m) => m.id);
  const cx = hitIds.reduce((s, id) => s + MEASURE[id].contact.x, 0) / hitIds.length;
  BAG.x = cx;
  let bestZ = 1.1, bestErr = 99;
  for (let z = 0.7; z <= 1.5; z += 0.005) {
    let err = 0;
    for (const id of hitIds) {
      const c = MEASURE[id].contact;
      const d = Math.hypot(c.x - BAG.x, c.z - z);
      err = Math.max(err, Math.abs(d - BAG.r));
    }
    if (err < bestErr) { bestErr = err; bestZ = z; }
  }
  BAG.z = bestZ;

  /* ---- per-punch correction: slide the fighter in/out so the fist touches ---- */
  for (const id of hitIds) {
    const c = MEASURE[id].contact;
    const dx = c.x - BAG.x, dz = c.z - BAG.z;
    const d = Math.hypot(dx, dz) || 1;
    const over = clamp(d - BAG.r, -0.22, 0.22);
    MEASURE[id].delta = new THREE.Vector3((-dx / d) * over, 0, (-dz / d) * over);
    MEASURE[id].radial = new THREE.Vector3(dx / d, 0, dz / d);
  }

  bagRoot.position.set(BAG.x, 0, BAG.z);
  bagLight.position.set(BAG.x, 1.35, BAG.z + 0.35);
  floorMat.uniforms.uBag.value.set(BAG.x, BAG.z);
  bagPool.position.set(BAG.x, 0.004, BAG.z);
  bagPool.scale.setScalar(1.35);
  ringBag.forEach((r, i) => { r.m.position.set(BAG.x, 0.55 + i * 0.42, BAG.z); });
}

/* rings that circle the bag */
const ringBag = [];
for (let i = 0; i < 3; i++) {
  const m = new THREE.Mesh(new THREE.TorusGeometry(BAG.r * 1.55, 0.0035, 6, 96), RING_MAT());
  m.material.opacity = 0.2 - i * 0.05;
  m.rotation.x = Math.PI / 2 + (i - 1) * 0.18;
  scene.add(m);
  ringBag.push({ m, speed: 0.18 * (i % 2 ? -1 : 1), base: m.rotation.z });
}

/* ------------------------------------------------------------------ impact fx */
function impactFX(point, normal) {
  // ring on the surface — billboarded and nudged toward the camera so a
  // side-on view can never hide it behind the bag's own curve
  const slot = rings.find((r) => r.life <= 0) || rings[0];
  slot.life = 1;
  slot.m.visible = true;
  const toCam = new THREE.Vector3().subVectors(camera.position, point).normalize();
  slot.m.position.copy(point).addScaledVector(toCam, 0.07);
  slot.m.quaternion.copy(camera.quaternion);
  slot.m.scale.setScalar(0.35);
  slot.m.material.opacity = 1;
  // sparks
  for (let i = 0; i < SPARKS; i++) {
    sparkPos[i * 3] = point.x; sparkPos[i * 3 + 1] = point.y; sparkPos[i * 3 + 2] = point.z;
    const sp = rand(0.6, 2.4);
    const dir = normal.clone().multiplyScalar(rand(0.4, 1)).add(new THREE.Vector3(rand(-0.7, 0.7), rand(-0.4, 0.9), rand(-0.7, 0.7))).normalize();
    sparkVel[i * 3] = dir.x * sp; sparkVel[i * 3 + 1] = dir.y * sp + 0.7; sparkVel[i * 3 + 2] = dir.z * sp;
  }
  sparkGeo.attributes.position.needsUpdate = true;
  sparkLife = 1; sparks.visible = true;
  // screen flash + shake
  const flash = document.getElementById('flash');
  flash.classList.remove('hit'); void flash.offsetWidth; flash.classList.add('hit');
  shake = 0.05;
}

let shake = 0;
let hitGlow = 0;

/* ------------------------------------------------------------------ playing */
const panel = document.getElementById('panel');
const nodesEl = document.getElementById('nodes');
const stNode = document.getElementById('stNode');
const stReach = document.getElementById('stReach');
const stImpact = document.getElementById('stImpact');

let typingTimer = null;

function clearPanel() {
  document.getElementById('pBody').innerHTML = '';
  if (typingTimer) { clearTimeout(typingTimer); typingTimer = null; }
}

function words(html) { return html.split(/\s+/).filter(Boolean); }

function typeSection(label, text, delayStart, out) {
  const sec = document.createElement('div');
  sec.className = 'sec';
  const b = document.createElement('b'); b.textContent = label; sec.appendChild(b);
  const p = document.createElement('p');
  let i = 0;
  for (const w of words(text)) {
    const s = document.createElement('span');
    s.className = 'w'; s.textContent = w + ' ';
    s.style.animationDelay = delayStart + i * 16 + 'ms';
    p.appendChild(s); i++;
  }
  sec.appendChild(p); out.appendChild(sec);
  return i;
}

function typeList(label, arr, delayStart, out) {
  const sec = document.createElement('div');
  sec.className = 'sec';
  const b = document.createElement('b'); b.textContent = label; sec.appendChild(b);
  const ul = document.createElement('ul');
  let n = 0;
  for (const item of arr) {
    const li = document.createElement('li');
    let i = 0;
    for (const w of words(item)) {
      const s = document.createElement('span');
      s.className = 'w'; s.textContent = w + ' ';
      s.style.animationDelay = delayStart + (n + i) * 16 + 'ms';
      li.appendChild(s); i++;
    }
    n += i; ul.appendChild(li);
  }
  sec.appendChild(ul); out.appendChild(sec);
  return n;
}

function moveTitle(mv) { return mv.name === mv.em ? `<em>${mv.em}</em>` : `${mv.name} <em>${mv.em}</em>`; }

function showPanel(mv, measured) {
  clearPanel();
  document.getElementById('pCode').textContent = mv.code;
  document.getElementById('pTag').textContent = mv.tag;
  document.getElementById('pName').innerHTML = moveTitle(mv);
  document.getElementById('pSub').textContent = mv.sub;
  const body = document.getElementById('pBody');
  let n = 0;
  n += typeSection('what it is', mv.what, 0, body);
  n += typeList('key points', mv.points, 260 + n * 16, body);
  n += typeSection('when to use it', mv.use, 520 + n * 16, body);

  stNode.textContent = mv.code;
  if (measured) {
    stReach.textContent = measured.reach.toFixed(2) + ' m';
    stImpact.textContent = measured.impact.toFixed(2) + ' s';
  } else {
    stReach.textContent = '—';
    stImpact.textContent = '—';
  }
  document.getElementById('pFoot').textContent = measured
    ? `clip ${measured.dur.toFixed(2)}s · impact @ ${measured.impact.toFixed(2)}s`
    : 'loop · hold the line';

  panel.classList.add('on');
  panel.scrollTop = 0;
  body.scrollTop = 0;

  // sound design for the reveal
  Sound.sweep();
  const total = n;
  const step = Math.max(4, Math.round(total / 14));
  for (let i = 0; i < total; i += step) {
    setTimeout(() => Sound.chirp(rand(2100, 3600), 0.035), 120 + i * 16);
  }
  for (const el of document.querySelectorAll('.node')) el.classList.toggle('on', el.dataset.id === mv.id);
}

function play(id, { silent = false, panel: showPanelToo = true } = {}) {
  const mv = MOVE_BY_ID[id];
  if (!mv || !mixer) return;
  const clip = clips[mv.clip];
  if (!clip) return;

  const prev = state.action;
  const act = mixer.clipAction(clip);
  act.reset();
  act.enabled = true;
  act.setEffectiveTimeScale(1);
  act.setEffectiveWeight(1);
  if (mv.loop) { act.setLoop(THREE.LoopRepeat, Infinity); act.clampWhenFinished = false; }
  else { act.setLoop(THREE.LoopOnce, 1); act.clampWhenFinished = true; }
  act.fadeIn(0.14).play();
  if (prev && prev !== act) prev.fadeOut(0.14);

  state.id = id;
  state.action = act;
  state.hit = false;
  state.impact = mv.hit ? MEASURE[id].impact : 0;
  state.delta.copy(mv.hit ? MEASURE[id].delta : new THREE.Vector3());
  mixer.timeScale = 1;

  if (!silent) Sound.click();
  if (showPanelToo) showPanel(mv, mv.hit ? MEASURE[id] : null);
}

function fireImpact() {
  const m = MEASURE[state.id];
  if (!m) return;
  model.updateMatrixWorld(true);

  // contact + normal
  const contact = m.contact.clone().add(state.deltaCur);
  const n = m.radial ? m.radial.clone() : new THREE.Vector3(0, 0, 1);
  const isUpper = /uppercut/.test(state.id);
  const point = isUpper
    ? new THREE.Vector3(contact.x, collar.position.y + BAG.bottom - 0.02, contact.z)
    : new THREE.Vector3(BAG.x + n.x * BAG.r, contact.y, BAG.z + n.z * BAG.r);
  // uppercut rings face up-and-out so they stay visible from the camera
  impactFX(point, isUpper ? n.clone().multiplyScalar(0.85).add(new THREE.Vector3(0, 0.55, 0)) : n);

  // bag sway
  const dir = isUpper ? new THREE.Vector3(0, 0, 0) : n.clone();
  sway.vz += -dir.z * 2.6 + rand(-0.2, 0.2);
  sway.vx += -dir.x * 2.6 + rand(-0.2, 0.2);

  hitGlow = 2.1;
  Sound.thud(clamp(0.75 + (m.reach - 1.2) * 0.5, 0.7, 1.25));
}

/* ------------------------------------------------------------------ nodes */
function buildNodes() {
  for (const mv of MOVES) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'node' + (mv.id === 'guard' ? ' guard' : '');
    b.dataset.id = mv.id;
    b.innerHTML = `<span class="tick"></span><span class="code">${mv.code}</span><span class="nm">${mv.name === mv.em ? mv.em : `${mv.name} ${mv.em}`}<small>${mv.tag}</small></span>`;
    b.addEventListener('click', () => { Sound.resume(); play(mv.id); });
    b.addEventListener('pointerenter', () => Sound.blip(1350, 0.02));
    nodesEl.appendChild(b);
  }
  placeNodes();
}

function placeNodes() {
  const m = mobile();
  for (const mv of MOVES) {
    const b = nodesEl.querySelector(`.node[data-id="${mv.id}"]`);
    if (!b) continue;
    b.style.left = b.style.top = b.style.right = b.style.bottom = '';
    const p = m ? mv.posM : mv.pos;
    for (const k in p) b.style[k] = p[k];
  }
}

/* ------------------------------------------------------------ fixed camera */
/* The face that gets punched always looks back at the fighter, so the lens has
   to sit on the fighter's side of the bag — put it anywhere past the bag and
   the bag body swallows every contact. One fixed diagonal shot does the job:
   the bag sits upper-left, the fighter lower-right, and the lens stands ~55°
   off the fighter→bag axis so the striking face is turned toward it. */
const camTarget = { pos: new THREE.Vector3(), look: new THREE.Vector3() };
const lookCur = new THREE.Vector3();
const camPos = new THREE.Vector3();

function frameStage(o = {}) {
  const m = mobile();
  const theta = (o.theta ?? 55) * Math.PI / 180;
  const D = o.D ?? (m ? 4.6 : 3.6);           // lens → bag
  const H = o.H ?? 1.8;                       // lens height
  const aimY = o.aimY ?? 1.0;
  const pan = o.pan ?? (m ? -0.12 : -0.1);    // slide the pair away from the panel

  const pos = new THREE.Vector3(BAG.x + Math.sin(theta) * D, H, BAG.z - Math.cos(theta) * D);
  const aim = new THREE.Vector3(BAG.x * 0.55, aimY, BAG.z * 0.55);
  const fwd = aim.clone().sub(pos).normalize();
  const right = new THREE.Vector3().crossVectors(fwd, new THREE.Vector3(0, 1, 0)).normalize();
  const look = aim.clone().addScaledVector(right, pan);

  camTarget.pos.copy(pos);
  camTarget.look.copy(look);
  camPos.copy(pos);
  lookCur.copy(look);
  camera.position.copy(pos);
  camera.lookAt(look);
}

/* ------------------------------------------------------------------ loop */
const sway = { vx: 0, vz: 0, x: 0, z: 0 };
const clock = new THREE.Clock();
let t0 = 0;

function tick() {
  const dt = Math.min(clock.getDelta(), 0.05);
  t0 += dt;

  // collar eases to its target height (down for uppercuts, top otherwise)
  const mv = state.id ? MOVE_BY_ID[state.id] : null;
  const upper = !!mv && /uppercut/.test(mv.id) && !!MEASURE[mv.id];
  const targetCollarY = upper ? MEASURE[mv.id].contact.y + 0.03 : collarTopY;
  // snaps down fast to meet the fist, drifts back up once the strike is over
  collar.position.y = damp(collar.position.y, bagY(targetCollarY), upper ? 20 : 8, dt);

  // fighter slides in/out for the strike
  state.deltaCur.x = damp(state.deltaCur.x, state.delta.x, 9, dt);
  state.deltaCur.z = damp(state.deltaCur.z, state.delta.z, 9, dt);
  if (rig) { rig.position.x = state.deltaCur.x; rig.position.z = state.deltaCur.z; }

  // impact: fire once, but never interrupt the clip — it plays through
  if (state.action && state.impact > 0 && !state.hit && state.action.time >= state.impact) {
    state.hit = true;
    fireImpact();
  }

  if (mixer) mixer.update(dt);

  // finished punch → back to guard (keep the technique panel on screen)
  if (state.action && !mv?.loop && state.action.time >= state.action.getClip().duration - 0.02) {
    if (!state.returning) { state.returning = true; play('guard', { silent: true, panel: false }); state.returning = false; }
  }

  // bag sway spring
  const K = 42, C = 5.2;
  const ax = -K * sway.x - C * sway.vx;
  const az = -K * sway.z - C * sway.vz;
  sway.vx += ax * dt; sway.vz += az * dt;
  sway.x += sway.vx * dt; sway.z += sway.vz * dt;
  bagPivot.rotation.z = sway.x * 0.16;
  bagPivot.rotation.x = sway.z * 0.16;

  // rings + dust + floor
  for (const o of orbiters) o.m.rotation.z = o.base + t0 * o.speed;
  for (const r of ringBag) {
    r.m.rotation.z = r.base + t0 * r.speed;
    r.m.position.y = 0.55 + ((Math.sin(t0 * 0.6 + r.base * 4) + 1) / 2) * 0.95;
  }
  floorMat.uniforms.uTime.value = t0;
  dust.rotation.y = t0 * 0.012;
  dust.material.opacity = 0.38 + Math.sin(t0 * 0.8) * 0.08;
  bagLight.intensity = 2.0 + Math.sin(t0 * 2.2) * 0.25 + hitGlow;
  hitGlow = Math.max(0, hitGlow - dt * 2.4);

  // impact rings
  for (const r of rings) {
    if (r.life > 0) {
      r.life -= dt * 1.7;
      const k = 1 - r.life;
      r.m.scale.setScalar(0.35 + k * 3.4);
      r.m.material.opacity = Math.max(0, r.life) * 0.95;
      if (r.life <= 0) r.m.visible = false;
    }
  }
  // sparks
  if (sparkLife > 0) {
    sparkLife -= dt * 1.35;
    for (let i = 0; i < SPARKS; i++) {
      sparkVel[i * 3 + 1] -= 3.6 * dt;
      sparkPos[i * 3] += sparkVel[i * 3] * dt;
      sparkPos[i * 3 + 1] += sparkVel[i * 3 + 1] * dt;
      sparkPos[i * 3 + 2] += sparkVel[i * 3 + 2] * dt;
    }
    sparkGeo.attributes.position.needsUpdate = true;
    sparkMat.opacity = Math.max(0, sparkLife);
    if (sparkLife <= 0) sparks.visible = false;
  }

  // camera: fixed diagonal, only a slow breath of drift + hit shake
  const drift = mobile() ? 0.05 : 0.1;
  const k = 1 - Math.exp(-6.5 * dt);
  camPos.lerp(camTarget.pos, k);
  lookCur.lerp(camTarget.look, k);
  camera.position.copy(camPos);
  camera.position.x += Math.sin(t0 * 0.22) * drift;
  camera.position.y += Math.sin(t0 * 0.31) * drift * 0.5;
  if (shake > 0.0005) {
    camera.position.x += rand(-shake, shake);
    camera.position.y += rand(-shake, shake);
    shake *= 0.86;
  }
  camera.lookAt(lookCur);

  renderer.render(scene, camera);
  requestAnimationFrame(tick);
}

/* ------------------------------------------------------------------ boot */
function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.fov = mobile() ? 48 : 38;
  camera.updateProjectionMatrix();
  frameStage();
  placeNodes();
}
window.addEventListener('resize', resize);

resize();
buildNodes();
tick();

loadFighter().then(() => {
  bagRoot.position.set(BAG.x, 0, BAG.z);
  frameStage();
  // land straight in the guard loop with the stance notes already on screen —
  // no gate, no start button
  play('guard', { silent: true });
  setTimeout(() => Sound.sweep(), 700);
}).catch((e) => {
  console.error(e);
  const body = document.getElementById('pBody');
  if (body) body.innerHTML = '<div class="sec"><p>Failed to load the fighter — try a hard refresh (⌘⇧R).</p></div>';
});

/* browsers only allow audio after a gesture — arm it on the first one */
const armSound = () => { Sound.init(); Sound.resume(); };
for (const evName of ['pointerdown', 'keydown', 'touchstart']) {
  window.addEventListener(evName, armSound, { once: true, passive: true });
}

document.getElementById('sound').addEventListener('click', (e) => {
  Sound.on = !Sound.on;
  if (Sound.on) { Sound.init(); Sound.resume(); Sound.blip(1200, 0.04); }
  e.currentTarget.textContent = 'SOUND · ' + (Sound.on ? 'ON' : 'OFF');
});

window.addEventListener('keydown', (e) => {
  const i = parseInt(e.key, 10);
  if (i >= 0 && i <= 6) play(MOVES[i].id);
});

/* debug hook for QA */
window.__sim = {
  play, state, MEASURE, BAG, camera, scene, camTarget, frameStage,
  /** screen-space position (0..1, origin top-left) of world points */
  proj: (pts) => {
    const out = {};
    for (const [k, p] of Object.entries(pts)) {
      const v = new THREE.Vector3(p[0], p[1], p[2]).project(camera);
      out[k] = [+(v.x * 0.5 + 0.5).toFixed(3), +(-v.y * 0.5 + 0.5).toFixed(3)];
    }
    return out;
  },
  /** re-frame the fixed camera (QA tuning) */
  frame: (o) => frameStage(o || {}),
  /** re-stage the fighter at a given yaw (deg) and re-solve the bag placement */
  setYaw: (deg) => {
    if (!rig) return;
    rig.rotation.y = THREE.MathUtils.degToRad(deg);
    rig.updateMatrixWorld(true);
    measureAll();
    play('guard', { silent: true, panel: false });
  },
  /** freeze exactly on a punch's impact frame (QA screenshots only) */
  holdAt: (id) => {
    const mv = MOVE_BY_ID[id], m = MEASURE[id];
    if (!mv || !m) return;
    state.id = id;
    state.delta.copy(m.delta); state.deltaCur.copy(m.delta);
    if (rig) { rig.position.x = m.delta.x; rig.position.z = m.delta.z; }
    collar.position.y = bagY((/uppercut/.test(id) ? m.contact.y + 0.03 : collarTopY));
    mixer.stopAllAction();
    const act = mixer.clipAction(clips[mv.clip]);
    act.reset(); act.enabled = true;
    act.setEffectiveWeight(1); act.setEffectiveTimeScale(1);
    act.play(); act.time = m.impact;
    state.action = act; state.hit = true;
    mixer.update(0); model.updateMatrixWorld(true);
    mixer.timeScale = 0;
    fireImpact();
  },
  go: () => { if (mixer) mixer.timeScale = 1; },
  view: (x, y, z, lx, ly, lz) => {
    camTarget.pos.set(x, y, z); camTarget.look.set(lx, ly, lz);
    camPos.set(x, y, z);
    camera.position.set(x, y, z); lookCur.set(lx, ly, lz);
    camera.lookAt(lookCur);
  },
  dump: () => JSON.stringify({
    bag: BAG,
    moves: Object.fromEntries(Object.entries(MEASURE).map(([k, v]) => [k, {
      impact: +v.impact.toFixed(3), dur: +v.dur.toFixed(3), reach: +v.reach.toFixed(3),
      contact: [+v.contact.x.toFixed(3), +v.contact.y.toFixed(3), +v.contact.z.toFixed(3)],
      delta: [+v.delta.x.toFixed(3), +v.delta.z.toFixed(3)]
    }]))
  })
};
