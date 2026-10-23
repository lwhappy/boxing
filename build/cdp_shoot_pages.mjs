import fs from 'node:fs';

const PORT = process.env.CDP_PORT || '9333';
const JOBS = [
  { url: 'http://127.0.0.1:8123/web/jab.html', out: '/tmp/boxing-check-jab' },
  { url: 'http://127.0.0.1:8123/web/jab-cross.html', out: '/tmp/boxing-check-jabcross' }
];
const LOAD_WAIT = 14000, STEP_WAIT = 4000;

const ver = await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json();
const ws = new WebSocket(ver.webSocketDebuggerUrl);
let idc = 0; const pending = new Map();
const send = (method, params = {}, sessionId) => { const id = ++idc; const msg = { id, method, params }; if (sessionId) msg.sessionId = sessionId; ws.send(JSON.stringify(msg)); return new Promise((res, rej) => pending.set(id, { res, rej })); };
ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { const { res, rej } = pending.get(m.id); pending.delete(m.id); m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result); } };

ws.onopen = async () => {
  const { targetInfos } = await send('Target.getTargets');
  const t = targetInfos.find(x => x.type === 'page');
  const sid = (await send('Target.attachToTarget', { targetId: t.targetId, flatten: true })).sessionId;
  await send('Runtime.enable', {}, sid); await send('Page.enable', {}, sid);
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false }, sid);

  for (const job of JOBS) {
    await send('Page.navigate', { url: job.url }, sid);
    await new Promise(r => setTimeout(r, LOAD_WAIT));
    let shot = await send('Page.captureScreenshot', { format: 'png' }, sid);
    fs.writeFileSync(job.out + '-initial.png', Buffer.from(shot.data, 'base64'));
    const btnCount = (await send('Runtime.evaluate', { expression: `document.querySelectorAll('#attackbar button').length`, returnByValue: true }, sid)).result.value;
    for (let b = 0; b < btnCount; b++) {
      await send('Runtime.evaluate', { expression: `document.querySelectorAll('#attackbar button')[${b}].click()`, returnByValue: true }, sid);
      await new Promise(rr => setTimeout(rr, STEP_WAIT));
      shot = await send('Page.captureScreenshot', { format: 'png' }, sid);
      fs.writeFileSync(`${job.out}-btn${b}.png`, Buffer.from(shot.data, 'base64'));
    }
    console.log('done', job.out);
  }
  process.exit(0);
};
