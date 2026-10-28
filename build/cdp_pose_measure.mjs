/* For each punch: apply its authored pose, sample the clip, and find the
 * moment each hand is closest to the defender's head bone (mixamorigHead_*).
 * Clean rewrite — single page load, one loop, no shared mutable state. */
const PORT = process.env.CDP_PORT || '9336';
const URL = 'http://127.0.0.1:8127/web/fight.html';

const ver = await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json();
const ws = new WebSocket(ver.webSocketDebuggerUrl);
let idc = 0; const pending = new Map();
const send = (m, p = {}, s) => { const id = ++idc; const msg = { id, method: m, params: p }; if (s) msg.sessionId = s; ws.send(JSON.stringify(msg)); return new Promise((res, rej) => pending.set(id, { res, rej })); };
ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { const { res, rej } = pending.get(m.id); pending.delete(m.id); m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result); } };

const EXPR = `(async function(){
  const F = window.__fight;
  if (!F || !F.ready) return 'NOT_READY';
  const atk = F.chars.attack, def = F.chars.defence;
  const V = atk.root.position.constructor;
  const tmp = new V();

  // defender head bone (real target)
  let head = null;
  def.root.traverse(o => { if (!head && o.isBone && /mixamorigHead(_\\d+)?$/.test(o.name)) head = o; });
  if (!head) return 'NO_HEAD_BONE';

  // attack hands
  const hands = [];
  atk.root.traverse(o => { if (o.isBone && /Hand$/.test(o.name)) hands.push(o); });
  if (!hands.length) return 'NO_HANDS';

  const POSES = window.FIGHT.attackPoses;
  const MOVES = {
    jab: 'attack-jab', cross: 'attack-cross2', 'lead-hook': 'attack-lead-hook',
    'rear-hook': 'attack-rear-hook2', 'lead-uppercut': 'attack-lead-uppercut',
    'rear-uppercut': 'attack-rear-uppercut'
  };
  const out = {};
  for (const [key, clipName] of Object.entries(MOVES)) {
    const action = atk.actions[clipName];
    if (!action) { out[key] = 'NO_CLIP ' + clipName; continue; }
    const pose = POSES && POSES[key];
    if (pose) { atk.root.position.set(pose.t[0], pose.t[1], pose.t[2]); atk.root.quaternion.set(pose.q[0], pose.q[1], pose.q[2], pose.q[3]); }
    head.updateWorldMatrix(true, false);
    const H = new V().setFromMatrixPosition(head.matrixWorld);

    atk.mixer.stopAllAction();
    action.reset(); action.play();
    const dur = action.getClip().duration;
    let bestT = 0, bestD = Infinity;
    for (let t = 0; t <= dur + 1e-6; t += 1 / 60) {
      atk.mixer.setTime(t);
      atk.root.updateMatrixWorld(true);
      for (const h of hands) {
        h.updateWorldMatrix(true, false);
        tmp.setFromMatrixPosition(h.matrixWorld);
        const d = tmp.distanceTo(H);
        if (d < bestD) { bestD = d; bestT = t; }
      }
    }
    out[key] = { frame: Math.round(bestT * 30) + 1, t: +bestT.toFixed(3), minDist: +bestD.toFixed(3), dur: +dur.toFixed(2) };
  }
  return JSON.stringify(out);
})()`;

ws.onopen = async () => {
  const { targetInfos } = await send('Target.getTargets');
  const t = targetInfos.find(x => x.type === 'page');
  const sid = (await send('Target.attachToTarget', { targetId: t.targetId, flatten: true })).sessionId;
  await send('Runtime.enable', {}, sid);
  await send('Page.enable', {}, sid);
  await send('Page.navigate', { url: URL }, sid);
  await new Promise(r => setTimeout(r, 22000));
  const r = await send('Runtime.evaluate', { expression: EXPR, returnByValue: true, awaitPromise: true }, sid);
  console.log('RESULT:', r.result.value);
  process.exit(0);
};
