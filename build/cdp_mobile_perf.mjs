import fs from 'node:fs';

const PORT = process.env.CDP_PORT || '9333';
const BASE = process.env.BASE || 'http://127.0.0.1:8125/web';
const PAGES = [
  ['index', `${BASE}/index.html`],
  ['move-jab', `${BASE}/moves/jab.html`],
  ['combo', `${BASE}/combos/combo_jab_cross.html`],
  ['training-jab', `${BASE}/training/jab.html`],
  ['fight', `${BASE}/fight.html`]
];
const WAIT = Number(process.env.WAIT_MS || 16000);

const ver = await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json();
const ws = new WebSocket(ver.webSocketDebuggerUrl);
let idc = 0; const pending = new Map(); const logs = [];
const send = (m, p = {}, s) => { const id = ++idc; const msg = { id, method: m, params: p }; if (s) msg.sessionId = s; ws.send(JSON.stringify(msg)); return new Promise((res, rej) => pending.set(id, { res, rej })); };
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) { const { res, rej } = pending.get(m.id); pending.delete(m.id); m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result); return; }
  if (m.method === 'Runtime.exceptionThrown') logs.push('[exception] ' + JSON.stringify(m.params.exceptionDetails).slice(0, 300));
  if (m.method === 'Runtime.consoleAPICalled' && ['error', 'warning', 'log'].includes(m.params.type)) {
    const txt = m.params.args.map(a => a.value ?? a.description ?? '').join(' ');
    if (!/swiftshader|GPU stall/i.test(txt)) logs.push(`[${m.params.type}] ${txt}`.slice(0, 240));
  }
};

ws.onopen = async () => {
  const { targetInfos } = await send('Target.getTargets');
  const t = targetInfos.find(x => x.type === 'page');
  const sid = (await send('Target.attachToTarget', { targetId: t.targetId, flatten: true })).sessionId;
  await send('Runtime.enable', {}, sid); await send('Page.enable', {}, sid);

  const mobile = process.env.MODE !== 'desktop';
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 3, mobile }, sid);
  if (mobile) {
    await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 }, sid);
    await send('Emulation.setUserAgentOverride', { userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1' }, sid);
  }

  for (const [name, url] of PAGES) {
    logs.length = 0;
    await send('Page.navigate', { url }, sid);
    await new Promise(r => setTimeout(r, WAIT));
    const expr = `(() => {
      const c = document.querySelector('canvas');
      const r = c && c.clientWidth ? { cssW: c.clientWidth, cssH: c.clientHeight, bufW: c.width, ratio: +(c.width / c.clientWidth).toFixed(2) } : null;
      const err = document.getElementById('error') || document.getElementById('stage-error') || document.getElementById('fight-error');
      return JSON.stringify({
        canvas: r,
        ready: !!(window.__app && window.__app.ready),
        dpr: window.devicePixelRatio,
        coarse: matchMedia('(pointer: coarse)').matches,
        errText: err && !err.hidden ? (err.textContent || '').slice(0, 80) : ''
      });
    })()`;
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true }, sid);
    console.log(`[${name}]`, r.result.value);
    if (logs.length) console.log('  console:', [...new Set(logs)].join(' | '));
    const shot = await send('Page.captureScreenshot', { format: 'png' }, sid);
    fs.writeFileSync(`/tmp/perf-${name}.png`, Buffer.from(shot.data, 'base64'));
  }
  process.exit(0);
};
