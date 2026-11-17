/* Count impacts + splash state for a move. Usage: node build/cdp_impact.mjs combo2-elbow */
const PORT = '9222';
const URL = 'http://127.0.0.1:8943/training/simulator/';
const MOVE = process.argv[2] || 'combo2-elbow';

const ver = await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json();
const ws = new WebSocket(ver.webSocketDebuggerUrl);
let idc = 0;
const pending = new Map();
const send = (method, params = {}, sessionId) => {
  const id = ++idc;
  const msg = { id, method, params };
  if (sessionId) msg.sessionId = sessionId;
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
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

ws.onopen = async () => {
  const { targetInfos } = await send('Target.getTargets');
  const page = targetInfos.find((t) => t.type === 'page');
  const { sessionId: sid } = await send('Target.attachToTarget', { targetId: page.targetId, flatten: true });
  await send('Runtime.enable', {}, sid);
  await send('Page.enable', {}, sid);
  await send('Network.enable', {}, sid);
  await send('Network.setCacheDisabled', { cacheDisabled: true }, sid);
  await send('Page.navigate', { url: URL }, sid);
  await sleep(9000);
  const evalJS = async (expr) => {
    const r = await send('Runtime.evaluate', { returnByValue: true, awaitPromise: true, expression: expr }, sid);
    if (r.exceptionDetails) return 'EXC ' + JSON.stringify(r.exceptionDetails).slice(0, 400);
    return r.result.value;
  };
  await evalJS(`(() => { const l = document.getElementById('loader'); if (l) l.remove(); return 'ok'; })()`);
  await sleep(300);

  // instrument: log every impact with the action time + the hydrated hit points
  console.log(await evalJS(`(() => {
    const S = window.__sim;
    window.__imp = [];
    const orig = S.Sound.impact.bind(S.Sound);
    S.Sound.impact = (...a) => { window.__imp.push(+((S.state.action && S.state.action.time) || 0).toFixed(3)); return orig(...a); };
    return 'instrumented; beats=' + JSON.stringify((S.MEASURE[${JSON.stringify(MOVE)}].hits || []).map(h => [+h.t.toFixed(3), h.point ? [+h.point.x.toFixed(2), +h.point.y.toFixed(2), +h.point.z.toFixed(2)] : null]));
  })()`));

  await evalJS(`(() => { window.__sim.play(${JSON.stringify(MOVE)}); return 'ok'; })()`);
  await sleep(6500);
  console.log('impacts at t =', await evalJS(`JSON.stringify(window.__imp)`));
  // is the spray mesh alive right now?
  console.log(await evalJS(`(() => {
    const S = window.__sim; let found = [];
    S.scene.traverse((o) => { if (o.isPoints || (o.material && o.material.transparent && o.geometry && o.geometry.attributes && o.geometry.attributes.position && o.geometry.attributes.position.count > 100 && o.geometry.attributes.position.count < 400)) found.push([o.type, o.geometry.attributes.position.count, o.visible, o.material.opacity]); });
    return JSON.stringify(found);
  })()`));
  process.exit(0);
};
