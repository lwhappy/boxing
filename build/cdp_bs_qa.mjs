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
await send('Page.navigate', { url: 'http://127.0.0.1:8945/sport/back-squat/' }, sid);
await sleep(9000);
console.log('ready:', await ev('typeof window.__bs'), 'overflow:', await ev('document.documentElement.scrollWidth > document.documentElement.clientWidth'));
// hand-to-bar fit: bar centre must sit on the hand-to-hand line (perp distance ~0)
const fit = `__bs.barFit()`;
for (const t of [0, 0.6, 1.0, 1.8, 2.4]) {
  await ev(`__bs.seekBig(${t}); null`);
  console.log('t=' + t, await ev(fit));
}
// freeze at bottom of the squat to inspect the bar
await ev('__bs.seekBig(1.0)');
await sleep(800);
await shot('bs_hero_bottom');
await ev('__bs.seekBig(0)');
await sleep(600);
await shot('bs_hero_top');
await ev('__bs.setGroup("quads")');
await sleep(900);
await ev('document.getElementById("bs-stage-small").scrollIntoView({block:"center"})');
await sleep(700);
await shot('bs_small_quads');
console.log('small barbell hidden:', await ev('__bs.small ? __bs.small.root.traverse ? (() => { let f = false; __bs.small.root.traverse(o => { if (o.name.toLowerCase().includes("barbell") && o.visible) f = true; }); return f ? "VISIBLE(bad)" : "hidden"; })() : "n/a" : "no small"'));
console.log('logs:', JSON.stringify(logs.slice(0, 10)));
process.exit(0);
