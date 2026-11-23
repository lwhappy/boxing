// Probe: read moveImpact / moveFreeze and the two feet's world y at the
// frozen frame, to verify the rear heel is grounded at freeze time.
const CHROME = 'http://127.0.0.1:9222';
const list = await (await fetch(CHROME + '/json')).json();
const PAGE_PAT = new RegExp(process.env.PAGE_PAT || 'leadhook');
const ACT = process.env.ACT || 'leadhook';
const page = list.find((t) => t.type === 'page' && PAGE_PAT.test(t.url));
if (!page) { console.error('no page tab for ' + PAGE_PAT); process.exit(1); }

const ws = new WebSocket(page.webSocketDebuggerUrl);
ws.addEventListener('message', (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
});
let id = 0;
const pending = new Map();
function send(method, params = {}) {
  return new Promise((res) => {
    const mid = ++id;
    pending.set(mid, res);
    ws.send(JSON.stringify({ id: mid, method, params }));
  });
}
await new Promise((r) => ws.addEventListener('open', r, { once: true }));
await send('Page.enable');
await send('Runtime.enable');

async function evalJs(expr) {
  const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
  return r.result && r.result.result ? r.result.result.value : undefined;
}

// wait for the paused phase (frozen pose)
for (let i = 0; i < 120; i++) {
  const ph = await evalJs('window.__move && window.__move.phase');
  if (ph === 'paused') break;
  await new Promise((r) => setTimeout(r, 500));
}
const out = await evalJs(`(() => {
  const m = window.__move; if (!m) return null;
  const w = m.woman;
  const lf = w.bones.LeftFoot, rf = w.bones.RightFoot;
  const v = new m.THREE.Vector3();
  w.group.updateMatrixWorld(true);
  lf.getWorldPosition(v); const ly = v.y;
  rf.getWorldPosition(v); const ry = v.y;
  // also sample the whole clip after reach for the heel curve
  const act = w.actions[ACT];
  return {
    phase: m.phase, moveImpact: m.moveImpact, moveFreeze: m.moveFreeze,
    leftFootY: ly, rightFootY: ry, dy: ry - ly,
    actionTime: w.actions[ACT] ? w.actions[ACT].time : null,
  };
})()`);
console.log(JSON.stringify(out, null, 2));
ws.close();
process.exit(0);
