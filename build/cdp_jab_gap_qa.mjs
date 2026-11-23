// Measure gap between docked figure feet, canvas bottom, and Replay button.
// Usage: node cdp_jab_gap_qa.mjs
import fs from 'node:fs';

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
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
await new Promise((r) => ws.onopen = r);
const { targetInfos } = await send('Target.getTargets');
const page = targetInfos.find((t) => t.type === 'page');
const { sessionId: sid } = await send('Target.attachToTarget', { targetId: page.targetId, flatten: true });
await send('Runtime.enable', {}, sid);
await send('Page.enable', {}, sid);
const ev = async (expr) => {
  const r = await send('Runtime.evaluate', { returnByValue: true, expression: expr }, sid);
  if (r.exceptionDetails) return 'EXC ' + JSON.stringify(r.exceptionDetails).slice(0, 400);
  return r.result.value;
};

const run = async (tag, W, H, mobile) => {
  await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile }, sid);
  await send('Page.navigate', { url: 'http://127.0.0.1:8945/moves/jab.html' }, sid);
  await sleep(9000);
  await ev(`(() => { const j = window.__jab; j.stepTo(8); j.resume(); document.getElementById('jab-close').click(); return 1; })()`);
  await sleep(1000);
  const out = await ev(`(() => {
    const j = window.__jab; const { woman, THREE, camera } = j;
    const c = document.getElementById('stage-canvas');
    const r = c.getBoundingClientRect();
    woman.group.updateMatrixWorld(true);
    let minX = 1e9, maxX = -1e9, maxY = -1e9;
    const v = new THREE.Vector3();
    woman.root.traverse((o) => {
      if (!o.isMesh || !o.geometry) return;
      const pos = o.geometry.attributes.position;
      const step = Math.max(1, Math.floor(pos.count / 600));
      for (let i = 0; i < pos.count; i += step) {
        v.fromBufferAttribute(pos, i);
        if (o.isSkinnedMesh) o.applyBoneTransform(i, v);
        v.applyMatrix4(o.matrixWorld); v.project(camera);
        const x = r.left + (v.x * 0.5 + 0.5) * r.width;
        const y = r.top + (-v.y * 0.5 + 0.5) * r.height;
        if (x < minX) minX = x; if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
    });
    const btn = document.getElementById('jab-replay').getBoundingClientRect();
    return JSON.stringify({ vp: [innerWidth, innerHeight],
      canvas: { bottom: Math.round(r.bottom), h: Math.round(r.height) },
      fig: { minX: Math.round(minX), maxX: Math.round(maxX), maxY: Math.round(maxY) },
      gapFigToCanvas: Math.round(r.bottom - maxY),
      gapCanvasToBtn: Math.round(btn.top - r.bottom),
      btn: { top: Math.round(btn.top), h: Math.round(btn.height) } });
  })()`);
  console.log(tag, out);
  const s = await send('Page.captureScreenshot', { format: 'png' }, sid);
  fs.writeFileSync(`${import.meta.dirname}/captures/jabgap_${tag}.png`, Buffer.from(s.data, 'base64'));
};
await run('desk', 1280, 800, false);
await run('mob', 390, 844, true);
process.exit(0);
