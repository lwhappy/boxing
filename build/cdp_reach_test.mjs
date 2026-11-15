/**
 * Reach test: at a given stand-off distance, which attacks actually land?
 *
 *   node build/cdp_reach_test.mjs [gaps]      e.g. node build/cdp_reach_test.mjs 0.8,0.7,0.62,0.55
 *
 * For every gap it freezes the AI, parks both fighters exactly that far apart
 * (same line), fires each attack in turn and reads game.LOG / the foe's HP.
 */
const PORT = process.env.CDP_PORT || '9333';
const BASE = process.env.BASE || 'http://127.0.0.1:8938';
const GAPS = (process.argv[2] || '0.8,0.72,0.65,0.6,0.55').split(',').map(Number);
const SEX = process.env.SEX || 'woman';

const ATTACKS = ['jab', 'cross', 'jab-cross', 'combo1', 'lead-hook', 'rear-hook',
  'lead-uppercut', 'rear-uppercut', 'elbow', 'knee', 'headbutt', 'combo2-knee', 'combo2-elbow'];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ver = await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json();
const ws = new WebSocket(ver.webSocketDebuggerUrl);
let idc = 0; const pending = new Map();
const send = (m, p = {}, s) => { const id = ++idc; const msg = { id, method: m, params: p }; if (s) msg.sessionId = s; ws.send(JSON.stringify(msg)); return new Promise((res, rej) => pending.set(id, { res, rej })); };
ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { const { res, rej } = pending.get(m.id); pending.delete(m.id); m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result); } };

const ev = async (sid, expression) => (await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }, sid)).result.value;

ws.onopen = async () => {
  const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
  const { sessionId: sid } = await send('Target.attachToTarget', { targetId, flatten: true });
  await send('Page.enable', {}, sid);
  await send('Runtime.enable', {}, sid);
  await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false }, sid);
  await send('Page.navigate', { url: `${BASE}/fight/game/?demo=${SEX}&level=1` }, sid);
  await sleep(3500);

  // freeze the AI so it never walks in/out of the tested distance
  await ev(sid, `(() => { const g = window.__game; g.ai.update = () => {}; g.foe.hp = 200; return 'ok'; })()`);

  for (const gap of GAPS) {
    await ev(sid, `window.__game.setGap(${gap})`);
    const results = [];
    for (const name of ATTACKS) {
      // park the pair at exactly `gap`, both back on the centre line, foe fully idle
      await ev(sid, `(() => {
        const g = window.__game;
        g.foe.hp = 200; g.over = false;
        g.player.root.position.set(${-gap / 2}, 0, 0);
        g.foe.root.position.set(${gap / 2}, 0, 0);
        g.foe.lookAtPlayer && g.foe.lookAtPlayer();
        for (const k of Object.keys(g.LOG)) if (k !== 'last') delete g.LOG[k];
        return 'ok';
      })()`);
      await sleep(350);
      await ev(sid, `window.__game.player.attack(${JSON.stringify(name)})`);
      await sleep(1800);
      const r = await ev(sid, `(() => {
        const L = window.__game.LOG;
        const hits = (L.head || 0) + (L.body || 0);
        return JSON.stringify({ hits, head: L.head || 0, body: L.body || 0, block: L.block || 0, whiff: L.whiff || 0, far: L['whiff-far'] || 0, dmg: 200 - window.__game.foe.hp, last: L.last || '' });
      })()`);
      results.push({ name, ...JSON.parse(r) });
    }
    const line = results.map((r) => `${r.name}:${r.hits > 0 ? 'HIT' : 'MISS'}${r.last ? '' : ''}`).join('  ');
    console.log(`\n=== gap ${gap} ===`);
    for (const r of results) {
      console.log(`  ${r.name.padEnd(14)} ${r.hits > 0 ? 'HIT ' : 'miss'} dmg=${r.dmg} head=${r.head} body=${r.body} block=${r.block} whiff=${r.whiff}/${r.far}  ${r.last}`);
    }
    console.log('  summary: ' + line);
  }

  await send('Target.closeTarget', { targetId });
  process.exit(0);
};
