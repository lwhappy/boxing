// Full look QA for the combos bag page: early / mid-combo / paused / docked.
import fs from 'node:fs';
const H = '__move';
const ver = await (await fetch('http://127.0.0.1:9222/json/version')).json();
const ws = new WebSocket(ver.webSocketDebuggerUrl);
let idc = 0; const pending = new Map();
const send = (m, p = {}, s) => { const id = ++idc; ws.send(JSON.stringify({ id, method: m, params: p, sessionId: s })); return new Promise((res, rej) => pending.set(id, { res, rej })); };
ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { m.error ? Promise.reject(new Error(JSON.stringify(m.error))) : Promise.resolve(m.result).then((r) => pending.get(m.id)?.res?.(r)); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
await new Promise((r) => ws.onopen = r);
const { targetInfos } = await send('Target.getTargets');
const page = targetInfos.find((t) => t.type === 'page');
const { sessionId: sid } = await send('Target.attachToTarget', { targetId: page.targetId, flatten: true });
await send('Runtime.enable', {}, sid);
await send('Page.enable', {}, sid);
await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false }, sid);
const ev = async (expr) => { const r = await send('Runtime.evaluate', { returnByValue: true, expression: expr }, sid); return r.exceptionDetails ? 'EXC ' + JSON.stringify(r.exceptionDetails).slice(0, 400) : r.result.value; };
const shot = async (name) => { const s = await send('Page.captureScreenshot', { format: 'png' }, sid); fs.writeFileSync(`${import.meta.dirname}/captures/combo2_${name}.png`, Buffer.from(s.data, 'base64')); console.log('shot', name); };
await send('Page.navigate', { url: 'http://127.0.0.1:8945/combos/combo_jab_cross_hook.html' }, sid);
await sleep(4500);
console.log('phase:', await ev(`${H}.phase`));
// wait for combo phase then shoot mid-travel
for (let i = 0; i < 15; i++) { await sleep(500); const ph = await ev(`${H}.phase`); if (ph === 'combo') break; }
await sleep(1400); await shot('mid1');
console.log('mid1:', await ev(`JSON.stringify({ fx: ${H}.fighterX.toFixed(2), bag: ${H}.bag.axisX.toFixed(2) })`));
await sleep(1300); await shot('mid2');
console.log('mid2:', await ev(`JSON.stringify({ fx: ${H}.fighterX.toFixed(2), bag: ${H}.bag.axisX.toFixed(2) })`));
for (let i = 0; i < 15; i++) { await sleep(1000); const ph = await ev(`${H}.phase`); if (ph === 'paused') break; }
await shot('paused');
console.log('paused:', await ev(`JSON.stringify({ fx: ${H}.fighterX.toFixed(2), bag: ${H}.bag.axisX.toFixed(2) })`));
// dock
const r = JSON.parse(await ev(`(() => { const b = document.getElementById('jab-close').getBoundingClientRect(); return JSON.stringify({ x: Math.round(b.left + b.width/2), y: Math.round(b.top + b.height/2) }); })()`));
await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: r.x, y: r.y, button: 'left', clickCount: 1 }, sid);
await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: r.x, y: r.y, button: 'left', clickCount: 1 }, sid);
await sleep(2000);
await shot('docked');
console.log('hit-test@copy:', await ev(`(() => { const el = document.querySelector('.hero-copy h1'); const b = el.getBoundingClientRect(); const hit = document.elementFromPoint(b.left + 10, b.top + b.height / 2); return hit && (hit.tagName + ' ' + (hit.className || '')); })()`));
process.exit(0);
