/** Capture a bust portrait of one boxer from the GLB, transparent background.
 *  node build/cdp_portrait.mjs woman [size]
 */
import fs from 'node:fs';

const PORT = process.env.CDP_PORT || '9333';
const BASE = process.env.BASE || 'http://127.0.0.1:8938';
const SEX = process.argv[2] || 'woman';
const SIZE = parseInt(process.argv[3] || '512', 10);
const CLIP = process.env.CLIP || 'guard';
const AT = process.env.AT || '1.0';
const YAW = process.env.YAW || '0';
const VIS = process.env.VIS || '0.30';
const DY = process.env.DY || '0.055';
const OUT = process.env.OUT || `/tmp/portrait-${SEX}.png`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ver = await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json();
const ws = new WebSocket(ver.webSocketDebuggerUrl);
let idc = 0; const pending = new Map();
const send = (m, p = {}, s) => { const id = ++idc; const msg = { id, method: m, params: p }; if (s) msg.sessionId = s; ws.send(JSON.stringify(msg)); return new Promise((res, rej) => pending.set(id, { res, rej })); };
ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { const { res, rej } = pending.get(m.id); pending.delete(m.id); m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result); } };

ws.onopen = async () => {
  const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
  const { sessionId: sid } = await send('Target.attachToTarget', { targetId, flatten: true });
  await send('Page.enable', {}, sid);
  await send('Runtime.enable', {}, sid);
  await send('Emulation.setDeviceMetricsOverride', { width: SIZE, height: SIZE, deviceScaleFactor: 1, mobile: false }, sid);

  const url = `${BASE}/fight/_portrait.html?sex=${SEX}&clip=${CLIP}&t=${AT}&yaw=${YAW}&vis=${VIS}&dy=${DY}&size=${SIZE}`;
  await send('Page.navigate', { url }, sid);
  for (let i = 0; i < 80; i++) {
    await sleep(250);
    const r = await send('Runtime.evaluate', { expression: 'window.__ready === true', returnByValue: true }, sid);
    if (r.result.value === true) break;
  }
  await sleep(400);
  await send('Emulation.setDefaultBackgroundColorOverride', { color: { r: 0, g: 0, b: 0, a: 0 } }, sid);
  const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false, fromSurface: true }, sid);
  fs.writeFileSync(OUT, Buffer.from(shot.data, 'base64'));
  console.log('saved', OUT);
  await send('Target.closeTarget', { targetId });
  process.exit(0);
};
