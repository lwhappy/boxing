/* 追踪移动端画质随时间的变化：同一页面在 t=3s / 9s / 20s 各截一张，
 * 并打印 canvas CSS 尺寸、绘制缓冲尺寸、实际像素比、以及 [perf] 日志。
 * 用法：node build/cdp_quality_trace.mjs [urlPath] [port]
 */
import fs from 'node:fs';

const PORT = process.env.CDP_PORT || '9333';
const BASE = process.env.BASE || 'http://127.0.0.1:8126/web';
const PAGE = process.argv[2] || 'moves/jab.html';
const SHOTS = [3, 9, 20];
const TAG = process.env.TAG || 'q';

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
  if (m.method === 'Runtime.consoleAPICalled') {
    const txt = m.params.args.map((a) => a.value ?? a.description ?? '').join(' ');
    logs.push(`[${m.params.type}] ${txt}`.slice(0, 200));
  }
  if (m.method === 'Runtime.exceptionThrown') {
    logs.push('[exception] ' + JSON.stringify(m.params.exceptionDetails).slice(0, 260));
  }
};

const PROBE = `(() => {
  const c = document.querySelector('canvas');
  if (!c) return JSON.stringify({ canvas: null });
  const cs = getComputedStyle(c);
  return JSON.stringify({
    cssBox: [c.clientWidth, c.clientHeight],
    style: [cs.width, cs.height],
    buffer: [c.width, c.height],
    ratio: +(c.width / Math.max(1, c.clientWidth)).toFixed(2),
    dpr: window.devicePixelRatio,
    cores: navigator.hardwareConcurrency,
    mem: navigator.deviceMemory ?? null
  });
})()`;

ws.onopen = async () => {
  const { targetInfos } = await send('Target.getTargets');
  const t = targetInfos.find((x) => x.type === 'page');
  const sid = (await send('Target.attachToTarget', { targetId: t.targetId, flatten: true })).sessionId;
  await send('Runtime.enable', {}, sid);
  await send('Page.enable', {}, sid);
  await send('Emulation.setDeviceMetricsOverride', {
    width: 390, height: 844, deviceScaleFactor: 3, mobile: true
  }, sid);
  await send('Emulation.setUserAgentOverride', {
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1'
  }, sid);

  const url = `${BASE}/${PAGE}`;
  console.log('== ', url);
  await send('Page.navigate', { url }, sid);

  let last = 0;
  for (const at of SHOTS) {
    await new Promise((r) => setTimeout(r, (at - last) * 1000));
    last = at;
    const probe = await send('Runtime.evaluate', { expression: PROBE, returnByValue: true }, sid);
    console.log(`t=${at}s`, probe.result.value);
    const shot = await send('Page.captureScreenshot', { format: 'png' }, sid);
    fs.writeFileSync(`/tmp/${TAG}-${at}s.png`, Buffer.from(shot.data, 'base64'));
  }
  console.log('--- console ---');
  console.log([...new Set(logs)].slice(0, 25).join('\n') || '(none)');
  process.exit(0);
};
