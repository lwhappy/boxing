/* Freeze right after a given beat and dump the spray system state.
 * Usage: node build/cdp_spray.mjs combo2-elbow 0 */
const PORT = '9222';
const URL = 'http://127.0.0.1:8943/training/simulator/';
const MOVE = process.argv[2] || 'combo2-elbow';
const BEAT = +(process.argv[3] || 0);
const AFTER = 0.08;

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
    if (r.exceptionDetails) return 'EXC ' + JSON.stringify(r.exceptionDetails).slice(0, 300);
    return r.result.value;
  };
  await evalJS(`(() => { const l = document.getElementById('loader'); if (l) l.remove(); return 'ok'; })()`);
  await sleep(300);
  const beat = JSON.parse(await evalJS(`JSON.stringify(window.__sim.MEASURE[${JSON.stringify(MOVE)}].hits[${BEAT}])`));
  await evalJS(`(() => { window.__sim.play(${JSON.stringify(MOVE)}); return 'ok'; })()`);
  for (let i = 0; i < 1200; i++) {
    const t = await evalJS(`window.__sim.state.action ? +window.__sim.state.action.time.toFixed(3) : -1`);
    if (typeof t === 'number' && t >= beat.t + AFTER) break;
    await sleep(8);
  }
  await evalJS(`(() => { window.__rig.mixer.timeScale = 0; return 'ok'; })()`);
  await sleep(60);
  console.log('impact log:', await evalJS(`JSON.stringify(window.__imp || 'n/a')`));
  console.log(await evalJS(`(() => {
    const S = window.__sim;
    let spray = null;
    S.scene.traverse((o) => {
      if (o.isPoints && o.geometry && o.geometry.attributes.position && o.geometry.attributes.position.count === 180) {
        const pos = o.geometry.attributes.position.array;
        let mn = [1e9,1e9,1e9], mx = [-1e9,-1e9,-1e9], n = 0;
        for (let i = 0; i < 180; i++) {
          const x = pos[3*i], y = pos[3*i+1], z = pos[3*i+2];
          if (!isFinite(x)) continue;
          n++;
          mn = [Math.min(mn[0],x),Math.min(mn[1],y),Math.min(mn[2],z)];
          mx = [Math.max(mx[0],x),Math.max(mx[1],y),Math.max(mx[2],z)];
        }
        spray = { visible: o.visible, opacity: +o.material.opacity.toFixed(2), count: n,
                  bbox: { mn: mn.map(v=>+v.toFixed(2)), mx: mx.map(v=>+v.toFixed(2)) }, parent: o.parent && o.parent.type };
      }
    });
    return JSON.stringify({ t: S.state.action && +S.state.action.time.toFixed(3), spray, bag: S.BAG });
  })()`));
  process.exit(0);
};
