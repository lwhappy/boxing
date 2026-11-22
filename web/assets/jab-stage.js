/* SilentJab — moves/jab.html cinematic stage
 *
 * Replaces the old single-move switcher stage on the jab page with a
 * boxing-vs-kickboxing style show:
 *   1. fullscreen (fixed, transparent) — the woman (the bvk kickboxer model)
 *      stands centre, throws the homepage-hero jab and FREEZES at the reach
 *      frame while the five hero callouts (same copy as the homepage) draw
 *      in with leader lines; after a 1 s hold everything fades;
 *   2. she shifts to the right into guard, the fight-game man slides in from
 *      the left on his game idle;
 *   3. she hops forward and jabs his head — he plays hit-to-head, dizzy
 *      stars orbit his crown;
 *   4. 1 s later the show ends: the stage docks back into the article flow
 *      as a small borderless canvas where both fighters idle. Replay restarts.
 *
 * Mouse actions are off everywhere (fixed-camera show); the wheel scrolls the
 * page. Deterministic timeline with a stepTo(t) QA hook.
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const canvas = document.getElementById('stage-canvas');
const stageEl = canvas.parentElement;
const loadingEl = document.getElementById('stage-loading');
const loadingText = document.getElementById('stage-loading-text');
const errorEl = document.getElementById('stage-error');
const replayBtn = document.getElementById('jab-replay');

/* bvk's kickboxer and the benefits-page woman are the same rig (identical
 * woman.fbx) — the benefits GLB already carries guard + jab. */
const WOMAN_URL = new URL('../training/benefits-of-boxing/models/woman.glb?v=1', import.meta.url).href;
/* clip donor: the fight-game boxer-woman — her jab steps in with the lead
 * foot. Same Mixamo rig (identical bone names + rest transforms), so the
 * clip plays straight on the page model. */
const WOMAN_GAME_URL = new URL('../media/glb/boxer-woman.glb?v=2', import.meta.url).href;
const MAN_URL = new URL('../media/glb/boxer-man.glb?v=2', import.meta.url).href;

const STAGGER = 0.72;      // callout card interval (s)
const HOLD = 1.0;          // hold after all callouts are shown (user spec: 1 s)
const SHIFT_DUR = 0.75;    // woman: centre -> right
const SETTLE = 0.55;       // both idle before the hop jab
const AFTERMATH = 2.0;     // dizzy hold before docking (user spec: 2 s)
const ARM_STRAIGHTEN = 0.7; // corrective blend for the page clip's bent lead arm
const WOMAN_X = 0.95;      // her spot on the right
const MAN_X = -1.15;       // his spot on the left

/* the five homepage-hero jab callouts, verbatim */
const CALLS = [
  ['Left fist', 'Lead hand snaps straight out, twisting inward the instant it lands.'],
  ['Right fist', 'Rear hand stays locked at the jaw — chin tucked, head covered.'],
  ['Waist', 'A short hip turn adds snap; the core braces instead of leaning in.'],
  ['Lead leg', 'Lead foot steps in to close the distance before the fist arrives.'],
  ['Rear leg', 'Rear foot stays planted at 45°, holding the base balanced.'],
];
const ANCHOR_KEYS = ['LeftHand', 'RightHand', 'Hips', 'LeftFoot', 'RightFoot'];
const SLOTS = [
  { side: 'l', top: 13 },
  { side: 'r', top: 13 },
  { side: 'l', top: 40 },
  { side: 'l', top: 69 },
  { side: 'r', top: 55 },
];

/* ---------- overlay: callout cards + leader lines + word badge ---------- */
const ui = document.createElement('div');
ui.className = 'hero-ui';
ui.innerHTML = '<svg class="hero-lines"></svg><div class="hero-callouts"></div>'
  + '<div class="hero-word"></div>';
stageEl.appendChild(ui);
const svg = ui.querySelector('.hero-lines');
const callsBox = ui.querySelector('.hero-callouts');
const wordEl = ui.querySelector('.hero-word');

const callEls = SLOTS.map((slot) => {
  const el = document.createElement('div');
  el.className = 'hero-callout';
  el.innerHTML = '<span class="tag"></span><span class="txt"></span>';
  callsBox.appendChild(el);
  return el;
});

/* cards sit well in from the screen edge so the leader lines stay short
 * (user spec: at least half the old length) */
function applyCardInset() {
  const w = stageEl.clientWidth || window.innerWidth || 1280;
  const inset = Math.max(10, Math.min(w * 0.16, 260));
  callEls.forEach((el, i) => {
    el.style[SLOTS[i].side === 'l' ? 'left' : 'right'] = inset.toFixed(0) + 'px';
  });
}

/* cards never overlap: same column-packing as the homepage hero, minus the
 * dots row and control bar this page does not have */
function layoutCallouts() {
  applyCardInset();
  const h = callsBox.clientHeight || stageEl.clientHeight;
  if (!h) return;
  const minTop = Math.max(4, h * 0.022);
  const limit = h * 0.97;
  for (const side of ['l', 'r']) {
    const order = SLOTS.map((s, i) => ({ s, i }))
      .filter(x => x.s.side === side)
      .sort((a, b) => a.s.top - b.s.top);
    const plan = (gap) => {
      const tops = [];
      let prevBottom = null;
      for (const { s, i } of order) {
        const slotTop = (s.top / 100) * h;
        const top = prevBottom === null ? slotTop : Math.max(slotTop, prevBottom + gap);
        tops.push(top);
        prevBottom = top + (callEls[i].offsetHeight || 0);
      }
      return { tops, bottom: prevBottom };
    };
    let p = null;
    for (const gap of [10, 8, 6, 4, 2]) {
      const cand = plan(gap);
      const shift = Math.min(Math.max(0, cand.bottom - limit), Math.max(0, cand.tops[0] - minTop));
      for (let k = 0; k < cand.tops.length; k++) cand.tops[k] -= shift;
      cand.bottom -= shift;
      if (cand.bottom <= limit + 0.5) { p = cand; break; }
    }
    if (!p) p = plan(2);
    order.forEach(({ i }, k) => { callEls[i].style.top = (p.tops[k] / h * 100).toFixed(2) + '%'; });
  }
}
window.addEventListener('resize', () => requestAnimationFrame(layoutCallouts));

const lineEls = SLOTS.map(() => {
  const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
  const line = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
  const dot = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
  dot.setAttribute('r', '3.4');
  g.appendChild(line);
  g.appendChild(dot);
  g.style.opacity = '0';
  g.style.transition = 'opacity 0.28s ease';
  svg.appendChild(g);
  return { g, line, dot };
});

function hideCallouts() {
  shown = 0;
  callEls.forEach((el) => el.classList.remove('show'));
  lineEls.forEach((l) => { l.g.style.opacity = '0'; });
  wordEl.classList.remove('show');
}
function revealAt(i) {
  callEls[i].classList.add('show');
  lineEls[i].g.style.opacity = '1';
}
function prefillCallouts() {
  for (let i = 0; i < callEls.length; i++) {
    callEls[i].querySelector('.tag').textContent = CALLS[i][0];
    callEls[i].querySelector('.txt').textContent = CALLS[i][1];
  }
  layoutCallouts();
}

/* ---------- renderer / scene ---------- */
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.42;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 60);
const camPos = new THREE.Vector3(0, 1.2, 4.5);
const camTgt = new THREE.Vector3(0, 0.95, 0);

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
scene.add(headFill, headFill.target);

function resize() {
  const w = stageEl.clientWidth || 1;
  const h = stageEl.clientHeight || 1;
  renderer.setSize(w, h, false);
  camera.aspect = w / Math.max(1, h);
  camera.updateProjectionMatrix();
}
new ResizeObserver(resize).observe(stageEl);
resize();

/* ---------- shared helpers ---------- */
function forceOpaque(mat) {
  if (!mat || !mat.transparent) return;
  mat.transparent = false;
  mat.depthWrite = true;
  mat.alphaTest = 0;
}
/* three r170 + Tripo baked textures under MeshStandardMaterial produce blotchy
 * artifacts — swap to MeshPhongMaterial exactly like the homepage stage */
function fixMaterials(root) {
  root.traverse((o) => {
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
        m.transparent = false;
        m.opacity = 1;
        forceOpaque(m);
      }
    }
    if (o.isMesh) { o.frustumCulled = false; o.castShadow = false; }
  });
}
const _nv = new THREE.Vector3();
function boneByName(root, key) {
  const norm = (s) => s.replace(/[^a-z]/gi, '').toLowerCase();
  const want = norm(key);
  let found = null;
  root.traverse((o) => {
    if (!found && o.isBone && norm(o.name).endsWith(want)) found = o;
  });
  return found;
}
function lowestSkinnedPoint(root) {
  let low = Infinity;
  const tv = new THREE.Vector3();
  root.traverse((o) => {
    if (!o.isMesh || !o.geometry) return;
    const pos = o.geometry.attributes.position;
    const step = Math.max(1, Math.floor(pos.count / 3000));
    for (let i = 0; i < pos.count; i += step) {
      tv.fromBufferAttribute(pos, i);
      if (o.isSkinnedMesh) o.applyBoneTransform(i, tv);
      tv.applyMatrix4(o.matrixWorld);
      if (tv.y < low) low = tv.y;
    }
  });
  return Number.isFinite(low) ? low : 0;
}
function play(f, name, { fade = 0.2, clamp = false, loop = false } = {}) {
  const next = f.actions[name];
  if (!next) return;
  next.reset();
  next.setLoop(loop ? THREE.LoopRepeat : THREE.LoopOnce, loop ? Infinity : 1);
  next.clampWhenFinished = clamp;
  next.setEffectiveTimeScale(1);
  next.setEffectiveWeight(1);
  if (fade > 0) next.fadeIn(fade);
  next.play();
  for (const a of Object.values(f.actions)) {
    if (a === next) continue;
    const w = a.getEffectiveWeight();
    if (w > 0.001) a.fadeOut(Math.max(fade, 0.001));
    else if (a.enabled) a.stop();
  }
}

/* ---------- loading ---------- */
let loadDone = 0;
function prog(e) {
  if (!e.total) return;
  loadDone++;
  loadingText.textContent = `Loading 3D models — ${Math.min(100, Math.round(((loadDone - 1) + (e.loaded / e.total)) / 2 * 100))}%`;
}
function loadGLB(url) {
  return new Promise((res, rej) => new GLTFLoader().load(url, res, prog, rej));
}

Promise.all([loadGLB(WOMAN_URL), loadGLB(MAN_URL), loadGLB(WOMAN_GAME_URL)]).then(([wg, mg, fg]) => {
  try { build(wg, mg, fg); }
  catch (err) { fail(err); }
}).catch(fail);

function fail(err) {
  loadingEl.classList.add('hidden');
  errorEl.hidden = false;
  errorEl.textContent = 'Failed to load the 3D models.\n' + (err && err.message ? err.message : err);
  console.error('[jab-stage]', err);
}

/* ---------- fighters ---------- */
const woman = { group: new THREE.Group(), mixer: null, actions: {}, bones: {} };
const man = { group: new THREE.Group(), mixer: null, actions: {}, bones: {} };
scene.add(woman.group, man.group);

const _sv = new THREE.Vector3();

/* The page clip's lead arm keeps a bend at the elbow through the jab (baked
 * into the source animation). We can't edit the GLB, so we straighten the
 * arm procedurally: rotate the forearm onto the upper-arm axis every frame
 * the pose is evaluated, blended by ARM_STRAIGHTEN. */
const _sa = new THREE.Vector3(), _sb = new THREE.Vector3(), _sc = new THREE.Vector3();
const _sq = new THREE.Quaternion(), _sq2 = new THREE.Quaternion(), _sq0 = new THREE.Quaternion();
function straightenLeadArm() {
  const sh = woman.bones.LeftArm, el = woman.bones.LeftForeArm, hd = woman.bones.LeftHand;
  if (!sh || !el || !hd) return;
  woman.group.updateMatrixWorld(true);
  sh.getWorldPosition(_sa);
  el.getWorldPosition(_sb);
  hd.getWorldPosition(_sc);
  const upper = _sa.copy(_sb).sub(_sa).normalize();   // shoulder -> elbow
  const fore = _sb.copy(_sc).sub(_sb).normalize();    // elbow -> hand
  _sq.setFromUnitVectors(fore, upper);
  el.parent.getWorldQuaternion(_sq2);
  _sq.premultiply(_sq2.clone().invert());   // correction in elbow-local space
  _sq0.identity().slerp(_sq, ARM_STRAIGHTEN);
  el.quaternion.premultiply(_sq0);
  el.updateMatrixWorld(true);
}

function samplePose(root, budget = 9000) {
  root.updateMatrixWorld(true);
  const meshes = [];
  let total = 0;
  root.traverse((o) => {
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
      _sv.fromBufferAttribute(pos, i);
      if (o.isSkinnedMesh) o.applyBoneTransform(i, _sv);
      _sv.applyMatrix4(o.matrixWorld);
      pts.push(_sv.clone());
    }
  }
  return pts;
}

/* kickboxer: Z-up bind pose (Mixamo FBX heritage) — rotate, normalize to
 * 1.75 m off a guard frame, drop the soles to y=0. Faces LEFT (-X). */
function buildWoman(gltf) {
  const root = gltf.scene;
  fixMaterials(root);
  woman.group.add(root);
  woman.group.rotation.y = -Math.PI / 2;
  /* the bind pose is Z-up and lying flat — stand the rig up first, then
   * measure the real skinned height off a guard frame */
  root.rotation.x = -Math.PI / 2;
  root.updateMatrixWorld(true);
  for (const n of ANCHOR_KEYS) woman.bones[n] = boneByName(root, n);
  woman.mixer = new THREE.AnimationMixer(root);
  for (const clip of gltf.animations) {
    if (/Layer0$/.test(clip.name)) continue;
    const act = woman.mixer.clipAction(clip);
    act.enabled = true;
    woman.actions[clip.name] = act;
  }
  const guard = woman.actions.guard || Object.values(woman.actions)[0];
  guard.reset().play();
  woman.mixer.setTime(0.5);
  let pts = samplePose(root);
  const h0 = Math.max(...pts.map(p => p.y)) - Math.min(...pts.map(p => p.y));
  root.scale.setScalar(1.75 / h0);
  root.updateMatrixWorld(true);
  pts = samplePose(root);
  root.position.y -= Math.min(...pts.map(p => p.y));
  root.updateMatrixWorld(true);
  woman.mixer.stopAllAction();
}

/* fight-game man: already Y-up. Normalize height from the skeleton,
 * ground the soles, face RIGHT (+X). */
function buildMan(gltf) {
  const root = gltf.scene;
  fixMaterials(root);
  man.group.add(root);
  man.group.rotation.y = Math.PI / 2;
  man.bones.Head = boneByName(root, 'Head');
  man.mixer = new THREE.AnimationMixer(root);
  for (const clip of gltf.animations) {
    const act = man.mixer.clipAction(clip);
    act.enabled = true;
    man.actions[clip.name] = act;
  }
  const idle = man.actions.idle || Object.values(man.actions)[0];
  idle.reset().play();
  man.mixer.setTime(1.0);
  const head = man.bones.Head;
  const yTop = head ? head.getWorldPosition(_sv).y : 1.6;
  man.mixer.setTime(0);
  root.updateMatrixWorld(true);
  const feet = [];
  for (const k of ['LeftFoot', 'RightFoot']) {
    const b = boneByName(root, k);
    if (b) feet.push(b.getWorldPosition(_sv).y);
  }
  const h = Math.max(0.001, yTop - Math.min(...feet, 0));
  root.scale.multiplyScalar(1.75 / h);
  root.updateMatrixWorld(true);
  root.position.y -= lowestSkinnedPoint(root) - 0.003;
  root.updateMatrixWorld(true);
  man.mixer.stopAllAction();
}

/* ---------- choreography probes ---------- */
let jabDur = 1.0;
let jabImpact = 0.6;      // intro-clip time of the reach frame
let fightDur = 1.0;
let fightImpact = 0.6;    // fight-clip time of the reach frame
let gloveXF = -0.5;       // fight-jab glove world x at impact (woman at x=0)
let headX0 = 0;           // man head world x (man at x=0)
let hitHeadDur = 1.0;
let contactX = 0;         // woman x at contact

function probe() {
  const hand = woman.bones.LeftHand;

  /* intro jab: the page clip, played with the procedurally straightened arm */
  const wAct = woman.actions.jab;
  jabDur = wAct.getClip().duration;
  wAct.reset().setEffectiveTimeScale(1).setEffectiveWeight(1).play();
  let best = { t: 0, x: Infinity };
  for (let i = 0; i <= 64; i++) {
    const t = (jabDur * i) / 64;
    woman.mixer.setTime(t);
    straightenLeadArm();
    woman.group.updateMatrixWorld(true);
    hand.getWorldPosition(_sv);
    if (_sv.x < best.x) best = { t, x: _sv.x };
  }
  jabImpact = best.t;
  woman.mixer.stopAllAction();

  /* fight jab: donor clip (steps in with the lead foot) — find the reach
   * frame for the contact solve */
  const fAct = woman.actions['jab-fight'];
  if (fAct) {
    fightDur = fAct.getClip().duration;
    fAct.reset().setEffectiveTimeScale(1).setEffectiveWeight(1).play();
    best = { t: 0, x: Infinity };
    for (let i = 0; i <= 96; i++) {
      const t = (fightDur * i) / 96;
      woman.mixer.setTime(t);
      woman.group.updateMatrixWorld(true);
      hand.getWorldPosition(_sv);
      if (_sv.x < best.x) best = { t, x: _sv.x };
    }
    fightImpact = best.t;
    gloveXF = best.x;
    woman.mixer.stopAllAction();
  }

  const hh = man.actions['hit-head'];
  if (hh) hitHeadDur = hh.getClip().duration;
  const idle = man.actions.idle;
  idle.reset().play();
  man.mixer.setTime(1.0);
  man.group.updateMatrixWorld(true);
  headX0 = man.bones.Head ? man.bones.Head.getWorldPosition(_sv).x : 0;
  man.mixer.stopAllAction();

  /* land her glove on his crown: gloveX = contactX + gloveXF = MAN_X + headX0 */
  contactX = MAN_X + headX0 - 0.03 - gloveXF;
}

/* ---------- impact FX + dizzy stars ---------- */
let flashTex = null;
function getFlashTexture() {
  if (flashTex) return flashTex;
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  const rad = g.createRadialGradient(64, 64, 4, 64, 64, 62);
  rad.addColorStop(0, 'rgba(255,255,255,1)');
  rad.addColorStop(0.35, 'rgba(255,214,140,0.9)');
  rad.addColorStop(1, 'rgba(255,140,60,0)');
  g.fillStyle = rad;
  g.fillRect(0, 0, 128, 128);
  flashTex = new THREE.CanvasTexture(c);
  return flashTex;
}
const sparkGeo = new THREE.SphereGeometry(0.022, 6, 5);
const sparkMat = new THREE.MeshBasicMaterial({ color: 0xffa24a });
const fx = [];
function spawnImpact(pos) {
  const spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: getFlashTexture(), transparent: true, depthWrite: false }));
  spr.position.copy(pos);
  spr.scale.setScalar(0.14);
  scene.add(spr);
  fx.push({ type: 'flash', obj: spr, t: 0, dur: 0.28 });
  for (let i = 0; i < 12; i++) {
    const m = new THREE.Mesh(sparkGeo, sparkMat);
    m.position.copy(pos);
    fx.push({
      type: 'spark', obj: m, t: 0, dur: 0.42 + Math.random() * 0.18,
      v: new THREE.Vector3((Math.random() - 0.5) * 2.6, Math.random() * 2.4 + 0.5, (Math.random() - 0.5) * 1.6),
    });
    scene.add(m);
  }
}
function updateFx(dt) {
  for (let i = fx.length - 1; i >= 0; i--) {
    const e = fx[i];
    e.t += dt;
    const p = e.t / e.dur;
    if (p >= 1) { scene.remove(e.obj); fx.splice(i, 1); continue; }
    if (e.type === 'flash') { e.obj.scale.setScalar(0.14 + p * 0.6); e.obj.material.opacity = 1 - p; }
    else { e.v.y -= 5.5 * dt; e.obj.position.addScaledVector(e.v, dt); e.obj.scale.setScalar(Math.max(0.2, 1 - p)); }
  }
}

/* three little stars orbiting the hurt man's crown */
function starGeometry(outer, inner) {
  const shape = new THREE.Shape();
  for (let i = 0; i < 10; i++) {
    const r = i % 2 === 0 ? outer : inner;
    const a = (i / 10) * Math.PI * 2 - Math.PI / 2;
    const x = Math.cos(a) * r;
    const y = Math.sin(a) * r;
    if (i === 0) shape.moveTo(x, y); else shape.lineTo(x, y);
  }
  shape.closePath();
  return new THREE.ShapeGeometry(shape);
}
const stars = new THREE.Group();
const starMat = new THREE.MeshBasicMaterial({ color: 0xffd54a, side: THREE.DoubleSide });
const starEls = [];
for (let i = 0; i < 3; i++) {
  const m = new THREE.Mesh(starGeometry(0.055, 0.024), starMat);
  stars.add(m);
  starEls.push(m);
}
stars.visible = false;
scene.add(stars);
let starsT = 0;
function updateStars(dt) {
  if (!stars.visible) return;
  starsT += dt;
  const head = man.bones.Head;
  if (!head) return;
  head.getWorldPosition(_sv);
  stars.position.set(_sv.x, _sv.y + 0.22, _sv.z);
  for (let i = 0; i < 3; i++) {
    const a = starsT * 2.6 + (i / 3) * Math.PI * 2;
    const el = starEls[i];
    el.position.set(Math.cos(a) * 0.24, Math.sin(starsT * 3 + i) * 0.03, Math.sin(a) * 0.13);
    el.rotation.y = a;
    el.rotation.z = starsT * 3;
  }
}

/* ---------- show state ---------- */
let phase = 'load';       // intro | reveal | shift | settle | attack | aftermath | docked
let showT = 0;
let revT = 0, shown = 0;
let shiftT = 0, settleT = 0, attackT = 0, afterT = 0, dockT = 0;
let fired = false, manBackIdle = false, steppedBack = false;
let shakeT = 0;

function freezeWoman() {
  const wa = woman.actions.jab;
  wa.time = Math.min(jabImpact, jabDur);
  woman.mixer.update(0);
  straightenLeadArm();
  woman.group.updateMatrixWorld(true);
}

function contact() {
  play(man, 'hit-head', { clamp: true, fade: 0.06 });
  const glove = woman.bones.LeftHand ? woman.bones.LeftHand.getWorldPosition(new THREE.Vector3()) : new THREE.Vector3(contactX + gloveXF, 1.5, 0);
  const head = man.bones.Head ? man.bones.Head.getWorldPosition(new THREE.Vector3()) : new THREE.Vector3(MAN_X, 1.6, 0);
  spawnImpact(glove.add(head).multiplyScalar(0.5));
  stars.visible = true;
  starsT = 0;
  shakeT = 0.5;
}

function dock() {
  phase = 'docked';
  dockT = 0;
  stageEl.classList.remove('jab-live');
  stageEl.classList.add('jab-docked');
  replayBtn.hidden = false;
  play(woman, 'guard', { fade: 0.3, loop: true });
  resize();
}

function resetShow() {
  phase = 'intro';
  showT = 0;
  revT = 0; shown = 0;
  shiftT = 0; settleT = 0; attackT = 0; afterT = 0; dockT = 0;
  fired = false; manBackIdle = false; steppedBack = false;
  shakeT = 0; starsT = 0;
  hideCallouts();
  for (const e of fx) scene.remove(e.obj);
  fx.length = 0;
  stars.visible = false;
  stageEl.classList.remove('jab-docked');
  stageEl.classList.add('jab-live');
  replayBtn.hidden = true;
  woman.group.position.set(0, 0, 0);
  woman.mixer.stopAllAction();
  play(woman, 'jab', { fade: 0, clamp: true });
  man.group.visible = false;
  man.group.position.set(MAN_X - 2.2, 0, 0);
  man.mixer.stopAllAction();
  camPos.set(0, 1.2, 4.5);
  camTgt.set(0, 0.95, 0);
  resize();
}

function advance(dt) {
  showT += dt;
  const dancing = phase !== 'reveal';   // her mixer freezes during the callouts
  if (dancing && woman.mixer) woman.mixer.update(dt);
  if (phase === 'intro') straightenLeadArm();   // keep the lead arm straight
  if (man.group.visible && man.mixer) man.mixer.update(dt);

  if (phase === 'intro') {
    const wa = woman.actions.jab;
    if (wa && wa.time >= jabImpact - 1e-3) {
      freezeWoman();
      phase = 'reveal';
      revT = 0; shown = 0;
      wordEl.textContent = 'JAB';
      wordEl.classList.add('pos-a');
      requestAnimationFrame(() => wordEl.classList.add('show'));
      prefillCallouts();
    }
  } else if (phase === 'reveal') {
    revT += dt;
    while (shown < 5 && revT >= shown * STAGGER) revealAt(shown++);
    if (shown === 5 && revT >= 5 * STAGGER + HOLD) {
      hideCallouts();
      phase = 'shift';
      shiftT = 0;
      play(woman, 'guard', { fade: 0.3, loop: true });
      man.group.visible = true;
      man.group.position.set(MAN_X - 2.2, 0, 0);
      play(man, 'idle', { fade: 0.25, loop: true });
    }
  } else if (phase === 'shift') {
    shiftT += dt;
    const p = Math.min(1, shiftT / SHIFT_DUR);
    const e = p * p * (3 - 2 * p);
    woman.group.position.x = THREE.MathUtils.lerp(0, WOMAN_X, e);
    man.group.position.x = THREE.MathUtils.lerp(MAN_X - 2.2, MAN_X, e);
    if (p >= 1) { phase = 'settle'; settleT = 0; }
  } else if (phase === 'settle') {
    settleT += dt;
    if (settleT >= SETTLE) {
      phase = 'attack';
      attackT = 0;
      fired = false;
      play(woman, woman.actions['jab-fight'] ? 'jab-fight' : 'jab', { fade: 0.1, clamp: true });
    }
  } else if (phase === 'attack') {
    /* the fight jab steps in with its own footwork — she only glides the
     * remaining distance on the ground, no extra hop arc */
    attackT += dt;
    const p = Math.min(1, attackT / Math.max(0.2, fightImpact));
    const e = p * p * (3 - 2 * p);
    woman.group.position.x = THREE.MathUtils.lerp(WOMAN_X, contactX, e);
    const wa = woman.actions['jab-fight'] || woman.actions.jab;
    const impact = woman.actions['jab-fight'] ? fightImpact : jabImpact;
    if (!fired && wa && wa.time >= impact - 1e-3) {
      fired = true;
      contact();
      phase = 'aftermath';
      afterT = 0;
    }
  } else if (phase === 'aftermath') {
    afterT += dt;
    /* she doesn't linger chest-to-chest: half a second after the hit she
     * returns to her own spot in guard, so the docked canvas shows the two
     * squared up at sparring distance */
    if (!steppedBack && afterT >= 0.25) {
      steppedBack = true;
      play(woman, 'guard', { fade: 0.25, loop: true });
      woman.retreatFrom = woman.group.position.x;
    }
    if (steppedBack) {
      const p = Math.min(1, (afterT - 0.25) / 0.6);
      const e = p * p * (3 - 2 * p);
      woman.group.position.x = THREE.MathUtils.lerp(woman.retreatFrom, WOMAN_X, e);
    }
    if (afterT >= AFTERMATH) dock();
  } else if (phase === 'docked') {
    dockT += dt;
    if (dockT > 2.5) stars.visible = false;
  }

  /* the hurt man settles back to his idle once hit-head has played out */
  const hh = man.actions['hit-head'];
  if (hh && !manBackIdle && (phase === 'aftermath' || phase === 'docked')
      && hh.time >= hitHeadDur - 0.03) {
    manBackIdle = true;
    play(man, 'idle', { fade: 0.35, loop: true });
  }

  if (shakeT > 0) shakeT = Math.max(0, shakeT - dt);
  updateFx(dt);
  updateStars(dt);
}

/* ---------- camera ---------- */
const _want = { pos: new THREE.Vector3(), tgt: new THREE.Vector3() };
function computeCamera() {
  const aspect = camera.aspect || 1;
  const tanH = Math.tan(camera.fov * Math.PI / 360);
  if (phase === 'intro' || phase === 'reveal') {
    /* solo: she fills the frame like the homepage hero demo */
    const zH = 1.32 / tanH;                      // ~2.2m visible height at fov 38
    const zW = 0.85 / (tanH * aspect);
    const z = Math.max(3.6, zH, zW);
    _want.tgt.set(-0.15, 0.92, 0);
    _want.pos.set(_want.tgt.x + z * 0.30, _want.tgt.y + z * 0.12, z);
  } else {
    const wx = woman.group.position.x;
    const mx = man.group.visible ? man.group.position.x : MAN_X;
    const mid = (wx + mx) / 2;
    const span = Math.abs(wx - mx) + 1.5;
    const zH = 1.12 / tanH;
    const zW = (span / 2) / (tanH * aspect);
    const z = Math.max(2.9, zH, zW);
    _want.tgt.set(mid, 1.02, 0);
    _want.pos.set(mid + z * 0.16, 1.18, z);
  }
}
function updateCamera(dt) {
  computeCamera();
  const k = vt !== null ? 1 : 1 - Math.exp(-dt * 3.2);
  camPos.lerp(_want.pos, k);
  camTgt.lerp(_want.tgt, k);
  camera.position.copy(camPos);
  if (shakeT > 0) {
    const s = shakeT * 0.045;
    camera.position.x += (Math.random() - 0.5) * s;
    camera.position.y += (Math.random() - 0.5) * s;
  }
  camera.lookAt(camTgt);
  headFill.position.copy(camera.position).sub(camTgt).setLength(6).add(camTgt);
  headFill.target.position.copy(camTgt);
}

/* ---------- callout projection ---------- */
function updateCallouts() {
  if (!shown) return;
  const w = stageEl.clientWidth;
  const h = stageEl.clientHeight;
  if (!w || !h) return;
  for (let i = 0; i < 5; i++) {
    if (i >= shown) continue;
    const bone = woman.bones[ANCHOR_KEYS[i]];
    if (!bone) continue;
    bone.getWorldPosition(_sv);
    _sv.project(camera);
    const ax = (_sv.x * 0.5 + 0.5) * w;
    const ay = (-_sv.y * 0.5 + 0.5) * h;
    const el = callEls[i];
    const cw = el.offsetWidth || 160;
    const ch = el.offsetHeight || 52;
    const onRight = el.offsetLeft > w / 2;
    const lx = onRight ? el.offsetLeft : el.offsetLeft + cw;
    const ly = el.offsetTop + ch / 2;
    const dir = onRight ? 1 : -1;
    const l = lineEls[i];
    l.line.setAttribute('points',
      `${ax.toFixed(1)},${ay.toFixed(1)} ${(ax + dir * 18).toFixed(1)},${ay.toFixed(1)} ${lx.toFixed(1)},${ly.toFixed(1)}`);
    l.dot.setAttribute('cx', ax.toFixed(1));
    l.dot.setAttribute('cy', ay.toFixed(1));
  }
}

/* ---------- loop ---------- */
const clock = new THREE.Clock();
let running = false;
let vt = null;            // QA virtual time — set while stepping

function render() {
  updateCallouts();
  renderer.render(scene, camera);
}

function frame() {
  const dt = Math.min(clock.getDelta(), 0.05);
  if (phase !== 'load') advance(dt);
  updateCamera(dt);
  render();
}

function startLoop() {
  if (running) return;
  clock.getDelta();
  renderer.setAnimationLoop(frame);
  running = true;
}
function stopLoop() {
  if (!running) return;
  renderer.setAnimationLoop(null);
  running = false;
}

replayBtn.addEventListener('click', () => {
  resetShow();
});

let visible = true;
if ('IntersectionObserver' in window) {
  new IntersectionObserver(([entry]) => {
    visible = entry.isIntersecting;
    if (visible && !document.hidden && phase !== 'load') startLoop();
    else if (running) stopLoop();
  }, { rootMargin: '120px' }).observe(stageEl);
}
document.addEventListener('visibilitychange', () => {
  if (document.hidden && running) stopLoop();
  else if (!document.hidden && visible && phase !== 'load') startLoop();
});

function build(wg, mg, fg) {
  buildWoman(wg);
  buildMan(mg);
  /* donor clip: the fight-game jab (lead-foot step) retargeted onto her rig */
  if (fg && woman.mixer) {
    const fjab = (fg.animations || []).find(c => c.name === 'jab');
    if (fjab) {
      const act = woman.mixer.clipAction(fjab);
      act.enabled = true;
      woman.actions['jab-fight'] = act;
    }
  }
  probe();
  loadingEl.classList.add('hidden');
  layoutCallouts();
  resetShow();
  startLoop();

  window.__jab = {
    get phase() { return phase; },
    get t() { return showT; },
    jabImpact, fightImpact, contactX, gloveXF,
    woman, man, camera, THREE,
    stepTo(target) {
      stopLoop();              // exact-time QA: no wall-clock interleaving
      const dt = 1 / 30;
      let guard = 0;
      vt = 0;
      while (showT < target - 1e-6 && guard++ < 3000) advance(dt);
      vt = null;
      updateCamera(1 / 30);
      render();
    },
    restart: () => { resetShow(); startLoop(); },
    resume: () => startLoop(),
  };
}
