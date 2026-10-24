/* CDP 测试（全招式）：依次播放 6 个动作，记录每一击的锚点与贴合误差
 * node build/cdp_training_all.mjs http://127.0.0.1:8958/training.html
 */
import fs from 'node:fs';

const URL = process.argv[2] || 'http://127.0.0.1:8958/training.html';
const PORT = process.env.CDP_PORT || '9333';

const ver = await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json();
const ws = new WebSocket(ver.webSocketDebuggerUrl);
let idc = 0;
const pending = new Map();
const send = (method, params = {}, sessionId) => {
  const id = ++idc;
  const msg = { id, method, params };
  if (sessionId) msg.sessionId = sessionId;
  ws.send(JSON.stringify(msg));
  return new Promise((res, rej) => pending.set(id, { res, rej }));
};
const logs = [];
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) {
    const { res, rej } = pending.get(m.id); pending.delete(m.id);
    m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result); return;
  }
  if (m.method === 'Runtime.exceptionThrown') logs.push('[exception] ' + JSON.stringify(m.params.exceptionDetails).slice(0, 300));
  if (m.method === 'Runtime.consoleAPICalled' && ['error', 'warning'].includes(m.params.type)) {
    logs.push(`[${m.params.type}] ` + m.params.args.map(a => a.value ?? a.description ?? '').join(' ').slice(0, 200));
  }
};
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

ws.onopen = async () => {
  const { targetInfos } = await send('Target.getTargets');
  const t = targetInfos.find(x => x.type === 'page');
  const sid = (await send('Target.attachToTarget', { targetId: t.targetId, flatten: true })).sessionId;
  await send('Runtime.enable', {}, sid);
  await send('Page.enable', {}, sid);
  const ev = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }, sid);
    if (r.exceptionDetails) return { error: r.exceptionDetails.text + ' ' + (r.exceptionDetails.exception?.description || '') };
    return r.result.value;
  };

  await send('Page.navigate', { url: URL }, sid);
  let ready = false;
  for (let i = 0; i < 200; i++) {
    await sleep(300);
    if (await ev(`!!(window.__training && window.__training.getCurrent)`) === true) { ready = true; break; }
  }
  if (!ready) { console.log('NOT READY', logs); process.exit(1); }

  console.log('audio =', JSON.stringify(await ev(`window.__training.getAudio()`)));

  // 全选六个动作，点确认
  await ev(`[...document.querySelectorAll('.combo-btn[data-move]')].forEach(b=>b.click()); true`);
  await ev(`document.getElementById('combo-confirm').click(); true`);

  const hits = [];
  const steps = [];
  let seen = new Set();
  for (let i = 0; i < 400; i++) {
    await sleep(80);
    const h = await ev(`window.__lastHit || null`);
    if (h && !seen.has(h.name)) {
      seen.add(h.name); hits.push(h);
      const st = await ev(`window.__lastStep || null`);
      if (st) steps.push(st);
    }
    const locked = await ev(`document.getElementById('combo-bar').classList.contains('locked')`);
    if (!locked && hits.length) break;
  }
  console.log('hits =');
  for (const h of hits) console.log('  ', JSON.stringify(h));
  console.log('hits count =', hits.length, '/ 6');
  console.log('steps =');
  for (const s of steps) console.log('  ', JSON.stringify({ name: s.name, crouchDeg: s.crouchDeg, gapY: s.gapY, delta: s.delta }));
  console.log('endState =', JSON.stringify(await ev(`(() => {
    const T = window.__training;
    return { pos: T.attackerRoot.position.toArray().map(n=>+n.toFixed(3)), hint: document.getElementById('combo-hint').textContent };
  })()`)));
  console.log('LOGS:', [...new Set(logs)].join('\n') || '(none)');

  const shot = await send('Page.captureScreenshot', { format: 'png' }, sid);
  fs.writeFileSync('/tmp/cdp-training-all.png', Buffer.from(shot.data, 'base64'));
  process.exit(0);
};
