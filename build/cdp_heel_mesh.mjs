// Measure the right foot's HEEL mesh height: min world-y of skinned vertices
// on the heel side (opposite the toe bone from the ankle), vs the t=0 guard
// reference. This is the ground truth for "heel on the floor".
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
  if (r.exceptionDetails) console.error('eval error:', JSON.stringify(r.exceptionDetails).slice(0, 400));
  return r.result && r.result.result ? r.result.result.value : undefined;
}

for (let i = 0; i < 120; i++) {
  const ph = await evalJs('window.__move && window.__move.phase');
  if (ph === 'paused' || ph === 'docked') break;
  await new Promise((r) => setTimeout(r, 500));
}

const out = await evalJs(`(async () => {
  const m = window.__move, w = m.woman;
  const byName = {};
  w.root.traverse((o) => { if (o.isBone) byName[o.name] = o; });
  const pick = (k) => Object.keys(byName).find((n) => n.replace(/[^a-z]/gi,'').toLowerCase().endsWith(k.toLowerCase()));
  const rf = byName[pick('RightFoot')], rt = byName[pick('RightToeBase')];
  const meshes = [];
  w.root.traverse((o) => { if (o.isMesh && o.geometry) meshes.push(o); });
  const tv = new m.THREE.Vector3();
  const a = new m.THREE.Vector3(), t = new m.THREE.Vector3();
  function heelLowest() {
    w.group.updateMatrixWorld(true);
    rf.getWorldPosition(a);
    rt.getWorldPosition(t);
    // heel direction in the horizontal plane: ankle minus toe, normalized
    let hx = a.x - t.x, hz = a.z - t.z;
    const hl = Math.hypot(hx, hz) || 1; hx /= hl; hz /= hl;
    let low = Infinity;
    for (const o of meshes) {
      const pos = o.geometry.attributes.position;
      const step = Math.max(1, Math.floor(pos.count / 6000));
      for (let i = 0; i < pos.count; i += step) {
        tv.fromBufferAttribute(pos, i);
        if (o.isSkinnedMesh) o.applyBoneTransform(i, tv);
        tv.applyMatrix4(o.matrixWorld);
        // heel-side half of the foot: behind the ankle, within 20cm of it,
        // below the ankle joint
        const dx = tv.x - a.x, dz = tv.z - a.z;
        const along = dx * hx + dz * hz;          // >0 = heel side
        const perp = Math.abs(dx * -hz + dz * hx); // sideways spread
        if (along > 0.02 && along < 0.20 && perp < 0.12 && tv.y < a.y) {
          if (tv.y < low) low = tv.y;
        }
      }
    }
    return low;
  }
  const act = w.actions['leadhook'];
  const dur = act.getClip().duration;
  act.reset().play();
  const times = [0, 0.5, 0.8, 0.9, 0.97, 1.05, 1.15, 1.25, 1.35, 1.45, 1.55, 1.65, 1.77, 1.9, 2.05, 2.2, 2.3];
  const rows = [];
  for (const tt of times) {
    w.mixer.setTime(tt);
    rows.push([tt, +heelLowest().toFixed(3)]);
  }
  w.mixer.stopAllAction();
  act.time = m.moveFreeze; w.mixer.update(0);
  return { rows, freeze: m.moveFreeze, dur };
})()`);
console.log('t\theelLowestY   (freeze=' + out.freeze + ', dur=' + out.dur.toFixed(2) + ')');
for (const r of out.rows) console.log(r.join('\t'));
ws.close();
process.exit(0);
