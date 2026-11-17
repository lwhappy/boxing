/* QA the simulator's jab: freeze at its measured impact frame, screenshot,
 * and dump the measured numbers. Usage: node build/cdp_jab.mjs [tag] */
import fs from 'node:fs';

const PORT = process.env.CDP_PORT || '9222';
const URL = process.env.SIM_URL || 'http://127.0.0.1:8943/training/simulator/';
const TAG = process.argv[2] || 'jab';
const W = +(process.env.W || 1280), H = +(process.env.H || 800);
const MOVE = process.env.MOVE || 'jab';

const ver = await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json();
const ws = new WebSocket(ver.webSocketDebuggerUrl);
let idc = 0;
const pending = new Map();
const logs = [];
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
    return;
  }
  if (m.method === 'Runtime.exceptionThrown')
    logs.push('EXC ' + JSON.stringify(m.params.exceptionDetails).slice(0, 300));
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
  await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: false }, sid);
  await send('Page.navigate', { url: URL }, sid);
  await sleep(9000);

  const evalJS = async (expr) => {
    const r = await send('Runtime.evaluate', { returnByValue: true, awaitPromise: true, expression: expr }, sid);
    if (r.exceptionDetails) return 'EXC ' + JSON.stringify(r.exceptionDetails).slice(0, 400);
    return r.result.value;
  };

  console.log('ready:', await evalJS(`!!(window.__sim && window.__rig)`));
  const dump = await evalJS(`(() => { const d = JSON.parse(window.__sim.dump()); const m = d.moves['${MOVE}']; return JSON.stringify({ bag: d.bag, ${MOVE}: m }); })()`);
  console.log('MEASURE:', dump);

  console.log('hold:', await evalJS(`(() => { window.__sim.holdAt('${MOVE}'); const l = document.getElementById('loader'); if (l) l.remove(); return 'ok'; })()`));
  await sleep(2500);
  const shot = await send('Page.captureScreenshot', { format: 'png' }, sid);
  fs.mkdirSync('build/captures', { recursive: true });
  const path = `build/captures/sim_${TAG}.png`;
  fs.writeFileSync(path, Buffer.from(shot.data, 'base64'));
  console.log('shot:', path);
  console.log('view:', await evalJS(`JSON.stringify({ cam: window.__sim.camera.position.toArray().map(n=>+n.toFixed(2)) })`));
  if (logs.length) console.log('errors:', [...new Set(logs)].join(' | ').slice(0, 600));
  process.exit(0);
};
