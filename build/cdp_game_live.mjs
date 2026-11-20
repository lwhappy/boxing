/* /fight/game/ end-to-end check after the strike/guard fix:
 *  A) a real fight (AI on): walk in, press P, the knee must land on the AI
 *  B) a controlled knee, screenshotted at the contact frame
 *  C) one tap on ';' latches the guard — screenshot with the hands up
 * node build/cdp_game_live.mjs [outPrefix] */
import fs from 'node:fs';
const URL_ = process.env.URL_ || 'http://127.0.0.1:8945/fight/game/';
const OUT = process.argv[2] || '/tmp/game-live';
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
  await send('Network.enable', {}, sid);
  await send('Network.setCacheDisabled', { cacheDisabled: true }, sid);
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
  const key = (type, code, k, vk, extra = {}) => send('Input.dispatchKeyEvent', {
    type, code, key: k, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk, ...extra,
  }, sid);
  const tap = async (code, k, vk) => { await key('keyDown', code, k, vk); await sleep(50); await key('keyUp', code, k, vk); };

  const loaded = new Promise((res) => { onLoad = res; setTimeout(res, 30000); });
  await send('Page.navigate', { url: URL_ }, sid);
  await loaded;
  await sleep(400);
  for (let i = 0; i < 120; i++) {
    if (await ev(`!document.getElementById('startBtn').disabled`)) break;
    await sleep(250);
  }
  await ev(`document.getElementById('startBtn').click(); true`);
  await sleep(300);
  await ev(`document.getElementById('picks').querySelector('.pick').click(); document.getElementById('goBtn').click(); true`);
  await sleep(1600);

  /* -- A) real fight: walk in and throw the P combo ---------------------- */
  await ev(`(() => {
    const g = window.__game, orig = g.resolveStrike.bind(g);
    window.__hits = [];
    g.resolveStrike = function (att, hit) {
      const before = att.foe.hp; orig(att, hit);
      window.__hits.push({ who: att === g.player ? 'me' : 'ai', a: att.attackName,
        limb: hit && hit.limb, aim: hit && hit.aim, dmg: before - att.foe.hp,
        gap: +Math.abs(att.foe.root.position.x - att.root.position.x).toFixed(2),
        foe: att.foe.state });
    };
  })()`);

  const foeHp0 = await ev(`window.__game.foe.hp`);
  await key('keyDown', 'KeyD', 'd', 68);
  await sleep(600);
  await key('keyUp', 'KeyD', 'd', 68);
  console.log('gap after walking in:', await ev(`(() => { const g = window.__game;
    return { dx: +Math.abs(g.foe.root.position.x - g.player.root.position.x).toFixed(2),
             dz: +Math.abs(g.foe.root.position.z - g.player.root.position.z).toFixed(2) }; })()`));

  for (let i = 0; i < 6; i++) {
    const ok = await ev(`window.__game.player.attack('combo2-knee')`);
    const trail = [];
    for (let k = 0; k < 12; k++) {
      await sleep(200);
      trail.push(await ev(`window.__game.player.state[0] + (window.__game.player.attackName ? '*' : '')`));
    }
    console.log('  P#' + i, 'started=' + ok, 'state trail', trail.join(''));
  }
  const foeHp1 = await ev(`window.__game.foe.hp`);
  const hits = await ev(`window.__hits`);
  console.log('--- real fight, 4 x P ---');
  console.log('foe hp', foeHp0, '->', foeHp1);
  console.log('contacts:', JSON.stringify(hits.filter(h => h.who === 'me')));
  await shot(`${OUT}-fight.png`);

  /* -- B) controlled knee at the contact frame --------------------------- */
  await ev(`(() => {
    const g = window.__game;
    g.ai.update = () => {};
    for (const f of [g.player, g.foe]) { f.guarding = false; f.move(null); if (f.state !== 'idle') f.toNeutral(); f.state = 'idle'; f.fade('idle', 0.001); }
    g.player.root.position.set(-0.275, 0, 0);
    g.foe.root.position.set(0.275, 0, 0);
    g.player.root.rotation.y = Math.PI / 2;
    g.foe.root.rotation.y = -Math.PI / 2;
    g.foe.hp = 100; g.player.hp = 100;
    window.__hits.length = 0;
    g.player.attack('knee');
  })()`);
  for (let i = 0; i < 60; i++) {
    if ((await ev(`window.__hits.length`)) > 0) break;
    await sleep(50);
  }
  await sleep(90);
  await shot(`${OUT}-knee.png`);
  console.log('knee contact:', JSON.stringify(await ev(`window.__hits`)));

  /* -- C) one tap on ';' latches the guard ------------------------------- */
  await sleep(1800);
  await tap('Semicolon', ';', 186);
  await sleep(900);
  console.log('after one tap:', JSON.stringify(await ev(`(() => { const p = window.__game.player;
    return { guarding: p.guarding, state: p.state, clip: p.current.getClip().name }; })()`)));
  await shot(`${OUT}-guard.png`);
  console.log('guard button lit:', await ev(`(() => { const b = [...document.querySelectorAll('#acts button')].find(x => x.textContent.trim() === 'GUARD');
    return b ? b.classList.contains('on') : 'no touch pad on desktop'; })()`));

  console.log('\nconsole errors:', logs.length ? logs.join('\n') : 'none');
  process.exit(0);
};
