/* Probe bone anchors vs time: woman's feet vs man's gloves, man's hands vs woman's head. */
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
await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false }, sid);
await send('Page.navigate', { url: 'http://127.0.0.1:8945/training/boxing-vs-kickboxing/' }, sid);

let ready = false;
for (let i = 0; i < 60; i++) {
  await sleep(300);
  const r = await send('Runtime.evaluate', { expression: `window.__bvk && !!window.__bvk.stepTo`, returnByValue: true }, sid);
  if (r.result.value) { ready = true; break; }
}
console.log('ready:', ready);

// list bone names once
const bones = await send('Runtime.evaluate', {
  expression: `(() => { const out=[]; __bvk.man.group.traverse(o=>{if(o.isBone)out.push(o.name)}); return out.join(','); })()`,
  returnByValue: true,
}, sid);
console.log('man bones:', bones.result.value.slice(0, 400));

const expr = `(() => {
  const f = (name) => {
    for (const fx of ['','mixamorig']) {
      const b = __bvk.woman.group.getObjectByName(fx + name) || __bvk.man.group.getObjectByName(fx + name);
      if (b) return b;
    }
    return null;
  };
  const P = (o) => { const v = new __bvk.THREE.Vector3(); o.getWorldPosition(v); return [v.x, v.y, v.z]; };
  const rows = [];
  const names = ['LeftFoot','RightFoot','LeftHand','RightHand','Head','HeadTop_End','LeftToeBase','RightToeBase'];
  for (let t = 0; t <= 12.0; t += 0.1) {
    __bvk.stepTo(t);
    const d = {};
    for (const n of names) { const b = f(n); if (b) d[n] = P(b); }
    rows.push({ t: +t.toFixed(2), ...d });
  }
  return rows;
})()`;
const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: false }, sid);
fs.writeFileSync('/tmp/bvk/bones.json', JSON.stringify(r.result.value, null, 1));
console.log('rows:', r.result.value.length, 'saved /tmp/bvk/bones.json');
await send('Target.closeTarget', { targetId });
process.exit(0);
