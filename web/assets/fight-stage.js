/* SilentJab — Fight page stage (two characters, dynamic GLB switching)
 *
 * Reads window.FIGHT config:
 *   scenes   — array of scene configs; each has { glb, active, label, description }
 *   index    — starting scene index (default 0)
 *
 * The GLB contains two characters (defence + attack) with separate skeletons.
 * Clip naming: "defence-idle", "attack-idle", "attack-{punchName}".
 * Initial state: defence plays defence-idle, attack plays attack-idle.
 * Clicking a punch button plays "attack-{punchName}" on the attack mixer,
 * then fades back to attack-idle when finished.
 *
 * The Refresh button advances to the next scene in the list.
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

/* ---------- config ---------- */
const CFG = window.FIGHT || {};
const SCENES = CFG.scenes || [];
let sceneIdx = CFG.index || 0;

/* 6 punch buttons — number → punch key + label.
 * The clip name is constructed as "attack-" + punch key.
 * e.g. button 1 (jab) → clip "attack-jab" */
const PUNCHES = [
  { num: 1, label: 'Jab',           key: 'jab' },
  { num: 2, label: 'Cross',         key: 'cross' },
  { num: 3, label: 'Lead Hook',     key: 'lead-hook' },
  { num: 4, label: 'Rear Hook',     key: 'rear-hook' },
  { num: 5, label: 'Lead Uppercut', key: 'lead-uppercut' },
  { num: 6, label: 'Rear Uppercut', key: 'rear-uppercut' },
];

/* Character config: bone count is the stable identifier (Blender re-exports
 * rename the tripo mesh nodes), meshKey is only a fallback hint.
 *   defence = 41-bone skeleton (tripo_node_5cd6af71)
 *   attack  = 33-bone skeleton (tripo_node_7b87a507 / ....003)
 *
 * `offset` is a per-character world-space nudge applied AFTER the GLB is
 * loaded, in units of the model's own world scale. It exists so the spacing
 * between the two fighters can be tuned from the page config without
 * re-exporting the GLB from Blender:
 *   offset: { x: -0.12 }  →  pull the defence 0.12 closer to the attack
 * A negative x on defence (and/or positive x on attack) closes the gap. */
const CHARACTERS = {
  defence: { meshKey: 'tripo_node_5cd6af71', bones: 41, idleClip: 'defence-idle' },
  attack:  { meshKey: 'tripo_node_7b87a507',  bones: 33, idleClip: 'attack-idle' },
};

/* ---------- DOM ---------- */
const canvas = document.getElementById('fight-canvas');
const barEl = document.getElementById('fight-bar');
const loadingEl = document.getElementById('fight-loading');
const loadingText = document.getElementById('fight-loading-text');
const errorEl = document.getElementById('fight-error');
const descEl = document.getElementById('fight-description');
const sceneLabelEl = document.getElementById('fight-scene-label');

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
controls.minDistance = 0.8;
controls.maxDistance = 6;
controls.maxPolarAngle = Math.PI * 0.55;

/* lights — same setup as home-stage.js for visual consistency */
scene.add(new THREE.HemisphereLight(0xd9e8ff, 0x3a3630, 2.0));
const keyLight = new THREE.DirectionalLight(0xffe8d2, 3.4);
keyLight.position.set(2.2, 3.2, 2.6);
scene.add(keyLight);
const rimLight = new THREE.DirectionalLight(0x86b8ff, 2.0);
rimLight.position.set(-2.4, 2.0, -2.6);
scene.add(rimLight);
const fillLight = new THREE.DirectionalLight(0xffffff, 0.9);
fillLight.position.set(0, 1.4, 4);
scene.add(fillLight);

/* ---------- resize ---------- */
function resize() {
  const w = canvas.clientWidth || canvas.parentElement.clientWidth;
  const h = canvas.clientHeight || canvas.parentElement.clientHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
new ResizeObserver(resize).observe(canvas.parentElement);
resize();

/* ---------- state ---------- */
/* Per-character state: root, mixer, actions map, current clip */
const chars = {};           // 'defence' | 'attack' → { root, mixer, actions: {}, current: null, currentAction: null }
let gltfScene = null;       // current loaded scene root
let userMoved = false;
let homeFraming = null;
let posedPts = null;
let sceneZoom = 1;          // per-scene camera zoom multiplier (config `zoom`)

/* ---------- material fix: force opaque (same as home-stage.js) ---------- */
function forceOpaque(mat) {
  if (!mat || !mat.transparent) return;
  mat.transparent = false;
  mat.depthWrite = true;
  mat.alphaTest = 0;
  mat.needsUpdate = true;
}

/* ---------- camera framing (same algorithm as home-stage.js) ---------- */
const _tv = new THREE.Vector3();
/* Side-on "fight camera": the two fighters are squared up along the X axis
 * (defence at -X facing +X, attack at +X facing -X), so the camera sits on
 * the -Z side looking back along +Z. That gives the classic profile face-off
 * read instead of the awkward three-quarter view you get from +Z, where one
 * fighter's back is turned to the lens.
 * Slight downward tilt keeps the camera at chest height, not floor level. */
const VIEW_DIR = new THREE.Vector3(0, 0.06, -1).normalize();

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

function computeFraming(pts, zoom = 1) {
  if (!pts || !pts.length) return null;
  const stageW = canvas.clientWidth || 480;
  const stageH = canvas.clientHeight || 480;
  const cRect = canvas.getBoundingClientRect();
  const bRect = barEl.getBoundingClientRect();
  /* The button bar is still hidden while the model loads, so fall back to an
   * estimate of where it will sit (stage bottom + gap) rather than treating
   * the whole lower stage as free space. */
  const barTop = bRect.height > 0
    ? bRect.top - cRect.top
    : stageH + 56;
  const topPad = stageH * 0.04;
  const bottomPad = Math.min(stageH * 0.38, Math.max(stageH * 0.07, stageH - barTop + stageH * 0.025));
  const sidePad = stageW * (stageW < 620 ? 0.03 : 0.06);

  let minX = 1e9, maxX = -1e9, minY = 1e9, maxY = -1e9, minZ = 1e9, maxZ = -1e9;
  for (const p of pts) {
    if (p.x < minX) minX = p.x; if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y; if (p.y > maxY) maxY = p.y;
    if (p.z < minZ) minZ = p.z; if (p.z > maxZ) maxZ = p.z;
  }
  const center = new THREE.Vector3((minX + maxX) / 2, (minY + maxY) / 2, (minZ + maxZ) / 2);
  const target = center.clone();
  let dist = Math.max(1.0, (maxY - minY) * 1.8);

  const wantCx = stageW / 2;
  const wantCy = (topPad + (stageH - bottomPad)) / 2;
  const wantW = stageW - sidePad * 2;
  const wantH = stageH - bottomPad - topPad;
  const halfTan = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));

  /* Screen-space correction.
   * The camera may sit on either side of the model (VIEW_DIR decides) and the
   * world axis that maps to screen-right flips with it, so the correction is
   * expressed in the camera's own right/up basis rather than in world X/Y.
   *
   * To keep the loop stable, the target is moved in the *plane through the
   * current target that is perpendicular to the view ray*. Moving along the
   * camera's up axis would tilt the camera and feed back into the next
   * iteration, so vertical correction is applied to a world-up vector that
   * has been projected perpendicular to the view direction. */
  const camRight = new THREE.Vector3();
  const worldUp = new THREE.Vector3(0, 1, 0);
  const camUp = new THREE.Vector3();
  const viewRay = new THREE.Vector3();

  for (let iter = 0; iter < 8; iter++) {
    camera.position.copy(target).addScaledVector(VIEW_DIR, dist);
    camera.lookAt(target);
    camera.updateMatrixWorld(true);

    camRight.setFromMatrixColumn(camera.matrixWorld, 0).normalize();
    // Camera up, made perpendicular to the view ray so the target can be
    // slid vertically without tilting the camera.
    viewRay.copy(VIEW_DIR);
    camUp.copy(worldUp).addScaledVector(viewRay, -worldUp.dot(viewRay));
    if (camUp.lengthSq() < 1e-8) camUp.set(0, 0, 1);
    camUp.normalize();

    let pMinX = 1e9, pMaxX = -1e9, pMinY = 1e9, pMaxY = -1e9;
    for (const p of pts) {
      _tv.copy(p).project(camera);
      const sx = (_tv.x * 0.5 + 0.5) * stageW;
      const sy = (-_tv.y * 0.5 + 0.5) * stageH;
      if (sx < pMinX) pMinX = sx; if (sx > pMaxX) pMaxX = sx;
      if (sy < pMinY) pMinY = sy; if (sy > pMaxY) pMaxY = sy;
    }
    const need = Math.max((pMaxX - pMinX) / wantW, (pMaxY - pMinY) / wantH) * 1.01;
    const dx = (wantCx - (pMinX + pMaxX) / 2);
    const dy = (wantCy - (pMinY + pMaxY) / 2);
    // World units per screen pixel at the target plane
    const wpp = (2 * dist * halfTan) / stageH;
    /* Sign notes:
     *  - sx grows to the right. The camera's own right axis (camRight)
     *    points the way screen-right corresponds to in world space, so
     *    moving the target along -camRight slides the content right.
     *  - sy grows downward. Moving the target along +camUp (world up)
     *    pushes the content down on screen, so a positive dy (content should
     *    move up) needs the target moved along +camUp as well — both use
     *    the same sign because dy is measured in the "content must travel"
     *    direction. */
    target.addScaledVector(camRight, -dx * wpp);
    target.addScaledVector(camUp, dy * wpp);
    // `zoom` < 1 pulls the camera in (bigger fighters), > 1 pushes it out.
    dist = THREE.MathUtils.clamp(dist * need * zoom, controls.minDistance, controls.maxDistance);
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

/* ---------- load GLB ---------- */
function resolveGlbUrl(path) {
  if (!path) return null;
  try { return new URL(path, document.baseURI).href; } catch { return path; }
}

function clearScene() {
  // Remove old model from scene, keep lights
  if (gltfScene) {
    scene.remove(gltfScene);
    gltfScene.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) {
        for (const m of Array.isArray(o.material) ? o.material : [o.material]) m.dispose();
      }
    });
    gltfScene = null;
  }
  // Clear per-character state
  for (const k in chars) delete chars[k];
}

function loadScene(idx) {
  if (!SCENES.length) {
    showError('No fight scenes configured. Add scenes to window.FIGHT.');
    return;
  }
  const cfg = SCENES[idx % SCENES.length];
  const glbUrl = resolveGlbUrl(cfg.glb);
  if (!glbUrl) {
    showError('Scene ' + idx + ' has no glb path.');
    return;
  }

  // UI: show loading
  loadingEl.classList.remove('hidden');
  errorEl.hidden = true;
  loadingText.textContent = `Loading ${cfg.label || 'fight'} model…`;
  barEl.hidden = true;

  // Camera zoom multiplier for this scene (1 = auto-fit, < 1 = closer)
  sceneZoom = typeof cfg.zoom === 'number' && cfg.zoom > 0 ? cfg.zoom : 1;

  // Description text
  if (descEl) {
    descEl.textContent = cfg.description || '';
    descEl.style.display = cfg.description ? '' : 'none';
  }
  if (sceneLabelEl) {
    sceneLabelEl.textContent = cfg.label || '';
  }

  // Clear previous model
  clearScene();

  // Determine which buttons are active for this scene
  const activeSet = new Set((cfg.active || []).map((n) => Number(n)));

  new GLTFLoader().load(
    glbUrl,
    (gltf) => onLoaded(gltf, cfg, activeSet),
    (e) => {
      if (!e.total) return;
      loadingText.textContent = `Loading ${cfg.label || 'fight'} model — ${Math.min(100, (e.loaded / e.total) * 100).toFixed(0)}%`;
    },
    (err) => {
      loadingEl.classList.add('hidden');
      errorEl.hidden = false;
      errorEl.textContent = 'Failed to load: ' + cfg.glb + '\n' + (err && err.message ? err.message : err);
      console.error('[fight-stage]', err);
    }
  );
}

/* ---------- skeleton resolution ----------
 * Two independent ways to find each character, because Blender re-exports
 * rename meshes arbitrarily (tripo_node_7b87a507 -> ...007b87a507.003 ...):
 *   1. bone count — stable: defence 41 joints, attack 33 joints
 *   2. mesh name prefix — only a hint
 * Both skeletons share the same bone names (mixamorig:*), so each character
 * needs its own AnimationMixer rooted at its own Armature node. */
function resolveRig(cfg, skinnedMeshes, sceneRoot) {
  // Bone count is the reliable discriminator
  let mesh = skinnedMeshes.find((m) => m.skeleton && m.skeleton.bones.length === cfg.bones);
  if (!mesh && cfg.meshKey) {
    mesh = skinnedMeshes.find((m) => (m.name || '').includes(cfg.meshKey));
  }
  if (!mesh) return null;

  // Walk up to the direct child of scene root (the Armature group)
  let root = mesh;
  while (root.parent && root.parent !== sceneRoot) root = root.parent;

  let bones = 0;
  root.traverse((o) => { if (o.isBone) bones++; });
  return { mesh, root, bones };
}

/* ---------- clip -> character mapping ----------
 * three.js AnimationClip does NOT expose its channels, so we read the raw
 * glTF JSON (gltf.parser.json) where every animation lists its channel
 * target node indices.
 *
 * Matching strategy: a clip drives a character if the bones it animates
 * belong to that character's skeleton. We identify skeletons by their joint
 * count, which is stable across Blender re-exports (defence 41, attack 33)
 * and independent of node names (three.js sanitizes "Armature.002" into
 * "Armature002", so name matching is fragile).
 *
 * glTF node indices align with the JSON `nodes` array, and the JSON `skins`
 * array lists each skeleton's joint node indices — so we can tell which
 * joints a clip touches and therefore which skeleton it belongs to. */
function buildClipOwnerMap(gltf, rigRoots) {
  const json = gltf.parser && gltf.parser.json;
  const map = {};           // clip name -> rig key
  if (!json || !json.animations || !json.nodes || !json.skins) return map;

  // joint node indices per skin
  const skinJoints = json.skins.map((s) => new Set(s.joints || []));

  // For each rig, find which skin matches it by joint count
  const rigSkinIndex = {};
  for (const [key, rig] of Object.entries(rigRoots)) {
    let count = 0;
    rig.root.traverse((o) => { if (o.isBone) count++; });
    // skinJoints.size equals the joint count
    const idx = skinJoints.findIndex((set) => set.size === count);
    if (idx >= 0) rigSkinIndex[key] = idx;
  }

  for (const anim of json.animations) {
    const channels = anim.channels || [];
    const counts = new Map();
    for (const ch of channels) {
      const t = ch.target || {};
      if (t.node === undefined || t.node === null) continue;
      // Which skin owns this node?
      for (const [key, skinIdx] of Object.entries(rigSkinIndex)) {
        if (skinJoints[skinIdx].has(t.node)) {
          counts.set(key, (counts.get(key) || 0) + 1);
        }
      }
    }
    if (counts.size === 1) {
      map[anim.name] = [...counts.keys()][0];
    } else if (counts.size > 1) {
      // Mixed clip: assign to the character with the most channels
      map[anim.name] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
    } else {
      console.warn('[fight] clip with unmapped channels:', anim.name);
    }
  }
  return map;
}

function onLoaded(gltf, cfg, activeSet) {
  gltfScene = gltf.scene;

  // Fix materials
  gltfScene.traverse((o) => {
    if (o.isMesh && o.material) {
      for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
        forceOpaque(m);
        m.envMapIntensity = 0.6;
      }
    }
  });
  scene.add(gltfScene);

  const allClips = gltf.animations || [];

  // Collect skinned meshes
  const skinnedMeshes = [];
  gltfScene.traverse((o) => { if (o.isSkinnedMesh) skinnedMeshes.push(o); });

  // Resolve each character's rig first, so we can map clips to characters
  const rigs = {};
  for (const [key, charCfg] of Object.entries(CHARACTERS)) {
    const rig = resolveRig(charCfg, skinnedMeshes, gltfScene);
    if (!rig) {
      console.warn('[fight] skeleton not found for', key, charCfg.bones, 'bones');
      continue;
    }
    rigs[key] = rig;
  }

  /* Apply per-character position offsets.
   * The GLB carries Blender's own spacing between the two Armatures. A scene
   * can override that with `offsets: { defence: {x: -0.12}, attack: {...} }`
   * in the config, which is applied here as a world-space nudge on the rig
   * root. Offsets are expressed in the model's own world units (1 unit ≈
   * one metre for these exports). */
  const offsets = (cfg && cfg.offsets) || {};
  for (const [key, rig] of Object.entries(rigs)) {
    const off = offsets[key];
    if (!off) continue;
    rig.root.position.x += Number(off.x || 0);
    rig.root.position.y += Number(off.y || 0);
    rig.root.position.z += Number(off.z || 0);
    if (off.yaw) {
      rig.root.rotation.y += (Number(off.yaw) * Math.PI) / 180;
    }
  }
  gltfScene.updateMatrixWorld(true);

  // Map clip name -> character key, using the raw glTF channel data
  const clipOwner = buildClipOwnerMap(gltf, rigs);

  // Build per-character mixers
  for (const [key, charCfg] of Object.entries(CHARACTERS)) {
    const rig = rigs[key];
    if (!rig) continue;

    const mixer = new THREE.AnimationMixer(rig.root);

    // Clips belonging to this character
    const charClips = allClips.filter((clip) => clipOwner[clip.name] === key);

    const state = {
      root: rig.root,
      mesh: rig.mesh,
      mixer,
      actions: {},         // clipName → Action
      current: null,       // currently playing clip name
      currentAction: null,
    };

    // Create actions for all clips assigned to this character
    for (const clip of charClips) {
      const action = mixer.clipAction(clip);
      state.actions[clip.name] = action;
    }

    // Play idle clip
    const idleName = charCfg.idleClip;
    if (state.actions[idleName]) {
      state.actions[idleName].play();
      state.current = idleName;
      state.currentAction = state.actions[idleName];
    } else {
      console.warn('[fight] idle clip not found for', key, idleName);
    }

    // Finished event: attack one-shots fade back to attack-idle
    mixer.addEventListener('finished', (e) => {
      if (e.action !== state.currentAction) return;
      const clipName = e.action.getClip().name;

      // Only attack one-shots need to return to idle
      if (key === 'attack' && clipName.startsWith('attack-') && clipName !== 'attack-idle') {
        const dur = 0.24;
        e.action.fadeOut(dur);
        if (state.actions['attack-idle']) {
          state.actions['attack-idle'].reset().fadeIn(dur).play();
        }
        state.current = 'attack-idle';
        state.currentAction = state.actions['attack-idle'];
        setActiveButton('attack-idle');
      }
    });

    chars[key] = state;
  }

  // Sample one frame of each idle so the characters settle into their pose
  for (const s of Object.values(chars)) {
    if (s.currentAction) s.mixer.setTime(0.5);
  }
  gltfScene.updateMatrixWorld(true);

  /* Note on orientation: the exported GLB already carries the Blender
   * Z-up -> Y-up conversion on each Armature root (root.rotation.x ≈ +90°),
   * so the fighters arrive standing. Do NOT add another 90° X rotation here
   * — that flips them onto their backs. */

  // Drop to ground: the model may sit below y=0 in Blender's exported frame
  const pts = samplePose(gltfScene);
  let soleY = 1e9;
  for (const p of pts) if (p.y < soleY) soleY = p.y;
  if (soleY < -1e-4) {
    const dy = -soleY;
    gltfScene.position.y += dy;
    for (const p of pts) p.y += dy;
    gltfScene.updateMatrixWorld(true);
  }

  posedPts = pts;
  homeFraming = computeFraming(pts, sceneZoom);
  applyFraming(homeFraming);

  // Build buttons
  buildButtons(activeSet);

  loadingEl.classList.add('hidden');
  barEl.hidden = false;

  // Debug
  const clipNames = allClips.map((c) => c.name);
  console.log('[fight] loaded', cfg.glb, 'clips:', clipNames);
  console.log('[fight] clip owners:', clipOwner);
  for (const [k, s] of Object.entries(chars)) {
    console.log(`  ${k}:`, Object.keys(s.actions));
  }

  // Debug handle for browser console inspection
  window.__fight = {
    chars,
    clipOwner,
    allClips: allClips.map((c) => c.name),
    gltfScene,
    camera,
    controls,
    scene,
    renderer,
  };
}

/* ---------- buttons ---------- */
function buildButtons(activeSet) {
  barEl.innerHTML = '';

  for (const punch of PUNCHES) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'fight-btn';
    btn.dataset.num = String(punch.num);

    const numSpan = document.createElement('span');
    numSpan.className = 'fight-btn-num';
    numSpan.textContent = String(punch.num);

    const labelSpan = document.createElement('span');
    labelSpan.className = 'fight-btn-label';
    labelSpan.textContent = punch.label;

    btn.append(numSpan, labelSpan);

    // The clip name for this button: "attack-" + punch key
    const clipName = 'attack-' + punch.key;

    // Check if this clip exists in the attack character's actions
    const attackChar = chars['attack'];
    const isActive = activeSet.has(punch.num) && attackChar && attackChar.actions[clipName];

    if (!isActive) {
      btn.classList.add('disabled');
      btn.disabled = true;
      btn.title = 'Not available in this scene';
    } else {
      btn.dataset.clip = clipName;
      btn.title = `${punch.num}: ${punch.label}`;
      btn.addEventListener('click', () => playAttackClip(clipName));
    }

    barEl.appendChild(btn);
  }

  // Refresh button
  const refresh = document.createElement('button');
  refresh.type = 'button';
  refresh.className = 'fight-btn fight-refresh';
  refresh.innerHTML = '\u27F3';
  refresh.title = 'Load next fight scene';
  refresh.addEventListener('click', () => {
    sceneIdx = (sceneIdx + 1) % SCENES.length;
    loadScene(sceneIdx);
  });
  barEl.appendChild(refresh);
}

function setActiveButton(clip) {
  for (const btn of barEl.children) {
    if (!btn.dataset.clip) continue;
    btn.classList.toggle('active', btn.dataset.clip === clip);
  }
}

/* ---------- play attack clip ---------- */
function playAttackClip(name) {
  const attack = chars['attack'];
  if (!attack || !attack.actions[name]) return;

  // If currently playing a one-shot (not idle), fade it out
  if (attack.current && attack.current !== 'attack-idle' && attack.currentAction) {
    attack.currentAction.fadeOut(0.14);
  }

  const action = attack.actions[name];
  action.reset();
  action.setLoop(THREE.LoopOnce, 1);
  action.clampWhenFinished = true;
  action.fadeIn(0.14).play();
  attack.current = name;
  attack.currentAction = action;
  setActiveButton(name);
}

/* ---------- render loop ---------- */
const clock = new THREE.Clock();

renderer.setAnimationLoop(() => {
  const dt = clock.getDelta();
  for (const s of Object.values(chars)) {
    if (s.mixer) s.mixer.update(dt);
  }
  controls.update();
  renderer.render(scene, camera);
});

/* ---------- user interaction: stop auto-framing on drag ---------- */
controls.addEventListener('start', () => { userMoved = true; });

/* ---------- resize handler: reframe ---------- */
let reframeTimer = 0;
window.addEventListener('resize', () => {
  if (userMoved || !posedPts || !homeFraming) return;
  clearTimeout(reframeTimer);
  reframeTimer = setTimeout(() => {
    homeFraming = computeFraming(posedPts, sceneZoom);
    if (homeFraming) applyFraming(homeFraming);
  }, 180);
});

/* ---------- error helper ---------- */
function showError(msg) {
  loadingEl.classList.add('hidden');
  errorEl.hidden = false;
  errorEl.textContent = msg;
  console.error('[fight]', msg);
}

/* ---------- start ---------- */
loadScene(sceneIdx);
