/* Ad banner check: placement, slot ids, collapse behaviour, layout shift.
 * node build/cdp_ads_check.mjs [url] */
import fs from 'node:fs';
const URL_ = process.argv[2] || 'http://127.0.0.1:8958/index.html';
const PORT = process.env.CDP_PORT || '9333';

const ver = await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json();
const ws = new WebSocket(ver.webSocketDebuggerUrl);
let idc = 0; const pending = new Map();
const events = [];
const send = (m, p = {}, s) => {
  const id = ++idc; const msg = { id, method: m, params: p }; if (s) msg.sessionId = s;
  ws.send(JSON.stringify(msg)); return new Promise((res, rej) => pending.set(id, { res, rej }));
};
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.method) {
    if (m.method === 'Runtime.exceptionThrown') events.push('EXC ' + (m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text));
    if (m.method === 'Runtime.consoleAPICalled' && (m.params.type === 'error' || m.params.type === 'warning')) {
      events.push(m.params.type.toUpperCase() + ' ' + m.params.args.map(a => a.value ?? a.description ?? '').join(' '));
    }
    if (m.method === 'Log.entryAdded') events.push('LOG ' + m.params.entry.level + ' ' + m.params.entry.text);
  }
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
  await send('Log.enable', {}, sid);
  await send('Network.enable', {}, sid);
  await send('Network.setCacheDisabled', { cacheDisabled: true }, sid);
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false }, sid);
  const ev = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }, sid);
    if (r.exceptionDetails) return { error: r.exceptionDetails.exception?.description || r.exceptionDetails.text };
    return r.result.value;
  };
  const shot = async (path) => {
    const s = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true }, sid);
    fs.writeFileSync(path, Buffer.from(s.data, 'base64'));
  };

  await send('Page.navigate', { url: URL_ }, sid);
  for (let i = 0; i < 160; i++) { await sleep(250); if (await ev(`document.readyState === 'complete'`) === true) break; }
  await sleep(1500);

  const info = await ev(`(() => {
    const banners = [...document.querySelectorAll('.ad-banner')];
    return banners.map(b => {
      const ins = b.querySelector('ins.adsbygoogle');
      const rect = b.getBoundingClientRect();
      const next = b.nextElementSibling;
      return {
        slot: ins && ins.getAttribute('data-ad-slot'),
        client: ins && ins.getAttribute('data-ad-client'),
        format: ins && ins.getAttribute('data-ad-format'),
        status: ins && ins.getAttribute('data-ad-status'),
        adsStatus: ins && ins.getAttribute('data-adsbygoogle-status'),
        hidden: b.classList.contains('is-empty'),
        width: Math.round(rect.width),
        nextSection: next && (next.id || next.tagName.toLowerCase()),
        insHeight: ins ? Math.round(ins.getBoundingClientRect().height) : null,
        queue: (window.adsbygoogle || []).length
      };
    });
  })()`);
  console.log('banners:', JSON.stringify(info, null, 1));
  console.log('scripts:', JSON.stringify(await ev(`[...document.scripts].map(s => s.src || 'inline').filter(s => /adsbygoogle|site-ads/.test(s))`)));
  await shot('/tmp/ads-desktop-real.png');

  /* force a filled-looking unit so the layout can be eyeballed */
  await ev(`(() => {
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
  })()`);
  await sleep(300);
  console.log('with fake ad — page height:', await ev(`document.body.scrollHeight`));
  await shot('/tmp/ads-desktop.png');

  /* mobile */
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true }, sid);
  await sleep(800);
  console.log('mobile:', JSON.stringify(await ev(`(() => {
    const b = document.querySelector('.ad-banner'), r = b.getBoundingClientRect();
    return { width: Math.round(r.width), scrollWidth: document.documentElement.scrollWidth,
             overflowX: document.documentElement.scrollWidth > window.innerWidth,
             insH: Math.round(b.querySelector('ins').getBoundingClientRect().height) };
  })()`)));
  await shot('/tmp/ads-mobile.png');

  console.log('events:', JSON.stringify(events.filter(e => !/ERR_BLOCKED|net::/.test(e)).slice(0, 8), null, 1));
  process.exit(0);
};
