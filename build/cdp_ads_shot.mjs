/* Native-res crop of each ad banner: scrolls it into view, then screenshots the
 * viewport only. node build/cdp_ads_shot.mjs [url] */
import fs from 'node:fs';
const URL_ = process.argv[2] || 'http://127.0.0.1:8958/index.html';
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
  await send('Network.setCacheDisabled', { cacheDisabled: true }, sid);
  const ev = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }, sid);
    if (r.exceptionDetails) return { error: r.exceptionDetails.exception?.description || r.exceptionDetails.text };
    return r.result.value;
  };
  const shot = async (path) => {
    const s = await send('Page.captureScreenshot', { format: 'png' }, sid);
    fs.writeFileSync(path, Buffer.from(s.data, 'base64'));
  };
  const FAKE = `(() => {
    document.querySelectorAll('.ad-banner').forEach(b => {
      b.classList.remove('is-empty');
      const ins = b.querySelector('ins.adsbygoogle');
      ins.style.height = '100px';
      ins.style.background = 'repeating-linear-gradient(135deg,#242a33,#242a33 12px,#1c2129 12px,#1c2129 24px)';
      ins.textContent = 'ad preview';
      ins.style.color = '#8a94a3';
      ins.style.font = '12px/100px system-ui, sans-serif';
      ins.style.textAlign = 'center';
    });
    return true;
  })()`;

  for (const [name, metrics] of [
    ['desktop', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false }],
    ['mobile', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true }]
  ]) {
    await send('Emulation.setDeviceMetricsOverride', metrics, sid);
    await send('Page.navigate', { url: URL_ }, sid);
    for (let i = 0; i < 160; i++) { await sleep(250); if (await ev(`document.readyState === 'complete'`) === true) break; }
    await sleep(1200);
    await ev(FAKE);
    for (const [i, sel] of [[0, '#moves'], [1, '#combos']]) {
      await ev(`(() => { const b = document.querySelectorAll('.ad-banner')[${i}];
        window.scrollTo(0, b.getBoundingClientRect().top + window.scrollY - 60); return true; })()`);
      await sleep(400);
      await shot(`/tmp/ads-${name}-${i + 1}.png`);
    }
  }
  console.log('shots written');
  process.exit(0);
};
