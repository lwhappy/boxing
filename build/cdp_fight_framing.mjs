/* Framing probe: how much of the stage the two fighters fill, at desktop and
 * phone widths. Reports camera.fov/aspect and the projected bbox in pixels.
 * Usage: node build/cdp_fight_framing.mjs [url] [outPrefix] */
import fs from 'node:fs';
const URL_ = process.argv[2] || 'http://127.0.0.1:8958/training.html';
const OUT = process.argv[3] || '/tmp/framing';
const PORT = process.env.CDP_PORT || '9333';

const ver = await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json();
const ws = new WebSocket(ver.webSocketDebuggerUrl);
let idc = 0; const pending = new Map();
const send = (m, p = {}, s) => {
  const id = ++idc; const msg = { id, method: m, params: p }; if (s) msg.sessionId = s;
  ws.send(JSON.stringify(msg)); return new Promise((res, rej) => pending.set(id, { res, rej }));
};
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) { const { res, rej } = pending.get(m.id); pending.delete(m.id);
    m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result); }
};
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const PROBE = `(async () => {
  const f = window.__fight;
  if (!f || !f.ready) return { ready: false };
  const T = await import('/vendor/three/three.module.min.js');
  const cam = f.camera, canvas = document.getElementById('fight-canvas');
  const rect = canvas.getBoundingClientRect();
  const box = new T.Box3().setFromObject(f.model);
  let minX = 1e9, maxX = -1e9, minY = 1e9, maxY = -1e9;
  const v = new T.Vector3();
  for (let i = 0; i < 8; i++) {
    v.set(i & 1 ? box.max.x : box.min.x,
          i & 2 ? box.max.y : box.min.y,
          i & 4 ? box.max.z : box.min.z).project(cam);
    minX = Math.min(minX, v.x); maxX = Math.max(maxX, v.x);
    minY = Math.min(minY, v.y); maxY = Math.max(maxY, v.y);
  }
  const px = (n) => [Math.round((n + 1) / 2 * rect.width), Math.round((1 - n) / 2 * rect.height)];
  const [x0, y0] = px(minX), [x1, y1] = px(maxX);
  return {
    ready: true,
    stage: [Math.round(rect.width), Math.round(rect.height)],
    aspect: +cam.aspect.toFixed(3),
    fov: +cam.fov.toFixed(2),
    camPos: cam.position.toArray().map(n => +n.toFixed(3)),
    target: f.controls.target.toArray().map(n => +n.toFixed(3)),
    /* projected box in canvas pixels */
    bbox: [x0, y0, x1, y1],
    fillW: +((x1 - x0) / rect.width * 100).toFixed(1),
    fillH: +((y1 - y0) / rect.height * 100).toFixed(1),
    overflow: { left: x0 < 0, right: x1 > rect.width, top: y0 < 0, bottom: y1 > rect.height }
  };
})()`;

ws.onopen = async () => {
  const { targetInfos } = await send('Target.getTargets');
  const t = targetInfos.find(x => x.type === 'page');
  const sid = (await send('Target.attachToTarget', { targetId: t.targetId, flatten: true })).sessionId;
  await send('Runtime.enable', {}, sid);
  await send('Page.enable', {}, sid);
  await send('Network.enable', {}, sid);
  await send('Network.setCacheDisabled', { cacheDisabled: true }, sid);
  const ev = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }, sid);
    if (r.exceptionDetails) return { error: r.exceptionDetails.text + ' ' + (r.exceptionDetails.exception?.description || '') };
    return r.result.value;
  };
  const shot = async (path) => {
    const s = await send('Page.captureScreenshot', { format: 'png' }, sid);
    fs.writeFileSync(path, Buffer.from(s.data, 'base64'));
  };

  const cases = [
    ['desktop', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false }],
    ['iphone', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true }],
    ['narrow', { width: 360, height: 780, deviceScaleFactor: 2, mobile: true }]
  ];

  for (const [name, metrics] of cases) {
    await send('Emulation.setDeviceMetricsOverride', metrics, sid);
    await send('Page.navigate', { url: URL_ }, sid);
    for (let i = 0; i < 300; i++) {
      await sleep(250);
      if (await ev(`!!(window.__fight && window.__fight.ready)`) === true) break;
    }
    await sleep(900);
    const info = await ev(PROBE);
    console.log(name, JSON.stringify(info));
    await shot(`${OUT}-${name}.png`);
  }
  process.exit(0);
};
