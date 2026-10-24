/**
 * Final check: home page + one combo page render correctly (textured, upright).
 */
const PORT = process.env.CDP_PORT || '9222';
const BASE = process.env.BASE || 'http://127.0.0.1:8123';
const OUT = process.env.OUT || '/tmp/final_shots';
import fs from 'node:fs';
fs.mkdirSync(OUT, { recursive: true });

const ver = await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json();
const ws = new WebSocket(ver.webSocketDebuggerUrl);
let idc = 0; const pending = new Map();
const send = (m, p = {}, s) => { const id = ++idc; const msg = { id, method: m, params: p }; if (s) msg.sessionId = s; ws.send(JSON.stringify(msg)); return new Promise((res, rej) => pending.set(id, { res, rej })); };
ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { const { res, rej } = pending.get(m.id); pending.delete(m.id); m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const SHOTS = [
  { page: 'index.html', name: 'home', wait: 3000 },
  { page: 'combo_jab_cross.html', name: 'combo', wait: 1500 },
];

ws.onopen = async () => {
  for (const s of SHOTS) {
    const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
    const sid = (await send('Target.attachToTarget', { targetId, flatten: true })).sessionId;
    await send('Runtime.enable', {}, sid);
    await send('Page.enable', {}, sid);
    await send('Network.enable', {}, sid);
    await send('Network.setCacheDisabled', { cacheDisabled: true }, sid);
    await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 820, deviceScaleFactor: 1, mobile: false }, sid);
    await send('Page.navigate', { url: `${BASE}/${s.page}` }, sid);
    await sleep(s.wait);
    // Check for console errors
    const err = await send('Runtime.evaluate', {
      expression: `JSON.stringify({err: document.getElementById('stage-error')?.hidden === false ? document.getElementById('stage-error').textContent : null})`,
      returnByValue: true,
    }, sid);
    const shot = await send('Page.captureScreenshot', { format: 'png' }, sid);
    fs.writeFileSync(`${OUT}/${s.name}.png`, Buffer.from(shot.data, 'base64'));
    console.log(`${s.name}.png  ${err.result.value}`);
    await send('Target.closeTarget', { targetId });
  }
  process.exit(0);
};
