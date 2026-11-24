import fs from 'node:fs';
const H = '__move';
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
const ev = async (expr) => { const r = await send('Runtime.evaluate', { returnByValue: true, expression: expr }, sid); return r.exceptionDetails ? 'EXC ' + JSON.stringify(r.exceptionDetails).slice(0, 300) : r.result.value; };
const shot = async (name) => { const s = await send('Page.captureScreenshot', { format: 'png' }, sid); fs.writeFileSync(`${import.meta.dirname}/captures/combo2_${name}.png`, Buffer.from(s.data, 'base64')); console.log('shot', name); };
await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false }, sid);
await send('Page.navigate', { url: 'http://127.0.0.1:8945/combos/combo_jab_cross_hook.html' }, sid);
await sleep(4500);
console.log('plan:', await ev(`JSON.stringify(${H}.plan.map(p => ({ c: p.clip, peak: +p.peakReal.toFixed(2), dur: +p.realDur.toFixed(2) })))`));
// restart deterministically then step through
await ev(`${H}.restart()`);
let t0 = 0;
const peaks = JSON.parse(await ev(`JSON.stringify(${H}.plan.map(p => 0.55 + p.peakReal))`));
let cum = 0.55;
const times = [];
for (const p of JSON.parse(await ev(`JSON.stringify(${H}.plan.map(p => ({peak: p.peakReal, dur: p.realDur})))`))) {
  times.push(cum + p.peak); cum += p.dur + 0.12;
}
for (let i = 0; i < times.length; i++) {
  await ev(`${H}.stepTo(${times[i].toFixed(2)})`);
  await sleep(300);
  await shot('hit' + i);
  console.log('t=' + times[i].toFixed(2), await ev(`JSON.stringify({ fx: ${H}.fighterX.toFixed(2), bag: ${H}.bag.axisX.toFixed(2), ph: ${H}.phase })`));
}
process.exit(0);
