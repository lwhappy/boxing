/* QA the no-lift jab: verify the patched glove trajectory caps at LIFT_CAP,
 * check the new guard on the big stage, screenshot attack/impact beats. */
import fs from 'node:fs';

const PORT = '9222';
const URL = 'http://127.0.0.1:8945/moves/jab.html';
const TAG = process.argv[2] || 'nolift';

const ver = await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json();
const ws = new WebSocket(ver.webSocketDebuggerUrl);
let idc = 0; const pending = new Map(); const logs = [];
const send = (method, params = {}, sessionId) => {
  const id = ++idc;
  const msg = { id, method, params };
  if (sessionId) msg.sessionId = sessionId;
  ws.send(JSON.stringify(msg));
  return new Promise((res, rej) => pending.set(id, { res, rej }));
};
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) {
    const { res, rej } = pending.get(m.id); pending.delete(m.id);
    m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result);
    return;
  }
  if (m.method === 'Runtime.exceptionThrown')
    logs.push('EXC ' + JSON.stringify(m.params.exceptionDetails).slice(0, 400));
  if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error')
    logs.push('ERR ' + JSON.stringify(m.params.args).slice(0, 300));
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

ws.onopen = async () => {
  const { targetInfos } = await send('Target.getTargets');
  const page = targetInfos.find((t) => t.type === 'page');
  const { sessionId: sid } = await send('Target.attachToTarget', { targetId: page.targetId, flatten: true });
  await send('Runtime.enable', {}, sid);
  await send('Page.enable', {}, sid);
  await send('Emulation.setFocusEmulationEnabled', { enabled: true }, sid);
  await send('Emulation.setDeviceMetricsOverride', {
    width: +(process.env.W || 1280), height: +(process.env.H || 800),
    deviceScaleFactor: 1, mobile: false,
  }, sid);
  await send('Page.navigate', { url: URL }, sid);
  await sleep(12000);

  const ev = async (expr) => {
    const r = await send('Runtime.evaluate', { returnByValue: true, expression: expr }, sid);
    if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails).slice(0, 600));
    return r.result.value;
  };
  const shot = async (name) => {
    const s = await send('Page.captureScreenshot', { format: 'png' }, sid);
    fs.writeFileSync(`build/captures/jabnolift_${TAG}_${name}.png`, Buffer.from(s.data, 'base64'));
  };

  console.log('hook:', await ev('!!window.__jab'));
  console.log('contactX:', await ev('window.__jab.contactX.toFixed(3)'),
    'fightImpact:', await ev('window.__jab.fightImpact.toFixed(3)'),
    'gloveXF:', await ev('window.__jab.gloveXF.toFixed(3)'));

  /* 1. patched trajectory of the fight jab (no state pollution: standalone
   *    mixer eval, then restart the show afterwards) */
  const traj = await ev(`(() => {
    const j = window.__jab;
    const { woman, THREE } = j;
    const act = woman.actions['jab-fight'];
    const dur = act.getClip().duration;
    const hand = woman.bones.LeftHand;
    const out = [];
    woman.mixer.stopAllAction();
    act.reset().setLoop(THREE.LoopOnce, 1).clampWhenFinished = true;
    act.setEffectiveTimeScale(1).setEffectiveWeight(1).play();
    for (let i = 0; i <= 64; i++) {
      const t = (dur * i) / 64;
      woman.mixer.setTime(t);
      j.suppressLeadLift();
      woman.group.updateMatrixWorld(true);
      const p = hand.getWorldPosition(new THREE.Vector3());
      out.push({ t: +t.toFixed(3), x: +p.x.toFixed(3), y: +p.y.toFixed(3) });
    }
    woman.mixer.stopAllAction();
    return JSON.stringify({ dur: +dur.toFixed(3), maxY: Math.max(...out.map(r => r.y)), rows: out.filter((_, i) => i % 4 === 0) });
  })()`);
  console.log('PATCHED traj:', traj);

  /* 2. restart the show and walk the real timeline with screenshots */
  console.log(await ev('window.__jab.restart(); "restarted"'));
  // find attack start
  const attackAt = await ev(`(() => {
    const j = window.__jab;
    let t = 6;
    for (; t < 20; t += 0.25) { j.stepTo(t); if (j.phase === 'attack') break; }
    return t;
  })()`);
  console.log('attack begins ~', attackAt);

  // settle shot (new guard on the big stage)
  await ev(`window.__jab.stepTo(${attackAt} - 0.4)`);
  await shot('settle_guard');

  for (const off of [0.2, 0.4, 0.55, 0.75, 1.1]) {
    const st = await ev(`(() => { const j = window.__jab; j.stepTo(${attackAt} + ${off}); return JSON.stringify({ phase: j.phase, gloveY: (() => { j.woman.group.updateMatrixWorld(true); return +j.woman.bones.LeftHand.getWorldPosition(new j.THREE.Vector3()).y.toFixed(3); })() }); })()`);
    await shot(`attack_${String(off).replace('.', '_')}`);
    console.log('t+%s', off, st);
  }

  console.log('errors:', logs.length ? logs.slice(0, 8).join(' || ') : 'none');
  process.exit(0);
};
