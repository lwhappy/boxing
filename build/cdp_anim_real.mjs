/**
 * Record the REAL playback of the combo page: call playCombo(), then capture
 * a screenshot every N ms. This is exactly what the user sees on screen.
 */
const PORT = process.env.CDP_PORT || '9222';
const URL_ = process.env.URL || 'http://127.0.0.1:8123/combo_jab_cross_hook.html';
const OUT = process.env.OUT || '/tmp/animreal';
const FPS = Number(process.env.FPS || 8);
const DURATION = Number(process.env.DURATION || 3.0);
const EVERY = Number(process.env.EVERY || 1); // capture every Nth frame

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

  // restart the combo from the very beginning
  await send('Runtime.evaluate', {
    expression: `(() => {
      const st = window.__comboStage;
      st.mixer.timeScale = 1;
      st.comboAction.reset();
      st.comboAction.setLoop(2200, 1);
      st.comboAction.clampWhenFinished = false;
      st.comboAction.fadeIn(0.14).play();
      window.__t0 = performance.now();
      return 1;
    })()`,
    returnByValue: true,
  }, sid);

  const step = 1000 / FPS;
  const total = Math.round(DURATION * FPS);
  const log = [];
  for (let i = 0; i <= total; i++) {
    if (i % EVERY === 0) {
      const st = await send('Runtime.evaluate', {
        expression: `(() => {
          const st = window.__comboStage;
          const m = st.model, mix = st.mixer;
          let hips=null, head=null, foot=null;
          m.traverse((o)=>{ if(o.isBone&&!hips&&/Hips$/.test(o.name))hips=o;
                              if(o.isBone&&!head&&/Head$/.test(o.name))head=o;
                              if(o.isBone&&!foot&&/Foot$/.test(o.name))foot=o; });
          const V=(b)=>b?b.getWorldPosition(new b.position.constructor()):null;
          const hp=V(head), sp=V(hips), fp=V(foot);
          let up=null; if(hp&&sp){const dx=hp.x-sp.x,dy=hp.y-sp.y,dz=hp.z-sp.z;const L=Math.hypot(dx,dy,dz); up=L>1e-6?dy/L:null;}
          return JSON.stringify({
            t:+(mix.time).toFixed(3),
            actT:+(st.comboAction.time).toFixed(3),
            headY:hp?+hp.y.toFixed(3):null, hipsY:sp?+sp.y.toFixed(3):null, footY:fp?+fp.y.toFixed(3):null,
            up:up===null?null:+up.toFixed(3),
            camY:+st.camera.position.y.toFixed(3),
            camDist:+st.camera.position.distanceTo(st.controls.target).toFixed(3),
          });
        })()`,
        returnByValue: true,
      }, sid);
      if (st.result && st.result.value) log.push(JSON.parse(st.result.value));
    }
    if (i % EVERY === 0) {
      const shot = await send('Page.captureScreenshot', { format: 'png' }, sid);
      const tt = log.length ? log[log.length - 1].t.toFixed(2) : String(i);
      fs.writeFileSync(`${OUT}/f${String(i).padStart(3, '0')}_t${tt}.png`, Buffer.from(shot.data, 'base64'));
    }
    await sleep(step);
  }

  console.log('t      actT    headY   hipsY   footY  up      camY    camDist');
  for (const r of log) {
    console.log(
      String(r.t).padEnd(7) + String(r.actT).padEnd(8) +
      String(r.headY).padEnd(8) + String(r.hipsY).padEnd(8) + String(r.footY).padEnd(8) +
      String(r.up).padEnd(7) + String(r.camY).padEnd(8) + String(r.camDist)
    );
  }
  if (errors.length) console.log('ERRORS:', errors.slice(0, 5));
  await send('Target.closeTarget', { targetId });
  process.exit(0);
};
