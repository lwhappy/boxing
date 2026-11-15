/** QA: open game.html, click Start, screenshot the character-select screen. */
import fs from 'node:fs';

const PORT = process.env.CDP_PORT || '9333';
const BASE = process.env.BASE || 'http://127.0.0.1:8938';
const OUT = process.env.OUT || '/tmp/select-screen.png';

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
  await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 820, deviceScaleFactor: 1, mobile: false }, sid);
  await send('Page.navigate', { url: `${BASE}/fight/game/` }, sid);
  await sleep(2500);
  const r1 = await send('Runtime.evaluate', { expression: `document.getElementById('startBtn').click(); 'ok'`, returnByValue: true }, sid);
  await sleep(500);
  const r2 = await send('Runtime.evaluate', {
    expression: `JSON.stringify({
      on: [...document.querySelectorAll('#picks .pick')].map(b => ({sex: b.dataset.sex, on: b.classList.contains('on'), imgOk: b.querySelector('img')?.naturalWidth > 0})),
      goDisabled: document.getElementById('goBtn').disabled,
      state: document.getElementById('pickState').textContent,
    })`, returnByValue: true,
  }, sid);
  console.log(r1.result.value, r2.result.value);
  const shot = await send('Page.captureScreenshot', { format: 'png' }, sid);
  fs.writeFileSync(OUT, Buffer.from(shot.data, 'base64'));
  console.log('saved', OUT);
  await send('Target.closeTarget', { targetId });
  process.exit(0);
};
