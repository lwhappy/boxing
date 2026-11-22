/* SilentJab — benefit stage (boxing workout benefits page)
 * A chaptered variant of combo-stage.js: the GLB loads once, every chapter is
 * a trimmed sub-clip of one of the shared combo takes, and the page scrolls
 * people through the benefits while the fighter demonstrates each one.
 *
 * window.BENEFIT = {
 *   onActive(i),                       // called when the active chapter changes
 *   chapters: [{
 *     label,                           // short chip label in the stage bar
 *     clip,                            // source clip name in man-combos.glb
 *     trim,                            // seconds of source prefix to cut (or:)
 *     start, end,                      // explicit sub-clip window (ch. "Form")
 *     loop,                            // LoopRepeat instead of one-shot
 *     view: [x,y,z],                   // camera direction preset (normalized)
 *     distMul,                         // framing distance multiplier
 *     callouts: [{bone, text, at, dur}],  // bone-anchored labels, chapter-local s
 *     flash: {bone, at},               // impact flash sprite
 *     shake: {at, power},              // camera shake
 *   }]
 * }
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

/* ---------- sub-clip helper (same as combo-stage.js) ---------- */
function trimClipStart(sourceClip, startSec, endSec) {
  const endLimit = typeof endSec === 'number' ? Math.min(endSec, sourceClip.duration) : sourceClip.duration;
  const newTracks = [];
  for (const track of sourceClip.tracks) {
    const times = track.times;
    const values = track.values;
    const itemSize = track.ValueItemSize || values.length / times.length;
    let firstIdx = -1;
    let lastIdx = -1;
    for (let i = 0; i < times.length; i++) {
      if (times[i] >= startSec && firstIdx === -1) firstIdx = i;
      if (times[i] <= endLimit) lastIdx = i;
    }
    if (firstIdx === -1 || lastIdx < firstIdx) continue;
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
    const TrackType = track.constructor;
    newTracks.push(new TrackType(track.name, newTimes, newValues, track.getInterpolation()));
  }
  return new THREE.AnimationClip(sourceClip.name + '_trim', endLimit - startSec, newTracks);
}

const CFG = window.BENEFIT || {};
const GLB_URL = new URL('../media/glb/man-combos.glb?v=1', import.meta.url).href;

const canvas = document.getElementById('stage-canvas');
const barEl = document.getElementById('stage-bar');
const loadingEl = document.getElementById('stage-loading');
const loadingText = document.getElementById('stage-loading-text');
const errorEl = document.getElementById('stage-error');
const stageEl = canvas ? canvas.parentElement : null;

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
controls.maxPolarAngle = Math.PI * 0.62;

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
const headFill = new THREE.DirectionalLight(0xeaf2ff, 1.5);
scene.add(headFill);
scene.add(headFill.target);

function resize() {
  const w = canvas.clientWidth || canvas.parentElement.clientWidth;
  const h = canvas.clientHeight || canvas.parentElement.clientHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
new ResizeObserver(resize).observe(canvas.parentElement);
resize();

/* ---------- helpers ---------- */
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

function findBone(root, name) {
  /* GLTFLoader strips ':' from mixamorig names — match exact, suffixed, then
   * loose endsWith('Spine2' → 'mixamorigSpine2') as the last resort */
  let found = null;
  const loose = [];
  root.traverse((o) => {
    if (!o.isBone) return;
    if (o.name === name) { if (!found) found = o; }
    else if (o.name.endsWith(':' + name)) { if (!found) found = o; }
    else if (o.name.endsWith(name)) loose.push(o);
  });
  return found || loose[0] || null;
}

/* framing fit, with a per-chapter view direction */
function computeFraming(pts, viewDir, distMul = 1) {
  if (!pts || !pts.length) return null;
  const stageW = canvas.clientWidth || 480;
  const stageH = canvas.clientHeight || 480;
  /* generous top pad: callout pills float above the head and must not clip */
  const topPad = stageH * 0.16;
  const bottomPad = Math.min(stageH * 0.3, Math.max(stageH * 0.08, stageH * 0.12));
  const sidePad = stageW * (stageW < 620 ? 0.06 : 0.1);
  let minX = 1e9, maxX = -1e9, minY = 1e9, maxY = -1e9;
  for (const p of pts) {
    if (p.x < minX) minX = p.x; if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y; if (p.y > maxY) maxY = p.y;
  }
  const target = new THREE.Vector3((minX + maxX) / 2, (minY + maxY) / 2, 0);
  let dist = Math.max(1.2, (maxY - minY) * 2.4);
  const wantCx = stageW / 2;
  const wantCy = (topPad + (stageH - bottomPad)) / 2;
  const wantW = stageW - sidePad * 2;
  const wantH = stageH - bottomPad - topPad;
  const halfTan = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
  for (let iter = 0; iter < 8; iter++) {
    camera.position.copy(target).addScaledVector(viewDir, dist);
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
    const need = Math.max((pMaxX - pMinX) / wantW, (pMaxY - pMinY) / wantH) * 1.04;
    const dx = wantCx - (pMinX + pMaxX) / 2;
    const dy = wantCy - (pMinY + pMaxY) / 2;
    const wpp = (2 * dist * halfTan) / stageH;
    target.y += dy * wpp;
    target.x -= dx * wpp;
    dist = THREE.MathUtils.clamp(dist * need, controls.minDistance, controls.maxDistance);
    if (Math.abs(need - 1) < 0.003 && Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) break;
  }
  return { target, dist: dist * distMul, dir: viewDir.clone() };
}

/* ---------- chapter state ---------- */
let mixer = null;
let model = null;
const chapters = [];   // { spec, action, dur, framing, callouts:[{el,bone,at,dur,fired}], flashAt, shakeAt, shakePower }
let active = -1;
let chapterT = 0;
let camFrom = null, camTo = null, camBlend = 1;
let shakeT = 0, shakePower = 0;
const flashes = [];
let userMoved = false;
let isPlaying = false;

new GLTFLoader().load(GLB_URL, onLoaded, (e) => {
  if (!e.total) return;
  loadingText.textContent = `Loading the workout — ${Math.min(100, (e.loaded / e.total) * 100).toFixed(0)}%`;
}, (err) => {
  loadingEl.classList.add('hidden');
  errorEl.hidden = false;
  errorEl.textContent = 'Failed to load the 3D model.\n' + (err && err.message ? err.message : err);
  console.error('[benefit-stage]', err);
});

function onLoaded(gltf) {
  model = gltf.scene;
  model.traverse((o) => {
    if (o.isMesh && o.material) {
      const mats = Array.isArray(o.material) ? o.material : [o.material];
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
  model.rotation.y = THREE.MathUtils.degToRad(45);
  scene.add(model);

  mixer = new THREE.AnimationMixer(model);
  mixer.addEventListener('finished', () => { isPlaying = false; });

  const clips = gltf.animations || [];
  for (const spec of CFG.chapters || []) {
    const src = THREE.AnimationClip.findByName(clips, spec.clip);
    if (!src) { console.warn('[benefit-stage] clip not found:', spec.clip); continue; }
    const start = typeof spec.start === 'number' ? spec.start : (spec.trim || 0);
    const end = typeof spec.end === 'number' ? spec.end : src.duration;
    const clip = (start > 0 || end < src.duration - 1e-3)
      ? trimClipStart(src, start, end)
      : src;
    const action = mixer.clipAction(clip);
    action.setLoop(spec.loop ? THREE.LoopRepeat : THREE.LoopOnce, spec.loop ? Infinity : 1);
    action.clampWhenFinished = !spec.loop;
    const viewDir = new THREE.Vector3(...(spec.view || [0.16, 0.03, 1])).normalize();
    const ch = {
      spec, action, dur: clip.duration, viewDir, distMul: spec.distMul || 1,
      callouts: [], flashAt: spec.flash ? spec.flash.at : null, flashBone: spec.flash ? findBone(model, spec.flash.bone) : null,
      shakeAt: spec.shake ? spec.shake.at : null, shakePower: spec.shake ? spec.shake.power : 0,
      fired: { flash: false, shake: false },
    };
    for (const c of spec.callouts || []) {
      const el = document.createElement('div');
      el.className = 'bcallout';
      el.setAttribute('role', 'note');
      el.innerHTML = '<i></i>' + c.text;
      el.style.opacity = '0';
      /* dy staggers stacked labels (hips/core/shoulder/glove cluster in screen space) */
      if (c.dy) el.style.marginTop = c.dy + 'px';
      stageEl.appendChild(el);
      ch.callouts.push({ el, bone: findBone(model, c.bone), at: c.at, dur: c.dur, fired: false });
    }
    chapters.push(ch);
  }

  /* keep the rig posed during setup (bind pose lies flat) — chapter 0 at guard */
  if (chapters.length) {
    chapters[0].action.reset();
    chapters[0].action.setEffectiveWeight(1);
    chapters[0].action.play();
    mixer.setTime(Math.min(0.35, chapters[0].dur - 0.05));
    mixer.update(0);
  }
  model.updateMatrixWorld(true);

  /* ground the model */
  const pts = samplePose(model);
  let soleY = 1e9;
  for (const p of pts) if (p.y < soleY) soleY = p.y;
  if (soleY < -1e-4) {
    model.position.y += -soleY;
    for (const p of pts) p.y += -soleY;
    model.updateMatrixWorld(true);
  }

  /* per-chapter framing from a sampled union of each sub-clip */
  for (const ch of chapters) {
    const union = [];
    mixer.stopAllAction();
    ch.action.reset();
    ch.action.setEffectiveWeight(1);
    ch.action.play();
    for (let k = 0; k < 8; k++) {
      ch.action.time = ((k + 0.5) / 8) * ch.dur;
      mixer.update(0);
      model.updateMatrixWorld(true);
      union.push(...samplePose(model, 1200));
    }
    ch.framing = computeFraming(union, ch.viewDir, ch.distMul);
  }
  mixer.stopAllAction();
  chapters[0].action.reset();
  chapters[0].action.setEffectiveWeight(1);
  chapters[0].action.play();
  chapters[0].action.time = Math.min(0.35, chapters[0].dur - 0.05);
  mixer.update(0);
  model.updateMatrixWorld(true);

  applyFramingInstant(chapters[0].framing);

  /* stage bar: chapter chips + replay + slow-mo */
  chapters.forEach((ch, i) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'stage-btn';
    btn.dataset.clip = 'ch' + i;
    btn.textContent = String(i + 1);
    btn.title = ch.spec.label;
    btn.setAttribute('aria-label', ch.spec.label);
    btn.addEventListener('click', () => playChapter(i));
    barEl.appendChild(btn);
  });
  const replayBtn = document.createElement('button');
  replayBtn.type = 'button';
  replayBtn.className = 'stage-btn';
  replayBtn.dataset.clip = 'replay';
  replayBtn.textContent = 'Replay';
  replayBtn.addEventListener('click', () => playChapter(Math.max(0, active)));
  barEl.appendChild(replayBtn);
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

  playChapter(0);
  window.__benefit = {
    playChapter, chapters, mixer, model, samplePose, findBone,
    weightScan,
    get active() { return active; },
    get cam() { return { pos: camera.position.toArray().map((v) => +v.toFixed(2)), target: controls.target.toArray().map((v) => +v.toFixed(2)), dist: +camera.position.distanceTo(controls.target).toFixed(2) }; },
  };
  if (typeof CFG.onReady === 'function') CFG.onReady();
}

function applyFramingInstant(f) {
  if (!f) return;
  controls.target.copy(f.target);
  camera.position.copy(f.target).addScaledVector(f.dir, f.dist);
  camera.lookAt(f.target);
  controls.update();
}

function playChapter(i) {
  if (!mixer || !chapters.length || i === active) return;
  const prev = active >= 0 ? chapters[active] : null;
  const next = chapters[i];
  active = i;
  chapterT = 0;
  isPlaying = true;
  /* hide every callout first — the previous chapter's pills must not linger */
  for (const ch of chapters) ch.callouts.forEach((c) => { c.el.style.opacity = '0'; });
  next.fired = { flash: false, shake: false };
  next.callouts.forEach((c) => { c.fired = false; });
  next.action.reset();
  if (prev) {
    /* crossfade: the outgoing action holds the pose while this one blends in */
    next.action.fadeIn(0.18);
    next.action.play();
    prev.action.fadeOut(0.18);
  } else {
    next.action.setEffectiveWeight(1);
    next.action.play();
  }
  /* camera glide to the chapter's framing */
  camFrom = { target: controls.target.clone(), dist: camera.position.distanceTo(controls.target), dir: camera.position.clone().sub(controls.target).normalize() };
  camTo = next.framing;
  camBlend = 0;
  for (let k = 0; k < chapters.length; k++) {
    const btn = barEl.querySelector(`[data-clip="ch${k}"]`);
    if (btn) btn.classList.toggle('active', k === i);
  }
  if (typeof CFG.onActive === 'function') CFG.onActive(i);
}

/* flash sprite */
function makeFlashTex() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(64, 64, 4, 64, 64, 62);
  grad.addColorStop(0, 'rgba(255,236,190,0.95)');
  grad.addColorStop(0.4, 'rgba(255,170,80,0.5)');
  grad.addColorStop(1, 'rgba(255,140,60,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(c);
}
let flashTex = null;
function spawnFlash(worldPos) {
  if (!flashTex) flashTex = makeFlashTex();
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: flashTex, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
  sp.position.copy(worldPos);
  sp.scale.setScalar(0.5);
  scene.add(sp);
  flashes.push({ sp, born: performance.now(), ttl: 340 });
}

/* QA: play every chapter once, watch action weights + hand span (T-pose guard) */
function weightScan() {
  if (!mixer) return null;
  const dt = 1 / 60;
  const span = () => {
    const a = findBone(model, 'LeftHand'), b = findBone(model, 'RightHand');
    if (!a || !b) return 0;
    const p = new THREE.Vector3(), q = new THREE.Vector3();
    a.getWorldPosition(p); b.getWorldPosition(q);
    return p.distanceTo(q);
  };
  let minW = 9, atW = 0, maxSpan = 0, atSpan = 0;
  const weights = () => {
    let s = 0;
    for (const ch of chapters) s += ch.action.getEffectiveWeight();
    return s;
  };
  for (let i = 0; i < chapters.length; i++) {
    playChapter(i);
    mixer.update(0);
    for (let t = 0; t <= chapters[i].dur + 0.2; t += dt) {
      chapterT = t;
      mixer.update(dt);
      model.updateMatrixWorld(true);
      const w = weights();
      if (w < minW) { minW = w; atW = t + i * 100; }
      const s = span();
      if (s > maxSpan) { maxSpan = s; atSpan = t; }
    }
  }
  playChapter(0);
  return { minW: +minW.toFixed(3), atW, maxSpan: +maxSpan.toFixed(2), atSpan };
}

controls.addEventListener('start', () => { userMoved = true; camBlend = 1; });

/* ---------- render loop ---------- */
const clock = new THREE.Clock();
renderer.setAnimationLoop(() => {
  const dt = clock.getDelta();
  if (mixer) {
    mixer.update(dt);
    if (active >= 0) {
      const ch = chapters[active];
      /* chapter clock follows the mixer time scale (slow-mo keeps sync) */
      const prevT = chapterT;
      chapterT += dt * mixer.timeScale;
      if (ch.spec.loop && chapterT >= ch.dur) {
        chapterT = chapterT % ch.dur;
        ch.callouts.forEach((c) => { c.fired = false; c.el.style.opacity = '0'; });
        ch.fired = { flash: false, shake: false };
      }
      /* callout windows */
      for (const c of ch.callouts) {
        if (!c.bone) continue;
        const on = chapterT >= c.at && chapterT <= c.at + c.dur;
        c.el.style.opacity = on ? '1' : '0';
        if (on) {
          model.updateMatrixWorld(true);
          const v = c.bone.getWorldPosition(new THREE.Vector3());
          v.project(camera);
          const r = canvas.getBoundingClientRect();
          c.el.style.left = (v.x * 0.5 + 0.5) * r.width + 'px';
          c.el.style.top = (-v.y * 0.5 + 0.5) * r.height + 'px';
        }
      }
      /* one-shot fx */
      if (ch.flashAt !== null && !ch.fired.flash && chapterT >= ch.flashAt && ch.flashBone) {
        ch.fired.flash = true;
        model.updateMatrixWorld(true);
        spawnFlash(ch.flashBone.getWorldPosition(new THREE.Vector3()));
      }
      if (ch.shakeAt !== null && !ch.fired.shake && chapterT >= ch.shakeAt) {
        ch.fired.shake = true;
        shakeT = 0.35; shakePower = ch.shakePower;
      }
      if (prevT < ch.dur && chapterT >= ch.dur && !ch.spec.loop) isPlaying = false;
    }
  }
  /* camera glide */
  if (camBlend < 1 && camTo) {
    camBlend = Math.min(1, camBlend + dt / 0.75);
    const p = camBlend * camBlend * (3 - 2 * camBlend);
    const curDir = camera.position.clone().sub(controls.target).normalize();
    const dir = curDir.lerp(camTo.dir, p * 0.25).normalize();
    const dist = THREE.MathUtils.lerp(camFrom.dist, camTo.dist, p);
    const target = camFrom.target.clone().lerp(camTo.target, p);
    controls.target.copy(target);
    camera.position.copy(target).addScaledVector(dir, dist);
    camera.lookAt(target);
  }
  /* shake */
  if (shakeT > 0) {
    shakeT = Math.max(0, shakeT - dt);
    const k = (shakeT / 0.35) * shakePower;
    camera.position.x += (Math.random() - 0.5) * 0.05 * k;
    camera.position.y += (Math.random() - 0.5) * 0.05 * k;
  }
  /* expire flashes */
  for (let i = flashes.length - 1; i >= 0; i--) {
    const f = flashes[i];
    const age = performance.now() - f.born;
    if (age > f.ttl) { scene.remove(f.sp); f.sp.material.dispose(); flashes.splice(i, 1); }
    else f.sp.material.opacity = 1 - age / f.ttl;
  }
  headFill.position.copy(camera.position);
  headFill.target.position.copy(controls.target);
  headFill.position.sub(controls.target).setLength(6).add(controls.target);
  controls.update();
  renderer.render(scene, camera);
});
