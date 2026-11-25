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
const logs = [];
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data);
  if (m.method === 'Runtime.exceptionThrown') logs.push('exc: ' + (m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text || '').slice(0, 200));
});
const ev = async (expr) => { const r = await send('Runtime.evaluate', { returnByValue: true, expression: expr }, sid); return r.exceptionDetails ? 'EXC ' + (r.exceptionDetails.exception?.description || '').slice(0, 300) : r.result.value; };
const shot = async (name) => { const s = await send('Page.captureScreenshot', { format: 'png' }, sid); fs.writeFileSync(`${import.meta.dirname}/captures/${name}.png`, Buffer.from(s.data, 'base64')); };
await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true }, sid);

for (const [name, url] of [
  ['m_pu_hero', 'http://127.0.0.1:8945/sport/push-up/'],
  ['m_sport_list', 'http://127.0.0.1:8945/sport/'],
  ['m_home', 'http://127.0.0.1:8945/'],
]) {
  await send('Page.navigate', { url }, sid);
  await sleep(8000);
  console.log(name, await ev('JSON.stringify({overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth, nav: !!document.querySelector(".nav, header nav")})'));
  await shot(name);
}
console.log('errors:', logs.length ? logs.join(' | ') : 'none');
process.exit(0);
