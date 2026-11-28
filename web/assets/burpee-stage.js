/* SilentJab: deterministic 80 m burpee broad-jump teaching stage.
   Physical travel and displayed course progress share the same flight parameter.
   Three endpoint turns are excluded from course distance. No external services. */
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
const $ = id => document.getElementById(id);
const host = $('bp-stage'), canvas = $('bp-canvas');
const clamp = (v,a=0,b=1) => Math.max(a,Math.min(b,v));
const ease = t => (t=clamp(t))*t*(3-2*t);
const CYCLE=5.4, TURN=1.6, LEG=CYCLE*10, TOTAL=4*LEG+3*TURN;
let renderer, scene, camera, controls, athlete, mixer, action;
let time=0, playing=!matchMedia('(prefers-reduced-motion: reduce)').matches, speed=1, view='follow', ready=false;
let oldStamp=0, cameraReset=true, manual=false, gap, routeDot, startLine, state, meta;
const tracks=[];
function line(points,color=0x8c97a6, parent=scene) {
  const o=new THREE.Line(new THREE.BufferGeometry().setFromPoints(points.map(p=>new THREE.Vector3(...p))),new THREE.LineBasicMaterial({color})); parent.add(o); return o;
}
function label(text,x,y,z,width=2,color='#f6e4d8',flat=true) {
  const c=document.createElement('canvas'), ctx=c.getContext('2d');
  ctx.font='700 80px Arial';
  c.width=Math.ceil(ctx.measureText(text).width+36);c.height=112;
  ctx.font='700 80px Arial';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillStyle=color;ctx.fillText(text,c.width/2,59);
  const texture=new THREE.CanvasTexture(c);texture.colorSpace=THREE.SRGBColorSpace;
  const mat=new THREE.MeshBasicMaterial({map:texture,transparent:true,depthWrite:false,side:THREE.DoubleSide});
  const m=new THREE.Mesh(new THREE.PlaneGeometry(width,width*c.height/c.width),mat);m.position.set(x,y,z);
  if(flat)m.rotation.x=-Math.PI/2; scene.add(m);return m;
}
function box(w,h,d,x,y,z,color) {
  const m=new THREE.Mesh(new THREE.BoxGeometry(w,h,d),new THREE.MeshStandardMaterial({color,roughness:.94}));m.position.set(x,y,z);m.receiveShadow=true;scene.add(m);return m;
}
function buildLane() {
  box(36,.08,18,10,-.034,0,0x181e28);
  for(let i=0;i<10;i++) {
    const m=box(2,.028,2,i*2+1,-.002,0,i%2?0x35414a:0x2b363f);tracks.push(m);
    label(String(i+1).padStart(2,'0'),i*2+1,.022,-.64,.68,'#b4c3c9');
    if(i>0)box(.023,.01,2,i*2,.018,0,0x76818b);
    label(`${i*2+2} m`,i*2+2,.022,1.3,.75,'#83939f');
  }
  box(20,.015,.04,10,.022,-1,0xd18d55);box(20,.015,.04,10,.022,1,0xd18d55);
  startLine=box(.11,.018,2.3,0,.026,0,0xffd35e);box(.11,.018,2.3,20,.026,0,0xff995e);
  label('START / 0 m',-.75,.028,-1.7,2.4,'#ffb78c');
  label('TURN / 20 m',20.1,.028,-1.7,2.8,'#ffb78c');
  // Dimension extension lines start at the exact two lane boundaries.
  line([[0,.036,1.05],[0,.036,2.6]],0xd6b18e);
  line([[20,.036,1.05],[20,.036,2.6]],0xd6b18e);
  line([[0,.036,2.35],[20,.036,2.35]],0xd6b18e);
  for(const [x,sg] of [[0,1],[20,-1]]) {
    line([[x+sg*.35,.036,2.19],[x,.036,2.35],[x+sg*.35,.036,2.51]],0xffb784);
  }
  label('20 m',10,.05,2.76,2.8,'#ffd0a7');
  label('BURPEE BROAD JUMPS',10,.025,-3.0,8,'#647280');
  label('04 / 80 m',10,.024,-4,3.5,'#6f7e8b');
  for(const x of [-1.25,21.25])for(const z of [-1.5,1.5]) {
    const cone=new THREE.Mesh(new THREE.ConeGeometry(.12,.35,20),new THREE.MeshStandardMaterial({color:0xe5844c,roughness:.8}));cone.position.set(x,.175,z);cone.castShadow=true;scene.add(cone);
  }
  gap=new THREE.Group();scene.add(gap);
  line([[0,.06,0],[.3,.06,0]],0xffbb80,gap);
  line([[0,.06,-.1],[0,.06,.1]],0xffbb80,gap);
  line([[.3,.06,-.1],[.3,.06,.1]],0xffbb80,gap);
  // Contact lines extend from the athlete to the dimension ticks.
  line([[0,.025,-.55],[0,.025,.07]],0xffbb80,gap);
  line([[.3,.025,-.55],[.3,.025,.07]],0xffbb80,gap);
  gap.visible=false;
  routeDot=new THREE.Mesh(new THREE.RingGeometry(.23,.27,40),new THREE.MeshBasicMaterial({color:0xffb880,transparent:true,opacity:.36,side:THREE.DoubleSide}));
  routeDot.rotation.x=-Math.PI/2;routeDot.position.y=.034;scene.add(routeDot);
}
// The shoe-centre stays outside the boundary during the about-face.
function sample(t) {
  t=clamp(t,0,TOTAL);
  let rem=t;
  for(let lap=0;lap<4;lap++) {
    const dir=lap%2?-1:1;
    // Lap 1 starts well behind the line: the palms plant clearly BEFORE the
    // yellow start line, never on or past it (palmForward = 0.3).
    const start=lap===0?-.55:(dir===1?-.10:20.10);
    const end=dir===1?20.55:-.55;
    if(rem<=LEG || lap===3) {
      const v=Math.min(rem,LEG), rep=Math.min(9,Math.floor(v/CYCLE));
      const local=v===LEG?CYCLE:v-rep*CYCLE;
      const f=clamp((local-3.9)/(4.52-3.9));
      const from=start+(end-start)*rep/10;
      const x=from+(end-start)/10*f;
      const inLane=dir===1?clamp(x,0,20):20-clamp(x,0,20);
      return {lap,dir,x,local,rep,turn:false,angle:dir===1?Math.PI/2:-Math.PI/2,
        distance:Math.min(80,lap*20+inLane),reps:lap*10+rep+(local>=4.52?1:0),done:t>=TOTAL};
    }
    rem-=LEG;
    if(rem<TURN) {
      const u=ease(rem/TURN), center=end-dir*.225;
      const angle=(dir===1?Math.PI/2:-Math.PI/2)+Math.PI*u;
      return {lap,dir,x:center+Math.sin(angle)*.225,local:0,rep:9,turn:true,angle,
        distance:(lap+1)*20,reps:(lap+1)*10,done:false};
    }
    rem-=TURN;
  }
}
function phase(s) {
  if(s.done)return ['Complete','80 m complete. Four lengths, forty broad jumps.',''];
  if(s.turn)return ['Turn around','Feet beyond the line. Turn before starting the next length.',''];
  const t=s.local;
  if(t<.72)return ['Plant hands','Hinge and place both palms on the floor before the legs move.','down'];
  if(t<1.28)return ['Jump back','Both feet leave the floor together and travel backward; hands stay planted.','down'];
  if(t<1.95)return ['Chest to floor','Bend the elbows; bring the chest and abdomen to the floor.','down'];
  if(t<2.38)return ['Press up','Push through the palms to clear the body from the floor.','up'];
  if(t<2.98)return ['Jump feet in','Jump both feet toward the hands, without crossing the palm line.','up'];
  if(t<=3.16)return ['Feet behind palms','30 cm demonstration gap. Toes stay behind the palm line.','up'];
  if(t<3.90)return ['Load the jump','Lift the hands, send the hips back, then drive through both feet.','forward'];
  if(t<4.52)return ['Broad jump','Travel forward, not straight upward. Both feet take off together.','forward'];
  return ['Land & reset','Land on both feet, soften the knees and prepare the next rep.','forward'];
}
function setView(v) {view=v;manual=false;cameraReset=true;document.querySelectorAll('[data-bp-view]').forEach(b=>{b.classList.toggle('active',b.dataset.bpView===v);b.setAttribute('aria-pressed',String(b.dataset.bpView===v));});}
function updateCamera(s,dt) {
  if(manual){controls.update();return;}
  const mobile=camera.aspect<1.25;
  let target,offset;
  if(view==='overview') {target=new THREE.Vector3(10,0,0);const dist=Math.max(18,14/(Math.tan(THREE.MathUtils.degToRad(20))*camera.aspect));offset=new THREE.Vector3(-.08,.65,.76).normalize().multiplyScalar(dist);}
  else {target=new THREE.Vector3(s.x,.65,0);offset=view==='side'?new THREE.Vector3(0,1.0,mobile?5.8:4.5):new THREE.Vector3(-2.2,2.0,mobile?5.9:4.6);}
  const k=cameraReset?1:1-Math.exp(-dt*6);
  const desired=target.clone().add(offset);
  camera.position.lerp(desired,k);controls.target.lerp(target,k);controls.update();cameraReset=false;
}
function draw(dt=0) {
  if(!ready)return;
  state=sample(time);
  action.time=Math.min(action.getClip().duration-1e-5,state.local);mixer.update(0);
  athlete.position.set(state.x,.022,0);athlete.rotation.y=state.angle;
  // Small two-foot pivot hops make the about-face read as footwork, not sliding.
  if(state.turn) {
    const k=(time-(state.lap*(LEG+TURN)+LEG))/TURN;
    athlete.position.y+=.055*Math.abs(Math.sin(k*Math.PI*4));
  }
  athlete.updateMatrixWorld(true);
  // palms stay under the shoulders for the whole hands-on-floor window
  const L=state.local;
  let ikW=0;
  if(!state.turn&&L>0.62&&L<3.45) ikW=L<0.88?(L-0.62)/0.26:L>3.18?(3.45-L)/0.27:1;
  poseArmsIK(ikW,state.dir);
  gap.visible=!state.turn&&state.local>=2.98&&state.local<=3.16;
  // Yellow start line: extends to both sides and shrinks back while
  // pulsing bright, through the whole first rep — a "hands stay behind
  // this line" reminder that reads from any camera angle.
  if(startLine) {
    const hint=!state.turn&&state.lap===0&&state.rep===0&&state.local<CYCLE;
    const p=hint?Math.pow(Math.sin(((time%.9)/.9)*Math.PI),1.5):0;
    startLine.material.emissive.setHex(0xffe08a);
    startLine.material.emissiveIntensity=hint?p*2.8:0;
    startLine.scale.z=1+p*.8;
  }
  gap.position.set(state.x,.01,.61);gap.rotation.y=state.dir===1?0:Math.PI;
  $('bp-gap-label').hidden=!gap.visible;
  if(gap.visible) {
    const p=new THREE.Vector3(state.x+state.dir*.15,.20,.67).project(camera);
    $('bp-gap-label').style.left=`${clamp((p.x+1)/2,.14,.86)*100}%`;
    $('bp-gap-label').style.top=`${clamp((1-p.y)/2+.14,.59,.68)*100}%`;
  }
  routeDot.position.x=state.x;
  $('bp-distance').textContent=state.distance.toFixed(1);
  $('bp-lap').textContent=`${state.lap+1} / 4`;
  $('bp-reps').textContent=state.reps;
  $('bp-progress').value=time/TOTAL*100;
  const [title,cue,ph]=phase(state);$('bp-phase').textContent=title;$('bp-cue').textContent=cue;
  document.querySelectorAll('[data-bp-phase]').forEach(b=>{b.classList.toggle('active',ph===b.dataset.bpPhase);b.setAttribute('aria-pressed',String(ph===b.dataset.bpPhase));});
  document.querySelectorAll('[data-lap]').forEach(b=>{const i=Number(b.dataset.lap);b.classList.toggle('active',i===state.lap&&!state.done);b.classList.toggle('done',i<state.lap||state.done||state.turn&&i===state.lap);});
  $('bp-play').textContent=state.done?'Replay':playing?'Pause':'Play';
  updateCamera(state,dt);renderer.render(scene,camera);
}
function seek(t) {time=clamp(t,0,TOTAL);playing=false;cameraReset=true;draw();return {...state};}
/* ---------- planted-arm IK: palms under the shoulders ---------- */
/* The clip plants the palms ~20 cm ahead of the shoulders with slanted
 * forearms. While the hands are on the floor, this IK pulls each palm under
 * its shoulder: straight arms in the plank, bent elbows at chest-to-floor.
 * Palm orientation is kept exactly as the clip plants it (flat on the floor). */
let armIK = null;
const _jA = new THREE.Vector3(), _jB = new THREE.Vector3(), _jC = new THREE.Vector3();
const _aS = new THREE.Vector3(), _aB = new THREE.Vector3(), _aT = new THREE.Vector3(), _aE = new THREE.Vector3(),
      _aP = new THREE.Vector3(), _aD = new THREE.Vector3(), _aPole = new THREE.Vector3();
const _aqA = new THREE.Quaternion(), _aqB = new THREE.Quaternion(), _aqC = new THREE.Quaternion(),
      _aqAim = new THREE.Quaternion(), _aRoot = new THREE.Quaternion();
const _abaked = [new THREE.Quaternion(), new THREE.Quaternion(), new THREE.Quaternion()];
const _aik = [new THREE.Quaternion(), new THREE.Quaternion(), new THREE.Quaternion()];
function aimBone(bone, target) {
  bone.getWorldPosition(_jA);
  const ch = bone.children[0];
  if (!ch) return;
  ch.getWorldPosition(_jB);
  _jC.copy(_jB).sub(_jA).normalize();
  _jB.copy(target).sub(_jA).normalize();
  _aqA.setFromUnitVectors(_jC, _jB);
  bone.getWorldQuaternion(_aqB);
  _aqC.copy(_aqA).multiply(_aqB);
  bone.parent.getWorldQuaternion(_aqA).invert();
  _aqAim.copy(_aqA).multiply(_aqC);
  bone.quaternion.copy(_aqAim);
  bone.updateMatrixWorld(true);
}
function buildArmIK() {
  const get = n => athlete.getObjectByName('mixamorig' + n);
  const arm = [get('LeftArm'), get('RightArm')];
  const fore = [get('LeftForeArm'), get('RightForeArm')];
  const hand = [get('LeftHand'), get('RightHand')];
  if (arm.some(b => !b) || fore.some(b => !b) || hand.some(b => !b)) return;
  /* capture the palm-flat hand orientation at a clip frame where both palms
   * rest flat on the floor, stored relative to the athlete root so it follows
   * the shuttle turns */
  action.time = 1.0; mixer.update(0); athlete.updateMatrixWorld(true);
  athlete.getWorldQuaternion(_aRoot);
  const inv = _aRoot.clone().invert();
  const flat = [], zPos = [];
  const v = new THREE.Vector3();
  for (let i = 0; i < 2; i++) {
    const q = hand[i].getWorldQuaternion(new THREE.Quaternion()).premultiply(inv);
    flat.push(q);
    hand[i].getWorldPosition(v);
    zPos.push(v.z);
  }
  armIK = { arm, fore, hand, flat, zPos };
}
function poseArmsIK(w, dir) {
  if (!armIK || w <= 0) return;
  athlete.updateMatrixWorld(true);
  athlete.getWorldQuaternion(_aRoot);
  for (let i = 0; i < 2; i++) {
    const A = armIK.arm[i], F = armIK.fore[i], H = armIK.hand[i];
    _abaked[0].copy(A.quaternion); _abaked[1].copy(F.quaternion); _abaked[2].copy(H.quaternion);
    A.getWorldPosition(_aS); F.getWorldPosition(_aB); H.getWorldPosition(_aP);
    const l1 = _aS.distanceTo(_aB), l2 = _aB.distanceTo(_aP);
    /* captured hand z is useless: the clip plants BOTH palms on the same
     * side. Target the shoulder instead — symmetric by construction. */
    const outward = dir * (i === 0 ? 1 : -1);
    _aT.set(_aS.x + 0.03, 0.085, _aS.z + outward * 0.26); // palm under the shoulder, shoulder-width stance
    _aD.copy(_aT).sub(_aS);
    let d = _aD.length() || 1e-4;
    _aD.divideScalar(d);
    d = Math.min(Math.max(d, Math.abs(l1 - l2) + 0.004), l1 + l2 - 0.004);
    const a = (l1 * l1 - l2 * l2 + d * d) / (2 * d);
    const hh = Math.sqrt(Math.max(0, l1 * l1 - a * a));
    /* pole: elbows flare out to the sides and back, in WORLD axes
     * (travel axis = x, outward = z mirrored by direction) */
    _aPole.set(-dir * 0.35, 0.15, outward * 0.8);
    _aP.copy(_aS).add(_aPole);
    _aPole.copy(_aP).sub(_aS);
    _aPole.addScaledVector(_aD, -_aPole.dot(_aD));
    if (_aPole.lengthSq() < 1e-8) _aPole.set(0, 0, 1).cross(_aD);
    _aPole.normalize();
    _aE.copy(_aS).addScaledVector(_aD, a).addScaledVector(_aPole, hh);
    aimBone(A, _aE);
    aimBone(F, _aT);
    /* palm orientation: the clip's own flat-on-floor orientation */
    _aqB.copy(_aRoot).multiply(armIK.flat[i]);
    H.parent.getWorldQuaternion(_aqA).invert();
    H.quaternion.copy(_aqA).multiply(_aqB);
    _aik[0].copy(A.quaternion); _aik[1].copy(F.quaternion); _aik[2].copy(H.quaternion);
    A.quaternion.copy(_abaked[0]).slerp(_aik[0], w);
    F.quaternion.copy(_abaked[1]).slerp(_aik[1], w);
    H.quaternion.copy(_abaked[2]).slerp(_aik[2], w);
  }
  athlete.updateMatrixWorld(true);
}

async function init() {  renderer=new THREE.WebGLRenderer({canvas,antialias:true,alpha:false,powerPreference:'high-performance'});
  renderer.setPixelRatio(Math.min(devicePixelRatio,1.75));renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFSoftShadowMap;
  renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.2;
  scene=new THREE.Scene();scene.background=new THREE.Color(0x1b222c);scene.fog=new THREE.Fog(0x1b222c,25,65);
  camera=new THREE.PerspectiveCamera(40,1,.05,120);
  controls=new OrbitControls(camera,canvas);controls.enableDamping=true;controls.minDistance=2.5;controls.maxDistance=48;
  controls.enableRotate=false;controls.enablePan=false;
  // Vertical drag must scroll the page, not tilt the camera: pan-y restores
  // native scrolling, and rotation is re-implemented as horizontal-only.
  canvas.style.touchAction='pan-y';
  controls.addEventListener('start',()=>manual=true);
  let drag=false,dragX=0;
  canvas.addEventListener('pointerdown',e=>{if(e.pointerType==='mouse'&&e.button!==0)return;drag=true;dragX=e.clientX;manual=true;});
  addEventListener('pointermove',e=>{
    if(!drag)return;
    const dx=e.clientX-dragX;dragX=e.clientX;
    if(!dx)return;
    const off=camera.position.clone().sub(controls.target);
    const sph=new THREE.Spherical().setFromVector3(off);
    sph.theta-=dx*.006;
    off.setFromSpherical(sph);
    camera.position.copy(controls.target).add(off);
  });
  addEventListener('pointerup',()=>drag=false);
  addEventListener('pointercancel',()=>drag=false);
  scene.add(new THREE.HemisphereLight(0xd4e6ff,0x6f5945,2.4));
  const key=new THREE.DirectionalLight(0xffe5ce,3.4);key.position.set(6,12,6);key.castShadow=true;key.shadow.mapSize.set(2048,2048);key.shadow.camera.left=-25;key.shadow.camera.right=25;key.shadow.camera.top=12;key.shadow.camera.bottom=-12;key.shadow.bias=-.0003;scene.add(key);
  const fill=new THREE.DirectionalLight(0xb3d3ff,1.5);fill.position.set(4,6,-8);scene.add(fill);
  buildLane();
  new ResizeObserver(()=>{renderer.setSize(host.clientWidth,host.clientHeight,false);camera.aspect=host.clientWidth/host.clientHeight;camera.updateProjectionMatrix();cameraReset=true;draw();}).observe(host);
  const [gltf,m]=await Promise.all([new GLTFLoader().loadAsync(new URL('../media/glb/sport-burpee.glb?v=1',import.meta.url).href),fetch(new URL('../media/glb/sport-burpee.clips.json?v=1',import.meta.url)).then(r=>{if(!r.ok)throw new Error('Animation metadata unavailable');return r.json();})]);
  meta=m;athlete=gltf.scene;athlete.scale.setScalar(meta.scale);scene.add(athlete);
  athlete.traverse(o=>{if(o.isMesh){o.castShadow=true;o.receiveShadow=true;o.frustumCulled=false;if(o.isSkinnedMesh)o.normalizeSkinWeights();}});
  mixer=new THREE.AnimationMixer(athlete);
  const clip=gltf.animations.find(c=>c.name===meta.cycle)||gltf.animations[0];if(!clip)throw new Error('No authored animation in model');
  action=mixer.clipAction(clip);action.play();action.paused=true;ready=true;$('bp-loading').hidden=true;
  buildArmIK();
  $('bp-play').onclick=()=>{if(time>=TOTAL)time=0;playing=!playing;draw();};
  $('bp-reset').onclick=()=>{time=0;playing=true;cameraReset=true;manual=false;draw();};
  $('bp-speed').onchange=e=>speed=Number(e.target.value);
  $('bp-progress').oninput=e=>seek(Number(e.target.value)/100*TOTAL);
  document.querySelectorAll('[data-bp-view]').forEach(b=>b.onclick=()=>{setView(b.dataset.bpView);draw();});
  document.querySelectorAll('[data-bp-phase]').forEach(b=>b.onclick=()=>{const s=sample(time);seek(s.lap*(LEG+TURN)+(s.turn?0:s.rep*CYCLE)+({down:1.03,up:3.05,forward:4.19}[b.dataset.bpPhase]));});
  canvas.tabIndex=0;canvas.addEventListener('keydown',e=>{if(e.code==='Space'){e.preventDefault();$('bp-play').click();}});
  window.__bp={seek,setView,sample,phase,scene,athlete,camera,renderer,controls,meta,total:TOTAL,get state(){return {...state,time,playing};},play:()=>{playing=true;},pause:()=>{playing=false;draw();}};
  draw();
  document.addEventListener('visibilitychange',()=>{oldStamp=0;});
  function tick(stamp){requestAnimationFrame(tick);const dt=oldStamp?Math.min(.05,(stamp-oldStamp)/1000):0;oldStamp=stamp;if(document.hidden)return;if(playing){time+=dt*speed;if(time>=TOTAL){if($('bp-loop').checked)time=0;else{time=TOTAL;playing=false;}}}draw(dt);}
  requestAnimationFrame(tick);
}
init().catch(e=>{console.error('[burpee]',e);$('bp-loading').hidden=true;$('bp-error').hidden=false;$('bp-error').textContent='The 3D scene could not load. Please reload or enable WebGL. '+e.message;});
