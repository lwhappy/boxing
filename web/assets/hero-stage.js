/* SilentJab — homepage hero tutorial (replaces the old switcher on the home page only)
 *
 * 模型：media/glb/man-hero.glb（man.fbx + punch.zip 的四个动作）
 * 流程：jab → cross → right hook → left uppercut 依次自动播放；
 *       每一拳在「打到最远的一帧」冻结，然后依次从 左拳 → 右拳 → 腰 → 左腿 → 右腿
 *       拉出折线标注英文要点，全部显示完停留 2 秒，再播下一个动作。
 *       支持暂停 / 0.5 倍速 / 拖拽环绕 / 滚轮缩放。
 *
 * moves/ 下的六个招式页仍然用 home-stage.js，本模块只被 index.html 引用。
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const GLB_URL = new URL('../media/glb/man-hero.glb?v=1', import.meta.url).href;

/* 每条动作五个标注：左拳 → 右拳 → 腰 → 左腿 → 右腿（顺序固定，文案按动作换） */
const ACTIONS = [
  {
    id: 'jab',
    clip: 'jab',
    word: 'JAB',
    hand: 'LeftHand',
    calls: [
      ['Left fist', 'Lead hand snaps straight out, twisting inward the instant it lands.'],
      ['Right fist', 'Rear hand stays locked at the jaw — chin tucked, head covered.'],
      ['Waist', 'A short hip turn adds snap; the core braces instead of leaning in.'],
      ['Lead leg', 'Lead foot steps in to close the distance before the fist arrives.'],
      ['Rear leg', 'Rear foot stays planted at 45°, holding the base balanced.'],
    ],
  },
  {
    id: 'cross',
    clip: 'cross',
    word: 'CROSS',
    hand: 'RightHand',
    calls: [
      ['Left fist', 'Lead hand pulls straight back to the guard, chin behind the shoulder.'],
      ['Right fist', 'Rear hand fires down the centre line, fist turning over at impact.'],
      ['Waist', 'Hips and torso rotate hard — that turn, not the arm, is the power.'],
      ['Lead leg', 'Lead foot takes the weight as the hips drive the punch forward.'],
      ['Rear leg', 'Rear heel lifts and the foot pivots at 45°, feeding the rotation.'],
    ],
  },
  {
    id: 'right-hook',
    clip: 'right-hook',
    word: 'RIGHT HOOK',
    hand: 'RightHand',
    calls: [
      ['Left fist', 'Lead hand stays high, shielding the head on the inside.'],
      ['Right fist', 'Rear hand swings the arc with the elbow locked at 90°, palm turning down.'],
      ['Waist', 'Hips lead the turn and the torso whips around the spine axis.'],
      ['Lead leg', 'Lead foot pivots a little to open the hip for the swing.'],
      ['Rear leg', 'Rear foot turns on the ball, heel up, 45° for balance.'],
    ],
  },
  {
    id: 'left-uppercut',
    clip: 'left-uppercut',
    word: 'LEFT UPPERCUT',
    hand: 'LeftHand',
    calls: [
      ['Left fist', 'Lead fist dips slightly, then drives up under the chin, palm up.'],
      ['Right fist', 'Rear hand stays tight at the temple as a shield.'],
      ['Waist', 'Knees bend, then the hips drive upward — the power comes off the floor.'],
      ['Lead leg', 'Lead leg loads and extends, pushing the whole body up into the punch.'],
      ['Rear leg', 'Rear foot stays planted at 45°, anchoring the upward drive.'],
    ],
  },
];

/* 标注卡的固定槽位（左右两列，避开中间的人物；上下拉得更开，手机端也不挤） */
const SLOTS = [
  { side: 'l', top: 13 },
  { side: 'r', top: 13 },
  { side: 'l', top: 40 },
  { side: 'l', top: 69 },
  { side: 'r', top: 55 },
];

const STAGGER = 0.72;   // 每条标注之间的间隔（秒）
const HOLD = 2.0;       // 全部标完后的停留
const GAP = 0.4;        // 两个动作之间的过渡

const canvas = document.getElementById('stage-canvas');
const stage = canvas.parentElement;
const barEl = document.getElementById('stage-bar');
const loadingEl = document.getElementById('stage-loading');
const loadingText = document.getElementById('stage-loading-text');
const errorEl = document.getElementById('stage-error');

/* ---------- overlay ---------- */
const ui = document.createElement('div');
ui.className = 'hero-ui';
ui.innerHTML = '<svg class="hero-lines"></svg><div class="hero-callouts"></div>'
  + '<div class="hero-word"></div><div class="hero-dots"></div>'
  + '<span class="hero-hint">drag to orbit</span>';
stage.appendChild(ui);
const svg = ui.querySelector('svg.hero-lines');
const callsBox = ui.querySelector('.hero-callouts');
const wordEl = ui.querySelector('.hero-word');
const dotsEl = ui.querySelector('.hero-dots');

const callEls = SLOTS.map((slot) => {
  const el = document.createElement('div');
  el.className = 'hero-callout';
  el.style[slot.side === 'l' ? 'left' : 'right'] = '10px';
  el.style.top = slot.top + '%';
  el.innerHTML = '<span class="tag"></span><span class="txt"></span>';
  callsBox.appendChild(el);
  return el;
});

/* 卡片按实际高度防重叠排布：同一列里自上而下推挤，保证相邻卡片至少隔 8px；
   若推到溢出底部，则整列上移收口。手机端舞台矮、文字换行多，
   固定百分比槽位会重合，这里在 load/resize/换动作时重算。 */
function layoutCallouts() {
  const h = callsBox.clientHeight || stage.clientHeight;
  if (!h) return;
  for (const side of ['l', 'r']) {
    const order = SLOTS.map((s, i) => ({ s, i }))
      .filter(x => x.s.side === side)
      .sort((a, b) => a.s.top - b.s.top);
    // 先按原槽位 + 最小间隔自上而下排
    let prevBottom = -1;
    const tops = [];
    for (const { s, i } of order) {
      const cardH = callEls[i].offsetHeight || 0;
      const minTopPct = prevBottom < 0 ? s.top : Math.max(s.top, (prevBottom + 10) / h * 100);
      tops.push(minTopPct);
      prevBottom = (minTopPct / 100 * h) + cardH;
    }
    // 溢出底部则整列上移（避开底部控制条，不低于 1%）
    const last = order[order.length - 1];
    const barH = (barEl && barEl.offsetHeight ? barEl.offsetHeight + 14 : 54);
    const overflow = prevBottom - (h - barH);
    if (overflow > 0) {
      const shiftPct = overflow / h * 100;
      for (let k = 0; k < tops.length; k++) tops[k] = Math.max(1, tops[k] - shiftPct);
    }
    order.forEach(({ i }, k) => { callEls[i].style.top = tops[k].toFixed(2) + '%'; });
  }
}
window.addEventListener('resize', () => requestAnimationFrame(layoutCallouts));
if (document.readyState === 'complete') layoutCallouts();
else window.addEventListener('load', layoutCallouts);
setTimeout(layoutCallouts, 300);
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

const dotEls = ACTIONS.map(() => {
  const i = document.createElement('i');
  dotsEl.appendChild(i);
  return i;
});

/* ---------- renderer / scene ---------- */
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.42;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(34, 1, 0.1, 40);

const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.enablePan = false;
controls.minDistance = 1.5;
controls.maxDistance = 6.5;
controls.maxPolarAngle = Math.PI * 0.54;
controls.target.set(0, 0.8, 0);

/* 与首页其它舞台同一套灯光（亮天光 + 暖主光 + 冷轮廓 + 跟随相机的补光） */
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
  const w = stage.clientWidth || 1;
  const h = stage.clientHeight || 1;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
new ResizeObserver(resize).observe(stage);
resize();

/* ---------- state ---------- */
let model = null;
let mixer = null;
let bones = {};
let current = null;          // { cfg, action, impact }
let idx = 0;
let state = 'idle';          // idle | play | reveal | gap
let paused = false;
let slow = false;
let revT = 0;
let gapT = 0;
let shown = 0;
const clock = new THREE.Clock();
const _v = new THREE.Vector3();

/* ---------- model ---------- */
function boneByName(root, key) {
  const norm = (s) => s.replace(/[^a-z]/gi, '').toLowerCase();
  const want = norm(key);
  let found = null;
  root.traverse((o) => {
    if (!found && o.isBone && norm(o.name).endsWith(want)) found = o;
  });
  return found;
}

function groundAndFaceLeft(root) {
  // 面向屏幕左侧：绕 Y 转 -90°，出拳方向朝 -X
  root.rotation.y = -Math.PI / 2;
  root.updateMatrixWorld(true);
  // 用蒙皮顶点最低点（鞋底）落地
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
  if (Number.isFinite(low)) root.position.y -= low;
  root.updateMatrixWorld(true);
}

/* 打到最远的一帧：出拳手的世界 x 最小（角色朝 -X 出拳） */
function findImpact(clipName, handBone, action) {
  const dur = action.getClip().duration;
  action.reset();
  action.play();
  mixer.setTime(0);
  let best = { t: 0, x: Infinity };
  const sample = (t) => {
    mixer.setTime(t);
    model.updateMatrixWorld(true);
    handBone.getWorldPosition(_v);
    if (_v.x < best.x) best = { t, x: _v.x };
  };
  for (let i = 0; i <= 56; i++) sample((dur * i) / 56);
  const step = dur / 56;
  for (let i = -10; i <= 10; i++) {
    sample(THREE.MathUtils.clamp(best.t + (step * i) / 10, 0, dur));
  }
  action.stop();
  mixer.setTime(0);
  return best.t;
}

new GLTFLoader().load(
  GLB_URL,
  (gltf) => onLoaded(gltf),
  (e) => {
    if (!e.total) return;
    loadingText.textContent = `Loading 3D model — ${Math.min(100, (e.loaded / e.total) * 100).toFixed(0)}%`;
  },
  (err) => {
    loadingEl.classList.add('hidden');
    errorEl.hidden = false;
    errorEl.textContent = 'Failed to load the 3D model.\n' + (err && err.message ? err.message : err);
    console.error('[hero-stage]', err);
  },
);

function onLoaded(gltf) {
  model = gltf.scene;
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
        m.transparent = false;
        m.opacity = 1;
      }
    }
  });
  scene.add(model);

  bones = {
    LeftHand: boneByName(model, 'LeftHand'),
    RightHand: boneByName(model, 'RightHand'),
    Hips: boneByName(model, 'Hips'),
    LeftFoot: boneByName(model, 'LeftFoot'),
    RightFoot: boneByName(model, 'RightFoot'),
  };

  // 先摆一个抱架姿势，再落地、取景（绑定姿势是躺平的）
  mixer = new THREE.AnimationMixer(model);
  const clips = gltf.animations || [];
  const first = THREE.AnimationClip.findByName(clips, ACTIONS[0].clip) || clips[0];
  const probe = mixer.clipAction(first);
  probe.play();
  mixer.setTime(first.duration * 0.05);
  groundAndFaceLeft(model);

  // 取景：按当前姿势的高度拟合
  const box = new THREE.Box3().setFromObject(model);
  const size = box.getSize(new THREE.Vector3());
  const mid = box.getCenter(new THREE.Vector3());
  const dist = (size.y / 2) / Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) / 0.82;
  controls.target.set(mid.x, mid.y * 0.94, mid.z);
  camera.position.set(
    controls.target.x + dist * 0.34,
    controls.target.y + dist * 0.12,
    controls.target.z + dist * 0.94,
  );
  controls.update();
  probe.stop();
  mixer.setTime(0);

  // 每条动作算命中帧
  const byClip = {};
  for (const clip of clips) byClip[clip.name] = clip;
  ACTIONS.forEach((cfg) => {
    const clip = byClip[cfg.clip];
    if (!clip) return;
    const action = mixer.clipAction(clip);
    action.setLoop(THREE.LoopOnce, 1);
    action.clampWhenFinished = true;
    cfg.action = action;
    cfg.impact = findImpact(cfg.clip, bones[cfg.hand] || model, action);
  });

  loadingEl.classList.add('hidden');
  barEl.hidden = false;
  buildButtons();
  startAction(0);
  startLoop();

  window.__hero = {
    get state() { return state; },
    get idx() { return idx; },
    get paused() { return paused; },
    actions: ACTIONS.map((a) => ({ id: a.id, impact: a.impact, dur: a.action.getClip().duration })),
    play: (i) => startAction(i),
    pause: (v) => setPaused(v),
    slow: (v) => setSlow(v),
    model, camera, controls, mixer, THREE,
  };
}

/* ---------- controls bar ---------- */
function buildButtons() {
  barEl.innerHTML = '';
  const pauseBtn = document.createElement('button');
  pauseBtn.type = 'button';
  pauseBtn.className = 'stage-btn';
  pauseBtn.textContent = '❚❚ Pause';
  pauseBtn.addEventListener('click', () => setPaused(!paused));

  const slowBtn = document.createElement('button');
  slowBtn.type = 'button';
  slowBtn.className = 'stage-btn slow';
  slowBtn.textContent = '×0.5';
  slowBtn.title = 'Slow motion';
  slowBtn.addEventListener('click', () => setSlow(!slow));

  barEl.append(pauseBtn, slowBtn);
  barEl._pause = pauseBtn;
  barEl._slow = slowBtn;
}

function setPaused(v) {
  paused = !!v;
  if (barEl._pause) barEl._pause.textContent = paused ? '▶ Resume' : '❚❚ Pause';
  if (barEl._pause) barEl._pause.classList.toggle('active', paused);
}

function setSlow(v) {
  slow = !!v;
  if (barEl._slow) barEl._slow.classList.toggle('on', slow);
  if (state === 'play') mixer.timeScale = slow ? 0.5 : 1;
}

/* ---------- sequence ---------- */
function startAction(i) {
  idx = i % ACTIONS.length;
  const cfg = ACTIONS[idx];
  if (!cfg.action) return;
  hideCallouts();
  wordEl.textContent = cfg.word;
  wordEl.classList.remove('pos-a', 'pos-b', 'show');
  void wordEl.offsetWidth;
  wordEl.classList.add(idx % 2 === 0 ? 'pos-a' : 'pos-b');
  requestAnimationFrame(() => wordEl.classList.add('show'));
  dotEls.forEach((d, k) => d.classList.toggle('on', k === idx));

  for (const a of ACTIONS) if (a.action) a.action.stop();
  cfg.action.reset();
  cfg.action.setLoop(THREE.LoopOnce, 1);
  cfg.action.clampWhenFinished = true;
  cfg.action.play();
  mixer.timeScale = slow ? 0.5 : 1;
  current = cfg;
  state = 'play';
  revT = 0;
  gapT = 0;
  shown = 0;
}

function freeze() {
  const t = current.impact;
  mixer.timeScale = 0;
  current.action.time = Math.min(t, current.action.getClip().duration);
  mixer.update(0);
  model.updateMatrixWorld(true);
}

function hideCallouts() {
  shown = 0;
  callEls.forEach((el) => el.classList.remove('show'));
  lineEls.forEach((l) => { l.g.style.opacity = '0'; });
}

function revealAt(i) {
  const cfg = current;
  const [tag, txt] = cfg.calls[i];
  const el = callEls[i];
  el.querySelector('.tag').textContent = tag;
  el.querySelector('.txt').textContent = txt;
  el.classList.add('show');
  lineEls[i].g.style.opacity = '1';
  layoutCallouts();
}

/* ---------- callout anchors ---------- */
const ANCHOR_KEYS = ['LeftHand', 'RightHand', 'Hips', 'LeftFoot', 'RightFoot'];
const rectTmp = { w: 0, h: 0 };

function updateCallouts() {
  if (!model) return;
  const w = stage.clientWidth;
  const h = stage.clientHeight;
  if (!w || !h) return;
  rectTmp.w = w; rectTmp.h = h;

  for (let i = 0; i < 5; i++) {
    const visible = i < shown;
    if (!visible) continue;
    const bone = bones[ANCHOR_KEYS[i]];
    if (!bone) continue;
    bone.getWorldPosition(_v);
    _v.project(camera);
    const ax = (_v.x * 0.5 + 0.5) * w;
    const ay = (-_v.y * 0.5 + 0.5) * h;

    const el = callEls[i];
    const cw = el.offsetWidth || 160;
    const ch = el.offsetHeight || 52;
    const onRight = el.offsetLeft > w / 2;
    const lx = onRight ? el.offsetLeft : el.offsetLeft + cw;
    const ly = el.offsetTop + ch / 2;
    const dir = onRight ? 1 : -1;

    const p1x = ax + dir * 18;
    const p1y = ay;
    const l = lineEls[i];
    l.line.setAttribute('points', `${ax.toFixed(1)},${ay.toFixed(1)} ${p1x.toFixed(1)},${p1y.toFixed(1)} ${lx.toFixed(1)},${ly.toFixed(1)}`);
    l.dot.setAttribute('cx', ax.toFixed(1));
    l.dot.setAttribute('cy', ay.toFixed(1));
  }
}

/* ---------- loop ---------- */
let running = false;
let lastStageW = 0;
let lastStageH = 0;
function startLoop() {
  if (running) return;
  clock.getDelta();
  renderer.setAnimationLoop(frame);
  running = true;
}

function frame() {
  const dt = Math.min(clock.getDelta(), 0.05);
  if (mixer) mixer.update(dt);

  /* 舞台尺寸变化（手机地址栏收起、旋转、字体加载完成）时重排标注卡 */
  const sw = stage.clientWidth;
  const sh = stage.clientHeight;
  if (sw !== lastStageW || sh !== lastStageH) {
    lastStageW = sw;
    lastStageH = sh;
    layoutCallouts();
  }

  if (!paused) {
    if (state === 'play' && current) {
      const t = current.action.time;
      if (t >= current.impact - 0.001) {
        freeze();
        state = 'reveal';
        revT = 0;
        shown = 0;
      }
    } else if (state === 'reveal') {
      revT += dt;
      while (shown < 5 && revT >= shown * STAGGER) revealAt(shown++);
      if (shown === 5 && revT >= 5 * STAGGER + HOLD) {
        hideCallouts();
        state = 'gap';
        gapT = 0;
      }
    } else if (state === 'gap') {
      gapT += dt;
      if (gapT >= GAP) startAction(idx + 1);
    }
  }

  headFill.position.copy(camera.position).sub(controls.target).setLength(6).add(controls.target);
  headFill.target.position.copy(controls.target);

  controls.update();
  updateCallouts();
  renderer.render(scene, camera);
}

/* 只在舞台可见时渲染 */
let visible = true;
if ('IntersectionObserver' in window) {
  new IntersectionObserver(([entry]) => {
    visible = entry.isIntersecting;
    if (visible && !document.hidden) startLoop();
    else if (running) { renderer.setAnimationLoop(null); running = false; }
  }, { rootMargin: '120px' }).observe(stage);
}
document.addEventListener('visibilitychange', () => {
  if (document.hidden && running) { renderer.setAnimationLoop(null); running = false; }
  else if (!document.hidden && visible) startLoop();
});
