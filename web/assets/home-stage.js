/* SilentJab — homepage stage (single character, lightweight action switcher)
 * 模型：media/glb/index.glb（红方骨架，7 条动画，动作名无前缀）
 * 行为：默认循环播 idle；点顶部按钮播对应动作（单次，播完自动淡回 idle）；
 *       支持拖拽环绕 + 滚轮缩放。
 *
 * 路径说明：模型路径用 import.meta.url 解析（相对于本模块所在的 assets/ 目录），
 * 所以首页和 moves/、training/ 下的页面引用的是同一个文件，不会因为多了一级
 * 目录层级而 404。
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const GLB_URL = new URL('../media/glb/index.glb', import.meta.url).href;
const IDLE_CLIP = 'idle';

/* 页面可选配置 window.STAGE（不传 = 首页默认形态）：
 *   buttons  底部按钮条的动作顺序（省略 idle 就不放 Idle 按钮）
 *   labels   覆盖按钮文字（如招式页把 'jab' 显示成 'Replay'）
 *   autoPlay 模型就绪后自动播放的动作（招式页传自己的 clip）
 * 这样 index.html 和六个招式页共用这一个组件，页面只需传参。 */
const CFG = window.STAGE || {};

// 按钮显示名与顺序（首页训练顺序：jab → cross → 钩拳 → 上勾拳）
const LABELS = Object.assign({
  'idle': 'Idle',
  'jab': 'Jab',
  'cross': 'Cross',
  'lead-hand-hook': 'Lead Hook',
  'back-hand-hook': 'Rear Hook',
  'lead-hand-uppercut': 'Lead Uppercut',
  'back-hand-uppercut': 'Rear Uppercut'
}, CFG.labels || {});
const BUTTON_ORDER = CFG.buttons || ['idle', 'jab', 'cross', 'lead-hand-hook', 'back-hand-hook', 'lead-hand-uppercut', 'back-hand-uppercut'];
const AUTO_PLAY = CFG.autoPlay || 'idle';

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

/* 灯光：亮一档的天光 + 暖主光 + 冷轮廓光 + 正面补光（浅底上人物不发灰发暗） */
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
    loadingText.textContent = `Loading 3D model — ${Math.min(100, (e.loaded / e.total) * 100).toFixed(0)}%`;
  },
  (err) => {
    loadingEl.classList.add('hidden');
    errorEl.hidden = false;
    errorEl.textContent = 'Failed to load the 3D model.\n' + (err && err.message ? err.message : err);
    console.error('[home-stage]', err);
  }
);

let mixer = null;
let idleAction = null;
const oneShots = {};          // clipName → Action
let playingClip = IDLE_CLIP;
let camDbg = null;            // 取景调试数据
let posedPts = null;          // idle 姿态的蒙皮顶点（重新取景时复用）
let userMoved = false;        // 用户拖过视角就不再自动取景
let homeFraming = null;       // idle 取景（播完收回的目标）
const clipFraming = {};       // 每个动作的取景包络
let desiredFraming = null;    // 当前要 blend 到的取景
let camBlend = 0;             // 剩余的相机过渡时间（秒）

function setActiveButton(clip) {
  // 只切换带 data-clip 的动作按钮，慢放按钮（.slow）状态独立
  for (const btn of barEl.children) {
    if (!btn.dataset.clip) continue;
    btn.classList.toggle('active', btn.dataset.clip === clip);
  }
}

function playClip(name) {
  if (!mixer) return;
  const prev = playingClip === IDLE_CLIP ? idleAction : oneShots[playingClip];

  // 重播同一个动作：直接从头再放一遍（不做淡入——单个动作淡入时会从 0 权重起步，
  // 剩余权重由绑定姿势补上，会出现一帧「瘫下去」）
  if (name === playingClip) {
    if (name !== IDLE_CLIP) { prev.reset().play(); camBlend = 0.9; }
    return;
  }

  const next = name === IDLE_CLIP ? idleAction : oneShots[name];
  if (!next) return;
  next.reset();
  if (name !== IDLE_CLIP) {
    next.setLoop(THREE.LoopOnce, 1);
    next.clampWhenFinished = true;
  }
  // 与当前动作交叉淡化：新动作淡入、旧动作淡出。
  // 不看 isRunning()——clamped 定格的暂停动作不算 running，但权重还在，必须淡出
  next.fadeIn(0.14).play();
  if (prev && prev !== next) prev.fadeOut(0.14);
  playingClip = name;
  // 相机切到该动作的取景包络（用户手动拖过就不打扰）
  if (!userMoved) {
    desiredFraming = clipFraming[name] || homeFraming;
    camBlend = 0.9;
  }
  setActiveButton(name);
}

/* ---------- 材质修复：Tripo 导出的贴图带伪 transparent 标记，角色会透 ----------
 * 与演示页（assets/boxing.js）同一套处理：transparent 一律关掉、强制写深度。 */
function forceOpaque(mat) {
  if (!mat || !mat.transparent) return;
  mat.transparent = false;
  mat.depthWrite = true;
  mat.alphaTest = 0;
  mat.needsUpdate = true;
}

/* ---------- 取景工具 ---------- */
const _tv = new THREE.Vector3();

/* 蒙皮之后的真实世界顶点（抽稀）。骨骼包围盒既不含头发也不含鞋面，
 * 用它取景必然出现「头顶空一块 / 鞋被按钮盖住」，所以直接采顶点。 */
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

/* 相机取景：把 pts 在屏幕上占的像素框，精确摆进「上边距 → 按钮条上沿」之间。
 * 不再用「身高 × 系数」估距离，而是投影—修正迭代，桌面/手机任意比例都成立。
 * 纯计算（返回 target+dist），applyFraming 才真正摆相机。 */
const VIEW_DIR = new THREE.Vector3(0.16, 0.03, 1).normalize();

function computeFraming(pts) {
  if (!pts || !pts.length) return null;
  const stageW = canvas.clientWidth || 480;
  const stageH = canvas.clientHeight || 480;

  // 底部安全区以按钮条的实际占位为准（手机上按钮条更高）
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
    const need = Math.max((pMaxX - pMinX) / wantW, (pMaxY - pMinY) / wantH) * 1.03;   // 3% 余量抵采样间隙
    const dx = (wantCx - (pMinX + pMaxX) / 2);          // 内容要往右挪多少 px
    const dy = (wantCy - (pMinY + pMaxY) / 2);          // 内容要往下挪多少 px
    const wpp = (2 * dist * halfTan) / stageH;          // 目标平面上 1px ≈ 多少世界单位
    // 相机整体上移会让内容在画面里下沉、右移会让内容左移，所以两轴符号相反
    target.y += dy * wpp;
    target.x -= dx * wpp;
    dist = THREE.MathUtils.clamp(dist * need, controls.minDistance, controls.maxDistance);
    if (Math.abs(need - 1) < 0.002 && Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) break;
  }

  return { target, dist, dbg: { barTop: Math.round(barTop), topPad: Math.round(topPad), bottomPad: Math.round(bottomPad) } };
}

function applyFraming(f) {
  if (!f) return;
  controls.target.copy(f.target);
  camera.position.copy(f.target).addScaledVector(VIEW_DIR, f.dist);
  camera.lookAt(f.target);
  controls.update();
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

  // 绑定姿态是躺平的（原始数据 Z-up）：先采样一帧动画让角色立起来，再落地、取景
  mixer = new THREE.AnimationMixer(model);
  mixer.addEventListener('finished', (e) => {
    // 单次动作播完 → 淡回 idle。两个关键点：
    // 1) 淡入淡出必须等时长，否则两者权重之和 < 1，空缺由绑定姿势补齐 → 回 idle 时抖一下；
    // 2) 必须 reset()——fadeOut 走完会把 enabled 置成 false，只 play()+fadeIn 不会重新启用，
    //    idle 权重会永远停在 0，两个动作都是 0 就把人物拉回绑定姿势（瘫倒），
    //    这正是「每个动作播完回到 idle 时抖一下」的真凶。
    const dur = 0.24;
    e.action.fadeOut(dur);
    idleAction.reset().fadeIn(dur).play();
    playingClip = IDLE_CLIP;
    if (!userMoved) { desiredFraming = homeFraming; camBlend = 1.1; }   // 相机收回 idle 取景
    setActiveButton(IDLE_CLIP);
  });

  const clips = gltf.animations || [];
  idleAction = mixer.clipAction(THREE.AnimationClip.findByName(clips, IDLE_CLIP) || clips[0]);
  idleAction.play();

  for (const clip of clips) {
    if (clip.name === IDLE_CLIP) continue;
    oneShots[clip.name] = mixer.clipAction(clip);
  }

  // 取景前先让 idle 走到 0.5s（角色完全站起）——绑定姿态是躺平的，
  // 在 t≈0 采到的点全是趴着的，取景会完全错位
  mixer.setTime(0.5);
  model.updateMatrixWorld(true);

  // 落地：用蒙皮顶点的最低点（鞋底）而不是踝骨
  const pts = samplePose(model);
  let soleY = 1e9;
  for (const p of pts) if (p.y < soleY) soleY = p.y;
  if (soleY < -1e-4) {
    const dy = -soleY;
    model.position.y += dy;
    for (const p of pts) p.y += dy;
    model.updateMatrixWorld(true);
  }

  // 底部按钮条：按训练顺序排列
  for (const name of BUTTON_ORDER) {
    if (name !== IDLE_CLIP && !oneShots[name]) continue;   // glb 里缺的 clip 跳过
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'stage-btn';
    btn.dataset.clip = name;
    btn.textContent = LABELS[name] || name;
    btn.addEventListener('click', () => playClip(name));
    barEl.appendChild(btn);
  }
  // 慢放开关：独立状态（.on），不受动作切换影响
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
  setActiveButton(IDLE_CLIP);
  barEl.hidden = false;

  // 按钮条先上屏再量高度：底部安全区要按它的真实占位算
  homeFraming = computeFraming(pts);
  applyFraming(homeFraming);
  desiredFraming = homeFraming;

  // 每个动作各自的取景包络：把动作摆到 5 个采样点、取蒙皮顶点并集再拟合。
  // 出拳时身体前倾 + 拳套前伸，透视放大很多，idle 的紧取景必然裁头顶/盖鞋 ——
  // 所以播放时相机要临时后撤，播完再收回。
  mixer.stopAllAction();
  for (const clip of clips) {
    const act = mixer.clipAction(clip);
    act.reset().play();
    const union = [];
    const n = 9;                       // 采样要够密，漏掉极值瞬间脚就会贴到按钮条
    for (let k = 0; k < n; k++) {
      mixer.setTime(((k + 0.5) / n) * clip.duration);
      union.push(...samplePose(model, 1200));
    }
    act.stop();
    clipFraming[clip.name] = computeFraming(union);
  }
  mixer.stopAllAction();
  idleAction.reset().play();
  mixer.setTime(0.5);
  applyFraming(homeFraming);   // 拟合各动作包络时相机被挪走了，最后摆回 idle 取景

  posedPts = pts;
  loadingEl.classList.add('hidden');

  // 招式页（window.STAGE.autoPlay）：加载完自动播一次该动作，播完由
  // finished 回调淡回 idle；相机会随 playClip 切到该动作的取景包络
  if (AUTO_PLAY !== IDLE_CLIP && oneShots[AUTO_PLAY]) playClip(AUTO_PLAY);

  // 调试句柄
  window.__homeStage = { mixer, idleAction, oneShots, playClip, model, camera, controls,
    isRunning: () => loopRunning, isVisible: () => stageVisible,
    camDbg: homeFraming && { ...homeFraming.dbg, dist: +homeFraming.dist.toFixed(3),
      target: homeFraming.target.toArray().map((n) => +n.toFixed(2)) },
    clipFraming, frameCamera: () => { homeFraming = computeFraming(posedPts); applyFraming(homeFraming); }, samplePose };
}

/* 用户一拖视角就停掉自动取景，之后完全交给用户 */
controls.addEventListener('start', () => { userMoved = true; camBlend = 0; });

/* 窗口/朝向变化后重取景：idle 精确重算，各动作包络按画幅比例缩放 */
let reframeTimer = 0;
window.addEventListener('resize', () => {
  if (userMoved || !posedPts || !homeFraming) return;
  clearTimeout(reframeTimer);
  reframeTimer = setTimeout(() => {
    const oldH = canvas.clientHeight;
    homeFraming = computeFraming(posedPts);
    if (homeFraming) {
      const s = oldH / (canvas.clientHeight || oldH);
      for (const f of Object.values(clipFraming)) {
        f.dist *= s;
        f.target.y = homeFraming.target.y + (f.target.y - homeFraming.target.y) * s;
      }
      if (camBlend <= 0) applyFraming(homeFraming);
    }
  }, 180);
});

/* ---------- 渲染循环 ---------- */
const clock = new THREE.Clock();

function frame() {
  const dt = clock.getDelta();
  if (mixer) mixer.update(dt);

  // 相机平滑过渡到目标取景：只改「看向的点 + 距离」，保留用户当前的环绕方向
  if (camBlend > 0 && desiredFraming && !userMoved) {
    camBlend -= dt;
    const k = 1 - Math.exp(-4.5 * dt);
    controls.target.lerp(desiredFraming.target, k);
    const offset = camera.position.clone().sub(controls.target);
    const d = offset.length();
    offset.setLength(d + (desiredFraming.dist - d) * k);
    camera.position.copy(controls.target).add(offset);
  }

  controls.update();
  renderer.render(scene, camera);
}

/* 只在这个舞台真的可见时渲染。
   之前是常驻 60fps：用户滚到下面看招式卡时，首屏那个 canvas 还在每帧重绘，
   手机（尤其 Android）滚动时要不停重新合成这一层，滚起来就是一顿一顿的。
   滚出视口就停，滚回来再开；切后台也停。 */
let stageVisible = true;
let loopRunning = false;

function startLoop() {
  if (loopRunning) return;
  clock.getDelta();            // 丢掉暂停期间累积的时长，避免恢复瞬间动画跳帧
  renderer.setAnimationLoop(frame);
  loopRunning = true;
}

function stopLoop() {
  if (!loopRunning) return;
  renderer.setAnimationLoop(null);
  loopRunning = false;
}

function syncLoop() {
  if (stageVisible && !document.hidden) startLoop();
  else stopLoop();
}


if ('IntersectionObserver' in window) {
  new IntersectionObserver(([entry]) => {
    stageVisible = entry.isIntersecting;
    syncLoop();
  }, { rootMargin: '120px' }).observe(canvas.parentElement);
}

document.addEventListener('visibilitychange', syncLoop);
syncLoop();
