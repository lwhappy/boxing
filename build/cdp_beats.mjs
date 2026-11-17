/* For every multi-beat move: per-beat contact and the rig offset each beat
 * would need so the strike lands exactly on the bag surface.
 * Usage: node build/cdp_beats.mjs */
const PORT = '9222';
const URL = 'http://127.0.0.1:8943/training/simulator/';
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
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) {
    const { res, rej } = pending.get(m.id);
    pending.delete(m.id);
    m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result);
  }
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

ws.onopen = async () => {
  const { targetInfos } = await send('Target.getTargets');
  const page = targetInfos.find((t) => t.type === 'page');
  const { sessionId: sid } = await send('Target.attachToTarget', { targetId: page.targetId, flatten: true });
  await send('Runtime.enable', {}, sid);
  await send('Page.enable', {}, sid);
  await send('Network.setCacheDisabled', { cacheDisabled: true }, sid);
  await send('Page.navigate', { url: URL }, sid);
  await sleep(9000);
  const r = await send('Runtime.evaluate', {
    returnByValue: true,
    expression: `(() => {
      const S = window.__sim, B = S.BAG, out = [];
      for (const [id, m] of Object.entries(S.MEASURE)) {
        if (!m.hits || m.hits.length < 2) continue;
        const rows = m.hits.map((h) => {
          const c = h.contact;
          const off = Math.max(-B.r * 0.68, Math.min(B.r * 0.68, c.x * 0.62));
          const inward = Math.sqrt(Math.max(0.0004, B.r * B.r - off * off));
          const tz = B.z - inward;
          return { t: +h.t.toFixed(2), bone: h.bone, cz: +c.z.toFixed(3), cx: +c.x.toFixed(3),
                   stepZ: +(tz - c.z).toFixed(3), stepX: +((B.x + off) - c.x).toFixed(3) };
        });
        out.push({ id, dur: +m.dur.toFixed(2), rows });
      }
      return JSON.stringify(out);
    })()`,
  }, sid);
  const data = JSON.parse(r.result.value);
  for (const d of data) {
    const zs = d.rows.map((x) => x.stepZ);
    const xs = d.rows.map((x) => x.stepX);
    console.log(`\n${d.id}  (dur ${d.dur}s)  spreadZ=${(Math.max(...zs) - Math.min(...zs)).toFixed(3)}m spreadX=${(Math.max(...xs) - Math.min(...xs)).toFixed(3)}m`);
    for (const x of d.rows) console.log(`   t=${x.t}  ${x.bone.padEnd(14)} contact z=${x.cz} x=${x.cx}  -> needs step (x ${x.stepX}, z ${x.stepZ})`);
  }
  process.exit(0);
};
