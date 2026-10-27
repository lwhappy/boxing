/* Visual + interaction check: framing, impact frame, mouse-drag orbit */
import fs from 'node:fs';
const URL = process.argv[2] || 'http://127.0.0.1:8958/fight.html';
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

ws.onopen = async () => {
  const { targetInfos } = await send('Target.getTargets');
  const t = targetInfos.find(x => x.type === 'page');
  const sid = (await send('Target.attachToTarget', { targetId: t.targetId, flatten: true })).sessionId;
  await send('Runtime.enable', {}, sid);
  await send('Page.enable', {}, sid);
  await send('Network.enable', {}, sid);
  await send('Network.setCacheDisabled', { cacheDisabled: true }, sid);
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false }, sid);
  const ev = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }, sid);
    if (r.exceptionDetails) return { error: r.exceptionDetails.text + ' ' + (r.exceptionDetails.exception?.description || '') };
    return r.result.value;
  };
  const shot = async (path) => {
    const s = await send('Page.captureScreenshot', { format: 'png' }, sid);
    fs.writeFileSync(path, Buffer.from(s.data, 'base64'));
  };

  await send('Page.navigate', { url: URL }, sid);
  for (let i = 0; i < 200; i++) { await sleep(300); if (await ev(`!!(window.__fight&&window.__fight.ready)`) === true) break; }
  await sleep(600);
  await shot('/tmp/fight-idle.png');
  console.log('stage box =', JSON.stringify(await ev(`(() => { const r = document.querySelector('.fight-stage').getBoundingClientRect();
    return [Math.round(r.width), Math.round(r.height)]; })()`)));

  /* impact frame at ~0.4s */
  await ev(`[...document.querySelectorAll('.fight-btn')].find(b=>b.dataset.key==='jab').click(); true`);
  for (let i = 0; i < 200; i++) {
    await sleep(30);
    if (await ev(`window.__fight.effects() > 0`) === true) break;
  }
  await shot('/tmp/fight-hit.png');
  console.log('hit clip times =', JSON.stringify(await ev(`(() => {
    const a = window.__fight.chars.attack.actions['attack-jab'];
    return { attackTime: +a.time.toFixed(3), duration: +a.getClip().duration.toFixed(3) };
  })()`)));

  /* mouse drag → orbit */
  const before = await ev(`(() => { const c = window.__fight.camera;
    return c.position.toArray().map(n => +n.toFixed(3)); })()`);
  const cx = 720, cy = 260;
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: cx, y: cy, button: 'left', clickCount: 1, buttons: 1 }, sid);
  for (let i = 1; i <= 8; i++) {
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: cx + i * 22, y: cy, button: 'left', buttons: 1 }, sid);
    await sleep(30);
  }
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: cx + 176, y: cy, button: 'left', buttons: 0 }, sid);
  await sleep(600);
  const after = await ev(`(() => { const c = window.__fight.camera;
    return c.position.toArray().map(n => +n.toFixed(3)); })()`);
  console.log('orbit drag: before =', JSON.stringify(before), 'after =', JSON.stringify(after),
    'moved =', JSON.stringify(before) !== JSON.stringify(after));
  await shot('/tmp/fight-orbit.png');

  /* mobile */
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true }, sid);
  await sleep(900);
  await shot('/tmp/fight-mobile.png');
  process.exit(0);
};
