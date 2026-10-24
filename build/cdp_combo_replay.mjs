/**
 * Verify: (1) Replay button no longer collapses, (2) end of clip holds the last
 * frame upright (clampWhenFinished) instead of falling back to the bind pose.
 */
const PORT = process.env.CDP_PORT || '9222';
const URL_ = process.env.URL || 'http://127.0.0.1:8123/combo_jab_cross_hook.html';
const OUT = process.env.OUT || '/tmp/combo_replay';
import fs from 'node:fs';
fs.mkdirSync(OUT, { recursive: true });

const ver = await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json();
const ws = new WebSocket(ver.webSocketDebuggerUrl);
let idc = 0; const pending = new Map();
const send = (m, p = {}, s) => { const id = ++idc; const msg = { id, method: m, params: p }; if (s) msg.sessionId = s; ws.send(JSON.stringify(msg)); return new Promise((res, rej) => pending.set(id, { res, rej })); };
ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { const { res, rej } = pending.get(m.id); pending.delete(m.id); m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const POSE = `(() => {
  const st = window.__comboStage, a = st.comboAction;
  let hips=null, head=null;
  st.model.traverse(o=>{ if(o.isBone&&!hips&&/Hips$/.test(o.name))hips=o; if(o.isBone&&!head&&/Head$/.test(o.name))head=o; });
  const V=b=>b?b.getWorldPosition(new b.position.constructor()):null;
  const hp=V(head), sp=V(hips);
  let up=null; if(hp&&sp){const L=hp.distanceTo(sp); up=L>1e-6?(hp.y-sp.y)/L:null;}
  return JSON.stringify({w:+a.getEffectiveWeight().toFixed(3), actT:+a.time.toFixed(3), paused:a.paused, headY:+hp.y.toFixed(3), up:up===null?null:+up.toFixed(3)});
})()`;

ws.onopen = async () => {
  const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
  const sid = (await send('Target.attachToTarget', { targetId, flatten: true })).sessionId;
  await send('Runtime.enable', {}, sid);
  await send('Page.enable', {}, sid);
  await send('Network.enable', {}, sid);
  await send('Network.setCacheDisabled', { cacheDisabled: true }, sid);
  await send('Emulation.setDeviceMetricsOverride', { width: 1000, height: 640, deviceScaleFactor: 1, mobile: false }, sid);
  await send('Page.navigate', { url: URL_ }, sid);
  const t0 = Date.now();
  while (Date.now() - t0 < 30000) {
    const r = await send('Runtime.evaluate', { expression: '!!window.__comboStage', returnByValue: true }, sid);
    if (r.result && r.result.value === true) break;
    await sleep(80);
  }
  await sleep(700);

  console.log('--- TEST 1: Replay button ---');
  await send('Runtime.evaluate', {
    expression: `(() => { const b=[...document.querySelectorAll('#stage-bar button')].find(x=>x.textContent.includes('Replay')); b.click(); return !!b; })()`,
    returnByValue: true,
  }, sid);
  for (const s of [0, 100, 200, 300]) {
    const wait = t0 + 0; // relative to click
    void wait;
    const p = await send('Runtime.evaluate', { expression: POSE, returnByValue: true }, sid);
    console.log(`  +${s}ms  ${p.result.value}`);
    await sleep(s === 0 ? 100 : 100);
  }
  const shot = await send('Page.captureScreenshot', { format: 'png' }, sid);
  fs.writeFileSync(`${OUT}/replay_100ms.png`, Buffer.from(shot.data, 'base64'));

  console.log('--- TEST 2: end of clip (clampWhenFinished) ---');
  // jump near the end of the clip
  await send('Runtime.evaluate', {
    expression: `(() => { const st=window.__comboStage; st.mixer.timeScale=1; st.comboAction.reset(); st.comboAction.play(); st.mixer.setTime(st.comboAction.getClip().duration - 0.05); return st.comboAction.getClip().duration; })()`,
    returnByValue: true,
  }, sid);
  await sleep(120);
  let p = await send('Runtime.evaluate', { expression: POSE, returnByValue: true }, sid);
  console.log('  near end  ', p.result.value);
  await sleep(900); // let it finish and clamp
  p = await send('Runtime.evaluate', { expression: POSE, returnByValue: true }, sid);
  console.log('  after end ', p.result.value);
  const shot2 = await send('Page.captureScreenshot', { format: 'png' }, sid);
  fs.writeFileSync(`${OUT}/end_of_clip.png`, Buffer.from(shot2.data, 'base64'));
  console.log('shots ->', OUT);
  await send('Target.closeTarget', { targetId });
  process.exit(0);
};
