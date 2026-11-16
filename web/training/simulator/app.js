/**
 * Rain Yard — a boxing simulator stage.
 *
 * - an outdoor yard at night, heavy rain, wet ground, a heavy bag on a steel base
 * - every punch clip is measured at load time: the frame where the fist is
 *   furthest forward becomes the impact frame
 * - the fighter steps (parallel shift + in/out) so the knuckles stop exactly on
 *   the near face of the bag — never through it, never on the far side
 * - on impact: water bursts off the bag, the sky cracks with lightning, thunder
 *   rolls in, the bag swings, and the technique notes type themselves in
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MOVES, MOVE_BY_ID } from './copy.js';

/* ------------------------------------------------------------------ utils */
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const lerp = (a, b, t) => a + (b - a) * t;
const damp = (a, b, lambda, dt) => lerp(a, b, 1 - Math.exp(-lambda * dt));
const rand = (a, b) => a + Math.random() * (b - a);
const smooth = (t) => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };
const mobile = () => window.matchMedia('(max-width: 900px)').matches;

/* ------------------------------------------------------------------ audio */
const Sound = {
  ctx: null, master: null, on: true, rainGain: null, _brown: null,
  init() {
    if (this.ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.9;
    this.master.connect(this.ctx.destination);
    // a long-ish echo for splashes, so the yard feels like a yard
    this.delay = this.ctx.createDelay(0.6);
    this.delay.delayTime.value = 0.19;
    this.fb = this.ctx.createGain(); this.fb.gain.value = 0.22;
    this.delay.connect(this.fb); this.fb.connect(this.delay);
    const wet = this.ctx.createGain(); wet.gain.value = 0.5;
    this.delay.connect(wet); wet.connect(this.master);
    this.startRain();
  },
  /* resume is attempted on every interaction; a rejected promise (browser
     autoplay policy) must never surface as an unhandled rejection */
  resume() {
    if (!this.ctx || this.ctx.state !== 'suspended') return;
    try {
      const p = this.ctx.resume();
      if (p && p.catch) p.catch(() => {});
    } catch {}
  },
  noiseBuffer(dur, brown) {
    const c = this.ctx, n = Math.floor(c.sampleRate * dur);
    const b = c.createBuffer(2, n, c.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = b.getChannelData(ch);
      let last = 0;
      for (let i = 0; i < n; i++) {
        const w = Math.random() * 2 - 1;
        if (brown) { last = (last + 0.02 * w) / 1.02; d[i] = last * 3.4; }
        else d[i] = w;
      }
    }
    return b;
  },
  brown() { return (this._brown = this._brown || this.noiseBuffer(4, true)); },
  src(buf) { const s = this.ctx.createBufferSource(); s.buffer = buf; return s; },
  startRain() {
    const c = this.ctx, s = this.src(this.brown());
    s.loop = true;
    const hp = c.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 420;
    const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 8200;
    this.rainGain = c.createGain(); this.rainGain.gain.value = 0.0001;
    s.connect(hp); hp.connect(lp); lp.connect(this.rainGain); this.rainGain.connect(this.master);
    s.start();
    this.rainGain.gain.setTargetAtTime(0.062, c.currentTime, 2.4);
    const lfo = c.createOscillator(); lfo.frequency.value = 0.055;
    const lg = c.createGain(); lg.gain.value = 0.018;
    lfo.connect(lg); lg.connect(this.rainGain.gain); lfo.start();
  },
  /* wet fist on wet leather */
  impact(power = 1) {
    if (!this.ctx || !this.on) return;
    const c = this.ctx, t = c.currentTime;
    const o = c.createOscillator(), g = c.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(115 * power, t);
    o.frequency.exponentialRampToValueAtTime(33, t + 0.26);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.8 * power, t + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.52);
    o.connect(g); g.connect(this.master); o.start(t); o.stop(t + 0.56);

    const n1 = this.src(this.noiseBuffer(0.24));
    const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 720; bp.Q.value = 0.8;
    const g1 = c.createGain();
    g1.gain.setValueAtTime(0.7 * power, t);
    g1.gain.exponentialRampToValueAtTime(0.0001, t + 0.22);
    n1.connect(bp); bp.connect(g1); g1.connect(this.master); g1.connect(this.delay); n1.start(t);

    const n2 = this.src(this.noiseBuffer(0.6));
    const hp = c.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 1500;
    const g2 = c.createGain();
    g2.gain.setValueAtTime(0.0001, t);
    g2.gain.exponentialRampToValueAtTime(0.34 * power, t + 0.014);
    g2.gain.exponentialRampToValueAtTime(0.0001, t + 0.46);
    n2.connect(hp); hp.connect(g2); g2.connect(this.master); g2.connect(this.delay); n2.start(t);

    const s = c.createOscillator(), sg = c.createGain();
    s.type = 'triangle';
    s.frequency.setValueAtTime(58, t); s.frequency.exponentialRampToValueAtTime(24, t + 0.7);
    sg.gain.setValueAtTime(0.0001, t);
    sg.gain.exponentialRampToValueAtTime(0.5, t + 0.02);
    sg.gain.exponentialRampToValueAtTime(0.0001, t + 0.8);
    s.connect(sg); sg.connect(this.master); s.start(t); s.stop(t + 0.85);
  },
  thunder(delay = 0.15, power = 1) {
    if (!this.ctx || !this.on) return;
    const c = this.ctx, t = c.currentTime + delay;
    const nc = this.src(this.noiseBuffer(0.3));
    const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 2100; bp.Q.value = 0.5;
    const gc = c.createGain();
    gc.gain.setValueAtTime(0.34 * power, t);
    gc.gain.exponentialRampToValueAtTime(0.0001, t + 0.3);
    nc.connect(bp); bp.connect(gc); gc.connect(this.master); nc.start(t);

    const nr = this.src(this.brown());
    const lp = c.createBiquadFilter(); lp.type = 'lowpass';
    lp.frequency.setValueAtTime(360, t);
    lp.frequency.exponentialRampToValueAtTime(72, t + 3.4);
    const gr = c.createGain();
    gr.gain.setValueAtTime(0.0001, t);
    gr.gain.exponentialRampToValueAtTime(0.55 * power, t + 0.16);
    gr.gain.exponentialRampToValueAtTime(0.0001, t + 3.6);
    nr.connect(lp); lp.connect(gr); gr.connect(this.master); nr.start(t); nr.stop(t + 3.7);
  },
  /* boots on wet concrete */
  step() {
    if (!this.ctx || !this.on) return;
    const c = this.ctx, t = c.currentTime;
    const n = this.src(this.noiseBuffer(0.22));
    const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 1100; bp.Q.value = 1.1;
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.14, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.2);
    n.connect(bp); bp.connect(g); g.connect(this.master); n.start(t);
  },
  /* dull knock for the UI */
  tap() {
    if (!this.ctx || !this.on) return;
    const c = this.ctx, t = c.currentTime;
    const o = c.createOscillator(), g = c.createGain();
    o.type = 'sine'; o.frequency.setValueAtTime(320, t); o.frequency.exponentialRampToValueAtTime(120, t + 0.09);
    g.gain.setValueAtTime(0.15, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.12);
    o.connect(g); g.connect(this.master); o.start(t); o.stop(t + 0.14);
  },
  drop() {
    if (!this.ctx || !this.on) return;
    const c = this.ctx, t = c.currentTime;
    const o = c.createOscillator(), g = c.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(rand(900, 1500), t);
    o.frequency.exponentialRampToValueAtTime(rand(280, 420), t + 0.07);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.05, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.12);
    o.connect(g); g.connect(this.master); g.connect(this.delay); o.start(t); o.stop(t + 0.14);
  },
  /* low swell under the text reveal */
  swell() {
    if (!this.ctx || !this.on) return;
    const c = this.ctx, t = c.currentTime;
    const n = this.src(this.noiseBuffer(1.4));
    const lp = c.createBiquadFilter(); lp.type = 'lowpass';
    lp.frequency.setValueAtTime(120, t);
    lp.frequency.exponentialRampToValueAtTime(900, t + 0.7);
    lp.frequency.exponentialRampToValueAtTime(150, t + 1.3);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.13, t + 0.35);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 1.35);
    n.connect(lp); lp.connect(g); g.connect(this.master); n.start(t);
  }
};

/* ------------------------------------------------------------------ stage */
const canvas = document.getElementById('stage');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, mobile() ? 1.5 : 1.8));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.32;

const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(0x121c26, 0.033);

const camera = new THREE.PerspectiveCamera(40, 1, 0.05, 200);
camera.position.set(3, 1.8, -1.6);
camera.lookAt(0, 1.0, 0.8);

/* soft grey environment so wet surfaces have something to reflect */
{
  const pmrem = new THREE.PMREMGenerator(renderer);
  const es = new THREE.Scene();
  es.add(new THREE.Mesh(new THREE.SphereGeometry(12, 24, 16), new THREE.MeshBasicMaterial({ color: 0x223140, side: THREE.BackSide })));
  const skyPatch = new THREE.Mesh(new THREE.PlaneGeometry(9, 5), new THREE.MeshBasicMaterial({ color: 0x9fb8cc }));
  skyPatch.position.set(1, 7, -3); skyPatch.lookAt(0, 0, 0); es.add(skyPatch);
  const warm = new THREE.Mesh(new THREE.PlaneGeometry(3, 2), new THREE.MeshBasicMaterial({ color: 0xffa055 }));
  warm.position.set(7, 2, 4); warm.lookAt(0, 1, 0); es.add(warm);
  scene.environment = pmrem.fromScene(es, 0.05).texture;
  pmrem.dispose();
}

/* ------------------------------------------------------------------ sky */
const skyUniforms = {
  uTime: { value: 0 }, uFlash: { value: 0 },
  uBoltDir: { value: new THREE.Vector3(-0.35, 0.32, 0.88).normalize() }
};
const sky = new THREE.Mesh(
  new THREE.SphereGeometry(90, 32, 20),
  new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false, uniforms: skyUniforms,
    vertexShader: `
      varying vec3 vDir;
      void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
    fragmentShader: `
      uniform float uTime; uniform float uFlash; uniform vec3 uBoltDir;
      varying vec3 vDir;
      float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7)))*43758.5453); }
      float noise(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
        return mix(mix(hash(i),hash(i+vec2(1,0)),f.x), mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x), f.y); }
      float fbm(vec2 p){ float v=0.0, a=0.5; for(int i=0;i<5;i++){ v+=a*noise(p); p*=2.03; a*=0.5; } return v; }
      void main(){
        vec3 d = normalize(vDir);
        float h = clamp(d.y, -0.15, 1.0);
        vec3 col = mix(vec3(0.082,0.098,0.120), vec3(0.014,0.021,0.033), smoothstep(-0.02, 0.62, h));
        vec2 uv = d.xz / max(0.20, d.y * 1.35);
        float n1 = fbm(uv * 1.5 + vec2(uTime * 0.010, uTime * 0.004));
        float n2 = fbm(uv * 4.2 - vec2(uTime * 0.018, 0.0));
        col += vec3(0.044,0.055,0.070) * (n1 * 0.9 + n2 * 0.35) * smoothstep(-0.05, 0.40, h);
        float glow = pow(max(0.0, dot(d, uBoltDir)), 4.0);
        float low = smoothstep(0.62, 0.02, abs(d.y - 0.12));
        col += vec3(0.62,0.74,0.96) * uFlash * (0.30 + glow * 2.4 + low * 0.35) * (0.35 + n1 * 0.9);
        gl_FragColor = vec4(col, 1.0);
      }`
  })
);
sky.frustumCulled = false;
scene.add(sky);

/* ------------------------------------------------------------------ ground */
const groundUniforms = {
  uTime: { value: 0 }, uFlash: { value: 0 }, uCam: { value: new THREE.Vector3() }
};
const ground = new THREE.Mesh(
  new THREE.PlaneGeometry(160, 160, 1, 1),
  new THREE.ShaderMaterial({
    uniforms: groundUniforms,
    vertexShader: `
      varying vec3 vW;
      void main(){ vec4 w = modelMatrix * vec4(position,1.0); vW = w.xyz;
        gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: `
      uniform float uTime; uniform float uFlash; uniform vec3 uCam;
      varying vec3 vW;
      float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7)))*43758.5453); }
      float noise(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
        return mix(mix(hash(i),hash(i+vec2(1,0)),f.x), mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x), f.y); }
      float fbm(vec2 p){ float v=0.0, a=0.5; for(int i=0;i<4;i++){ v+=a*noise(p); p*=2.07; a*=0.5; } return v; }
      float ripples(vec2 p, float scale, float seed){
        vec2 q = p * scale + seed;
        vec2 cell = floor(q), f = fract(q);
        vec2 c = 0.25 + 0.5 * vec2(hash(cell), hash(cell + 11.3));
        float ph = hash(cell + 3.1);
        float t = fract(uTime * 0.7 + ph);
        float r = length(f - c);
        return smoothstep(0.05, 0.0, abs(r - t * 0.3)) * (1.0 - t);
      }
      void main(){
        vec2 p = vW.xz;
        float g1 = fbm(p * 1.05), g2 = fbm(p * 4.6);
        vec3 col = vec3(0.031,0.037,0.045) + vec3(0.042,0.049,0.057) * (g1 * 0.7 + g2 * 0.35);
        float pud = smoothstep(0.46, 0.66, g1);
        float rip = (ripples(p, 2.6, 0.0) + ripples(p, 1.55, 7.3)) * (0.12 + pud * 0.65);
        col += vec3(0.19,0.25,0.32) * rip;
        vec3 V = normalize(uCam - vW);
        float fres = pow(1.0 - clamp(V.y, 0.0, 1.0), 4.0);
        col += vec3(0.085,0.115,0.155) * (0.10 + fres) * (0.30 + pud * 0.9) * (0.22 + uFlash * 7.0);
        float d = length(vW.xz - vec2(0.0, 1.2));
        col *= mix(0.45, 1.0, smoothstep(46.0, 5.0, d));
        gl_FragColor = vec4(col, 1.0);
      }`
  })
);
ground.rotation.x = -Math.PI / 2;
ground.position.y = 0;
scene.add(ground);

/* ------------------------------------------------------------------ lights */
const hemi = new THREE.HemisphereLight(0x48688a, 0x121a22, 0.95);
scene.add(hemi);
const stormKey = new THREE.DirectionalLight(0xa8c2d6, 1.45);
stormKey.position.set(-3.5, 7, -4);
scene.add(stormKey);
const flashLight = new THREE.DirectionalLight(0xd6e9ff, 0);
flashLight.position.set(-6, 8, 12);
scene.add(flashLight);
const practical = new THREE.PointLight(0xff9a52, 13, 13, 2);
practical.position.set(4.4, 3.3, 3.4);
scene.add(practical);
const fill = new THREE.PointLight(0x8fb4d4, 3.6, 10, 2);
fill.position.set(-2.6, 2.0, -2.4);
scene.add(fill);
/* soft cool fill on the bag's camera-facing side, so the leather reads at night */
const bagFill = new THREE.PointLight(0xb2d2e8, 16, 9, 2);
scene.add(bagFill);
const contactLight = new THREE.PointLight(0xbfe0ff, 0, 4.5, 2);
scene.add(contactLight);

/* a small practical lamp housing, so the warm light has a source */
const lampPost = new THREE.Group();
{
  const steel = new THREE.MeshStandardMaterial({ color: 0x14181c, roughness: 0.5, metalness: 0.85 });
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.07, 3.4, 12), steel);
  pole.position.y = 1.7; lampPost.add(pole);
  const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.7, 8), steel);
  arm.rotation.z = Math.PI / 2; arm.position.set(-0.32, 3.36, 0); lampPost.add(arm);
  const shade = new THREE.Mesh(new THREE.ConeGeometry(0.24, 0.2, 18, 1, true), steel);
  shade.position.set(-0.62, 3.3, 0); shade.rotation.x = Math.PI; lampPost.add(shade);
  const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.07, 12, 10), new THREE.MeshBasicMaterial({ color: 0xffd9ab }));
  bulb.position.set(-0.62, 3.22, 0); lampPost.add(bulb);
  lampPost.position.set(5.0, 0, 3.4);
  scene.add(lampPost);
}

/* ------------------------------------------------------------------ rain */
const RAIN = mobile() ? 1500 : 2800;
const RAIN_BOX = { x: 9, z: 12, y: 15 };
const rainPos = new Float32Array(RAIN * 6);
const rainMeta = new Float32Array(RAIN * 4); // x, z, y, speed
for (let i = 0; i < RAIN; i++) {
  rainMeta[i * 4] = rand(-RAIN_BOX.x, RAIN_BOX.x);
  rainMeta[i * 4 + 1] = rand(-5.5, RAIN_BOX.z);
  rainMeta[i * 4 + 2] = rand(0, RAIN_BOX.y);
  rainMeta[i * 4 + 3] = rand(9, 16);
}
const rainGeo = new THREE.BufferGeometry();
rainGeo.setAttribute('position', new THREE.BufferAttribute(rainPos, 3));
const rain = new THREE.LineSegments(rainGeo, new THREE.LineBasicMaterial({
  color: 0xb6cee0, transparent: true, opacity: 0.36, depthWrite: false
}));
rain.frustumCulled = false;
scene.add(rain);

const WIND = -1.1;
function updateRain(dt) {
  for (let i = 0; i < RAIN; i++) {
    let x = rainMeta[i * 4], z = rainMeta[i * 4 + 1], y = rainMeta[i * 4 + 2];
    const v = rainMeta[i * 4 + 3];
    y -= v * dt;
    x += WIND * dt;
    if (y < 0) {
      y = RAIN_BOX.y + rand(0, 2);
      x = rand(-RAIN_BOX.x, RAIN_BOX.x);
      z = rand(-5.5, RAIN_BOX.z);
    } else if (x < -RAIN_BOX.x) x += RAIN_BOX.x * 2;
    rainMeta[i * 4] = x; rainMeta[i * 4 + 1] = z; rainMeta[i * 4 + 2] = y;
    const len = 0.10 + v * 0.026;
    rainPos[i * 6] = x; rainPos[i * 6 + 1] = y; rainPos[i * 6 + 2] = z;
    rainPos[i * 6 + 3] = x - WIND * 0.045;
    rainPos[i * 6 + 4] = y + len;
    rainPos[i * 6 + 5] = z;
  }
  rainGeo.attributes.position.needsUpdate = true;
}
updateRain(0.016);

/* ------------------------------------------------------------------ lightning */
const boltMat = new THREE.LineBasicMaterial({
  color: 0xdcecff, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending
});
const bolt = new THREE.LineSegments(new THREE.BufferGeometry(), boltMat);
bolt.frustumCulled = false;
scene.add(bolt);

function rebuildBolt() {
  // low camera → only a thin band of sky is in frame, so the bolt hugs the
  // horizon just above it, right of the bag
  const pts = [];
  let x = rand(-9, -4.5), y = rand(3.6, 5), z = rand(4, 7.5);
  const main = [new THREE.Vector3(x, y, z)];
  while (y > 0.6) {
    y -= rand(0.5, 1.0);
    x += rand(-0.7, 0.7);
    z += rand(-0.4, 0.4);
    main.push(new THREE.Vector3(x, y, z));
    if (Math.random() < 0.3 && y > 1.8) {
      let bx = x, by = y, bz = z;
      for (let i = 0; i < 3; i++) {
        bx += rand(-0.9, 0.9); by -= rand(0.4, 0.9); bz += rand(-0.4, 0.4);
        pts.push(new THREE.Vector3(x, y, z), new THREE.Vector3(bx, by, bz));
      }
    }
  }
  for (let i = 0; i < main.length - 1; i++) pts.push(main[i], main[i + 1]);
  bolt.geometry.dispose();
  bolt.geometry = new THREE.BufferGeometry().setFromPoints(pts);
}
rebuildBolt();

let flash = 0;
let boltGlow = 0;
function lightning(power = 1) {
  flash = Math.max(flash, power);
  boltGlow = Math.max(boltGlow, power);
  rebuildBolt();
  Sound.thunder(rand(0.06, 0.34), power);
}

/* ------------------------------------------------------------------ heavy bag */
const BAG = { r: 0.27, bottom: 0.42, top: 1.62, x: 0, z: 1.35 };
const bagRoot = new THREE.Group();
scene.add(bagRoot);

const steelMat = new THREE.MeshStandardMaterial({ color: 0x2e3740, roughness: 0.4, metalness: 0.88 });
const leatherMat = new THREE.MeshPhysicalMaterial({
  color: 0x4a342a, roughness: 0.42, metalness: 0.05,
  clearcoat: 0.55, clearcoatRoughness: 0.28, envMapIntensity: 0.8
});
const strapMat = new THREE.MeshPhysicalMaterial({
  color: 0x120e0d, roughness: 0.5, metalness: 0.05, clearcoat: 0.4, clearcoatRoughness: 0.35
});

/* base plate */
const base = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.36, 0.1, 40), steelMat);
base.position.y = 0.05; bagRoot.add(base);
for (let i = 0; i < 6; i++) {
  const a = (i / 6) * Math.PI * 2;
  const boltHead = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.016, 0.014, 8), steelMat);
  boltHead.position.set(Math.cos(a) * 0.29, 0.104, Math.sin(a) * 0.29);
  bagRoot.add(boltHead);
}
const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.085, 0.12, 0.24, 20), steelMat);
neck.position.y = 0.18; bagRoot.add(neck);

/* the tilting part */
const bagPivot = new THREE.Group();
bagPivot.position.y = BAG.bottom;
bagRoot.add(bagPivot);
const bagY = (y) => y - BAG.bottom;

const bodyH = BAG.top - BAG.bottom;
const body = new THREE.Mesh(new THREE.CylinderGeometry(BAG.r * 0.95, BAG.r, bodyH, 48, 1, false), leatherMat);
body.position.y = bagY(BAG.bottom + bodyH / 2);
bagPivot.add(body);

/* rounded caps */
const dome = new THREE.Mesh(new THREE.SphereGeometry(BAG.r * 0.95, 40, 20, 0, Math.PI * 2, 0, Math.PI / 2), leatherMat);
dome.position.y = bagY(BAG.top); dome.scale.y = 0.42; bagPivot.add(dome);
const skirt = new THREE.Mesh(new THREE.SphereGeometry(BAG.r, 40, 20, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), leatherMat);
skirt.position.y = bagY(BAG.bottom); skirt.scale.y = 0.45; bagPivot.add(skirt);

/* stitched seams */
const seamMat = new THREE.MeshStandardMaterial({ color: 0x0e0908, roughness: 0.75, metalness: 0.05 });
for (const y of [0.62, 0.98, 1.34, 1.56]) {
  const ring = new THREE.Mesh(new THREE.TorusGeometry(BAG.r * 0.995, 0.0045, 6, 64), seamMat);
  ring.rotation.x = Math.PI / 2; ring.position.y = bagY(y); bagPivot.add(ring);
}
for (let i = 0; i < 4; i++) {
  const a = (i / 4) * Math.PI * 2;
  const strap = new THREE.Mesh(new THREE.BoxGeometry(0.035, bodyH * 0.99, 0.012), strapMat);
  strap.position.set(Math.cos(a) * BAG.r * 0.99, bagY(BAG.bottom + bodyH / 2), Math.sin(a) * BAG.r * 0.99);
  strap.rotation.y = -a;
  bagPivot.add(strap);
}

/* steel collar / lid that slides down to receive uppercuts */
const collar = new THREE.Group();
bagPivot.add(collar);
const collarTopY = BAG.top + 0.004;
const collarRing = new THREE.Mesh(new THREE.TorusGeometry(BAG.r * 1.06, 0.026, 10, 56), steelMat);
collarRing.rotation.x = Math.PI / 2;
const collarLip = new THREE.Mesh(new THREE.CylinderGeometry(BAG.r * 1.06, BAG.r * 1.06, 0.045, 48, 1, true), steelMat);
collarLip.position.y = -0.022;
const collarPlate = new THREE.Mesh(new THREE.CircleGeometry(BAG.r * 1.04, 48), leatherMat);
collarPlate.rotation.x = -Math.PI / 2; collarPlate.position.y = -0.03;
collar.add(collarRing, collarLip, collarPlate);
collar.position.y = bagY(collarTopY);

/* wet contact shadows */
function blobTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(64, 64, 2, 64, 64, 62);
  grd.addColorStop(0, 'rgba(0,0,0,.85)');
  grd.addColorStop(0.5, 'rgba(0,0,0,.45)');
  grd.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grd; g.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(c);
}
const blobTex = blobTexture();
const blobMat = new THREE.MeshBasicMaterial({ map: blobTex, transparent: true, opacity: 0.62, depthWrite: false });
const fighterShadow = new THREE.Mesh(new THREE.PlaneGeometry(1.9, 2.4), blobMat);
fighterShadow.rotation.x = -Math.PI / 2; fighterShadow.position.y = 0.005; scene.add(fighterShadow);
const bagShadow = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 1.6), blobMat.clone());
bagShadow.material.opacity = 0.7;
bagShadow.rotation.x = -Math.PI / 2; bagShadow.position.y = 0.006; scene.add(bagShadow);

/* ------------------------------------------------------------------ splash fx */
function softSprite() {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.4, 'rgba(226,242,255,.6)');
  grd.addColorStop(1, 'rgba(200,228,255,0)');
  g.fillStyle = grd; g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}
const dropTex = softSprite();

const SPRAY = 180;
const sprayPos = new Float32Array(SPRAY * 3);
const sprayVel = new Float32Array(SPRAY * 3);
const sprayGeo = new THREE.BufferGeometry();
sprayGeo.setAttribute('position', new THREE.BufferAttribute(sprayPos, 3));
const sprayMat = new THREE.PointsMaterial({
  map: dropTex, size: 0.055, color: 0xe8f4ff, transparent: true, opacity: 0,
  depthWrite: false, sizeAttenuation: true
});
const spray = new THREE.Points(sprayGeo, sprayMat);
spray.frustumCulled = false; spray.visible = false;
scene.add(spray);
let sprayLife = 0;

/* spray sheets — cheap puffs of mist around the burst */
const sheets = [];
for (let i = 0; i < 5; i++) {
  const s = new THREE.Sprite(new THREE.SpriteMaterial({
    map: dropTex, color: 0xd8ecff, transparent: true, opacity: 0, depthWrite: false
  }));
  s.visible = false; scene.add(s);
  sheets.push({ s, life: 0, vel: new THREE.Vector3() });
}

/* shockwave that spreads over the wet ground */
const wave = new THREE.Mesh(
  new THREE.RingGeometry(0.32, 0.37, 64),
  new THREE.MeshBasicMaterial({ color: 0xbcd6ea, transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false })
);
wave.rotation.x = -Math.PI / 2; wave.position.y = 0.012; wave.visible = false; scene.add(wave);
let waveLife = 0;

/* a white ring at the contact point, on the bag surface */
const RING_AXIS = new THREE.Vector3(0, 0, 1);
const contactRing = new THREE.Mesh(
  new THREE.RingGeometry(0.055, 0.075, 48),
  new THREE.MeshBasicMaterial({ color: 0xf2fbff, transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false })
);
contactRing.visible = false; contactRing.renderOrder = 60; scene.add(contactRing);
let ringLife = 0;

/* ------------------------------------------------------------------ fighter */
let model, mixer, clips = {}, rig;
const MEASURE = {};
const state = {
  id: null, action: null, impact: 0, hit: false,
  move: new THREE.Vector3(), from: new THREE.Vector3(), cur: new THREE.Vector3()
};

async function loadFighter() {
  const gltf = await new GLTFLoader().loadAsync('../../media/glb/boxer-man.glb');
  model = gltf.scene;
  const box = new THREE.Box3().setFromObject(model);
  const h = box.max.y - box.min.y;
  const s = 1.78 / h;
  model.scale.setScalar(s);
  model.position.y = -box.min.y * s;
  model.traverse((o) => {
    if (!o.isMesh || !o.material) return;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    for (const m of mats) if (m.roughness !== undefined && m.roughness > 0.75) m.roughness = 0.68;
  });
  rig = new THREE.Group();
  rig.add(model);
  scene.add(rig);

  mixer = new THREE.AnimationMixer(model);
  for (const c of gltf.animations) clips[c.name] = c;

  const bone = (n) => model.getObjectByName('mixamorig:' + n) || model.getObjectByName('mixamorig' + n) || model.getObjectByName(n);
  const hands = { LeftHand: bone('LeftHand'), RightHand: bone('RightHand') };
  const fores = { LeftHand: bone('LeftForeArm'), RightHand: bone('RightForeArm') };

  model.updateMatrixWorld(true);
  window.__rig = { model, mixer, clips, hands, fores };
  measureAll(hands, fores);
  placeStage();
  return s;
}

/** find the impact frame of each punch + where the knuckles actually are */
function measureAll(hands, fores) {
  const tmpA = new THREE.Vector3(), tmpB = new THREE.Vector3(), tmpC = new THREE.Vector3();
  const origin = new THREE.Vector3(0, 0, 0);
  mixer.stopAllAction();

  for (const mv of MOVES) {
    const clip = clips[mv.clip];
    if (!clip) continue;
    const act = mixer.clipAction(clip);
    act.reset().play();
    mixer.timeScale = 1;

    if (!mv.hit) {
      MEASURE[mv.id] = { impact: 0, dur: clip.duration, reach: 0, contact: new THREE.Vector3() };
      act.stop();
      continue;
    }

    const hand = hands[mv.hit];
    const fore = fores[mv.hit];
    if (!hand) { act.stop(); continue; }

    let best = { z: -9, t: 0 };
    const N = 120;
    for (let i = 0; i <= N; i++) {
      const t = (clip.duration * i) / N;
      act.time = t;
      mixer.update(0);
      model.updateMatrixWorld(true);
      hand.getWorldPosition(tmpA);
      if (tmpA.z > best.z) best = { z: tmpA.z, t };
    }
    // contact = wrist pushed along the forearm axis to the knuckle line
    act.time = best.t; mixer.update(0); model.updateMatrixWorld(true);
    hand.getWorldPosition(tmpA);
    fore.getWorldPosition(tmpB);
    tmpC.copy(tmpA).sub(tmpB).normalize();
    const contact = tmpA.clone().addScaledVector(tmpC, 0.115);

    MEASURE[mv.id] = { impact: best.t, dur: clip.duration, contact, reach: contact.distanceTo(origin), hand: mv.hit };
    act.stop();
  }

  solveStaging();
}

/**
 * Place the bag so that the median punch just reaches its near face, then give
 * every punch its own footwork: the fighter shifts sideways / steps in until
 * the knuckles sit exactly on the surface — never inside it.
 *
 * Straights land square on the front face. Hooks do not: a hook arrives on an
 * arc, so its glove has to meet the flank of the bag. Those get a contact angle
 * around the cylinder (the camera side, where the arc actually wraps) and the
 * fighter steps in / across to make that angle reachable.
 */
const HOOK_ANGLE = { LeftHand: 46, RightHand: 34 }; // degrees around the bag axis
function solveStaging() {
  const ids = MOVES.filter((m) => m.hit && MEASURE[m.id] && MEASURE[m.id].contact).map((m) => m.id);
  if (!ids.length) return;

  const zs = ids.map((id) => MEASURE[id].contact.z).sort((a, b) => a - b);
  const medZ = zs[Math.floor(zs.length / 2)];
  BAG.x = 0;
  BAG.z = medZ + BAG.r;

  for (const id of ids) {
    const c = MEASURE[id].contact;
    const hook = /hook/.test(id);
    let tx, tz, off, inward;

    if (hook) {
      // the glove meets the flank: the contact normal points out of the side
      // of the cylinder, so the burst of water flies off sideways
      const th = (HOOK_ANGLE[MEASURE[id].hand] || 40) * Math.PI / 180;
      off = Math.sin(th) * BAG.r;
      inward = Math.cos(th) * BAG.r;
      tx = BAG.x + off;
      tz = BAG.z - inward;
    } else {
      // keep a little of the natural lateral offset so punches land on
      // different spots of the bag face instead of one single dot
      off = clamp(c.x * 0.62, -BAG.r * 0.68, BAG.r * 0.68);
      inward = Math.sqrt(Math.max(0.0004, BAG.r * BAG.r - off * off));
      tx = BAG.x + off;
      tz = BAG.z - inward;
    }

    MEASURE[id].target = new THREE.Vector3(tx, c.y, tz);
    MEASURE[id].normal = new THREE.Vector3(off / BAG.r, 0, -inward / BAG.r).normalize();
    MEASURE[id].move = new THREE.Vector3(tx - c.x, 0, tz - c.z);
  }
  placeStage();
}

function placeStage() {
  bagRoot.position.set(BAG.x, 0, BAG.z);
  bagShadow.position.set(BAG.x, 0.006, BAG.z);
  contactLight.position.set(BAG.x, 1.2, BAG.z - BAG.r - 0.15);
  bagFill.position.set(BAG.x + 1.9, 1.75, BAG.z - 1.9);
  practical.position.set(BAG.x + 4.6, 3.3, BAG.z + 2.6);
  lampPost.position.set(BAG.x + 5.1, 0, BAG.z + 2.6);
  frameStage();
}

/* ------------------------------------------------------------------ impact */
function fireImpact() {
  const m = MEASURE[state.id];
  if (!m || !m.target) return;
  const isUpper = /uppercut/.test(state.id);
  const p = m.target.clone();
  if (isUpper) p.y = collar.position.y + BAG.bottom;
  const n = m.normal.clone();
  if (isUpper) n.set(n.x * 0.3, 10, n.z * 0.3).normalize();

  splash(p, n, clamp(0.8 + (m.reach - 1.2) * 0.6, 0.7, 1.3));
  lightning(0.85);
  shake = 0.085 + Math.min(0.05, m.reach * 0.02);

  const dir = isUpper ? new THREE.Vector3(0, 0, 0) : n.clone();
  sway.vz += -dir.z * 3.6 + rand(-0.25, 0.25);
  sway.vx += -dir.x * 3.6 + rand(-0.25, 0.25);

  Sound.impact(clamp(0.75 + (m.reach - 1.2) * 0.5, 0.7, 1.2));
}

function splash(p, n, power) {
  // droplets
  const up = new THREE.Vector3(0, 1, 0);
  for (let i = 0; i < SPRAY; i++) {
    sprayPos[i * 3] = p.x + rand(-0.02, 0.02);
    sprayPos[i * 3 + 1] = p.y + rand(-0.02, 0.02);
    sprayPos[i * 3 + 2] = p.z + rand(-0.02, 0.02);
    const sp = rand(0.7, 3.2) * power;
    const v = n.clone().multiplyScalar(rand(0.3, 1.0))
      .addScaledVector(up, rand(0.15, 1.0))
      .add(new THREE.Vector3(rand(-0.85, 0.85), rand(-0.3, 0.6), rand(-0.85, 0.85)))
      .normalize()
      .multiplyScalar(sp);
    sprayVel[i * 3] = v.x; sprayVel[i * 3 + 1] = v.y; sprayVel[i * 3 + 2] = v.z;
  }
  sprayGeo.attributes.position.needsUpdate = true;
  spray.visible = true; sprayMat.opacity = 1; sprayLife = 1;

  // mist puffs
  for (let i = 0; i < sheets.length; i++) {
    const s = sheets[i];
    s.life = 1;
    s.s.visible = true;
    s.s.position.copy(p).addScaledVector(n, 0.05).add(new THREE.Vector3(rand(-0.04, 0.04), rand(-0.02, 0.07), rand(-0.04, 0.04)));
    s.vel.copy(n).multiplyScalar(rand(0.2, 0.7)).add(new THREE.Vector3(rand(-0.25, 0.25), rand(0.1, 0.45), rand(-0.25, 0.25)));
    s.s.material.opacity = 0;
    s.s.scale.setScalar(rand(0.08, 0.14));
  }

  // ring on the surface
  contactRing.position.copy(p).addScaledVector(n, 0.03);
  contactRing.quaternion.setFromUnitVectors(RING_AXIS, n);
  contactRing.visible = true;
  contactRing.material.opacity = 0.75;
  contactRing.scale.setScalar(1);
  ringLife = 1;

  // ground shock
  wave.position.set(BAG.x, 0.014, BAG.z);
  wave.visible = true; wave.material.opacity = 0.4; wave.scale.setScalar(0.5);
  waveLife = 1;

  contactLight.position.copy(p).addScaledVector(n, 0.25);
  contactLight.intensity = 9;

  const fl = document.getElementById('flash');
  fl.classList.remove('hit'); void fl.offsetWidth; fl.classList.add('hit');
}

let shake = 0;

/* ------------------------------------------------------------------ panel */
const panel = document.getElementById('panel');
const nodesEl = document.getElementById('nodes');
const stNode = document.getElementById('stNode');
const stReach = document.getElementById('stReach');
const stImpact = document.getElementById('stImpact');
const setText = (el, v) => { if (el) el.textContent = v; };

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
    s.className = 'w'; s.textContent = w;
    s.style.animationDelay = delayStart + i * 18 + 'ms';
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
      s.className = 'w'; s.textContent = w;
      s.style.animationDelay = delayStart + (n + i) * 18 + 'ms';
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
  n += typeList('key points', mv.points, 240 + n * 18, body);
  n += typeSection('when to use it', mv.use, 500 + n * 18, body);

  setText(stNode, mv.code);
  if (measured) {
    setText(stReach, measured.reach.toFixed(2) + ' m');
    setText(stImpact, measured.impact.toFixed(2) + ' s');
  } else {
    setText(stReach, '—');
    setText(stImpact, '—');
  }
  document.getElementById('pFoot').textContent = measured
    ? `clip ${measured.dur.toFixed(2)}s · lands at ${measured.impact.toFixed(2)}s`
    : 'loop · hold the line';

  panel.classList.add('on');
  panel.scrollTop = 0;
  body.scrollTop = 0;

  Sound.swell();
  setTimeout(() => Sound.drop(), 220);
  setTimeout(() => Sound.drop(), 520);

  for (const el of document.querySelectorAll('.node')) el.classList.toggle('on', el.dataset.id === mv.id);
}

/* ------------------------------------------------------------------ playing */
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
  state.from.copy(state.cur);
  state.move.copy(mv.hit ? MEASURE[id].move : new THREE.Vector3());

  if (!silent) Sound.tap();
  // a scuff of boots when the fighter has to travel for this punch
  if (mv.hit && state.from.distanceTo(state.move) > 0.07) setTimeout(() => Sound.step(), 60);
  if (showPanelToo) showPanel(mv, mv.hit ? MEASURE[id] : null);
}

/* ------------------------------------------------------------------ nodes */
function buildNodes() {
  for (const mv of MOVES) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'node' + (mv.id === 'guard' ? ' guard' : '');
    b.dataset.id = mv.id;
    b.innerHTML = `<span class="code">${mv.code}</span><span class="nm">${mv.name === mv.em ? mv.em : `${mv.name} ${mv.em}`}<small>${mv.tag}</small></span>`;
    b.addEventListener('click', () => { Sound.init(); Sound.resume(); play(mv.id); });
    b.addEventListener('pointerenter', () => Sound.tap());
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

/* ------------------------------------------------------------------ camera */
const camTarget = { pos: new THREE.Vector3(), look: new THREE.Vector3() };
const lookCur = new THREE.Vector3();
const camPos = new THREE.Vector3();

/* the framing the page ships with; the mouse only adds an offset on top of it */
const camBase = { theta: 52 * Math.PI / 180, D: 3.75, H: 1.82, aimY: 1.04, pan: -0.16 };
const orbit = { az: 0, el: 0, zoom: 1 };

function camSolve() {
  const th = camBase.theta + orbit.az;
  const D = camBase.D * orbit.zoom;
  const pos = new THREE.Vector3(BAG.x + Math.sin(th) * D, camBase.H + orbit.el, BAG.z - Math.cos(th) * D);
  const aim = new THREE.Vector3(BAG.x * 0.4, camBase.aimY + orbit.el * 0.3, BAG.z * 0.52);
  const fwd = aim.clone().sub(pos).normalize();
  const right = new THREE.Vector3().crossVectors(fwd, new THREE.Vector3(0, 1, 0)).normalize();
  camTarget.pos.copy(pos);
  camTarget.look.copy(aim).addScaledVector(right, camBase.pan);
}

function frameStage(o = {}, snap = true) {
  const m = mobile();
  camBase.theta = (o.theta ?? 52) * Math.PI / 180;
  camBase.D = o.D ?? (m ? 5.6 : 3.75);
  camBase.H = o.H ?? (m ? 1.78 : 1.82);
  camBase.aimY = o.aimY ?? (m ? 1.06 : 1.04);
  camBase.pan = o.pan ?? (m ? 0.1 : -0.16);
  camSolve();
  if (!snap) return;
  camPos.copy(camTarget.pos);
  lookCur.copy(camTarget.look);
  camera.position.copy(camPos);
  camera.lookAt(lookCur);
}

/* ---- drag to look around the yard ---- */
let dragging = false;
const dragStart = { x: 0, y: 0, az: 0, el: 0 };
const AZ_LIMIT = 1.05;      // ±60° around the shipped angle
const EL_LO = -0.55, EL_HI = 1.35;

function beginDrag(e) {
  if (e.button !== undefined && e.button !== 0) return;
  dragging = true;
  dragStart.x = e.clientX; dragStart.y = e.clientY;
  dragStart.az = orbit.az; dragStart.el = orbit.el;
  canvas.classList.add('dragging');
  if (canvas.setPointerCapture) { try { canvas.setPointerCapture(e.pointerId); } catch (_) {} }
}
function moveDrag(e) {
  if (!dragging) return;
  const dx = e.clientX - dragStart.x, dy = e.clientY - dragStart.y;
  orbit.az = clamp(dragStart.az - dx * 0.0055, -AZ_LIMIT, AZ_LIMIT);
  orbit.el = clamp(dragStart.el + dy * 0.0042, EL_LO, EL_HI);
  camSolve();
}
function endDrag(e) {
  if (!dragging) return;
  dragging = false;
  canvas.classList.remove('dragging');
  if (canvas.releasePointerCapture && e.pointerId !== undefined) {
    try { canvas.releasePointerCapture(e.pointerId); } catch (_) {}
  }
}

canvas.addEventListener('pointerdown', beginDrag);
canvas.addEventListener('pointermove', moveDrag);
window.addEventListener('pointerup', endDrag);
window.addEventListener('pointercancel', endDrag);

canvas.addEventListener('wheel', (e) => {
  e.preventDefault();
  orbit.zoom = clamp(orbit.zoom * (e.deltaY > 0 ? 1.07 : 0.935), 0.72, 1.45);
  camSolve();
}, { passive: false });

function resetView() {
  orbit.az = 0; orbit.el = 0; orbit.zoom = 1;
  camSolve();
  camPos.copy(camTarget.pos); lookCur.copy(camTarget.look);
}
canvas.addEventListener('dblclick', resetView);


/* ------------------------------------------------------------------ loop */
const sway = { vx: 0, vz: 0, x: 0, z: 0 };
const clock = new THREE.Clock();
let t0 = 0;

function tick() {
  const dt = Math.min(clock.getDelta(), 0.05);
  t0 += dt;

  const mv = state.id ? MOVE_BY_ID[state.id] : null;
  const upper = !!mv && /uppercut/.test(mv.id) && !!MEASURE[mv.id];
  const targetCollarY = upper ? MEASURE[mv.id].contact.y + 0.02 : collarTopY;
  collar.position.y = damp(collar.position.y, bagY(targetCollarY), upper ? 18 : 7, dt);

  // ---- footwork: ease into the punch's own stance, ease back out afterwards
  if (mv) {
    const ramp = state.impact > 0 ? Math.max(0.22, state.impact * 0.72) : 0.5;
    const t = state.action ? state.action.time : 0;
    const k = smooth(t / ramp);
    state.cur.lerpVectors(state.from, state.move, k);
    if (rig) { rig.position.x = state.cur.x; rig.position.z = state.cur.z; }
    if (fighterShadow) fighterShadow.position.set(state.cur.x + 0.05, 0.005, state.cur.z + 0.28);
  }

  if (state.action && state.impact > 0 && !state.hit && state.action.time >= state.impact) {
    state.hit = true;
    fireImpact();
  }

  if (mixer) mixer.update(dt);

  if (state.action && !mv?.loop && state.action.time >= state.action.getClip().duration - 0.02) {
    if (!state.returning) { state.returning = true; play('guard', { silent: true, panel: false }); state.returning = false; }
  }

  // bag spring
  const K = 40, C = 5.0;
  sway.vx += (-K * sway.x - C * sway.vx) * dt;
  sway.vz += (-K * sway.z - C * sway.vz) * dt;
  sway.x += sway.vx * dt;
  sway.z += sway.vz * dt;
  bagPivot.rotation.z = sway.x * 0.2;
  bagPivot.rotation.x = sway.z * 0.2;

  // ---- storm
  flash = Math.max(0, flash - dt * (2.6 + flash * 3.6));
  boltGlow = Math.max(0, boltGlow - dt * 3.6);
  const flicker = flash * (0.55 + 0.45 * Math.sin(t0 * 90));
  skyUniforms.uTime.value = t0;
  skyUniforms.uFlash.value = flicker;
  groundUniforms.uTime.value = t0;
  groundUniforms.uFlash.value = flicker;
  groundUniforms.uCam.value.copy(camera.position);
  flashLight.intensity = flicker * 30;
  hemi.intensity = 0.95 + flicker * 0.9;
  boltMat.opacity = Math.min(1, boltGlow * (0.6 + 0.4 * Math.sin(t0 * 70)) * 1.4);
  contactLight.intensity = Math.max(0, contactLight.intensity - dt * 42);
  practical.intensity = 13 + Math.sin(t0 * 7.3) * 0.4;

  updateRain(dt);
  rain.material.opacity = 0.30 + flicker * 0.5;

  // ---- fx
  if (sprayLife > 0) {
    sprayLife -= dt * 1.25;
    for (let i = 0; i < SPRAY; i++) {
      sprayVel[i * 3 + 1] -= 9.2 * dt;
      sprayPos[i * 3] += sprayVel[i * 3] * dt;
      sprayPos[i * 3 + 1] += sprayVel[i * 3 + 1] * dt;
      sprayPos[i * 3 + 2] += sprayVel[i * 3 + 2] * dt;
    }
    sprayGeo.attributes.position.needsUpdate = true;
    sprayMat.opacity = clamp(sprayLife, 0, 1);
    if (sprayLife <= 0) spray.visible = false;
  }
  for (const s of sheets) {
    if (s.life <= 0) continue;
    s.life -= dt * 2.6;
    s.s.position.addScaledVector(s.vel, dt);
    s.s.scale.setScalar(s.s.scale.x + dt * 0.85);
    s.s.material.opacity = Math.max(0, s.life) * 0.2;
    if (s.life <= 0) s.s.visible = false;
  }
  if (ringLife > 0) {
    ringLife -= dt * 3.4;
    contactRing.scale.setScalar(1 + (1 - ringLife) * 3.6);
    contactRing.material.opacity = Math.max(0, ringLife) * 0.7;
    if (ringLife <= 0) contactRing.visible = false;
  }
  if (waveLife > 0) {
    waveLife -= dt * 1.5;
    const k = 1 - waveLife;
    wave.scale.setScalar(0.5 + k * 5.2);
    wave.material.opacity = Math.max(0, waveLife) * 0.38;
    if (waveLife <= 0) wave.visible = false;
  }

  // ---- camera: locked, only breathing + impact shake
  const drift = mobile() ? 0.035 : 0.06;
  const k = 1 - Math.exp(-(dragging ? 16 : 6.5) * dt);
  camPos.lerp(camTarget.pos, k);
  lookCur.lerp(camTarget.look, k);
  camera.position.copy(camPos);
  camera.position.y += Math.sin(t0 * 0.7) * drift;
  camera.position.x += Math.sin(t0 * 0.23) * drift * 0.4;
  if (shake > 0.0005) {
    camera.position.x += rand(-shake, shake);
    camera.position.y += rand(-shake, shake);
    camera.position.z += rand(-shake, shake) * 0.6;
    shake *= 0.85;
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
  camera.fov = mobile() ? 52 : 40;
  camera.updateProjectionMatrix();
  const hint = document.getElementById('hint');
  if (hint) hint.textContent = mobile() ? 'drag to look' : 'drag to look · scroll to zoom · double-click to reset';
  frameStage();
  placeNodes();
}
window.addEventListener('resize', resize);

resize();
buildNodes();
tick();

loadFighter().then(() => {
  play('guard', { silent: true });
  unlockAudio();
  setTimeout(() => Sound.swell(), 900);
}).catch((e) => {
  console.error(e);
  const body = document.getElementById('pBody');
  if (body) body.innerHTML = '<div class="sec"><p>Failed to load the fighter — try a hard refresh (⌘⇧R).</p></div>';
});

/* ------------------------------------------------------------- audio unlock */
/* The sound bed starts on load: the rain is queued the moment the module runs
   and we keep asking the context to resume. Browsers that block autoplay leave
   it suspended until the first gesture of any kind — every one of those is
   wired below, so the audio is already playing by the time the user moves. */
const soundBtn = document.getElementById('sound');

function soundRunning() { return !!(Sound.ctx && Sound.ctx.state === 'running'); }

function syncSoundLabel() {
  if (!soundBtn) return;
  const live = soundRunning();
  soundBtn.textContent = Sound.on ? (live ? 'SOUND · ON' : 'SOUND · TAP') : 'SOUND · OFF';
  soundBtn.classList.toggle('waiting', Sound.on && !live);
  /* first time the bed becomes audible, say hello with a distant rumble */
  if (live && Sound.on && !Sound._announced) {
    Sound._announced = true;
    setTimeout(() => { if (soundRunning() && Sound.on) Sound.thunder(0.05, 0.5); }, 850);
  }
}

function unlockAudio() {
  Sound.init();
  Sound.resume();
  if (soundRunning()) syncSoundLabel();
}

Sound.init();
Sound.resume();
syncSoundLabel();
if (Sound.ctx && Sound.ctx.addEventListener) Sound.ctx.addEventListener('statechange', syncSoundLabel);

for (const evName of ['pointerdown', 'pointerup', 'keydown', 'touchstart', 'touchend', 'wheel', 'click', 'scroll']) {
  window.addEventListener(evName, unlockAudio, { passive: true });
}
document.addEventListener('visibilitychange', () => { if (!document.hidden) unlockAudio(); });

soundBtn.addEventListener('click', (e) => {
  Sound.on = !Sound.on;
  if (Sound.on) { unlockAudio(); Sound.tap(); }
  syncSoundLabel();
});

window.addEventListener('keydown', (e) => {
  const i = parseInt(e.key, 10);
  if (i >= 0 && i <= 6) play(MOVES[i].id);
});

/* debug hook for QA */
window.__sim = {
  play, state, MEASURE, BAG, camera, scene, camTarget, frameStage, orbit, Sound,
  proj: (pts) => {
    const out = {};
    for (const [k, p] of Object.entries(pts)) {
      const v = new THREE.Vector3(p[0], p[1], p[2]).project(camera);
      out[k] = [+(v.x * 0.5 + 0.5).toFixed(3), +(-v.y * 0.5 + 0.5).toFixed(3)];
    }
    return out;
  },
  frame: (o) => frameStage(o || {}),
  flash: () => lightning(1),
  /** QA: sample a clip's hand path (rig at origin) */
  probe: (id, n = 60) => {
    const mv = MOVE_BY_ID[id];
    const R = window.__rig;
    if (!mv || !R) return null;
    const hand = R.hands[mv.hit], fore = R.fores[mv.hit], clip = R.clips[mv.clip];
    if (!hand || !clip) return null;
    const p = new THREE.Vector3(), f = new THREE.Vector3(), d = new THREE.Vector3(), out = [];
    R.mixer.stopAllAction();
    const act = R.mixer.clipAction(clip);
    act.reset().play(); R.mixer.timeScale = 1;
    for (let i = 0; i <= n; i++) {
      const t = (clip.duration * i) / n;
      act.time = t; R.mixer.update(0); R.model.updateMatrixWorld(true);
      hand.getWorldPosition(p);
      fore.getWorldPosition(f);
      d.copy(p).sub(f).normalize();
      const c = p.clone().addScaledVector(d, 0.115);
      out.push([+t.toFixed(2), +p.x.toFixed(3), +p.y.toFixed(3), +p.z.toFixed(3),
        +c.x.toFixed(3), +c.y.toFixed(3), +c.z.toFixed(3)]);
    }
    act.stop();
    return out;
  },
  /** freeze exactly on a punch's impact frame (QA screenshots only) */
  holdAt: (id) => {
    const mv = MOVE_BY_ID[id], m = MEASURE[id];
    if (!mv || !m) return;
    state.id = id;
    state.cur.copy(m.move || new THREE.Vector3());
    state.from.copy(state.cur);
    if (rig) { rig.position.x = state.cur.x; rig.position.z = state.cur.z; }
    collar.position.y = bagY((/uppercut/.test(id) ? m.contact.y + 0.02 : collarTopY));
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
      impact: +v.impact.toFixed(3), dur: +v.dur.toFixed(3), reach: +(v.reach || 0).toFixed(3),
      contact: v.contact ? [+v.contact.x.toFixed(3), +v.contact.y.toFixed(3), +v.contact.z.toFixed(3)] : null,
      target: v.target ? [+v.target.x.toFixed(3), +v.target.y.toFixed(3), +v.target.z.toFixed(3)] : null,
      move: v.move ? [+v.move.x.toFixed(3), +v.move.z.toFixed(3)] : null
    }]))
  })
};
