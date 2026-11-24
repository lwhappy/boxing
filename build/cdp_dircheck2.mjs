import fs from 'node:fs';
const ver = await (await fetch('http://127.0.0.1:9222/json/version')).json();
const ws = new WebSocket(ver.webSocketDebuggerUrl);
let idc = 0; const pending = new Map();
const send = (m, p = {}, s) => { const id = ++idc; ws.send(JSON.stringify({ id, method: m, params: p, sessionId: s })); return new Promise((res) => pending.set(id, res)); };
ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
await new Promise((r) => ws.onopen = r);
const { targetInfos } = await send('Target.getTargets');
const page = targetInfos.find((t) => t.type === 'page');
const { sessionId: sid } = await send('Target.attachToTarget', { targetId: page.targetId, flatten: true });
await send('Runtime.enable', {}, sid);
await send('Page.enable', {}, sid);
const ev = async (expr) => { const r = await send('Runtime.evaluate', { returnByValue: true, expression: expr }, sid); return r.exceptionDetails ? 'EXC ' + JSON.stringify(r.exceptionDetails.exception?.description || '').slice(0, 300) : r.result.value; };
const shot = async (name) => { const s = await send('Page.captureScreenshot', { format: 'png' }, sid); fs.writeFileSync(`${import.meta.dirname}/captures/pivot_${name}.png`, Buffer.from(s.data, 'base64')); console.log('shot', name); };
await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false }, sid);
await send('Page.navigate', { url: 'http://127.0.0.1:8945/combos/combo_jab_cross_hook.html' }, sid);
await sleep(4500);
// play through to paused
await ev('__move.resume()');
for (let i = 0; i < 16; i++) { await sleep(1000); const ph = await ev('__move.phase'); if (ph === 'paused') break; }
console.log('phase:', await ev('__move.phase'));
const probe = `(() => {
  const j = __move, T = j.THREE;
  j.restart();
  const p = new T.Vector3();
  j.stepTo(0.05); j.woman.bones.Hips.getWorldPosition(p);
  const x0 = p.x, z0 = p.z;
  j.stepTo(j.clipDur); j.woman.bones.Hips.getWorldPosition(p);
  return JSON.stringify({ dx: +(p.x-x0).toFixed(2), dz: +(p.z-z0).toFixed(2) });
})()`;
console.log('travel:', await ev(probe));
process.exit(0);
