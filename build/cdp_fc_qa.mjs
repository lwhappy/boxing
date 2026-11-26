import fs from 'node:fs';
const ver = await (await fetch('http://127.0.0.1:9222/json/version')).json();
const ws = new WebSocket(ver.webSocketDebuggerUrl);
let idc = 0; const pending = new Map();
const send = (m, p = {}, s) => { const id = ++idc; ws.send(JSON.stringify({ id, method: m, params: p, sessionId: s })); return new Promise((res) => pending.set(id, res)); };
ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
await new Promise((r) => ws.onopen = r);
const { targetInfos } = await send('Target.getTargets');
const page = targetInfos.find((t) => t.type === 'page');
const { sessionId: sid } = await send('Target.attachToTarget', { targetId: page.targetId, flatten: true });
await send('Runtime.enable', {}, sid);
await send('Page.enable', {}, sid);
const logs = [];
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data);
  if (m.method === 'Runtime.consoleAPICalled' && ['error', 'warning'].includes(m.params.type)) logs.push(m.params.type + ': ' + m.params.args.map(a => a.value ?? a.description ?? '').join(' ').slice(0, 200));
  if (m.method === 'Runtime.exceptionThrown') logs.push('exc: ' + (m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text || '').slice(0, 300));
});
const ev = async (expr) => { const r = await send('Runtime.evaluate', { returnByValue: true, awaitPromise: true, expression: expr }, sid); return r.exceptionDetails ? 'EXC ' + (r.exceptionDetails.exception?.description || '').slice(0, 300) : r.result.value; };
const shot = async (name) => { const s = await send('Page.captureScreenshot', { format: 'png' }, sid); fs.writeFileSync(`${import.meta.dirname}/captures/${name}.png`, Buffer.from(s.data, 'base64')); };

await send('Emulation.setDeviceMetricsOverride', { width: 1400, height: 950, deviceScaleFactor: 1, mobile: false }, sid);
await send('Page.navigate', { url: 'http://127.0.0.1:8947/sport/farmer-carry/' }, sid);
await sleep(9000);
console.log('ready:', await ev('typeof window.__fc'));
console.log('overflow:', await ev('document.documentElement.scrollWidth > document.documentElement.clientWidth'));
await shot('fc_hero');

/* numeric: each dumbbell centre must sit on its palm point, shaft along the
 * hand-to-hand line (perp ~0, along ~0) */
const fit = `(() => {
  const P = __fc.props, r = P.root; r.updateMatrixWorld(true);
  const toL = (o) => r.worldToLocal(o.getWorldPosition(new THREE_V())) ;
  return 'noop';
})()`;
const fitExpr = `(() => {
  const P = __fc.props, r = P.root; r.updateMatrixWorld(true);
  const V = (o) => o.getWorldPosition(new r.position.constructor());
  const pp = (h, k) => { const a = V(h), b = V(k); return a.add(b.sub(a).multiplyScalar(0.45)); };
  const pl = pp(P.handL, P.knucL), pr = pp(P.handR, P.knucR);
  const dl = V(P.dbL), dr = V(P.dbR);
  const axis = pr.clone().sub(pl).normalize();
  const off = (p, c) => { const rel = c.clone().sub(p); return (rel.addScaledVector(axis, -rel.dot(axis))).length(); };
  return 'span=' + pl.distanceTo(pr).toFixed(3) + ' dL=' + dl.distanceTo(pl).toFixed(3) + ' dR=' + dr.distanceTo(pr).toFixed(3) + ' perpL=' + off(pl, dl).toFixed(3) + ' perpR=' + off(pr, dr).toFixed(3);
})()`;
for (const t of [0, 1.2, 2.4]) {
  await ev(`__fc.seekBig(${t})`);
  await sleep(280);
  console.log('t=' + t, await ev(fitExpr));
}
await ev('__fc.setGroup("forearms")');
await sleep(900);
await shot('fc_hero_forearms');
await ev('__fc.setGroup("")');
await ev('document.getElementById("fc-stage-small").scrollIntoView({block:"center"})');
await sleep(900);
await shot('fc_small');

await send('Emulation.setDeviceMetricsOverride', { width: 414, height: 860, deviceScaleFactor: 2, mobile: true }, sid);
await sleep(400);
await ev('window.scrollTo(0,0)');
await sleep(900);
await shot('fc_mobile');
console.log('overflow mobile:', await ev('document.documentElement.scrollWidth > document.documentElement.clientWidth'));
console.log('logs:', JSON.stringify(logs.slice(0, 10)));
process.exit(0);
