/* SilentJab — sport stage: the push-up form-check page (/sport/push-up/)
 * ----------------------------------------------------------------------------
 * Two stages share one GLB (sport-pushup.glb: Tripo man + idle + push-up):
 *   • big stage   — loops the push-up, four form-callout cards (hands / legs /
 *                   hips / waist) with leader lines that track the bones every
 *                   frame, view buttons (side / head-on / from-feet), play+slow;
 *   • small stage — loops the idle, drag to orbit, sits sticky beside the
 *                   technique notes.
 *
 * Muscle highlighting: per-vertex masks are computed once from the skin
 * weights (bind-pose bone domains + a front/back/underside normal filter),
 * stored as two vec4 attributes, and injected into the shared
 * MeshPhongMaterial via onBeforeCompile. A group's intensity is a uniform, so
 * selecting a muscle chip lights the same fibres up on BOTH stages (the
 * SkeletonUtils clone shares the material and geometry).
 *
 * Deterministic QA: window.__pu exposes { setGroup, seekBig, big, small }.
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { clone as skeletonClone } from 'three/addons/utils/SkeletonUtils.js';

const GLB = new URL('../media/glb/sport-pushup.glb?v=4', import.meta.url).href;

/* ---------- muscle groups (attribute slot order matters: A0..A3, B0..B1) --- */
const GROUPS = [
  { key: 'chest',   slot: 'A', idx: 0 },
  { key: 'triceps', slot: 'A', idx: 1 },
  { key: 'delts',   slot: 'A', idx: 2 },
  { key: 'core',    slot: 'A', idx: 3 },
  { key: 'glutes',  slot: 'B', idx: 0 },
  { key: 'quads',   slot: 'B', idx: 1 },
];
const MUSCLE_NOTES = {
  chest: 'The prime mover. The pecs pull the body off the floor — elbows at ~45° keep the load on them instead of the shoulders.',
  triceps: 'Lockout power. The back of the arm finishes every rep — the closer the hands, the more the triceps take over.',
  delts: 'Stabilisers. The front delts hold the shoulder blades down and back so the shoulders never shrug into the ears.',
  core: 'The anti-sag team. Abs and obliques lock the ribs to the hips — this is why a push-up is a moving plank.',
  glutes: 'Hip lock. Squeeze them and the hips can neither sag nor pike — the pelvis stays in the straight line.',
  quads: 'Legs straight. The quads hold the knees locked and keep the heels pressing back through the whole rep.',
};

/* ---------- shared highlight state ---------- */
/* NOTE: THREE.Vector4() defaults w=1; our slot 3 lives in w, so every
   vector here must be zeroed explicitly or the core glow never clears */
const V4ZERO = () => new THREE.Vector4(0, 0, 0, 0);
const hi = {
  cur: V4ZERO(), curB: V4ZERO(),
  tgt: V4ZERO(), tgtB: V4ZERO(),
  all: false,
  uni: {
    uHiA: { value: V4ZERO() },
    uHiB: { value: V4ZERO() },
    uHiC: { value: new THREE.Color(0xff4a1e) },
    uHiK: { value: 0 },
  },
};
/* the small stage gets its OWN uniform channel: it idles with every
 * push-up muscle lit, while the big stage stays clean until a chip is tapped */
const hiS = {
  cur: V4ZERO(), curB: V4ZERO(),
  tgt: V4ZERO(), tgtB: V4ZERO(),
  all: true,
  uni: {
    uHiA: { value: V4ZERO() },
    uHiB: { value: V4ZERO() },
    uHiC: hi.uni.uHiC,
    uHiK: { value: 0 },
  },
};
hiS.tgt.set(1, 1, 1, 1); hiS.tgtB.set(1, 1, 0, 0);  // idle = every push-up muscle
function setGroup(key) {
  const t = V4ZERO(), tB = V4ZERO();
  if (key) {
    const g = GROUPS.find((x) => x.key === key);
    if (g.slot === 'A') t.setComponent(g.idx, 1); else tB.setComponent(g.idx, 1);
  }
  hi.tgt.copy(t); hi.tgtB.copy(tB); hi.all = false;
  /* small stage: mirror the focused chip; with no chip, light ALL of them */
  hiS.tgt.copy(t); hiS.tgtB.copy(tB);
  if (!key) { hiS.tgt.set(1, 1, 1, 1); hiS.tgtB.set(1, 1, 0, 0); }
  hiS.all = !key;
}
function tickHighlight(dt, time, st = hi) {
  const k = 1 - Math.exp(-dt * 7);
  st.cur.lerp(st.tgt, k); st.curB.lerp(st.tgtB, k);
  st.uni.uHiA.value.copy(st.cur); st.uni.uHiB.value.copy(st.curB);
  const any = Math.max(st.cur.length(), st.curB.length()) > 0.02;
  const base = st.all ? 0.5 : 0.8, amp = st.all ? 0.14 : 0.2;
  st.uni.uHiK.value = any ? base + amp * Math.sin(time * 5.2) : 0;
}

/* ---------- material patch: emissive muscle glow ---------- */
function patchMaterial(mat, uni = hi.uni) {
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uHiA = uni.uHiA;
    shader.uniforms.uHiB = uni.uHiB;
    shader.uniforms.uHiC = uni.uHiC;
    shader.uniforms.uHiK = uni.uHiK;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
        attribute vec4 aMuscleA; attribute vec4 aMuscleB;
        uniform vec4 uHiA; uniform vec4 uHiB; varying float vHi;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vHi = clamp(dot(aMuscleA, uHiA) + dot(aMuscleB, uHiB), 0.0, 1.0);`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform vec3 uHiC; uniform float uHiK; varying float vHi;`)
      .replace('#include <opaque_fragment>', `outgoingLight += uHiC * (vHi * uHiK * 1.4);
        #include <opaque_fragment>`);
  };
  mat.customProgramCacheKey = () => 'sport-hi';
}

/* ---------- per-vertex muscle masks from the skin weights ---------- */
const smooth = (x, a, b) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
function boneByName(root, frag, not) {
  let found = null;
  root.traverse((o) => {
    if (found || !o.isBone) return;
    const nm = o.name.toLowerCase();
    if (nm.includes(frag) && !(not && nm.includes(not))) found = o;
  });
  return found;
}
function buildMasks(root, smesh) {
  smesh.updateWorldMatrix(true, false);
  const geo = smesh.geometry;
  const n = geo.attributes.position.count;
  const pos = geo.attributes.position, nor = geo.attributes.normal;
  const si = geo.attributes.skinIndex, sw = geo.attributes.skinWeight;
  const A = new Float32Array(n * 4), B = new Float32Array(n * 4);

  /* bind-pose reference frame, in the mesh's LOCAL space */
  const L = (bone) => {
    bone.updateWorldMatrix(true, false);
    return smesh.worldToLocal(bone.getWorldPosition(new THREE.Vector3()));
  };
  const pHip = L(boneByName(root, 'hips'));
  const pHead = L(boneByName(root, 'head', 'top'));
  const up = pHead.clone().sub(pHip).normalize();
  const toe = L(boneByName(root, 'lefttoebase')).add(L(boneByName(root, 'righttoebase'))).multiplyScalar(0.5);
  const fwd = toe.sub(pHip);
  fwd.addScaledVector(up, -fwd.dot(up)).normalize();

  /* arm axis per side, for the deltoid/triceps split along the upper arm */
  const armRef = {};
  for (const side of ['left', 'right']) {
    const sh = L(boneByName(root, side + 'arm'));
    const el = L(boneByName(root, side + 'forearm'));
    const d = el.clone().sub(sh);
    armRef[side] = { sh, dir: d.clone().normalize(), len: Math.max(1e-5, d.length()) };
  }

  const _p = new THREE.Vector3(), _nn = new THREE.Vector3(), _t = new THREE.Vector3();
  for (let i = 0; i < n; i++) {
    _p.fromBufferAttribute(pos, i);
    _nn.fromBufferAttribute(nor, i);
    const fDot = _nn.dot(fwd), uDot = _nn.dot(up);
    const fFront = smooth(fDot, 0.05, 0.45);   // belly-side filter
    const fBack = smooth(-fDot, 0.05, 0.45);   // back-side filter
    /* underside (triceps) filter — Tripo's arm normals are noisy, so this is
     * a soft bias (anything even slightly downward-facing keeps most weight) */
    const fUnder = smooth(-uDot, -0.1, 0.4);
    /* Tripo's skin export ships garbage extra slots (duplicate bones, weights
     * summing past 1) — accumulate only the DOMINANT influence per vertex */
    let bestK = -1, bestW = 0, wSum = 0;
    for (let k = 0; k < 4; k++) {
      const w = sw.getComponent(i, k);
      wSum += w;
      if (w > bestW) { bestW = w; bestK = k; }
    }
    if (bestK < 0 || bestW <= 0.001) continue;
    const wN = bestW / Math.max(1e-5, wSum);
    const nm = smesh.skeleton.bones[si.getComponent(i, bestK)].name.toLowerCase();
    let g = -1, fac = 1, side = null;
    if (nm.includes('spine2')) { g = 0; fac = fFront; }
    else if (/(left|right)(fore)?arm$/.test(nm)) {
      g = 1; fac = fUnder; side = nm.includes('left') ? 'left' : 'right';
    }
    else if (nm.includes('shoulder')) { g = 2; }
    else if (nm.includes('spine')) { g = 3; fac = fFront; }
    else if (nm.includes('hips')) { g = 4; fac = fBack; }
    else if (nm.includes('upleg')) { g = 5; fac = fFront; }
    if (g < 0) continue;
    if (g === 1 && side) {
      /* split the upper arm: shoulder cap -> delts, rest -> triceps */
      const r = armRef[side];
      const t = _t.copy(_p).sub(r.sh).dot(r.dir) / r.len;
      if (t < 0.30) g = 2; else fac *= smooth(t, 0.30, 0.45);
    }
    const val = wN * fac;
    if (g < 4) A[i * 4 + g] += val;
    else B[i * 4 + (g - 4)] += val;
  }
  geo.setAttribute('aMuscleA', new THREE.BufferAttribute(A, 4));
  geo.setAttribute('aMuscleB', new THREE.BufferAttribute(B, 4));
}

/* ---------- stage factory ---------- */
/* opts.hRef: reference aspect for constant-HORIZONTAL-fov framing. The big
 * stage spans a wide horizontal body; a fixed vertical fov crops it on
 * narrow (mobile) canvases, so widen the vertical fov instead — the
 * horizontal framing (and thus the desktop look at hRef) stays identical. */
function makeRenderer(canvas, host, opts = {}) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.35;
  const scene = new THREE.Scene();
  const BASE_FOV = 36;
  const camera = new THREE.PerspectiveCamera(BASE_FOV, 1, 0.05, 60);
  const HFOV = opts.hRef
    ? 2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(BASE_FOV / 2)) * opts.hRef)
    : 0;
  const resize = () => {
    const w = host.clientWidth || 1, h = host.clientHeight || 1;
    renderer.setSize(w, h, false);
    camera.aspect = w / Math.max(1, h);
    if (HFOV) {
      const f = 2 * Math.atan(Math.tan(HFOV / 2) / camera.aspect);
      camera.fov = THREE.MathUtils.clamp(THREE.MathUtils.radToDeg(f), BASE_FOV, 64);
    }
    camera.updateProjectionMatrix();
  };
  new ResizeObserver(resize).observe(host);
  resize();
  scene.add(new THREE.HemisphereLight(0xe6f0ff, 0x4a4640, 2.6));
  const key = new THREE.DirectionalLight(0xffe8d2, 3.4);
  key.position.set(2.2, 3.2, 2.6);
  scene.add(key);
  const rim = new THREE.DirectionalLight(0x86b8ff, 2.6);
  rim.position.set(-2.4, 2.0, -2.6);
  scene.add(rim);
  const fill = new THREE.DirectionalLight(0xffffff, 0.9);
  fill.position.set(0, 1.4, 4);
  scene.add(fill);
  return { renderer, scene, camera };
}

function makeControls(canvas, camera, target) {
  const controls = new OrbitControls(camera, canvas);
  controls.target.copy(target);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.enableZoom = false;
  controls.enablePan = false;
  controls.rotateSpeed = 0.85;
  controls.minPolarAngle = 0.35;
  controls.maxPolarAngle = Math.PI / 2 + 0.1;
  canvas.style.touchAction = 'pan-y';
  return controls;
}

const _v = new THREE.Vector3();
function project(bone, camera, w, h) {
  bone.getWorldPosition(_v).project(camera);
  return { x: (_v.x * 0.5 + 0.5) * w, y: (-_v.y * 0.5 + 0.5) * h };
}

/* azimuth tween for the view buttons */
function makeViewTween(controls, camera) {
  let tw = null;
  return {
    to(dirWorld) {
      const off = camera.position.clone().sub(controls.target);
      const sph = new THREE.Spherical().setFromVector3(off);
      const want = Math.atan2(dirWorld.x, dirWorld.z);
      let d = want - sph.theta;
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      tw = { from: sph.theta, d, t: 0, dur: 0.6, r: sph.radius, phi: sph.phi };
    },
    tick(dt) {
      if (!tw) return;
      tw.t += dt;
      const u = Math.min(1, tw.t / tw.dur);
      const e = u * u * (3 - 2 * u);
      const sph = new THREE.Spherical(tw.r, tw.phi, tw.from + tw.d * e);
      camera.position.setFromSpherical(sph).add(controls.target);
      camera.lookAt(controls.target);
      if (u >= 1) tw = null;
    },
  };
}

async function loadModel() {
  const gltf = await new GLTFLoader().loadAsync(GLB);
  const proto = gltf.scene;
  let mesh = null;
  proto.traverse((o) => { if (o.isSkinnedMesh && !mesh) mesh = o; });
  proto.updateMatrixWorld(true);
  buildMasks(proto, mesh);
  proto.traverse((o) => {
    if (o.isMesh && o.material) {
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      for (let i = 0; i < mats.length; i++) {
        if (mats[i].isMeshStandardMaterial) {
          const m = new THREE.MeshPhongMaterial({
            map: mats[i].map || null,
            normalMap: mats[i].normalMap || null,
            color: mats[i].color.clone(),
            shininess: 16, specular: new THREE.Color(0x181818),
          });
          patchMaterial(m);
          if (Array.isArray(o.material)) o.material[i] = m; else o.material = m;
        } else {
          patchMaterial(mats[i]);
        }
        mats[i].transparent = false;
      }
      o.frustumCulled = false;
    }
  });
  return { proto, clips: gltf.animations };
}

/* ---------- boot both stages ---------- */
(async () => {
  const bigHost = document.getElementById('pu-stage-big');
  const smallHost = document.getElementById('pu-stage-small');
  if (!bigHost) return;

  let model;
  try {
    model = await loadModel();
  } catch (e) {
    console.error('[sport] load failed', e);
    const err = bigHost.querySelector('.stage-error');
    if (err) { err.hidden = false; err.textContent = 'The 3D model failed to load — check your connection and refresh.'; }
    return;
  }
  const hideLoad = (host) => { const el = host.querySelector('.stage-loading'); if (el) el.classList.add('hidden'); };
  const clipOf = (frag) => model.clips.find((c) => c.name.toLowerCase().includes(frag));
  const pushClip = clipOf('push');
  const idleClip = clipOf('idle');

  /* ---- big stage: push-up + callouts + views ---- */
  const bigCanvas = document.getElementById('pu-canvas-big');
  const big = makeRenderer(bigCanvas, bigHost, { hRef: 16 / 9 });
  const rootB = model.proto;
  big.scene.add(rootB);
  rootB.scale.setScalar(1.7);

  /* frame: body axis from the plank pose (clip frame 0) */
  const mixerB = new THREE.AnimationMixer(rootB);
  const actB = mixerB.clipAction(pushClip);
  actB.play();
  actB.time = 0;
  mixerB.update(0);
  rootB.updateMatrixWorld(true);

  const headBone = boneByName(rootB, 'head', 'top');
  const hipsBone = boneByName(rootB, 'hips');
  const footBone = boneByName(rootB, 'leftfoot');
  const handBone = boneByName(rootB, 'lefthand');
  const waistBone = boneByName(rootB, 'spine1');

  /* frame on the FULL plank span (hands -> feet, longer than head -> feet) */
  const pH = handBone.getWorldPosition(new THREE.Vector3());
  const pF = footBone.getWorldPosition(new THREE.Vector3());
  const pHead2 = headBone.getWorldPosition(new THREE.Vector3());
  const mid = pH.clone().add(pF).multiplyScalar(0.5);
  rootB.position.x -= mid.x; rootB.position.z -= mid.z;
  rootB.updateMatrixWorld(true);
  const axis = pF.clone().sub(pH); axis.y = 0; axis.normalize();       // hands -> feet
  const sideDir = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), axis).normalize();

  const bodyLen = pH.distanceTo(pF);
  const dist = bodyLen * 1.3 + 0.65;
  const target = new THREE.Vector3(0, 0.36, 0);
  big.camera.position.copy(sideDir).multiplyScalar(dist).add(target);
  big.camera.position.y += 0.62;
  big.camera.lookAt(target);
  const controlsB = makeControls(bigCanvas, big.camera, target);
  const viewTw = makeViewTween(controlsB, big.camera);
  const views = {
    side: sideDir.clone(),
    head: axis.clone().negate(),
    feet: axis.clone(),
  };

  /* callout overlay — the four cards sit INSIDE the stage near the top,
   * staggered in two rows (top row: hands / legs, second row: waist / hips)
   * so they frame the figure instead of blanketing it; leader lines drop
   * from each card's bottom edge to its body point every frame */
  const ui = document.createElement('div');
  ui.className = 'hero-ui';
  ui.innerHTML = '<svg class="hero-lines"></svg><div class="hero-callouts"></div>';
  bigHost.appendChild(ui);
  const svg = ui.querySelector('.hero-lines');
  const calloutsBox = ui.querySelector('.hero-callouts');
  const CALLS = [
    { tag: 'Hands', txt: 'Under the shoulders, slightly wide. Whole palm pressed down, fingers spread.', bone: handBone },
    { tag: 'Waist', txt: 'One straight line head to heels: ribs down, lower back flat, waist braced.', bone: waistBone },
    { tag: 'Legs', txt: 'Knees locked, feet hip-width. Squeeze the thighs so the knees never bend first.', bone: footBone },
    { tag: 'Hips', txt: 'Level with shoulders and heels — no sagging, no piking. Glutes squeezed.', bone: hipsBone },
  ];
  /* per-card anchors; wide screens stagger across the full stage top,
   * narrow screens fall back to a 2×2 block that still leaves the athlete
   * visible underneath */
  const POS = {
    wide: {   /* first row rides the stage's top edge (~50px above it) */
      Hands: { left: '2.5%', top: '-12%' },
      Waist: { left: '21%', top: '20%' },
      Legs:  { left: '41%', top: '-9%' },
      Hips:  { right: '2.5%', top: '15%' },
    },
    narrow: { /* 2×2 block hugging the top corners, deliberately uneven */
      Hands: { left: '0%', top: '-11%' },
      Legs:  { right: '0%', top: '-7%' },
      Waist: { left: '1.5%', top: '24%' },
      Hips:  { right: '1%', top: '29%' },
    },
  };
  const narrowMQ = window.matchMedia('(max-width: 620px)');
  const callEls = CALLS.map((c) => {
    const el = document.createElement('div');
    el.className = 'hero-callout';
    el.innerHTML = `<span class="tag">${c.tag}</span><span class="txt">${c.txt}</span>`;
    calloutsBox.appendChild(el);
    return el;
  });
  const layoutCallouts = () => {
    const set = narrowMQ.matches ? POS.narrow : POS.wide;
    CALLS.forEach((c, i) => {
      const p = set[c.tag];
      callEls[i].style.left = p.left || 'auto';
      callEls[i].style.right = p.right || 'auto';
      callEls[i].style.top = p.top;
    });
  };
  layoutCallouts();

  /* narrow screens: raise the orbit target (camera follows) so the athlete
   * sits in the LOWER half of the taller phone canvas, clear of the 2×2
   * callout block; desktop framing is untouched */
  let frameY = 0.36;
  const applyNarrowFrame = () => {
    const want = narrowMQ.matches ? 0.64 : 0.36;
    const d = want - frameY;
    frameY = want;
    controlsB.target.y += d;
    big.camera.position.y += d;
    controlsB.update();
  };
  applyNarrowFrame();
  narrowMQ.addEventListener?.('change', () => { layoutCallouts(); applyNarrowFrame(); });
  const polys = CALLS.map(() => {
    const pl = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
    svg.appendChild(pl);
    const dot = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    dot.setAttribute('r', '3.4');
    svg.appendChild(dot);
    return { pl, dot };
  });
  CALLS.forEach((_, i) => setTimeout(() => callEls[i].classList.add('show'), 350 + i * 650));

  function updateCallouts() {
    const rect = bigHost.getBoundingClientRect();
    const w = rect.width, h = rect.height;
    for (let i = 0; i < CALLS.length; i++) {
      if (!callEls[i].classList.contains('show')) continue;
      const p = project(CALLS[i].bone, big.camera, w, h);
      const cr = callEls[i].getBoundingClientRect();
      /* line exits the card's side edge at mid-height, on the side that
       * faces the body point (left edge when the dot sits left of the card) */
      const px = Math.min(w - 6, Math.max(6, p.x));
      const py = Math.min(h - 6, Math.max(6, p.y));
      const cxc = cr.left - rect.left + cr.width / 2;
      const ex = px < cxc ? cr.left - rect.left : cr.right - rect.left;
      const ey = cr.top - rect.top + cr.height / 2;
      polys[i].pl.setAttribute('points', `${ex},${ey} ${px},${ey} ${px},${py}`);
      polys[i].dot.setAttribute('cx', px);
      polys[i].dot.setAttribute('cy', py);
    }
  }

  /* stage bar: views + slow + pause */
  const bar = document.createElement('div');
  bar.className = 'stage-bar';
  bar.innerHTML = `
    <button type="button" class="stage-btn active" data-view="side">Side</button>
    <button type="button" class="stage-btn" data-view="head">Head-on</button>
    <button type="button" class="stage-btn" data-view="feet">From feet</button>
    <button type="button" class="stage-btn slow" id="pu-slow">0.5×</button>
    <button type="button" class="stage-btn" id="pu-play">⏸ Pause</button>`;
  bigHost.appendChild(bar);
  bar.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.view) {
      viewTw.to(views[b.dataset.view]);
      bar.querySelectorAll('[data-view]').forEach((x) => x.classList.toggle('active', x === b));
    } else if (b.id === 'pu-slow') {
      actB.timeScale = actB.timeScale === 1 ? 0.5 : 1;
      b.classList.toggle('on', actB.timeScale !== 1);
    } else if (b.id === 'pu-play') {
      const running = actB.timeScale !== 0;
      actB.timeScale = running ? 0 : 1;
      b.textContent = running ? '▶ Play' : '⏸ Pause';
    }
  });

  /* ---- small stage: idle ---- */
  let small = null;
  let mEls = [], updateMuscleLines = null;   // muscle labels (hoisted for chips)
  if (smallHost) {
    const smallCanvas = document.getElementById('pu-canvas-small');
    small = makeRenderer(smallCanvas, smallHost);
    const rootS = skeletonClone(rootB);
    small.scene.add(rootS);
    /* independent highlight channel: clone the shared materials and re-patch
     * them onto hiS's uniforms so this stage can glow on its own */
    rootS.traverse((o) => {
      if (!o.isMesh || !o.material) return;
      const mk = (m) => { const c = m.clone(); patchMaterial(c, hiS.uni); return c; };
      o.material = Array.isArray(o.material) ? o.material.map(mk) : mk(o.material);
    });
    /* muscle labels: one tag + leader line per push-up muscle, pointing at
     * the glowing fibres; tapping a chip focuses its label and dims the rest */
    const MUS = [
      { key: 'delts',   frag: 'leftshoulder', label: 'Shoulders', pos: { right: '2%', top: '10%' } },
      { key: 'chest',   frag: 'spine2',       label: 'Chest',     pos: { left: '2%', top: '18%' } },
      { key: 'triceps', frag: 'leftforearm',  label: 'Triceps',   pos: { right: '2%', top: '30%' } },
      { key: 'core',    frag: 'spine1',       label: 'Core',      pos: { left: '2%', top: '40%' } },
      { key: 'glutes',  frag: 'hips',         label: 'Glutes',    pos: { right: '2%', top: '50%' } },
      { key: 'quads',   frag: 'leftupleg',    label: 'Quads',     pos: { left: '2%', top: '60%' } },
    ];
    const mui = document.createElement('div');
    mui.className = 'hero-ui';
    mui.innerHTML = '<svg class="hero-lines"></svg><div class="hero-callouts"></div>';
    smallHost.appendChild(mui);
    const msvg = mui.querySelector('.hero-lines');
    const mbox = mui.querySelector('.hero-callouts');
    mEls = MUS.map((m) => {
      const el = document.createElement('div');
      el.className = 'hero-callout pu-mlabel';
      el.dataset.key = m.key;
      el.innerHTML = `<span class="tag">${m.label}</span>`;
      mbox.appendChild(el);
      el.style.left = m.pos.left || 'auto';
      el.style.right = m.pos.right || 'auto';
      el.style.top = m.pos.top;
      setTimeout(() => el.classList.add('show'), 600 + Math.random() * 500);
      return el;
    });
    const mLines = MUS.map(() => {
      const pl = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
      msvg.appendChild(pl);
      const dot = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      dot.setAttribute('r', '3');
      msvg.appendChild(dot);
      return { pl, dot };
    });
    const mBones = MUS.map((m) => boneByName(rootS, m.frag));
    updateMuscleLines = () => {
      const rect = smallHost.getBoundingClientRect();
      const w = rect.width, h = rect.height;
      for (let i = 0; i < MUS.length; i++) {
        if (!mEls[i].classList.contains('show')) continue;
        const p = project(mBones[i], small.camera, w, h);
        const cr = mEls[i].getBoundingClientRect();
        const px = Math.min(w - 4, Math.max(4, p.x));
        const py = Math.min(h - 4, Math.max(4, p.y));
        const cxc = cr.left - rect.left + cr.width / 2;
        const ex = px < cxc ? cr.left - rect.left : cr.right - rect.left;
        const ey = cr.top - rect.top + cr.height / 2;
        mLines[i].pl.setAttribute('points', `${ex},${ey} ${px},${ey} ${px},${py}`);
        mLines[i].dot.setAttribute('cx', px);
        mLines[i].dot.setAttribute('cy', py);
      }
    };
    /* explicit placement — the clone inherits rootB's recentering offset */
    rootS.position.set(0, 0, 0);
    rootS.rotation.y = -0.45;
    rootS.scale.setScalar(1.7);
    const mixerS = new THREE.AnimationMixer(rootS);
    mixerS.clipAction(idleClip).play();
    const h = 0.98 * 1.7;
    const targetS = new THREE.Vector3(0, h * 0.5, 0);
    small.camera.position.set(0.55, h * 0.8, h * 1.6);
    small.camera.lookAt(targetS);
    small.controls = makeControls(smallCanvas, small.camera, targetS);
    small.mixer = mixerS;
    small.root = rootS;
    hideLoad(smallHost);
  }
  hideLoad(bigHost);

  /* ---------- visibility gate: the homepage scroll-jank fix ----------
   * Both WebGL canvases rendered unconditionally = constant GPU work while
   * scrolling (and getBoundingClientRect callout layout). Only tick+render
   * stages that are actually on screen; the rAF loop itself stays cheap. */
  const vis = { big: true, small: true };
  if ('IntersectionObserver' in window) {
    const obs = new IntersectionObserver((entries) => {
      for (const en of entries) {
        vis[en.target === bigHost ? 'big' : 'small'] = en.isIntersecting;
      }
    }, { rootMargin: '100px' });
    obs.observe(bigHost);
    if (smallHost) obs.observe(smallHost);
  }

  /* ---------- shared loop ---------- */
  const clock = new THREE.Clock();
  let time = 0;
  (function tickFrame() {
    requestAnimationFrame(tickFrame);
    const dt = Math.min(0.05, clock.getDelta());
    time += dt;
    tickHighlight(dt, time);
    tickHighlight(dt, time, hiS);
    if (vis.big) {
      viewTw.tick(dt);
      mixerB.update(dt);
      controlsB.update();
      big.renderer.render(big.scene, big.camera);
      updateCallouts();
    }
    if (small && vis.small) {
      small.mixer.update(dt);
      small.controls.update();
      small.renderer.render(small.scene, small.camera);
      if (updateMuscleLines) updateMuscleLines();
    }
  })();

  /* ---------- muscle chips ---------- */
  const noteEl = document.getElementById('pu-muscle-note');
  const chips = [...document.querySelectorAll('.pu-muscle')];
  chips.forEach((b) => b.addEventListener('click', () => {
    const key = b.dataset.g || '';
    const on = !b.classList.contains('active') && !!key;
    chips.forEach((x) => x.classList.toggle('active', on && x === b));
    setGroup(on ? key : '');
    mEls.forEach((el) => {
      el.classList.toggle('focus', on && el.dataset.key === key);
      el.classList.toggle('dim', on && el.dataset.key !== key);
    });
    if (noteEl) {
      noteEl.textContent = on ? MUSCLE_NOTES[key] : 'Tap a muscle to light it up on both stages.';
      noteEl.classList.toggle('on', !!on);
    }
  }));

  /* ---------- QA handles ---------- */
  window.__pu = {
    setGroup,
    seekBig: (t) => { actB.time = ((t % pushClip.duration) + pushClip.duration) % pushClip.duration; mixerB.update(0); },
    big: { mixer: mixerB, act: actB, camera: big.camera, controls: controlsB, root: rootB, scene: big.scene },
    small: small ? { camera: small.camera, controls: small.controls, mixer: small.mixer, root: small.root, scene: small.scene } : null,
    groups: GROUPS.map((g) => g.key),
    hi,
    hiS,
  };
})();
