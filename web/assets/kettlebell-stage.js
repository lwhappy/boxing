/* SilentJab — sport stage: the kettlebell swing form-check page
 * (/sport/kettlebell-swing/)
 * ----------------------------------------------------------------------------
 * Two stages share one GLB (sport-kettlebell.glb: Tripo man + kb-start +
 * kb-swing):
 *   • big stage   — plays the kb-start intro once, crossfades into the looping
 *                   kb-swing cycle; four form-callout cards (hinge / spine /
 *                   float / grip) with leader lines that track the bones every
 *                   frame, view buttons (side / front / back), play+slow;
 *   • small stage — loops the swing, drag to orbit, sits sticky beside the
 *                   technique notes.
 *
 * The kettlebell is a three.js-built prop pinned between the palms every frame
 * (bone-parented props get scrambled by the GLB's export-time rest reset — the
 * barbell lesson). Its basis keeps local -Y pointed at world-down, so the bell
 * always hangs upright while the handle rides the hand-to-hand line.
 *
 * Muscle highlighting: per-vertex masks from the skin weights (bind-pose bone
 * domains + a front/back normal filter), injected into MeshPhongMaterial via
 * onBeforeCompile. Deterministic QA: window.__kb.
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { clone as skeletonClone } from 'three/addons/utils/SkeletonUtils.js';

const GLB = new URL('../media/glb/sport-kettlebell.glb?v=3', import.meta.url).href;

/* ---------- muscle groups (attribute slot order matters: A0..A3, B0..B1) --- */
const GROUPS = [
  { key: 'grip',       slot: 'A', idx: 0 },
  { key: 'lats',       slot: 'A', idx: 1 },
  { key: 'delts',      slot: 'A', idx: 2 },
  { key: 'core',       slot: 'A', idx: 3 },
  { key: 'glutes',     slot: 'B', idx: 0 },
  { key: 'hamstrings', slot: 'B', idx: 1 },
];
const MUSCLE_NOTES = {
  glutes: 'The engine. The hip snap that floats the bell is a maximal glute squeeze at lockout — power comes from the hips, never the arms.',
  hamstrings: 'The spring. Loaded hard on the backswing as the hips fold back, then they recoil into the snap like a stretched band.',
  core: 'The brace. Abs lock the ribcage over the pelvis so the bell cannot fold you forward — or tempt you to arch back at the top.',
  lats: 'The steering. Lats and upper back keep the bell close and high on the backswing, instead of letting it sink toward the knees.',
  grip: 'The connection. Forearms hold the handle shut for the whole set — the arms stay relaxed ropes, only the grip is tight.',
  delts: 'The guides. Shoulders stay packed down and merely guide the arc — if they burn before the glutes, you are lifting, not swinging.',
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
 * swing muscle lit, while the big stage stays clean until a chip is tapped */
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
hiS.tgt.set(1, 1, 1, 1); hiS.tgtB.set(1, 1, 0, 0);  // idle = every swing muscle
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
  mat.customProgramCacheKey = () => 'kb-hi';
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

  const _p = new THREE.Vector3(), _nn = new THREE.Vector3();
  for (let i = 0; i < n; i++) {
    _p.fromBufferAttribute(pos, i);
    _nn.fromBufferAttribute(nor, i);
    const fDot = _nn.dot(fwd), uDot = _nn.dot(up);
    const fFront = smooth(fDot, 0.05, 0.45);   // belly-side filter
    const fBack = smooth(-fDot, 0.05, 0.45);   // back-side filter
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
    if (nm.includes('forearm')) { g = 0; }                      /* grip        */
    else if (nm.includes('spine2')) { g = 1; fac = fBack; }     /* lats / U-back */
    else if (nm.includes('shoulder')) { g = 2; }                /* delts       */
    else if (nm.includes('spine')) { g = 3; fac = fFront; }     /* core        */
    else if (nm.includes('hips')) { g = 4; fac = fBack; }       /* glutes      */
    else if (nm.includes('upleg')) { g = 5; fac = fBack; }      /* hamstrings  */
    if (g < 0) continue;
    const val = wN * fac;
    if (g < 4) A[i * 4 + g] += val;
    else B[i * 4 + (g - 4)] += val;
  }
  geo.setAttribute('aMuscleA', new THREE.BufferAttribute(A, 4));
  geo.setAttribute('aMuscleB', new THREE.BufferAttribute(B, 4));
}

/* ---------- stage factory ---------- */
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
  const bigHost = document.getElementById('kb-stage-big');
  const smallHost = document.getElementById('kb-stage-small');
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
  const startClip = clipOf('start');
  const swingClip = clipOf('swing') || model.clips[0];

  /* ---- the kettlebell: built in three.js and pinned between the palms every
   *      frame. Local X rides the hand-to-hand line, local -Y is steered to
   *      world-down, so the bell always hangs upright under the grip. ---- */
  const XAXIS = new THREE.Vector3(1, 0, 0);
  const WORLD_DOWN = new THREE.Vector3(0, -1, 0);
  const boneExact = (root, nm) => {
    let f = null;
    root.traverse((o) => { if (f || !o.isBone) return; if (o.name.toLowerCase().endsWith(nm)) f = o; });
    return f;
  };
  function makeKettlebell() {
    /* fixed size in root-local units (the figure stands ~1.75 units tall):
     * a real bell's diameter is roughly a hand-span and a half, independent
     * of how wide the animation happens to hold the hands */
    const g = new THREE.Group();
    g.name = 'kb-bell';
    const iron = new THREE.MeshPhongMaterial({ color: 0x2e3238, shininess: 38, specular: new THREE.Color(0x585f68) });
    const steel = new THREE.MeshPhongMaterial({ color: 0x9aa1a8, shininess: 110, specular: new THREE.Color(0x767d86) });
    /* Normal kettlebell proportions: the body is a bit wider than a hand,
     * the handle a little wider than a grip. The bell stays on the midline
     * and the hands come to IT (the Mixamo grip closes to ~0.09 local), so
     * no oversized handle is needed. */
    const r = 0.078;                    // bell body radius
    const barL = 0.15, barR = 0.016;   // normal handle length
    const postH = 0.052, postR = 0.014;
    /* grip crossbar along local X */
    const bar = new THREE.Mesh(new THREE.CylinderGeometry(barR, barR, barL, 18), steel);
    bar.rotation.z = Math.PI / 2;
    g.add(bar);
    /* horn posts down from the bar ends */
    for (const sgn of [-1, 1]) {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(postR, postR, postH, 14), steel);
      post.position.set(sgn * (barL * 0.34), -postH * 0.5, 0);
      g.add(post);
    }
    /* the bell body, hanging under the horn */
    const body = new THREE.Mesh(new THREE.SphereGeometry(r, 28, 22), iron);
    body.position.y = -postH - r * 0.62;
    body.scale.set(1, 0.92, 1);
    g.add(body);
    /* a flat base so it could rest on a floor */
    const base = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.66, r * 0.74, r * 0.16, 24), iron);
    base.position.y = body.position.y - r * 0.66;
    g.add(base);
    g.traverse((o) => { if (o.isMesh) o.frustumCulled = false; });
    return g;
  }
  const PALM_T = 0.45;
  const _pa = new THREE.Vector3(), _pb = new THREE.Vector3(), _kn = new THREE.Vector3();
  function palmLocal(root, hand, knuc, out) {
    hand.getWorldPosition(out);
    knuc.getWorldPosition(_kn).sub(out).multiplyScalar(PALM_T);
    out.add(_kn);
    return root.worldToLocal(out);
  }
  const _x = new THREE.Vector3(), _y = new THREE.Vector3(), _z = new THREE.Vector3();
  const _d = new THREE.Vector3(), _q = new THREE.Quaternion(), _m = new THREE.Matrix4();
  function pinKb(p) {
    if (!p.handL || !p.handR) return;
    p.root.updateMatrixWorld(true);
    palmLocal(p.root, p.handL, p.knucL, _pa);
    palmLocal(p.root, p.handR, p.knucR, _pb);
    p.mid.copy(_pa).add(_pb).multiplyScalar(0.5);
    /* The bell body ALWAYS hangs straight down. The Mixamo start clip is
     * authored empty-handed with the hands at very unequal heights (~14cm),
     * so tying the bell's up-axis to the hand line made it visibly tilt.
     * Local +Y is locked to world-up; the crossbar (local X) is just the
     * hand-to-hand line flattened onto the horizontal plane, so the handle
     * stays level and the bell never cocks to one side. */
    p.root.getWorldQuaternion(_q).invert();
    _d.copy(WORLD_DOWN).applyQuaternion(_q);
    _y.copy(_d).negate().normalize();                 // local +Y = world up
    _x.copy(_pb).sub(_pa);                            // hand-to-hand line
    _x.addScaledVector(_y, -_x.dot(_y));              // flatten to horizontal
    if (_x.lengthSq() < 1e-10) {                      // hands stacked vertically
      _x.set(1, 0, 0).addScaledVector(_y, -_y.x);
    }
    _x.normalize();
    _z.crossVectors(_x, _y).normalize();
    _m.makeBasis(_x, _y, _z);
    /* The bell rides the palm midpoint so both hands always sit ON the
     * handle. At the pickup frame the hands are already closed together and
     * their midpoint is essentially the body midline (~0.02 local), so the
     * bell still waits visually centered — but the grip looks natural. */
    p.bell.position.copy(p.mid);
    p.bell.quaternion.setFromRotationMatrix(_m);
  }

  /* ---- finger curl: the Mixamo "start" clip is authored EMPTY-HANDED — the
   * hands reach down OPEN, so although the palm bone rides the crossbar, the
   * fingers hang 4–7cm below it and read as "hand beside the bell, not
   * gripping". Closing the four fingers onto the bar is what makes the grab
   * honest: +local-X on phalanges 1..3 lifts each fingertip from ~7cm under
   * the bar to within ~6mm of it (verified on BOTH hands). Applied AFTER the
   * mixer writes the clip each frame (the mixer overwrites bone quats), so it
   * is a true additive curl, not a baked pose. ---- */
  const CURL_AMT = 1.0;                 // radians on the first phalanx
  const CURL_FACTOR = [0, 1, 0.8, 0.6]; // diminishing down the finger chain
  const _cq = new THREE.Quaternion();
  const _cx = new THREE.Vector3(1, 0, 0);
  function findFingerBones(root) {
    const out = [];
    root.traverse((o) => {
      if (!o.isBone) return;
      const m = o.name.match(/Hand(Index|Middle|Ring|Pinky)([123])$/i);
      if (!m) return;
      const j = +m[2];
      if (j <= 3) out.push({ bone: o, f: CURL_FACTOR[j] });
    });
    return out;
  }
  function applyGrip(p, amt) {
    if (!p.fingers || amt <= 0) return;
    for (const { bone, f } of p.fingers) {
      _cq.setFromAxisAngle(_cx, CURL_AMT * f * amt);
      bone.quaternion.multiply(_cq);
    }
  }

  function attachProps(root) {
    const bell = makeKettlebell();
    root.add(bell);
    const p = {
      root, bell, mid: new THREE.Vector3(),
      handL: boneExact(root, 'lefthand'), handR: boneExact(root, 'righthand'),
      knucL: boneExact(root, 'lefthandmiddle1'), knucR: boneExact(root, 'righthandmiddle1'),
      fingers: findFingerBones(root),
      grip: 0,
    };
    pinKb(p);
    return p;
  }

  /* ---- big stage: the full kettlebell set + callouts + views ----
   * Choreography: the bell starts ON THE FLOOR; the three Mixamo donors
   * play in order — kb-start (bend down, pick the bell up, first hike),
   * kb-swing (the rep cycle, N reps), kb-end (set the bell back down) —
   * then a short rest and the whole set loops. The bell rests at a fixed
   * floor pose (captured at each clip's lowest-palm frame with the EXACT
   * construction hands mode uses, so switches cannot flash) until the
   * hands reach it, then rides the palms. */
  const bigCanvas = document.getElementById('kb-canvas-big');
  const big = makeRenderer(bigCanvas, bigHost, { hRef: 16 / 9 });
  const rootB = model.proto;
  big.scene.add(rootB);
  rootB.scale.setScalar(1.7);

  const endClip = clipOf('end');
  const REPS = 4;                       // swing reps per set
  const REST_S = 1.4;                   // pause with the bell back on the floor
  const mixerB = new THREE.AnimationMixer(rootB);
  const actSwing = mixerB.clipAction(swingClip);
  const actStart = startClip ? mixerB.clipAction(startClip) : null;
  const actEnd = endClip ? mixerB.clipAction(endClip) : null;
  let phase = 'start';                  // 'start' -> 'swing' -> 'end' -> 'rest' -> ...
  let bellMode = 'ground';              // 'ground' (floor rest) <-> 'hands'
  let restUntil = 0;
  const startCycle = () => {
    if (actEnd) actEnd.stop();         // the end scan leaves it active-paused
    phase = 'start'; bellMode = 'ground';
    actStart.reset().play();
  };
  const advance = () => {               // mixer 'finished' dispatch
    if (phase === 'start') {
      /* the three donors are companion clips: start ends in the hinge where
       * swing begins, swing ends in the hinge where end begins — the poses
       * match, so a hard cut reads as one continuous set */
      phase = 'swing';
      actStart.stop();
      actSwing.reset().play();
    } else if (phase === 'swing') {
      if (actEnd) {
        phase = 'end';
        actSwing.stop();
        actEnd.reset().play();
      } else {
        phase = 'rest'; restUntil = time + REST_S;
      }
    } else if (phase === 'end') {
      phase = 'rest'; restUntil = time + REST_S;
    }
  };
  mixerB.addEventListener('finished', advance);
  actStart.setLoop(THREE.LoopOnce, 1);
  actStart.clampWhenFinished = true;
  actSwing.setLoop(THREE.LoopRepeat, REPS);
  if (actEnd) {
    actEnd.setLoop(THREE.LoopOnce, 1);
    actEnd.clampWhenFinished = true;
  }
  mixerB.update(0);
  rootB.updateMatrixWorld(true);

  const propsB = attachProps(rootB);

  /* ---- bell floor rests + ground<->hands switches (root-local capture) ----
   * one rest per floor contact: kb-start's lowest palm (bell waiting to be
   * picked up) and kb-end's lowest palm (bell set back down). Each is
   * captured by pinning the bell with the contact-frame pose — the exact
   * construction hands mode uses — so every switch is pixel-identical. */
  const rests = {
    start: { pos: new THREE.Vector3(), quat: new THREE.Quaternion() },
    end: { pos: new THREE.Vector3(), quat: new THREE.Quaternion() },
  };
  const contact = { start: Infinity, end: Infinity };
  function captureRest(p, slot) {
    pinKb(p);
    rests[slot].pos.copy(p.bell.position);
    rests[slot].quat.copy(p.bell.quaternion);
  }
  function updateBell(p) {
    if (phase === 'start' && bellMode === 'ground' && actStart.time >= contact.start) {
      bellMode = 'hands';
    }
    if (phase === 'end' && bellMode === 'hands' && actEnd && actEnd.time >= contact.end) {
      bellMode = 'ground';
    }
    if (bellMode === 'ground') {
      /* The bell is nailed to the floor — no lateral, no fore-aft, no lift —
       * until the moment both hands reach it (contact) and bellMode flips to
       * 'hands'. Before that it never moves at all. */
      const r = rests[(phase === 'end' || phase === 'rest') ? 'end' : 'start'];
      p.bell.position.copy(r.pos);
      p.bell.quaternion.copy(r.quat);
      return;
    }
    pinKb(p);
  }
  /* Find the frame where the hands are both LOW and CLOSED together — the
   * natural two-handed grip on a kettlebell. The bell's floor rest is captured
   * there (via pinKb, the same construction hands mode uses), then snapped to
   * the body midline (x=0). From then on the bell is nailed to that spot until
   * the clip reaches this contact frame; only then does it ride the hands.
   * NOTE: the action must be ACTIVATED (play + paused) or the mixer evaluates
   * nothing and the scan silently returns 0. */
  function scanContact(act, clip, slot) {
    act.reset().play();
    act.paused = true;
    const _pr = new THREE.Vector3(), _pl = new THREE.Vector3();
    let bestT = 0, bestScore = -Infinity;
    const floorPos = new THREE.Vector3(), floorQuat = new THREE.Quaternion();
    const n = 160;
    for (let i = 0; i <= n; i++) {
      act.time = (i / n) * clip.duration;
      mixerB.update(0);
      propsB.root.updateMatrixWorld(true);
      /* palm points in root-local */
      palmLocal(propsB.root, propsB.handR, propsB.knucR, _pr);
      palmLocal(propsB.root, propsB.handL, propsB.knucL, _pl);
      const gap = _pr.distanceTo(_pl);
      const midY = (_pr.y + _pl.y) * 0.5;
      /* prefer LOW hands (near the floor) AND closed gap (both hands grip):
       * score = -gap - 2*midY. For start, the minimum-hand frame at t=2.2
       * (gap~0.114) is low; for end the closing frame is picked the same way. */
      const score = -gap - 2 * midY;
      if (score > bestScore) {
        bestScore = score; bestT = act.time;
        captureRest(propsB, slot);
        floorPos.copy(rests[slot].pos); floorQuat.copy(rests[slot].quat);
      }
    }
    /* Floor rest = where the closed hands are at the grip frame. The Mixamo
     * grip closes at x~0.02 (visually the body midline), so the bell waits
     * centered AND the hands land right on the handle — no forced offset. */
    rests[slot].pos.copy(floorPos);
    rests[slot].quat.copy(floorQuat);
    act.time = 0;
    return bestT;
  }
  if (actStart) contact.start = scanContact(actStart, startClip, 'start');
  if (actEnd) {
    actStart.stop();                   // a paused-but-active action would blend its pose in
    contact.end = scanContact(actEnd, endClip, 'end');
  }
  console.log('[sport] bell contacts', JSON.stringify(contact));
  /* IMPORTANT: rewind BEFORE the first updateBell — the scans left the
   * actions parked at their contact frames, which would trip the
   * ground->hands flip and pin the bell to the palms from frame one */
  actStart.time = 0;
  actStart.paused = false;
  startCycle();
  updateBell(propsB);

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
  const facing = toeL.getWorldPosition(new THREE.Vector3())
    .sub(footBone.getWorldPosition(new THREE.Vector3()));
  facing.y = 0; facing.normalize();
  const sideDir = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), facing).normalize();

  const dist = 3.0;
  const target = new THREE.Vector3(0, 0.82, 0);
  big.camera.position.copy(sideDir).multiplyScalar(dist).add(target);
  big.camera.position.y += 0.28;
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
  const CALLS = [
    { tag: 'Hinge', txt: 'A hinge, not a squat — hips travel back, knees stay soft, shins still. Forearms brush the inner thighs.', bone: hipsBone },
    { tag: 'Spine', txt: 'Neutral and braced the whole way — the bell pulls forward at the bottom, so abs and erectors hold the line.', bone: ribBone },
    { tag: 'Float', txt: 'The bell floats to chest height on hip power alone, arms as ropes. Finish tall, glutes squeezed, ribs down.', bone: chestBone },
    { tag: 'Grip', txt: 'Both hands hooked through the handle, shoulders packed down — the grip holds, nothing lifts.', bone: handBone },
  ];
  const POS = {
    wide: {
      Hinge: { left: '2.5%', top: '30%' },
      Spine: { left: '2.5%', top: '-12%' },
      Float: { right: '2.5%', top: '-9%' },
      Grip:  { right: '2.5%', top: '32%' },
    },
    narrow: {
      Hinge: { left: '0%', top: '16%' },
      Spine: { left: '0%', top: '-17%' },
      Float: { right: '0%', top: '-7%' },
      Grip:  { right: '0%', top: '20%' },
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

  let frameY = 0.82;
  let frameX = 0;
  const applyNarrowFrame = () => {
    const want = narrowMQ.matches ? 0.95 : 0.82;
    const d = want - frameY; frameY = want;
    controlsB.target.y += d; big.camera.position.y += d;
    const wantX = narrowMQ.matches ? 0.40 : 0;
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
      <button type="button" class="stage-btn slow" id="kb-slow">0.5×</button>
      <button type="button" class="stage-btn" id="kb-play">⏸ Pause</button>
    </span>`;
  bigHost.appendChild(bar);
  const setSpeed = (v) => {
    actSwing.timeScale = v;
    if (actStart) actStart.timeScale = v;
    if (actEnd) actEnd.timeScale = v;
    if (small) small.mixer.timeScale = 0.6 * v;
  };
  bar.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.view) {
      viewTw.to(views[b.dataset.view]);
      bar.querySelectorAll('[data-view]').forEach((x) => x.classList.toggle('active', x === b));
    } else if (b.id === 'kb-slow') {
      const slow = actSwing.timeScale === 1;
      setSpeed(slow ? 0.5 : 1);
      b.classList.toggle('on', slow);
    } else if (b.id === 'kb-play') {
      const running = actSwing.timeScale !== 0;
      setSpeed(running ? 0 : 1);
      b.textContent = running ? '▶ Play' : '⏸ Pause';
    }
  });

  /* ---- small stage: the swing loop, slower, orbitable ---- */
  let small = null;
  let mEls = [], updateMuscleLines = null;
  if (smallHost) {
    const smallCanvas = document.getElementById('kb-canvas-small');
    small = makeRenderer(smallCanvas, smallHost);
    const rootS = skeletonClone(rootB);
    /* skeletonClone copies the WHOLE subtree — strip the big stage's bell,
     * then let attachProps(rootS) build its own */
    const inherited = [];
    rootS.traverse((o) => { if (o.name === 'kb-bell') inherited.push(o); });
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
      { key: 'glutes',     frag: 'hips',          label: 'Glutes',     pos: { right: '2%', top: '12%' } },
      { key: 'hamstrings', frag: 'leftupleg',     label: 'Hamstrings', pos: { left: '2%', top: '22%' } },
      { key: 'core',       frag: 'spine1',        label: 'Core',       pos: { right: '2%', top: '34%' } },
      { key: 'lats',       frag: 'spine2',        label: 'Lats',       pos: { left: '2%', top: '46%' } },
      { key: 'grip',       frag: 'leftforearm',   label: 'Grip',       pos: { right: '2%', top: '58%' } },
      { key: 'delts',      frag: 'leftshoulder',  label: 'Shoulders',  pos: { left: '2%', top: '70%' } },
    ];
    const mui = document.createElement('div');
    mui.className = 'hero-ui';
    mui.innerHTML = '<svg class="hero-lines"></svg><div class="hero-callouts"></div>';
    smallHost.appendChild(mui);
    const msvg = mui.querySelector('.hero-lines');
    const mbox = mui.querySelector('.hero-callouts');
    mEls = MUS.map((m) => {
      const el = document.createElement('div');
      el.className = 'hero-callout kb-mlabel';
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
    mixerS.clipAction(swingClip).play();
    mixerS.timeScale = 0.6;
    const h = 0.98 * 1.7;
    const targetS = new THREE.Vector3(0, h * 0.52, 0);
    small.camera.position.set(0.62, h * 0.72, h * 1.85);
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

  /* ---- right arm must descend LIKE the left (not ahead of it) ----
   * The empty-handed start donor drops the right arm ~0.9 s before the left,
   * so the right hand overshoots BEHIND the handle while the left is still
   * front-above it — the right hand then has to slide forward to grip. Until
   * the grip frame we drive the right arm chain from a MIRROR of the left arm
   * (whose arc is the correct "descend front-above, then curl onto the bar"
   * motion), then fade the mirror out at contact so the baked, already
   * symmetric pose takes over with no pop. The mirror of a Mixamo local
   * quaternion across the sagittal plane is (x, -y, -z, w). */
  const MIRROR_SEGS = ['shoulder', 'arm', 'forearm', 'hand'];
  const mirL = MIRROR_SEGS.map((s) => boneExact(rootB, 'left' + s));
  const mirR = MIRROR_SEGS.map((s) => boneExact(rootB, 'right' + s));
  const _mq = new THREE.Quaternion();
  function mirrorRightArm(amt) {
    if (amt <= 0) return;
    for (let i = 0; i < mirL.length; i++) {
      const l = mirL[i], r = mirR[i];
      if (!l || !r) continue;
      _mq.set(l.quaternion.x, -l.quaternion.y, -l.quaternion.z, l.quaternion.w).normalize();
      r.quaternion.slerp(_mq, amt);
    }
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
      if (phase === 'rest' && time >= restUntil) startCycle();
      mixerB.update(dt);
      /* while the bell is still on the floor and the hands are descending
       * toward it, mirror the left arm onto the right so BOTH hands come down
       * from the front-above; the weight fades to 0 exactly at the grip frame,
       * letting the baked symmetric pose take over seamlessly. */
      if (phase === 'start' && bellMode === 'ground' && actStart) {
        const remain = contact.start - actStart.time;      // seconds until grip
        mirrorRightArm(THREE.MathUtils.clamp(remain / 0.35, 0, 1));
      }
      /* fingers close onto the bar once the bell is held, and reopen as it
       * is set back down — the open hand descends, then visibly grips */
      const wantGrip = bellMode === 'hands' ? 1 : 0;
      propsB.grip += (wantGrip - propsB.grip) * Math.min(1, dt * 20);
      applyGrip(propsB, propsB.grip);
      updateBell(propsB);
      controlsB.update();
      big.renderer.render(big.scene, big.camera);
      updateCallouts();
    }
    if (small && vis.small) {
      small.mixer.update(dt);
      small.props.grip = 1;             // the small stage only ever holds the bell
      applyGrip(small.props, 1);
      pinKb(small.props);
      small.controls.update();
      small.renderer.render(small.scene, small.camera);
      if (updateMuscleLines) updateMuscleLines();
    }
  })();

  const noteEl = document.getElementById('kb-muscle-note');
  const chips = [...document.querySelectorAll('.kb-muscle')];
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

  /* QA: perpendicular distance of the bell centre from the palm-to-palm line
   * (≈0 means the grip is honest) + the bell's world Y for framing checks */
  const _qa = new THREE.Vector3(), _qb = new THREE.Vector3(), _qc = new THREE.Vector3();
  function palmWorld(hand, knuc, out) {
    hand.getWorldPosition(out);
    knuc.getWorldPosition(_v).sub(out).multiplyScalar(PALM_T);
    return out.add(_v);
  }
  function bellFit() {
    rootB.updateMatrixWorld(true);
    palmWorld(propsB.handL, propsB.knucL, _qa);
    palmWorld(propsB.handR, propsB.knucR, _qb);
    propsB.bell.getWorldPosition(_qc);
    const axis = _qb.clone().sub(_qa); const hd = axis.length(); axis.normalize();
    const rel = _qc.clone().sub(_qa);
    const perp = rel.clone().addScaledVector(axis, -rel.dot(axis)).length();
    return `hd=${hd.toFixed(3)} perp=${perp.toFixed(4)} bar=${_qc.x.toFixed(2)},${_qc.y.toFixed(2)},${_qc.z.toFixed(2)}`;
  }

  window.__kb = {
    setGroup,
    phase: () => phase,
    bellMode: () => bellMode,
    contactStart: () => contact.start,
    bellFit,
    seekBig: (t) => {
      /* jump straight into the looping swing (QA / hero framing) */
      if (actStart.isRunning()) actStart.stop();
      if (actEnd && actEnd.isRunning()) actEnd.stop();
      if (phase !== 'swing') { phase = 'swing'; bellMode = 'hands'; actSwing.reset().play(); }
      actSwing.time = ((t % swingClip.duration) + swingClip.duration) % swingClip.duration;
      mixerB.update(0); updateBell(propsB);
    },
    startCycle,
    big: { mixer: mixerB, act: actSwing, actStart, actEnd, camera: big.camera, controls: controlsB, root: rootB, scene: big.scene },
    updateBell: () => updateBell(propsB),
    applyGrip: (a) => { propsB.grip = a; applyGrip(propsB, a); },
    small: small ? { camera: small.camera, controls: small.controls, mixer: small.mixer, root: small.root, scene: small.scene } : null,
    groups: GROUPS.map((g) => g.key),
    props: propsB,
    hi,
    hiS,
  };
})();
