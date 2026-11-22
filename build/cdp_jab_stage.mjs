/* QA the moves/jab.html solo jab show: step through the show with the stepTo
 * hook, screenshot each beat, report state. Also exercises the Close button
 * (dock to the small annotated stage) and the docked Replay (back to big).
 * Usage: node build/cdp_jab_stage.mjs [tag] */
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
  const click = async (id) => {
    const r = await evalJS(`document.getElementById('${id}').getBoundingClientRect().toJSON()`);
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: r.x + r.width / 2, y: r.y + r.height / 2, button: 'left', clickCount: 1 }, sid);
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: r.x + r.width / 2, y: r.y + r.height / 2, button: 'left', clickCount: 1 }, sid);
  };

  fs.mkdirSync('build/captures', { recursive: true });

  console.log('hook:', await evalJS(`!!window.__jab`));
  const meas = await evalJS(`JSON.stringify({
    phase: window.__jab && window.__jab.phase,
    jabImpact: window.__jab ? +(window.__jab.jabImpact?.toFixed?.(3) ?? null) : null,
  })`);
  console.log('measured:', meas);
  const M = JSON.parse(meas);
  if (!M || M.jabImpact === null) { console.log('FAIL: jab probe missing'); process.exit(1); }

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
  /* show timeline: intro(jabImpact) -> reveal(5*0.72 stagger + 1.0 hold) -> paused */
  const tRevealMid = jabImpact + 1.4;
  const tRevealEnd = jabImpact + 5 * 0.72 + 0.95;   // just before hold ends
  const tPaused = jabImpact + 5 * 0.72 + 1.1;       // buttons should be up

  await step(tRevealMid);
  await shot('reveal_mid', 300);
  await step(tRevealEnd);
  await shot('reveal_end', 200);

  await step(tPaused);
  await shot('paused_buttons', 200);
  console.log('paused state:', await evalJS(`JSON.stringify({
    phase: window.__jab.phase,
    actionsShown: getComputedStyle(document.getElementById('jab-actions')).display,
    closeShown: !document.getElementById('jab-close').closest('.jab-actions').hidden,
  })`));

  /* Close -> docked small stage, annotated pose kept */
  await click('jab-close');
  await sleep(300);
  await shot('docked', 250);
  console.log('docked state:', await evalJS(`JSON.stringify({
    phase: window.__jab.phase,
    stageCls: document.getElementById('jab-stage').className,
    calloutsShown: document.querySelectorAll('.hero-callout.show').length,
    wordShown: document.querySelector('.hero-word').classList.contains('show'),
    scrollW: document.documentElement.scrollWidth,
  })`));

  /* docked Replay -> back to the big show */
  await click('jab-replay');
  await sleep(400);
  await shot('replay_big', 150);
  console.log('after docked replay:', await evalJS(`JSON.stringify({
    phase: window.__jab.phase,
    stageCls: document.getElementById('jab-stage').className,
  })`));

  if (logs.length) console.log('errors:', [...new Set(logs)].join(' | ').slice(0, 800));
  process.exit(0);
};
