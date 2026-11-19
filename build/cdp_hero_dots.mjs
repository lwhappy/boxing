/* Hero stage diagnostics on a phone viewport:
 *  1) which element sits under each dot (hit-test)
 *  2) does a real touch tap on a dot switch the action
 *  3) do the callout cards jump around while they reveal
 * node build/cdp_hero_dots.mjs [outPrefix] */
const URL_ = process.env.URL_ || 'http://127.0.0.1:8958/index.html';
const OUT = process.argv[2] || '/tmp/hero-dots';
const W = +(process.env.W || 390), H = +(process.env.H || 844);
const PORT = process.env.CDP_PORT || '9333';

const ver = await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json();
const ws = new WebSocket(ver.webSocketDebuggerUrl);
let idc = 0; const pending = new Map();
const send = (m, p = {}, s) => {
  const id = ++idc; const msg = { id, method: m, params: p }; if (s) msg.sessionId = s;
  ws.send(JSON.stringify(msg)); return new Promise((res, rej) => pending.set(id, { res, rej }));
};
let onLoad = null;
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.method === 'Page.loadEventFired' && onLoad) { onLoad(); onLoad = null; }
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
  await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 }, sid);
  const ev = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }, sid);
    if (r.exceptionDetails) return { error: r.exceptionDetails.exception?.description || r.exceptionDetails.text };
    return r.result.value;
  };
  const loaded = new Promise((res) => { onLoad = res; setTimeout(res, 20000); });
  await send('Page.navigate', { url: URL_ }, sid);
  await loaded;                       /* 旧文档也是 readyState=complete，不能拿它当新页面的信号 */
  await sleep(300);
  for (let i = 0; i < 120; i++) { await sleep(250); if (await ev(`!!window.__hero`) === true) break; }
  await sleep(1200);

  /* --- 1. hit-test each dot --- */
  const hit = await ev(`(() => {
    const dots = [...document.querySelectorAll('.hero-dot')];
    return dots.map((d, i) => {
      const r = d.getBoundingClientRect();
      const cx = Math.round(r.left + r.width / 2), cy = Math.round(r.top + r.height / 2);
      const top = document.elementFromPoint(cx, cy);
      return {
        i, rect: [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)],
        center: [cx, cy],
        topEl: top ? top.tagName.toLowerCase() + '.' + (top.className || '') : null,
        isDot: !!(top && top.closest && top.closest('.hero-dot') === d)
      };
    });
  })()`);
  console.log('hit-test', JSON.stringify(hit, null, 1));

  /* --- 2. real touch tap on the 3rd dot --- */
  const before = await ev(`window.__hero ? window.__hero.idx : null`);
  const target = hit[2] && hit[2].center;
  if (target) {
    await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: target[0], y: target[1], radiusX: 2, radiusY: 2, force: 1, id: 1 }] }, sid);
    await sleep(60);
    await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [], touchPoints_: [], id: 1 }, sid);
    await sleep(700);
  }
  const after = await ev(`window.__hero ? window.__hero.idx : null`);
  console.log('tap dot#2 -> idx', before, '=>', after, before === after ? 'FAILED' : 'ok');

  /* --- 2b. the Pause button must still be tappable (bar is pointer-events:none) --- */
  const pauseCenter = await ev(`(() => { const b = document.querySelector('#stage-bar .stage-btn').getBoundingClientRect();
    return [Math.round(b.left + b.width / 2), Math.round(b.top + b.height / 2)]; })()`);
  const pBefore = await ev(`window.__hero.paused`);
  await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: pauseCenter[0], y: pauseCenter[1], radiusX: 2, radiusY: 2, force: 1, id: 2 }] }, sid);
  await sleep(60);
  await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [], id: 2 }, sid);
  await sleep(500);
  const pAfter = await ev(`window.__hero.paused`);
  console.log('tap pause ->', pBefore, '=>', pAfter, pBefore === pAfter ? 'FAILED' : 'ok');
  await ev(`window.__hero.pause(false)`);

  /* --- 3. watch card tops while the sequence reveals --- */
  await ev(`(() => {
    window.__trace = [];
    const t0 = performance.now();
    const tick = () => {
      const els = [...document.querySelectorAll('.hero-callout')];
      window.__trace.push({
        t: Math.round(performance.now() - t0),
        tops: els.map(e => Math.round(e.offsetTop)),
        shown: els.map(e => e.classList.contains('show') ? 1 : 0),
        h: els.map(e => Math.round(e.offsetHeight))
      });
      if (performance.now() - t0 < 5200) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
    /* fresh cycle from the first move */
    if (window.__hero) window.__hero.play(0);
    return true;
  })()`);
  await sleep(5600);
  const trace = await ev(`window.__trace`);
  /* report every frame where a card's top moved while it was already visible */
  const jumps = [];
  for (let k = 1; k < (trace?.length || 0); k++) {
    const a = trace[k - 1], b = trace[k];
    for (let i = 0; i < 5; i++) {
      if (a.tops[i] !== b.tops[i]) jumps.push({ t: b.t, card: i, from: a.tops[i], to: b.tops[i], shown: b.shown[i], h: b.h[i] });
    }
  }
  console.log('frames', trace?.length, 'last', JSON.stringify(trace?.[trace.length-1]));
  const uniq = new Set((trace||[]).map(f=>f.tops.join(',')+ '|' + f.h.join(',')));
  console.log('distinct layouts', uniq.size, [...uniq].slice(0,8));
  console.log('top changes:', jumps.length);
  console.log(JSON.stringify(jumps.slice(0, 24), null, 1));

  const s = await send('Page.captureScreenshot', {
    format: 'png',
    clip: await ev(`(() => { const r = document.querySelector('.hero-stage').getBoundingClientRect();
      return { x: r.left + scrollX, y: r.top + scrollY, width: r.width, height: r.height, scale: 2 }; })()`)
  }, sid);
  const fs = await import('node:fs');
  fs.writeFileSync(`${OUT}.png`, Buffer.from(s.data, 'base64'));
  console.log('saved', `${OUT}.png`);
  process.exit(0);
};
