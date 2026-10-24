/**
 * Is the "down" start a POSE problem or a CAMERA problem?
 * Renders the same animation instants from a fixed canonical side camera,
 * and reports the model world bounding box at each time.
 */
const PORT = process.env.CDP_PORT || '9222';
const URL_ = process.env.URL || 'http://127.0.0.1:8123/combo_jab_cross_hook.html';
const OUT = process.env.OUT || '/tmp/animcam';
const TIMES = (process.env.TIMES || '0,0.25,0.5,1.0,2.0,3.0').split(',').map(Number);

import fs from 'node:fs';
fs.mkdirSync(OUT, { recursive: true });

const ver = await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json();
const ws = new WebSocket(ver.webSocketDebuggerUrl);
let idc = 0;
const pending = new Map();
const send = (method, params = {}, sessionId) => {
  const id = ++idc;
  const msg = { id, method, params };
  if (sessionId) msg.sessionId = sessionId;
  ws.send(JSON.stringify(msg));
  return new Promise((res, rej) => pending.set(id, { res, rej }));
};
const errors = [];
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) {
    const { res, rej } = pending.get(m.id);
    pending.delete(m.id);
    m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result);
    return;
  }
  if (m.method === 'Runtime.exceptionThrown') {
    errors.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text);
  }
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

ws.onopen = async () => {
  const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
  const sid = (await send('Target.attachToTarget', { targetId, flatten: true })).sessionId;
  await send('Runtime.enable', {}, sid);
  await send('Page.enable', {}, sid);
  await send('Emulation.setDeviceMetricsOverride', { width: 1200, height: 760, deviceScaleFactor: 1, mobile: false }, sid);
  await send('Page.navigate', { url: URL_ }, sid);
  await sleep(9000);

  // Report the transform state of the model + camera
  const info = await send('Runtime.evaluate', {
    returnByValue: true,
    expression: `(() => {
      const st = window.__comboStage;
      const m = st.model;
      return JSON.stringify({
        modelPos: m.position.toArray().map(v=>+v.toFixed(4)),
        modelRot: [m.rotation.x,m.rotation.y,m.rotation.z].map(v=>+v.toFixed(4)),
        modelScale: m.scale.toArray().map(v=>+v.toFixed(4)),
        camPos: st.camera.position.toArray().map(v=>+v.toFixed(3)),
        camTarget: st.controls.target.toArray().map(v=>+v.toFixed(3)),
        camUp: st.camera.up.toArray().map(v=>+v.toFixed(3)),
        camFov: st.camera.fov,
        modelBox: (()=>{ const b = new (window.__comboStage.mixer.constructor?Object:Object)(); return null; })(),
      });
    })()`,
  }, sid);
  console.log('STATE:', info.result.value);

  for (const t of TIMES) {
    // force the pose at t with a fixed, canonical side camera
    await send('Runtime.evaluate', {
      expression: `(() => {
        const st = window.__comboStage;
        st.mixer.timeScale = 1;
        st.comboAction.reset();
        st.comboAction.play();
        st.mixer.setTime(${t});
        st.mixer.update(0);
        st.model.updateMatrixWorld(true);
        st.mixer.timeScale = 0;   // freeze
        // canonical side view
        st.controls.enabled = false;
        st.camera.position.set(0, 0.55, 3.2);
        st.camera.up.set(0,1,0);
        st.camera.lookAt(0, 0.55, 0);
        st.camera.updateMatrixWorld(true);
        return 1;
      })()`,
      returnByValue: true,
    }, sid);
    await sleep(300);

    const box = await send('Runtime.evaluate', {
      expression: `(() => {
        const st = window.__comboStage;
        st.model.updateMatrixWorld(true);
        const V = st.camera.position.constructor;
        let minX=1e9,maxX=-1e9,minY=1e9,maxY=-1e9,minZ=1e9,maxZ=-1e9;
        st.model.traverse((o)=>{
          if(!o.isMesh||!o.geometry) return;
          const p=o.geometry.attributes&&o.geometry.attributes.position;
          if(!p||!p.count) return;
          const step=Math.max(1,Math.floor(p.count/400));
          const tv=new V();
          for(let i=0;i<p.count;i+=step){
            tv.fromBufferAttribute(p,i);
            if(o.isSkinnedMesh) o.applyBoneTransform(i,tv);
            tv.applyMatrix4(o.matrixWorld);
            if(tv.x<minX)minX=tv.x; if(tv.x>maxX)maxX=tv.x;
            if(tv.y<minY)minY=tv.y; if(tv.y>maxY)maxY=tv.y;
            if(tv.z<minZ)minZ=tv.z; if(tv.z>maxZ)maxZ=tv.z;
          }
        });
        return JSON.stringify({minY:+minY.toFixed(3),maxY:+maxY.toFixed(3),height:+(maxY-minY).toFixed(3),depth:+(maxZ-minZ).toFixed(3),width:+(maxX-minX).toFixed(3)});
      })()`,
      returnByValue: true,
    }, sid);
    console.log('t=' + t, box.result.value);

    const shot = await send('Page.captureScreenshot', { format: 'png' }, sid);
    fs.writeFileSync(`${OUT}/side_t${String(t).replace('.', '_')}.png`, Buffer.from(shot.data, 'base64'));
  }

  if (errors.length) console.log('ERRORS:', errors.slice(0, 5));
  await send('Target.closeTarget', { targetId });
  process.exit(0);
};
