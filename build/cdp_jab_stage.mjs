/* QA the moves/jab.html cinematic stage: step through the show with the
 * stepTo hook, screenshot each beat, report state. Usage: node build/cdp_jab_stage.mjs [tag] */
import fs from 'node:fs';

const PORT = process.env.CDP_PORT || '9222';
const URL = process.env.URL || 'http://127.0.0.1:8945/moves/jab.html';
const TAG = process.argv[2] || 'jabstage';
const W = +(process.env.W || 1280), H = +(process.env.H || 800);

const ver = await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json();
const ws = new WebSocket(ver.webSocketDebuggerUrl);
let idc = 0;
const pending = new Map();
const logs = [];
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
    const { res, rej } = pending.get(m.id);
    pending.delete(m.id);
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
  await send('Network.enable', {}, sid);
  await send('Network.setCacheDisabled', { cacheDisabled: true }, sid);
  await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: false }, sid);
  await send('Page.navigate', { url: URL }, sid);
  await sleep(9000);

  const evalJS = async (expr) => {
    const r = await send('Runtime.evaluate', { returnByValue: true, awaitPromise: true, expression: expr }, sid);
    if (r.exceptionDetails) return 'EXC ' + JSON.stringify(r.exceptionDetails).slice(0, 400);
    return r.result.value;
  };

  fs.mkdirSync('build/captures', { recursive: true });

  console.log('hook:', await evalJS(`!!window.__jab`));
  const meas = await evalJS(`JSON.stringify({
    phase: window.__jab && window.__jab.phase,
    fightClip: window.__jab ? !!window.__jab.woman.actions['jab-fight'] : null,
    jabImpact: window.__jab ? +window.__jab.jabImpact?.toFixed?.(3) : null,
    fightImpact: window.__jab ? +window.__jab.fightImpact?.toFixed?.(3) : null,
  })`);
  console.log('measured:', meas);
  const M = JSON.parse(meas);
  if (!M || !M.fightClip) { console.log('FAIL: fight clip not registered'); process.exit(1); }

  /* restart the show from t=0 and freeze it for deterministic stepping */
  await evalJS(`window.__jab.restart()`);
  await evalJS(`window.__jab.resume(); window.__jab.stepTo(0.001)`);

  const shot = async (name, waitMs = 80) => {
    await evalJS(`window.__jab.resume()`);
    await sleep(waitMs);
    const s = await send('Page.captureScreenshot', { format: 'png' }, sid);
    const path = `build/captures/jabstage_${TAG}_${name}.png`;
    fs.writeFileSync(path, Buffer.from(s.data, 'base64'));
    console.log('shot:', path, await evalJS(`window.__jab.phase`));
  };
  const step = async (t) => evalJS(`window.__jab.stepTo(${t.toFixed(3)})`);

  const jabImpact = M.jabImpact || 0.6;
  const fightImpact = M.fightImpact || 1.2;
  /* show timeline: intro(jabImpact) -> reveal(5*0.72+1.0 hold) -> shift .75 -> settle .55 -> attack(fightImpact) -> aftermath 2s */
  const tImpact = jabImpact;                  // intro jab reaches
  const tRevealMid = tImpact + 1.4;
  const tRevealEnd = tImpact + 5 * 0.72 + 0.95; // just before hold ends (0.05 slack for resume drift)
  const tSettle = tRevealEnd + 0.75 + 0.30;
  const tAttackStart = tRevealEnd + 0.75 + 0.55;

  await step(tRevealMid);
  await shot('reveal_mid', 300);
  await step(tRevealEnd);
  await shot('reveal_end', 200);

  await step(tSettle);
  await shot('settle', 120);

  await step(tAttackStart + fightImpact * 0.45);
  await shot('attack_early', 120);
  await step(tAttackStart + fightImpact - 0.1);
  await shot('attack_late', 60);

  await step(tAttackStart + fightImpact + 0.06);
  await shot('impact', 60);
  await step(tAttackStart + fightImpact + 1.0);
  await shot('aftermath_mid', 60);

  await step(tAttackStart + fightImpact + 2.05);
  await shot('docked', 300);
  console.log('final:', await evalJS(`JSON.stringify({ phase: window.__jab.phase, scrollW: document.documentElement.scrollWidth })`));

  if (logs.length) console.log('errors:', [...new Set(logs)].join(' | ').slice(0, 800));
  process.exit(0);
};
