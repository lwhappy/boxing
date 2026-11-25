/* Diagnose push-up page mobile overflow at 375px */
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
  return r.exceptionDetails ? 'EXC ' + (r.exceptionDetails.exception?.description || '').slice(0, 200) : r.result.value;
};

await send('Emulation.setDeviceMetricsOverride', { width: 375, height: 667, deviceScaleFactor: 2, mobile: true }, sid);
await send('Page.navigate', { url: 'http://127.0.0.1:8945/sport/push-up/?qa=ov' + Date.now() }, sid);
await sleep(8000);

console.log('doc:', await ev(`JSON.stringify({sw: document.documentElement.scrollWidth, iw: window.innerWidth, bw: document.body.scrollWidth})`));
console.log('overflowers:', await ev(`(() => {
  const out = [];
  const vw = window.innerWidth;
  document.querySelectorAll('*').forEach((el) => {
    const r = el.getBoundingClientRect();
    if (r.right > vw + 1 && r.width > 40) {
      out.push(el.tagName + '.' + String(el.className).slice(0, 40) + ' right=' + Math.round(r.right) + ' w=' + Math.round(r.width));
    }
  });
  return out.slice(0, 14).join(' | ');
})()`));
console.log('stage:', await ev(`(() => { const r = document.getElementById('pu-stage-big').getBoundingClientRect(); const s = getComputedStyle(document.getElementById('pu-stage-big')); return JSON.stringify({l: Math.round(r.left), r: Math.round(r.right), w: Math.round(r.width), h: Math.round(r.height), ml: s.marginLeft, mr: s.marginRight, minW: s.minWidth}); })()`));
console.log('bar:', await ev(`(() => { const b = document.querySelector('#pu-stage-big .stage-bar'); if (!b) return 'no bar'; const r = b.getBoundingClientRect(); const s = getComputedStyle(b); return JSON.stringify({w: Math.round(r.width), scrollW: b.scrollWidth, wrap: s.flexWrap, ws: s.whiteSpace}); })()`));
process.exit(0);
