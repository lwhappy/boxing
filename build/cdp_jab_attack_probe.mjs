/* Probe the jab-fight (attack phase): sample her LeftHand world trajectory
 * across the punch and capture screenshots — find where/how the arm "lifts". */
import fs from 'node:fs';

const URL = 'http://127.0.0.1:8945/moves/jab.html';
const OUT = 'build/captures';

const ver = await (await fetch('http://127.0.0.1:9222/json/version')).json();
const ws = new WebSocket(ver.webSocketDebuggerUrl);
let idc = 0; const pending = new Map();
const send = (method, params = {}, sessionId) => {
  const id = ++idc;
  ws.send(JSON.stringify({ id, method, params, sessionId }));
  return new Promise((res, rej) => pending.set(id, { res, rej }));
};
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) {
    const { res, rej } = pending.get(m.id); pending.delete(m.id);
    m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result);
  }
};
await new Promise(r => ws.onopen = r);
const { targetInfos } = await send('Target.getTargets');
const page = targetInfos.find(t => t.type === 'page');
const { sessionId: sid } = await send('Target.attachToTarget', { targetId: page.targetId, flatten: true });
await send('Runtime.enable', {}, sid);
await send('Page.enable', {}, sid);
await send('Emulation.setFocusEmulationEnabled', { enabled: true }, sid);
await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false }, sid);
await send('Page.navigate', { url: URL }, sid);
await new Promise(r => setTimeout(r, 12000));

const ev = async (expr) => {
  const r = await send('Runtime.evaluate', { returnByValue: true, expression: expr, awaitPromise: true }, sid);
  if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails).slice(0, 600));
  return r.result.value;
};
const shot = async (name) => {
  const s = await send('Page.captureScreenshot', { format: 'png' }, sid);
  fs.writeFileSync(`${OUT}/${name}.png`, Buffer.from(s.data, 'base64'));
};

console.log('hook:', await ev('!!window.__jab'));
console.log('fightImpact:', await ev('window.__jab.fightImpact'));
console.log('contactX:', await ev('window.__jab.contactX'));

/* find when settle ends / attack begins: stepTo a bit before, then sample */
// settle duration & phase timings — walk timeline manually via stepTo
const SETTLE_END = await ev(`(() => {
  // locate settle end by binary search on phase
  const j = window.__jab;
  let lo = 6, hi = 20;
  j.stepTo(lo);
  if (j.phase !== 'settle') { j.restart(); }
  // crude scan
  let t = 6;
  for (; t < 20; t += 0.25) { j.stepTo(t); if (j.phase === 'attack') break; }
  return t;
})()`);
console.log('attack begins ~', SETTLE_END);

/* sample glove trajectory during attack: use real-time-ish by stepping mixer
 * directly — evaluate jab-fight clip at i/96 of duration and read LeftHand */
const traj = await ev(`(() => {
  const j = window.__jab;
  const { woman, THREE } = j;
  const act = woman.actions['jab-fight'];
  const dur = act.getClip().duration;
  const hand = woman.bones.LeftHand;
  const head = null;
  const out = [];
  woman.mixer.stopAllAction();
  act.reset().setLoop(THREE.LoopOnce, 1).clampWhenFinished = true;
  act.setEffectiveTimeScale(1).setEffectiveWeight(1).play();
  for (let i = 0; i <= 48; i++) {
    const t = (dur * i) / 48;
    woman.mixer.setTime(t);
    woman.group.updateMatrixWorld(true);
    const p = hand.getWorldPosition(new THREE.Vector3());
    out.push({ t: +t.toFixed(3), x: +p.x.toFixed(3), y: +p.y.toFixed(3), z: +p.z.toFixed(3) });
  }
  woman.mixer.stopAllAction();
  return JSON.stringify({ dur: +dur.toFixed(3), rows: out });
})()`);
console.log(traj);

/* screenshots during the real attack phase: step through show timeline */
for (const off of [0.0, 0.15, 0.3, 0.45, 0.6]) {
  const t = await ev(`(() => { const j = window.__jab; j.stepTo(${SETTLE_END} + ${off}); return j.phase; })()`);
  await shot(`jabattack_${String(off).replace('.', '_')}`);
  console.log('shot', off, 'phase', t);
}
process.exit(0);
