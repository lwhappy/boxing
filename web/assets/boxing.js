/* SilentJab — 3D boxing demo engine (single scene)
 * 用法：页面里先用 <script> 定义 window.SCENE，再以 type="module" 引入本文件。
 * 引擎负责：加载 glb、按骨骼反查骨架、双 mixer、命中检测、受击反应链、
 * 命中浮字 / 招式浮字、音效、特效、相机取景。
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { QUALITY, attachAdaptiveDpr } from './perf-tier.js?v=2';

/* ------------------------------------------------------------------ *
 * 1.glb 里有两条独立骨架：
 *   "Armature"      -> 黑衣  41 骨，网格 tripo_node_5cd6af71，动画前缀 black-
 *   "Armature.001"  -> 红衣  33 骨，网格 tripo_node_7b87a507，动画前缀 red-
 * 两条骨架的骨骼同名（mixamorig:*），所以必须给每个角色单独建
 * AnimationMixer，并把 mixer 的 root 限定到各自的 Armature 节点，
 * 否则 PropertyBinding 会按名字命中另一条骨架的同名骨骼。
 *
 * 注意：GLTFLoader 会走 PropertyBinding.sanitizeNodeName()，把节点名里的
 * "." 和 ":" 去掉，所以运行时名字是 "Armature001" / "mixamorigHips"。
 * 为免依赖名字，这里改为「按蒙皮网格反查骨架根节点」，再按骨骼数兜底。
 * ------------------------------------------------------------------ */

const CHARACTERS = {
  black: { meshKey: 'tripo_node_5cd6af71', bones: 41, prefix: 'black-', idle: 'black-idle', accent: '#5aa9ff' },
  red:   { meshKey: 'tripo_node_7b87a507', bones: 33, prefix: 'red-',   idle: 'red-idle',   accent: '#ff5a6a' }
};


/* ------------------------------------------------------------------ *
 * 单场景架构：每个演示页只跑一个场景
 *
 * 页面在模块之前用普通 <script> 写入 window.SCENE，字段与原来的 tab 配置一致：
 *   id / label   场景标识与显示名
 *   glb          该场景加载的模型文件
 *   hits         命中编排（键 = clip 名）
 *   callouts     招式浮字（键 = clip 名）
 *   attacks      红方攻击按钮
 *   brief        场景级说明卡
 *   blackCycle   黑方 idle 循环用的 clip 序列
 * ------------------------------------------------------------------ */
const sceneCfg = window.SCENE;
if (!sceneCfg) throw new Error('missing window.SCENE — 页面必须先定义场景配置');

/* 资源路径解析：页面里的 window.SCENE 用的是「相对于该页面」的路径
 * （例如 '../media/glb/2.glb'）。用 document.baseURI 解析，
 * 这样页面放在 /training/ 等任意目录下都能找到同一份模型和音效。 */
const ASSET_BASE = document.baseURI;
function resolveAsset(p) {
  if (!p || typeof p !== 'string') return p;
  try { return new URL(p, ASSET_BASE).href; } catch { return p; }
}

const HIT_SOUNDS = sceneCfg.hits || {};
const CALLOUTS = sceneCfg.callouts || {};          // clip 名 → [{ t, label }]
const ATTACKS = sceneCfg.attacks || [];
const BLACK_CYCLE = sceneCfg.blackCycle || ['black-idle', 'black-taunt'];
const blackState = { mode: 'cycle', index: 0 };

// 把配置里的模型/音效路径统一解析成绝对地址（就地改写，保证缓存键一致）
if (sceneCfg.glb) sceneCfg.glb = resolveAsset(sceneCfg.glb);
for (const list of Object.values(HIT_SOUNDS)) {
  for (const h of list) {
    if (!h) continue;
    if (h.url) h.url = resolveAsset(h.url);
    if (h.byPhase) {
      for (const v of Object.values(h.byPhase)) if (v && v.url) v.url = resolveAsset(v.url);
    }
  }
}

const canvas = document.getElementById('scene');
const loaderEl = document.getElementById('loader');
const barEl = document.getElementById('bar');
const loadTextEl = document.getElementById('load-text');
const errorEl = document.getElementById('error');
const briefEl = document.getElementById('brief');

/* ---------- renderer / scene ---------- */
/* ---------- 设备档位 ----------
 * 具体判据与自适应策略见 assets/perf-tier.js（四个引擎共用一套）。
 */
const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: QUALITY.antialias,
  powerPreference: 'high-performance'
});
renderer.setPixelRatio(Math.min(window.devicePixelRatio, QUALITY.dprMax));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = QUALITY.shadow !== 'off';
renderer.shadowMap.type = QUALITY.shadow === 'high' ? THREE.PCFSoftShadowMap : THREE.PCFShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
renderer.outputColorSpace = THREE.SRGBColorSpace;

const scene = new THREE.Scene();
// 背景不能是纯黑：红方头发是黑色的，会和背景糊在一起。
// 用深灰蓝（拳馆暗光氛围）+ 角色身后的光晕，让黑发有轮廓分离。
scene.background = new THREE.Color('#1c222e');
scene.fog = new THREE.Fog('#1c222e', 7, 18);

const camera = new THREE.PerspectiveCamera(38, window.innerWidth / window.innerHeight, 0.05, 120);
camera.position.set(0.2, 1.35, 3.5);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.06;
controls.minDistance = 1.2;
controls.maxDistance = 9;
// 关掉平移：手机上双指拖拽默认是 pan，会把两名角色推出画面中心。
// 这个场景只需要绕着看和缩放，平移没有任何意义。
controls.enablePan = false;
controls.maxPolarAngle = Math.PI * 0.495;
controls.target.set(0, 0.95, 0);

/* ---------- audio ---------- */
// 用 WebAudio 直接播 buffer（比 THREE.Audio 轻，便于同一音效重叠触发）。
// 命中音效默认【关闭】：浏览器禁止无交互自动播放，首屏也保持安静；
// 打开开关后才真正出声。命中特效与震动属于画面反馈，不受这个开关影响。
const listener = new THREE.AudioListener();
camera.add(listener);
const audioBuffers = new Map();
const hitsFired = [];
let audioUnlocked = false;
let soundOn = false;

const audioLoader = new THREE.AudioLoader();

// 按当前场景的命中配置预加载音效（按 URL 去重，切场景不重复下载）
function ensureAudioBuffers() {
  for (const list of Object.values(HIT_SOUNDS)) {
    for (const h of list) {
      if (audioBuffers.has(h.url)) continue;
      audioBuffers.set(h.url, null);
      audioLoader.load(h.url, (buf) => audioBuffers.set(h.url, buf), undefined,
        (err) => { console.warn('[audio] 加载失败', h.url, err); audioBuffers.delete(h.url); });
    }
  }
}

const soundBtn = document.getElementById('sound');
const soundLabel = document.getElementById('sound-label');

const AUDIO_UNLOCK_EVENTS = ['pointerdown', 'keydown', 'touchstart'];

function unlockAudio() {
  const ctx = listener.context;
  audioUnlocked = true;
  if (ctx.state === 'suspended') ctx.resume();
}
for (const ev of AUDIO_UNLOCK_EVENTS) addEventListener(ev, unlockAudio, { passive: true });

function anyLoadedBuffer() {
  for (const buf of audioBuffers.values()) if (buf) return buf;
  return null;
}

// 打开开关时立即播一声短的确认音：听得见 = 链路通，听不见 = 浏览器拦截了。
// 这样「开了开关但没声音」不再是沉默的悬念。
function previewHitSound() {
  const ctx = listener.context;
  const buf = anyLoadedBuffer();
  if (!buf) { ensureAudioBuffers(); return; }
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const g = ctx.createGain();
  g.gain.value = 0.5;                       // 确认音用一半音量，别吓人
  src.connect(g);
  g.connect(listener.getInput());
  src.start();
}

function setSound(on) {
  soundOn = !!on;
  soundBtn.classList.toggle('on', soundOn);
  soundBtn.setAttribute('aria-pressed', String(soundOn));
  soundLabel.textContent = soundOn ? 'Sound on' : 'Sound off';
  if (!soundOn) return;
  unlockAudio();                            // 必须在用户手势里 resume，否则仍然没声
  const ctx = listener.context;
  if (ctx.state !== 'running') {
    ctx.resume().then(() => {
      if (ctx.state === 'running') previewHitSound();
      else { soundLabel.textContent = 'Sound blocked — click again'; soundOn = false; soundBtn.classList.remove('on'); }
    }).catch(() => { soundLabel.textContent = 'Sound blocked — click again'; });
  } else {
    previewHitSound();
  }
}
soundBtn.addEventListener('click', () => setSound(!soundOn));
setSound(false);

function playHit(hit) {
  const rec = { clip: hit.clip || '', t: hit.t, at: +performance.now().toFixed(0), played: false, muted: !soundOn };
  hitsFired.push(rec);
  if (hit.shake) triggerShake(hit.shake);      // 震动是画面反馈，静音时也保留
  if (!soundOn) return false;                  // 默认静音：连创建 BufferSource 都省掉

  const ctx = listener.context;
  if (ctx.state === 'suspended') ctx.resume(); // 开关刚打开的一瞬 resume 可能还没完成，这里补一脚

  let buf = audioBuffers.get(hit.url);
  if (!buf) { ensureAudioBuffers(); }          // buffer 加载失败/还没到时重试
  if (!buf || ctx.state !== 'running') {
    console.warn('[audio] 未出声：buffer=', !!buf, 'ctx=', ctx.state, hit.url);
    return false;
  }

  const src = ctx.createBufferSource();
  src.buffer = buf;
  // 轻微随机化音高，连打时不至于像复读
  src.playbackRate.value = 1 + (Math.random() - 0.5) * 0.06;
  const g = ctx.createGain();
  g.gain.value = hit.gain == null ? 1 : hit.gain;
  src.connect(g);
  g.connect(listener.getInput());
  src.start();
  rec.played = true;
  return true;
}

/* ---------- 命中特效 ---------- */
// 三层叠加：白热闪光（始终面向相机）+ 扩散冲击环（面向相机）+ 放射火花。
// 全部加色混合、不写深度，只在命中点存活 0.45s，之后整体销毁。
function makeFxTexture(stops) {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  for (const [o, col] of stops) grad.addColorStop(o, col);
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
const fxTexGlow = makeFxTexture([
  [0, 'rgba(255,255,255,1)'], [0.25, 'rgba(255,240,210,0.9)'], [1, 'rgba(255,200,120,0)']
]);
const fxTexRing = makeFxTexture([
  [0, 'rgba(255,255,255,0)'], [0.55, 'rgba(255,255,255,0)'],
  [0.72, 'rgba(255,230,180,0.85)'], [0.85, 'rgba(255,200,120,0.35)'],
  [1, 'rgba(255,180,90,0)']
]);

const impacts = [];
const easeOut = (k) => 1 - Math.pow(1 - k, 3);

function spawnImpact(pos, normal, opts = {}) {
  const size = opts.size || 0.5;
  const life = opts.life || 0.45;
  const color = new THREE.Color(opts.color || '#ffd9a0');
  const common = { transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false, toneMapped: false };

  const group = new THREE.Group();
  group.position.copy(pos);

  const flashMat = new THREE.SpriteMaterial({ map: fxTexGlow, color, opacity: 1, ...common });
  const flash = new THREE.Sprite(flashMat);
  flash.scale.setScalar(size * 0.22);
  group.add(flash);

  const ringMat = new THREE.MeshBasicMaterial({ map: fxTexRing, color, opacity: 0.9, side: THREE.DoubleSide, ...common });
  const ring = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), ringMat);
  ring.scale.setScalar(size * 0.2);
  // 环面朝向：给了 axis 就把环面法线对到该轴（环面 ⟂ 该轴），否则留空做 billboard
  let ringQuat = null;
  if (opts.axis) {
    ringQuat = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), opts.axis.clone().normalize());
    ring.quaternion.copy(ringQuat);
  }
  group.add(ring);

  const N = 16;
  const positions = new Float32Array(N * 3);
  const velocities = [];
  for (let i = 0; i < N; i++) {
    const dir = new THREE.Vector3(Math.random() * 2 - 1, Math.random() * 2 - 1, Math.random() * 2 - 1);
    if (dir.lengthSq() < 1e-4) dir.set(0, 1, 0);
    dir.normalize().lerp(normal, 0.55).normalize();
    velocities.push(dir.multiplyScalar((0.7 + Math.random() * 1.5) * size));
  }
  const sparkGeo = new THREE.BufferGeometry();
  sparkGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const sparkMat = new THREE.PointsMaterial({ map: fxTexGlow, color, size: size * 0.1, sizeAttenuation: true, ...common });
  const sparks = new THREE.Points(sparkGeo, sparkMat);
  group.add(sparks);

  scene.add(group);
  impacts.push({ group, flash, ring, ringQuat, sparks, velocities, size, t: 0, life, follow: opts.follow || null });
  return group;
}

function updateImpacts(dt) {
  for (let i = impacts.length - 1; i >= 0; i--) {
    const fx = impacts[i];
    fx.t += dt;
    if (fx.t >= fx.life) {
      scene.remove(fx.group);
      fx.flash.material.dispose();
      fx.ring.geometry.dispose();
      fx.ring.material.dispose();
      fx.sparks.geometry.dispose();
      fx.sparks.material.dispose();
      impacts.splice(i, 1);
      continue;
    }
    // 跟随锚点：对手还在呼吸/移动，特效必须贴着他
    if (fx.follow) fx.follow.getWorldPosition(fx.group.position);

    const kf = Math.min(1, fx.t / (fx.life * 0.4));
    fx.flash.scale.setScalar(fx.size * (0.22 + 0.85 * easeOut(kf)));
    fx.flash.material.opacity = 1 - kf;

    const kr = Math.min(1, fx.t / (fx.life * 0.8));
    fx.ring.scale.setScalar(fx.size * (0.2 + 1.0 * easeOut(kr)));
    fx.ring.material.opacity = 0.9 * Math.pow(1 - kr, 1.5);
    // 有固定轴向时保持环面与人物朝向垂直，否则跟随相机
    if (fx.ringQuat) fx.ring.quaternion.copy(fx.ringQuat);
    else fx.ring.quaternion.copy(camera.quaternion);

    const pos = fx.sparks.geometry.attributes.position;
    const drag = Math.max(0, 1 - 2.4 * dt);
    for (let j = 0; j < fx.velocities.length; j++) {
      const v = fx.velocities[j];
      v.multiplyScalar(drag);
      v.y -= fx.size * 1.6 * dt;                  // 轻微下坠
      pos.array[j * 3] += v.x * dt;
      pos.array[j * 3 + 1] += v.y * dt;
      pos.array[j * 3 + 2] += v.z * dt;
    }
    pos.needsUpdate = true;
    fx.sparks.material.opacity = Math.pow(1 - fx.t / fx.life, 1.4);
  }
}

const anchorCache = new Map();

/* ------------------------------------------------------------------ *
 * 命中浮字：BLOCK / HIT
 *
 * 文字用 HTML 渲染（比 canvas 贴图清晰、样式好调），位置每帧把黑方头部骨骼
 * 投影到屏幕坐标 —— 这样相机转动 / 角色动作时文字始终挂在头顶。
 * 上浮与淡出交给 CSS 动画（float-text），JS 只负责定位与到时移除。
 * ------------------------------------------------------------------ */
const floaterLayer = document.getElementById('floaters');
const floaters = [];
const _fv = new THREE.Vector3();

function findBoneByName(root, names) {
  for (const n of names) {
    const b = root.getObjectByName(n);
    if (b) return b;
  }
  return null;
}

// 头顶锚点：优先 Head 骨，退化到 Neck（红黑两条骨架骨骼同名，只有 _1 后缀差异）
function headAnchorOf(key) {
  const st = chars[key];
  if (!st) return null;
  if (st._headAnchor === undefined) {
    st._headAnchor = findBoneByName(st.root, [
      'mixamorigHead', 'mixamorig:Head', 'mixamorigHead_1',
      'mixamorigNeck', 'mixamorig:Neck', 'mixamorigNeck_1'
    ]);
    if (!st._headAnchor) console.warn('[floater] 找不到头部骨骼', key);
  }
  return st._headAnchor;
}

// 黑方头顶锚点（命中浮字默认挂在黑方头上）
function blackHeadAnchor() {
  return headAnchorOf('black');
}

function placeFloater(f) {
  f.anchor.getWorldPosition(_fv);
  _fv.y += f.offset;
  _fv.project(camera);
  // 转到相机背后时直接藏起来，避免文字镜像出现在屏幕上
  if (_fv.z > 1) { f.el.style.visibility = 'hidden'; return; }
  f.el.style.visibility = '';
  f.el.style.left = ((_fv.x * 0.5 + 0.5) * innerWidth).toFixed(1) + 'px';
  f.el.style.top = ((-_fv.y * 0.5 + 0.5) * innerHeight).toFixed(1) + 'px';
}

function showFloater(text, tone = 'hit', opts = {}) {
  if (!floaterLayer || text == null) return null;   // 空文本直接不生成，避免渲染 "undefined"
  const anchor = opts.anchor || blackHeadAnchor();
  if (!anchor) return null;

  const el = document.createElement('div');
  el.className = `floater ${tone}`;
  const txt = document.createElement('span');
  txt.className = 'f-txt';
  txt.textContent = text;
  const bar = document.createElement('span');
  bar.className = 'f-bar';
  el.append(txt, bar);
  // 连击时左右错开一点，避免两行字叠在一起（callout 传 dx:0 就是完全居中）
  el.style.setProperty('--dx', (opts.dx == null ? (Math.random() - 0.5) * 30 : opts.dx).toFixed(1) + 'px');
  floaterLayer.appendChild(el);

  const rec = { el, anchor, t: 0, life: opts.life || 1.2, offset: opts.offset == null ? 0.19 : opts.offset };
  floaters.push(rec);
  placeFloater(rec);
  return rec;
}

/* 招式浮字：在出拳方头顶打出 JAB / CROSS，向上飘走。
 * 连击两拳只隔 0.2s —— 新词出现时旧词快速淡出（"instead"：一次只有当前招式），
 * 文字本体交给 CSS 动画上浮。 */
const callouts = [];
function showCallout(text, key = 'red', opts = {}) {
  const anchor = headAnchorOf(key);
  if (!anchor) return null;
  for (const old of callouts) {
    old.el.classList.add('retire');                 // 旧招式让位：0.3s 内淡出
    old.life = Math.min(old.life, old.t + 0.32);
  }
  callouts.length = 0;
  const rec = showFloater(text, 'callout', {
    anchor,
    offset: opts.offset == null ? 0.15 : opts.offset,
    life: opts.life || 1.15,
    dx: 0
  });
  if (rec) callouts.push(rec);
  return rec;
}

function updateFloaters(dt) {
  for (let i = floaters.length - 1; i >= 0; i--) {
    const f = floaters[i];
    f.t += dt;
    placeFloater(f);
    if (f.t >= f.life) {
      f.el.remove();
      floaters.splice(i, 1);
      const ci = callouts.indexOf(f);
      if (ci >= 0) callouts.splice(ci, 1);
    }
  }
}

// 锚点属于哪个角色 → 该角色朝向对手的水平方向（即"人物朝向"）。
// 冲击环用这个轴做法线，环面就与人物朝向垂直。
const _fxV3 = new THREE.Vector3();
const _fxV4 = new THREE.Vector3();
function facingAxisOf(anchor) {
  const keys = Object.keys(chars);
  let owner = null;
  for (const k of keys) {
    let o = anchor;
    while (o) {
      if (o === chars[k].root) { owner = k; break; }
      o = o.parent;
    }
    if (owner) break;
  }
  if (!owner) return null;
  const other = keys.find((k) => k !== owner);
  if (!other) return null;
  chars[owner].root.getWorldPosition(_fxV3);
  chars[other].root.getWorldPosition(_fxV4);
  _fxV4.sub(_fxV3);
  _fxV4.y = 0;
  return _fxV4.lengthSq() > 1e-6 ? _fxV4.normalize() : null;
}

function triggerFX(hit) {
  if (!hit.anchor) return;
  let anchor = anchorCache.get(hit.anchor);
  if (anchor === undefined) {
    anchor = gltfScene.getObjectByName(hit.anchor) || null;
    anchorCache.set(hit.anchor, anchor);
    if (!anchor) console.warn('[fx] 找不到锚点', hit.anchor);
  }
  if (!anchor) return;

  anchor.getWorldPosition(_fxV1);
  // 朝外方向 = 锚点 - 它挂着的骨骼（胸腔/胯），火花往身体外侧喷
  anchor.parent.getWorldPosition(_fxV2);
  const normal = _fxV1.clone().sub(_fxV2);
  if (normal.lengthSq() < 1e-8) normal.set(0, 0, 1);
  normal.normalize();

  const fx = hit.fx || {};
  spawnImpact(_fxV1, normal, { ...fx, follow: anchor, axis: facingAxisOf(anchor) });
  console.log('[fx] 命中特效 @', hit.anchor);
}
const _fxV1 = new THREE.Vector3();
const _fxV2 = new THREE.Vector3();

function fireHit(raw) {
  // 命中瞬间看黑方处在循环的哪一段，决定锚点 + 反应
  const phase = blackPhase();
  const variant = (raw.byPhase && (raw.byPhase[phase] || raw.byPhase.idle)) || raw;
  const hit = { ...raw, ...variant };

  playHit(hit);
  triggerFX(hit);
  if (hit.label) showFloater(hit.label, hit.tone || 'hit');
  if (hit.react) reactBlack(hit.react, { fade: hit.reactFade, speed: hit.reactSpeed, append: hit.appendReact });
  // 命中即让黑方向后滑一小步（如 jab 命中后让位给距离更长的 cross）：
  // 位移记在 carrier 上，快速补间到位，动画本身不受影响
  if (hit.push) {
    const b = chars.black;
    if (b && b.carrier) {
      b.pushTween = {
        from: b.carrier.position.x,
        to: b.carrier.position.x - (hit.push.step ?? 0.1),
        t: 0, dur: hit.push.dur ?? 0.15
      };
    }
  }
  // 这条命中要求攻击方定格（如 jab+cross 的后手命中帧）：
  // 把动作时间精确拨回命中帧并 paused，画面停住，不再播后面的帧
  if (hit.pauseAttacker) {
    const st = chars[hit.actor || 'red'];
    if (st && st.currentAction && st.currentAction.getClip().name === raw.clip) {
      st.currentAction.time = hit.t;
      st.currentAction.paused = true;
    }
  }
  console.log('[hit]', raw.clip, 'black phase =', phase, '→', hit.react || 'no react', '@', hit.anchor,
    hit.pauseAttacker ? '(attacker paused)' : '');
}

/* ---------- 命中震动 ---------- */
const shake = { left: 0, dur: 0.001, amp: 0, seed: 0 };

function triggerShake(amp, dur = 0.22) {
  shake.amp = Math.max(shake.amp * 0.35, amp);
  shake.dur = dur;
  shake.left = dur;
  shake.seed = Math.random() * 100;
}

function applyShake(dt) {
  if (shake.left <= 0) return;
  shake.left = Math.max(0, shake.left - dt);
  const k = shake.left / shake.dur;
  const a = shake.amp * k * k;              // 二次衰减：一上来最猛，迅速收住
  const p = (shake.dur - shake.left) * 95 + shake.seed;
  camera.rotateX(Math.sin(p * 1.7) * a);
  camera.rotateY(Math.cos(p * 2.3) * a * 0.7);
  camera.rotateZ(Math.sin(p * 1.1) * a * 0.45);
}

const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.02).texture;
scene.environmentIntensity = 0.55;

/* ---------- lights ---------- */
const hemi = new THREE.HemisphereLight('#9fb8d8', '#0b0c10', 0.55);
scene.add(hemi);

const key = new THREE.DirectionalLight('#fff3e2', 2.6);
key.position.set(2.4, 4.2, 3.0);
key.castShadow = QUALITY.shadow !== 'off';
const shadowSize = QUALITY.shadow === 'high' ? 2048 : 1024;
key.shadow.mapSize.set(shadowSize, shadowSize);
key.shadow.camera.near = 0.5;
key.shadow.camera.far = 14;
key.shadow.camera.left = -3.2;
key.shadow.camera.right = 3.2;
key.shadow.camera.top = 3.2;
key.shadow.camera.bottom = -3.2;
key.shadow.bias = -0.0007;
// 1024 阴影贴图比 2048 粗糙，normalBias 要加大一倍，否则角色身上会出现条纹状阴影痤疮
key.shadow.normalBias = QUALITY.shadow === 'high' ? 0.02 : 0.05;
scene.add(key);

const rimBlue = new THREE.DirectionalLight('#5aa9ff', 1.5);
rimBlue.position.set(-3.4, 2.6, -2.8);
scene.add(rimBlue);

const rimRed = new THREE.DirectionalLight('#ff5a6a', 1.15);
rimRed.position.set(3.6, 2.0, -2.9);
scene.add(rimRed);

// 顶部逆光：从后上方打下来，黑发顶端会有一道亮边（发丝分离的关键）
const rimTop = new THREE.DirectionalLight('#cfd8ea', 1.1);
rimTop.position.set(0.5, 4.5, -3.2);
scene.add(rimTop);

/* ---------- 背景光晕（剪影分离） ---------- */
// 角色身后一大团柔和的径向光晕，黑色头发的边缘衬在亮区上就看得清了。
function makeGlowTexture(inner, outer) {
  const c = document.createElement('canvas');
  c.width = c.height = 512;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(256, 256, 0, 256, 256, 256);
  grad.addColorStop(0, inner);
  grad.addColorStop(0.55, outer);
  grad.addColorStop(1, 'rgba(28,34,46,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 512, 512);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
const backdropGlow = new THREE.Sprite(new THREE.SpriteMaterial({
  map: makeGlowTexture('rgba(96,112,142,0.85)', 'rgba(52,62,84,0.45)'),
  transparent: true,
  depthWrite: false,
  fog: false
}));
backdropGlow.position.set(0, 1.35, -4.2);
backdropGlow.scale.set(11, 7, 1);
scene.add(backdropGlow);

// 地面上一圈淡淡的场地光斑，保住「拳台聚光灯」的语境
const floorGlow = new THREE.Mesh(
  new THREE.PlaneGeometry(9, 6),
  new THREE.MeshBasicMaterial({
    map: makeGlowTexture('rgba(88,102,132,0.5)', 'rgba(46,54,72,0.22)'),
    transparent: true, depthWrite: false, fog: false
  })
);
floorGlow.rotation.x = -Math.PI / 2;
floorGlow.position.y = 0.004;
scene.add(floorGlow);

/* ---------- ground ---------- */
const groundMat = new THREE.MeshStandardMaterial({ color: '#0b0d12', roughness: 0.95, metalness: 0.0 });
const ground = new THREE.Mesh(new THREE.CircleGeometry(30, 96), groundMat);
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);

const grid = new THREE.GridHelper(24, 36, '#1b2130', '#12161f');
grid.position.y = 0.002;
grid.material.transparent = true;
grid.material.opacity = 0.55;
scene.add(grid);

/* ---------- state ---------- */
const clock = new THREE.Clock();
const chars = {};
let gltfScene = null;

/* ---------- 场景装配 ---------- */
function startScene() {
  blackState.mode = 'cycle';
  blackState.index = 0;
  ensureAudioBuffers();

  if (briefEl) briefEl.classList.remove('show');
  attackBar.hidden = true;
  loadTextEl.textContent = `Loading ${sceneCfg.label} model`;
  barEl.style.width = '0%';
  loaderEl.classList.remove('hidden');

  new GLTFLoader().load(
    sceneCfg.glb,
    (gltf) => onLoaded(gltf),
    (e) => {
      if (!e.lengthComputable || !e.total) { loadTextEl.textContent = `Loading ${sceneCfg.label} model`; return; }
      const pct = Math.min(100, (e.loaded / e.total) * 100);
      barEl.style.width = pct.toFixed(1) + '%';
      loadTextEl.textContent = `Loading ${sceneCfg.label} model — ${pct.toFixed(0)}%`;
    },
    (err) => showError('无法加载 ' + sceneCfg.glb + '\n' + (err && err.message ? err.message : err))
  );
}

function showError(msg) {
  errorEl.style.display = 'block';
  errorEl.textContent = msg;
  loaderEl.classList.add('hidden');
  console.error(msg);
}

// GLTFLoader 会把 glTF 里 alphaMode=BLEND 的材质加载成 transparent=true + depthWrite=false。
// 而 three.js 对透明材质【不做三角形级深度排序】→ 角色自身的前后三角面互相混合，
// 画面上就表现为拳套破洞、手臂撕裂、「断手」。
// Tripo 这类模型的贴图 alpha 通道通常是全 255（没有真正的透明区域），
// 所以加载后直接按不透明材质渲染即可 —— 等价于把 glTF 的 alphaMode 手动改成 OPAQUE。
const forcedOpaque = [];

function forceOpaque(mat) {
  if (!mat || !mat.transparent) return;
  mat.transparent = false;
  mat.depthWrite = true;
  mat.alphaTest = 0;
  mat.needsUpdate = true;
  forcedOpaque.push(mat.name || mat.type);
}

function onLoaded(gltf) {
  gltfScene = gltf.scene;
  scene.add(gltfScene);

  gltfScene.updateMatrixWorld(true);

  const skinned = [];
  gltfScene.traverse((o) => {
    if (o.isSkinnedMesh) skinned.push(o);
    if (o.isMesh) {
      o.castShadow = true;
      o.receiveShadow = true;
      o.frustumCulled = false; // 蒙皮网格的包围球在动画时可能失真
      if (o.material) {
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        for (const m of mats) {
          forceOpaque(m);
          m.envMapIntensity = 0.6;
          if (m.map) m.map.anisotropy = Math.min(renderer.capabilities.getMaxAnisotropy(), QUALITY.aniso);
        }
      }
    }
  });

  if (forcedOpaque.length) {
    console.log('[material] 已把伪透明材质改回不透明: ' + forcedOpaque.join(', '));
  }

  // 由蒙皮网格反查骨架根节点（不依赖会被 sanitize 的节点名）
  function resolveRig(cfg) {
    let mesh = skinned.find((m) => (m.name || '').includes(cfg.meshKey));
    if (!mesh) mesh = skinned.find((m) => m.skeleton && m.skeleton.bones.length === cfg.bones);
    if (!mesh) return null;

    // 上溯到 gltf.scene 的直接子节点：那个 Group 里既有 SkinnedMesh 也有骨骼
    let root = mesh;
    while (root.parent && root.parent !== gltfScene) root = root.parent;

    let bones = 0;
    root.traverse((o) => { if (o.isBone) bones++; });
    return { mesh, root, bones };
  }

  // 每个角色一条独立 mixer
  for (const [key, cfg] of Object.entries(CHARACTERS)) {
    const rig = resolveRig(cfg);
    if (!rig) { console.warn('未找到角色骨架', key, cfg.meshKey); continue; }
    const root = rig.root;

    const clips = gltf.animations.filter((c) => c.name.startsWith(cfg.prefix));
    const mixer = new THREE.AnimationMixer(root);

    const state = { cfg, root, mesh: rig.mesh, bones: rig.bones, mixer, clips, actions: {}, current: null, currentAction: null };

    // 位移载体：受击位移/压进位移都是引擎补间做的（black-backward 是原地动画），
    // 记在这层位于原点的 Group 上（reparent 不改变世界变换）；
    // 锚点是骨骼子节点，会跟着人一起走
    {
      const carrier = new THREE.Group();
      carrier.name = key + 'PushCarrier';
      gltfScene.add(carrier);
      carrier.add(root);
      state.carrier = carrier;
      state.pushTween = null;
    }
    for (const clip of clips) {
      const action = mixer.clipAction(clip);
      action.setLoop(THREE.LoopRepeat, Infinity);
      action.enabled = true;
      state.actions[clip.name] = action;
    }

    // 单次动作播完的收尾：
    //   black —— 受击反应结束就回到循环起点；循环里的 clip 播完就推进到下一段
    //   red   —— 攻击播完回 idle
    mixer.addEventListener('finished', (e) => {
      // 被 crossFade 淡出的旧动作也会走到结尾，不能拿它来推进状态机
      if (e.action !== state.currentAction) return;
      const done = e.action.getClip().name;
      if (key === 'black') {
        if (blackState.mode === 'react') {
          // 定格类反应（如 black-backward）：播完停在最后一帧，不回循环
          if (sceneCfg.holdOnFinish && sceneCfg.holdOnFinish.includes(done)) return;
          // 反应链：还有下一段（如 low-block → backward）就接着播，全播完才回 idle
          if (blackState.reactQueue && blackState.reactQueue.length) {
            const next = blackState.reactQueue.shift();
            if (chars.black && chars.black.actions[next]) {
              const act = playOnce('black', next, blackState.reactFade ?? 0.08);
              if (act && blackState.reactSpeed && blackState.reactSpeed !== 1) act.setEffectiveTimeScale(blackState.reactSpeed);
              return;
            }
          }
          // 受击滑步是轮内临时位移：回 idle 时平滑走回自己的原位，下一轮从头一样
          if (state.carrier && Math.abs(state.carrier.position.x) > 1e-4 && !state.pushTween) {
            state.pushTween = { from: state.carrier.position.x, to: 0, t: 0, dur: 0.45 };
          }
          startBlackCycle(0); return;
        }
        if (done === BLACK_CYCLE[blackState.index]) { advanceBlackCycle(); return; }
        startBlackCycle(0);
        return;
      }
      if (ATTACKS.some((a) => a.clip === done)) play(key, cfg.idle, 0.2);
    });

    chars[key] = state;
  }

  // 初始：红方 idle（循环），黑方进入 idle ⇄ taunt 循环
  play('red', CHARACTERS.red.idle, 0);
  startBlackCycle(0);

  buildAttackBar();

  // 场景里没有任何可用攻击按钮（如 cross/hook 占位）时，展示场景级说明卡
  if (!selectedAttack && sceneCfg && sceneCfg.brief) renderBrief({ brief: sceneCfg.brief });

  // 文件里的绑定姿态是躺平的（原始数据 Z-up），动画第一帧才把角色立起来；
  // 先让 mixer 采样一帧，再按骨骼世界坐标把脚底落到 y=0，然后测相机。
  for (const state of Object.values(chars)) state.mixer.update(1 / 30);
  {
    gltfScene.updateMatrixWorld(true);
    const box = new THREE.Box3();
    const v = new THREE.Vector3();
    gltfScene.traverse((o) => { if (o.isBone) box.expandByPoint(o.getWorldPosition(v)); });
    if (!box.isEmpty() && box.min.y < 0) {
      gltfScene.position.y -= box.min.y;
      gltfScene.updateMatrixWorld(true);
    }
  }
  // 扫一遍所有动画姿态，得到与播放状态无关的固定包围盒。
  // 出拳时手臂会朝镜头方向伸出 0.17m，只按当前帧取景的话镜头会跟着动作抖。
  contentBox = measureContentEnvelope();
  restBox = measureSceneBox();
  frameCamera();

  // 预编译着色器：否则第一次出拳/受击时才编译，手机上会有 100–300ms 的白帧卡顿
  try { renderer.compile(scene, camera); } catch (e) { console.warn('[perf] 着色器预编译失败', e); }

  loaderEl.classList.add('hidden');

  window.__app = {
    ready: true, gltf, chars, scene, camera, renderer, controls,
    sceneId: sceneCfg.id,
    box: (() => {
      const b = measureSceneBox();
      return { min: b.min.toArray().map(v => +v.toFixed(3)), max: b.max.toArray().map(v => +v.toFixed(3)), size: b.getSize(new THREE.Vector3()).toArray().map(v => +v.toFixed(3)) };
    })(),
    play: (k, n) => play(k, n, 0.25),
    playOnce,
    startAttack,
    showFloater,
    showCallout,
    floaters,
    frameCamera,
    refitCamera,
    resetView,
    get fit() {
      const { rest, content, restSize } = framingBoxes();
      const f = framingFor(restSize, rest, content, camera.aspect);
      return { radius: f.radius, dBase: f.dBase, dFit: f.dFit };
    },
    get callouts() { return CALLOUTS; },
    get attacks() { return ATTACKS; },
    selectAttack,
    sound: {
      get on() { return soundOn; },
      set: setSound,
      toggle: () => setSound(!soundOn)
    },
    blackState,
    blackPhase,
    forcedOpaque,
    audio: {
      listener, hits: hitsFired, buffers: audioBuffers, config: HIT_SOUNDS,
      impacts, spawnImpact,
      get unlocked() { return audioUnlocked; },
      get state() { return listener.context.state; },
      playHit, triggerShake,
      // 手动演练一次命中（调试用）：不依赖动画时间
      demo: (clip = 'red-long-head-jab') => {
        const list = HIT_SOUNDS[clip];
        if (!list || !list.length) return 'no hit config';
        return fireHit({ ...list[0], clip });
      }
    }
  };
  console.log('READY', gltf.animations.map((a) => `${a.name} (${a.duration.toFixed(2)}s)`));
}

/* ---------- animation control ---------- */
function play(key, clipName, fade = 0.3) {
  const state = chars[key];
  if (!state) return;
  const next = state.actions[clipName];
  if (!next || state.current === clipName) return;

  const prev = state.currentAction;
  next.reset();
  next.setEffectiveTimeScale(1);
  next.setEffectiveWeight(1);
  next.play();

  if (prev && prev !== next) {
    if (fade > 0) {
      prev.crossFadeTo(next, fade, false);
    } else {
      prev.stop();
    }
  }
  state.current = clipName;
  state.currentAction = next;
  state._prevTime = undefined;   // 切换动作后不拿上一条动作的时间做命中判断
  syncChips(key, clipName);
}

const attackBar = document.getElementById('attackbar');
let selectedAttack = null;

// 按钮状态分两层：
//   active —— 当前选中的那一招（点击后保持点燃，hover 别的按钮不会抢）
//   firing —— 该条 clip 此刻正在播放（火焰烧得更旺 + 按钮上浮）
function syncChips(key, clipName) {
  if (!attackBar || key !== 'red') return;
  for (const btn of attackBar.children) {
    btn.classList.toggle('firing', btn.dataset.clip === clipName);
  }
}

/* Side panel: only "how to throw it / when to use it / pros and cons" — no clip names,
 * durations or impact frames (removed on 2026-10-22).
 * Sections are [heading, body]; legacy three-item [heading, subtitle, body] still works. */
function renderBrief(atk) {
  if (!briefEl || !atk || !atk.brief) return;
  const b = atk.brief;
  briefEl.innerHTML = `
    <div class="b-kicker">${b.kicker ?? ''}</div>
    <div class="b-title">${b.title ?? ''}</div>
    ${(b.sections || []).map((s) =>
      `<section class="b-sec"><h4>${s[0] ?? ''}</h4><p>${s[s.length - 1] ?? ''}</p></section>`).join('')}
  `;
  briefEl.scrollTop = 0;
  briefEl.classList.add('show');
}

function selectAttack(atk) {
  if (!atk) return;
  selectedAttack = atk;
  if (attackBar) {
    for (const btn of attackBar.children) btn.classList.toggle('active', btn.dataset.clip === atk.clip);
  }
  renderBrief(atk);
}

// 单次播放：LoopOnce + clampWhenFinished，且不走 play() 的「同名不重播」判断，
// 连击时每次命中都能重新起手；播完由 mixer 的 'finished' 事件收回 idle。
function playOnce(key, clipName, fade = 0.08) {
  const state = chars[key];
  if (!state) return null;
  const act = state.actions[clipName];
  if (!act) { console.warn('[once] 找不到动作', key, clipName); return null; }

  const prev = state.currentAction;
  act.reset();
  act.setLoop(THREE.LoopOnce, 1);
  act.clampWhenFinished = true;
  act.setEffectiveTimeScale(1);
  act.setEffectiveWeight(1);
  act.play();

  if (prev && prev !== act) {
    if (fade > 0) prev.crossFadeTo(act, fade, false);
    else prev.stop();
  }

  state.current = clipName;
  state.currentAction = act;
  state._prevTime = undefined;
  syncChips(key, clipName);
  return act;
}

/* ---------- 黑方状态机 ---------- */
// 循环：idle ⇄ taunt；受击时插一条单次反应，播完回到循环起点
function startBlackCycle(index = 0) {
  if (!chars.black || !chars.black.actions[BLACK_CYCLE[index]]) return;
  blackState.mode = 'cycle';
  blackState.index = index;
  playOnce('black', BLACK_CYCLE[index], 0.3);
}

function advanceBlackCycle() {
  startBlackCycle((blackState.index + 1) % BLACK_CYCLE.length);
}

function reactBlack(clip, opts = {}) {
  const st = chars.black;
  // react 支持链式：传数组依次播完（如 ['black-low-block','black-backward']）
  const chain = Array.isArray(clip) ? clip : [clip];
  const first = chain[0];
  // 反应链共用的淡入时长 / 播放倍速（命中配置里可覆盖，后续链段沿用）
  blackState.reactFade = opts.fade ?? 0.08;
  blackState.reactSpeed = opts.speed ?? 1;

  // 追加模式：不打断正在播的反应，只把后续动作排到队尾
  // （如第二拳落在格挡上 —— 格挡播完再后仰）
  if (opts.append && blackState.mode === 'react' && st && st.currentAction && !st.currentAction.paused) {
    blackState.reactQueue = (blackState.reactQueue || []).concat(chain);
    return;
  }

  blackState.reactQueue = chain.slice(1);
  if (!st || !st.actions[first]) { console.warn('[react] 缺少动作', first); return; }

  // 连击累计推退：black-backward 播完定格，位移由补间叠加到载体上，
  // 每点一次继续往左推一段（方向 -x，即画面左侧）
  if (sceneCfg.pushBlack && st.carrier) {
    const push = sceneCfg.pushBlack;
    const step = typeof push === 'number' ? push : (push.step ?? 0.26);
    const dur = (typeof push === 'object' && push.dur) || 0.5;
    const carrier = st.carrier;
    st.pushTween = { from: carrier.position.x, to: carrier.position.x - step, t: 0, dur };
  }

  blackState.mode = 'react';
  // 位移是引擎补间做的（clip 原地），动作本身可以正常淡入；
  // 淡入 0 = 立刻切到受击姿势（不留 fade 的过渡延迟），倍速 >1 = 后仰更快
  const act = playOnce('black', first, blackState.reactFade);
  if (act && blackState.reactSpeed !== 1) act.setEffectiveTimeScale(blackState.reactSpeed);
}

// 位移补间（黑方被推退 / 红方压进共用）：easeOutCubic，每次叠加一段，
// 可挂 onDone 在补间结束后触发（如红方到位后再起手出拳）
function updatePush(dt) {
  for (const st of Object.values(chars)) {
    const tw = st.pushTween;
    if (!tw) continue;
    tw.t += dt;
    const k = Math.min(1, tw.t / tw.dur);
    const e = 1 - Math.pow(1 - k, 3);
    st.carrier.position.x = tw.from + (tw.to - tw.from) * e;
    if (k >= 1) { st.pushTween = null; if (tw.onDone) tw.onDone(); }
  }
}

// 黑方当前处在循环的哪一段（受击反应中一律按 idle 处理 → 继续格挡）
function blackPhase() {
  const st = chars.black;
  if (!st) return 'idle';
  return st.current === 'black-taunt' ? 'taunt' : 'idle';
}

/* ---------- 攻击按钮 ---------- */
function startAttack(atk) {
  const st = chars.red;
  if (!st || !st.actions[atk.clip]) return;
  selectAttack(atk);

  // 黑方微调 + idle 相位同步：起手时把 idle 拨到同步相位（命中瞬间拳套位置
  // 可复现），并做一次小水平位移把校准出的残差消掉。
  // 若上一轮的受击反应还没播完就点了下一轮，先瞬间拉回 idle（fade=0），
  // 否则锚点会跟着 backward 的拳套走，命中点就偏了
  if (sceneCfg.blackPreSlide && chars.black && chars.black.carrier) {
    const pre = sceneCfg.blackPreSlide;
    const b = chars.black;
    const bidle = b.actions['black-idle'];
    const act = b.currentAction;
    if (act && act.getClip().name !== 'black-idle') {
      blackState.mode = 'cycle';
      blackState.reactQueue = [];   // 打断未播完的反应链
      playOnce('black', 'black-idle', 0);
    }
    if (bidle) bidle.time = 0.4;   // 与页面配置里的 blackPreSlide 校准相位一致
    b.pushTween = {
      from: b.carrier.position.x,
      to: b.carrier.position.x + (pre.step ?? 0),
      t: 0, dur: pre.dur ?? 0.2
    };
  }

  st.advance = !!sceneCfg.advanceCombo;
  st.moveDone = false;                 // 每轮到第 38 帧触发一次前移
  playOnce('red', atk.clip, 0.12);     // 播完整条 clip，播完由 finished 收回 idle
}

function buildAttackBar() {
  if (!attackBar) return;
  attackBar.innerHTML = '';
  let first = null;

  for (const atk of ATTACKS) {
    const act = chars.red && chars.red.actions[atk.clip];

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'atk';
    btn.dataset.clip = atk.clip;

    const flame2 = document.createElement('span');
    flame2.className = 'flame2';
    const flame = document.createElement('span');
    flame.className = 'flame';
    const k = document.createElement('span');
    k.className = 'k';
    k.textContent = atk.label;
    const s = document.createElement('span');
    s.className = 's';
    btn.append(flame2, flame, k, s);

    // 火星：7 颗随机起点/横向偏移/周期，各自缓慢上飘
    for (let i = 0; i < 7; i++) {
      const e = document.createElement('span');
      e.className = 'ember';
      e.style.left = (14 + Math.random() * 72).toFixed(1) + '%';
      e.style.bottom = (2 + Math.random() * 12).toFixed(1) + 'px';
      e.style.setProperty('--dx', ((Math.random() * 2 - 1) * 46).toFixed(1) + 'px');
      e.style.setProperty('--ed', (1.5 + Math.random() * 1.8).toFixed(2) + 's');
      e.style.setProperty('--edl', (-Math.random() * 2.4).toFixed(2) + 's');
      btn.appendChild(e);
    }

    if (!act) {
      // clip 还没进当前 glb：按钮置灰占位，资产就绪后自动变可用
      btn.classList.add('locked');
      btn.disabled = true;
      s.textContent = atk.subLocked || 'coming soon';
      btn.title = `${atk.clip} 不在当前 glb 里 —— 资产就绪后自动解锁`;
      attackBar.appendChild(btn);
      continue;
    }

    s.textContent = atk.sub || '';          // 缺 sub 时绝不渲染 "undefined"
    btn.title = `${atk.clip} · ${act.getClip().duration.toFixed(2)}s`;
    btn.addEventListener('click', () => startAttack(atk));
    attackBar.appendChild(btn);
    if (!first) first = atk;
  }

  attackBar.hidden = false;
  if (first) selectAttack(first);     // 默认点亮第一招，右侧说明同步
}

/* ---------- camera framing ---------- */
// 蒙皮网格的 geometry.boundingBox 是绑定姿态的原始数据（Blender 导出时未按
// 骨骼变换），直接 setFromObject 会得到错误的尺寸；改用骨骼世界坐标测量。
function measureSceneBox() {
  gltfScene.updateMatrixWorld(true);
  const box = new THREE.Box3();
  const v = new THREE.Vector3();
  gltfScene.traverse((o) => { if (o.isBone) box.expandByPoint(o.getWorldPosition(v)); });
  if (box.isEmpty()) box.setFromObject(gltfScene);
  box.min.y = Math.min(box.min.y, 0);
  return box;
}

/* 内容包围盒：把所有动画片段的所有姿态都扫一遍，取骨骼世界坐标的并集。
 *
 * 为什么需要它：场景包围盒是「当前这一帧」的骨骼位置，会随动作变化。
 * 实测 idle 时 z 跨度 0.286m，出拳时手臂往前伸到 0.456m（+0.17m）。
 * 如果直接拿当前姿态算取景距离，镜头就会随着动画忽远忽近。
 * 这里扫一遍全部分片得到一个与播放状态无关的固定盒子，取景就稳定了。
 *
 * 采样用独立的 AnimationMixer，不碰正在跑的 mixer：
 *   - 不会打乱 live 的动作状态（play/crossFade/finished 事件链全不受影响）
 *   - mixer 的 'finished' 事件监听只挂在 live mixer 上，不会被采样误触发
 * 每个分片采样前 play() 会记住骨骼原值，stop() 时自动还原，采样不留下痕迹。
 */
const ENVELOPE_STEPS = 12;
let contentBox = null;   // 全姿态并集（用于「不裁切」的视距）
let restBox = null;      // 站立姿态（用于构图：视点高度与基准视距）

function measureContentEnvelope() {
  const box = new THREE.Box3();
  const v = new THREE.Vector3();
  const has = (p) => Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.z);

  for (const st of Object.values(chars)) {
    if (!st.clips || !st.clips.length) continue;
    const probe = new THREE.AnimationMixer(st.root);
    for (const clip of st.clips) {
      const act = probe.clipAction(clip);
      act.setLoop(THREE.LoopOnce, 1);
      act.clampWhenFinished = true;
      act.setEffectiveWeight(1);
      act.play();
      act.paused = true;              // 手动拨 action.time，混音器不推进
      for (let i = 0; i <= ENVELOPE_STEPS; i++) {
        act.time = (clip.duration * i) / ENVELOPE_STEPS;
        probe.update(0);
        gltfScene.updateMatrixWorld(true);
        st.root.traverse((o) => {
          if (!o.isBone) return;
          const p = o.getWorldPosition(v);
          if (has(p)) box.expandByPoint(p);
        });
      }
      act.stop();                     // 还原这个分片采样时动过的骨骼
    }
    probe.stopAllAction();
    // 采样期间 live 的骨骼被搬动过，用 live mixer 重新求值回到待机姿势
    st.mixer.update(1 / 30);
    gltfScene.updateMatrixWorld(true);
  }

  if (box.isEmpty()) return null;
  box.min.y = Math.min(box.min.y, 0);
  return box;
}

/* 取景计算。
 * 原来只按纵向取景（dist = size.y * 2.2），桌面端没问题；但竖屏手机的
 * aspect 很小（约 0.46），横向才是瓶颈 —— 1.64m 宽的一对角色在 390px 宽的
 * 视口里会被切掉一半（实测需要 5.16m 视距，而原来固定只有 2.62m）。
 *
 * 改成「角点投影 + 二分」：把场景包围盒的 8 个角投到 NDC 里，二分出能让
 * 所有角点都落在画面安全范围内的最小视距。和只算宽度的公式相比，这个办法
 * 把盒子的纵深、斜视角、以及出拳时手臂伸出的量都算进去了。
 * 观察方向仍沿用桌面版的单位向量，所以竖屏拉远时观感一致，不会变成俯视图。
 */
const FIT_CORNER = new THREE.Vector3();
const FIT_PROBE = new THREE.PerspectiveCamera();

/* 8 个角点投影后的溢出比：<=1 表示整个包围盒都在画面安全区内。 */
function fitOverflow(box, target, dir, radius, aspect, limitX, limitY) {
  FIT_PROBE.fov = camera.fov;
  FIT_PROBE.aspect = aspect;
  FIT_PROBE.near = camera.near;
  FIT_PROBE.far = camera.far;
  FIT_PROBE.position.copy(target).addScaledVector(dir, radius);
  FIT_PROBE.lookAt(target);
  FIT_PROBE.updateMatrixWorld(true);
  FIT_PROBE.updateProjectionMatrix();

  let mx = 0, my = 0;
  for (let i = 0; i < 8; i++) {
    FIT_CORNER.set(
      (i & 1) ? box.max.x : box.min.x,
      (i & 2) ? box.max.y : box.min.y,
      (i & 4) ? box.max.z : box.min.z
    ).project(FIT_PROBE);
    mx = Math.max(mx, Math.abs(FIT_CORNER.x));
    my = Math.max(my, Math.abs(FIT_CORNER.y));
  }
  return Math.max(mx / limitX, my / limitY);
}

/* 二分出「刚好不裁切」的视距。视距越大投影越小，所以溢出对 radius 单调，
 * 可以直接二分。 */
function fitRadius(box, target, dir, aspect, limitX, limitY) {
  let lo = 0.5, hi = 40;
  if (fitOverflow(box, target, dir, hi, aspect, limitX, limitY) > 1) return hi;
  for (let i = 0; i < 26; i++) {
    const mid = (lo + hi) / 2;
    if (fitOverflow(box, target, dir, mid, aspect, limitX, limitY) > 1) lo = mid;
    else hi = mid;
  }
  return hi;
}

function framingFor(restSize, restBox, contentBox, aspect) {
  // 桌面基准取景：offset = (0.25, 0.26*size.y, zBase)，归一化后当作观察方向
  const zBase = Math.max(restSize.y * 2.2, 2.6);
  const unit = new THREE.Vector3(0.25, restSize.y * 0.26, zBase).normalize();
  const dBase = zBase / unit.z;                      // 基准视距（= 原桌面取景距离）

  // 视点按站立姿态算：构图（看的方向、看的高度）跟原来完全一致。
  const center = restBox.getCenter(new THREE.Vector3());
  const target = new THREE.Vector3(center.x, restSize.y * 0.52, center.z);

  // 安全区：横向留 3% 余量，纵向留 8%（头顶空间要给 HUD）。
  // 这里用全姿态并集来测，保证任何一帧（尤其是出拳伸臂）都不会被切到。
  const dFit = fitRadius(contentBox, target, unit, aspect, 0.97, 0.92);

  return { unit, target, radius: Math.max(dBase, dFit), dBase, dFit };
}

/* 取景用的两个盒子：
 *   restBox    —— 站立姿态，决定视点与桌面基准视距（构图不变）
 *   contentBox —— 全姿态并集，决定「不裁切」所需的视距（稳定不抖）
 * 任一缺失就退回当前帧的实测盒，保证功能不挂。
 */
function framingBoxes() {
  const rest = restBox || measureSceneBox();
  const content = contentBox || rest;
  return {
    rest,
    content,
    restSize: rest.getSize(new THREE.Vector3()),
  };
}

function homePosition(home) {
  return home.target.clone().addScaledVector(home.unit, home.radius);
}

function frameCamera() {
  const { rest, content, restSize } = framingBoxes();

  // 观察方向与基准视距按站立姿态算（桌面构图保持原样），
  // 「不裁切」的视距按全姿态并集算（任何一帧都不会切掉角色）。
  const f = framingFor(restSize, rest, content, camera.aspect);

  controls.target.copy(f.target);
  camera.position.copy(f.target).addScaledVector(f.unit, f.radius);
  controls.maxDistance = Math.max(9, f.radius * 1.4);
  controls.update();

  gltfScene.userData.homeView = {
    target: controls.target.clone(),
    unit: f.unit.clone(),
    radius: f.radius
  };
}

/* 视口变了（旋转手机、改窗口）：重新取景。
 * 用户手动转过视角就保留他的方向，只把距离拉回「不裁切」的范围。 */
function refitCamera() {
  if (!gltfScene) return;
  const home = gltfScene.userData.homeView;
  if (!home) { frameCamera(); return; }

  const { rest, content, restSize } = framingBoxes();
  const f = framingFor(restSize, rest, content, camera.aspect);

  const homePos = homePosition(home);
  const moved = camera.position.distanceTo(homePos) > 1e-3;

  if (!moved) {
    controls.target.copy(f.target);
    camera.position.copy(f.target).addScaledVector(f.unit, f.radius);
  } else {
    const dir = camera.position.clone().sub(controls.target);
    const radius = dir.length();
    if (radius > 1e-4) {
      dir.multiplyScalar(1 / radius);
      const clamped = Math.min(Math.max(radius, f.dFit), f.dBase * 1.8);
      camera.position.copy(controls.target).addScaledVector(dir, clamped);
    }
  }
  controls.maxDistance = Math.max(9, f.radius * 1.4);
  controls.update();

  gltfScene.userData.homeView = {
    target: controls.target.clone(),
    unit: f.unit.clone(),
    radius: f.radius
  };
}

function resetView() {
  const home = gltfScene && gltfScene.userData.homeView;
  if (!home) return;
  controls.target.copy(home.target);
  camera.position.copy(homePosition(home));
  controls.update();
}

addEventListener('keydown', (e) => {
  if (e.key === 'r' || e.key === 'R') resetView();
});

/* ---------- 自适应分辨率（实现见 perf-tier.js） ---------- */
const dprCtl = attachAdaptiveDpr(renderer);

/* ---------- resize ---------- */
addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  dprCtl.apply();
  refitCamera();
});

/* ---------- loop ---------- */

function tick() {
  requestAnimationFrame(tick);
  const dt = Math.min(clock.getDelta(), 0.05);

  for (const state of Object.values(chars)) state.mixer.update(dt);
  updatePush(dt);

  // 命中检测：比较「上一帧时间 → 当前帧时间」是否跨过了触发点，
  // 而不是判断「是否等于」某时刻 —— 后者在 60fps 下几乎永远不成立。
  for (const state of Object.values(chars)) {
    const act = state.currentAction;
    if (!act) continue;
    const now = act.time;
    const prev = state._prevTime;
    const hits = HIT_SOUNDS[act.getClip().name];
    if (prev !== undefined && hits && act.isRunning() && act.getEffectiveWeight() > 0.85) {
      for (const h of hits) {
        // 循环播放时时间会从末尾跳回 0，跨零也要算命中
        const crossed = now >= prev ? (prev < h.t && h.t <= now) : (h.t > prev || h.t <= now);
        if (crossed) fireHit({ ...h, clip: act.getClip().name });
      }
    }
    // 招式浮字（JAB / CROSS）：同一套「上一帧 → 这一帧跨过触发点」判定，
    // 不依赖命中配置，所以只出字、不出特效/音效
    const cues = CALLOUTS[act.getClip().name];
    if (prev !== undefined && cues && act.isRunning()) {
      for (const c of cues) {
        const crossed = now >= prev ? (prev < c.t && c.t <= now) : (c.t > prev || c.t <= now);
        if (crossed) showCallout(c.label, state === chars.red ? 'red' : 'black', c);
      }
    }
    state._prevTime = now;
  }

  // 压进连击：红方播完整条 clip，不打断 —— 播过第 38 帧时向前移一步
  // （距离与黑方后退一致），每轮触发一次；播完由 finished 收回 idle
  {
    const red = chars.red;
    const cfgA = sceneCfg.advanceCombo;
    if (red && cfgA && red.advance && !red.moveDone && red.carrier) {
      const act = red.currentAction;
      if (act && !act.paused && act.getClip().name === 'red-jab-cross' && act.time >= cfgA.moveAt) {
        red.moveDone = true;
        if (!red.pushTween) {
          red.pushTween = {
            from: red.carrier.position.x,
            to: red.carrier.position.x - (cfgA.step ?? 0.18),
            t: 0, dur: cfgA.dur ?? 0.5
          };
        }
      }
    }
  }

  controls.update();
  applyShake(dt);
  updateImpacts(dt);
  updateFloaters(dt);
  renderer.render(scene, camera);
  dprCtl.update(dt);
}
/* ---------- 启动 ---------- */
startScene();
tick();
