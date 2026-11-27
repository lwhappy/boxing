/* QA for /sport/kettlebell-swing/ — desktop + mobile screenshots, bell-fit
 * probe across the swing loop, muscle group highlight, overflow + console. */
import fs from 'node:fs';

const ver = await (await fetch('http://127.0.0.1:9222/json/version')).json();
const ws = new WebSocket(ver.webSocketDebuggerUrl);
let idc = 0;
const pending = new Map();
const send = (m, p = {}, s) => {
  const id = ++idc;
  ws.send(JSON.stringify({ id, method: m, params: p, sessionId: s }));
  return new Promise((res) => pending.set(id, res));
};
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id); }
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
await new Promise((r) => (ws.onopen = r));
const { targetInfos } = await send('Target.getTargets');
const page = targetInfos.find((t) => t.type === 'page');
const { sessionId: sid } = await send('Target.attachToTarget', { targetId: page.targetId, flatten: true });
await send('Runtime.enable', {}, sid);
await send('Page.enable', {}, sid);
const logs = [];
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data);
  if (m.method === 'Runtime.consoleAPICalled' && ['error', 'warning'].includes(m.params.type)) {
    logs.push(m.params.args.map((a) => a.value ?? a.description ?? '').join(' ').slice(0, 160));
  }
  if (m.method === 'Runtime.exceptionThrown') logs.push('EXC ' + String(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text).slice(0, 160));
});
const ev = async (expr) => {
  const r = await send('Runtime.evaluate', { returnByValue: true, awaitPromise: true, expression: expr }, sid);
  return r.exceptionDetails ? 'EXC ' + (r.exceptionDetails.exception?.description || '').slice(0, 200) : r.result.value;
};
const shot = async (name) => {
  const s = await send('Page.captureScreenshot', { format: 'png' }, sid);
  fs.writeFileSync(`/Users/justrun/project/boxing-3/build/captures/${name}.png`, Buffer.from(s.data, 'base64'));
};
const out = (k, v) => console.log(k.padEnd(22), v);

/* ---------- desktop ---------- */
await send('Emulation.setDeviceMetricsOverride', { width: 1400, height: 950, deviceScaleFactor: 1, mobile: false }, sid);
await send('Page.navigate', { url: 'http://127.0.0.1:8947/sport/kettlebell-swing/?v=4' }, sid);
await sleep(9000);
out('ready', await ev('typeof window.__kb'));
out('overflow', await ev('document.documentElement.scrollWidth > document.documentElement.clientWidth'));
out('phase', await ev('__kb.phase()'));
out('groups', await ev('__kb.groups.join(",")'));
out('bellFit t=0', await ev('__kb.seekBig(0); __kb.bellFit()'));
out('bellFit t=0.5', await ev('__kb.seekBig(0.5); __kb.bellFit()'));
out('bellFit t=1.0', await ev('__kb.seekBig(1.0); __kb.bellFit()'));
out('bellFit t=1.5', await ev('__kb.seekBig(1.5); __kb.bellFit()'));
out('chips', await ev('document.querySelectorAll(".kb-muscle").length'));
out('callouts', await ev('document.querySelectorAll("#kb-stage-big .hero-callout").length'));
await ev('__kb.seekBig(1.0)');
await sleep(700);
await shot('kb_hero');
await ev('__kb.seekBig(0.35)'); // bottom of the swing (hinge)
await sleep(700);
await shot('kb_hinge');
await ev('__kb.setGroup("glutes")');
await sleep(900);
await shot('kb_glutes');
await ev('__kb.setGroup(null)');
await ev('document.getElementById("kb-stage-small").scrollIntoView({block:"center"})');
await sleep(1200);
await shot('kb_small');

/* ---------- mobile ---------- */
await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true }, sid);
await send('Page.navigate', { url: 'http://127.0.0.1:8947/sport/kettlebell-swing/?v=4m' }, sid);
await sleep(9000);
out('mob overflow', await ev('document.documentElement.scrollWidth > document.documentElement.clientWidth'));
await shot('kb_mobile');
await ev('document.getElementById("kb-stage-small").scrollIntoView({block:"center"})');
await sleep(1200);
await shot('kb_mobile_small');

out('console', logs.length ? logs.join(' | ') : 'clean');
process.exit(0);
