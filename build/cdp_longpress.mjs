/**
 * QA: long-press must not select the pad arrows or pop a context menu.
 *   node build/cdp_longpress.mjs
 */
import fs from 'node:fs';

const PORT = process.env.CDP_PORT || '9333';
const BASE = process.env.BASE || 'http://127.0.0.1:8945';
const OUT = process.env.OUT || '/tmp/longpress';
fs.mkdirSync(OUT, { recursive: true });

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
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true }, sid);
  await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 }, sid);
  await send('Emulation.setUserAgentOverride', { userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Mobile Safari/537.36' }, sid);
  await send('Page.navigate', { url: `${BASE}/fight/game/?demo=woman&level=1&touch=1` }, sid);
  await sleep(4200);

  const pos = await send('Runtime.evaluate', {
    expression: `(() => { const b = document.querySelector('#dpad button[data-move="fwd"]').getBoundingClientRect();
      return JSON.stringify({ x: Math.round(b.x + b.width / 2), y: Math.round(b.y + b.height / 2) }); })()`,
    returnByValue: true,
  }, sid);
  const p = JSON.parse(pos.result.value);

  // press and hold for 1.4 s, then release
  await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: p.x, y: p.y }] }, sid);
  await sleep(1400);
  await send('Page.captureScreenshot', { format: 'png' }, sid).then((r) => fs.writeFileSync(`${OUT}/held.png`, Buffer.from(r.data, 'base64')));
  const held = await send('Runtime.evaluate', {
    expression: `(() => JSON.stringify({
      sel: String(getSelection() || ''),
      ranges: (getSelection() && getSelection().rangeCount) || 0,
      hasTextNode: document.querySelector('#dpad button[data-move="fwd"]').textContent.trim().length,
      dpadHtml: document.querySelector('#dpad button[data-move="fwd"]').outerHTML,
      active: document.activeElement && document.activeElement.tagName,
    }))()`, returnByValue: true,
  }, sid);
  await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }, sid);
  await sleep(400);

  const after = await send('Runtime.evaluate', {
    expression: `(() => JSON.stringify({ sel: String(getSelection() || ''), ranges: (getSelection() && getSelection().rangeCount) || 0 }))()`,
    returnByValue: true,
  }, sid);
  console.log('held  :', held.result.value);
  console.log('after :', after.result.value);

  await send('Page.captureScreenshot', { format: 'png' }, sid).then((r) => fs.writeFileSync(`${OUT}/after.png`, Buffer.from(r.data, 'base64')));
  await send('Target.closeTarget', { targetId });
  process.exit(0);
};
