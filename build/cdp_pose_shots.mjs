/* Screenshot each punch at its measured hit moment, with the move pose applied.
 * Usage: CDP_PORT=9336 node cdp_pose_shots.mjs */
import fs from 'node:fs';
const PORT = process.env.CDP_PORT || '9336';
const URL = 'http://127.0.0.1:8127/web/fight.html';
const HIT = {
  jab: 0.467, cross: 1.25, 'lead-hook': 0.633,
  'rear-hook': 1.233, 'lead-uppercut': 0.8, 'rear-uppercut': 0.733
};

const ver = await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json();
const ws = new WebSocket(ver.webSocketDebuggerUrl);
let idc = 0; const pending = new Map(); const logs = [];
const send = (m, p = {}, s) => { const id = ++idc; const msg = { id, method: m, params: p }; if (s) msg.sessionId = s; ws.send(JSON.stringify(msg)); return new Promise((res, rej) => pending.set(id, { res, rej })); };
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) { const { res, rej } = pending.get(m.id); pending.delete(m.id); m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result); return; }
  if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') logs.push(m.params.args.map(a => a.value ?? a.description ?? '').join(' ').slice(0, 160));
};

ws.onopen = async () => {
  const { targetInfos } = await send('Target.getTargets');
  const t = targetInfos.find(x => x.type === 'page');
  const sid = (await send('Target.attachToTarget', { targetId: t.targetId, flatten: true })).sessionId;
  await send('Runtime.enable', {}, sid);
  await send('Page.enable', {}, sid);
  await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 720, deviceScaleFactor: 1, mobile: false }, sid);
  await send('Page.navigate', { url: URL }, sid);
  await new Promise(r => setTimeout(r, 22000));

  const shot = async (tag) => {
    const s = await send('Page.captureScreenshot', { format: 'png' }, sid);
    fs.writeFileSync(`/tmp/pose-${tag}.png`, Buffer.from(s.data, 'base64'));
    console.log('shot', tag);
  };

  const idle = await send('Runtime.evaluate', { returnByValue: true, awaitPromise: true, expression: `(async () => {
    const F = window.__fight; if (!F || !F.ready) return 'NOT_READY';
    const atk = F.chars.attack;
    const pose = window.FIGHT.attackPoses.stance;
    atk.root.position.set(...pose.t); atk.root.quaternion.set(...pose.q);
    atk.root.updateMatrixWorld(true);
    atk.mixer.stopAllAction();
    atk.actions[atk.idleClip].reset().play();
    atk.mixer.update(0.3);
    const A = F.ancher1;
    A.updateWorldMatrix(true, false);
    const ap = new atk.root.position.constructor().setFromMatrixPosition(A.matrixWorld);
    // 报告：站位下两只拳头到 ancher1 的距离 + 两人根节点位置
    const hands = [];
    atk.root.traverse(o => { if (o.isBone && /Hand$/.test(o.name)) { o.updateWorldMatrix(true,false); hands.push([o.name, +new atk.root.position.constructor().setFromMatrixPosition(o.matrixWorld).distanceTo(ap).toFixed(3)]); } });
    return JSON.stringify({ stance: pose.t, ancher: ap.toArray().map(n=>+n.toFixed(3)), hands, atkPos: atk.root.position.toArray().map(n=>+n.toFixed(3)) });
  })()` }, sid);
  console.log('idle state:', idle.result.value);
  await shot('idle');

  for (const [key, ht] of Object.entries(HIT)) {
    const r = await send('Runtime.evaluate', { returnByValue: true, awaitPromise: true, expression: `(async () => {
      const F = window.__fight;
      const atk = F.chars.attack;
      const pose = window.FIGHT.attackPoses['${key}'];
      atk.root.position.set(...pose.t); atk.root.quaternion.set(...pose.q);
      atk.mixer.stopAllAction();
      const clip = Object.keys(atk.actions).find(n => n.includes('${key}') || ('${key}'==='cross' && n==='attack-cross2') || ('${key}'==='rear-hook' && n==='attack-rear-hook2'));
      const a = atk.actions[clip];
      a.reset(); a.play(); a.clampWhenFinished = true;
      atk.mixer.setTime(${ht});
      atk.root.updateMatrixWorld(true);
      return clip;
    })()` }, sid);
    await new Promise(r2 => setTimeout(r2, 300));
    await shot(key.replace(/-/g, '_'));
    console.log(' ', key, '→ clip', r.result.value);
  }
  if (logs.length) console.log('errors:', [...new Set(logs)].join(' | '));
  process.exit(0);
};
