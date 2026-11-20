/* /fight/game/ visual QA:
 *  1) the new top-left home link (intro + in-fight)
 *  2) the kick animation mid-strike (man + woman attacker)
 *  3) the end panel: "You lose" with no kicker line above it
 * node build/cdp_game_qa.mjs */
import fs from 'node:fs';
const URL_ = process.env.URL_ || 'http://127.0.0.1:8945/fight/game/';
const W = +(process.env.W || 1280), H = +(process.env.H || 800);
const PORT = process.env.CDP_PORT || '9333';

const ver = await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json();
const ws = new WebSocket(ver.webSocketDebuggerUrl);
let idc = 0; const pending = new Map(); let onLoad = null; const logs = [];
const send = (m, p = {}, s) => {
  const id = ++idc; const msg = { id, method: m, params: p }; if (s) msg.sessionId = s;
  ws.send(JSON.stringify(msg)); return new Promise((res, rej) => pending.set(id, { res, rej }));
};
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.method === 'Page.loadEventFired' && onLoad) { onLoad(); onLoad = null; }
  if (m.method === 'Runtime.exceptionThrown') {
    const d = m.params.exceptionDetails;
    logs.push('EXC ' + (d.exception?.description || d.text) + ' @' + (d.url || '') + ':' + d.lineNumber);
  }
  if (m.id && pending.has(m.id)) {
    const { res, rej } = pending.get(m.id); pending.delete(m.id);
    m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result);
  }
};
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

ws.onopen = async () => {
  const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
  const sid = (await send('Target.attachToTarget', { targetId, flatten: true })).sessionId;
  await send('Target.activateTarget', { targetId });
  await send('Emulation.setFocusEmulationEnabled', { enabled: true }, sid);
  await send('Runtime.enable', {}, sid);
  await send('Page.enable', {}, sid);

  const ev = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }, sid);
    if (r.exceptionDetails) return { error: r.exceptionDetails.exception?.description || r.exceptionDetails.text };
    return r.result.value;
  };
  const shot = async (file) => {
    const s = await send('Page.captureScreenshot', { format: 'png' }, sid);
    fs.writeFileSync(file, Buffer.from(s.data, 'base64'));
    console.log('shot ' + file);
  };

  const loaded = new Promise((res) => { onLoad = res; setTimeout(res, 30000); });
  await send('Page.navigate', { url: URL_ }, sid);
  await loaded;
  await sleep(500);

  // home link on the intro screen
  console.log('intro home:', await ev(`(() => {
    const a = document.getElementById('home');
    const r = a.getBoundingClientRect();
    return { href: a.getAttribute('href'), x: Math.round(r.x), y: Math.round(r.y), w: r.width, h: r.height, z: getComputedStyle(a).zIndex };
  })()`));
  await shot('/tmp/qa-intro-home.png');

  // start as the WOMAN to prove her new kick clip plays too
  await ev(`document.getElementById('startBtn').click(); true`);
  await sleep(300);
  await ev(`document.querySelectorAll('#picks .pick')[0].click(); document.getElementById('goBtn').click(); true`);
  await sleep(1200);

  await ev(`(() => {
    const g = window.__game;
    g.ai.update = () => {};
    for (const f of [g.player, g.foe]) {
      f.guarding = false; f.state = 'idle'; f.attackName = null; f.move(null);
    }
    g.player.root.position.set(-0.35, 0, 0);
    g.foe.root.position.set(0.35, 0, 0);
    g.player.root.rotation.y = Math.PI / 2;
    g.foe.root.rotation.y = -Math.PI / 2;
    return 'set';
  })()`);

  // freeze the frame mid-kick and shoot
  await ev(`window.__game.player.attack('kick'); true`);
  await sleep(420);
  await shot('/tmp/qa-kick-woman.png');
  await ev(`(() => { const g = window.__game;
    Object.values(g.player.actions).forEach(a => a.stop());
    g.player.fade('idle', 0.001); g.player.state = 'idle'; return 'reset'; })()`);
  await sleep(600);

  // force the loss: foe lands the kick on a 1-HP player -> end panel
  console.log('lose panel:', await ev(`(async () => {
    const g = window.__game;
    g.player.hp = 1;
    for (let i = 0; i < 3 && !g.over; i++) {
      g.player.root.position.set(-0.3, 0, 0);
      g.foe.root.position.set(0.3, 0, 0);
      g.foe.attack('jab');
      await new Promise(r => setTimeout(r, 900));
    }
    await new Promise(r => setTimeout(r, 4600));
    const kicker = document.getElementById('overKicker');
    return { over: g.over, kicker: kicker.textContent, kickerShown: kicker.style.display !== 'none',
             title: document.getElementById('overTitle').textContent,
             text: document.getElementById('overText').textContent };
  })()`));
  await sleep(300);
  await shot('/tmp/qa-lose-panel.png');
  // home link still on top of the end panel
  console.log('over home above panel:', await ev(`(() => {
    const a = document.getElementById('home');
    const r = a.getBoundingClientRect();
    const el = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
    return { hit: el === a || a.contains(el), z: getComputedStyle(a).zIndex };
  })()`));

  console.log('console errors:', logs.length ? logs.join('\n') : 'none');
  process.exit(0);
};
