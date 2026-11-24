const t = setTimeout(() => { console.log('STUCK'); process.exit(2); }, 30000);
const ver = await (await fetch('http://127.0.0.1:9222/json/version')).json();
const ws = new WebSocket(ver.webSocketDebuggerUrl);
let idc = 0; const pending = new Map();
const send = (m, p = {}, s) => { const id = ++idc; ws.send(JSON.stringify({ id, method: m, params: p, sessionId: s })); return new Promise((res) => pending.set(id, res)); };
ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
await new Promise((r) => ws.onopen = r);
const { targetInfos } = await send('Target.getTargets');
const page = targetInfos.find((x) => x.type === 'page');
const { sessionId: sid } = await send('Target.attachToTarget', { targetId: page.targetId, flatten: true });
await send('Runtime.enable', {}, sid);
await send('Page.enable', {}, sid);
const ev = async (expr) => { const r = await send('Runtime.evaluate', { returnByValue: true, expression: expr }, sid); return r.exceptionDetails ? 'EXC ' + JSON.stringify(r.exceptionDetails.exception?.description||'').slice(0,250) : r.result.value; };
await send('Page.navigate', { url: 'http://127.0.0.1:8945/index.html' }, sid);
await sleep(6000);
console.log(await ev(`JSON.stringify((() => {
  const H = window.__hero, T = H.THREE;
  const model = H.model;
  const q = new T.Quaternion();
  model.getWorldQuaternion(q);
  const fwd = new T.Vector3(0, 0, 1).applyQuaternion(q);      // sculpt local +Z
  const chestPos = new T.Vector3(); model.getWorldPosition(chestPos);
  const cam = H.camera.position;
  const camDir = new T.Vector3().subVectors(chestPos, cam).normalize();
  // punch direction: right-hand displacement jab start -> impact time
  const act = H.actions[0];
  const rh = model.getObjectByName('mixamorig:RightHand') || (() => { let f; model.traverse(o => { if (!f && o.isBone && /RightHand$/.test(o.name)) f = o; }); return f; })();
  const p = new T.Vector3();
  H.mixer.setTime(0); model.updateMatrixWorld(true);
  rh.getWorldPosition(p); const p0 = p.clone();
  H.mixer.setTime(act.impact); model.updateMatrixWorld(true);
  rh.getWorldPosition(p);
  const punch = new T.Vector3().subVectors(p, p0).normalize();
  return {
    yaw: +model.rotation.y.toFixed(2),
    localPlusZ_world: [+fwd.x.toFixed(2), +fwd.z.toFixed(2)],
    camDir_chest: [+camDir.x.toFixed(2), +camDir.z.toFixed(2)],
    punchDir: [+punch.x.toFixed(2), +punch.z.toFixed(2)],
    impact: +act.impact.toFixed(2), dur: +act.dur.toFixed(2)
  };
})())`));
process.exit(0);
