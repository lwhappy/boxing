/* Mobile QA for /sport/push-up/: big-stage framing at 390px + render gate */
import fs from 'node:fs';

const ver = await (await fetch('http://127.0.0.1:9222/json/version')).json();
const ws = new WebSocket(ver.webSocketDebuggerUrl);
let idc = 0; const pending = new Map();
const send = (m, p = {}, s) => {
  const id = ++idc;
  ws.send(JSON.stringify({ id, method: m, params: p, sessionId: s }));
  return new Promise((res) => pending.set(id, res));
};
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id); }
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
await new Promise((r) => { ws.onopen = r; });

const { targetInfos } = await send('Target.getTargets');
const page = targetInfos.find((t) => t.type === 'page');
const { sessionId: sid } = await send('Target.attachToTarget', { targetId: page.targetId, flatten: true });
await send('Runtime.enable', {}, sid);
await send('Page.enable', {}, sid);
const ev = async (expr) => {
  const r = await send('Runtime.evaluate', { returnByValue: true, expression: expr }, sid);
  return r.exceptionDetails ? 'EXC ' + (r.exceptionDetails.exception?.description || '').slice(0, 300) : r.result.value;
};
const shot = async (name) => {
  const s = await send('Page.captureScreenshot', { format: 'png' }, sid);
  fs.writeFileSync(new URL('./captures/' + name + '.png', import.meta.url), Buffer.from(s.data, 'base64'));
};

/* --- 390px mobile --- */
await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true }, sid);
await send('Page.navigate', { url: 'http://127.0.0.1:8945/sport/push-up/?qa=m6' }, sid);
await sleep(9000);

console.log('fov:', await ev('window.__pu.big.camera.fov.toFixed(1)'));
console.log('aspect:', await ev('window.__pu.big.camera.aspect.toFixed(2)'));
console.log('errors:', await ev('window.__err || "none"'));

/* body extents in NDC: everything must be inside [-1, 1] */
console.log('body ndc x:', await ev(`(() => {
  const cam = window.__pu.big.camera;
  const root = window.__pu.big.root;
  const box = new (root.position.constructor().constructor === Object ? Object : Object)();
  return 'skip';
})()`));

/* project hands+feet into canvas px to prove the full span fits */
console.log('span:', await ev(`(() => {
  const cam = window.__pu.big.camera;
  const root = window.__pu.big.root;
  let minX = 1e9, maxX = -1e9, minY = 1e9, maxY = -1e9, n = 0;
  root.traverse((o) => {
    if (!o.isBone) return;
    const nm = o.name.toLowerCase();
    if (!/(hand|foot|head|hips|shoulder|knee)$|toebase$/.test(nm)) return;
    const p = o.getWorldPosition(new root.position.constructor()).project(cam);
    minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
    minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
    n++;
  });
  return JSON.stringify({ n, x: [+minX.toFixed(2), +maxX.toFixed(2)], y: [+minY.toFixed(2), +maxY.toFixed(2)] });
})()`));

/* screenshot of the hero (top of page) */
await ev('window.scrollTo(0, 0)');
await sleep(400);
const stage = await ev('(() => { const r = document.getElementById("pu-stage-big").getBoundingClientRect(); return JSON.stringify({x: r.x, y: r.y + window.scrollY, w: r.width, h: r.height}); })()');
await shot('m_pu_hero6', JSON.parse(stage));

/* --- render gate: scroll far away, animation must freeze --- */
await ev('document.getElementById("pu-muscle-note").scrollIntoView({block:"end"})');
await ev('window.scrollBy(0, 2500)');
await sleep(1200);
const t1 = await ev('window.__pu.big.act.time.toFixed(2)');
await sleep(1200);
const t2 = await ev('window.__pu.big.act.time.toFixed(2)');
console.log('gate offscreen: t1=' + t1 + ' t2=' + t2 + ' frozen=' + (t1 === t2));

/* scroll back, must resume */
await ev('window.scrollTo(0, 0)');
await sleep(1000);
const t3 = await ev('window.__pu.big.act.time.toFixed(2)');
await sleep(1000);
const t4 = await ev('window.__pu.big.act.time.toFixed(2)');
console.log('resume: t3=' + t3 + ' t4=' + t4 + ' running=' + (t3 !== t4));

process.exit(0);
