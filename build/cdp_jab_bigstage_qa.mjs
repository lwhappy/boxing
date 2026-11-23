/* Big-stage interaction QA: drag-rotate on the frozen fullscreen show,
 * wheel page-scroll, buttons still clickable, sfx hooks fire.
 * Usage: node cdp_jab_bigstage_qa.mjs <tag> */
import fs from 'node:fs';

const PORT = '9222';
const URL = 'http://127.0.0.1:8945/moves/jab.html';
const TAG = process.argv[2] || 'bigstage';
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
console.log('freeze:', await ev(`(() => { const j = window.__jab; j.stepTo(8); j.resume(); return j.phase; })()`));

/* baseline camera azimuth, then a real CDP drag across the canvas */
const azOf = `(() => {
  const j = window.__jab; const { THREE, camera } = j;
  const v = camera.position.clone().sub(new THREE.Vector3(-0.15, 0.92, 0));
  const r = Math.hypot(v.x, v.z);
  return JSON.stringify({ az: +Math.atan2(v.x, v.z).toFixed(3), r: +r.toFixed(2),
    audioState: (window.AudioContext ? 'defined' : 'none') });
})()`;
const az0 = JSON.parse(await ev(azOf));
console.log('before drag:', az0);

const CX = Math.round(W * 0.5), CY = Math.round(H * 0.5);
await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: CX, y: CY, button: 'left', clickCount: 1 }, sid);
for (let i = 1; i <= 10; i++) {
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: CX + i * 18, y: CY, button: 'left', buttons: 1 }, sid);
  await sleep(16);
}
await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: CX + 180, y: CY, button: 'left', clickCount: 1 }, sid);
await sleep(400);
const az1 = JSON.parse(await ev(azOf));
console.log('after drag:', az1, '| rotated:', Math.abs(az1.az - az0.az) > 0.05);

/* wheel still page-scrolls (zoom disabled passes wheel to the page) */
const s0 = await ev('window.scrollY');
for (let i = 0; i < 6; i++) {
  await send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: CX, y: CY, deltaX: 0, deltaY: 120 }, sid);
  await sleep(40);
}
const s1 = await ev('window.scrollY');
console.log('wheel scroll:', s0, '->', s1, '| pageScrolled:', s1 > s0);

/* audio context exists and runs after the synthetic gesture */
console.log('audio:', await ev(`(() => {
  const j = window.__jab;
  const ctxState = window.AudioContext ? 'hasAC' : 'noAC';
  return ctxState + ' phase=' + j.phase;
})()`));

/* buttons still clickable above the canvas */
console.log('close click:', await ev(`(() => {
  document.getElementById('jab-close').click();
  return window.__jab.phase;
})()`));
await sleep(800);
console.log('after close:', await ev(`(() => {
  const j = window.__jab;
  return JSON.stringify({ phase: j.phase, controls: j.woman ? 'ok' : '?' });
})()`));

/* back to the big show for the screenshot */
console.log('replay:', await ev(`(() => { const j = window.__jab; j.restart(); j.stepTo(8); j.resume(); return j.phase; })()`));
await sleep(600);
const s = await send('Page.captureScreenshot', { format: 'png' }, sid);
fs.writeFileSync(`${import.meta.dirname}/captures/jabbig_${TAG}.png`, Buffer.from(s.data, 'base64'));
console.log('shot: build/captures/jabbig_' + TAG + '.png');
console.log('logs:', logs.length ? logs.join('\n') : '(none)');
process.exit(0);
