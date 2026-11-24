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
const ev = async (expr) => { const r = await send('Runtime.evaluate', { returnByValue: true, expression: expr }, sid); return r.exceptionDetails ? 'EXC ' + JSON.stringify(r.exceptionDetails.exception?.description || '').slice(0, 300) : r.result.value; };
await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false }, sid);
await send('Page.navigate', { url: 'http://127.0.0.1:8945/training/simulator/' }, sid);
await sleep(9000);
const out = await ev(`(() => {
  const R = window.__rig; if (!R) return 'no rig';
  const { mixer, clips, hands, model } = R;
  const wp = (o) => { const e = o.matrixWorld.elements; return [e[12], e[13], e[14]]; };
  mixer.stopAllAction();
  const act = mixer.clipAction(clips.jab);
  act.reset().play(); mixer.setTime(0); mixer.update(0); model.updateMatrixWorld(true);
  const a0 = wp(hands.LeftHand);
  let dx = 0, dy = 0, dz = 0;
  const N = 40;
  for (let i = 1; i <= N; i++) {
    act.time = (clips.jab.duration * i) / N;
    mixer.update(0); model.updateMatrixWorld(true);
    const a = wp(hands.LeftHand);
    dx = Math.max(dx, Math.abs(a[0] - a0[0]));
    dy = Math.max(dy, Math.abs(a[1] - a0[1]));
    dz = Math.max(dz, Math.abs(a[2] - a0[2]));
  }
  act.stop();
  const hp = wp(model.getObjectByName('Hips') || model.getObjectByName('mixamorigHips') || model.getObjectByName('mixamorig:Hips'));
  return JSON.stringify({ dx: +dx.toFixed(2), dy: +dy.toFixed(2), dz: +dz.toFixed(2),
    rigRotY: model.parent ? model.parent.rotation.y : null, modelRotX: model.rotation.x, hipsWorld: hp.map(v => +v.toFixed(2)) });
})()`);
console.log('PROBE:', out);
process.exit(0);
