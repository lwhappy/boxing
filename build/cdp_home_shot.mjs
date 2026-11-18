// Homepage screenshot + canvas probe.
// usage: URL=... SHOT=/tmp/x.png WAIT=8000 W=1280 H=800 node cdp_home_shot.mjs
import fs from 'node:fs';

const PORT = process.env.CDP_PORT || '9222';
const URL_ = process.env.URL || 'http://127.0.0.1:8943/';
const SHOT = process.env.SHOT || '/tmp/home.png';
const WAIT = Number(process.env.WAIT || 9000);
const W = Number(process.env.W || 1280);
const H = Number(process.env.H || 800);

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
const logs = [];
let sessionId = null;

ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) {
    const { res, rej } = pending.get(m.id);
    pending.delete(m.id);
    m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result);
    return;
  }
  if (m.method === 'Runtime.consoleAPICalled') {
    logs.push(`[${m.params.type}] ${(m.params.args || []).map((a) => a.value ?? a.description ?? '').join(' ')}`);
  }
  if (m.method === 'Runtime.exceptionThrown') {
    logs.push('[exception] ' + (m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text));
  }
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

ws.onopen = async () => {
  try {
    const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
    sessionId = (await send('Target.attachToTarget', { targetId, flatten: true })).sessionId;
    await send('Runtime.enable', {}, sessionId);
    await send('Page.enable', {}, sessionId);
    await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: false }, sessionId);
    await send('Page.navigate', { url: URL_ }, sessionId);
    await sleep(WAIT);

    if (process.env.EXTRA) {
      const ex = await send('Runtime.evaluate', { expression: fs.readFileSync(process.env.EXTRA, 'utf8'), awaitPromise: true, returnByValue: true }, sessionId);
      console.log('--- extra ---\n' + (typeof ex.result.value === 'string' ? ex.result.value : JSON.stringify(ex.result)));
      await sleep(Number(process.env.AFTER || 600));
    }

    const shot = await send('Page.captureScreenshot', { format: 'png' }, sessionId);
    fs.writeFileSync(SHOT, Buffer.from(shot.data, 'base64'));
    console.log('--- console ---\n' + (logs.slice(0, 30).join('\n') || '(none)'));
    console.log('screenshot:', SHOT);
    if (process.env.KEEP !== '1') await send('Target.closeTarget', { targetId });
    process.exit(0);
  } catch (e) {
    console.log('FATAL', e.message);
    process.exit(1);
  }
};
