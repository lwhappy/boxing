/* Lead-arm straightness QA: load the jab page, freeze at the reach frame,
 * measure the elbow interior angle (180 deg = perfectly straight arm) and
 * screenshot the frozen pose. Usage: node cdp_jab_arm_qa.mjs <tag> */
import fs from 'node:fs';

const PORT = '9222';
const URL = 'http://127.0.0.1:8945/moves/jab.html';
const TAG = process.argv[2] || 'arm';
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
  j.stepTo(8);          // past jabImpact -> frozen reach pose, callouts mid-reveal
  j.resume();
  return 'phase=' + j.phase;
})()`));
await sleep(800);
console.log('measure:', await ev(`(() => {
  const j = window.__jab; const { woman, THREE } = j;
  const B = woman.bones;
  const p = (b) => b.getWorldPosition(new THREE.Vector3());
  const sh = p(B.LeftArm), el = p(B.LeftForeArm), hd = p(B.LeftHand);
  const upper = el.clone().sub(sh), fore = hd.clone().sub(el);
  const ang = upper.angleTo(fore) * 180 / Math.PI;
  const reach = Math.abs(hd.x - sh.x);
  return JSON.stringify({ phase: j.phase, elbowDeg: +ang.toFixed(1),
    bendDeg: +(180 - ang).toFixed(1), reachX: +reach.toFixed(3) });
})()`));
const s = await send('Page.captureScreenshot', { format: 'png' }, sid);
fs.writeFileSync(`${import.meta.dirname}/captures/jabarm_${TAG}.png`, Buffer.from(s.data, 'base64'));
console.log('shot: build/captures/jabarm_' + TAG + '.png');
console.log('logs:', logs.length ? logs.join('\n') : '(none)');
process.exit(0);
