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
const ev = async (expr) => { const r = await send('Runtime.evaluate', { returnByValue: true, expression: expr }, sid); return r.exceptionDetails ? 'EXC ' + JSON.stringify(r.exceptionDetails).slice(0, 200) : r.result.value; };
await send('Page.navigate', { url: 'http://127.0.0.1:8945/combos/combo_jab_cross_hook.html' }, sid);
await sleep(4500);
console.log(await ev(`(() => {
  const j = __move, c = j.camera, T = j.THREE, dt = 1/30;
  j.restart();
  j.stepTo(2.3);
  const q = new T.Quaternion(), p = new T.Vector3(), hips = new T.Vector3();
  const rows = [];
  let prev = null;
  for (let i = 0; i < 50; i++) {
    j.stepTo(j.t + dt);
    c.getWorldPosition(p); c.getWorldQuaternion(q);
    j.woman.bones.Hips.getWorldPosition(hips);
    const sig = [p.x.toFixed(3), p.y.toFixed(3), p.z.toFixed(3), q.x.toFixed(4), q.y.toFixed(4), q.z.toFixed(4), q.w.toFixed(4), hips.x.toFixed(3), hips.y.toFixed(3)].join(',');
    let worst = 0;
    if (prev) {
      const a = sig.split(','), b = prev.split(',');
      for (let k = 0; k < a.length; k++) worst = Math.max(worst, Math.abs(+a[k] - +b[k]));
    }
    rows.push(i + ' ' + j.phase + ' maxDelta=' + worst.toFixed(4));
    prev = sig;
  }
  return rows.join('\\n');
})()`));
process.exit(0);
