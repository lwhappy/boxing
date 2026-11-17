/* dump the measured beats of one move: node build/cdp_dump.mjs combo2-elbow */
const PORT = '9222';
const URL = 'http://127.0.0.1:8943/training/simulator/';
const MOVE = process.argv[2] || 'combo2-elbow';
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
  const evalJS = async (expr) => {
    const r = await send('Runtime.evaluate', { returnByValue: true, awaitPromise: true, expression: expr }, sid);
    if (r.exceptionDetails) return 'EXC ' + JSON.stringify(r.exceptionDetails).slice(0, 300);
    return r.result.value;
  };
  const dump = await evalJS(`(() => {
    const S = window.__sim;
    const m = S.MEASURE[${JSON.stringify(MOVE)}];
    return JSON.stringify({ bag: S.BAG, move: m, clips: Object.keys(window.__rig.clips) }, (k, v) => typeof v === 'number' ? +v.toFixed(3) : v);
  })()`);
  console.log(dump);
  process.exit(0);
};
