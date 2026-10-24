/* SilentJab — training stage (two fighters, combo builder)
 * 模型：./media/glb/combine.glb（两人合包；拳法动画全部为「原位」clip，无根位移）
 *   - Armature    = 进攻方（右侧，红色），驱动 jab/cross/lead-hand-hook/back-hand-hook/lead-hand-uppercut/back-hand-uppercut
 *   - Armature.001= 防守方（左侧，黑色），带 ancher1(头部)/ahcher2(躯干) 两个命中锚点，播 defence-idle
 * 交互：勾选招式 → Confirm 依序播放（2026-10-23 起动作已原位化，不再做进步/平移/下蹲对位）；
 *   拳到达命中帧时在锚点处放出火花 + 播命中音效，动作完整播完再接下一拳。
 * 骨骼重命名：两套骨架同为 Mixamo 命名（重名），加载后统一加 @atk/@def 后缀，
 *   每条动画轨也同步改写 —— 避免.PropertyBinding 按名查找时绑到另一套骨架。
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const GLB_URL = './media/glb/combine.glb';
const SOUND_URL = './media/audio/punch-impact.wav';

/* 招式清单：clip 名 → 出拳手（lead 系 = 左手，back/cross 系 = 右手）。
 * target：命中锚点 —— head = ancher1（头部），body = ahcher2（躯干） */
const MOVES = [
  { clip: 'jab',                 label: 'Jab',          fist: 'LeftHand',  target: 'body' },
  { clip: 'cross',               label: 'Cross',        fist: 'RightHand', target: 'body' },
  { clip: 'lead-hand-hook',      label: 'Lead Hook',    fist: 'LeftHand',  target: 'head' },
  { clip: 'back-hand-hook',      label: 'Rear Hook',    fist: 'RightHand', target: 'head' },
  { clip: 'lead-hand-uppercut',  label: 'Lead Uppercut',fist: 'LeftHand',  target: 'head' },
  { clip: 'back-hand-uppercut',  label: 'Rear Uppercut',fist: 'RightHand', target: 'head' }
];
const FIST = Object.fromEntries(MOVES.map((m) => [m.clip, m.fist]));
const LABELS = Object.fromEntries(MOVES.map((m) => [m.clip, m.label]));
const TARGET = Object.fromEntries(MOVES.map((m) => [m.clip, m.target]));

/* 骨骼名规范化：GLTFLoader 会去掉名字里的冒号，并给重名节点追加 _1 后缀
 * （两套 Mixamo 骨架骨骼同名，第二套全部变成 mixamorigHips_1 这种）。
 * 所以按名找骨骼必须用「去后缀 + 去 _N」的规范名比对，不能硬拼字符串。 */
function canon(name) {
  return name.replace(/@(atk|def)$/, '').replace(/_\d+$/, '');
}
function findBone(root, spec) {
  const want = 'mixamorig' + spec;
  let hit = null;
  root.traverse((o) => { if (!hit && canon(o.name) === want) hit = o; });
  return hit;
}

const canvas = document.getElementById('stage-canvas');
const comboBar = document.getElementById('combo-bar');
const comboHint = document.getElementById('combo-hint');
const loadingEl = document.getElementById('stage-loading');
const loadingText = document.getElementById('stage-loading-text');
const errorEl = document.getElementById('stage-error');

/* ---------- renderer / scene（与 home-stage 同一套光） ---------- */
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.25;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 50);
camera.position.set(0.2, 1.2, 3.6);

const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.enablePan = false;
controls.minDistance = 1.2;
controls.maxDistance = 8;
controls.maxPolarAngle = Math.PI * 0.55;

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

/* ---------- 加载 ---------- */
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
    console.error('[training-stage]', err);
  }
);

function forceOpaque(mat) {
  if (!mat || !mat.transparent) return;
  mat.transparent = false;
  mat.depthWrite = true;
  mat.alphaTest = 0;
  mat.needsUpdate = true;
}

/* ---------- 取景工具（与 home-stage 同思路，底部无按钮条、两侧留大边） ---------- */
const _tv = new THREE.Vector3();
const VIEW_DIR = new THREE.Vector3(0.1, 0.05, 1).normalize();

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

function computeFraming(pts) {
  if (!pts || !pts.length) return null;
  const stageW = canvas.clientWidth || 480;
  const stageH = canvas.clientHeight || 480;
  const topPad = stageH * 0.05;
  const bottomPad = stageH * 0.1;
  const sidePad = stageW * (stageW < 620 ? 0.05 : 0.09);

  let minX = 1e9, maxX = -1e9, minY = 1e9, maxY = -1e9, minZ = 1e9, maxZ = -1e9;
  for (const p of pts) {
    if (p.x < minX) minX = p.x; if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y; if (p.y > maxY) maxY = p.y;
    if (p.z < minZ) minZ = p.z; if (p.z > maxZ) maxZ = p.z;
  }
  const target = new THREE.Vector3((minX + maxX) / 2, (minY + maxY) / 2, (minZ + maxZ) / 2);
  let dist = Math.max(1.6, (maxX - minX) * 2.1, (maxY - minY) * 2.2);

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

/* ---------- 音效 ---------- */
let audioCtx = null;
let hitBuf = null;
function ensureAudio() {
  if (audioCtx) return;
  try {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    fetch(SOUND_URL)
      .then((r) => r.arrayBuffer())
      .then((b) => audioCtx.decodeAudioData(b))
      .then((b) => { hitBuf = b; })
      .catch(() => {});
  } catch (e) { /* 无音频环境时静默降级 */ }
}
function playHit() {
  if (!audioCtx || !hitBuf) return;
  if (audioCtx.state === 'suspended') audioCtx.resume();
  const src = audioCtx.createBufferSource();
  src.buffer = hitBuf;
  src.playbackRate.value = 0.94 + Math.random() * 0.12;
  const gain = audioCtx.createGain();
  gain.gain.value = 0.85;
  src.connect(gain).connect(audioCtx.destination);
  src.start();
}

/* ---------- 命中火花 ---------- */
function makeSparkTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const ctx = c.getContext('2d');
  /* 浅灰舞台底 + 红色拳套：纯光晕（尤其加色混合）会糊掉，
   * 所以做成「白色核心 + 橙色圆环 + 四向星芒」这种有轮廓的形状。 */
  const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 60);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.22, 'rgba(255,248,226,0.95)');
  g.addColorStop(0.45, 'rgba(255,196,110,0.55)');
  g.addColorStop(1, 'rgba(255,150,60,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);

  ctx.strokeStyle = 'rgba(255,96,32,0.95)';
  ctx.lineWidth = 7;
  ctx.beginPath();
  ctx.arc(64, 64, 46, 0, Math.PI * 2);
  ctx.stroke();

  ctx.strokeStyle = 'rgba(255,255,255,0.95)';
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(64, 6); ctx.lineTo(64, 40);
  ctx.moveTo(64, 88); ctx.lineTo(64, 122);
  ctx.moveTo(6, 64); ctx.lineTo(40, 64);
  ctx.moveTo(88, 64); ctx.lineTo(122, 64);
  ctx.stroke();
  return new THREE.CanvasTexture(c);
}
const sparkTex = makeSparkTexture();
const effects = [];
let bodySize = 1;             // 角色身高（世界单位），加载后按包围盒设定，用于缩放火花
function spawnHit(pos) {
  /* depthTest:false —— 锚点常在头部/躯干表面内侧，要盖在手套上 */
  const mat = new THREE.SpriteMaterial({
    map: sparkTex,
    transparent: true,
    depthWrite: false,
    depthTest: false
  });
  const sprite = new THREE.Sprite(mat);
  sprite.position.copy(pos);
  sprite.scale.setScalar(bodySize * 0.07);
  sprite.renderOrder = 999;
  scene.add(sprite);
  const light = new THREE.PointLight(0xffc888, 6, bodySize * 1.2, 2);
  light.position.copy(pos);
  scene.add(light);
  effects.push({ sprite, light, t: 0, dur: 0.42 });
}

/* ---------- 主体 ---------- */
let mixer = null;
let attackerRoot = null;
let defenderRoot = null;
let attackerIdle = null;
const punchActions = {};      // clipName → Action
const impactData = {};        // clipName → { impactT, anchor }
let anchors = [];
let posedPts = null;
let homeFraming = null;
let userMoved = false;

/* 序列播放 */
let queue = [];
let playing = false;
let current = null;

function setHint(text) { if (comboHint) comboHint.textContent = text; }
function lockUI(locked) { comboBar.classList.toggle('locked', locked); }

function poseAt(act, t) {
  /* 采样单一姿势：暂停攻击者 idle，让拳法动作独占其骨骼（同步完成，中途不渲染，无闪动） */
  attackerIdle.enabled = false;
  act.reset();
  act.setLoop(THREE.LoopOnce, 1);
  act.clampWhenFinished = false;
  act.enabled = true;
  act.play();
  act.paused = true;
  act.time = t;
  mixer.update(0);
}
function unpose(act) {
  act.stop();
  attackerIdle.enabled = true;
}

function nextInQueue() {
  const name = queue.shift();
  if (!name) {
    playing = false;
    current = null;
    lockUI(false);
    setHint('Combo done — tweak your selection and hit Confirm again.');
    return;
  }
  const act = punchActions[name];
  if (!act || !impactData[name]) { nextInQueue(); return; }

  /* 原位化动画：不需要进步/平移/下蹲对位，直接完整播完这条 clip 再接下一拳 */
  current = { name, act, data: impactData[name], fired: false };
  if (attackerIdle) attackerIdle.fadeOut(0.08);
  act.reset();
  act.setLoop(THREE.LoopOnce, 1);
  act.clampWhenFinished = true;
  act.fadeIn(0.08).play();
  setHint('Playing: ' + LABELS[name] + (queue.length ? '  →  next: ' + LABELS[queue[0]] : ''));
}

function playSequence(names) {
  if (playing || !names.length) return;
  playing = true;
  queue = names.slice();
  lockUI(true);
  nextInQueue();
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

  /* 1. 找两套骨架（顶层的 Armature* 节点） */
  const armRoots = [];
  for (const child of model.children) {
    if (/^Armature/.test(child.name)) armRoots.push(child);
  }
  if (armRoots.length < 2) {
    errorEl.hidden = false;
    errorEl.textContent = 'Expected two armatures in combine.glb, found ' + armRoots.length + '.';
    loadingEl.classList.add('hidden');
    return;
  }

  /* 2. 按动画归属分边：拳法动作属于进攻方 */
  const clips = gltf.animations || [];
  function ownerArmature(nodeName) {
    for (const r of armRoots) if (r.getObjectByName(nodeName)) return r;
    return null;
  }
  const idleClips = [];
  const punchClips = [];
  for (const clip of clips) {
    const t0 = clip.tracks[0] && clip.tracks[0].name || '';
    const owner = ownerArmature(t0.slice(0, t0.indexOf('.')));
    if (/idle/i.test(clip.name)) idleClips.push({ clip, owner });
    else punchClips.push({ clip, owner });
  }
  attackerRoot = punchClips.length ? punchClips[0].owner : armRoots[0];
  defenderRoot = armRoots.find((r) => r !== attackerRoot);

  /* 防守方 = 带锚点的那套（校验用；导出正确时二者一致） */
  const anchorNames = [];
  defenderRoot.traverse((o) => {
    if (/^(ancher|ahcher|anchor)/i.test(o.name)) anchorNames.push(o.name);
  });
  if (anchorNames.length !== 2) {
    console.warn('[training-stage] expected 2 anchors on the defender, found:', anchorNames);
  }

  /* 3. 骨骼加后缀重命名 + 动画轨同步改写（两套 Mixamo 骨架同名，必须隔离） */
  const sfxOf = (root) => (root === attackerRoot ? '@atk' : '@def');
  for (const r of armRoots) {
    const sfx = sfxOf(r);
    r.traverse((o) => { if (o !== r) o.name = o.name + sfx; });
  }
  function retarget(clip, suffix) {
    for (const tr of clip.tracks) {
      const dot = tr.name.indexOf('.');
      if (dot > 0) tr.name = tr.name.slice(0, dot) + suffix + tr.name.slice(dot);
    }
  }
  for (const { clip, owner } of [...idleClips, ...punchClips]) retarget(clip, sfxOf(owner));

  /* 4. 动作。防守方有 defence-idle；进攻方若没有 idle，克隆防守方的并改写到进攻骨架 */
  mixer = new THREE.AnimationMixer(model);
  const idles = [];
  for (const { clip, owner } of idleClips) {
    idles.push({ root: owner, action: mixer.clipAction(clip) });
  }
  if (idles.length && !idles.some((x) => x.root === attackerRoot)) {
    const clone = idleClips[0].clip.clone();
    /* 逐轨映射到进攻方骨骼：按规范名配对（防守方 _1 后缀、进攻方无后缀） */
    const atkByCanon = new Map();
    attackerRoot.traverse((o) => { if (o !== attackerRoot) atkByCanon.set(canon(o.name), o.name); });
    const mapped = [];
    for (const tr of clone.tracks) {
      const dot = tr.name.indexOf('.');
      if (dot < 0) continue;
      const nodeName = tr.name.slice(0, dot);
      const target = atkByCanon.get(canon(nodeName));
      if (!target) continue;                    // 防守方独有的节点（如锚点）留给防守方
      tr.name = target + tr.name.slice(dot);
      mapped.push(tr);
    }
    clone.tracks = mapped;
    clone.name += '-atk';
    idles.push({ root: attackerRoot, action: mixer.clipAction(clone) });
  }
  attackerIdle = (idles.find((x) => x.root === attackerRoot) || {}).action || null;
  for (const e of idles) e.action.play();

  for (const { clip } of punchClips) punchActions[clip.name] = mixer.clipAction(clip);

  anchors = anchorNames
    .map((n) => defenderRoot.getObjectByName(n + sfxOf(defenderRoot)))
    .filter(Boolean);


  /* 锚点角色索引：head = 头部锚点（ancher1，挂 Head），body = 躯干锚点（ahcher2，挂 Spine1）。
   * 优先按父骨骼判断（重新导出时改名也不会错配），判不出时退回名字规则。 */
  const anchorRole = { head: -1, body: -1 };
  anchors.forEach((a, i) => {
    let role = null;
    for (let p = a.parent; p && !role; p = p.parent) {
      const bn = canon(p.name);
      if (/Head|Neck/i.test(bn)) role = 'head';
      else if (/Spine|Chest|Pelvis|Hips/i.test(bn)) role = 'body';
    }
    if (!role) role = /^ahcher/i.test(canon(a.name)) ? 'body' : 'head';
    if (anchorRole[role] < 0) anchorRole[role] = i;
  });
  console.info('[training-stage] anchors:', anchors.map((a, i) => `${i}:${a.name}=${anchorRole.head === i ? 'head' : anchorRole.body === i ? 'body' : '?'}`).join(', '));

  /* 5. 预计算每个拳法的命中帧：扫描整条 clip，取「拳套到指定锚点距离最小」的时刻。
   *    指定锚点缺失时退回「最近锚点」规则。 */
  const N = 44;
  for (const { clip } of punchClips) {
    const which = FIST[clip.name];
    if (!which) continue;
    const bone = findBone(attackerRoot, which);
    if (!bone || !anchors.length) continue;
    const cand = (anchorRole[TARGET[clip.name]] >= 0)
      ? [anchorRole[TARGET[clip.name]]]
      : anchors.map((_, i) => i);
    const act = punchActions[clip.name];
    /* 两段式选帧：
     *  ① 先扫全场，取每帧到目标锚点的水平距离 dh，记下最小值；
     *  ② 在「dh ≤ 最小值 + 容差」的候选帧里，挑垂直偏差 dy 最小的那一帧。
     * 这样既保证拳头真的伸到位（水平贴合），又尽量打到该锚点的高度，
     * 不会为了对齐高度去选一帧手还没伸出去的画面。 */
    const samples = [];
    let minDh = Infinity;
    for (let k = 0; k < N; k++) {
      const t = ((k + 0.5) / N) * clip.duration;
      poseAt(act, t);
      attackerRoot.updateMatrixWorld(true);
      const fp = bone.getWorldPosition(_tv);
      for (const i of cand) {
        const ap = anchors[i].getWorldPosition(new THREE.Vector3());
        const dh = Math.hypot(fp.x - ap.x, fp.z - ap.z);
        const dy = Math.abs(fp.y - ap.y);
        samples.push({ t, anchor: i, dh, dy });
        if (dh < minDh) minDh = dh;
      }
    }
    const reachTol = 0.06;
    let best = null;
    for (const s of samples) {
      if (s.dh > minDh + reachTol) continue;
      if (!best || s.dy < best.dy) best = s;
    }
    unpose(act);
    impactData[clip.name] = {
      impactT: best.t, anchor: best.anchor,
      dh: +best.dh.toFixed(3), dy: +best.dy.toFixed(3)
    };
  }

  /* 6. 站起 + 落地 + 取景（绑定姿势是躺平的，先让 idle 走到 0.5s） */
  mixer.setTime(0.5);
  model.updateMatrixWorld(true);
  const pts = samplePose(model);
  let soleY = 1e9;
  for (const p of pts) if (p.y < soleY) soleY = p.y;
  if (soleY < -1e-4) {
    const dy = -soleY;
    model.position.y += dy;
    for (const p of pts) p.y += dy;
    model.updateMatrixWorld(true);
  }
  posedPts = pts;
  /* 角色身高（两人合围的包围盒高）——火花按它缩放，换模型也不会大小失控 */
  let fy0 = 1e9, fy1 = -1e9;
  for (const p of pts) { if (p.y < fy0) fy0 = p.y; if (p.y > fy1) fy1 = p.y; }
  bodySize = Math.max(0.4, fy1 - fy0);
  homeFraming = computeFraming(pts);
  applyFraming(homeFraming);

  /* 7. 动作完整播完 → 回 idle、接下一拳（命中帧只放火花+音效，在渲染循环里判定） */
  mixer.addEventListener('finished', (e) => {
    if (!current || e.action !== current.act) return;
    e.action.fadeOut(0.15);
    if (attackerIdle) attackerIdle.reset().fadeIn(0.15).play();
    current = null;
    setTimeout(() => { if (playing) nextInQueue(); }, 260);
  });

  loadingEl.classList.add('hidden');
  setHint('Pick punches in order, then press Confirm to play the combo.');

  /* 调试句柄 */
  window.__training = {
    mixer, attackerRoot, defenderRoot, attackerIdle, anchors, punchActions, impactData,
    playSequence, spawnHit, playHit, model, camera, controls, samplePose, effects,
    getCurrent: () => current,
    getAudio: () => ({ state: audioCtx ? audioCtx.state : 'none', buffer: !!hitBuf }),
    getAnchorPos: (i) => anchors[i].getWorldPosition(new THREE.Vector3()),
    getFistPos: (which) => {
      const b = findBone(attackerRoot, which);
      return b ? b.getWorldPosition(new THREE.Vector3()) : null;
    },
    /* 调参用：逐帧打印某条 clip 的拳套相对目标锚点的水平/垂直距离 */
    trace: (clipName, anchorIdx) => {
      const act = punchActions[clipName];
      if (!act) return null;
      const clip = act.getClip();
      const bone = findBone(attackerRoot, FIST[clipName]);
      const ai = anchorIdx == null ? (anchorRole[TARGET[clipName]] >= 0 ? anchorRole[TARGET[clipName]] : 0) : anchorIdx;
      const out = [];
      for (let k = 0; k < 60; k++) {
        const t = ((k + 0.5) / 60) * clip.duration;
        poseAt(act, t);
        attackerRoot.updateMatrixWorld(true);
        const fp = bone.getWorldPosition(new THREE.Vector3());
        const ap = anchors[ai].getWorldPosition(new THREE.Vector3());
        out.push({ t: +t.toFixed(2), fy: +fp.y.toFixed(3), dh: +Math.hypot(fp.x - ap.x, fp.z - ap.z).toFixed(3), dy: +Math.abs(fp.y - ap.y).toFixed(3) });
      }
      unpose(act);
      return { anchorIdx: ai, samples: out };
    }
  };
}

/* 用户一拖视角就停掉自动取景 */
controls.addEventListener('start', () => { userMoved = true; });

let reframeTimer = 0;
window.addEventListener('resize', () => {
  if (userMoved || !posedPts) return;
  clearTimeout(reframeTimer);
  reframeTimer = setTimeout(() => {
    homeFraming = computeFraming(posedPts);
    applyFraming(homeFraming);
  }, 180);
});

/* ---------- UI：招式多选 + Confirm ---------- */
const selected = [];           // 点击顺序
for (const btn of comboBar.querySelectorAll('.combo-btn[data-move]')) {
  const clip = btn.dataset.move;
  if (!MOVES.some((m) => m.clip === clip)) { btn.disabled = true; continue; }
  btn.addEventListener('click', () => {
    const idx = selected.indexOf(clip);
    if (idx >= 0) { selected.splice(idx, 1); btn.classList.remove('selected'); }
    else { selected.push(clip); btn.classList.add('selected'); }
    setHint(selected.length
      ? 'Selected: ' + selected.map((c) => LABELS[c]).join('  →  ')
      : 'Pick punches in order, then press Confirm to play the combo.');
  });
}
const confirmBtn = document.getElementById('combo-confirm');
if (confirmBtn) {
  confirmBtn.addEventListener('click', () => {
    ensureAudio();
    if (playing) return;
    if (!selected.length) { setHint('Pick at least one punch first.'); return; }
    playSequence(selected.slice());
  });
}

/* ---------- 渲染循环 ---------- */
const clock = new THREE.Clock();
renderer.setAnimationLoop(() => {
  const dt = clock.getDelta();
  if (mixer) mixer.update(dt);
  /* 命中判定：当前动作时间越过命中帧 → 火花 + 音效（各一次）。
   * 动画已原位化，不做任何位置补偿；火花打在锚点上（防守方 idle 会让它微动，取当下位置）。 */
  if (current && !current.fired && current.act.time >= current.data.impactT - 1e-4) {
    current.fired = true;
    const anchor = anchors[current.data.anchor];
    if (anchor) {
      anchor.updateMatrixWorld(true);
      spawnHit(anchor.getWorldPosition(new THREE.Vector3()));
    }
    playHit();
    window.__lastHit = { name: current.name, anchorIdx: current.data.anchor, t: +current.act.time.toFixed(2) };
  }

  /* 火花生命周期 */
  for (let i = effects.length - 1; i >= 0; i--) {
    const e = effects[i];
    e.t += dt;
    const k = e.t / e.dur;
    if (k >= 1) {
      scene.remove(e.sprite);
      scene.remove(e.light);
      e.sprite.material.dispose();
      effects.splice(i, 1);
      continue;
    }
    const ease = 1 - Math.pow(1 - k, 2);
    e.sprite.scale.setScalar(bodySize * (0.07 + ease * 0.16));
    e.sprite.material.opacity = 1 - k * k;
    e.light.intensity = 6 * (1 - k);
  }

  controls.update();
  renderer.render(scene, camera);
});
