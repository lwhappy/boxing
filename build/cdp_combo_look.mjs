// Screenshot the combos bag page at several moments + probe chrome hit-test.
// Usage: node cdp_combo_look.mjs
import fs from 'node:fs';
const H = '__move';
const ver = await (await fetch('http://127.0.0.1:9222/json/version')).json();
const ws = new WebSocket(ver.webSocketDebuggerUrl);
let idc = 0; const pending = new Map();
const send = (m, p = {}, s) => { const id = ++idc; ws.send(JSON.stringify({ id, method: m, params: p, sessionId: s })); return new Promise((res, rej) => pending.set(id, { res, rej })); };
ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { const { res, rej } = pending.get(m.id); m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
await new Promise((r) => ws.onopen = r);
const { targetInfos } = await send('Target.getTargets');
const page = targetInfos.find((t) => t.type === 'page');
const { sessionId: sid } = await send('Target.attachToTarget', { targetId: page.targetId, flatten: true });
await send('Runtime.enable', {}, sid);
await send('Page.enable', {}, sid);
await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false }, sid);
const ev = async (expr) => { const r = await send('Runtime.evaluate', { returnByValue: true, expression: expr }, sid); return r.exceptionDetails ? 'EXC ' + JSON.stringify(r.exceptionDetails).slice(0, 400) : r.result.value; };
const shot = async (name) => { const s = await send('Page.captureScreenshot', { format: 'png' }, sid); fs.writeFileSync(`${import.meta.dirname}/captures/combo_${name}.png`, Buffer.from(s.data, 'base64')); console.log('shot', name); };
await send('Page.navigate', { url: 'http://127.0.0.1:8945/combos/combo_jab_cross_hook.html' }, sid);
await sleep(5000);
console.log('show-top:', await ev(`document.getElementById('jab-stage').style.getPropertyValue('--show-top')`));
console.log('hit-test@copy:', await ev(`(() => { const el = document.querySelector('.hero-copy h1'); const r = el.getBoundingClientRect(); const hit = document.elementFromPoint(r.left + 10, r.top + r.height / 2); return JSON.stringify({ text: el.textContent, hitTag: hit && (hit.tagName + '.' + hit.className) }); })()`));
await shot('early');
// wait to paused
for (let i = 0; i < 20; i++) { await sleep(1000); const ph = await ev(`${H}.phase`); if (ph === 'paused') break; }
await shot('paused');
console.log('state:', await ev(`JSON.stringify({ phase: ${H}.phase, fighterX: ${H}.fighterX, bagAxis: ${H}.bag.axisX })`));
process.exit(0);
