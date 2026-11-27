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
  if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'log') logs.push(m.params.args.map(a => a.value ?? '').join(' ').slice(0, 120));
  if (m.method === 'Runtime.exceptionThrown') logs.push('exc: ' + (m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text || '').slice(0, 300));
});
const ev = async (expr) => { const r = await send('Runtime.evaluate', { returnByValue: true, awaitPromise: true, expression: expr }, sid); return r.exceptionDetails ? 'EXC ' + (r.exceptionDetails.exception?.description || '').slice(0, 300) : r.result.value; };
const shot = async (name) => { const s = await send('Page.captureScreenshot', { format: 'png' }, sid); fs.writeFileSync(`${import.meta.dirname}/captures/${name}.png`, Buffer.from(s.data, 'base64')); };

await send('Emulation.setDeviceMetricsOverride', { width: 1400, height: 950, deviceScaleFactor: 1, mobile: false }, sid);
await send('Page.navigate', { url: 'http://127.0.0.1:8938/sport/farmer-carry/?r=2' }, sid);
await sleep(3500);

/* 1. initial state: grab phase, bells on the ground */
console.log('phase0:', await ev('__fc.phase()'), '| dbMode0:', await ev('__fc.dbMode()'));
const yExpr = `(() => { const P = __fc.props; P.root.updateMatrixWorld(true);
  const V = (o) => o.getWorldPosition(new P.root.position.constructor());
  return 'yL=' + V(P.dbL).y.toFixed(3) + ' yR=' + V(P.dbR).y.toFixed(3); })()`;
console.log('bell heights (ground):', await ev(yExpr));
await shot('fcg_ground');

/* 2. fast-forward into the grab. Sample states */
await sleep(4000);
await shot('fcg_mid_grab');
console.log('mid:', await ev('__fc.phase()'), await ev('__fc.dbMode()'), await ev(yExpr));

/* 3. wait past the grab end (~8.7s) — must be carry + hands */
await sleep(6000);
console.log('end:', await ev('__fc.phase()'), await ev('__fc.dbMode()'), await ev(yExpr));
await shot('fcg_carry');

/* 4. palms fit during carry */
const fitExpr = `(() => {
  const P = __fc.props, r = P.root; r.updateMatrixWorld(true);
  const V = (o) => o.getWorldPosition(new r.position.constructor());
  const pp = (h, m) => { const a = V(h), b = V(m); return a.add(b.sub(a).multiplyScalar(0.45)); };
  const pl = pp(P.handL, P.midL), pr = pp(P.handR, P.midR);
  return 'dL=' + V(P.dbL).distanceTo(pl).toFixed(3) + ' dR=' + V(P.dbR).distanceTo(pr).toFixed(3);
})()`;
console.log('palm fit:', await ev(fitExpr));
console.log('contact log:', logs.filter(l => l.includes('contact')));
console.log('exc:', logs.filter(l => l.startsWith('exc')));
process.exit(0);
