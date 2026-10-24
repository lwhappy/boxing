/* SilentJab — combo stage (loads a single combo GLB, auto-plays the action)
 * Each combo page passes window.COMBO = { glb: 'filename.glb' }
 * The GLB contains one action that plays from start to finish.
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const CFG = window.COMBO || {};
// Versioned URL: /media/* is cached for 30 days, so a re-exported GLB would
// otherwise stay stale in browsers and edge caches. Bump ?v= when the GLB changes.
const GLB_URL = './media/glb/' + (CFG.glb || 'combo_jab_cross.glb') + '?v=1';

const canvas = document.getElementById('stage-canvas');
const barEl = document.getElementById('stage-bar');
const loadingEl = document.getElementById('stage-loading');
const loadingText = document.getElementById('stage-loading-text');
const errorEl = document.getElementById('stage-error');

/* ---------- renderer / scene ---------- */
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.25;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 50);
camera.position.set(0.9, 1.1, 3.2);

const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.enablePan = false;
controls.minDistance = 1.4;
controls.maxDistance = 6;
controls.maxPolarAngle = Math.PI * 0.55;

/* 灯光 */
scene.add(new THREE.HemisphereLight(0xd9e8ff, 0x3a3630, 2.0));
const key = new THREE.DirectionalLight(0xffe8d2, 3.4);
key.position.set(2.2, 3.2, 2.6);
scene.add(key);
const rim = new THREE.DirectionalLight(0x86b8ff, 2.0);
rim.position.set(-2.4, 2.0, -2.6);
scene.add(rim);
const fill = new THREE.DirectionalLight(0xffffff, 0.9);
fill.position.set(0, 1.4, 4);
scene.add(fill);

/* ---------- 尺寸自适应 ---------- */
function resize() {
  const w = canvas.clientWidth || canvas.parentElement.clientWidth;
  const h = canvas.clientHeight || canvas.parentElement.clientHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
new ResizeObserver(resize).observe(canvas.parentElement);
resize();

/* ---------- 加载模型 ---------- */
new GLTFLoader().load(
  GLB_URL,
  (gltf) => onLoaded(gltf),
  (e) => {
    if (!e.total) return;
    loadingText.textContent = `Loading combo — ${Math.min(100, (e.loaded / e.total) * 100).toFixed(0)}%`;
  },
  (err) => {
    loadingEl.classList.add('hidden');
    errorEl.hidden = false;
    errorEl.textContent = 'Failed to load the combo model.\n' + (err && err.message ? err.message : err);
    console.error('[combo-stage]', err);
  }
);

let mixer = null;
let comboAction = null;
let userMoved = false;
let homeFraming = null;
let desiredFraming = null;
let camBlend = 0;
let isPlaying = false;

function forceOpaque(mat) {
  if (!mat || !mat.transparent) return;
  mat.transparent = false;
  mat.depthWrite = true;
  mat.alphaTest = 0;
  mat.needsUpdate = true;
}

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

const VIEW_DIR = new THREE.Vector3(0.16, 0.03, 1).normalize();

function computeFraming(pts) {
  if (!pts || !pts.length) return null;
  const stageW = canvas.clientWidth || 480;
  const stageH = canvas.clientHeight || 480;

  const cRect = canvas.getBoundingClientRect();
  const bRect = barEl.getBoundingClientRect();
  const barTop = bRect.height > 0 ? bRect.top - cRect.top : stageH * 0.86;
  const topPad = stageH * 0.04;
  const bottomPad = Math.min(stageH * 0.38, Math.max(stageH * 0.07, stageH - barTop + stageH * 0.025));
  const sidePad = stageW * (stageW < 620 ? 0.05 : 0.09);

  let minX = 1e9, maxX = -1e9, minY = 1e9, maxY = -1e9, minZ = 1e9, maxZ = -1e9;
  for (const p of pts) {
    if (p.x < minX) minX = p.x; if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y; if (p.y > maxY) maxY = p.y;
    if (p.z < minZ) minZ = p.z; if (p.z > maxZ) maxZ = p.z;
  }
  const center = new THREE.Vector3((minX + maxX) / 2, (minY + maxY) / 2, (minZ + maxZ) / 2);

  const target = center.clone();
  let dist = Math.max(1.2, (maxY - minY) * 2.4);

  const wantCx = stageW / 2;
  const wantCy = (topPad + (stageH - bottomPad)) / 2;
  const wantW = stageW - sidePad * 2;
  const wantH = stageH - bottomPad - topPad;
  const halfTan = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));

  for (let iter = 0; iter < 8; iter++) {
    camera.position.copy(target).addScaledVector(VIEW_DIR, dist);
    camera.lookAt(target);
    camera.updateMatrixWorld(true);

    let pMinX = 1e9, pMaxX = -1e9, pMinY = 1e9, pMaxY = -1e9;
    for (const p of pts) {
      _tv.copy(p).project(camera);
      const sx = (_tv.x * 0.5 + 0.5) * stageW;
      const sy = (-_tv.y * 0.5 + 0.5) * stageH;
      if (sx < pMinX) pMinX = sx; if (sx > pMaxX) pMaxX = sx;
      if (sy < pMinY) pMinY = sy; if (sy > pMaxY) pMaxY = sy;
    }
    const need = Math.max((pMaxX - pMinX) / wantW, (pMaxY - pMinY) / wantH) * 1.03;
    const dx = (wantCx - (pMinX + pMaxX) / 2);
    const dy = (wantCy - (pMinY + pMaxY) / 2);
    const wpp = (2 * dist * halfTan) / stageH;
    target.y += dy * wpp;
    target.x -= dx * wpp;
    dist = THREE.MathUtils.clamp(dist * need, controls.minDistance, controls.maxDistance);
    if (Math.abs(need - 1) < 0.002 && Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) break;
  }

  return { target, dist };
}

function applyFraming(f) {
  if (!f) return;
  controls.target.copy(f.target);
  camera.position.copy(f.target).addScaledVector(VIEW_DIR, f.dist);
  camera.lookAt(f.target);
  controls.update();
}

function playCombo() {
  if (!mixer || !comboAction) return;
  comboAction.reset();
  comboAction.setLoop(THREE.LoopOnce, 1);
  comboAction.clampWhenFinished = true;
  // No fade-in here: this rig's bind/rest pose is horizontal (the character lies
  // down), so fading a lone action in from weight 0 blends the skeleton with the
  // bind pose and the boxer visibly collapses from the floor back to standing
  // during the first ~140ms. Start at full weight instead — same pattern as
  // boxing.js / home-stage.js.
  comboAction.setEffectiveWeight(1);
  comboAction.play();
  isPlaying = true;
}

function onLoaded(gltf) {
  const model = gltf.scene;
  model.traverse((o) => {
    if (o.isMesh && o.material) {
      for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
        forceOpaque(m);
        m.envMapIntensity = 0.6;
      }
    }
  });
  scene.add(model);

  mixer = new THREE.AnimationMixer(model);
  mixer.addEventListener('finished', (e) => {
    isPlaying = false;
    // Keep the last frame clamped, let user replay
    setActiveButton('replay');
  });

  const clips = gltf.animations || [];
  if (clips.length > 0) {
    comboAction = mixer.clipAction(clips[0]);
  }

  // CRITICAL: Keep animation playing during setup so the character never
  // shows the bind pose (lying down). We pause at frame 0.5s for framing.
  if (comboAction) {
    comboAction.reset().play();
    mixer.setTime(0.5);
    // Update once so the pose is applied before any render
    mixer.update(0);
  }
  model.updateMatrixWorld(true);

  // Ground the model
  const pts = samplePose(model);
  let soleY = 1e9;
  for (const p of pts) if (p.y < soleY) soleY = p.y;
  if (soleY < -1e-4) {
    const dy = -soleY;
    model.position.y += dy;
    for (const p of pts) p.y += dy;
    model.updateMatrixWorld(true);
  }

  // Compute framing with the union of several samples across the combo
  if (comboAction && clips[0]) {
    const union = [];
    const n = 12;
    for (let k = 0; k < n; k++) {
      mixer.setTime(((k + 0.5) / n) * clips[0].duration);
      mixer.update(0); // apply without advancing
      model.updateMatrixWorld(true);
      union.push(...samplePose(model, 1200));
    }
    // Return to idle stance (0.5s) for the initial view
    mixer.setTime(0.5);
    mixer.update(0);
    model.updateMatrixWorld(true);
    homeFraming = computeFraming(union.length > 0 ? union : pts);
    applyFraming(homeFraming);
    desiredFraming = homeFraming;
  } else {
    homeFraming = computeFraming(pts);
    applyFraming(homeFraming);
  }

  // Replay button
  const replayBtn = document.createElement('button');
  replayBtn.type = 'button';
  replayBtn.className = 'stage-btn active';
  replayBtn.dataset.clip = 'replay';
  replayBtn.textContent = 'Replay combo';
  replayBtn.addEventListener('click', () => playCombo());
  barEl.appendChild(replayBtn);

  // Slow-mo toggle
  const slowBtn = document.createElement('button');
  slowBtn.type = 'button';
  slowBtn.className = 'stage-btn slow';
  slowBtn.textContent = '×0.5';
  slowBtn.title = 'Slow motion';
  slowBtn.setAttribute('aria-pressed', 'false');
  slowBtn.addEventListener('click', () => {
    const on = slowBtn.classList.toggle('on');
    slowBtn.setAttribute('aria-pressed', String(on));
    mixer.timeScale = on ? 0.45 : 1;
  });
  barEl.appendChild(slowBtn);

  barEl.hidden = false;
  loadingEl.classList.add('hidden');

  // Auto-play the combo from the beginning after a brief delay
  if (comboAction) {
    setTimeout(() => playCombo(), 300);
  }

  window.__comboStage = { mixer, comboAction, model, camera, controls, playCombo };
}

function setActiveButton(clip) {
  for (const btn of barEl.children) {
    if (btn.dataset.clip) {
      btn.classList.toggle('active', btn.dataset.clip === clip);
    }
  }
}

controls.addEventListener('start', () => { userMoved = true; camBlend = 0; });

let reframeTimer = 0;
window.addEventListener('resize', () => {
  if (userMoved || !homeFraming) return;
  clearTimeout(reframeTimer);
  reframeTimer = setTimeout(() => {
    const oldH = canvas.clientHeight;
    // Can't recompute precisely without posedPts, just rescale
    if (camBlend <= 0 && homeFraming) applyFraming(homeFraming);
  }, 180);
});

/* ---------- 渲染循环 ---------- */
const clock = new THREE.Clock();
renderer.setAnimationLoop(() => {
  const dt = clock.getDelta();
  if (mixer) mixer.update(dt);
  controls.update();
  renderer.render(scene, camera);
});
