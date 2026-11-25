/*
 * Fight Techniques — a scripted four-chapter showcase bout with bone-anchored
 * contact (engine inherited from boxing-vs-kickboxing, extended).
 *
 * The boxer (European male sculpt, fight-man.glb) opens with a boxing flurry,
 * the kickboxer (woman-all.glb: boxer-woman's full 29-clip library merged
 * with kick-woman's roundhouse / flying kick / knock-out) answers with kicks,
 * he steps into the pocket with hooks and an uppercut, and the finish chains
 * her hands into a head kick — the "complete striker" story the article tells.
 *
 * The two rigs ship on different pipelines: the sculpt stands upright in clip
 * space (+Y up), the merged woman's clips are Z-up (Mixamo/Blender export, the
 * boxing-vs-kickboxing pipeline) and need the -90° X rotation. The loader
 * handles both via `zup`.
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { clone as skClone } from 'three/addons/utils/SkeletonUtils.js';

const canvas = document.getElementById('ft-canvas');
const stageEl = canvas.parentElement;
const loadingEl = document.getElementById('ft-loading');
const loadingText = document.getElementById('ft-loading-text');
const errorEl = document.getElementById('ft-error');
const replayBtn = document.getElementById('ft-replay');
const koEl = document.getElementById('ko');
const tagBoxing = document.getElementById('tag-boxing');
const tagKick = document.getElementById('tag-kickboxing');
const moveBoxing = document.getElementById('move-boxing');
const moveKick = document.getElementById('move-kickboxing');

/* ---------- renderer / scene ---------- */
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.42;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 60);

const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
controls.enableZoom = false;
controls.enableRotate = false;
controls.enablePan = false;
controls.minDistance = 2.2;
controls.maxDistance = 12;
controls.target.set(-0.2, 1.0, 0);
controls.update();

scene.add(new THREE.HemisphereLight(0xdcebff, 0x4a4640, 2.9));
// studio IBL (same recipe as /fight/game/) — natural bright read on both rigs
try {
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
} catch (e) { /* IBL optional */ }
const keyLight = new THREE.DirectionalLight(0xffe8d2, 4.2);
keyLight.position.set(2.2, 3.2, 2.6);
keyLight.castShadow = true;
keyLight.shadow.mapSize.set(1024, 1024);
keyLight.shadow.camera.left = -4;
keyLight.shadow.camera.right = 4;
keyLight.shadow.camera.top = 4;
keyLight.shadow.camera.bottom = -4;
scene.add(keyLight);
const rimLight = new THREE.DirectionalLight(0x9cc6ff, 2.5);
rimLight.position.set(-2.4, 2.0, -2.6);
scene.add(rimLight);
const fillLight = new THREE.DirectionalLight(0xffffff, 1.8);
fillLight.position.set(0, 1.4, 4);
scene.add(fillLight);

/* transparent arena floor — soft shadows only, page shows through */
const floor = new THREE.Mesh(
  new THREE.CircleGeometry(9, 64),
  new THREE.ShadowMaterial({ opacity: 0.22 })
);
floor.rotation.x = -Math.PI / 2;
floor.receiveShadow = true;
scene.add(floor);

/* ---------- fighters ---------- */
function forceOpaque(mat) {
  if (!mat || !mat.transparent) return;
  mat.transparent = false;
  mat.depthWrite = true;
  mat.alphaTest = 0;
}

function findBone(root, name) {
  return root.getObjectByName(name)
      || root.getObjectByName('mixamorig:' + name)
      || root.getObjectByName('mixamorig' + name)
      || null;
}
const BONE_NAMES = ['Hips', 'Head', 'HeadTop_End', 'LeftHand', 'RightHand', 'LeftFoot', 'RightFoot',
  'LeftToeBase', 'RightToeBase', 'Spine2', 'Spine1', 'Spine', 'LeftLeg', 'RightLeg',
  'LeftForeArm', 'RightForeArm'];   // forearm = elbow joint (elbow strikes contact here)

/* The baked clips carry real hips root travel (punch lunges, combo walks).
 * Zero the world-space X/Z drift relative to the clip's first frame so the
 * choreography tweens stay the only source of movement. */
function stripDrift(clip, hips) {
  const track = clip.tracks.find((t) => /Hips\.position$/.test(t.name));
  if (!track) return;
  hips.updateWorldMatrix(true, false);
  const q = new THREE.Quaternion();
  (hips.parent || hips).getWorldQuaternion(q);
  const qi = q.clone().invert();
  const base = new THREE.Vector3().fromArray(track.values, 0);
  const v = new THREE.Vector3();
  for (let i = 0; i < track.values.length; i += 3) {
    v.fromArray(track.values, i).sub(base).applyQuaternion(q);
    v.x = 0; v.z = 0;
    v.applyQuaternion(qi).add(base);
    v.toArray(track.values, i);
  }
}

/* skinned-mesh world vertices (sparsely sampled) */
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

function lowestSkinnedPoint(model) {
  let low = Infinity;
  model.updateMatrixWorld(true);
  const v = new THREE.Vector3();
  model.traverse((o) => {
    if (!o.isSkinnedMesh || !o.geometry?.attributes?.position) return;
    const pos = o.geometry.attributes.position;
    const step = Math.max(1, Math.floor(pos.count / 6000));
    for (let i = 0; i < pos.count; i += step) {
      v.fromBufferAttribute(pos, i);
      o.applyBoneTransform(i, v);
      o.localToWorld(v);
      if (v.y < low) low = v.y;
    }
  });
  return Number.isFinite(low) ? low : 0;
}

class Fighter {
  constructor(dir, zup) {      // dir: +1 faces right, -1 faces left
    this.group = new THREE.Group();
    this.group.rotation.y = (dir > 0 ? 1 : -1) * Math.PI / 2;
    this.zup = zup;            // true: clips are Z-up (needs rot.x -90°)
    this.mixer = null;
    this.actions = {};
    this.bones = {};
    this.head = null;
    this.ready = false;
    this.baseX = 0;
    this.nudgeX = 0;
    this.hopY = 0;
  }
  async load(url, name) {
    const gltf = await new GLTFLoader().loadAsync(url);
    const root = skClone(gltf.scene);
    root.traverse((o) => {
      if (o.isMesh) {
        o.castShadow = true;
        o.frustumCulled = false;
        forceOpaque(o.material);
      }
    });
    this.group.add(root);
    root.updateMatrixWorld(true);

    for (const n of BONE_NAMES) this.bones[n] = findBone(root, n);
    this.head = this.bones['Head'];
    this.mixer = new THREE.AnimationMixer(root);
    for (const clip of gltf.animations) {
      if (/Layer0$/.test(clip.name)) continue;
      const c = clip.clone();
      if (c.name !== 'defeat' && c.name !== 'knock-out') stripDrift(c, this.bones['Hips']);
      const act = this.mixer.clipAction(c);
      act.enabled = true;
      this.actions[c.name] = act;
    }
    if (this.zup) {
      /* Z-up pipeline (woman-all.glb, boxing-vs-kickboxing family): bind lies
       * flat with "up" along +Z; the clips stand the rig up. Rotate first,
       * then normalize on the animated guard frame. */
      root.rotation.x = -Math.PI / 2;
      root.updateMatrixWorld(true);
      const guard = this.actions['guard'] || Object.values(this.actions)[0];
      guard.reset().play();
      this.mixer.setTime(0.5);
      let pts = samplePose(root);
      const h0 = Math.max(...pts.map(p => p.y)) - Math.min(...pts.map(p => p.y));
      const s = 1.75 / h0;
      root.scale.setScalar(s);
      root.updateMatrixWorld(true);
      pts = samplePose(root);
      root.position.y = -Math.min(...pts.map(p => p.y));
      root.updateMatrixWorld(true);
    } else {
      /* sculpt pipeline (fight-man.glb) — identical recipe to fight/game, but
       * normalized on the GUARD pose: that is the pose this show idles in, so
       * the stance must be centred and grounded for guard, not idle (the two
       * stances sit ~1.2 m apart and the fighter would float off his root). */
      const refClip = this.actions['guard'] || this.actions['idle'] || Object.values(this.actions)[0];
      refClip.reset().play();
      this.mixer.setTime(Math.min(0.4, refClip.getClip().duration * 0.1));
      // the group's ±90° rotation has never been baked into matrixWorld at
      // load time (no render yet) — bake it or the XZ recentre measures the
      // unrotated frame and the fighter keeps his stance offset at runtime
      this.group.updateMatrixWorld(true);
      root.updateMatrixWorld(true);
      const _w = new THREE.Vector3();
      const top = this.bones['HeadTop_End'] || this.bones['Head'];
      const yTop = top ? top.getWorldPosition(_w).y : 1;
      const yFoot = Math.min(
        this.bones['LeftFoot'] ? this.bones['LeftFoot'].getWorldPosition(_w).y : 0,
        this.bones['RightFoot'] ? this.bones['RightFoot'].getWorldPosition(_w).y : 0,
      );
      const h0 = Math.max(0.001, yTop - yFoot);
      const s = 1.75 / h0;
      root.scale.setScalar(s);
      root.updateMatrixWorld(true);
      const sole = lowestSkinnedPoint(root);
      root.position.y -= sole - 0.003;
      root.updateMatrixWorld(true);
      const _fw = new THREE.Vector3();
      const fl = this.bones['LeftFoot'], fr = this.bones['RightFoot'];
      if (fl && fr) {
        // feet midpoint must be expressed in the GROUP's local space (the
        // root is a child of the ±90°-rotated group — subtracting world XZ
        // directly would shift along the wrong axes)
        const mid = fl.getWorldPosition(_fw).clone()
          .add(fr.getWorldPosition(_fw)).multiplyScalar(0.5);
        this.group.worldToLocal(mid);
        root.position.x -= mid.x;
        root.position.z -= mid.z;
        root.updateMatrixWorld(true);
      }
    }
    console.log(`[ft] ${name}: loaded`);
    this.ready = true;
  }
  play(name, { fade = 0.2, clamp = false, rev = 0, rate = 1, start = 0 } = {}) {
    const next = this.actions[name];
    if (!next) return;
    const dominant = next.getEffectiveWeight() > 0.4;
    const looping = name === 'guard' && rev === 0;
    next.reset();
    next.clampWhenFinished = !looping && (clamp || rev > 0);
    next.setLoop(looping ? THREE.LoopRepeat : THREE.LoopOnce, looping ? Infinity : 1);
    if (rev > 0) {
      const from = start > 0 ? Math.min(start, next.getClip().duration - 0.02) : next.getClip().duration - 0.02;
      next.time = Math.max(0.01, from);
      next.setEffectiveTimeScale(-rev);
    } else {
      next.time = Math.min(Math.max(0, start), Math.max(0, next.getClip().duration - 0.02));
      next.setEffectiveTimeScale(TS * rate);
    }
    if (fade <= 0 || dominant) { next.setEffectiveWeight(1); next.play(); }
    else next.fadeIn(fade).play();
    for (const a of Object.values(this.actions)) {
      if (a === next) continue;
      const w = a.getEffectiveWeight();
      if (w > 0.001) a.fadeOut(fade > 0 ? fade : 0.001);
      else if (a.enabled) a.stop();
    }
  }
  stopAll() { this.mixer.stopAllAction(); }
}

const man = new Fighter(+1, false);   // BOXING (sculpt, upright clips), left
const woman = new Fighter(-1, false); // KICKBOXING (woman-all.glb, upright clips)

/* fight positions — wider stance so the exchanges read from a distance */
const HOME = { m: -0.72, w: 0.62 };
let edgeX = 1.3;
const homeOut = () => ({ m: -edgeX, w: edgeX * 0.92 });
man.group.position.set(homeOut().m, 0, 0);
woman.group.position.set(homeOut().w, 0, 0);
scene.add(man.group, woman.group);

/* ---------- timeline ---------- */
const TS = 1.35;
const HOP_IN = { dur: 0.8, h: 0.5 };
const HOP_OUT = { dur: 0.8, h: 0.45 };

/* raw clip durations (seconds) */
const CLIP_DUR = {
  m: {
    guard: 5.03, block: 1.63, jab: 2.0, cross: 2.17, 'lead-hook': 2.3, 'rear-hook': 2.2,
    'lead-uppercut': 2.23, 'rear-uppercut': 2.23, elbow: 2.07, knee: 2.5, kick: 1.63,
    'jab-cross': 2.27, combo1: 2.2, 'combo2-knee': 5.7, 'combo2-elbow': 5.03,
    'hit-body': 1.37, 'hit-head': 1.33, 'step-back': 0.93, 'step-forward': 1.03,
    'step-left': 1.3, 'step-right': 1.27, taunt: 2.87, win: 4.53, defeat: 4.8,
  },
  w: {
    guard: 5.03, block: 1.63, jab: 2.0, cross: 2.17, 'lead-hook': 2.3, 'rear-hook': 2.2,
    'lead-uppercut': 2.23, 'rear-uppercut': 2.23, elbow: 2.07, knee: 2.5, kick: 1.63,
    'jab-cross': 2.27, combo1: 2.2, 'hit-body': 1.37, 'hit-head': 1.33, 'hit-uppercut': 1.7,
    'step-back': 0.93, 'step-forward': 1.03, 'step-left': 1.3, 'step-right': 1.27,
    taunt: 5.2, win: 4.53, defeat: 4.8,
    'roundhouse-kick': 2.53, 'flying-kick': 1.53, 'knock-out': 4.97,
  },
};

/* Baked contacts (frac = raw clip time of the contact frame / clip duration;
 * dx = residual x-correction applied to the attacker just before contact).
 * All values measured with build/cdp_ft_contact.mjs bone probes. */
const HITS = {
  jab_g:      { frac: 0.407, atkBone: 'LeftHand',     defBone: 'LeftHand', dx: 0.12, fx: 'punch', snd: 'punch' },
  cross_g:    { frac: 0.34, atkBone: 'RightHand',    defBone: 'LeftHand', dx: 0.14, fx: 'punch', snd: 'punch' },
  hook_g:     { frac: 0.44, atkBone: 'LeftHand',     defBone: 'LeftHand', dx: 0.1, fx: 'punch', snd: 'punch' },
  mjab2_g:    { frac: 0.14, atkBone: 'LeftHand',    defBone: 'LeftHand', dx: 0.2, fx: 'punch', snd: 'punch' },
  mcross2_g:  { frac: 0.34, atkBone: 'RightHand',   defBone: 'LeftHand', dx: 0.08, fx: 'punch', snd: 'punch' },
  rhook_g:    { frac: 0.522, atkBone: 'RightHand',    defBone: 'LeftHand', dx: 0.26, fx: 'punch', snd: 'punch' },
  wjab_g:     { frac: 0.144, atkBone: 'LeftHand',     defBone: 'LeftHand', dx: 0.14, fx: 'punch', snd: 'punch' },
  wcross_g:   { frac: 0.248, atkBone: 'RightHand',   defBone: 'LeftHand', dx: 0.18, fx: 'punch', snd: 'punch' },
  rkick_g:    { frac: 0.42, atkBone: 'RightToeBase', defBone: 'LeftHand', dx: 0, fx: 'block', snd: 'kick' },
  flying_g:   { frac: 0.398,  atkBone: 'LeftToeBase',  defBone: 'LeftHand', dx: 0.46, fx: 'block', snd: 'kick' },
  uppercut_rock: { frac: 0.314, atkBone: 'LeftHand',   defBone: 'Head',     dx: 0.24, fx: 'punch', snd: 'punch', react: 'hit-uppercut' },
  headkick_ko: { frac: 0.431, atkBone: 'RightToeBase', defBone: 'Head',   dx: 0, fx: 'ko', snd: 'ko',
                 react: 'hit-head', fall: 'knock-out', fallStart: 0.85, fallDelay: 0.30 },
};
/* FX style for the rocking uppercut (harder than a jab, no KO) */
const FX_STYLE = {
  block: { flash: 0.5,  sparks: 7,  shake: 0.035, shakeT: 0.32 },
  punch: { flash: 0.55, sparks: 8,  shake: 0.05,  shakeT: 0.35 },
  ko:    { flash: 0.95, sparks: 12, shake: 0.1,   shakeT: 0.55 },
};

/* chapter beats (no on-screen numbering — the labels carry the story) */
const TL = [
  { t: 0.0,  who: 'm', clip: 'guard' },
  { t: 0.0,  who: 'w', clip: 'guard' },
  { t: 0.2,  who: 'm', moveTo: 'fight', hop: true, tweenDur: HOP_IN.dur, hopH: HOP_IN.h },
  { t: 0.2,  who: 'w', moveTo: 'fight', hop: true, tweenDur: HOP_IN.dur, hopH: HOP_IN.h },

  /* --- chapter 1: the boxing flurry (long jab range) --- */
  { t: 1.50, who: 'm', clip: 'jab', x: -0.48, tweenDur: 0.30, clamp: true, hit: 'jab_g' },
  { t: 2.75, who: 'm', clip: 'cross', x: -0.46, tweenDur: 0.25, clamp: true, hit: 'cross_g' },
  { t: 3.85, who: 'm', clip: 'lead-hook', x: -0.44, tweenDur: 0.25, clamp: true, hit: 'hook_g' },
  { t: 3.95, who: 'w', clip: 'step-back', move: 0.05, fade: 0.10, clamp: true },
  { t: 4.75, who: 'm', clip: 'jab-cross', x: -0.42, tweenDur: 0.22, clamp: true, hit: ['mjab2_g', 'mcross2_g'] },
  { t: 5.28, who: 'w', clip: 'block', fade: 0.14, clamp: true },       // shell up on the flurry
  { t: 6.00, who: 'w', clip: 'step-back', move: 0.18, fade: 0.10, clamp: true },
  { t: 6.10, who: 'm', clip: 'guard' },
  { t: 6.52, who: 'w', clip: 'guard', fade: 0.2 },

  /* --- chapter 2: the kickboxing answer, from kicking range --- */
  { t: 6.95, who: 'w', x: 1.30, tweenDur: 0.50 },
  { t: 6.95, who: 'm', x: -0.62, tweenDur: 0.45 },
  { t: 7.65, who: 'w', clip: 'roundhouse-kick', x: 1.05, tweenDur: 0.45, clamp: true, hit: 'rkick_g' },
  { t: 7.85, who: 'm', clip: 'block', start: 0.30, fade: 0.14, clamp: true },
  { t: 8.70, who: 'm', clip: 'step-back', move: -0.35, fade: 0.1, clamp: true },
  { t: 9.25, who: 'm', clip: 'guard' },
  { t: 9.40, who: 'w', clip: 'guard', fade: 0.2 },
  { t: 9.45, who: 'w', x: 1.55, tweenDur: 0.4 },
  { t: 10.00, who: 'w', clip: 'flying-kick', move: -0.75, tweenDur: 0.30, clamp: true, hit: 'flying_g' },
  { t: 9.95, who: 'm', clip: 'block', fade: 0.14, clamp: true },
  { t: 10.35, who: 'w', move: -0.30, tweenDur: 0.45 },                 // airborne drift, touch down
  { t: 10.40, who: 'm', move: -0.45, tweenDur: 0.5 },                  // driven back
  { t: 10.55, who: 'm', clip: 'step-back', fade: 0.12, clamp: true },
  { t: 11.30, who: 'm', clip: 'guard' },
  { t: 11.40, who: 'w', clip: 'guard', fade: 0.2 },

  /* --- chapter 3: the pocket — he steps in, hooks and uppercut --- */
  { t: 11.75, who: 'm', clip: 'step-forward', x: -0.54, tweenDur: 0.36, rate: 1.6, clamp: true },
  { t: 11.85, who: 'w', clip: 'guard', x: 0.52, tweenDur: 0.42, fade: 0.12 },
  { t: 12.40, who: 'm', clip: 'rear-hook', x: -0.52, tweenDur: 0.26, clamp: true, hit: 'rhook_g' },
  { t: 12.45, who: 'w', clip: 'block', fade: 0.14, clamp: true },
  { t: 13.65, who: 'm', clip: 'lead-uppercut', x: -0.50, tweenDur: 0.22, clamp: true, hit: 'uppercut_rock' },
  { t: 14.90, who: 'm', clip: 'guard', fade: 0.15 },
  { t: 14.80, who: 'w', clip: 'step-back', move: 0.20, fade: 0.12, clamp: true },
  { t: 15.40, who: 'w', clip: 'guard', fade: 0.2 },

  /* --- chapter 4: the combined finish --- */
  { t: 16.20, who: 'w', clip: 'jab-cross', x: 0.50, tweenDur: 0.30, clamp: true, hit: ['wjab_g', 'wcross_g'] },
  { t: 16.80, who: 'm', clip: 'block', fade: 0.14, clamp: true },
  { t: 17.55, who: 'm', clip: 'jab-cross', x: -0.44, tweenDur: 0.28, clamp: true, hit: ['mjab2_g', 'mcross2_g'] },
  { t: 18.10, who: 'w', clip: 'block', fade: 0.14, clamp: true },
  { t: 18.80, who: 'm', clip: 'guard', fade: 0.15 },
  { t: 18.75, who: 'w', clip: 'guard', fade: 0.15 },
  /* she resets to kick range, then the head kick sails in at full extension */
  { t: 19.05, who: 'w', x: 0.94, tweenDur: 0.45 },
  { t: 19.40, who: 'w', clip: 'roundhouse-kick', x: 0.94, tweenDur: 0.42, clamp: true, hit: 'headkick_ko' },
  { t: 99, ko: true },   // exact slam time patched in below (KO_SLAM_T)
  /* --- aftermath: she celebrates, he gets back up --- */
  { t: 22.20, who: 'w', clip: 'win', fade: 0.2, clamp: true },
  { t: 23.10, who: 'm', clip: 'knock-out', rev: 3.2, start: 4.5, fade: 0.2 },  // reversed = stands up
  { t: 23.80, koOff: true },
  { t: 24.10, who: 'm', clip: 'guard', fade: 0.15 },
  { t: 24.30, who: 'm', moveTo: 'out', hop: true, tweenDur: HOP_OUT.dur, hopH: HOP_OUT.h },
  { t: 25.10, who: 'w', clip: 'guard', fade: 0.2 },
  { t: 25.40, who: 'w', moveTo: 'out', hop: true, tweenDur: HOP_OUT.dur, hopH: HOP_OUT.h },
];
const END_T = 26.8;

/* head-kick contact time: computed from the TL entry that carries headkick_ko */
let KO_T = null;
{
  const e = TL.find((b) => Array.isArray(b.hit) ? b.hit.includes('headkick_ko') : b.hit === 'headkick_ko');
  const rawDur = CLIP_DUR[e.who][e.clip];
  KO_T = e.t + Math.max(0, HITS.headkick_ko.frac * rawDur - (e.start || 0)) / (TS * (e.rate || 1));
}
/* defeat handover: contact -> hit-head plays; after fallDelay hand over to the
 * knock-out clip entering mid-topple; KO slam when his body hits the mat
 * (knock-out: recoil peak 1.43, mat ~2.30, settled 2.5+). */
const KO_FALL_DELAY = HITS.headkick_ko.fallDelay;
const KO_CLIP_START = HITS.headkick_ko.fallStart;
const KO_SLAM_RAW = 2.32;
const KO_SLAM_T = KO_T + KO_FALL_DELAY + Math.max(0, KO_SLAM_RAW - KO_CLIP_START) / TS;
/* patch the ko TL entry to fire exactly at the mat-slam moment */
{
  const koEntry = TL.find((b) => b.ko);
  if (koEntry) koEntry.t = KO_SLAM_T;
}

/* derived contact list */
const contacts = [];
for (const e of TL) {
  if (!e.hit || !e.clip) continue;
  const rawDur = CLIP_DUR[e.who][e.clip];
  const start = e.start || 0;
  const scale = TS * (e.rate || 1);
  const clipEnd = e.t + (rawDur - start) / scale;
  for (const hname of Array.isArray(e.hit) ? e.hit : [e.hit]) {
    const h = HITS[hname];
    contacts.push({
      t: e.t + Math.max(0, h.frac * rawDur - start) / scale, clipEnd,
      atk: e.who, def: e.who === 'm' ? 'w' : 'm',
      atkBone: h.atkBone, defBone: h.defBone, dx: h.dx || 0,
      fx: h.fx, snd: h.snd, hname,
      react: h.react || null, fall: h.fall || null,
      fired: false,
    });
  }
}

/* ---------- impact FX ---------- */
function makeRadialTex(stops, size = 128) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  for (const [o, col] of stops) grad.addColorStop(o, col);
  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
const texFlash = makeRadialTex([
  [0, 'rgba(255,255,255,1)'],
  [0.25, 'rgba(255,214,120,0.95)'],
  [0.55, 'rgba(255,130,50,0.55)'],
  [1, 'rgba(255,110,40,0)'],
]);
const texSpark = makeRadialTex([
  [0, 'rgba(255,255,255,1)'],
  [0.4, 'rgba(255,200,110,0.9)'],
  [1, 'rgba(255,140,60,0)'],
], 64);

const fxLive = [];
function spawnImpact(pos, kind, qaFrozen) {
  const st = FX_STYLE[kind] || FX_STYLE.punch;
  const born = boutT();
  const flash = new THREE.Sprite(new THREE.SpriteMaterial({
    map: texFlash, transparent: true, depthTest: false, opacity: 1,
  }));
  flash.position.copy(pos);
  flash.scale.setScalar(st.flash);
  flash.renderOrder = 20;
  scene.add(flash);
  fxLive.push({ s: flash, life: 0, ttl: 0.32, flash: true, base: st.flash, born });

  for (let i = 0; i < st.sparks; i++) {
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({
      map: texSpark, transparent: true, depthTest: false, opacity: 1,
    }));
    sp.position.copy(pos);
    sp.scale.setScalar(0.09 + Math.random() * 0.07);
    sp.renderOrder = 21;
    const vel = new THREE.Vector3(
      (Math.random() - 0.5) * 2.4, Math.random() * 1.6 + 0.4, (Math.random() - 0.5) * 2.4
    );
    scene.add(sp);
    fxLive.push({ s: sp, vel, life: 0, ttl: 0.45, flash: false, born });
  }
  if (qaFrozen) return;
}
function updateFx(dt) {
  for (let i = fxLive.length - 1; i >= 0; i--) {
    const f = fxLive[i];
    f.life += dt;
    const p = f.life / f.ttl;
    if (p >= 1) { scene.remove(f.s); f.s.material.dispose(); fxLive.splice(i, 1); continue; }
    if (!f.flash) {
      f.vel.y -= 5.5 * dt;
      f.s.position.addScaledVector(f.vel, dt);
    } else {
      f.s.scale.setScalar(f.base * (1 + p * 1.4));
    }
    f.s.material.opacity = 1 - p;
  }
}
function clearFx() {
  for (const f of fxLive) { scene.remove(f.s); f.s.material.dispose(); }
  fxLive.length = 0;
}

/* camera shake */
let shakeT = 0, shakeDur = 0, shakeAmp = 0;
function shake(kind) {
  const st = FX_STYLE[kind] || FX_STYLE.punch;
  shakeT = st.shakeT; shakeDur = st.shakeT; shakeAmp = st.shake;
}
const _shakeOff = new THREE.Vector3();
function shakeOffset() {
  if (shakeT <= 0) return null;
  const p = shakeT / shakeDur;
  const a = shakeAmp * p * p;
  _shakeOff.set((Math.random() - 0.5) * 2 * a, (Math.random() - 0.5) * 2 * a, (Math.random() - 0.5) * 2 * a);
  return _shakeOff;
}

/* ---------- hit sounds ---------- */
const AudioFX = (() => {
  let ctx = null, master = null;
  function ensure() {
    try {
      if (!ctx) {
        ctx = new (window.AudioContext || window.webkitAudioContext)();
        master = ctx.createGain();
        master.gain.value = 0.9;
        master.connect(ctx.destination);
      }
      if (ctx.state === 'suspended') ctx.resume();
      return ctx;
    } catch (e) { return null; }
  }
  function noise(dur, freq, q, vol) {
    const n = Math.ceil(ctx.sampleRate * dur);
    const buf = ctx.createBuffer(1, n, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, 2);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass'; f.frequency.value = freq; f.Q.value = q;
    const g = ctx.createGain(); g.gain.value = vol;
    src.connect(f); f.connect(g); g.connect(master);
    src.start();
  }
  function thud(f0, f1, dur, vol) {
    const now = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(f0, now);
    o.frequency.exponentialRampToValueAtTime(f1, now + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, now);
    g.gain.exponentialRampToValueAtTime(0.001, now + dur);
    o.connect(g); g.connect(master);
    o.start(now); o.stop(now + dur + 0.05);
  }
  return {
    unlock: ensure,
    hit(kind) {
      if (!ensure() || ctx.state !== 'running') return;
      if (kind === 'punch')      { noise(0.06, 900, 1.0, 0.5);  thud(150, 65, 0.12, 0.55); }
      else if (kind === 'kick')  { noise(0.08, 600, 1.0, 0.65); thud(120, 55, 0.15, 0.7); }
      else /* ko */              { noise(0.05, 1200, 1.0, 0.4); noise(0.2, 250, 0.8, 0.5); thud(85, 30, 0.5, 0.9); }
    },
  };
})();
document.addEventListener('pointerdown', () => AudioFX.unlock());
document.addEventListener('keydown', () => AudioFX.unlock());

/* ---------- engine ---------- */
let clock0 = null;
let vt = null;
let fired = [];
let moves = [];
let pending = [];
let done = false;

const whoOf = { m: man, w: woman };

function tweenX(who, delta, dur, hopH = 0) {
  const f = whoOf[who];
  moves.push({ who, from: f.baseX, to: f.baseX + delta, t0: boutT(), t1: boutT() + dur, h: hopH });
}

function boutT() { return vt !== null ? vt : (performance.now() - clock0) / 1000; }

function resetNudges() { man.nudgeX = 0; woman.nudgeX = 0; }

function startBout() {
  document.body.classList.add('ft-live');
  vt = null;
  const out = homeOut();
  man.baseX = out.m; woman.baseX = out.w;
  man.group.position.set(out.m, 0, 0);
  woman.group.position.set(out.w, 0, 0);
  man.stopAll(); woman.stopAll();
  man.play('guard', { fade: 0 }); woman.play('guard', { fade: 0 });
  clock0 = performance.now();
  fired = [];
  moves = [];
  pending = [];
  done = false;
  resetNudges();
  for (const c of contacts) c.fired = false;
  clearFx();
  shakeT = 0;
  koEl.classList.remove('on');
  hideMoves();
}

function nudgeRamp(c, t) {
  if (t < c.t - 0.22) return 0;
  if (t < c.t) return (t - (c.t - 0.22)) / 0.22;
  if (t < c.t + 0.30) return 1;
  if (t < c.t + 0.70) return 1 - (t - (c.t + 0.30)) / 0.40;
  return 0;
}

const _bpA = new THREE.Vector3();
const _bpD = new THREE.Vector3();
function fireContact(c, t) {
  c.fired = true;
  const atkF = whoOf[c.atk], defF = whoOf[c.def];
  const bA = atkF.bones[c.atkBone], bD = defF.bones[c.defBone];
  if (bA && bD) {
    bA.getWorldPosition(_bpA);
    bD.getWorldPosition(_bpD);
    const mid = _bpA.clone().add(_bpD).multiplyScalar(0.5);
    spawnImpact(mid, c.fx, vt !== null);
  }
  AudioFX.hit(c.snd);
  shake(c.fx);
  showMove(c.atk, c.hname, t);
  if (c.react) {
    defF.play(c.react, { fade: 0.03, clamp: true });
  }
  if (c.fall) {
    pending.push({
      t: t + KO_FALL_DELAY,
      fn: () => defF.play(c.fall, { clamp: true, fade: 0.12, start: KO_CLIP_START }),
    });
  }
}

function updateBout(dt = 0) {
  if (clock0 === null || done) return;
  const t = boutT();

  for (let i = 0; i < TL.length; i++) {
    if (fired[i] || t < TL[i].t) continue;
    fired[i] = true;
    const b = TL[i];
    if (b.ko) { koEl.classList.add('on'); continue; }
    if (b.koOff) { koEl.classList.remove('on'); continue; }
    const f = whoOf[b.who];
    if (b.clip) f.play(b.clip, {
      clamp: !!b.clamp, rev: b.rev || 0, rate: b.rate || 1, start: b.start || 0,
      fade: b.fade ?? (b.clamp ? 0.12 : 0.2),
    });
    if (b.moveTo) {
      const target = (b.moveTo === 'fight' ? HOME : homeOut())[b.who];
      tweenX(b.who, target - f.baseX, b.tweenDur || 0.6, b.hopH || 0);
    } else if (b.x !== undefined) {
      tweenX(b.who, b.x - f.baseX, b.tweenDur || 0.4, b.hopH || 0);
    } else if (b.move) {
      tweenX(b.who, b.move, b.tweenDur || (b.clip ? (CLIP_DUR[b.who][b.clip] / TS / (b.rate || 1)) : 0.6));
    }
  }

  for (let i = pending.length - 1; i >= 0; i--) {
    if (t >= pending[i].t) { const fn = pending[i].fn; pending.splice(i, 1); fn(); }
  }

  man.hopY = 0; woman.hopY = 0;
  for (let i = moves.length - 1; i >= 0; i--) {
    const mv = moves[i];
    const f = whoOf[mv.who];
    const p = Math.min(1, Math.max(0, (t - mv.t0) / Math.max(0.001, mv.t1 - mv.t0)));
    f.baseX = mv.from + (mv.to - mv.from) * (p * p * (3 - 2 * p));
    if (mv.h) f.hopY = mv.h * Math.sin(Math.PI * p);
    if (p >= 1) moves.splice(i, 1);
  }
  resetNudges();
  let nudgeM = 0, nudgeW = 0;
  for (const c of contacts) {
    const r = nudgeRamp(c, t);
    if (!r) continue;
    const v = Math.max(0, c.dx) * r;
    if (c.atk === 'm') nudgeM = Math.max(nudgeM, v);
    else nudgeW = Math.max(nudgeW, v);
  }
  man.nudgeX += nudgeM;
  woman.nudgeX -= nudgeW;
  man.group.position.x = man.baseX + man.nudgeX;
  woman.group.position.x = woman.baseX + woman.nudgeX;
  man.group.position.y = man.hopY;
  woman.group.position.y = woman.hopY;

  const midX = (man.group.position.x + woman.group.position.x) / 2;
  const wantX = Math.min(0.1, Math.max(-0.55, midX));
  followX += (wantX - followX) * (vt !== null ? 1 : Math.min(1, dt * 4));
  controls.target.x = followX;
  camera.position.x = followX;

  for (const c of contacts) {
    if (!c.fired && t >= c.t) fireContact(c, t);
  }

  if (t >= END_T) {
    done = true;
    stageEl.classList.add('ft-docked');
    document.body.classList.remove('ft-live');
    replayBtn.hidden = false;
  }
}

/* ---------- camera framing ---------- */
let followX = 0;
function frameCamera() {
  const w = canvas.clientWidth || 1;
  const h = canvas.clientHeight || 1;
  camera.aspect = w / Math.max(1, h);
  const portrait = camera.aspect < 0.9;
  camera.fov = portrait ? 55 : 40;
  const tanH = Math.tan(camera.fov * Math.PI / 360);
  const need = portrait ? 2.4 : 2.8;
  const z = Math.min(portrait ? 7.8 : 7.0,
                     Math.max(portrait ? 5.2 : 3.5, need / (tanH * camera.aspect)));
  const hw = z * tanH * camera.aspect;
  edgeX = Math.min(hw - 0.45, 2.0);
  const cy = portrait ? 1.12 : 1.02;
  camera.position.set(followX, cy, z);
  controls.target.set(followX, cy, 0);
  camera.updateProjectionMatrix();
}
new ResizeObserver(() => {
  const w = canvas.clientWidth || canvas.parentElement.clientWidth;
  const h = canvas.clientHeight || canvas.parentElement.clientHeight;
  renderer.setSize(w, h, false);
  frameCamera();
}).observe(canvas.parentElement);

/* ---------- labels ---------- */
const v = new THREE.Vector3();
function placeTag(el, fighter) {
  if (!fighter.head || !fighter.ready) { el.style.display = 'none'; return; }
  fighter.head.getWorldPosition(v);
  v.y += 0.32;
  v.project(camera);
  const stage = canvas.parentElement.getBoundingClientRect();
  const x = (v.x * 0.5 + 0.5) * stage.width;
  const y = (-v.y * 0.5 + 0.5) * stage.height;
  el.style.display = v.z < 1 ? 'block' : 'none';
  el.style.left = x + 'px';
  el.style.top = y + 'px';
}

/* ---------- move labels (name of the strike that just landed) ---------- */
const MOVE_LABEL = {
  jab_g: 'JAB', cross_g: 'CROSS', hook_g: 'LEAD HOOK', rhook_g: 'REAR HOOK',
  mjab2_g: 'JAB', mcross2_g: 'CROSS', wjab_g: 'JAB', wcross_g: 'CROSS',
  rkick_g: 'ROUNDHOUSE', flying_g: 'FLYING KICK',
  uppercut_rock: 'UPPERCUT', headkick_ko: 'HEAD KICK',
};
const MOVE_TTL = { headkick_ko: 1.9, rkick_g: 1.4, flying_g: 1.4, uppercut_rock: 1.25, rhook_g: 1.05 };
const moveEls = { m: moveBoxing, w: moveKick };

function showMove(who, hname, t) {
  const el = moveEls[who];
  const text = MOVE_LABEL[hname];
  if (!el || !text) return;
  el.firstElementChild.textContent = text;
  el.dataset.born = String(t);
  el.dataset.ttl = String(MOVE_TTL[hname] || 0.95);
  el.classList.remove('on');
  void el.offsetWidth;              // restart the pop animation
  el.classList.add('on');
}
function hideMoves() {
  for (const el of [moveBoxing, moveKick]) {
    el.classList.remove('on');
    el.dataset.born = '';
  }
}
/* the boxer's callout sits out to his left, the kickboxer's out to her right */
function placeMove(el, fighter, side) {
  const born = parseFloat(el.dataset.born || '');
  const ttl = parseFloat(el.dataset.ttl || '0.95');
  if (!fighter.head || !fighter.ready || !Number.isFinite(born) || boutT() - born > ttl) {
    el.classList.remove('on');
    return;
  }
  const stage = canvas.parentElement.getBoundingClientRect();
  const w = stage.width || 1;
  const h = stage.height || 1;
  fighter.head.getWorldPosition(v);
  v.y += 0.14;
  v.project(camera);
  const hx = (v.x * 0.5 + 0.5) * w;
  const hy = (-v.y * 0.5 + 0.5) * h;
  const fs = Math.max(16, Math.min(46, w * 0.046));
  el.style.fontSize = fs + 'px';
  const gap = fs * 0.66;
  const ew = el.offsetWidth;
  const eh = el.offsetHeight;
  let x = side === 'm' ? hx - gap : hx + gap;
  let y = Math.min(h - eh * 0.5 - 6, Math.max(eh * 0.5 + 6, hy));
  if (side === 'm') x = Math.max(ew + 8, Math.min(w - 8, x));
  else x = Math.min(w - ew - 8, Math.max(8, x));
  el.style.left = x + 'px';
  el.style.top = y + 'px';
}

/* ---------- loop ---------- */
let frozen = false;          // QA: freeze the live loop for deterministic probes
/* visibility gate (scroll perf): while the docked stage is scrolled out of
 * view, skip update+render+label layout entirely; the fullscreen live phase
 * is fixed in the viewport so it is always "visible" */
let stageVisible = true;
if ('IntersectionObserver' in window) {
  new IntersectionObserver(([en]) => { stageVisible = en.isIntersecting; },
    { rootMargin: '100px' }).observe(canvas.parentElement);
}
const clock = new THREE.Clock();
function tick() {
  try {
    const dt = Math.min(0.05, clock.getDelta());
    if (!stageVisible) { requestAnimationFrame(tick); return; }
    if (!frozen) {
      updateBout(dt);
      man.mixer && man.mixer.update(dt);
      woman.mixer && woman.mixer.update(dt);
      updateFx(vt !== null ? 0 : dt);
      if (shakeT > 0) shakeT -= dt;
    }
    controls.update();
    const off = shakeOffset();
    if (off) camera.position.add(off);
    renderer.render(scene, camera);
    if (off) camera.position.sub(off);
    placeTag(tagBoxing, man);
    placeTag(tagKick, woman);
    placeMove(moveBoxing, man, 'm');
    placeMove(moveKick, woman, 'w');
    requestAnimationFrame(tick);
  } catch (e) {
    window.__tickErr = String(e && e.stack || e);
    console.error('[ft] tick crashed:', e);
  }
}

/* ---------- boot ---------- */
(async () => {
  try {
    loadingText.textContent = 'Loading the boxer…';
    await man.load('../../media/glb/fight-man.glb?v=3', 'man');
    loadingText.textContent = 'Loading the kickboxer…';
    await woman.load('../../media/glb/woman-all.glb?v=1', 'woman');
    for (const f of [man, woman]) {
      for (const a of Object.values(f.actions)) a.setEffectiveTimeScale(TS);
    }
    loadingEl.hidden = true;
    startBout();
    tick();
  } catch (e) {
    console.error(e);
    loadingEl.hidden = true;
    document.body.classList.remove('ft-live');
    errorEl.textContent = 'Could not load the fighters. Please refresh and try again.';
    errorEl.hidden = false;
  }
})();

replayBtn.addEventListener('click', () => {
  AudioFX.unlock();
  replayBtn.hidden = true;
  stageEl.classList.remove('ft-docked');
  void canvas.clientWidth;
  frameCamera();
  startBout();
});

/* ---------- QA hooks ---------- */
function resetShow() {
  vt = 0;
  clock0 = performance.now();
  fired = []; moves = []; pending = []; done = false;
  resetNudges(); clearFx(); shakeT = 0;
  for (const c of contacts) c.fired = false;
  koEl.classList.remove('on');
  hideMoves();
  const out = homeOut();
  man.baseX = out.m; woman.baseX = out.w;
  man.group.position.set(out.m, 0, 0);
  woman.group.position.set(out.w, 0, 0);
  man.stopAll(); woman.stopAll();
  man.play('guard', { fade: 0 }); woman.play('guard', { fade: 0 });
}
function stepTo(t) {
  resetShow();
  const dt = 1 / 60;
  for (let tt = 0; tt <= t; tt += dt) {
    vt = tt;
    updateBout(dt);
    man.mixer.update(dt);
    woman.mixer.update(dt);
  }
  vt = t;
  for (let i = fxLive.length - 1; i >= 0; i--) {
    if (t - fxLive[i].born > fxLive[i].ttl) {
      scene.remove(fxLive[i].s);
      fxLive[i].s.material.dispose();
      fxLive.splice(i, 1);
    }
  }
  renderer.render(scene, camera);
  placeTag(tagBoxing, man);
  placeTag(tagKick, woman);
  placeMove(moveBoxing, man, 'm');
  placeMove(moveKick, woman, 'w');
}
/* Contact probe: place the fighters at given x positions, play one clip alone
 * (raw 1x speed), and sample the world distance between two bones each frame.
 * Returns the distance series' local minima so HITS fracs/dx can be tuned. */
function probeHit({ who, clip, atkBone, defBone, m, w, dur }) {
  vt = 0; clock0 = performance.now();
  fired = []; moves = []; pending = []; done = false;
  resetNudges(); clearFx(); shakeT = 0;
  for (const c of contacts) c.fired = false;
  man.baseX = m; woman.baseX = w;
  man.group.position.x = m; woman.group.position.x = w;
  man.stopAll(); woman.stopAll();
  man.play('guard', { fade: 0 }); woman.play('guard', { fade: 0 });
  const f = whoOf[who];
  const act = f.actions[clip];
  act.reset().setEffectiveTimeScale(1).setEffectiveWeight(1).play();
  const ba = f.bones[atkBone], bd = (who === 'm' ? woman : man).bones[defBone];
  const pa = new THREE.Vector3(), pd = new THREE.Vector3();
  const out = [];
  const dt = 1 / 60;
  for (let tt = 0; tt <= dur; tt += dt) {
    vt = tt;
    f.mixer.update(dt);
    (who === 'm' ? woman : man).mixer.update(dt);
    ba.getWorldPosition(pa); bd.getWorldPosition(pd);
    out.push({ t: +tt.toFixed(3), d: +pa.distanceTo(pd).toFixed(3) });
  }
  act.stop();
  // local minima below the global start/end noise
  const minima = [];
  for (let i = 2; i < out.length - 2; i++) {
    if (out[i].d < out[i - 1].d && out[i].d <= out[i + 1].d && out[i].d < out[i + 2].d) {
      if (!minima.length || out[i].t - minima[minima.length - 1].t > 0.3) {
        minima.push(out[i]);
      }
    }
  }
  return { minima, min: out.reduce((a, b) => b.d < a.d ? b : a, out[0]) };
}
/* QA: lowest total action weight per fighter — a dip toward 0 is a T-pose
 * flash. Should stay near 1.0 for the whole show. */
function weightScan() {
  resetShow();
  const dt = 1 / 120;
  const sum = (f) => Object.values(f.actions).reduce((s, a) => s + a.getEffectiveWeight(), 0);
  let minM = 9, minW = 9, atM = 0, atW = 0;
  for (let t = 0; t <= END_T + 6.0; t += dt) {
    vt = t;
    updateBout(dt);
    man.mixer.update(dt);
    woman.mixer.update(dt);
    const sm = sum(man), sw = sum(woman);
    if (sm < minM) { minM = sm; atM = t; }
    if (sw < minW) { minW = sw; atW = t; }
  }
  return {
    man: { minW: +minM.toFixed(3), at: +atM.toFixed(2) },
    woman: { minW: +minW.toFixed(3), at: +atW.toFixed(2) },
  };
}
/* QA: step the real show (no render) and sample the world distance between
 * each contact's bones around its scheduled time. Returns the min-distance
 * time + gap per contact so HITS fracs (phase) and dx (residual gap) can be
 * calibrated against the live choreography. */
function sweepContacts() {
  const _v = new THREE.Vector3();
  const results = [];
  for (const c of contacts) {
    // step once to just before the contact window
    resetShow();
    const dt = 1 / 60;
    const t0 = Math.max(0, c.t - 0.5);
    for (let tt = 0; tt <= t0; tt += dt) {
      vt = tt; updateBout(dt);
      man.mixer.update(dt); woman.mixer.update(dt);
    }
    const samples = [];
    for (let tt = t0; tt <= c.t + 0.35; tt += dt) {
      vt = tt; updateBout(dt);
      man.mixer.update(dt); woman.mixer.update(dt);
      const bA = whoOf[c.atk].bones[c.atkBone], bD = whoOf[c.def].bones[c.defBone];
      if (!bA || !bD) continue;
      bA.getWorldPosition(_bpA); bD.getWorldPosition(_bpD);
      samples.push({ t: +tt.toFixed(3), d: +_bpA.distanceTo(_bpD).toFixed(3) });
    }
    if (!samples.length) { results.push({ name: c.hname, err: 'no samples' }); continue; }
    const min = samples.reduce((a, b) => b.d < a.d ? b : a, samples[0]);
    // contact "should" happen at c.t — report the phase offset and residual gap
    results.push({
      name: c.hname, atk: c.atk, schedT: +c.t.toFixed(2),
      minT: min.t, minD: min.d, dAtSched: samples.find(s => s.t >= c.t)?.d ?? null,
    });
  }
  resetShow();
  return results;
}
/* distance curve for one contact (QA): replays up to t-0.6 then samples to clipEnd */
function sweepCurves(names) {
  const dt = 1 / 30;
  const out = {};
  for (const nm of names) {
    const c = contacts.find((x) => x.hname === nm);
    if (!c) { out[nm] = 'missing'; continue; }
    resetShow();
    const t0 = Math.max(0, c.t - 0.6);
    for (let tt = 0; tt <= t0; tt += dt) { vt = tt; updateBout(dt); man.mixer.update(dt); woman.mixer.update(dt); }
    const bA = whoOf[c.atk].bones[c.atkBone], bD = whoOf[c.def].bones[c.defBone];
    const pts = [];
    for (let tt = t0; tt <= c.clipEnd + 0.2; tt += dt) {
      vt = tt; updateBout(dt); man.mixer.update(dt); woman.mixer.update(dt);
      bA.getWorldPosition(_bpA); bD.getWorldPosition(_bpD);
      pts.push([+tt.toFixed(2), +_bpA.distanceTo(_bpD).toFixed(2)]);
    }
    out[nm] = { sched: +c.t.toFixed(2), pts: pts.filter((_, i) => i % 2 === 0) };
  }
  resetShow();
  return out;
}
/* QA: step the show to time t and return both fighters' root x + key bone positions */
function snap(t) {
  const dt = 1 / 60;
  resetShow();
  for (let tt = 0; tt <= t; tt += dt) { vt = tt; updateBout(dt); man.mixer.update(dt); woman.mixer.update(dt); }
  const wp = (b) => { b.updateWorldMatrix(true, false); const e = b.matrixWorld.elements; return [+e[12].toFixed(3), +e[13].toFixed(3), +e[14].toFixed(3)]; };
  const o = {
    t: +t.toFixed(2),
    manX: +man.group.position.x.toFixed(3), manBase: +man.baseX.toFixed(3), manNudge: +man.nudgeX.toFixed(3),
    womanX: +woman.group.position.x.toFixed(3), womanBase: +woman.baseX.toFixed(3), womanNudge: +woman.nudgeX.toFixed(3),
    toeW: wp(woman.bones.RightToeBase), kneeW: wp(woman.bones.RightLeg),
    headM: wp(man.bones.Head), handLW: wp(woman.bones.LeftHand), handRW: wp(woman.bones.RightHand),
    handLM: wp(man.bones.LeftHand), handRM: wp(man.bones.RightHand),
  };
  resetShow();
  return o;
}
/* QA: play one clip on one fighter at raw clip-time and return bone positions */
function poseAt(who, clipName, rawT) {
  const f = whoOf[who];
  f.mixer.stopAllAction();
  const act = f.actions[clipName];
  if (!act) return 'no clip ' + clipName;
  act.reset().setEffectiveTimeScale(1).setEffectiveWeight(1).play();
  f.mixer.setTime(rawT);
  f.group.position.set(f.baseX, 0, 0);
  f.group.updateMatrixWorld(true);
  const wp = (b) => { b.updateWorldMatrix(true, false); const e = b.matrixWorld.elements; return [+e[12].toFixed(3), +e[13].toFixed(3), +e[14].toFixed(3)]; };
  const o = { rawT: +rawT.toFixed(2) };
  for (const bn of ['RightToeBase', 'LeftToeBase', 'RightFoot', 'LeftFoot', 'RightLeg', 'Head', 'Spine2', 'Spine', 'LeftHand', 'RightHand', 'LeftForeArm', 'RightForeArm', 'Hips']) {
    if (f.bones[bn]) o[bn + (who === 'w' ? 'W' : 'M')] = wp(f.bones[bn]);
  }
  act.stop();
  return o;
}
/* QA: current action state of both fighters */function state() {
  const dump = (f) => Object.entries(f.actions)
    .filter(([n, a]) => a.isRunning() || a.getEffectiveWeight() > 0.01)
    .map(([n, a]) => `${n}(t=${a.time.toFixed(2)} w=${a.getEffectiveWeight().toFixed(2)} run=${a.isRunning()} ts=${a.getEffectiveTimeScale().toFixed(2)})`);
  return { man: dump(man), woman: dump(woman) };
}
window.__ft = { man, woman, camera, scene, THREE, contacts, weightScan, stepTo, probeHit, sweepContacts, sweepCurves, snap, poseAt, state, showMove, KO_T, KO_SLAM_T,
  freeze: () => { frozen = true; }, unfreeze: () => { frozen = false; clock.getDelta(); },
  get clock0() { return clock0; } };
