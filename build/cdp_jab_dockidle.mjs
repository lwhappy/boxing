/* Docked-idle QA: fast-forward to the paused state, click Close, verify the
 * docked stage shows her idle at 45° out-of-screen with callouts hidden,
 * and capture a screenshot. */
import fs from 'node:fs';

const PORT = '9222';
const URL = 'http://127.0.0.1:8945/moves/jab.html';
const TAG = process.argv[2] || 'dockidle';
const W = +(process.env.W || 1280);
const H = +(process.env.H || 800);

const ver = await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json();
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
    const { res, rej } = pending.get(m.id);
    pending.delete(m.id);
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
await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: false }, sid);
await send('Emulation.setFocusEmulationEnabled', { enabled: true }, sid);
const logs = [];
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data);
  if (m.method === 'Runtime.exceptionThrown') logs.push('EXC ' + JSON.stringify(m.params.exceptionDetails).slice(0, 600));
  if (m.method === 'Runtime.consoleAPICalled' && ['error', 'warning'].includes(m.params.type)) {
    logs.push(m.params.type + ': ' + m.params.args.map((a) => a.value || a.description || '').join(' ').slice(0, 400));
  }
});
await send('Page.navigate', { url: URL }, sid);
await sleep(9000);

const ev = async (expr) => {
  const r = await send('Runtime.evaluate', { returnByValue: true, expression: expr }, sid);
  if (r.exceptionDetails) return 'EXC ' + JSON.stringify(r.exceptionDetails).slice(0, 500);
  return r.result.value;
};

console.log('hook:', await ev('!!window.__jab'));
console.log(await ev(`(() => {
  const j = window.__jab;
  j.stepTo(8);
  j.resume();                 // stepTo stops the loop for exact-time QA — real users never hit this
  document.getElementById('jab-close').click();
  return 'clicked-close phase=' + j.phase;
})()`));
await sleep(1600);
console.log('docked:', await ev(`(() => {
  const j = window.__jab; const { woman, THREE } = j;
  const g = (b) => { const v = b.getWorldPosition(new THREE.Vector3()); return [+v.x.toFixed(2), +v.y.toFixed(2), +v.z.toFixed(2)]; };
  const B = woman.bones;
  const cam = j.camera.position;
  const c = document.getElementById('stage-canvas');
  const rect = c.getBoundingClientRect();
  return JSON.stringify({
    phase: j.phase,
    yaw: +woman.group.rotation.y.toFixed(3),
    camera: [+cam.x.toFixed(2), +cam.y.toFixed(2), +cam.z.toFixed(2)],
    canvas: { w: c.width, h: c.height, rect: [+rect.width.toFixed(0), +rect.height.toFixed(0)] },
    aspect: +(j.camera.aspect || 0).toFixed(3),
    groupVisible: woman.group.visible,
    hips: g(B.Hips), lHand: g(B.LeftHand), rHand: g(B.RightHand)
  });
})()`));
const s = await send('Page.captureScreenshot', { format: 'png' }, sid);
fs.writeFileSync(`build/captures/jabstage_${TAG}_docked.png`, Buffer.from(s.data, 'base64'));
console.log('shot: build/captures/jabstage_' + TAG + '_docked.png');
/* yaw sweep: rotate her through candidates and shoot each */
for (const yaw of [1.571, 1.963, 2.356, 2.749, 3.142]) {
  console.log('yaw', yaw, await ev(`(() => { window.__jab.woman.group.rotation.y = ${yaw}; return 'set'; })()`));
  await sleep(450);
  const s2 = await send('Page.captureScreenshot', { format: 'png' }, sid);
  fs.writeFileSync(`build/captures/jabyaw_${yaw.toFixed(2)}.png`, Buffer.from(s2.data, 'base64'));
}
console.log('sweep done');
await sleep(700);
console.log('loop:', await ev(`(() => {
  const j = window.__jab;
  return JSON.stringify({ frames: j.frames, running: j.running,
    info: { calls: j.renderer.info.render.calls, tris: j.renderer.info.render.triangles },
    domW: j.renderer.domElement.width, domH: j.renderer.domElement.height,
    cssW: j.renderer.domElement.style.width });
})()`));
console.log('logs:', logs.length ? logs.join('\n') : '(none)');
process.exit(0);
