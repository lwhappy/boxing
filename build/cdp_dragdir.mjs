/* QA: which way does the stage move when the cursor drags?
 * "grab the scene" means drag left -> stage moves left, drag down -> stage moves down.
 * Usage: node build/cdp_dragdir.mjs */
import fs from 'node:fs';

const PORT = process.env.CDP_PORT || '9222';
const URL = process.env.SIM_URL || 'http://127.0.0.1:8943/training/simulator/';
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

  const probe = () => evalJS(`(() => {
    const S = window.__sim, R = window.__rig;
    const p = R.model.position;
    return JSON.stringify({
      az: +S.orbit.az.toFixed(3), el: +S.orbit.el.toFixed(3),
      screen: S.proj({ fighter: [p.x, 1.0, p.z], bag: [S.BAG.x, 1.0, S.BAG.z] }),
    });
  })()`);

  const mouse = (type, x, y, buttons) =>
    send('Input.dispatchMouseEvent', { type, x, y, button: 'left', buttons, clickCount: type === 'mousePressed' ? 1 : 0 }, sid);
  const drag = async (dx, dy, steps = 10) => {
    const x0 = 700, y0 = 430;
    await mouse('mousePressed', x0, y0, 1);
    for (let i = 1; i <= steps; i++) {
      await mouse('mouseMoved', x0 + (dx * i) / steps, y0 + (dy * i) / steps, 1);
      await sleep(16);
    }
    await mouse('mouseReleased', x0 + dx, y0 + dy, 0);
    await sleep(450);
  };
  const shot = async (tag) => {
    const s = await send('Page.captureScreenshot', { format: 'png' }, sid);
    fs.mkdirSync('build/captures', { recursive: true });
    fs.writeFileSync(`build/captures/drag_${tag}.png`, Buffer.from(s.data, 'base64'));
  };

  console.log('start  ', await probe());
  await shot('00_start');
  await drag(-220, 0);
  console.log('drag <- ', await probe());
  await shot('01_left');
  await drag(0, 160);
  console.log('drag v  ', await probe());
  await shot('02_down');
  process.exit(0);
};
