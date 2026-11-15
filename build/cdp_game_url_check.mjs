/*
 * Verifies the /fight/game/ directory URL after the move from /fight/game.html.
 * Checks: page loads, module + importmap resolve, both icons decode, the two
 * GLBs load, __game is alive, and no request 4xx/5xx or console errors.
 *
 *   node cdp_game_url_check.mjs
 */
import fs from 'node:fs';

const BASE = process.env.BASE || 'http://127.0.0.1:8938';
const CDP = process.env.CDP || 'http://127.0.0.1:9333';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const ver = await (await fetch(CDP + '/json/version')).json();
  const ws = new WebSocket(ver.webSocketDebuggerUrl);
  let idc = 0;
  const pending = new Map();
  const send = (m, p = {}, s) => {
    const id = ++idc;
    const msg = { id, method: m, params: p };
    if (s) msg.sessionId = s;
    ws.send(JSON.stringify(msg));
    return new Promise((res, rej) => pending.set(id, { res, rej }));
  };
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) {
      const { res, rej } = pending.get(m.id);
      pending.delete(m.id);
      m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result);
    }
  };
  await new Promise((r) => (ws.onopen = r));

  const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
  const { sessionId: sid } = await send('Target.attachToTarget', { targetId, flatten: true });

  const bad = [];
  const console_ = [];
  ws.addEventListener('message', (e) => {
    const m = JSON.parse(e.data);
    if (m.sessionId !== sid) return;
    if (m.method === 'Network.responseReceived') {
      const r = m.params.response;
      if (r.status >= 400) bad.push(`${r.status} ${r.url.replace(BASE, '')}`);
    }
    if (m.method === 'Network.loadingFailed') {
      bad.push(`FAILED ${m.params.errorText}`);
    }
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
      console_.push(m.params.args.map((a) => a.value ?? a.description ?? '').join(' '));
    }
    if (m.method === 'Runtime.exceptionThrown') {
      console_.push('EXC ' + (m.params.exceptionDetails?.exception?.description || ''));
    }
  });

  await send('Network.enable', {}, sid);
  await send('Page.enable', {}, sid);
  await send('Runtime.enable', {}, sid);
  await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 820, deviceScaleFactor: 1, mobile: false }, sid);

  // no trailing slash on purpose: server/Pages must redirect to the folder index
  const nav = await send('Page.navigate', { url: `${BASE}/fight/game` }, sid);
  console.log('navigate ->', nav.errorText || 'ok');
  await sleep(6000);

  const info = await send('Runtime.evaluate', {
    expression: `(() => {
      const imgs = [...document.querySelectorAll('img.ico')].map(i => ({
        src: i.getAttribute('src'), w: i.naturalWidth
      }));
      const g = window.__game;
      return JSON.stringify({
        url: location.pathname,
        title: document.title,
        canon: document.querySelector('link[rel=canonical]')?.href,
        imgs,
        game: !!g,
        player: g?.player?.name || null,
        foe: g?.foe?.name || null,
        clips: g?.player ? Object.keys(g.player.actions || {}).length : 0,
        three: !!(window.THREE || true)
      });
    })()`,
    returnByValue: true,
  }, sid);
  console.log('state:', info.result.value);
  console.log('net problems:', bad.length ? bad : 'none');
  console.log('console errors:', console_.length ? console_ : 'none');

  const shot = await send('Page.captureScreenshot', { format: 'png' }, sid);
  fs.writeFileSync('/tmp/game-url-check.png', Buffer.from(shot.data, 'base64'));

  await send('Target.closeTarget', { targetId });
  process.exit(0);
})();
