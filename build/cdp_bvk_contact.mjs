/* Fine probe: per strike window, find min bone distance, contact fraction, and needed x/y offsets. */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ver = await (await fetch('http://127.0.0.1:9333/json/version')).json();
const ws = new WebSocket(ver.webSocketDebuggerUrl);
let idc = 0;
const pending = new Map();
const send = (m, p = {}, s) => {
  const id = ++idc;
  const msg = { id, method: m, params: p };
  if (s) msg.sessionId = s;
  ws.send(JSON.stringify(msg));
  return new Promise((res, rej) => pending.set(id, { res, rej }));
};
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) {
    const { res, rej } = pending.get(m.id);
    pending.delete(m.id);
    m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result);
  }
};
await new Promise((r) => (ws.onopen = r));
const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
const { sessionId: sid } = await send('Target.attachToTarget', { targetId, flatten: true });
await send('Page.enable', {}, sid);
await send('Runtime.enable', {}, sid);
await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false }, sid);
await send('Page.navigate', { url: 'http://127.0.0.1:8945/training/boxing-vs-kickboxing/' }, sid);
let ready = false;
for (let i = 0; i < 60; i++) {
  await sleep(300);
  const r = await send('Runtime.evaluate', { expression: `window.__bvk && !!window.__bvk.stepTo`, returnByValue: true }, sid);
  if (r.result.value) { ready = true; break; }
}
console.log('ready:', ready);

const expr = `(() => {
  const bone = (fighter, name) => {
    for (const pre of ['', 'mixamorig']) {
      const b = fighter.group.getObjectByName(pre + name);
      if (b) return b;
    }
    return null;
  };
  const P = (o) => { const v = new __bvk.THREE.Vector3(); o.getWorldPosition(v); return v; };
  // windows: [t0, t1, attacker, strikeBone, defender, targetBone]
  const W = [
    [1.6, 3.9, __bvk.woman, ['RightFoot','RightToeBase'], __bvk.man, ['RightHand','LeftHand']],
    [4.8, 6.0, __bvk.woman, ['LeftFoot','LeftToeBase'], __bvk.man, ['LeftHand','RightHand']],
    [8.0, 9.8, __bvk.man, ['RightHand','LeftHand'], __bvk.woman, ['Head']],
    [10.1, 11.3, __bvk.man, ['RightHand','LeftHand'], __bvk.woman, ['Head']],
  ];
  const out = [];
  for (const [a, b, att, snames, def, tnames] of W) {
    let best = null;
    for (let t = a; t <= b; t += 1/60) {
      __bvk.stepTo(t);
      for (const sn of snames) {
        const sb = bone(att, sn); if (!sb) continue;
        const sp = P(sb);
        for (const tn of tnames) {
          const tb = bone(def, tn); if (!tb) continue;
          const tp = P(tb);
          const d = sp.distanceTo(tp);
          if (!best || d < best.d) best = { t: +t.toFixed(3), s: sn, tn, d: +d.toFixed(3),
            gapX: +(tp.x - sp.x).toFixed(3), gapY: +(tp.y - sp.y).toFixed(3) };
        }
      }
    }
    out.push(best);
  }
  return out;
})()`;
const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: false }, sid);
console.log(JSON.stringify(r.result.value, null, 1));
await send('Target.closeTarget', { targetId });
process.exit(0);
