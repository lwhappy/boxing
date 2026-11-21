/* QA for /training/boxing-vs-kickboxing/ — deterministic captures via __bvk.stepTo(t). */
import fs from 'node:fs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const OUT = '/tmp/bvk';
fs.mkdirSync(OUT, { recursive: true });

const ver = await (await fetch('http://127.0.0.1:9333/json/version')).json();
const ws = new WebSocket(ver.webSocketDebuggerUrl);
let idc = 0;
const pending = new Map();
const send = (m, p = {}, s) => {
  const id = ++idc;
  const msg = { id, method: m, params: p };
  if (s) msg.sessionId = s;
  ws.send(JSON.stringify(msg));
  return new Promise((res, rej) => pending.set(id, { res, rej }));
};
const logs = [];
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) {
    const { res, rej } = pending.get(m.id);
    pending.delete(m.id);
    m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result);
  }
  if (m.method === 'Runtime.consoleAPICalled') logs.push(m.params.args.map(a => a.value ?? a.description ?? '').join(' ').slice(0, 200));
  if (m.method === 'Runtime.exceptionThrown') logs.push('EXC: ' + (m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text).slice(0, 300));
};
await new Promise((r) => (ws.onopen = r));

const W = Number(process.argv[2] || 1280), H = Number(process.argv[3] || 900), MOB = process.argv[4] === 'mob';
const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
const { sessionId: sid } = await send('Target.attachToTarget', { targetId, flatten: true });
await send('Page.enable', {}, sid);
await send('Runtime.enable', {}, sid);
await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: MOB ? 2 : 1, mobile: MOB }, sid);
await send('Page.navigate', { url: 'http://127.0.0.1:8945/training/boxing-vs-kickboxing/' }, sid);

let ready = false;
for (let i = 0; i < 60; i++) {
  await sleep(300);
  const r = await send('Runtime.evaluate', { expression: `window.__bvk && !!window.__bvk.stepTo`, returnByValue: true }, sid);
  if (r.result.value) { ready = true; break; }
}
console.log('ready:', ready);

const beats = [[0.8, 'guard'], [1.96, 'kick1-contact'], [2.9, 'stepback'], [4.12, 'flykick-contact'], [5.6, 'landed'], [6.7, 'jab-contact'], [6.9, 'cross-contact'], [8.72, 'uppercut-contact'], [9.4, 'reaction'], [11.3, 'ko-text'], [13.0, 'down']];
for (const [s, name] of beats) {
  await send('Runtime.evaluate', { expression: `window.__bvk.stepTo(${s})`, returnByValue: true }, sid);
  await sleep(150);
  const shot = await send('Page.captureScreenshot', { format: 'png' }, sid);
  fs.writeFileSync(`${OUT}/${MOB ? 'mob-' : ''}${name}.png`, Buffer.from(shot.data, 'base64'));
}
console.log('shots done. console:', logs.slice(0, 4));
await send('Target.closeTarget', { targetId });
process.exit(0);
