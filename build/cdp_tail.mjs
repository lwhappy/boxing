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
const ev = async (expr) => { const r = await send('Runtime.evaluate', { returnByValue: true, expression: expr }, sid); return r.exceptionDetails ? 'EXC ' + JSON.stringify(r.exceptionDetails).slice(0, 200) : r.result.value; };
await send('Page.navigate', { url: 'http://127.0.0.1:8945/combos/combo_jab_cross_hook.html' }, sid);
await sleep(4500);
console.log(await ev(`(() => {
  const j = __move, f = j.woman, T = j.THREE;
  j.restart();
  const act = f.actions.combo;
  act.reset().setEffectiveTimeScale(1).setEffectiveWeight(1).play();
  const rows = [];
  const p = new T.Vector3(), h = new T.Vector3();
  const th = f.group.rotation.y;
  const fx = Math.sin(th), fz = Math.cos(th);
  for (let i = 0; i <= 40; i++) {
    const t = 3.0 + (j.clipDur - 3.0) * i / 40;
    f.mixer.setTime(Math.min(t, j.clipDur));
    f.mixer.update(0);
    f.root.updateMatrixWorld(true);
    f.bones.Hips.getWorldPosition(p);
    f.bones.RightHand.getWorldPosition(h);
    const fwd = (h.x * fx + h.z * fz).toFixed(2);
    rows.push([t.toFixed(2), 'hipsX=' + p.x.toFixed(2), 'hipsY=' + p.y.toFixed(2), 'handFwd=' + fwd].join(' '));
  }
  f.mixer.stopAllAction();
  return rows.join('\\n');
})()`));
process.exit(0);
