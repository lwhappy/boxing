/* Fight page CDP test: buttons config, camera, punch flow, hit delay, effect
 * node build/cdp_fight.mjs http://127.0.0.1:8958/fight.html
 */
import fs from 'node:fs';

const URL = process.argv[2] || 'http://127.0.0.1:8958/fight.html';
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
  if (m.method === 'Runtime.exceptionThrown') logs.push('[exception] ' + JSON.stringify(m.params.exceptionDetails).slice(0, 300));
  if (m.method === 'Runtime.consoleAPICalled' && ['error', 'warning'].includes(m.params.type)) {
    logs.push(`[${m.params.type}] ` + m.params.args.map(a => a.value ?? a.description ?? '').join(' ').slice(0, 200));
  }
};
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

ws.onopen = async () => {
  const { targetInfos } = await send('Target.getTargets');
  const t = targetInfos.find(x => x.type === 'page');
  const sid = (await send('Target.attachToTarget', { targetId: t.targetId, flatten: true })).sessionId;
  await send('Runtime.enable', {}, sid);
  await send('Page.enable', {}, sid);
  await send('Network.enable', {}, sid);
  await send('Network.setCacheDisabled', { cacheDisabled: true }, sid);
  const ev = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }, sid);
    if (r.exceptionDetails) return { error: r.exceptionDetails.text + ' ' + (r.exceptionDetails.exception?.description || '') };
    return r.result.value;
  };

  await send('Page.navigate', { url: URL }, sid);
  let ready = false;
  for (let i = 0; i < 200; i++) {
    await sleep(300);
    if (await ev(`!!(window.__fight && window.__fight.ready)`) === true) { ready = true; break; }
  }
  if (!ready) { console.log('NOT READY', logs); process.exit(1); }

  // 1. static checks
  console.log('clips =', JSON.stringify(await ev(`window.__fight.clips`)));
  console.log('camera =', JSON.stringify(await ev(`(() => { const c = window.__fight.camera;
    return { pos: c.position.toArray().map(n=>+n.toFixed(2)), fov: +c.fov.toFixed(1) }; })()`)));
  console.log('orbit =', JSON.stringify(await ev(`(() => { const o = window.__fight.controls;
    return { rotate: o.enableRotate, zoom: o.enableZoom, pan: o.enablePan, target: o.target.toArray().map(n=>+n.toFixed(2)) }; })()`)));
  console.log('next btn =', JSON.stringify(await ev(`(() => { const r = document.getElementById('fight-next');
    return { exists: !!r, visible: !!r && !r.hidden, topRight: !!r && !!r.closest('.fight-stage'),
      text: r && r.querySelector('.txt') && r.querySelector('.txt').textContent }; })()`)));
  console.log('orbit hint =', JSON.stringify(await ev(`(() => { const h = document.querySelector('.fight-orbit-hint');
    return { exists: !!h, inStage: !!h && !!h.closest('.fight-stage'), text: h && h.textContent }; })()`)));
  const btns = await ev(`(() => [...document.querySelectorAll('.fight-btn')].map(b => ({
    key: b.dataset.key || null, label: b.querySelector('.fight-btn-label')?.textContent,
    disabled: b.disabled, hasDisabledClass: b.classList.contains('disabled'),
    active: b.classList.contains('active')
  })))()`);
  console.log('buttons =');
  for (const b of btns) console.log('  ', JSON.stringify(b));
  console.log('bar rows (grid) =', JSON.stringify(await ev(`(() => {
    const bar = document.getElementById('fight-bar');
    return { cols: getComputedStyle(bar).gridTemplateColumns, count: bar.children.length };
  })()`)));
  console.log('message =', JSON.stringify(await ev(`document.getElementById('fight-message').textContent`)));

  // 2. click jab and trace the phase machine
  const t0 = Date.now();
  await ev(`[...document.querySelectorAll('.fight-btn')].find(b => b.dataset.key === 'jab').click(); true`);
  const marks = [];
  let sawHit = false, sawEffect = false, maxFx = 0;
  let lastPhase = '', lastAtk = '', lastDef = '';
  for (let i = 0; i < 300; i++) {
    await sleep(50);
    const s = await ev(`(() => { const F = window.__fight;
      return { phase: F.phase(), atk: F.chars.attack.current, def: F.chars.defence.current, fx: F.effects() }; })()`);
    if (s.phase !== lastPhase) { marks.push({ t: +((Date.now() - t0) / 1000).toFixed(2), phase: s.phase }); lastPhase = s.phase; }
    if (s.atk !== lastAtk) { marks.push({ t: +((Date.now() - t0) / 1000).toFixed(2), atk: s.atk }); lastAtk = s.atk; }
    if (s.def !== lastDef) { marks.push({ t: +((Date.now() - t0) / 1000).toFixed(2), def: s.def }); lastDef = s.def; }
    if (s.def === 'defence-hit') sawHit = true;
    if (s.fx > maxFx) maxFx = s.fx;
    if (s.fx > 0) sawEffect = true;
    if (s.phase === 'idle' && i > 2) break;
  }
  console.log('timeline =');
  for (const m of marks) console.log('  ', JSON.stringify(m));
  console.log('sawHit =', sawHit, ' sawEffect =', sawEffect, ' maxFx =', maxFx);

  // 3. buttons re-enabled after flow (unlock settles 250ms after phase=idle)
  await sleep(600);
  console.log('after: locked =', await ev(`document.getElementById('fight-bar').classList.contains('locked')`));
  console.log('jab disabled =', await ev(`[...document.querySelectorAll('.fight-btn')].find(b => b.dataset.key === 'jab').disabled`));

  // 3b. animation weights settled back to 1 (no bind-pose collapse)
  console.log('idle weights =', JSON.stringify(await ev(`(() => {
    const F = window.__fight;
    return { atk: +F.chars.attack.actions['attack-idle'].getEffectiveWeight().toFixed(2),
             def: +F.chars.defence.actions['defence-idle'].getEffectiveWeight().toFixed(2) }; })()`)));

  // 4. Next button loads the GLB again (cache-busted)
  await ev(`document.getElementById('fight-next').click(); true`);
  let reloaded = false;
  for (let i = 0; i < 200; i++) {
    await sleep(300);
    if (await ev(`!!(window.__fight && window.__fight.ready && window.__fight.model)` ) === true
        && await ev(`document.getElementById('fight-loading').classList.contains('hidden')`) === true) { reloaded = true; break; }
  }
  console.log('reload: reloaded =', reloaded,
    'btnBack =', await ev(`!document.getElementById('fight-next').hidden`),
    'modelChanged =', await ev(`!!window.__fight.model`),
    'phase =', await ev(`window.__fight.phase()`));

  const shot = await send('Page.captureScreenshot', { format: 'png' }, sid);
  fs.writeFileSync('/tmp/cdp-fight.png', Buffer.from(shot.data, 'base64'));

  // 5. mobile viewport
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true }, sid);
  await sleep(800);
  const mshot = await send('Page.captureScreenshot', { format: 'png' }, sid);
  fs.writeFileSync('/tmp/fight-mobile.png', Buffer.from(mshot.data, 'base64'));

  console.log('LOGS:', [...new Set(logs)].join('\n') || '(none)');
  process.exit(0);
};
