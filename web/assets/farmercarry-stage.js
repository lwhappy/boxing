/* SilentJab — sport stage: the farmer's carry form-check page
 * (/sport/farmer-carry/)
 * ----------------------------------------------------------------------------
 * Two stages share one GLB (sport-squat.glb: Tripo man + idle + air-squat):
 *   • big stage   — loops the air squat, four form-callout cards (chest / hips /
 *                   knees / feet) with leader lines that track the bones every
 *                   frame, view buttons (side / front / back), play+slow;
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
 * Deterministic QA: window.__sq exposes { setGroup, seekBig, big, small }.
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { clone as skeletonClone } from 'three/addons/utils/SkeletonUtils.js';

const GLB = new URL('../media/glb/sport-farmercarry.glb?v=4', import.meta.url).href;

/* ---------- muscle groups (attribute slot order matters: A0..A3, B0..B1) --- */
const GROUPS = [
  { key: 'forearms', slot: 'A', idx: 0 },
  { key: 'traps',    slot: 'A', idx: 1 },
  { key: 'delts',    slot: 'A', idx: 2 },
  { key: 'core',     slot: 'A', idx: 3 },
  { key: 'glutes',   slot: 'B', idx: 0 },
  { key: 'quads',    slot: 'B', idx: 1 },
];
const MUSCLE_NOTES = {
  forearms: 'The limiter. Grip endurance is what ends a carry, not the legs — the fingers, wrist flexors and forearm flexors hold the load shut.',
  traps: 'The yoke. Upper traps and rhomboids keep the shoulders pinned down and back while the weights try to drag them out of the socket.',
  delts: 'The stabilisers. Shoulders stay packed and quiet, resisting the pull that wants to swing the arms away from the body.',
  core: 'The brace. Abs and obliques lock the ribcage over the pelvis so the load cannot fold you sideways or pull you into a lean.',
  glutes: 'The pelvic floor of the walk. Glutes hold the pelvis level and drive each short, controlled step.',
  quads: 'The march. Quads take the load down and up on every step — quiet feet, no bounce.',
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
 * squat muscle lit, while the big stage stays clean until a chip is tapped */
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
hiS.tgt.set(1, 1, 1, 1); hiS.tgtB.set(1, 1, 0, 0);  // idle = every squat muscle
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
  mat.customProgramCacheKey = () => 'squat-hi';
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
    let g = -1, fac = 1;
    if (nm.includes('forearm')) { g = 0; }
    else if (nm.includes('spine2')) { g = 1; fac = fBack; }   /* traps / upper back */
    else if (nm.includes('shoulder')) { g = 2; }
    else if (nm.includes('spine')) { g = 3; fac = fFront; }
    else if (nm.includes('hips')) { g = 4; fac = fBack; }
    else if (nm.includes('upleg')) { g = 5; fac = fFront; }
    if (g < 0) continue;
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
  const bigHost = document.getElementById('fc-stage-big');
  const smallHost = document.getElementById('fc-stage-small');
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
  const carryClip = clipOf('carry') || model.clips[0];

  /* ---- dumbbells: a pair of hex-head bells built in three.js and pinned
   *      into the palms every frame (bone-parented props get scrambled by the
   *      GLB's export-time rest reset — the barbell lesson).
   *      Geometry is sized from the hand itself, and the bar runs along the
   *      knuckle line (index -> pinky), which is the axis a real grip closes
   *      around; the old build laid the bar across the body, so from the side
   *      it read as a single black disc. ---- */
  const XAXIS = new THREE.Vector3(1, 0, 0);
  const boneExact = (root, nm) => {
    let f = null;
    root.traverse((o) => { if (f || !o.isBone) return; if (o.name.toLowerCase().endsWith(nm)) f = o; });
    return f;
  };
  function makeDumbbell(hLen) {
    const g = new THREE.Group();
    g.name = 'fc-dumbbell';
    const steel = new THREE.MeshPhongMaterial({ color: 0xc9cfd6, shininess: 150, specular: new THREE.Color(0x9ba2ab) });
    const knurl = new THREE.MeshPhongMaterial({ color: 0x8e959d, shininess: 55, specular: new THREE.Color(0x6b727a) });
    const rubber = new THREE.MeshPhongMaterial({ color: 0x23272c, shininess: 26, specular: new THREE.Color(0x525860) });
    const collar = new THREE.MeshPhongMaterial({ color: 0x6f767e, shininess: 120, specular: new THREE.Color(0x5a6169) });

    const shaftR = 0.082 * hLen, shaftL = 0.95 * hLen;
    const headR = 0.36 * hLen, headW = 0.40 * hLen;
    const tube = (r, len, seg) => {
      const geo = new THREE.CylinderGeometry(r, r, len, seg);
      geo.rotateZ(Math.PI / 2);                 // bar runs along local X
      return geo;
    };

    g.add(new THREE.Mesh(tube(shaftR, shaftL, 20), steel));
    const grip = new THREE.Mesh(tube(shaftR * 1.1, shaftL * 0.5, 20), knurl);
    g.add(grip);
    for (const sgn of [-1, 1]) {
      const head = new THREE.Mesh(tube(headR, headW, 6), rubber);   // hex block
      head.position.x = sgn * (shaftL / 2 + headW * 0.5);
      g.add(head);
      const cap = new THREE.Mesh(tube(headR * 0.74, headW * 0.18, 6), collar);
      cap.position.x = sgn * (shaftL / 2 + headW * 0.92);
      g.add(cap);
    }
    g.traverse((o) => { if (o.isMesh) o.frustumCulled = false; });
    return g;
  }
  function handMeasure(root) {
    const h = boneExact(root, 'lefthand'), m = boneExact(root, 'lefthandmiddle1');
    if (!h || !m) return 0.1;
    const a = h.getWorldPosition(new THREE.Vector3());
    const b = m.getWorldPosition(new THREE.Vector3());
    return Math.max(0.02, a.distanceTo(b));
  }
  const _h = new THREE.Vector3(), _k = new THREE.Vector3();
  const _i = new THREE.Vector3(), _p = new THREE.Vector3(), _ax = new THREE.Vector3();
  function pinOne(root, db, hand, idx, pinky, mid) {
    if (!hand || !idx || !pinky || !mid) return;
    hand.getWorldPosition(_h); root.worldToLocal(_h);
    mid.getWorldPosition(_k); root.worldToLocal(_k);
    idx.getWorldPosition(_i); root.worldToLocal(_i);
    pinky.getWorldPosition(_p); root.worldToLocal(_p);
    db.position.copy(_h).lerp(_k, 0.52);      // grip sits in the palm
    _ax.subVectors(_p, _i);                    // index -> pinky = bar axis
    if (_ax.lengthSq() < 1e-12) return;
    db.quaternion.setFromUnitVectors(XAXIS, _ax.normalize());
  }
  function pinProps(p) {
    if (!p.root) return;
    p.root.updateMatrixWorld(true);
    pinOne(p.root, p.dbL, p.handL, p.idxL, p.pinkL, p.midL);
    pinOne(p.root, p.dbR, p.handR, p.idxR, p.pinkR, p.midR);
  }
  function attachProps(root) {
    const hLen = handMeasure(root);
    const dbL = makeDumbbell(hLen), dbR = makeDumbbell(hLen);
    root.add(dbL); root.add(dbR);
    const p = {
      root, dbL, dbR, hLen,
      handL: boneExact(root, 'lefthand'), handR: boneExact(root, 'righthand'),
      idxL: boneExact(root, 'lefthandindex1'), idxR: boneExact(root, 'righthandindex1'),
      pinkL: boneExact(root, 'lefthandpinky1'), pinkR: boneExact(root, 'righthandpinky1'),
      midL: boneExact(root, 'lefthandmiddle1'), midR: boneExact(root, 'righthandmiddle1'),
    };
    pinProps(p);
    return p;
  }

  /* ---- big stage: the grab intro + carry walk + callouts + views ----
   * Choreography (the barbell lesson, applied): both bells start ON THE
   * FLOOR; the grab clip plays once (bend down, take hold, stand up), then
   * the carry takes over and loops. Each bell rests at a fixed floor pose
   * built EXACTLY like the hands pose at the contact frame, so the
   * ground->hands switch is pixel-identical — no flash, no roll. */
  const bigCanvas = document.getElementById('fc-canvas-big');
  const big = makeRenderer(bigCanvas, bigHost, { hRef: 16 / 9 });
  const rootB = model.proto;
  big.scene.add(rootB);
  rootB.scale.setScalar(1.7);

  const grabClip = clipOf('grab');
  const mixerB = new THREE.AnimationMixer(rootB);
  const actB = mixerB.clipAction(carryClip);
  const actGrab = grabClip ? mixerB.clipAction(grabClip) : null;
  let phase = actGrab ? 'grab' : 'carry';
  let dbMode = actGrab ? 'ground' : 'hands';   // 'ground' -> floor rest, then 'hands'
  let contactT = Infinity;                     // grab-clip time both palms arrive
  const startCarry = () => {
    if (phase === 'carry') return;
    phase = 'carry'; dbMode = 'hands';
    actB.reset().play();
    if (actGrab && actGrab.isRunning()) actB.crossFadeFrom(actGrab, 0.3, false);
    else if (actGrab) actGrab.stop();
  };
  if (actGrab) {
    mixerB.addEventListener('finished', startCarry);
    actGrab.setLoop(THREE.LoopOnce, 1);
    actGrab.clampWhenFinished = true;
    /* activate now so the floor-contact scan below can evaluate poses;
     * it stays paused until the scan is done, then the intro begins */
    actGrab.reset().play();
    actGrab.paused = true;
  } else {
    actB.play();
    actB.time = 0;
  }
  mixerB.update(0);
  rootB.updateMatrixWorld(true);

  const propsB = attachProps(rootB);

  /* ---- bells floor rest + ground->hands switch ----
   * rests are captured in ROOT-LOCAL space by pinning the bells with the
   * contact-frame pose — the exact same construction hands mode uses — then
   * frozen. The switch therefore cannot flash: identical position, identical
   * quaternion, to the last bit. */
  const restL = { pos: new THREE.Vector3(), quat: new THREE.Quaternion() };
  const restR = { pos: new THREE.Vector3(), quat: new THREE.Quaternion() };
  function captureRest(p) {
    p.root.updateMatrixWorld(true);
    pinOne(p.root, p.dbL, p.handL, p.idxL, p.pinkL, p.midL);
    pinOne(p.root, p.dbR, p.handR, p.idxR, p.pinkR, p.midR);
    restL.pos.copy(p.dbL.position); restL.quat.copy(p.dbL.quaternion);
    restR.pos.copy(p.dbR.position); restR.quat.copy(p.dbR.quaternion);
  }
  function updateProps(p) {
    if (!p.root) return;
    p.root.updateMatrixWorld(true);
    if (phase === 'grab' && dbMode === 'ground' && actGrab && actGrab.time >= contactT) {
      dbMode = 'hands';
    }
    if (dbMode === 'ground') {
      p.dbL.position.copy(restL.pos); p.dbL.quaternion.copy(restL.quat);
      p.dbR.position.copy(restR.pos); p.dbR.quaternion.copy(restR.quat);
      return;
    }
    pinOne(p.root, p.dbL, p.handL, p.idxL, p.pinkL, p.midL);
    pinOne(p.root, p.dbR, p.handR, p.idxR, p.pinkR, p.midR);
  }
  if (actGrab) {
    /* scan the grab clip for the lowest PALM MIDPOINT (= bells on the floor),
     * freeze the rest poses there, then rewind and let the intro play */
    let bestT = 0, bestY = Infinity;
    const n = 120;
    for (let i = 0; i <= n; i++) {
      actGrab.time = (i / n) * grabClip.duration;
      mixerB.update(0);
      captureRest(propsB);
      const y = (restL.pos.y + restR.pos.y) * 0.5;
      if (y < bestY) { bestY = y; bestT = actGrab.time; }
    }
    contactT = bestT;
    actGrab.time = bestT;
    mixerB.update(0);
    captureRest(propsB);       // final capture at the contact frame itself
    console.log('[sport] bells contact at', bestT.toFixed(2) + 's', 'of',
      grabClip.duration.toFixed(2) + 's');
    /* IMPORTANT: rewind BEFORE the first updateProps — the scan left
     * actGrab.time at contactT, which would trip the ground->hands flip
     * and pin the bells to the palms from frame one */
    dbMode = 'ground';
    actGrab.time = 0;
    actGrab.paused = false;
    updateProps(propsB);
  }

  const hipsBone = boneByName(rootB, 'hips');
  const footBone = boneByName(rootB, 'leftfoot');
  const footR = boneByName(rootB, 'rightfoot');
  const toeL = boneByName(rootB, 'lefttoebase');
  const chestBone = boneByName(rootB, 'spine2');
  const ribBone = boneByName(rootB, 'spine1');
  const handBone = boneExact(rootB, 'lefthand');

  /* centre the stance under the camera */
  const pL = footBone.getWorldPosition(new THREE.Vector3());
  const pR = footR.getWorldPosition(new THREE.Vector3());
  const mid = pL.clone().add(pR).multiplyScalar(0.5);
  rootB.position.x -= mid.x; rootB.position.z -= mid.z;
  rootB.updateMatrixWorld(true);
  /* facing averaged over the whole gait: any single frame of a walk has the
   * pelvis rotated and one foot mid-swing, which used to park the "side"
   * camera behind the athlete. Averaging the toe vectors over one cycle gives
   * the true travel direction, so the side view is a clean profile. */
  const UP = new THREE.Vector3(0, 1, 0);
  const toeR = boneByName(rootB, 'righttoebase');
  const acc = new THREE.Vector3();
  for (let i = 0; i < 12; i++) {
    mixerB.setTime((i / 12) * carryClip.duration);
    rootB.updateMatrixWorld(true);
    for (const [ft, toe] of [[footBone, toeL], [footR, toeR]]) {
      if (!ft || !toe) continue;
      const d = toe.getWorldPosition(new THREE.Vector3())
        .sub(ft.getWorldPosition(new THREE.Vector3()));
      d.y = 0;
      if (d.lengthSq() > 1e-8) acc.add(d.normalize());
    }
  }
  mixerB.setTime(0);
  rootB.updateMatrixWorld(true);
  const facing = acc.lengthSq() > 1e-8 ? acc.normalize() : new THREE.Vector3(0, 0, 1);
  const sideDir = new THREE.Vector3().crossVectors(UP, facing).normalize();

  const dist = 3.0;
  const target = new THREE.Vector3(0, 0.78, 0);
  big.camera.position.copy(sideDir).multiplyScalar(dist).add(target);
  big.camera.position.y += 0.25;
  big.camera.lookAt(target);
  const controlsB = makeControls(bigCanvas, big.camera, target);
  const viewTw = makeViewTween(controlsB, big.camera);
  const views = { side: sideDir.clone(), front: facing.clone(), back: facing.clone().negate() };

  const ui = document.createElement('div');
  ui.className = 'hero-ui';
  ui.innerHTML = '<svg class="hero-lines"></svg><div class="hero-callouts"></div>';
  bigHost.appendChild(ui);
  const svg = ui.querySelector('.hero-lines');
  const calloutsBox = ui.querySelector('.hero-callouts');
  /* Cue wording follows the standard dumbbell-carry coaching card: start at
   * full extension, neutral spine + braced abs, chest up / shoulders back,
   * quick smooth steps. */
  const CALLS = [
    { tag: 'Start', txt: 'Deadlift the dumbbells to full hip and knee extension — handle centred in the palm.', bone: hipsBone },
    { tag: 'Spine', txt: 'Maintain a neutral spine and contract the abdominals — ribs stacked over the pelvis.', bone: ribBone },
    { tag: 'Chest', txt: 'Keep the chest up and the shoulders back — no shrug, no forward roll.', bone: chestBone },
    { tag: 'Feet', txt: 'Take quick, smooth steps — whole foot planted, no bounce, no lateral sway.', bone: footBone },
  ];
  const POS = {
    wide: {
      Spine: { left: '2.5%', top: '-12%' },
      Start: { left: '2.5%', top: '34%' },
      Chest: { right: '2.5%', top: '-9%' },
      Feet:  { right: '2.5%', top: '30%' },
    },
    narrow: {
      Spine: { left: '0%', top: '-17%' },
      Start: { right: '0%', top: '-7%' },
      Chest: { left: '0%', top: '14%' },
      Feet:  { right: '0%', top: '18%' },
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

  let frameY = 0.78;
  let frameX = 0;
  const applyNarrowFrame = () => {
    const want = narrowMQ.matches ? 1.24 : 0.78;
    const d = want - frameY; frameY = want;
    controlsB.target.y += d; big.camera.position.y += d;
    const wantX = narrowMQ.matches ? 0.42 : 0;
    const dx = wantX - frameX; frameX = wantX;
    controlsB.target.x += dx; big.camera.position.x += dx;
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
      const b = CALLS[i].bone;
      if (!b) continue;
      const p = project(b, big.camera, w, h);
      const cr = callEls[i].getBoundingClientRect();
      const px = Math.min(w - 6, Math.max(6, p.x));
      const py = Math.min(h - 6, Math.max(6, p.y));
      const onLeft = callEls[i].style.left !== 'auto';
      const ex = onLeft ? cr.right - rect.left : cr.left - rect.left;
      const ey = cr.top - rect.top + cr.height / 2;
      polys[i].pl.setAttribute('points', `${ex},${ey} ${px},${ey} ${px},${py}`);
      polys[i].dot.setAttribute('cx', px);
      polys[i].dot.setAttribute('cy', py);
    }
  }

  const bar = document.createElement('div');
  bar.className = 'stage-bar';
  bar.innerHTML = `
    <span class="sq-grp">
      <button type="button" class="stage-btn active" data-view="side">Side</button>
      <button type="button" class="stage-btn" data-view="front">Front</button>
      <button type="button" class="stage-btn" data-view="back">Back</button>
    </span>
    <span class="sq-grp">
      <button type="button" class="stage-btn slow" id="fc-slow">0.5×</button>
      <button type="button" class="stage-btn" id="fc-play">⏸ Pause</button>
    </span>`;
  bigHost.appendChild(bar);
  const setSpeed = (v) => {
    actB.timeScale = v;
    if (actGrab) actGrab.timeScale = v;
    if (small) small.mixer.timeScale = 0.6 * v;
  };
  bar.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.view) {
      viewTw.to(views[b.dataset.view]);
      bar.querySelectorAll('[data-view]').forEach((x) => x.classList.toggle('active', x === b));
    } else if (b.id === 'fc-slow') {
      const slow = actB.timeScale === 1;
      setSpeed(slow ? 0.5 : 1);
      b.classList.toggle('on', slow);
    } else if (b.id === 'fc-play') {
      const running = actB.timeScale !== 0;
      setSpeed(running ? 0 : 1);
      b.textContent = running ? '▶ Play' : '⏸ Pause';
    }
  });

  /* ---- small stage: same walk, slower, orbitable ---- */
  let small = null;
  let mEls = [], updateMuscleLines = null;
  if (smallHost) {
    const smallCanvas = document.getElementById('fc-canvas-small');
    small = makeRenderer(smallCanvas, smallHost);
    const rootS = skeletonClone(rootB);
    /* skeletonClone copies the WHOLE subtree — including the pair of bells the
     * big stage already hung in its hands. Left in, each hand of the small
     * stage ended up holding two of them. Strip the inherited pair, then let
     * attachProps(rootS) build its own. */
    const inherited = [];
    rootS.traverse((o) => { if (o.name === 'fc-dumbbell') inherited.push(o); });
    for (const o of inherited) if (o.parent) o.parent.remove(o);
    small.scene.add(rootS);
    rootS.position.set(0, 0, 0);
    rootS.rotation.y = -0.45;
    rootS.scale.setScalar(1.7);
    rootS.traverse((o) => {
      if (!o.isMesh || !o.material) return;
      const mk = (m) => { const c = m.clone(); patchMaterial(c, hiS.uni); return c; };
      o.material = Array.isArray(o.material) ? o.material.map(mk) : mk(o.material);
    });
    const propsS = attachProps(rootS);
    small.props = propsS;

    const MUS = [
      { key: 'traps',    frag: 'leftshoulder', label: 'Traps',    pos: { right: '2%', top: '10%' } },
      { key: 'delts',    frag: 'spine2',       label: 'Shoulders', pos: { left: '2%', top: '18%' } },
      { key: 'core',     frag: 'spine1',       label: 'Core',     pos: { right: '2%', top: '32%' } },
      { key: 'forearms', frag: 'leftforearm',  label: 'Grip',     pos: { left: '2%', top: '46%' } },
      { key: 'glutes',   frag: 'hips',         label: 'Glutes',   pos: { right: '2%', top: '58%' } },
      { key: 'quads',    frag: 'leftupleg',    label: 'Quads',    pos: { left: '2%', top: '70%' } },
    ];
    const mui = document.createElement('div');
    mui.className = 'hero-ui';
    mui.innerHTML = '<svg class="hero-lines"></svg><div class="hero-callouts"></div>';
    smallHost.appendChild(mui);
    const msvg = mui.querySelector('.hero-lines');
    const mbox = mui.querySelector('.hero-callouts');
    mEls = MUS.map((m) => {
      const el = document.createElement('div');
      el.className = 'hero-callout fc-mlabel';
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
    const mixerS = new THREE.AnimationMixer(rootS);
    mixerS.clipAction(clipOf('carry') || model.clips[0]).play();
    mixerS.timeScale = 0.6;
    const h = 0.98 * 1.7;
    /* the walk stands taller than the old idle and swings the legs wider, so
     * the small stage sits a little further back and lower or the feet clip */
    const targetS = new THREE.Vector3(0, h * 0.48, 0);
    small.camera.position.set(0.62, h * 0.62, h * 1.95);
    small.camera.lookAt(targetS);
    small.controls = makeControls(smallCanvas, small.camera, targetS);
    small.mixer = mixerS;
    small.root = rootS;
    hideLoad(smallHost);
  }
  hideLoad(bigHost);

  const vis = { big: true, small: true };
  if ('IntersectionObserver' in window) {
    const obs = new IntersectionObserver((entries) => {
      for (const en of entries) vis[en.target === bigHost ? 'big' : 'small'] = en.isIntersecting;
    }, { rootMargin: '100px' });
    obs.observe(bigHost);
    if (smallHost) obs.observe(smallHost);
  }

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
      updateProps(propsB);
      controlsB.update();
      big.renderer.render(big.scene, big.camera);
      updateCallouts();
    }
    if (small && vis.small) {
      small.mixer.update(dt);
      pinProps(small.props);
      small.controls.update();
      small.renderer.render(small.scene, small.camera);
      if (updateMuscleLines) updateMuscleLines();
    }
  })();

  const noteEl = document.getElementById('fc-muscle-note');
  const chips = [...document.querySelectorAll('.fc-muscle')];
  const applyMuscle = (key, btn) => {
    chips.forEach((x) => x.classList.toggle('active', !!key && x === btn));
    setGroup(key);
    mEls.forEach((el) => {
      el.classList.toggle('focus', !!key && el.dataset.key === key);
      el.classList.toggle('dim', !!key && el.dataset.key !== key);
    });
    if (noteEl) {
      noteEl.textContent = key ? MUSCLE_NOTES[key] : 'Tap a muscle to light it up on both stages.';
      noteEl.classList.toggle('on', !!key);
    }
  };
  chips.forEach((b) => b.addEventListener('click', () => {
    applyMuscle(b.classList.contains('active') ? '' : b.dataset.g, b);
  }));
  mEls.forEach((el) => el.addEventListener('click', () => {
    const key = el.dataset.key;
    if (!key) return;
    applyMuscle(el.classList.contains('focus') ? '' : key, chips.find((c) => c.dataset.g === key));
  }));

  window.__fc = {
    setGroup,
    phase: () => phase,
    dbMode: () => dbMode,
    seekBig: (t) => { startCarry(); actB.time = ((t % carryClip.duration) + carryClip.duration) % carryClip.duration; mixerB.update(0); updateProps(propsB); },
    big: { mixer: mixerB, act: actB, actGrab, camera: big.camera, controls: controlsB, root: rootB, scene: big.scene },
    updateProps: () => updateProps(propsB),
    small: small ? { camera: small.camera, controls: small.controls, mixer: small.mixer, root: small.root, scene: small.scene } : null,
    groups: GROUPS.map((g) => g.key),
    props: propsB,
    hi,
    hiS,
  };
})();
