// QA: simulator page with new sim-man.glb — boot, measure, freeze shots
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
await send('Log.enable', {}, sid);
const errors = [];
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data);
  if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails?.exception?.description || m.params.exceptionDetails?.text || 'unknown');
  if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error') errors.push(m.params.entry.text);
});
const ev = async (expr) => { const r = await send('Runtime.evaluate', { returnByValue: true, expression: expr }, sid); return r.exceptionDetails ? 'EXC ' + JSON.stringify(r.exceptionDetails.exception?.description || '').slice(0, 300) : r.result.value; };
const shot = async (name) => { const s = await send('Page.captureScreenshot', { format: 'png' }, sid); fs.writeFileSync(`${import.meta.dirname}/captures/sim_${name}.png`, Buffer.from(s.data, 'base64')); };

await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false }, sid);
await send('Page.navigate', { url: 'http://127.0.0.1:8945/training/simulator/' }, sid);
await sleep(10000);

const info = await ev(`(() => {
  const S = window.__sim;
  if (!S) return JSON.stringify({ err: 'no __sim' });
  const ids = ['jab','cross','lead-hook','rear-hook','lead-uppercut','rear-uppercut','elbow','knee','jab-cross','combo1','combo2-knee','combo2-elbow','kick'];
  const out = {};
  for (const id of ids) {
    const m = S.MEASURE[id];
    out[id] = m ? [ +m.dur.toFixed(2), +m.impact.toFixed(2), +(m.reach||0).toFixed(2), m.hits.length ] : null;
  }
  return JSON.stringify({ bag: S.BAG, moves: out });
})()`);
console.log('MEASURE:', info);

fs.mkdirSync(`${import.meta.dirname}/captures`, { recursive: true });
for (const id of ['jab','cross','lead-hook','rear-hook','lead-uppercut','rear-uppercut','elbow','knee','kick','jab-cross','combo1','combo2-knee','combo2-elbow']) {
  const h = await ev(`(() => { try { __sim.holdAt('${id}'); return 'ok'; } catch (e) { return 'ERR ' + e.message; } })()`);
  if (h !== 'ok') { console.log(id, 'HOLD FAIL', h); continue; }
  await sleep(350);
  await shot(id);
  await ev(`__sim.go()`);
  await sleep(150);
  console.log(id, 'shot ok');
}
await ev(`__sim.play('guard', { silent: true, panel: false })`);
await sleep(600);
await shot('guard');

console.log('ERRORS:', errors.length ? errors : 'none');
process.exit(0);
