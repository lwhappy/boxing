/**
 * Capture the page from navigation, recording the action weight over time.
 * Proves whether the "lying down" start is caused by the fadeIn(0.14)
 * (weight starts at 0 -> the remaining weight is filled by the BIND POSE,
 *  which for this rig is horizontal / lying down).
 */
const PORT = process.env.CDP_PORT || '9222';
const URL_ = process.env.URL || 'http://127.0.0.1:8123/combo_jab_cross_hook.html';
const OUT = process.env.OUT || '/tmp/animboot';

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
  await send('Network.enable', {}, sid);
  // Bypass the HTTP cache so we always measure the code on disk
  await send('Network.setCacheDisabled', { cacheDisabled: true }, sid);
  await send('Emulation.setDeviceMetricsOverride', { width: 1200, height: 760, deviceScaleFactor: 1, mobile: false }, sid);
  await send('Page.navigate', { url: URL_ }, sid);

  // wait until the stage object exists
  const t0 = Date.now();
  let ready = false;
  while (Date.now() - t0 < 30000) {
    const r = await send('Runtime.evaluate', {
      expression: '!!window.__comboStage', returnByValue: true,
    }, sid);
    if (r.result && r.result.value === true) { ready = true; break; }
    await sleep(100);
  }
  console.log('stage ready after', ((Date.now() - t0) / 1000).toFixed(2), 's');
  if (!ready) { console.log('never ready'); process.exit(1); }

  // sample the weight + pose as fast as we can for 1.2 s (covers the 300ms auto-play)
  const rows = [];
  const tStart = Date.now();
  while (Date.now() - tStart < 1200) {
    const r = await send('Runtime.evaluate', {
      expression: `(() => {
        const st = window.__comboStage;
        if (!st) return null;
        const a = st.comboAction;
        let hips=null, head=null;
        st.model.traverse((o)=>{ if(o.isBone&&!hips&&/Hips$/.test(o.name))hips=o;
                                if(o.isBone&&!head&&/Head$/.test(o.name))head=o; });
        const V=(b)=>b?b.getWorldPosition(new b.position.constructor()):null;
        const hp=V(head), sp=V(hips);
        let up=null; if(hp&&sp){const L=hp.distanceTo(sp); up=L>1e-6?(hp.y-sp.y)/L:null;}
        return JSON.stringify({
          w: a ? +a.getEffectiveWeight().toFixed(4) : null,
          actT: a ? +a.time.toFixed(3) : null,
          headY: hp ? +hp.y.toFixed(3) : null,
          up: up===null?null:+up.toFixed(3),
        });
      })()`,
      returnByValue: true,
    }, sid);
    if (r.result && r.result.value) {
      const o = JSON.parse(r.result.value);
      o.ms = Date.now() - tStart;
      rows.push(o);
    }
    await sleep(15);
  }

  console.log('ms     weight   actT    headY   up');
  for (const r of rows) {
    console.log(String(r.ms).padEnd(7) + String(r.w).padEnd(9) + String(r.actT).padEnd(8) + String(r.headY).padEnd(8) + String(r.up));
  }
  if (errors.length) console.log('ERRORS:', errors.slice(0, 3));
  await send('Target.closeTarget', { targetId });
  process.exit(0);
};
