/* Fight-game modals: card metrics + screenshots of #intro and #select.
 * node build/cdp_game_modal.mjs [outPrefix]   (env: W,H,URL_)
 * Screenshots: <prefix>-intro.png, <prefix>-select.png */
import fs from 'node:fs';
const URL_ = process.env.URL_ || 'http://127.0.0.1:8958/fight/game/';
const OUT = process.argv[2] || '/tmp/game-modal';
const W = +(process.env.W || 1440), H = +(process.env.H || 900);
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
  await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: false }, sid);
  const ev = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }, sid);
    if (r.exceptionDetails) return { error: r.exceptionDetails.exception?.description || r.exceptionDetails.text };
    return r.result.value;
  };
  const shot = async (path) => {
    const s = await send('Page.captureScreenshot', { format: 'png' }, sid);
    fs.writeFileSync(path, Buffer.from(s.data, 'base64'));
  };

  await send('Page.navigate', { url: URL_ }, sid);
  for (let i = 0; i < 240; i++) { await sleep(250); if (await ev(`document.readyState === 'complete'`) === true) break; }
  await sleep(3000);

  const probe = (id) => `(() => {
    const sc = document.getElementById('${id}');
    const card = sc.querySelector('.card');
    const cta = card.querySelector('.cta');
    const foot = card.querySelector('.foot');
    const r = (x) => x ? [Math.round(x.getBoundingClientRect().top), Math.round(x.getBoundingClientRect().bottom)] : null;
    return {
      screen: '${id}', on: sc.classList.contains('on'),
      viewport: [innerWidth, innerHeight],
      cardH: Math.round(card.getBoundingClientRect().height),
      card: r(card), cta: r(cta), foot: r(foot),
      scrollable: sc.scrollHeight > sc.clientHeight,
      ctaAboveFold: cta.getBoundingClientRect().bottom <= innerHeight,
      ads: [...card.querySelectorAll('.ad-slot')].map(x => ({
        h: Math.round(x.getBoundingClientRect().height),
        status: x.querySelector('ins')?.getAttribute('data-ad-status') || null,
        hidden: x.hidden || x.classList.contains('is-empty')
      }))
    };
  })()`;

  console.log('intro ', JSON.stringify(await ev(probe('intro'))));
  await shot(`${OUT}-intro.png`);

  if (process.env.FAKE) {
    await ev(`(() => { document.querySelectorAll('.ad-slot').forEach(s => {
      s.classList.remove('is-empty');
      const i = s.querySelector('ins');
      i.style.height = '90px';
      i.style.background = 'repeating-linear-gradient(135deg,#1a2029,#1a2029 12px,#151a22 12px,#151a22 24px)';
      i.textContent = 'ad preview'; i.style.color = '#7d8894';
      i.style.font = '12px/90px system-ui,sans-serif'; i.style.textAlign = 'center';
    }); return true; })()`);
    await sleep(200);
    await shot(`${OUT}-intro-fake.png`);
    console.log('intro filled', JSON.stringify(await ev(probe('intro'))));
  }

  await ev(`document.getElementById('startBtn').click(); true`);
  await sleep(1800);
  if (process.env.FAKE) {
    await ev(`(() => { const s = document.querySelector('#select .ad-slot');
      s.classList.remove('is-empty');
      const i = s.querySelector('ins');
      i.style.height = '90px';
      i.style.background = 'repeating-linear-gradient(135deg,#1a2029,#1a2029 12px,#151a22 12px,#151a22 24px)';
      i.textContent = 'ad preview'; i.style.color = '#7d8894';
      i.style.font = '12px/90px system-ui,sans-serif'; i.style.textAlign = 'center';
      return true; })()`);
    await sleep(200);
    await shot(`${OUT}-select-fake.png`);
  }
  console.log('select', JSON.stringify(await ev(probe('select'))));
  await shot(`${OUT}-select.png`);
  process.exit(0);
};
