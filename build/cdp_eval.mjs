// Minimal CDP helper: evaluate an expression in the Mixamo page.
// usage: node cdp_eval.mjs '<expr>'   |   EXPR_FILE=/tmp/x.js node cdp_eval.mjs
import fs from 'node:fs';
const PORT = process.env.CDP_PORT || '9222';
const ver = await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json();
const ws = new WebSocket(ver.webSocketDebuggerUrl);
let idc = 0; const pending = new Map();
function send(method, params = {}, sessionId) {
  const id = ++idc; const msg = { id, method, params };
  if (sessionId) msg.sessionId = sessionId;
  ws.send(JSON.stringify(msg));
  return new Promise((res, rej) => pending.set(id, { res, rej }));
}
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) { const { res, rej } = pending.get(m.id); pending.delete(m.id);
    m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result); }
};
const expr = process.env.EXPR_FILE ? fs.readFileSync(process.env.EXPR_FILE, 'utf8') : (process.argv[2] || '1');
ws.onopen = async () => {
  try {
    const { targetInfos } = await send('Target.getTargets');
    if (process.env.LIST) { console.log(JSON.stringify(targetInfos.filter(t=>t.type==='page').map(t=>({id:t.targetId,url:t.url,title:t.title})), null, 1)); process.exit(0); }
    const t = targetInfos.find(x => x.type === 'page' && (x.url || '').includes('mixamo.com'));
    if (!t) { console.log('NO MIXAMO TARGET'); console.log(targetInfos.filter(x=>x.type==='page').map(x=>x.url).join('\n')); process.exit(3); }
    const sid = (await send('Target.attachToTarget', { targetId: t.targetId, flatten: true })).sessionId;
    await send('Runtime.enable', {}, sid);
    const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }, sid);
    if (r.exceptionDetails) console.log('EXCEPTION:', JSON.stringify(r.exceptionDetails).slice(0, 800));
    else console.log(typeof r.result.value === 'string' ? r.result.value : JSON.stringify(r.result.value, null, 1));
    process.exit(0);
  } catch (e) { console.log('ERR', e.message); process.exit(1); }
};
