import fs from 'node:fs';
const ver = await (await fetch('http://127.0.0.1:9222/json/version')).json();
const ws = new WebSocket(ver.webSocketDebuggerUrl);
let idc = 0; const pending = new Map();
const send = (m, p = {}, s) => { const id = ++idc; ws.send(JSON.stringify({ id, method: m, params: p, sessionId: s })); return new Promise((res) => pending.set(id, res)); };
ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
await new Promise((r) => ws.onopen = r);
const { targetInfos } = await send('Target.getTargets');
const page = targetInfos.find((x) => x.type === 'page');
const { sessionId: sid } = await send('Target.attachToTarget', { targetId: page.targetId, flatten: true });
await send('Runtime.enable', {}, sid);
await send('Page.enable', {}, sid);
const ev = async (expr) => { const r = await send('Runtime.evaluate', { returnByValue: true, expression: expr }, sid); return r.exceptionDetails ? 'EXC ' + JSON.stringify(r.exceptionDetails.exception?.description||'').slice(0,250) : r.result.value; };
const shot = async (name) => { const s = await send('Page.captureScreenshot', { format: 'png' }, sid); fs.writeFileSync(`${import.meta.dirname}/captures/hero_${name}.png`, Buffer.from(s.data, 'base64')); console.log('shot', name); };
await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false }, sid);
await send('Page.navigate', { url: 'http://127.0.0.1:8945/index.html' }, sid);
await sleep(6000);
const info = JSON.parse(await ev(`JSON.stringify({ acts: window.__hero.actions, idx: window.__hero.idx })`));
console.log('actions:', JSON.stringify(info.acts));
// for each action: play it, wait for its freeze (impact/dur seconds + buffer), shot at freeze+callouts
for (let i = 0; i < 4; i++) {
  await ev(`window.__hero.play(${i})`);
  const d = info.acts[i].dur;
  await sleep((d + 0.8) * 1000);       // reach the freeze
  await shot('act' + i);
  await sleep(1500);                    // callouts up
  await shot('act' + i + '_calls');
}
process.exit(0);
