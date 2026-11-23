// Render ground truth for the leadhook freeze: in the paused phase the loop
// renders the current mixer state every frame, so set the move action to a
// candidate time and capture a screenshot — pure pixels, no metric guessing.
import { writeFileSync } from 'fs';

const send = (method, params = {}, sid) => new Promise((res) => {
  const id = ++globalThis.__cdpId;
  globalThis.__pending.set(id, { res, sid });
  globalThis.__ws.send(JSON.stringify({ id, method, params, sessionId: sid }));
});
globalThis.__cdpId = 0;
globalThis.__pending = new Map();

const CHROME = 'http://127.0.0.1:9222';
const targetInfos = await (await fetch(CHROME + '/json/list')).json();
const page = targetInfos.find((t) => t.type === 'page' && /leadhook/.test(t.url));
if (!page) { console.error('no leadhook page tab'); process.exit(1); }

const ws = new WebSocket(page.webSocketDebuggerUrl);
globalThis.__ws = ws;
ws.addEventListener('message', (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && globalThis.__pending.has(m.id)) {
    const { res, sid } = globalThis.__pending.get(m.id);
    globalThis.__pending.delete(m.id);
    res(m.result ?? m);
  }
});
await new Promise((r) => ws.addEventListener('open', r, { once: true }));

const { sessionId: sid } = await send('Target.attachToTarget', { targetId: page.targetId, flatten: true });
await send('Runtime.enable', {}, sid);
await send('Page.enable', {}, sid);

const ev = async (expr) => {
  const r = await send('Runtime.evaluate', { returnByValue: true, expression: expr, awaitPromise: true }, sid);
  if (r.exceptionDetails) console.error('eval error:', JSON.stringify(r.exceptionDetails).slice(0, 300));
  return r.result && r.result.result ? r.result.result.value : undefined;
};
const shot = async (name) => {
  const s = await send('Page.captureScreenshot', { format: 'png' }, sid);
  writeFileSync(`/tmp/lh_pose_${name}.png`, Buffer.from(s.data, 'base64'));
};

for (let i = 0; i < 120; i++) {
  const ph = await ev('window.__move && window.__move.phase');
  if (ph === 'paused') break;
  if (ph === 'docked') await ev('window.__move.restart()');
  await new Promise((r) => setTimeout(r, 500));
}

const times = ['0', '1.75', '1.9', '2.1', '2.3'];
for (const t of times) {
  await ev(`(() => {
    const m = window.__move, w = m.woman;
    const act = w.actions['leadhook'];
    act.reset().play();
    w.mixer.setTime(${t});
    w.group.updateMatrixWorld(true);
    return true;
  })()`);
  await new Promise((r) => setTimeout(r, 350));   // let a frame render
  await shot(t.replace('.', '_'));
}
// restore the frozen state
await ev(`(() => {
  const m = window.__move, w = m.woman;
  const act = w.actions['leadhook'];
  act.time = m.moveFreeze; w.mixer.update(0);
  return true;
})()`);
console.log('captured', times.join(', '));
process.exit(0);
