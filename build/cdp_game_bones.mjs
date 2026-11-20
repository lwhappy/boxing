/* /fight/game/ strike-geometry probe, pass 2:
 *  for a given attack, record — frame by frame — the distance from every candidate
 *  strike bone to the defender's head / chest / belly, then report
 *    - the closest approach per bone and the clip time it happens at
 *    - the distance at each declared impact time in ATTACKS
 * So we can tell whether the impact time is off, the limb is wrong, or the
 * reference point (chest) is wrong for a body strike.
 * node build/cdp_game_bones.mjs [outPrefix] */
import fs from 'node:fs';
const URL_ = process.env.URL_ || 'http://127.0.0.1:8945/fight/game/';
const OUT = process.argv[2] || '/tmp/game-bones';
const W = +(process.env.W || 1280), H = +(process.env.H || 800);
const PORT = process.env.CDP_PORT || '9333';
const GAP = +(process.env.GAP || 0.6);

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
  await sleep(1200);

  await ev(`(() => {
    const g = window.__game;
    g.ai.update = () => {};
    const BONES = ['LeftHand','RightHand','LeftForeArm','RightForeArm','LeftUpLeg','RightUpLeg',
                   'LeftLeg','RightLeg','LeftFoot','RightFoot','Head'];
    const REFS  = ['Head','Spine2','Spine','Hips'];
    const V = new (g.player.root.position.constructor)();

    window.__reset = (gap) => {
      for (const f of [g.player, g.foe]) {
        f.guarding = false;
        if (f.state !== 'idle' && f.state !== 'guard') f.toNeutral();
        f.state = 'idle'; f.pending && (f.pending.length = 0); f.attackName = null;
        f.move(null);            /* the AI's last 'approach' survives being frozen */
        Object.values(f.actions).forEach(a => { if (a !== f.actions.idle) a.stop(); });
        f.fade('idle', 0.001);
      }
      g.player.root.position.set(-gap / 2, 0, 0);
      g.foe.root.position.set(gap / 2, 0, 0);
      g.player.root.rotation.y = Math.PI / 2;
      g.foe.root.rotation.y = -Math.PI / 2;
      g.player.hp = 100; g.foe.hp = 100;
    };
    const wp = (f, name) => { const b = f.bones[name]; return b ? b.getWorldPosition(V).clone() : null; };

    /* Returns, per bone, the closest approach to each reference + the clip time,
       plus a distance-vs-time dump so the caller can read any timestamp. */
    window.__trace = (name, gap) => new Promise((done) => {
      window.__reset(gap);
      const att = g.player, foe = g.foe;
      if (!att.attack(name)) return done({ error: 'attack refused ' + att.state });
      const samples = [];
      const step = () => {
        const a = att.actions[name];
        const t = a.time;
        const rec = { t: +t.toFixed(3), x: +Math.abs(foe.root.position.x - att.root.position.x).toFixed(3) };
        for (const b of BONES) {
          const p = wp(att, b); if (!p) continue;
          rec[b] = {};
          for (const r of REFS) {
            const q = wp(foe, r); if (q) rec[b][r] = +p.distanceTo(q).toFixed(3);
          }
        }
        samples.push(rec);
        if (att.state === 'attack' && !a.paused && a.isRunning()) requestAnimationFrame(step);
        else done({ attack: name, gap, dur: +a.getClip().duration.toFixed(3), dmg: 100 - foe.hp, samples });
      };
      requestAnimationFrame(step);
    });
  })()`);

  /* Which bone actually travels toward the defender, and when? */
  const summarize = (r) => {
    if (!r || r.error) return r;
    const bones = Object.keys(r.samples[0]).filter(k => k !== 't');
    const out = [];
    for (const b of bones) {
      let best = { d: 9, t: 0, ref: '' };
      for (const s of r.samples) {
        for (const ref of Object.keys(s[b] || {})) {
          const d = s[b][ref];
          if (d < best.d) best = { d, t: s.t, ref };
        }
      }
      out.push({ bone: b, min: +best.d.toFixed(3), at: best.t, ref: best.ref });
    }
    out.sort((x, y) => x.min - y.min);
    return { attack: r.attack, gap: r.gap, dur: r.dur, dmg: r.dmg, bones: out };
  };

  const IMPACTS = { knee: [1.00], 'combo2-knee': [1.03, 2.40], 'combo2-elbow': [0.60, 2.97], jab: [0.50], cross: [0.67] };
  const AT = (r, tb) => {
    const s = r.samples.reduce((a, b) => Math.abs(b.t - tb) < Math.abs(a.t - tb) ? b : a);
    const pick = (bone, ref) => s[bone] && s[bone][ref];
    return { t: s.t, gap: s.x, RightLeg: { chest: pick('RightLeg', 'Spine2'), spine: pick('RightLeg', 'Spine'), hips: pick('RightLeg', 'Hips') },
             LeftLeg: { chest: pick('LeftLeg', 'Spine2'), spine: pick('LeftLeg', 'Spine') },
             LeftHand: { chest: pick('LeftHand', 'Spine2'), head: pick('LeftHand', 'Head') },
             RightHand: { chest: pick('RightHand', 'Spine2'), head: pick('RightHand', 'Head') } };
  };

  /* full time series for the two knee attacks: where is the knee, actually */
  for (const name of (process.env.SERIES ? process.env.SERIES.split(',') : ['knee', 'combo2-knee'])) {
    const r = await ev(`window.__trace(${JSON.stringify(name)}, ${GAP})`);
    if (!r || r.error) { console.log(name, r); continue; }
    console.log('\n--- ' + name + ' time series (RightLeg->Hips / ->Spine, LeftHand->Head, RightHand->Head) ---');
    for (const s of r.samples) {
      if (Math.round(s.t * 100) % 10 !== 0) continue;
      const g = (b, ref) => (s[b] && s[b][ref] != null ? s[b][ref].toFixed(2) : ' -- ');
      console.log([s.t.toFixed(2), g('RightLeg','Hips'), g('RightLeg','Spine'), g('LeftHand','Head'), g('RightHand','Head')].join('\t'));
    }
  }

  const ONLY = process.env.ONLY ? process.env.ONLY.split(',') : ['knee', 'combo2-knee', 'combo2-elbow', 'jab', 'cross'];
  for (const name of ONLY) {
    const r = await ev(`window.__trace(${JSON.stringify(name)}, ${GAP})`);
    const s = summarize(r);
    console.log('\n=== ' + name + ' (gap ' + GAP + ', dur ' + (r && r.dur) + 's, dmg ' + (r && r.dmg) + ')');
    if (s.bones) console.log(s.bones.slice(0, 5).map(b => `${b.bone}->${b.ref} ${b.min}m @${b.at}s`).join(' | '));
    for (const t of (IMPACTS[name] || [])) console.log('  at impact t=' + t + ' ->', JSON.stringify(AT(r, t)));
  }

  console.log('\nconsole errors:', logs.length ? logs.join('\n') : 'none');
  process.exit(0);
};
