// leadhook replay-transition probe: dock -> Replay -> screenshot frame-0 and
// mid-punch frames; also check console errors and hand trajectory (hook arc).
import fs from 'node:fs';
const slug = process.env.PAGE || 'leadhook';
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
await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false }, sid);
const errors = [];
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data);
  if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails?.exception?.description?.slice(0, 200) || 'exc');
});
const ev = async (expr) => { const r = await send('Runtime.evaluate', { returnByValue: true, expression: expr }, sid); return r.exceptionDetails ? 'EXC ' + JSON.stringify(r.exceptionDetails).slice(0, 200) : r.result.value; };
const shot = async (name) => { const s = await send('Page.captureScreenshot', { format: 'jpeg', quality: 75 }, sid); fs.writeFileSync(`${import.meta.dirname}/captures/lh_${name}.jpg`, Buffer.from(s.data, 'base64')); console.log('shot', name); };
await send('Page.navigate', { url: `http://127.0.0.1:8945/moves/${slug}.html` }, sid);
await sleep(4500);
for (let i = 0; i < 20; i++) { await sleep(1000); if (await ev('__move.phase') === 'paused') break; }
// hand trajectory over the move clip (hook arc sanity)
console.log('traj:', await ev(`(() => {
  const j = __move, T = j.THREE;
  const mixer = j.woman.mixer, act = j.woman.actions[process.env.ACT || 'leadhook'];
  const dur = act.getClip().duration;
  mixer.stopAllAction(); act.reset().play();
  const v = new T.Vector3(), out = [];
  for (let i = 0; i <= 10; i++) {
    mixer.setTime(dur * i / 10);
    j.woman.group.updateMatrixWorld(true);
    j.woman.bones.LeftHand.getWorldPosition(v);
    out.push(i + ':[' + v.x.toFixed(2) + ',' + v.y.toFixed(2) + ',' + v.z.toFixed(2) + ']');
  }
  mixer.stopAllAction();
  return out.join(' ');
})()`));
// dock
const r = JSON.parse(await ev(`(() => { const b = document.getElementById('jab-close').getBoundingClientRect(); return JSON.stringify({ x: Math.round(b.left + b.width/2), y: Math.round(b.top + b.height/2) }); })()`));
await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: r.x, y: r.y, button: 'left', clickCount: 1 }, sid);
await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: r.x, y: r.y, button: 'left', clickCount: 1 }, sid);
await sleep(1500);
// replay from docked
const r2 = JSON.parse(await ev(`(() => { const b = document.getElementById('jab-replay').getBoundingClientRect(); return JSON.stringify({ x: Math.round(b.left + b.width/2), y: Math.round(b.top + b.height/2) }); })()`));
await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: r2.x, y: r2.y, button: 'left', clickCount: 1 }, sid);
await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: r2.x, y: r2.y, button: 'left', clickCount: 1 }, sid);
await sleep(300);
await shot('replay_f0');
await sleep(900);
await shot('replay_mid1');
await sleep(700);
await shot('replay_mid2');
console.log('phase:', await ev('__move.phase'), 'errors:', errors.length ? errors : 'none');
process.exit(0);
