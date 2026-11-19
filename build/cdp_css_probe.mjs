const URL_ = process.env.URL_ || 'http://127.0.0.1:8958/index.html';
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
  const ev = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }, sid);
    if (r.exceptionDetails) return { error: r.exceptionDetails.exception?.description || r.exceptionDetails.text };
    return r.result.value;
  };
  const loaded = new Promise((res) => { onLoad = res; setTimeout(res, 20000); });
  await send('Page.navigate', { url: URL_ }, sid);
  await loaded;
  await sleep(800);
  console.log(JSON.stringify(await ev(`(() => {
    const bar = document.getElementById('stage-bar');
    const dots = document.querySelector('.hero-dots');
    const dot = document.querySelector('.hero-dot');
    const cs = (el) => el ? getComputedStyle(el) : null;
    return {
      vw: innerWidth, vh: innerHeight,
      mq620: matchMedia('(max-width: 620px)').matches,
      link: [...document.querySelectorAll('link[rel=stylesheet]')].map(l => l.href.split('/').pop()),
      scripts: [...document.querySelectorAll('script[src]')].map(s => s.src.split('/').pop()).filter(x => x.includes('hero')),
      barPE: cs(bar)?.pointerEvents, barZ: cs(bar)?.zIndex, barRect: bar?.getBoundingClientRect().toJSON(),
      dotsPE: cs(dots)?.pointerEvents,
      dotW: dot?.getBoundingClientRect().width,
      dotPE: cs(dot)?.pointerEvents,
      uiZ: cs(document.querySelector('.hero-ui'))?.zIndex,
      hitDots: [...document.querySelectorAll('.hero-dot')].map(d => {
        const r = d.getBoundingClientRect();
        const e = document.elementFromPoint(Math.round(r.left + r.width/2), Math.round(r.top + r.height/2));
        return e ? e.tagName.toLowerCase() + '.' + e.className + ' / ' + (e.closest('.hero-dot') ? 'dot' : 'other') : null;
      }),
      layout: (() => {
        const st = document.querySelector('.hero-stage');
        const bar = document.getElementById('stage-bar');
        const dots = document.querySelector('.hero-dots');
        return {
          stageH: st.clientHeight, barH: bar.offsetHeight, dotsTop: dots.offsetTop, dotsH: dots.offsetHeight,
          dotsBottom: dots.style.bottom,
          cards: [...document.querySelectorAll('.hero-callout')].map(e => ({ top: e.style.top, h: e.offsetHeight, ot: e.offsetTop }))
        };
      })(),
      cssHasRule: [...document.styleSheets].some(sh => { try { return [...sh.cssRules].some(r => r.cssText.includes('stage-bar')); } catch { return false; } })
    };
  })()`), null, 1));
  process.exit(0);
};
