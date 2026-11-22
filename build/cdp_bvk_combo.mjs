/* QA: contact distances around the finishing combo + frame strip */
import fs from 'node:fs';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
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
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) {
    const { res, rej } = pending.get(m.id);
    pending.delete(m.id);
    m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result);
  }
};
await new Promise((r) => (ws.onopen = r));
const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
const { sessionId: sid } = await send('Target.attachToTarget', { targetId, flatten: true });
await send('Page.enable', {}, sid);
await send('Runtime.enable', {}, sid);
await send('Log.enable', {}, sid);
await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false }, sid);
await send('Page.navigate', { url: 'http://127.0.0.1:8945/training/boxing-vs-kickboxing/?cb=' + Date.now() }, sid);
let ready = false;
for (let i = 0; i < 80; i++) {
  await sleep(250);
  const r = await send('Runtime.evaluate', { expression: `window.__bvk && !!window.__bvk.stepTo`, returnByValue: true }, sid);
  if (r.result.value) { ready = true; break; }
}
console.log('ready:', ready);

const ev = async (expr) => {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true }, sid);
  if (r.exceptionDetails) console.log('ERR', JSON.stringify(r.exceptionDetails.exception?.description || r.exceptionDetails));
  return r.result?.value;
};

console.log('contacts:', JSON.stringify(await ev(`__bvk.contacts.map(c=>({t:+c.t.toFixed(3),atk:c.atk,fx:c.fx,end:+c.clipEnd.toFixed(2)}))`)));
console.log('tickErr:', await ev(`window.__tickErr || null`));

/* measured bone gap for each contact, sampled at the exact contact time */
console.log('gaps:', JSON.stringify(await ev(`(() => {
  const T = __bvk.THREE, vA = new T.Vector3(), vB = new T.Vector3();
  return __bvk.contacts.map(c => {
    __bvk.stepTo(c.t);
    const f = c.atk === 'm' ? __bvk.man : __bvk.woman;
    const g = c.atk === 'm' ? __bvk.woman : __bvk.man;
    const a = f.bones[c.atkBone], b = g.bones[c.defBone];
    a.getWorldPosition(vA); b.getWorldPosition(vB);
    return { t: +c.t.toFixed(2), fx: c.fx, d: +vA.distanceTo(vB).toFixed(3) };
  });
})()`)));

/* frame strip 8.4 -> 12.2 — run BEFORE weightScan (weightScan runs to END_T
 * and leaves the stage docked, which changes the camera framing) */
const T0 = +(process.argv[2] || 8.4), T1 = +(process.argv[3] || 12.2);
const dir = process.argv[4] || '/tmp/bvk_combo';
fs.mkdirSync(dir, { recursive: true });
await ev(`document.querySelector('.bvk-stage').classList.remove('bvk-docked');
      const st=document.createElement('style');
      st.textContent='*{visibility:hidden !important} .bvk-stage,.bvk-stage *{visibility:visible !important} body{background:#05060a}';
      document.head.appendChild(st);
      void document.body.offsetWidth; __bvk.stepTo(${T0})`);
for (let t = T0; t <= T1 + 0.0001; t += 0.1) {
  await ev(`__bvk.stepTo(${t.toFixed(2)})`);
  const shot = await send('Page.captureScreenshot', { format: 'jpeg', quality: 82 }, sid);
  fs.writeFileSync(`${dir}/f${t.toFixed(1).padStart(5, '0')}.jpg`, Buffer.from(shot.data, 'base64'));
}
console.log('weights:', JSON.stringify(await ev(`__bvk.weightScan()`)));
console.log('shots in', dir);
await send('Target.closeTarget', { targetId });
process.exit(0);
