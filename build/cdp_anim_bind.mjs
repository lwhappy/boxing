/**
 * What does the GLB's BIND (rest) pose look like, and where does the
 * animation actually start/end? Renders the bind pose with no mixer at all.
 */
const PORT = process.env.CDP_PORT || '9222';
const URL_ = process.env.URL || 'http://127.0.0.1:8123/combo_jab_cross_hook.html';
const OUT = process.env.OUT || '/tmp/animbind';

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

  // 1) BIND POSE: stop the mixer entirely, restore rest transforms
  const r1 = await send('Runtime.evaluate', {
    returnByValue: true,
    expression: `(() => {
      const st = window.__comboStage;
      st.mixer.stopAllAction();
      st.mixer.uncacheRoot(st.model);
      // restore bind pose manually
      st.model.traverse((o) => {
        if (o.isBone && o.userData && o.userData.boneName) {}
      });
      st.model.updateMatrixWorld(true);
      // report joint world positions (bind pose = no animation applied)
      let hips=null,head=null,foot=null;
      st.model.traverse((o)=>{ if(o.isBone&&!hips&&/Hips$/.test(o.name))hips=o;
                              if(o.isBone&&!head&&/Head$/.test(o.name))head=o;
                              if(o.isBone&&!foot&&/Foot$/.test(o.name))foot=o; });
      const V=(b)=>b?b.getWorldPosition(new b.position.constructor()):null;
      const hp=V(head), sp=V(hips), fp=V(foot);
      let up=null; if(hp&&sp){const dy=hp.y-sp.y; const L=hp.distanceTo(sp); up=L>1e-6?dy/L:null;}
      // also skinned mesh bbox
      return JSON.stringify({
        bindHeadY: hp?+hp.y.toFixed(3):null, bindHipsY: sp?+sp.y.toFixed(3):null, bindFootY: fp?+fp.y.toFixed(3):null,
        bindUp: up===null?null:+up.toFixed(3),
      });
    })()`,
  }, sid);
  console.log('BIND POSE:', r1.result.value);
  await sleep(300);
  let shot = await send('Page.captureScreenshot', { format: 'png' }, sid);
  fs.writeFileSync(`${OUT}/bindpose.png`, Buffer.from(shot.data, 'base64'));

  // 2) Animation weight at the very first update after play()
  const r2 = await send('Runtime.evaluate', {
    returnByValue: true,
    expression: `(() => {
      const st = window.__comboStage;
      const rec = [];
      st.mixer.timeScale = 1;
      st.comboAction.reset();
      st.comboAction.setLoop(2200, 1);
      st.comboAction.clampWhenFinished = false;
      st.comboAction.fadeIn(0.14).play();
      // emulate 5 successive raf updates of 16ms
      for (let i = 0; i < 6; i++) {
        st.mixer.update(0.016);
        rec.push({ i, w: +st.comboAction.getEffectiveWeight().toFixed(4), actT: +st.comboAction.time.toFixed(3) });
      }
      return JSON.stringify(rec);
    })()`,
  }, sid);
  console.log('FADE-IN WEIGHT:', r2.result.value);

  // 3) What is the LAST keyframe of the clip? (end of combo)
  const r3 = await send('Runtime.evaluate', {
    returnByValue: true,
    expression: `(() => {
      const st = window.__comboStage;
      const clip = st.comboAction.getClip();
      const dur = clip.duration;
      const out = [];
      const probe = (t) => {
        st.mixer.timeScale = 1;
        st.comboAction.reset(); st.comboAction.play();
        st.mixer.setTime(t); st.mixer.update(0);
        st.model.updateMatrixWorld(true);
        let hips=null,head=null,foot=null;
        st.model.traverse((o)=>{ if(o.isBone&&!hips&&/Hips$/.test(o.name))hips=o;
                                if(o.isBone&&!head&&/Head$/.test(o.name))head=o;
                                if(o.isBone&&!foot&&/Foot$/.test(o.name))foot=o; });
        const V=(b)=>b?b.getWorldPosition(new b.position.constructor()):null;
        const hp=V(head),sp=V(hips),fp=V(foot);
        let up=null; if(hp&&sp){const L=hp.distanceTo(sp); up=L>1e-6?(hp.y-sp.y)/L:null;}
        return { t:+t.toFixed(3), headY:hp?+hp.y.toFixed(3):null, hipsY:sp?+sp.y.toFixed(3):null,
                 footY:fp?+fp.y.toFixed(3):null, up:up===null?null:+up.toFixed(3) };
      };
      for (const t of [0, 0.05, 0.1, 0.14, 0.2, 0.3, dur-0.05, dur-0.01, dur]) out.push(probe(t));
      return JSON.stringify({ dur:+dur.toFixed(3), probes: out });
    })()`,
  }, sid);
  console.log('PROBES:', r3.result.value);

  if (errors.length) console.log('ERRORS:', errors.slice(0, 5));
  await send('Target.closeTarget', { targetId });
  process.exit(0);
};
