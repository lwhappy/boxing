/* SilentJab — combo stage (loads a single combo GLB, auto-plays the action)
 * Each combo page passes window.COMBO = { glb: 'filename.glb' }
 * The GLB contains one action that plays from start to finish.
 *
 * trimStart (seconds): the combo animations begin with a guard-stance phase
 * before the first punch fires. This trims that prefix so the action starts
 * at the punch itself, not the pre-punch guard.
 * Default: 1.5s — cuts the full pre-punch guard + wind-up so the action
 * starts deep into the first punch.
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

/**
 * Create a sub-clip by keeping only [startSec, endSec] of the source clip.
 * This is a lightweight replacement for THREE.AnimationUtils.subclip() which is
 * not bundled in the minified three.module.min.js.
 *
 * It clones the source clip's tracks and shifts all keyframe times so the clip
 * starts at `startSec` (original timeline) → 0 (new timeline), and drops the
 * keys past `endSec` (one extra key is kept on both sides so the interpolation
 * into and out of the window stays correct).
 */
function trimClipStart(sourceClip, startSec, endSec) {
  const endLimit = typeof endSec === 'number' ? Math.min(endSec, sourceClip.duration) : sourceClip.duration;
  const newTracks = [];
  for (const track of sourceClip.tracks) {
    const times = track.times;
    const values = track.values;
    const itemSize = track.ValueItemSize || values.length / times.length;

    // Find the range of keys that fall within [startSec, endLimit]
    let firstIdx = -1;
    let lastIdx = -1;
    for (let i = 0; i < times.length; i++) {
      if (times[i] >= startSec) {
        if (firstIdx === -1) firstIdx = i;
      }
      if (times[i] <= endLimit) lastIdx = i;
    }

    if (firstIdx === -1 || lastIdx < firstIdx) {
      // No keys inside the window — skip this track
      continue;
    }

    // Keep one key outside the window on both sides so the interpolation into
    // the first frame and out of the last frame matches the source animation
    if (firstIdx > 0) firstIdx--;
    if (lastIdx < times.length - 1) lastIdx++;

    const count = lastIdx - firstIdx + 1;
    const newTimes = new Float32Array(count);
    const newValues = new values.constructor(count * itemSize);

    for (let i = 0; i < count; i++) {
      const srcIdx = firstIdx + i;
      newTimes[i] = Math.max(0, times[srcIdx] - startSec);
      for (let j = 0; j < itemSize; j++) {
        newValues[i * itemSize + j] = values[srcIdx * itemSize + j];
      }
    }

    // Create a new track with the same name but shifted times
    const TrackType = track.constructor;
    newTracks.push(new TrackType(track.name, newTimes, newValues, track.getInterpolation()));
  }

  const newClip = new THREE.AnimationClip(
    sourceClip.name + '_trimmed',
    endLimit - startSec,
    newTracks
  );
  return newClip;
}

const CFG = window.COMBO || {};
// Versioned URL: /media/* is cached for 30 days, so a re-exported GLB would
// otherwise stay stale in browsers and edge caches. Bump ?v= when the GLB changes.
// The path is resolved against this module's own directory (assets/), so the same
// engine works from the site root and from the nested combos/ folder.
// One shared GLB holds every combo clip (man-home's rig + ten animations);
// each page names its clip with window.COMBO = { clip: 'combo_xxx' }.
const GLB_URL = new URL('../media/glb/man-combos.glb?v=2', import.meta.url).href;

const canvas = document.getElementById('stage-canvas');
const barEl = document.getElementById('stage-bar');
const loadingEl = document.getElementById('stage-loading');
const loadingText = document.getElementById('stage-loading-text');
const errorEl = document.getElementById('stage-error');

/* ---------- renderer / scene ---------- */
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.42;

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
scene.add(new THREE.HemisphereLight(0xe6f0ff, 0x4a4640, 2.9));
const key = new THREE.DirectionalLight(0xffe8d2, 4.0);
key.position.set(2.2, 3.2, 2.6);
scene.add(key);
const rim = new THREE.DirectionalLight(0x86b8ff, 3.2);
rim.position.set(-2.4, 2.0, -2.6);
scene.add(rim);
const fill = new THREE.DirectionalLight(0xffffff, 1.0);
fill.position.set(0, 1.4, 4);
scene.add(fill);

/* 跟随机位的补光：转到背面/侧面时可见的一侧也始终有光 */
const headFill = new THREE.DirectionalLight(0xeaf2ff, 1.5);
scene.add(headFill);
scene.add(headFill.target);

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
let steps = [];              // [{ action, at, fade, dur }] — chains several clips
let seqT = 0;                // playhead of the whole sequence (unscaled seconds)
let seqNext = 0;             // index of the next step waiting to fire
let comboDuration = 0;
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
  if (!mixer || !steps.length) return;
  for (const s of steps) s.action.stop();
  // No fade-in on the first action: this rig's bind/rest pose is horizontal (the
  // character lies down), so fading a lone action in from weight 0 blends the
  // skeleton with the bind pose and the boxer visibly collapses from the floor
  // back to standing during the first ~140ms. Start at full weight instead —
  // same pattern as boxing.js / home-stage.js.
  const first = steps[0];
  first.action.reset();
  first.action.setEffectiveWeight(1);
  first.action.play();
  seqT = 0;
  seqNext = 1;
  isPlaying = true;
}

function onLoaded(gltf) {
  const model = gltf.scene;
  model.traverse((o) => {
    if (o.isMesh && o.material) {
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      // three r170 的 MeshStandardMaterial(GGX) 与 Tripo 烘焙贴图叠加会产生大块碎片斑
      // （同贴图下 Phong/Lambert/Basic 均正常），统一换成 MeshPhongMaterial，观感几乎一致
      for (let mi = 0; mi < mats.length; mi++) {
        let m = mats[mi];
        if (m.isMeshStandardMaterial) {
          m = new THREE.MeshPhongMaterial({
            map: mats[mi].map || null,
            color: mats[mi].color.clone(),
            side: mats[mi].side,
            transparent: mats[mi].transparent,
            opacity: mats[mi].opacity,
            alphaTest: mats[mi].alphaTest,
            shininess: 16,
            specular: new THREE.Color(0x181818),
          });
          if (Array.isArray(o.material)) o.material[mi] = m;
          else o.material = m;
        }
        forceOpaque(m);
      }
    }
  });
  // 面向屏幕左侧，再往屏幕里侧转 45°：人物以背面 3/4 视角出现，出拳方向
  // = 左前方 45° 打进画面深处。原始 GLB 的出拳方向正对相机（-Z），
  // 45° 旋转后拳头朝 (-0.707, 0, -0.707) 打出去。
  model.rotation.y = THREE.MathUtils.degToRad(45);
  scene.add(model);

  mixer = new THREE.AnimationMixer(model);
  mixer.addEventListener('finished', (e) => {
    // a chained sequence fires 'finished' for every step that clamps — only the
    // last one means the whole combo is over
    if (steps.length && e.action !== steps[steps.length - 1].action) return;
    isPlaying = false;
    // Keep the last frame clamped, let user replay
    setActiveButton('replay');
  });

  const clips = gltf.animations || [];
  const makeStep = (clip, at, fade) => {
    const action = mixer.clipAction(clip);
    action.setLoop(THREE.LoopOnce, 1);
    action.clampWhenFinished = true;
    return { action, at, fade, dur: clip.duration };
  };

  if (Array.isArray(CFG.chain) && CFG.chain.length) {
    // COMBO.chain = [{ clip, at, start?, end?, fade? }, ...] — several takes
    // played one after another on the same rig, cross-fading at the seams.
    for (const spec of CFG.chain) {
      const src = THREE.AnimationClip.findByName(clips, spec.clip);
      if (!src) {
        console.warn('[combo-stage] clip not found:', spec.clip);
        continue;
      }
      const start = spec.start || 0;
      const end = typeof spec.end === 'number' ? spec.end : src.duration;
      const clip = (start > 0 || end < src.duration - 1e-3)
        ? trimClipStart(src, start, end)
        : src;
      steps.push(makeStep(clip, spec.at || 0, spec.fade ?? 0.12));
    }
  } else if (clips.length > 0) {
    let comboClip = (CFG.clip && THREE.AnimationClip.findByName(clips, CFG.clip)) || clips[0];
    // Trim the initial idle/loading phase so the first punch starts sooner.
    // The combo clips have ~1s of pre-punch setup; we cut roughly half of it.
    const trimStart = typeof CFG.trimStart === 'number' ? CFG.trimStart : 1.5;
    if (trimStart > 0 && comboClip.duration > trimStart + 0.5) {
      comboClip = trimClipStart(comboClip, trimStart);
    }
    steps.push(makeStep(comboClip, 0, 0));
  }
  comboAction = steps.length ? steps[0].action : null;
  comboDuration = steps.reduce((m, s) => Math.max(m, s.at + s.dur), 0);

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

  // Compute framing with the union of several samples across every step
  if (steps.length) {
    const union = [];
    for (const step of steps) {
      const n = 8;
      mixer.stopAllAction();
      step.action.reset();
      step.action.setEffectiveWeight(1);
      step.action.play();
      for (let k = 0; k < n; k++) {
        step.action.time = ((k + 0.5) / n) * step.dur;
        mixer.update(0); // apply without advancing
        model.updateMatrixWorld(true);
        union.push(...samplePose(model, 1200));
      }
    }
    // Return to the start of the take for the initial view
    mixer.stopAllAction();
    steps[0].action.reset();
    steps[0].action.setEffectiveWeight(1);
    steps[0].action.play();
    steps[0].action.time = 0.1;
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

  window.__comboStage = { mixer, comboAction, steps, model, camera, controls, playCombo, get duration() { return comboDuration; } };
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
  if (mixer) {
    mixer.update(dt);
    if (isPlaying) {
      // advance the chain in unscaled seconds so the ×0.5 toggle keeps the
      // hand-off points aligned with the clips
      seqT += dt * mixer.timeScale;
      while (seqNext < steps.length && seqT >= steps[seqNext].at) {
        const next = steps[seqNext];
        const prev = steps[seqNext - 1];
        next.action.reset();
        next.action.setEffectiveWeight(1);
        next.action.play();
        if (next.fade > 0) {
          next.action.fadeIn(next.fade);
          prev.action.fadeOut(next.fade);
        } else {
          prev.action.stop();
        }
        seqNext++;
      }
    }
  }
  headFill.position.copy(camera.position);
  headFill.target.position.copy(controls.target);
  headFill.position.sub(controls.target).setLength(6).add(controls.target);
  controls.update();
  renderer.render(scene, camera);
});
