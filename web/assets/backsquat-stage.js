/* SilentJab — sport stage: the back-squat form-check page (/sport/back-squat/)
 * ----------------------------------------------------------------------------
 * Two stages share one GLB (sport-backsquat.glb: Tripo man + idle + back-squat + a modelled barbell under Spine2):
 *   • big stage   — loops the loaded back squat, four form-callout cards (bar / hips /
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
 * Deterministic QA: window.__bs exposes { setGroup, seekBig, big, small }.
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { clone as skeletonClone } from 'three/addons/utils/SkeletonUtils.js';

const GLB = new URL('../media/glb/sport-backsquat.glb?v=5', import.meta.url).href;

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
  quads: 'The prime mover. They bend and straighten the knees under the whole load — depth lives here.',
  glutes: 'The power of the drive. Loaded hardest out of the hole, they extend the hips back to standing.',
  core: 'The brace that carries the bar. Abs and obliques press against the belt of air so the spine never folds.',
  chest: 'Upright torso. A proud chest keeps the bar over mid-foot instead of dragging you forward onto your toes.',
  delts: 'The bar shelf. The rear delts and traps hold the bar in the groove below the neck — no shrugging.',
  triceps: 'Elbow lock. Firm triceps pin the bar in place on the shoulders and stop the elbows from drifting.',
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
  mat.customProgramCacheKey = () => 'backsquat-hi';
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
  const bigHost = document.getElementById('bs-stage-big');
  const smallHost = document.getElementById('bs-stage-small');
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
  const squatClip = clipOf('squat');
  const idleClip = clipOf('idle');
  const grabClip = clipOf('grab');

  /* ---- big stage: bar sequence + callouts + views ----
   * Choreography: the bar starts ON THE FLOOR; the grab-bar clip plays once
   * (reach down, take the bar, bring it up to the shoulders), then the
   * loaded back squat takes over and loops. The bar rests at a fixed floor
   * pose until the hands reach it, then rides the palms. */
  const bigCanvas = document.getElementById('bs-canvas-big');
  const big = makeRenderer(bigCanvas, bigHost, { hRef: 16 / 9 });
  const rootB = model.proto;
  big.scene.add(rootB);
  rootB.scale.setScalar(1.7);

  const mixerB = new THREE.AnimationMixer(rootB);
  const actB = mixerB.clipAction(squatClip);
  const actGrab = grabClip ? mixerB.clipAction(grabClip) : null;
  let phase = actGrab ? 'grab' : 'squat';
  let barMode = 'ground';          // 'ground' -> fixed floor pose, then 'hands'
  let contactT = Infinity;         // grab-clip time at which both hands arrive
  const startSquat = () => {
    if (phase === 'squat') return;
    phase = 'squat'; barMode = 'hands';
    actB.reset().play();
    if (actGrab && actGrab.isRunning()) actB.crossFadeFrom(actGrab, 0.3, false);
    else if (actGrab) actGrab.stop();
  };
  if (actGrab) {
    mixerB.addEventListener('finished', startSquat);
    actGrab.setLoop(THREE.LoopOnce, 1);
    actGrab.clampWhenFinished = true;
    /* activate now so the floor-contact scan below can evaluate poses;
     * it stays paused until the scan is done, then the intro begins */
    actGrab.reset().play();
    actGrab.paused = true;
  } else {
    actB.play();
  }
  mixerB.update(0);
  rootB.updateMatrixWorld(true);

  const hipsBone = boneByName(rootB, 'hips');
  const footBone = boneByName(rootB, 'leftfoot');
  const kneeBone = boneByName(rootB, 'leftleg');
  const chestBone = boneByName(rootB, 'spine2');
  const footR = boneByName(rootB, 'rightfoot');
  const toeL = boneByName(rootB, 'lefttoebase');

  /* centre the stance under the camera */
  const pL = footBone.getWorldPosition(new THREE.Vector3());
  const pR = footR.getWorldPosition(new THREE.Vector3());
  const mid = pL.clone().add(pR).multiplyScalar(0.5);
  rootB.position.x -= mid.x; rootB.position.z -= mid.z;
  rootB.updateMatrixWorld(true);
  const facing = toeL.getWorldPosition(new THREE.Vector3())
    .sub(footBone.getWorldPosition(new THREE.Vector3()));
  facing.y = 0; facing.normalize();                                   // belly side
  const sideDir = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), facing).normalize();

  /* ---- the barbell: re-attach to the root and pin it to the hands ----
   * The GLB ships the bar bone-parented to Spine2 at ONE baked frame, so as
   * soon as the spine animates the hands drift off the steel. Hands are the
   * truth: every frame we rebuild the bar's pose from the hand joints —
   * midpoint onto the shaft, shaft axis along the hand-to-hand line. (Roll
   * around that axis is unconstrained: shaft and plates are rotationally
   * symmetric.) The shaft's local axis is detected from its bounding box so
   * the glTF Y-up conversion can't fool us. */
  const boneExact = (root, nm) => {
    let f = null;
    root.traverse((o) => { if (f || !o.isBone) return; if (o.name.toLowerCase().endsWith(nm)) f = o; });
    return f;
  };
  const handLB = boneExact(rootB, 'lefthand');
  const handRB = boneExact(rootB, 'righthand');
  const knucLB = boneExact(rootB, 'lefthandmiddle1');
  const knucRB = boneExact(rootB, 'righthandmiddle1');
  /* the bar must pass through the PALM centre, not the wrist joint —
   * walk 45% of the way from each wrist toward the middle knuckle */
  const PALM_T = 0.45;
  let barBell = null, shaftAxis = null;
  rootB.traverse((o) => {
    if (barBell || !o.isMesh || !o.name.toLowerCase().includes('barbell')) return;
    barBell = o;
    o.geometry.computeBoundingBox();
    const s = o.geometry.boundingBox.getSize(new THREE.Vector3());
    shaftAxis = s.x >= s.y && s.x >= s.z ? new THREE.Vector3(1, 0, 0)
      : s.y >= s.z ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(0, 0, 1);
  });
  const _qa = new THREE.Vector3(), _qb = new THREE.Vector3(), _qm = new THREE.Vector3();
  const _qrot = new THREE.Quaternion();
  const _wa = new THREE.Vector3(), _wb = new THREE.Vector3(), _wc = new THREE.Vector3();
  const _qp = new THREE.Vector3();
  function palmPoint(hand, knuc, out) {
    hand.getWorldPosition(out);
    knuc.getWorldPosition(_qp).sub(out).multiplyScalar(PALM_T);
    return out.add(_qp);
  }
  /* ground rest: the bar lies on the floor in front of the athlete, right
   * where the hands will arrive at the bottom of the reach — measured by
   * scanning the grab clip for the frame with the lowest palm midpoint */
  const barRest = { pos: new THREE.Vector3(), axis: null };
  function updateBar() {
    if (!barBell || !handLB || !handRB) return;
    rootB.updateMatrixWorld(true);
    if (phase === 'grab') {
      if (actGrab.time >= contactT) barMode = 'hands';
    }
    if (barMode === 'ground') {
      barBell.position.copy(rootB.worldToLocal(barRest.pos.clone()));
      _qrot.copy(rootB.getWorldQuaternion(new THREE.Quaternion()).invert());
      _qm.copy(barRest.axis).applyQuaternion(_qrot);
      barBell.quaternion.setFromUnitVectors(shaftAxis, _qm);
      return;
    }
    palmPoint(handLB, knucLB, _qa);
    palmPoint(handRB, knucRB, _qb);
    _qm.copy(_qb).sub(_qa).normalize();                    // world hand axis
    barBell.position.copy(rootB.worldToLocal(_qa.clone().add(_qb).multiplyScalar(0.5)));
    _qrot.copy(rootB.getWorldQuaternion(new THREE.Quaternion()).invert());
    _qm.applyQuaternion(_qrot);                            // axis in root space
    barBell.quaternion.setFromUnitVectors(shaftAxis, _qm);
  }
  /* QA: perpendicular distance of the bar centre from the palm-to-palm line
   * (should be ~0) + offset along the axis from the midpoint */
  function barFit() {
    if (!barBell || !handLB || !handRB) return 'no barbell';
    rootB.updateMatrixWorld(true);
    palmPoint(handLB, knucLB, _wa); palmPoint(handRB, knucRB, _wb);
    barBell.getWorldPosition(_wc);
    const axis = _wb.clone().sub(_wa); const hd = axis.length(); axis.normalize();
    const rel = _wc.clone().sub(_wa);
    const perp = rel.clone().addScaledVector(axis, -rel.dot(axis)).length();
    const b = _wc;
    return `hd=${hd.toFixed(3)} perp=${perp.toFixed(4)} along=${(rel.dot(axis) - hd / 2).toFixed(4)} bar=${b.x.toFixed(2)},${b.y.toFixed(2)},${b.z.toFixed(2)}`;
  }
  if (barBell) {
    rootB.updateMatrixWorld(true);
    rootB.attach(barBell);      // out of the bone chain — JS owns its pose now
    if (actGrab) {
      /* scan the grab clip for the lowest palm point (= bar on the floor),
       * fix the rest pose there, then let the intro play */
      let bestT = 0, bestY = Infinity;
      const n = 90;
      for (let i = 0; i <= n; i++) {
        actGrab.time = (i / n) * grabClip.duration;
        mixerB.update(0);
        rootB.updateMatrixWorld(true);
        const y = palmPoint(handLB, knucLB, _qa).add(palmPoint(handRB, knucRB, _qb)).multiplyScalar(0.5).y;
        if (y < bestY) { bestY = y; bestT = actGrab.time; }
      }
      contactT = bestT;
      actGrab.time = bestT;
      mixerB.update(0);
      rootB.updateMatrixWorld(true);
      palmPoint(handLB, knucLB, _qa);
      palmPoint(handRB, knucRB, _qb);
      barRest.pos.copy(_qa).add(_qb).multiplyScalar(0.5);
      /* the shaft rests ON the floor: lift the centre by the plate radius */
      const bbS = barBell.geometry.boundingBox.getSize(new THREE.Vector3());
      const perp = shaftAxis.x ? Math.min(bbS.y, bbS.z)
        : shaftAxis.y ? Math.min(bbS.x, bbS.z) : Math.min(bbS.x, bbS.y);
      barRest.pos.y = (perp / 2) * rootB.scale.y;   // rest ON the floor (world units)
      barRest.axis = sideDir.clone();       // horizontal, across the athlete
      console.log('[sport] bar contact at', bestT.toFixed(2) + 's', 'of',
        grabClip.duration.toFixed(2) + 's');
    }
    /* IMPORTANT: rewind BEFORE the first updateBar — the scan left
     * actGrab.time at contactT, which would trip the ground->hands flip
     * and nail the bar to the palms from frame one */
    barMode = actGrab ? 'ground' : 'hands';
    if (actGrab) { actGrab.time = 0; actGrab.paused = false; }
    updateBar();
  }

  const dist = 3.0;
  const target = new THREE.Vector3(0, 0.78, 0);
  big.camera.position.copy(sideDir).multiplyScalar(dist).add(target);
  big.camera.position.y += 0.25;
  big.camera.lookAt(target);
  const controlsB = makeControls(bigCanvas, big.camera, target);
  const viewTw = makeViewTween(controlsB, big.camera);
  const views = {
    side: sideDir.clone(),
    front: facing.clone(),
    back: facing.clone().negate(),
  };

  /* callout overlay — the four cards sit INSIDE the stage near the top,
   * staggered in two rows (top row: chest / hips, second row: knees / feet)
   * so they frame the figure instead of blanketing it; leader lines exit
   * the card side facing the body point and track the bones every frame */
  const ui = document.createElement('div');
  ui.className = 'hero-ui';
  ui.innerHTML = '<svg class="hero-lines"></svg><div class="hero-callouts"></div>';
  bigHost.appendChild(ui);
  const svg = ui.querySelector('.hero-lines');
  const calloutsBox = ui.querySelector('.hero-callouts');
  const CALLS = [
    { tag: 'Bar', txt: 'Rests on the rear-delts shelf just below the neck — never on the spine. Hands pull it down into the groove.', bone: chestBone },
    { tag: 'Hips', txt: 'Sit back and down until the hip crease passes the knees. The bar stays stacked over mid-foot.', bone: hipsBone },
    { tag: 'Knees', txt: 'Track over the toes, pushed out, never caving in under the load.', bone: kneeBone },
    { tag: 'Feet', txt: 'Shoulder-width, whole foot planted. Drive the floor away through mid-foot and heels.', bone: footBone },
  ];
  /* per-card anchors: two stacked columns, one per side, filling the empty
   * stage flanks (athlete stays centred between them); narrow screens fall
   * back to a 2×2 corner block that still leaves the athlete visible */
  const POS = {
    wide: {   /* left column: Bar / Hips — right column: Knees / Feet */
      Bar:   { left: '2.5%', top: '-12%' },
      Hips:  { left: '2.5%', top: '34%' },
      Knees: { right: '2.5%', top: '-9%' },
      Feet:  { right: '2.5%', top: '30%' },
    },
    narrow: { /* 2×2 block hugging the top corners, deliberately uneven;
               * second row pulled up/out so the athlete's head stays clear */
      Bar:   { left: '0%', top: '-17%' },
      Hips:  { right: '0%', top: '-7%' },
      Knees: { left: '0%', top: '16%' },
      Feet:  { right: '0%', top: '24%' },
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
   * sits in the LOWER half of the phone canvas, clear of the 2×2 callout
   * block; desktop framing is untouched */
  let frameY = 0.78;
  let frameX = 0;
  const applyNarrowFrame = () => {
    const want = narrowMQ.matches ? 1.24 : 0.78;
    const d = want - frameY;
    frameY = want;
    controlsB.target.y += d;
    big.camera.position.y += d;
    /* phones: also slide the athlete sideways into the free gap between the
     * split button groups (three left / two right), so the Back button and
     * the controls never blanket the feet */
    const wantX = narrowMQ.matches ? 0.42 : 0;
    const dx = wantX - frameX;
    frameX = wantX;
    controlsB.target.x += dx;
    big.camera.position.x += dx;
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
      /* line exits the card's edge at mid-height, always the side FACING
       * the centred athlete: cards anchored on the left (style.left set)
       * exit via their RIGHT edge midpoint, right-anchored cards via
       * their LEFT edge midpoint */
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

  /* stage bar: views + slow + pause */
  const bar = document.createElement('div');
  bar.className = 'stage-bar';
  bar.innerHTML = `
    <span class="bs-grp">
      <button type="button" class="stage-btn active" data-view="side">Side</button>
      <button type="button" class="stage-btn" data-view="front">Front</button>
      <button type="button" class="stage-btn" data-view="back">Back</button>
    </span>
    <span class="bs-grp">
      <button type="button" class="stage-btn slow" id="bs-slow">0.5×</button>
      <button type="button" class="stage-btn" id="bs-play">⏸ Pause</button>
    </span>`;
  bigHost.appendChild(bar);
  bar.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.view) {
      viewTw.to(views[b.dataset.view]);
      bar.querySelectorAll('[data-view]').forEach((x) => x.classList.toggle('active', x === b));
    } else if (b.id === 'bs-slow') {
      const ts = actB.timeScale === 1 ? 0.5 : 1;
      actB.timeScale = ts;
      if (actGrab) actGrab.timeScale = ts;
      b.classList.toggle('on', ts !== 1);
    } else if (b.id === 'bs-play') {
      const running = actB.timeScale !== 0;
      const ts = running ? 0 : 1;
      actB.timeScale = ts;
      if (actGrab) actGrab.timeScale = ts;
      b.textContent = running ? '▶ Play' : '⏸ Pause';
    }
  });

  /* ---- small stage: idle ---- */
  let small = null;
  let mEls = [], updateMuscleLines = null;   // muscle labels (hoisted for chips)
  if (smallHost) {
    const smallCanvas = document.getElementById('bs-canvas-small');
    small = makeRenderer(smallCanvas, smallHost);
    const rootS = skeletonClone(rootB);
    small.scene.add(rootS);
    /* the barbell only makes sense during the loaded lift — hide it on the
     * standing idle stage */
    rootS.traverse((o) => { if (o.name.toLowerCase().includes('barbell')) o.visible = false; });
    /* independent highlight channel: clone the shared materials and re-patch
     * them onto hiS's uniforms so this stage can glow on its own */
    rootS.traverse((o) => {
      if (!o.isMesh || !o.material) return;
      const mk = (m) => { const c = m.clone(); patchMaterial(c, hiS.uni); return c; };
      o.material = Array.isArray(o.material) ? o.material.map(mk) : mk(o.material);
    });
    /* muscle labels: one tag + leader line per squat muscle, pointing at
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
      el.className = 'hero-callout bs-mlabel';
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
      updateBar();
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

  /* ---------- muscle chips (hero) + muscle labels (idle stage) ----------
   * both drive the same selection: a chip tap toggles its group, a tap on
   * one of the stage's own labels selects/toggles that muscle directly */
  const noteEl = document.getElementById('bs-muscle-note');
  const chips = [...document.querySelectorAll('.bs-muscle')];
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
    applyMuscle(el.classList.contains('focus') ? '' : key,
      chips.find((c) => c.dataset.g === key));
  }));

  /* ---------- QA handles ---------- */
  window.__bs = {
    setGroup,
    barFit,
    phase: () => phase,
    barMode: () => barMode,
    seekBig: (t) => { startSquat(); actB.time = ((t % squatClip.duration) + squatClip.duration) % squatClip.duration; mixerB.update(0); updateBar(); },
    big: { mixer: mixerB, act: actB, camera: big.camera, controls: controlsB, root: rootB, scene: big.scene },
    small: small ? { camera: small.camera, controls: small.controls, mixer: small.mixer, root: small.root, scene: small.scene } : null,
    groups: GROUPS.map((g) => g.key),
    hi,
    hiS,
  };
})();
