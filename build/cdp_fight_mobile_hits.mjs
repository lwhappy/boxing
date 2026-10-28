/* Mobile portrait: click every punch and check the pair stays inside the stage
 * at the moment of impact. Screenshots one impact for eyeballing.
 * node build/cdp_fight_mobile_hits.mjs [url] */
import fs from 'node:fs';
const URL_ = process.argv[2] || 'http://127.0.0.1:8958/training.html';
const PORT = process.env.CDP_PORT || '9333';

const ver = await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json();
const ws = new WebSocket(ver.webSocketDebuggerUrl);
let idc = 0; const pending = new Map();
const send = (m, p = {}, s) => {
  const id = ++idc; const msg = { id, method: m, params: p }; if (s) msg.sessionId = s;
  ws.send(JSON.stringify(msg)); return new Promise((res, rej) => pending.set(id, { res, rej }));
};
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) { const { res, rej } = pending.get(m.id); pending.delete(m.id);
    m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result); }
};
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const MEASURE = `(async () => {
  const f = window.__fight;
  const T = await import('/vendor/three/three.module.min.js');
  const cam = f.camera, rect = document.getElementById('fight-canvas').getBoundingClientRect();
  const box = new T.Box3().setFromObject(f.model);
  let minX = 1e9, maxX = -1e9, minY = 1e9, maxY = -1e9;
  const v = new T.Vector3();
  for (let i = 0; i < 8; i++) {
    v.set(i & 1 ? box.max.x : box.min.x, i & 2 ? box.max.y : box.min.y, i & 4 ? box.max.z : box.min.z).project(cam);
    minX = Math.min(minX, v.x); maxX = Math.max(maxX, v.x);
    minY = Math.min(minY, v.y); maxY = Math.max(maxY, v.y);
  }
  return {
    fillW: +(((maxX - minX) / 2) * 100).toFixed(1),
    fillH: +(((maxY - minY) / 2) * 100).toFixed(1),
    overflow: { left: minX < -1, right: maxX > 1, top: maxY > 1, bottom: minY < -1 }
  };
})()`;

ws.onopen = async () => {
  const { targetInfos } = await send('Target.getTargets');
  const t = targetInfos.find(x => x.type === 'page');
  const sid = (await send('Target.attachToTarget', { targetId: t.targetId, flatten: true })).sessionId;
  await send('Runtime.enable', {}, sid);
  await send('Page.enable', {}, sid);
  await send('Network.enable', {}, sid);
  await send('Network.setCacheDisabled', { cacheDisabled: true }, sid);
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true }, sid);
  const ev = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }, sid);
    if (r.exceptionDetails) return { error: r.exceptionDetails.exception?.description || r.exceptionDetails.text };
    return r.result.value;
  };
  await send('Page.navigate', { url: URL_ }, sid);
  for (let i = 0; i < 300; i++) { await sleep(250); if (await ev(`!!(window.__fight&&window.__fight.ready)`) === true) break; }
  await sleep(700);

  const keys = ['jab', 'cross', 'lead-hook', 'rear-hook', 'lead-uppercut', 'rear-uppercut'];
  const shot = async (path) => {
    const s = await send('Page.captureScreenshot', { format: 'png' }, sid);
    fs.writeFileSync(path, Buffer.from(s.data, 'base64'));
  };
  for (const k of keys) {
    await ev(`window.__fight.playPunch('${k}'); true`);
    /* wait until the impact flash spawns, then measure 120ms later */
    for (let i = 0; i < 120; i++) { await sleep(30); if (await ev(`window.__fight.effects() > 0`) === true) break; }
    await sleep(120);
    console.log(k, JSON.stringify(await ev(MEASURE)));
    if (k === 'rear-uppercut') await shot('/tmp/fight-mobile-impact.png');
    /* let it settle back to idle before the next punch */
    for (let i = 0; i < 120; i++) { await sleep(60); if (await ev(`window.__fight.phase() === 'idle'`) === true) break; }
    await sleep(400);
  }
  process.exit(0);
};
