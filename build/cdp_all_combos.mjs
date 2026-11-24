import fs from 'node:fs';
const ver = await (await fetch('http://127.0.0.1:9222/json/version')).json();
const ws = new WebSocket(ver.webSocketDebuggerUrl);
let idc = 0; const pending = new Map();
const send = (m, p = {}, s) => { const id = ++idc; ws.send(JSON.stringify({ id, method: m, params: p, sessionId: s })); return new Promise((res) => pending.set(id, res)); };
ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
await new Promise((r) => ws.onopen = r);
const { targetInfos } = await send('Target.getTargets');
const page = targetInfos.find((t) => t.type === 'page');
const { sessionId: sid } = await send('Target.attachToTarget', { targetId: page.targetId, flatten: true });
await send('Runtime.enable', {}, sid);
await send('Page.enable', {}, sid);
await send('Log.enable', {}, sid);
const errors = [];
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data);
  if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails?.exception?.description || m.params.exceptionDetails?.text || 'unknown');
  if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error') errors.push(m.params.entry.text);
});
const ev = async (expr) => { const r = await send('Runtime.evaluate', { returnByValue: true, expression: expr }, sid); return r.exceptionDetails ? 'EXC ' + JSON.stringify(r.exceptionDetails.exception?.description || '').slice(0, 200) : r.result.value; };
const shot = async (name) => { const s = await send('Page.captureScreenshot', { format: 'png' }, sid); fs.writeFileSync(`${import.meta.dirname}/captures/allc_${name}.png`, Buffer.from(s.data, 'base64')); };

const pages = ['combo_cross_leadhook_cross','combo_idle_jab_cross_leadhook','combo_jab_cross','combo_jab_cross_leadhook_cross','combo_jab_cross_leadhook_cross_alt','combo_jab_cross_leadhook_rearhook','combo_jab_cross_leaduppercut','combo_jab_jab_cross','combo_jab_rearuppercut_leadhook'];
await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false }, sid);
for (const p of pages) {
  errors.length = 0;
  await send('Page.navigate', { url: `http://127.0.0.1:8945/combos/${p}.html` }, sid);
  await sleep(4200);
  const info = await ev(`JSON.stringify({ phase: __move.phase, dur: +__move.clipDur.toFixed(2), wh: __move.whooshTimes.length, weight: __move.woman.actions.combo.getEffectiveWeight().toFixed(2) })`);
  // wait for paused (play through)
  await ev('__move.resume()');
  let ph = 'combo';
  for (let i = 0; i < 14; i++) { await sleep(1000); ph = await ev('__move.phase'); if (ph === 'paused') break; }
  // close -> dock
  const ck = await ev(`(() => { try { document.getElementById('jab-close').click(); return 'ok'; } catch (e) { return 'ERR ' + e.message; } })()`);
  await sleep(1200);
  const ph2 = await ev('__move.phase');
  console.log(p.padEnd(38), info, '-> paused:' + ph, 'close:' + ck, 'dock:' + ph2, 'errors:' + errors.length, errors[0] || '');
  if (errors.length) await shot('ERR_' + p);
}
// screenshots of two representative pages mid-play
for (const p of ['combo_jab_cross', 'combo_jab_rearuppercut_leadhook']) {
  await send('Page.navigate', { url: `http://127.0.0.1:8945/combos/${p}.html` }, sid);
  await sleep(4200);
  await ev(`__move.stepTo(__move.clipDur * 0.45)`);
  await sleep(200);
  await shot('mid_' + p);
}
console.log('done');
process.exit(0);
