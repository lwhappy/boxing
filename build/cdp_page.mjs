// Open a URL in a fresh tab of the debug Chrome, collect console/network errors,
// wait for window.__app.ready, then dump state + screenshot.
// usage: URL=http://... SHOT=/tmp/x.png WAIT=90000 node cdp_page.mjs
import fs from 'node:fs';

const PORT = process.env.CDP_PORT || '9222';
const URL_ = process.env.URL || 'http://127.0.0.1:8123/web/index.html';
const SHOT = process.env.SHOT || '/tmp/page.png';
const WAIT = Number(process.env.WAIT || 90000);

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
const errors = [];
const netFails = [];
let sessionId = null;

ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) {
    const { res, rej } = pending.get(m.id);
    pending.delete(m.id);
    m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result);
    return;
  }
  if (m.method === 'Runtime.consoleAPICalled' && m.params.type) {
    const text = (m.params.args || []).map((a) => a.value ?? a.description ?? '').join(' ');
    logs.push(`[${m.params.type}] ${text}`);
  }
  if (m.method === 'Runtime.exceptionThrown') {
    const d = m.params.exceptionDetails;
    errors.push(d.exception?.description || d.text || JSON.stringify(d).slice(0, 300));
  }
  if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error') {
    errors.push(`[log] ${m.params.entry.text} ${m.params.entry.url || ''}`);
  }
  if (m.method === 'Network.loadingFailed') {
    netFails.push(`${m.params.type} ${m.params.errorText} ${m.params.blockedReason || ''}`);
  }
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

ws.onopen = async () => {
  try {
    const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
    sessionId = (await send('Target.attachToTarget', { targetId, flatten: true })).sessionId;

    await send('Runtime.enable', {}, sessionId);
    await send('Log.enable', {}, sessionId);
    await send('Network.enable', {}, sessionId);
    await send('Page.enable', {}, sessionId);

    await send('Page.navigate', { url: URL_ }, sessionId);

    const started = Date.now();
    let ready = false;
    while (Date.now() - started < WAIT) {
      await sleep(1500);
      const r = await send('Runtime.evaluate', {
        expression: `(() => {
          const a = window.__app;
          const bar = document.getElementById('bar');
          const err = document.getElementById('error');
          return JSON.stringify({
            ready: !!(a && a.ready),
            progress: bar ? bar.style.width : null,
            loadText: (document.getElementById('load-text') || {}).textContent || null,
            errorText: err && err.style.display === 'block' ? err.textContent : null,
            clips: a && a.ready ? a.gltf.animations.map(c => c.name) : []
          });
        })()`,
        returnByValue: true
      }, sessionId);
      const state = JSON.parse(r.result.value || '{}');
      if (process.env.VERBOSE) console.log('…', JSON.stringify(state));
      if (state.errorText) { console.log('PAGE ERROR:', state.errorText); break; }
      if (state.ready) { ready = true; break; }
    }

    await sleep(1200);

    const info = await send('Runtime.evaluate', {
      expression: `(() => {
        const a = window.__app;
        if (!a) return JSON.stringify({ready:false});
        const out = { ready: a.ready, clips: a.gltf.animations.map(c => ({name:c.name, dur:+c.duration.toFixed(2)})) };
        out.chars = {};
        for (const [k, s] of Object.entries(a.chars)) {
          out.chars[k] = {
            root: s.root.name,
            current: s.current,
            time: +s.currentAction.time.toFixed(2),
            running: s.currentAction.isRunning(),
            weight: +s.currentAction.getEffectiveWeight().toFixed(2),
            bones: (() => { let n = 0; s.root.traverse(o => { if (o.isBone) n++; }); return n; })(),
            clips: s.clips.length
          };
        }
        const c = a.camera, t = a.renderer.info.render;
        out.camera = { pos: c.position.toArray().map(v => +v.toFixed(2)) };
        out.render = { calls: t.calls, triangles: t.triangles };
        return JSON.stringify(out);
      })()`,
      returnByValue: true
    }, sessionId);

    if (process.env.EXTRA) {
      let exprSrc = fs.readFileSync(process.env.EXTRA, 'utf8');
      if (exprSrc.startsWith('async')) exprSrc = '(async () => { return (' + exprSrc + ')(); })()';
      const ex = await send('Runtime.evaluate', { expression: exprSrc, awaitPromise: true, returnByValue: true, userGesture: true }, sessionId);
      console.log('--- extra ---\n' + (typeof ex.result.value === 'string' ? ex.result.value : JSON.stringify({ result: ex.result, exceptionDetails: ex.exceptionDetails })));
    }

    const shot = await send('Page.captureScreenshot', { format: 'png' }, sessionId);
    fs.writeFileSync(SHOT, Buffer.from(shot.data, 'base64'));

    console.log('--- state ---');
    console.log(info.result.value);
    console.log('--- console ---');
    console.log(logs.slice(0, 40).join('\n') || '(none)');
    console.log('--- errors ---');
    console.log(errors.slice(0, 20).join('\n') || '(none)');
    console.log('--- net fails ---');
    console.log(netFails.slice(0, 20).join('\n') || '(none)');
    console.log('screenshot:', SHOT, 'ready:', ready);

    if (process.env.KEEP !== '1') await send('Target.closeTarget', { targetId });
    process.exit(ready ? 0 : 3);
  } catch (e) {
    console.log('FATAL', e.message);
    process.exit(1);
  }
};
