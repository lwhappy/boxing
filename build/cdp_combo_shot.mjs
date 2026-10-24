/**
 * Capture frames of the combo page right at/after auto-play to visually verify
 * the character no longer collapses from the floor to standing.
 * Usage: URL=... OUT=/tmp/x node build/cdp_combo_shot.mjs
 */
const PORT = process.env.CDP_PORT || '9222';
const URL_ = process.env.URL || 'http://127.0.0.1:8123/combo_jab_cross_hook.html';
const OUT = process.env.OUT || '/tmp/comboshot';
import fs from 'node:fs';
fs.mkdirSync(OUT, { recursive: true });

const ver = await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json();
const ws = new WebSocket(ver.webSocketDebuggerUrl);
let idc = 0;
const pending = new Map();
const send = (m, p = {}, s) => {
  const id = ++idc; const msg = { id, method: m, params: p };
  if (s) msg.sessionId = s;
  ws.send(JSON.stringify(msg));
  return new Promise((res, rej) => pending.set(id, { res, rej }));
};
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) {
    const { res, rej } = pending.get(m.id);
    pending.delete(m.id);
    m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result);
  }
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

ws.onopen = async () => {
  const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
  const sid = (await send('Target.attachToTarget', { targetId, flatten: true })).sessionId;
  await send('Runtime.enable', {}, sid);
  await send('Page.enable', {}, sid);
  await send('Network.enable', {}, sid);
  await send('Network.setCacheDisabled', { cacheDisabled: true }, sid);
  await send('Emulation.setDeviceMetricsOverride', { width: 1000, height: 640, deviceScaleFactor: 1, mobile: false }, sid);
  await send('Page.navigate', { url: URL_ }, sid);

  const t0 = Date.now();
  while (Date.now() - t0 < 30000) {
    const r = await send('Runtime.evaluate', { expression: '!!window.__comboStage', returnByValue: true }, sid);
    if (r.result && r.result.value === true) break;
    await sleep(80);
  }
  await sleep(200); // settle

  // Grab a burst of frames spanning the 300ms auto-play trigger
  const stamps = [0, 120, 200, 260, 300, 340, 420, 520];
  const base = Date.now();
  for (const s of stamps) {
    const wait = base + s - Date.now();
    if (wait > 0) await sleep(wait);
    const pose = await send('Runtime.evaluate', {
      expression: `(() => {
        const st = window.__comboStage, a = st.comboAction;
        let hips=null, head=null;
        st.model.traverse(o=>{ if(o.isBone&&!hips&&/Hips$/.test(o.name))hips=o; if(o.isBone&&!head&&/Head$/.test(o.name))head=o; });
        const V=b=>b?b.getWorldPosition(new b.position.constructor()):null;
        const hp=V(head), sp=V(hips);
        let up=null; if(hp&&sp){const L=hp.distanceTo(sp); up=L>1e-6?(hp.y-sp.y)/L:null;}
        return JSON.stringify({w:+a.getEffectiveWeight().toFixed(3), actT:+a.time.toFixed(3), headY:+hp.y.toFixed(3), up:up===null?null:+up.toFixed(3)});
      })()`, returnByValue: true,
    }, sid);
    const shot = await send('Page.captureScreenshot', { format: 'png' }, sid);
    const name = `t${String(s).padStart(4, '0')}.png`;
    fs.writeFileSync(`${OUT}/${name}`, Buffer.from(shot.data, 'base64'));
    console.log(`+${String(s).padStart(4)}ms  ${pose.result.value}  -> ${name}`);
  }
  await send('Target.closeTarget', { targetId });
  process.exit(0);
};
