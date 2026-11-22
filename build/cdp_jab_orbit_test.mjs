/* One-off: verify orbit works on the docked jab stage. Steps the show to
 * dock, then synthesizes a horizontal mouse drag on the canvas and reports
 * the camera position before/after. */
import fs from 'node:fs';

const PORT = '9222';
const URL = 'http://127.0.0.1:8945/moves/jab.html';
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

  // step the show to the dock (impacts + aftermath end), resume realtime
  await evalJS(`window.__jab.restart()`);
  await evalJS(`window.__jab.resume(); window.__jab.stepTo(9.5)`);
  await sleep(300);
  console.log('phase:', await evalJS(`window.__jab.phase`));

  const before = await evalJS(`(() => { const c = window.__jab.camera; return JSON.stringify(c.position.toArray().map(v => +v.toFixed(3))) })()`);
  console.log('camera before drag:', before);

  // canvas centre, docked stage box
  const box = await evalJS(`(() => { const r = document.getElementById('stage-canvas').getBoundingClientRect(); return JSON.stringify({ x: r.x, y: r.y, w: r.width, h: r.height, touch: getComputedStyle(document.getElementById('stage-canvas')).touchAction }) })()`);
  console.log('canvas box:', box);
  const b = JSON.parse(box);
  const cx = b.x + b.w / 2, cy = b.y + b.h / 2;

  const drag = async () => {
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: cx, y: cy, button: 'left', buttons: 1, clickCount: 1 }, sid);
    for (let i = 1; i <= 12; i++) {
      await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: cx + i * 14, y: cy - i * 3, button: 'left', buttons: 1 }, sid);
      await sleep(16);
    }
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: cx + 168, y: cy - 36, button: 'left', buttons: 0 }, sid);
    await sleep(500); // let damping settle
  };
  await drag();

  const after = await evalJS(`(() => { const c = window.__jab.camera; return JSON.stringify(c.position.toArray().map(v => +v.toFixed(3))) })()`);
  console.log('camera after drag: ', after);
  const moved = JSON.parse(before).some((v, i) => Math.abs(v - JSON.parse(after)[i]) > 0.01);
  console.log(moved ? 'ORBIT OK — camera moved' : 'FAIL — camera did not move');

  // wheel must still scroll the page
  await evalJS(`window.scrollTo(0, 0)`);
  await send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: cx, y: cy, deltaX: 0, deltaY: 400 }, sid);
  await sleep(300);
  console.log('scrollY after wheel over canvas:', await evalJS(`window.scrollY`), '(should be > 0)');

  await evalJS(`window.scrollTo(0, 0)`);
  await sleep(300);
  fs.writeFileSync('build/captures/jabstage_orbit_afterdrag.png',
    Buffer.from((await send('Page.captureScreenshot', { format: 'png' }, sid)).data, 'base64'));
  if (logs.length) console.log('errors:', [...new Set(logs)].join(' | ').slice(0, 600));
  process.exit(0);
};
