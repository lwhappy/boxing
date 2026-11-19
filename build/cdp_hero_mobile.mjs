/* Hero stage close-up on a phone: clips the .hero-stage element and reports
 * where the dots / bar actually sit. node build/cdp_hero_mobile.mjs [out] */
import fs from 'node:fs';
const URL_ = process.env.URL_ || 'http://127.0.0.1:8958/index.html';
const OUT = process.argv[2] || '/tmp/hero-mobile.png';
const W = +(process.env.W || 390), H = +(process.env.H || 844);
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
  await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 2, mobile: true }, sid);
  const ev = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }, sid);
    if (r.exceptionDetails) return { error: r.exceptionDetails.exception?.description || r.exceptionDetails.text };
    return r.result.value;
  };
  await send('Page.navigate', { url: URL_ }, sid);
  for (let i = 0; i < 200; i++) { await sleep(250); if (await ev(`document.readyState === 'complete'`) === true) break; }
  await sleep(+(process.env.WAIT || 2500));
  if (process.env.PAUSE) {
    /* worst case for the row: "▶ Resume" is the widest the buttons get */
    await ev(`(document.querySelector('#stage-bar .stage-btn') || {}).click?.(); true`);
    await sleep(400);
  }

  const info = await ev(`(() => {
    const s = document.querySelector('.hero-stage').getBoundingClientRect();
    const d = document.querySelector('.hero-dots').getBoundingClientRect();
    const b = document.getElementById('stage-bar').getBoundingClientRect();
    const btn = document.querySelector('#stage-bar .stage-btn').getBoundingClientRect();
    const r = (x) => [Math.round(x.left - s.left), Math.round(x.top - s.top), Math.round(x.width), Math.round(x.height)];
    /* 用 offset* 读布局位置（不受入场 transform 影响） */
    const dotsBox = document.querySelector('.hero-dots');
    const cards = [...document.querySelectorAll('.hero-callout')].map(el => {
      const x = { left: el.offsetLeft, top: el.offsetTop, width: el.offsetWidth, height: el.offsetHeight };
      return {
        tag: el.querySelector('.tag')?.textContent,
        shown: getComputedStyle(el).opacity !== '0',
        rect: [x.left, x.top, x.width, x.height],
        hitsDots: !(x.left + x.width <= dotsBox.offsetLeft ||
                    x.left >= dotsBox.offsetLeft + dotsBox.offsetWidth ||
                    x.top + x.height <= dotsBox.offsetTop ||
                    x.top >= dotsBox.offsetTop + dotsBox.offsetHeight)
      };
    });
    return {
      stage: [Math.round(s.width), Math.round(s.height)],
      dots: r(d), bar: r(b), firstBtn: r(btn),
      dotsBottomGap: Math.round(s.bottom - d.bottom),
      btnCenterY: Math.round(btn.top + btn.height / 2 - s.top),
      dotsCenterY: Math.round(d.top + d.height / 2 - s.top),
      dotsHitBtn: !(d.right <= btn.left || d.left >= btn.right || d.bottom <= btn.top || d.top >= btn.bottom),
      cards
    };
  })()`);
  console.log(JSON.stringify(info, null, 1));

  const s = await send('Page.captureScreenshot', {
    format: 'png',
    clip: await ev(`(() => { const r = document.querySelector('.hero-stage').getBoundingClientRect();
      return { x: r.left + scrollX, y: r.top + scrollY, width: r.width, height: r.height, scale: 2 }; })()`)
  }, sid);
  fs.writeFileSync(OUT, Buffer.from(s.data, 'base64'));
  console.log('saved', OUT);
  process.exit(0);
};
