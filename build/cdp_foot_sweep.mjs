// Sweep the whole leadhook clip: track both feet bones + toes to find when
// the rear heel actually settles back to the floor.
const CHROME = 'http://127.0.0.1:9222';
const list = await (await fetch(CHROME + '/json')).json();
const page = list.find((t) => t.type === 'page' && /leadhook/.test(t.url));
if (!page) { console.error('no leadhook page tab'); process.exit(1); }

const ws = new WebSocket(page.webSocketDebuggerUrl);
let id = 0;
const pending = new Map();
ws.addEventListener('message', (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
});
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

for (let i = 0; i < 120; i++) {
  const ph = await evalJs('window.__move && window.__move.phase');
  if (ph === 'paused') break;
  await new Promise((r) => setTimeout(r, 500));
}

const rows = await evalJs(`(async () => {
  const m = window.__move, w = m.woman;
  const byName = {};
  w.root.traverse((o) => { if (o.isBone) byName[o.name] = o; });
  const pick = (k) => Object.keys(byName).find((n) => n.replace(/[^a-z]/gi,'').toLowerCase().endsWith(k.toLowerCase()));
  const names = ['LeftFoot','RightFoot','LeftToeBase','RightToeBase'].map(pick);
  const bones = names.map((n) => byName[n]);
  const v = new m.THREE.Vector3();
  const act = w.actions['leadhook'];
  const dur = act.getClip().duration;
  act.reset().play();
  const out = [];
  for (let i = 0; i <= 48; i++) {
    const t = (dur * i) / 48;
    w.mixer.setTime(t);
    w.group.updateMatrixWorld(true);
    const ys = bones.map((b) => { b.getWorldPosition(v); return +v.y.toFixed(3); });
    out.push([+t.toFixed(2), ...ys]);
  }
  w.mixer.stopAllAction();
  act.time = m.moveFreeze; w.mixer.update(0);
  return { bones: names, dur, rows: out, impact: m.moveImpact, freeze: m.moveFreeze };
})()`);
console.log('bones:', JSON.stringify(rows.bones));
console.log('dur:', rows.dur, 'impact:', rows.impact, 'freeze:', rows.freeze);
for (const r of rows.rows) console.log(r.join('\t'));
ws.close();
process.exit(0);
