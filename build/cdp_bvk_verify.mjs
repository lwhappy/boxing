/* Verify contact residuals after retune: per contact, min 3D bone distance in window. */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ver = await (await fetch('http://127.0.0.1:9333/json/version')).json();
const ws = new WebSocket(ver.webSocketDebuggerUrl);
let idc = 0; const pending = new Map();
const send = (m, p = {}, s) => { const id = ++idc; const msg = { id, method: m, params: p }; if (s) msg.sessionId = s; ws.send(JSON.stringify(msg)); return new Promise((res, rej) => pending.set(id, { res, rej })); };
ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { const { res, rej } = pending.get(m.id); pending.delete(m.id); m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result); } };
await new Promise((r) => (ws.onopen = r));
const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
const { sessionId: sid } = await send('Target.attachToTarget', { targetId, flatten: true });
await send('Page.enable', {}, sid); await send('Runtime.enable', {}, sid);
await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false }, sid);
await send('Page.navigate', { url: 'http://127.0.0.1:8945/training/boxing-vs-kickboxing/' }, sid);
let ready = false;
for (let i = 0; i < 60; i++) { await sleep(300); const r = await send('Runtime.evaluate', { expression: `window.__bvk && !!window.__bvk.stepTo`, returnByValue: true }, sid); if (r.result.value) { ready = true; break; } }
console.log('ready:', ready);
console.log('console:', logsHint());
function logsHint() { return ''; }
const expr = `(() => {
  const bone = (f, n) => f.bones[n];
  const P = (o) => { const v = new __bvk.THREE.Vector3(); o.getWorldPosition(v); return v; };
  const out = [];
  for (const c of __bvk.contacts) {
    let best = null;
    for (let t = c.t - 0.18; t <= c.t + 0.18; t += 1/60) {
      __bvk.stepTo(t);
      const bA = bone(c.atk === 'm' ? __bvk.man : __bvk.woman, c.atkBone);
      const bD = bone(c.def === 'm' ? __bvk.man : __bvk.woman, c.defBone);
      if (!bA || !bD) { best = { err: 'missing bone ' + c.atkBone + '/' + c.defBone }; break; }
      const pa = P(bA), pd = P(bD);
      const d = pa.distanceTo(pd);
      if (!best || d < best.d) best = { t: +t.toFixed(3), d: +d.toFixed(3), dx: +(pd.x - pa.x).toFixed(3), dy: +(pd.y - pa.y).toFixed(3), dz: +(pd.z - pa.z).toFixed(3) };
    }
    out.push({ name: c.atkBone + '->' + c.defBone, ct: +c.t.toFixed(3), best });
  }
  return out;
})()`;
const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: false }, sid);
console.log(JSON.stringify(r.result.value, null, 1));
await send('Target.closeTarget', { targetId }); process.exit(0);
