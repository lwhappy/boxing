/* 验证连招中间不后撤：采样进攻方根位置轨迹，检查两拳之间是否往基准位回撤
 * node build/cdp_combo_flow.mjs http://127.0.0.1:8958/training.html
 */
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
  if (m.method === 'Runtime.exceptionThrown') logs.push('[exception] ' + JSON.stringify(m.params.exceptionDetails).slice(0, 200));
  if (m.method === 'Runtime.consoleAPICalled' && ['error', 'warning'].includes(m.params.type)) {
    logs.push(`[${m.params.type}] ` + m.params.args.map(a => a.value ?? a.description ?? '').join(' ').slice(0, 150));
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

  /* 2026-10-23 起动画原位化：连招全程不做任何移动。
   * 新不变量 = 进攻方根位置全程不变（< 5mm），且 6 拳依次命中。 */
  const base = await ev(`(() => { const p = window.__training.attackerRoot.position;
    return [ +p.x.toFixed(3), +p.y.toFixed(3), +p.z.toFixed(3) ]; })()`);
  console.log('base =', JSON.stringify(base));

  await ev(`[...document.querySelectorAll('.combo-btn[data-move]')].forEach(b=>b.click()); true`);
  await ev(`document.getElementById('combo-confirm').click(); true`);

  // 采样轨迹：{t, pos, hit(该样本时已命中的最后一招)}
  const trace = [];
  const seen = new Set();
  const hitAt = [];
  for (let i = 0; i < 500; i++) {
    await sleep(60);
    const s = await ev(`(() => {
      const T = window.__training;
      const p = T.attackerRoot.position;
      return {
        pos: [ +p.x.toFixed(3), +p.y.toFixed(3), +p.z.toFixed(3) ],
        hit: window.__lastHit ? window.__lastHit.name : null,
        locked: document.getElementById('combo-bar').classList.contains('locked')
      };
    })()`);
    trace.push(s);
    if (s.hit && !seen.has(s.hit)) { seen.add(s.hit); hitAt.push(trace.length - 1); }
    if (!s.locked && seen.size) break;
  }

  console.log('hits =', JSON.stringify(hitAt.map(i => ({ name: trace[i].hit, pos: trace[i].pos }))));

  // 检查（新）：全程零移动
  let moved = [];
  for (const s of trace) {
    const d = Math.hypot(s.pos[0] - base[0], s.pos[1] - base[1], s.pos[2] - base[2]);
    if (d > 0.005) moved.push({ pos: s.pos, d: +d.toFixed(3) });
  }
  console.log('movement =', moved.length ? JSON.stringify(moved.slice(0, 3)) + ` (+${moved.length - 3} more)` : 'NONE ✓');

  // 检查（旧，已无意义但保留打印）：相邻两次命中之间是否回撤
  let retreats = [];
  for (let k = 0; k < hitAt.length - 1; k++) {
    const a = trace[hitAt[k]].pos, b = trace[hitAt[k + 1]].pos;
    const db = Math.hypot(b[0] - base[0], b[2] - base[2]);
    const da = Math.hypot(a[0] - base[0], a[2] - base[2]);
    if (db < da - 0.06) retreats.push({ from: trace[k].hit, to: trace[k + 1].hit, distToBase: [+da.toFixed(3), +db.toFixed(3)] });
  }
  console.log('mid-retreats =', retreats.length ? JSON.stringify(retreats) : 'NONE ✓');

  // 最后一拳之后位置应仍在 base（原位动画没有回位问题）
  const lastPos = trace[hitAt[hitAt.length - 1]]?.pos;
  const endS = await ev(`(() => { const p = window.__training.attackerRoot.position;
    return { pos: [+p.x.toFixed(3), +p.y.toFixed(3), +p.z.toFixed(3)], hint: document.getElementById('combo-hint').textContent }; })()`);
  const dEnd = Math.hypot(endS.pos[0] - base[0], endS.pos[1] - base[1], endS.pos[2] - base[2]);
  console.log('lastHitPos =', JSON.stringify(lastPos));
  console.log('endPos =', JSON.stringify(endS.pos), ' dist to base =', dEnd.toFixed(3), dEnd < 0.005 ? '✓ 原位' : '✗ 移动了');
  console.log('hint =', endS.hint);
  console.log('LOGS:', [...new Set(logs)].join('\n') || '(none)');
  process.exit(0);
};
