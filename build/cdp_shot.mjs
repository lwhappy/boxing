import fs from 'node:fs';
const PORT = process.env.CDP_PORT || '9222';
const OUT = process.env.SHOT || '/tmp/mixamo.png';
const ver = await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json();
const ws = new WebSocket(ver.webSocketDebuggerUrl);
let idc = 0; const pending = new Map();
const send = (m, p = {}, s) => { const id = ++idc; const msg = { id, method: m, params: p }; if (s) msg.sessionId = s; ws.send(JSON.stringify(msg)); return new Promise((res, rej) => pending.set(id, { res, rej })); };
ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { const { res, rej } = pending.get(m.id); pending.delete(m.id); m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result); } };
ws.onopen = async () => {
  const { targetInfos } = await send('Target.getTargets');
  const t = targetInfos.find(x => x.type === 'page' && (x.url||'').includes('mixamo.com'));
  const sid = (await send('Target.attachToTarget', { targetId: t.targetId, flatten: true })).sessionId;
  await send('Page.enable', {}, sid);
  const r = await send('Page.captureScreenshot', { format: 'png' }, sid);
  fs.writeFileSync(OUT, Buffer.from(r.data, 'base64'));
  console.log('saved', OUT);
  process.exit(0);
};
