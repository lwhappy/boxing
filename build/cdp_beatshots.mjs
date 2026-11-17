/* Play a combination and stop exactly on each of its beats: report how far the
 * striking point is from the bag surface (mm, + = penetration) and screenshot.
 * Usage: node build/cdp_beatshots.mjs combo2-elbow */
import fs from 'node:fs';

const PORT = '9222';
const URL = 'http://127.0.0.1:8943/training/simulator/';
const MOVE = process.argv[2] || 'combo2-elbow';
const W = 1280, H = 800;

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

/* world position straight out of matrixWorld: no THREE needed in page scope */
const WP = (objExpr, v) => `
  (() => { const e = ${objExpr}.matrixWorld.elements; return [${v}.x = e[12], ${v}.y = e[13], ${v}.z = e[14]]; })()`;

ws.onopen = async () => {
  const { targetInfos } = await send('Target.getTargets');
  const page = targetInfos.find((t) => t.type === 'page');
  const { sessionId: sid } = await send('Target.attachToTarget', { targetId: page.targetId, flatten: true });
  await send('Runtime.enable', {}, sid);
  await send('Page.enable', {}, sid);
  await send('Network.enable', {}, sid);
  await send('Network.setCacheDisabled', { cacheDisabled: true }, sid);
  await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: false }, sid);
  await send('Page.navigate', { url: URL }, sid);
  await sleep(9000);
  const evalJS = async (expr) => {
    const r = await send('Runtime.evaluate', { returnByValue: true, awaitPromise: true, expression: expr }, sid);
    if (r.exceptionDetails) return 'EXC ' + JSON.stringify(r.exceptionDetails).slice(0, 300);
    return r.result.value;
  };
  await evalJS(`(() => { const l = document.getElementById('loader'); if (l) l.remove(); return 'ok'; })()`);
  await sleep(400);

  const beats = JSON.parse(await evalJS(`JSON.stringify(window.__sim.MEASURE[${JSON.stringify(MOVE)}].hits.map(h => ({ t: h.t, bone: h.bone })))`));
  console.log(`${MOVE}: ${beats.length} beats`);
  await evalJS(`(() => { window.__sim.play(${JSON.stringify(MOVE)}); return 'ok'; })()`);

  const clock = () => evalJS(`(() => {
    const S = window.__sim;
    return S.state.action ? +S.state.action.time.toFixed(3) : -1;
  })()`);

  const probe = () => evalJS(`(() => {
    const S = window.__sim, R = window.__rig, B = S.BAG;
    const wp = (o) => { const e = o.matrixWorld.elements; return { x: e[12], y: e[13], z: e[14] }; };
    const d = (p) => Math.round((B.r - Math.hypot(p.x - B.x, p.z - B.z)) * 1000);
    const out = {};
    for (const key of Object.keys(R.hands)) {
      const h = wp(R.hands[key]), f = wp(R.fores[key]);
      const len = Math.hypot(h.x - f.x, h.y - f.y, h.z - f.z) || 1;
      const c = { x: h.x + (h.x - f.x) / len * 0.115, y: h.y + (h.y - f.y) / len * 0.115, z: h.z + (h.z - f.z) / len * 0.115 };
      out[key] = d(c);
    }
    const el = R.joints && (R.joints.RightForeArm || R.joints['RightForeArm']);
    if (el) out.elbowR = d(wp(el));
    return JSON.stringify({ hands: out, rig: [+R.model.position.x.toFixed(3), +R.model.position.z.toFixed(3)] });
  })()`);

  for (const [i, b] of beats.entries()) {
    for (let guard = 0; guard < 1200; guard++) {
      const t = await clock();
      if (typeof t === 'number' && t >= b.t) break;
      await sleep(10);
    }
    await evalJS(`(() => { window.__rig.mixer.timeScale = 0; return 'ok'; })()`);
    await sleep(140);
    const info = await probe();
    const s = await send('Page.captureScreenshot', { format: 'png' }, sid);
    fs.mkdirSync('build/captures', { recursive: true });
    fs.writeFileSync(`build/captures/beat_${MOVE}_${i}.png`, Buffer.from(s.data, 'base64'));
    console.log(`beat ${i} t=${b.t.toFixed(2)} ${b.bone}: ${info}`);
    await evalJS(`(() => { window.__rig.mixer.timeScale = 1; return 'ok'; })()`);
  }
  process.exit(0);
};
