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
const ev = async (expr) => { const r = await send('Runtime.evaluate', { returnByValue: true, expression: expr }, sid); return r.exceptionDetails ? 'EXC ' + JSON.stringify(r.exceptionDetails).slice(0, 300) : r.result.value; };
const shot = async (name) => { const s = await send('Page.captureScreenshot', { format: 'png' }, sid); fs.writeFileSync(`${import.meta.dirname}/captures/dock_${name}.png`, Buffer.from(s.data, 'base64')); console.log('shot', name); };
await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false }, sid);
await send('Page.navigate', { url: 'http://127.0.0.1:8945/combos/combo_jab_cross_hook.html' }, sid);
await sleep(4500);
console.log('ver:', await ev(`document.querySelector('script[src*="combo-bag-stage"]').src`));
await ev('__move.restart()');
// jump to end of combo -> settle -> paused
await ev('__move.stepTo(__move.plan.reduce((s,p)=>s+p.realDur,0.4)+0.3)');
await sleep(200);
await shot('paused_before');
console.log('phase:', await ev('__move.phase'), 'gx:', await ev('__move.woman.group.position.x.toFixed(2)'), 'tgt:', await ev('__move.camera.position.x.toFixed(2)+","+__move.camera.position.z.toFixed(2)'));
// wait settle -> paused naturally
await ev('__move.resume()');
await sleep(2500);
console.log('phase:', await ev('__move.phase'));
await shot('paused_after');
// click Close
const r = JSON.parse(await ev(`(() => { const b = document.getElementById('jab-close').getBoundingClientRect(); return JSON.stringify({ x: Math.round(b.left + b.width/2), y: Math.round(b.top + b.height/2), vis: b.width > 0 }); })()`));
await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: r.x, y: r.y, button: 'left', clickCount: 1 }, sid);
await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: r.x, y: r.y, button: 'left', clickCount: 1 }, sid);
await sleep(2200);
await shot('docked');
console.log('docked gx:', await ev('__move.woman.group.position.x.toFixed(2)'), 'tgt:', await ev(`(() => { const t = __move.woman; return 'ok'; })()`), 'phase:', await ev('__move.phase'));
process.exit(0);
