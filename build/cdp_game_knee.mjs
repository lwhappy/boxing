/* /fight/game/ diagnostics:
 *  1) which attacks land at a given gap, measured by the defender's HP (ground truth)
 *     plus the closest the strike bone ever gets to head / chest / gloves
 *  2) what happens to the guard when the semicolon key is pressed and released
 * node build/cdp_game_knee.mjs [outPrefix] */
import fs from 'node:fs';
const URL_ = process.env.URL_ || 'http://127.0.0.1:8945/fight/game/';
const OUT = process.argv[2] || '/tmp/game-probe';
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
  /* A brand-new tab: the browser's other pages belong to older sessions and a
     background tab gets its requestAnimationFrame throttled to a standstill. */
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

  const loaded = new Promise((res) => { onLoad = res; setTimeout(res, 30000); });
  await send('Page.navigate', { url: URL_ }, sid);
  console.log('navigated');
  await loaded;
  await sleep(400);

  /* the page loads both GLBs before it lets you start */
  for (let i = 0; i < 120; i++) {
    if (await ev(`!document.getElementById('startBtn').disabled`)) break;
    await sleep(250);
  }

  await ev(`document.getElementById('startBtn').click(); true`);
  await sleep(400);
  await ev(`document.getElementById('picks').querySelector('.pick').click(); document.getElementById('goBtn').click(); true`);
  await sleep(1500);

  console.log('start clicked');
  const ready = await ev(`!!(window.__game && window.__game.player)`);
  if (!ready) { console.log('game never started'); console.log(logs.join('\n')); process.exit(1); }

  /* helpers inside the page ------------------------------------------------ */
  await ev(`(() => {
    const g = window.__game;
    g.ai.update = () => {};                    // no AI: the test drives both fighters
    g.player.hp = 100; g.foe.hp = 100;
    const V = new (g.player.root.position.constructor)();

    window.__reset = (gap) => {
      for (const f of [g.player, g.foe]) {
        f.guarding = false;
        if (f.state !== 'idle' && f.state !== 'guard') f.toNeutral();
        f.state = 'idle';
        f.pending && (f.pending.length = 0);
        f.attackName = null;
        f.move(null);            /* the AI's last 'approach' survives being frozen */
        f.actions && Object.values(f.actions).forEach(a => { if (a !== f.actions.idle) a.stop(); });
        f.fade('idle', 0.001);
      }
      g.player.root.position.set(-gap / 2, 0, 0);
      g.foe.root.position.set(gap / 2, 0, 0);
      g.player.root.rotation.y = Math.PI / 2;
      g.foe.root.rotation.y = -Math.PI / 2;
      g.player.hp = 100; g.foe.hp = 100;
    };

    /* every contact, with the bone it was judged on and the damage it did */
    const origResolve = g.resolveStrike.bind(g);
    window.__hits = [];
    g.resolveStrike = function (att, hit) {
      const before = att.foe ? att.foe.hp : 0;
      origResolve(att, hit);
      window.__hits.push({ a: att.attackName, limb: hit && hit.limb, aim: hit && hit.aim,
                           t: +(att.actions[att.attackName].time).toFixed(2),
                           dmg: before - (att.foe ? att.foe.hp : 0) });
    };

    window.__run = (name, gap, limb) => new Promise((done) => {
      const g = window.__game;
      const foe = g.foe, att = g.player;
      window.__reset(gap);
      window.__hits.length = 0;
      const dv = (bone, obj) => {
        const b = obj.bones[bone];
        return b ? b.getWorldPosition(V).clone() : null;
      };
      let minH = 9, minC = 9, minG = 9, t0 = performance.now(), started = false;
      const step = () => {
        const el = (performance.now() - t0) / 1000;
        if (!started) { started = att.attack(name); if (!started) return done({ error: 'attack refused', state: att.state }); }
        const p = dv(limb, att);
        const head = dv('Head', foe);
        const chest = dv('Spine2', foe);
        const lh = dv('LeftHand', foe), rh = dv('RightHand', foe);
        if (p && head) minH = Math.min(minH, p.distanceTo(head));
        if (p && chest) minC = Math.min(minC, p.distanceTo(chest));
        if (p && lh && rh) minG = Math.min(minG, p.distanceTo(lh), p.distanceTo(rh));
        if (att.state === 'attack' || el < 1.2) requestAnimationFrame(step);
        else done({
          attack: name, gap,
          dmg: 100 - foe.hp,
          hits: window.__hits.slice(),
          minHead: +minH.toFixed(3), minChest: +minC.toFixed(3), minGlove: +minG.toFixed(3),
          endState: att.state,
        });
      };
      requestAnimationFrame(step);
    });
  })()`);

  const LIMB = {
    jab: 'LeftHand', cross: 'RightHand', 'jab-cross': 'LeftHand', combo1: 'LeftHand',
    'lead-hook': 'LeftHand', 'rear-hook': 'RightHand', 'lead-uppercut': 'LeftHand',
    'rear-uppercut': 'RightHand', elbow: 'RightForeArm', knee: 'RightLeg',
    headbutt: 'Head', 'combo2-knee': 'LeftHand', 'combo2-elbow': 'LeftHand',
  };
  const GAP = +(process.env.GAP || 0.6);

  console.log(`\n--- attacks at gap ${GAP} (no AI, defender passive) ---`);
  const rows = [];
  for (const name of Object.keys(LIMB)) {
    const r = await ev(`window.__run(${JSON.stringify(name)}, ${GAP}, ${JSON.stringify(LIMB[name])})`);
    rows.push(r);
    console.log(JSON.stringify({ a: r.attack, gap: r.gap, dmg: r.dmg,
      hits: (r.hits || []).map(h => `${h.limb}${h.aim ? '/' + h.aim : ''}@${h.t}=${h.dmg}`) }));
  }

  /* also measure at a comfortable boxing range */
  console.log(`\n--- knee / combo2-knee at several gaps ---`);
  for (const gap of [0.55, 0.75, 0.95, 1.15]) {
    for (const name of ['knee', 'combo2-knee']) {
      const r = await ev(`window.__run(${JSON.stringify(name)}, ${gap}, ${JSON.stringify(LIMB[name])})`);
      console.log(JSON.stringify(r));
    }
  }

  /* guard via the real key ------------------------------------------------ */
  await ev(`window.__reset(0.9); true`);
  const keyPress = async (type) => send('Input.dispatchKeyEvent', {
    type, code: 'Semicolon', key: ';', windowsVirtualKeyCode: 186, nativeVirtualKeyCode: 186,
  }, sid);
  const guardProbe = () => ev(`(() => { const p = window.__game.player;
    return { guarding: p.guarding, state: p.state,
             cur: p.current && p.current.getClip().name, t: p.current && +p.current.time.toFixed(2) }; })()`);

  console.log('\n--- guard: one tap (keyDown + keyUp, like a human) ---');
  await keyPress('keyDown');
  await sleep(60);
  await keyPress('keyUp');
  for (const ms of [100, 800, 1500, 3000]) { await sleep(ms === 100 ? 100 : 700); console.log(ms + 'ms', JSON.stringify(await guardProbe())); }
  await shot(`${OUT}-guard.png`);
  console.log('second tap should drop it');
  await keyPress('keyDown');
  await sleep(60);
  await keyPress('keyUp');
  await sleep(300);
  console.log('after 2nd tap', JSON.stringify(await guardProbe()));
  console.log('auto-repeat while latched must not toggle (5 repeated keydowns)');
  await keyPress('keyDown'); await sleep(60); await keyPress('keyUp'); await sleep(200);
  for (let i = 0; i < 5; i++) {
    await send('Input.dispatchKeyEvent', { type: 'keyDown', code: 'Semicolon', key: ';', autoRepeat: true, windowsVirtualKeyCode: 186 }, sid);
    await sleep(40);
  }
  console.log('after repeats', JSON.stringify(await guardProbe()));
  await keyPress('keyDown'); await sleep(60); await keyPress('keyUp'); await sleep(200);

  console.log('\nconsole errors:', logs.length ? logs.join('\n') : 'none');
  process.exit(0);
};
