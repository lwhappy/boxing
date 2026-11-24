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
const dur = await ev('__move.clipDur');
console.log(await ev(`(() => {
  const j = __move, c = j.camera, dt = 1/30;
  j.restart();
  j.stepTo(${dur} - 0.5);
  const rows = [];
  for (let i = 0; i < 60; i++) {
    j.stepTo(j.t + dt);
    const o = c.position, s = j.woman.group.position;
    rows.push([i, j.phase, +o.x.toFixed(3), +o.y.toFixed(3), +o.z.toFixed(3), +s.x.toFixed(3)].join('|'));
  }
  return rows.join('\\n');
})()`));
process.exit(0);
