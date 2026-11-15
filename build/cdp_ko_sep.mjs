/*
 * Checks the KO choreography: after a knockout the pair must step apart to
 * ~1.9m BEFORE the defeat / win clips start, then hold there.
 *
 *   node cdp_ko_sep.mjs
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
  await send('Page.enable', {}, sid);
  await send('Runtime.enable', {}, sid);
  await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 760, deviceScaleFactor: 1, mobile: false }, sid);

  const ev = async (x) => (await send('Runtime.evaluate', { expression: x, returnByValue: true, awaitPromise: true }, sid)).result.value;

  await send('Page.navigate', { url: `${BASE}/fight/game/?demo=woman&level=0` }, sid);
  await sleep(4500);

  // put both fighters at punching range and give the foe a sliver of HP
  await ev(`(() => { const g = window.__game;
    g.player.root.position.set(-0.28, 0, 0); g.foe.root.position.set(0.28, 0, 0);
    g.foe.hp = 6; return 1; })()`);

  // jab until it drops, recording the gap at the moment of the KO
  let gapAtKO = null;
  for (let i = 0; i < 30; i++) {
    const over = await ev('window.__game.over');
    if (over) break;
    await ev(`window.__game.player.attack('jab')`);
    await sleep(650);
  }
  gapAtKO = await ev(`(() => { const g = window.__game;
    return +Math.abs(g.foe.root.position.x - g.player.root.position.x).toFixed(2); })()`);
  console.log('gap at KO:', gapAtKO, '| over:', await ev('window.__game.over'));

  // sample the step-back + endings
  const rows = [];
  for (let i = 0; i < 12; i++) {
    const s = await ev(`(() => { const g = window.__game;
      return JSON.stringify({
        gap: +Math.abs(g.foe.root.position.x - g.player.root.position.x).toFixed(2),
        p: g.player.state, f: g.foe.state, sep: !!g.sep
      }); })()`);
    rows.push(JSON.parse(s));
    if (i === 3) {
      const shot = await send('Page.captureScreenshot', { format: 'png' }, sid);
      fs.writeFileSync('/tmp/ko-mid.png', Buffer.from(shot.data, 'base64'));
    }
    await sleep(200);
  }
  console.log(rows.map((r) => `${r.gap}m ${r.p}/${r.f}${r.sep ? ' (sep)' : ''}`).join('\n'));

  await sleep(1800);
  const end = await ev(`(() => { const g = window.__game;
    return JSON.stringify({ gap: +Math.abs(g.foe.root.position.x - g.player.root.position.x).toFixed(2),
      p: g.player.state, f: g.foe.state, panel: document.getElementById('over').classList.contains('on') }); })()`);
  console.log('final:', end);
  const shot = await send('Page.captureScreenshot', { format: 'png' }, sid);
  fs.writeFileSync('/tmp/ko-end.png', Buffer.from(shot.data, 'base64'));

  await send('Target.closeTarget', { targetId });
  process.exit(0);
})();
