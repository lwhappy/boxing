/**
 * Verify every combo page: loads, plays, and never shows the horizontal bind
 * pose (up ≈ 1.0) across the whole clip, including the auto-play start.
 */
const PORT = process.env.CDP_PORT || '9222';
const BASE = process.env.BASE || 'http://127.0.0.1:8123';
const PAGES = (process.env.PAGES || '').split(',').filter(Boolean);
const OUT = process.env.OUT || '/tmp/combo_verify';

const ver = await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json();
const ws = new WebSocket(ver.webSocketDebuggerUrl);
let idc = 0; const pending = new Map();
const send = (m, p = {}, s) => { const id = ++idc; const msg = { id, method: m, params: p }; if (s) msg.sessionId = s; ws.send(JSON.stringify(msg)); return new Promise((res, rej) => pending.set(id, { res, rej })); };
ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { const { res, rej } = pending.get(m.id); pending.delete(m.id); m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const POSE = `(() => {
  const st = window.__comboStage;
  if (!st || !st.comboAction) return null;
  const a = st.comboAction;
  let hips=null, head=null;
  st.model.traverse(o=>{ if(o.isBone&&!hips&&/Hips$/.test(o.name))hips=o; if(o.isBone&&!head&&/Head$/.test(o.name))head=o; });
  const V=b=>b?b.getWorldPosition(new b.position.constructor()):null;
  const hp=V(head), sp=V(hips);
  let up=null; if(hp&&sp){const L=hp.distanceTo(sp); up=L>1e-6?(hp.y-sp.y)/L:null;}
  return { w:+a.getEffectiveWeight().toFixed(3), actT:+a.time.toFixed(3), headY:+hp.y.toFixed(3), up:up===null?null:+up.toFixed(3) };
})()`;

ws.onopen = async () => {
  let allOk = true;
  for (const page of PAGES) {
    const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
    const sid = (await send('Target.attachToTarget', { targetId, flatten: true })).sessionId;
    await send('Runtime.enable', {}, sid);
    await send('Page.enable', {}, sid);
    await send('Network.enable', {}, sid);
    await send('Network.setCacheDisabled', { cacheDisabled: true }, sid);
    await send('Emulation.setDeviceMetricsOverride', { width: 900, height: 600, deviceScaleFactor: 1, mobile: false }, sid);
    await send('Page.navigate', { url: `${BASE}/${page}` }, sid);

    const t0 = Date.now();
    let ready = false;
    while (Date.now() - t0 < 25000) {
      const r = await send('Runtime.evaluate', { expression: '!!window.__comboStage', returnByValue: true }, sid);
      if (r.result && r.result.value === true) { ready = true; break; }
      await sleep(80);
    }
    if (!ready) { console.log(`${page.padEnd(44)} FAIL  (stage never became ready)`); allOk = false; await send('Target.closeTarget', { targetId }); continue; }

    // Sample through the 300ms auto-play + a bit beyond
    let minUp = 1, minW = 1, minHeadY = 99, maxUp = -1, n = 0;
    const s0 = Date.now();
    while (Date.now() - s0 < 900) {
      const r = await send('Runtime.evaluate', { expression: POSE, returnByValue: true }, sid);
      const o = r.result && r.result.value;
      if (o) {
        n++;
        if (o.up !== null) { minUp = Math.min(minUp, o.up); maxUp = Math.max(maxUp, o.up); }
        minW = Math.min(minW, o.w);
        minHeadY = Math.min(minHeadY, o.headY);
      }
      await sleep(30);
    }
    const ok = minUp > 0.9 && minW >= 0.999 && minHeadY > 0.6;
    if (!ok) allOk = false;
    console.log(`${page.padEnd(44)} ${ok ? 'PASS' : 'FAIL'}  samples=${n}  minUp=${minUp.toFixed(3)}  minW=${minW.toFixed(3)}  minHeadY=${minHeadY.toFixed(3)}`);
    await send('Target.closeTarget', { targetId });
  }
  console.log('\n' + (allOk ? 'ALL PAGES PASS' : 'SOME PAGES FAILED'));
  process.exit(allOk ? 0 : 1);
};
