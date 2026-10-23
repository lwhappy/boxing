// Grid screenshots: sample the idle animation at K time points, fixed camera.
// usage: URL=... OUT_PREFIX=/tmp/grid_orig COUNT=8 node grid_shot.mjs
import fs from 'node:fs';

const PORT = process.env.CDP_PORT || '9222';
const URL_ = process.env.URL;
const PREFIX = process.env.OUT_PREFIX || '/tmp/grid';
const COUNT = Number(process.env.COUNT || 8);
const WAIT = Number(process.env.WAIT || 120000);

const ver = await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json();
console.log('cdp ok');
const ws = new WebSocket(ver.webSocketDebuggerUrl);
let idc = 0;
const pending = new Map();
const send = (method, params = {}, sessionId) => {
  const id = ++idc;
  const msg = { id, method, params };
  if (sessionId) msg.sessionId = sessionId;
  ws.send(JSON.stringify(msg));
  return new Promise((res, rej) => pending.set(id, { res, rej }));
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) {
    const { res, rej } = pending.get(m.id);
    pending.delete(m.id);
    m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result);
  }
};

ws.onopen = async () => {
  console.log('ws open');
  const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
  const sessionId = (await send('Target.attachToTarget', { targetId, flatten: true })).sessionId;
  await send('Page.enable', {}, sessionId);
  await send('Runtime.enable', {}, sessionId);
  await send('Page.navigate', { url: URL_ }, sessionId);

  const started = Date.now();
  let ready = false;
  while (Date.now() - started < WAIT) {
    await sleep(1500);
    const r = await send('Runtime.evaluate', { expression: 'window.__app && window.__app.ready', returnByValue: true }, sessionId);
    if (r.result.value === true) { ready = true; break; }
  }
  if (!ready) { console.log('NOT READY'); process.exit(3); }
  console.log('page ready');

  const dur = await send('Runtime.evaluate', {
    expression: `JSON.stringify({
      black: window.__app.chars.black.clips.find(c=>c.name==='black-idle').duration,
      red: window.__app.chars.red.clips.find(c=>c.name==='red-idle').duration
    })`,
    returnByValue: true
  }, sessionId);
  const durations = JSON.parse(dur.result.value);
  console.log('durations', durations);

  const closeups = process.env.CLOSEUP === '1';
  for (let i = 0; i < COUNT; i++) {
    const tb = (i / COUNT) * durations.black;
    const tr = (i / COUNT) * durations.red;
    await send('Runtime.evaluate', {
      expression: `(() => {
        const a = window.__app;
        for (const [k, t] of [['black', ${tb}], ['red', ${tr}]]) {
          const s = a.chars[k];
          s.currentAction.paused = true;
          s.currentAction.time = t % s.currentAction.getClip().duration;
          s.currentAction.play();
          s.mixer.update(0);
        }
        const cam = a.camera;
        const V = a.scene.position.constructor;   // THREE.Vector3
        ${closeups ? `
        const focus = (key) => {
          const s = a.chars[key];
          s.root.updateMatrixWorld(true);
          const pts = [];
          s.root.traverse(o => {
            if (o.isBone && /Head|Hand/i.test(o.name)) {
              pts.push(new V().setFromMatrixPosition(o.matrixWorld));
            }
          });
          const c = pts.reduce((acc, p) => acc.add(p), new V()).multiplyScalar(1 / pts.length);
          cam.position.set(c.x, c.y + 0.1, c.z + 0.8);
          a.controls.target.copy(c);
          cam.lookAt(c);
        };
        focus(${i % 2 === 0 ? "'black'" : "'red'"});
        ` : `
        cam.position.set(0.0, 1.05, 1.9);
        a.controls.target.set(0, 0.95, 0);
        cam.lookAt(0, 0.95, 0);
        `}
        a.controls.update();
        a.renderer.render(a.scene, a.camera);
      })()`,
      returnByValue: true
    }, sessionId);
    await sleep(200);
    const shot = await send('Page.captureScreenshot', { format: 'png' }, sessionId);
    fs.writeFileSync(`${PREFIX}_${i}.png`, Buffer.from(shot.data, 'base64'));
    console.log('saved', `${PREFIX}_${i}.png`, 't_black', tb.toFixed(2), 't_red', tr.toFixed(2));
  }
  await send('Target.closeTarget', { targetId });
  process.exit(0);
};
