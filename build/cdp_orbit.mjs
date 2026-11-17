/* QA the simulator's free orbit: drag the mouse in 90 deg steps all the way
 * around, then to both vertical extremes, screenshotting each stop.
 * Usage: node build/cdp_orbit.mjs */
import fs from 'node:fs';

const PORT = process.env.CDP_PORT || '9222';
const URL = process.env.SIM_URL || 'http://127.0.0.1:8943/training/simulator/';
const W = 1280, H = 800;

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
  if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error')
    logs.push('ERR ' + JSON.stringify(m.params.args).slice(0, 200));
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
  const mouse = (type, x, y, extra = {}) =>
    send('Input.dispatchMouseEvent', { type, x, y, button: type === 'mouseMoved' ? 'left' : 'left', buttons: 1, clickCount: 0, ...extra }, sid);

  await evalJS(`(() => { const l = document.getElementById('loader'); if (l) l.remove(); return 'ok'; })()`);
  await sleep(600);

  const shot = async (tag) => {
    const s = await send('Page.captureScreenshot', { format: 'png' }, sid);
    fs.mkdirSync('build/captures', { recursive: true });
    fs.writeFileSync(`build/captures/orbit_${tag}.png`, Buffer.from(s.data, 'base64'));
    const info = await evalJS(`JSON.stringify({ cam: window.__sim.camera.position.toArray().map(n => +n.toFixed(2)) })`);
    console.log(`shot ${tag}:`, info);
  };

  const drag = async (dx, dy, steps = 12) => {
    const x0 = W / 2, y0 = H / 2;
    await mouse('mousePressed', x0, y0, { buttons: 1 });
    for (let i = 1; i <= steps; i++) {
      await mouse('mouseMoved', x0 + (dx * i) / steps, y0 + (dy * i) / steps, { buttons: 1 });
      await sleep(16);
    }
    await mouse('mouseReleased', x0 + dx, y0 + dy, { buttons: 0 });
    await sleep(500);
  };

  await shot('00_start');
  // 0.0055 rad per px -> 90 deg = 285.6 px
  for (const [i, done] of [90, 180, 270, 360].entries()) {
    await drag(286, 0);
    await shot(`${String((done + '').padStart(3, '0'))}_deg`);
  }
  // vertical extremes from the shipped angle
  await evalJS(`(() => { window.__sim.resetView && window.__sim.resetView(); return 'ok'; })()`);
  await evalJS(`(() => { const e = new MouseEvent('dblclick', { bubbles: true }); document.querySelector('canvas').dispatchEvent(e); return 'ok'; })()`);
  await sleep(400);
  await drag(0, -520);
  await shot('low');
  await drag(0, 620);
  await shot('high');
  if (logs.length) console.log('errors:', [...new Set(logs)].join(' | ').slice(0, 800));
  else console.log('errors: none');
  process.exit(0);
};
