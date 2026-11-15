/**
 * Engagement test: after the foe takes a hit it must switch to guard + attack,
 * never taunt, and walk back onto the line even when the pair is off-line.
 *
 *   node build/cdp_engage_test.mjs
 */
const PORT = process.env.CDP_PORT || '9333';
const BASE = process.env.BASE || 'http://127.0.0.1:8938';
const LEVEL = process.env.LEVEL || '1';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ver = await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json();
const ws = new WebSocket(ver.webSocketDebuggerUrl);
let idc = 0; const pending = new Map();
const send = (m, p = {}, s) => { const id = ++idc; const msg = { id, method: m, params: p }; if (s) msg.sessionId = s; ws.send(JSON.stringify(msg)); return new Promise((res, rej) => pending.set(id, { res, rej })); };
ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { const { res, rej } = pending.get(m.id); pending.delete(m.id); m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result); } };
const ev = async (sid, x) => (await send('Runtime.evaluate', { expression: x, returnByValue: true, awaitPromise: true }, sid)).result.value;

ws.onopen = async () => {
  const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
  const { sessionId: sid } = await send('Target.attachToTarget', { targetId, flatten: true });
  await send('Page.enable', {}, sid);
  await send('Runtime.enable', {}, sid);
  await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false }, sid);
  await send('Page.navigate', { url: `${BASE}/fight/game/?demo=woman&level=${LEVEL}` }, sid);
  await sleep(3500);

  // ---- phase 1: before any hit — remember the passive behaviour
  const before = await ev(sid, `(() => {
    const g = window.__game; const s = [];
    return new Promise(res => { let n = 0;
      const iv = setInterval(() => { s.push(g.foe.state); if (++n >= 40) { clearInterval(iv); res(JSON.stringify(s)); } }, 100);
    });
  })()`);
  const b = JSON.parse(before);
  console.log('before hit  foe states:', [...new Set(b)].join(','));

  // ---- phase 2: land one hit, then walk off the line
  await ev(sid, `(() => {
    const g = window.__game;
    g.player.root.position.set(-0.55, 0, 0);
    g.foe.root.position.set(0.55, 0, 0);
    return 1;
  })()`);
  await sleep(400);
  await ev(sid, `window.__game.player.attack('jab')`);
  await sleep(1400);
  const hit = await ev(sid, `JSON.stringify({ foeHp: window.__game.foe.hp, engaged: window.__game.ai.engaged })`);
  console.log('after one hit:', hit);

  // put the pair off-line: player slides to z = +0.7, foe stays at z = 0
  await ev(sid, `(() => { const g = window.__game; g.player.root.position.set(-0.55, 0, 0.7); return 1; })()`);

  const after = await ev(sid, `(() => {
    const g = window.__game; const s = []; const dzs = []; let minHp = g.player.hp;
    return new Promise(res => { let n = 0;
      const iv = setInterval(() => {
        s.push(g.foe.state);
        dzs.push(+Math.abs(g.foe.root.position.z - g.player.root.position.z).toFixed(2));
        minHp = Math.min(minHp, g.player.hp);
        if (++n >= 80) { clearInterval(iv); res(JSON.stringify({ states: s, dzs, playerHpLost: 200 - minHp })); }
      }, 100);
    });
  })()`);
  const a = JSON.parse(after);
  const counts = a.states.reduce((m, s) => (m[s] = (m[s] || 0) + 1, m), {});
  console.log('after hit   foe states:', JSON.stringify(counts));
  console.log('taunt seen :', (counts.taunt || 0) > 0 ? 'YES (bad)' : 'no');
  console.log('dz start/end:', a.dzs[0], '->', a.dzs.at(-1), ' (foe walked back onto the line)');
  console.log('player hp lost while off-line:', a.playerHpLost);

  // ---- phase 3: block rate when the player spams jabs at close range
  await ev(sid, `(() => { const g = window.__game; g.player.root.position.set(-0.3, 0, 0); g.foe.root.position.set(0.3, 0, 0); g.foe.hp = 200; for (const k of Object.keys(g.LOG)) delete g.LOG[k]; return 1; })()`);
  for (let i = 0; i < 12; i++) { await ev(sid, `window.__game.player.attack('jab')`); await sleep(900); }
  const log = await ev(sid, `JSON.stringify(window.__game.LOG)`);
  console.log('12 jabs at close range ->', log);

  await send('Target.closeTarget', { targetId });
  process.exit(0);
};
