// Capture the combo-bag show at several show-times via __move.stepTo.
// Usage: TIMES=0.9,1.5,2.2,2.9 node build/cdp_bag_shots.mjs [slug] [tag]
import fs from 'node:fs';
const slug = process.argv[2] || 'combo_jab_cross_hook';
const TAG = process.argv[3] || 'bag';
const DIR = process.env.DIR || 'combos';
const times = (process.env.TIMES || '0.9,1.5,2.2,2.9,3.6').split(',').map(Number);
const ver = await (await fetch('http://127.0.0.1:9222/json/version')).json();
const ws = new WebSocket(ver.webSocketDebuggerUrl);
let idc = 0; const pending = new Map();
const send = (m, p = {}, s) => { const id = ++idc; ws.send(JSON.stringify({ id, method: m, params: p, sessionId: s })); return new Promise((res, rej) => pending.set(id, { res, rej })); };
ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { const { res, rej } = pending.get(m.id); pending.delete(m.id); m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
await new Promise((r) => ws.onopen = r);
const { targetInfos } = await send('Target.getTargets');
const page = targetInfos.find((t) => t.type === 'page');
const { sessionId: sid } = await send('Target.attachToTarget', { targetId: page.targetId, flatten: true });
await send('Runtime.enable', {}, sid);
await send('Page.enable', {}, sid);
const ev = async (expr) => { const r = await send('Runtime.evaluate', { returnByValue: true, expression: expr }, sid); return r.exceptionDetails ? 'EXC ' + JSON.stringify(r.exceptionDetails).slice(0, 300) : r.result.value; };
const shot = async (name) => { const s = await send('Page.captureScreenshot', { format: 'png' }, sid); fs.writeFileSync(`${import.meta.dirname}/captures/bag_${TAG}_${name}.png`, Buffer.from(s.data, 'base64')); console.log('shot', name); };

await send('Page.navigate', { url: `http://127.0.0.1:8945/${DIR}/${slug}.html` }, sid);
await sleep(6000);
for (let i = 0; i < 20; i++) {
  const ph = await ev('window.__move && window.__move.phase');
  if (ph && ph !== 'load') break;
  await sleep(500);
}
for (const t of times) {
  await ev(`window.__move.restart(); window.__move.stepTo(${t})`);
  const info = await ev(`JSON.stringify({ phase: __move.phase, fx: __move.fighterX.toFixed(2), bagX: __move.bag.axisX.toFixed(2), hits: __move.lastHitT === undefined ? null : 'n/a' })`);
  console.log(t, info);
  await shot(String(t).replace('.', '_'));
}
// restart into real-time so the page is left in a sane state
await ev('window.__move.restart(); window.__move.resume();');
process.exit(0);
