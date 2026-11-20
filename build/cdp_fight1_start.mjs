/* /fight/fight1/ start-gate check:
 *  - the Start button must be usable the moment the page opens (no progress label)
 *  - the loader must be hidden until Start is clicked, then appear
 *  - the start modal must paint above the fixed home button
 * node build/cdp_fight1_start.mjs [outPrefix] */
import fs from 'node:fs';
const URL_ = process.env.URL_ || 'http://127.0.0.1:8958/fight/fight1/';
const OUT = process.argv[2] || '/tmp/fight1-start';
const W = +(process.env.W || 1280), H = +(process.env.H || 800);
const PORT = process.env.CDP_PORT || '9333';

const ver = await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json();
const ws = new WebSocket(ver.webSocketDebuggerUrl);
let idc = 0; const pending = new Map(); let onLoad = null; let onDom = null; const logs = [];
const send = (m, p = {}, s) => {
  const id = ++idc; const msg = { id, method: m, params: p }; if (s) msg.sessionId = s;
  ws.send(JSON.stringify(msg)); return new Promise((res, rej) => pending.set(id, { res, rej }));
};
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.method === 'Page.loadEventFired' && onLoad) { onLoad(); onLoad = null; }
  if (m.method === 'Page.domContentEventFired' && onDom) { onDom(); onDom = null; }
  if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
    logs.push((m.params.args || []).map(a => a.value ?? a.description).join(' '));
  }
  if (m.method === 'Runtime.exceptionThrown') {
    const d = m.params.exceptionDetails;
    logs.push('EXC ' + (d.exception?.description || d.text) + ' @' + (d.url || '') + ':' + d.lineNumber
      + ' ' + (d.stackTrace?.callFrames || []).slice(0, 3).map(f => f.functionName + '@' + f.lineNumber).join(' < '));
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
  await send('Network.enable', {}, sid);
  await send('Network.setCacheDisabled', { cacheDisabled: true }, sid);
  await send('Network.clearBrowserCache', {}, sid);
  if (process.env.THROTTLE) {
    /* 冷启动 + 限速，才能看到"点完 Start 才出现"的加载过程 */
    await send('Network.emulateNetworkConditions', {
      offline: false, latency: 120, downloadThroughput: 400 * 1024, uploadThroughput: 200 * 1024
    }, sid);
  }
  await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: W < 620 }, sid);
  const ev = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }, sid);
    if (r.exceptionDetails) return { error: r.exceptionDetails.exception?.description || r.exceptionDetails.text };
    return r.result.value;
  };
  const shot = async (file) => {
    const s = await send('Page.captureScreenshot', { format: 'png' }, sid);
    fs.writeFileSync(file, Buffer.from(s.data, 'base64'));
  };
  const probe = () => ev(`(() => {
    const btn = document.getElementById('startBtn');
    const ld = document.querySelector('.loader');
    const home = document.querySelector('a[aria-label^="Back to SilentJab"]');
    const hit = document.elementFromPoint(30, 30);
    const cs = getComputedStyle(ld);
    return {
      btnText: btn.textContent.trim(), btnDisabled: btn.disabled,
      modalOn: document.getElementById('start').classList.contains('on'),
      modalZ: getComputedStyle(document.getElementById('start')).zIndex,
      homeZ: home ? getComputedStyle(home).zIndex : null,
      homeRect: home ? [Math.round(home.getBoundingClientRect().width), Math.round(home.getBoundingClientRect().height)] : null,
      loaderDisplay: cs.display, loaderOpacity: cs.opacity, loaderStatus: (ld.querySelector('.status') || {}).textContent,
      loaderHiddenAttr: ld.hasAttribute('hidden'),
      bodyClass: document.body.className,
      hitAt30: hit ? hit.tagName.toLowerCase() + '.' + (hit.className || '') : null,
      ready: !!(window.__game && window.__game.ready)
    };
  })()`);

  /* 不能等 load：async 的 AdSense 脚本会把 load 拖到模型之后，等它就到了"已加载完"。
     DOMContentLoaded 之后 app 才刚开始拉 6.4MB 的 fighters.glb，正好是真实的首屏时刻。 */
  const domReady = new Promise((res) => { onDom = res; setTimeout(res, 25000); });
  await send('Page.navigate', { url: URL_ }, sid);
  await domReady;
  await sleep(150);

  console.log('before click', JSON.stringify(await probe(), null, 1));
  await shot(`${OUT}-before.png`);

  /* real mouse click on the start button */
  const c = await ev(`(() => { const r = document.getElementById('startBtn').getBoundingClientRect();
    return [Math.round(r.left + r.width / 2), Math.round(r.top + r.height / 2)]; })()`);
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: c[0], y: c[1], button: 'left', clickCount: 1 }, sid);
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: c[0], y: c[1], button: 'left', clickCount: 1 }, sid);
  await sleep(300);
  console.log('right after click', JSON.stringify(await probe(), null, 1));
  await shot(`${OUT}-loading.png`);

  /* wait for the fight to be ready */
  for (let i = 0; i < 240; i++) {
    await sleep(250);
    const st = await ev(`(() => ({ ready: !!(window.__game && window.__game.ready), status: (document.querySelector('.loader .status') || {}).textContent }))()`);
    if (st && st.ready) break;
  }
  await sleep(900);
  console.log('after ready', JSON.stringify(await probe(), null, 1));
  await shot(`${OUT}-ready.png`);
  console.log('console errors:', logs.length ? logs.slice(0, 5) : 'none');
  process.exit(0);
};
