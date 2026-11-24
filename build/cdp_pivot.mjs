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
const ev = async (expr) => { const r = await send('Runtime.evaluate', { returnByValue: true, expression: expr }, sid); return r.exceptionDetails ? 'EXC ' + JSON.stringify(r.exceptionDetails.exception?.description || '').slice(0, 300) : r.result.value; };
const shot = async (name) => { const s = await send('Page.captureScreenshot', { format: 'png' }, sid); fs.writeFileSync(`${import.meta.dirname}/captures/pivot_${name}.png`, Buffer.from(s.data, 'base64')); console.log('shot', name); };
await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false }, sid);
await send('Page.navigate', { url: 'http://127.0.0.1:8945/combos/combo_jab_cross_hook.html' }, sid);
await sleep(4500);
// play through to paused
await ev('__move.resume()');
for (let i = 0; i < 16; i++) { await sleep(1000); const ph = await ev('__move.phase'); if (ph === 'paused') break; }
console.log('phase:', await ev('__move.phase'));
const probe = `(() => {
  const j = __move, T = j.THREE;
  const proj = (wp) => { const v = wp.clone().project(j.camera); return [(v.x*0.5+0.5)*innerWidth, (-v.y*0.5+0.5)*innerHeight]; };
  const chest = new T.Vector3(); j.woman.bones.Hips.getWorldPosition(chest); chest.y += 0.55;
  const tgt = j.controls.target;
  return JSON.stringify({
    tgt: [+tgt.x.toFixed(3), +tgt.y.toFixed(3), +tgt.z.toFixed(3)],
    chest: [+chest.x.toFixed(3), +chest.y.toFixed(3), +chest.z.toFixed(3)],
    chestScreen: proj(chest).map(Math.round),
    enabled: j.controls.enabled
  });
})()`;
console.log('before drag:', await ev(probe));
const cx = 640, cy = 400;
await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: cx, y: cy, button: 'left', clickCount: 1, buttons: 1 }, sid);
for (let i = 1; i <= 12; i++) {
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: cx + i * 18, y: cy - i * 4, buttons: 1 }, sid);
  await sleep(30);
}
await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: cx + 216, y: cy - 48, button: 'left', buttons: 0 }, sid);
await sleep(500);
console.log('after drag :', await ev(probe));
await shot('rotated');
process.exit(0);
