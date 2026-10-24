/**
 * Step through the combo animation and report the character's world-space
 * height over time, so we can see exactly when the "lying down -> standing"
 * transition happens.
 *
 * usage: URL=... CDP_PORT=9222 OUT=/tmp/animprobe SHOTS="0,0.1,0.3" node build/cdp_anim_probe.mjs
 */
const PORT = process.env.CDP_PORT || '9222';
const URL_ = process.env.URL || 'http://127.0.0.1:8123/combo_jab_cross_hook.html';
const OUT = process.env.OUT || '/tmp/animprobe';
const SHOTS = (process.env.SHOTS || '').split(',').filter(Boolean).map(Number);

import fs from 'node:fs';
fs.mkdirSync(OUT, { recursive: true });

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
const errors = [];
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) {
    const { res, rej } = pending.get(m.id);
    pending.delete(m.id);
    m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result);
    return;
  }
  if (m.method === 'Runtime.exceptionThrown') {
    errors.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text);
  }
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

ws.onopen = async () => {
  const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
  const sid = (await send('Target.attachToTarget', { targetId, flatten: true })).sessionId;
  await send('Runtime.enable', {}, sid);
  await send('Page.enable', {}, sid);
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false }, sid);
  await send('Page.navigate', { url: URL_ }, sid);
  await sleep(12000);

  // Probe: step the mixer and read bone world positions.
  // NOTE: mixer.setTime(t) internally calls update(t), and update() multiplies
  // deltaTime by mixer.timeScale -- so timeScale MUST be 1 while stepping.
  const probe = await send('Runtime.evaluate', {
    returnByValue: true,
    awaitPromise: true,
    expression: `(() => {
      const st = window.__comboStage;
      if (!st) return JSON.stringify({ error: 'no __comboStage' });
      const { mixer, model } = st;
      const act = st.comboAction;

      const find = (re) => {
        let hit = null;
        model.traverse((o) => { if (!hit && o.isBone && re.test(o.name)) hit = o; });
        return hit;
      };
      const head  = find(/Head$/)  || find(/HeadTop/);
      const hips  = find(/Hips$/)  || find(/Hips/);
      const foot  = find(/Foot$/)  || find(/Foot/);
      const names = [];
      model.traverse((o) => { if (o.isBone) names.push(o.name); });

      const clip = act && act.getClip ? act.getClip() : null;
      const dur  = clip ? clip.duration : 0;

      // sample world-space bone positions at time t
      const sample = (t) => {
        mixer.timeScale = 1;
        mixer.setTime(t);      // resets action times, then update(t)
        mixer.update(0);
        model.updateMatrixWorld(true);
        const V = (b) => b ? b.getWorldPosition(new b.position.constructor()) : null;
        const hp = V(head), sp = V(hips), fp = V(foot);
        let upFrac = null, spineLen = null;
        if (hp && sp) {
          const dx = hp.x - sp.x, dy = hp.y - sp.y, dz = hp.z - sp.z;
          const len = Math.hypot(dx, dy, dz);
          spineLen = len;
          upFrac = len > 1e-6 ? dy / len : null;   // +1 = head above hips
        }
        return {
          t: +t.toFixed(3),
          headY: hp ? +hp.y.toFixed(3) : null,
          hipsY: sp ? +sp.y.toFixed(3) : null,
          footY: fp ? +fp.y.toFixed(3) : null,
          upFrac: upFrac === null ? null : +upFrac.toFixed(3),
          spineLen: spineLen === null ? null : +spineLen.toFixed(3),
        };
      };

      const rows = [];
      const N = 100;
      const SPAN = Math.min(dur, 3.0);
      for (let i = 0; i <= N; i++) rows.push(sample((i / N) * SPAN));

      // leave it paused at 0 for the caller
      mixer.setTime(0); mixer.update(0); model.updateMatrixWorld(true);
      return JSON.stringify({ dur: +dur.toFixed(3), span: +SPAN.toFixed(3), names: names.slice(0, 10), rows });
    })()`,
  }, sid);

  if (!probe.result || probe.result.value === undefined) {
    console.log('PROBE RAW:', JSON.stringify(probe).slice(0, 1500));
    console.log('ERRORS:', errors.slice(0, 5));
    await send('Target.closeTarget', { targetId });
    process.exit(1);
  }
  const data = JSON.parse(probe.result.value);
  console.log('clip duration:', data.dur, 's');
  console.log('bone names:', (data.names || []).join(', '));
  const pad = (v, n) => String(v).padStart(n);
  console.log('');
  console.log(pad('t(s)', 7) + pad('headY', 9) + pad('hipsY', 9) + pad('footY', 9) + pad('upFrac', 9) + '  posture');
  for (const r of data.rows) {
    // upFrac: +1 = spine points straight up (standing), 0 = horizontal, -1 = upside down
    const u = r.upFrac;
    const tag = u === null ? '?' : (u > 0.9 ? 'STANDING' : (u > 0.3 ? 'leaning' : (u > -0.3 ? 'HORIZONTAL' : 'UPSIDE-DOWN')));
    console.log(pad(r.t, 7) + pad(r.headY, 9) + pad(r.hipsY, 9) + pad(r.footY, 9) + pad(u, 9) + '  ' + tag);
  }

  // Screenshots at requested times -- freeze the mixer so the pose holds
  for (const t of SHOTS) {
    await send('Runtime.evaluate', {
      expression: `(() => {
        const st = window.__comboStage;
        st.mixer.timeScale = 1;
        st.mixer.setTime(${t});
        st.mixer.update(0);
        st.model.updateMatrixWorld(true);
        st.mixer.timeScale = 0;   // freeze so the raf loop cannot advance it
        return 1;
      })()`,
      returnByValue: true,
    }, sid);
    await sleep(500);
    const shot = await send('Page.captureScreenshot', { format: 'png' }, sid);
    const f = `${OUT}/t${String(t).replace('.', '_')}.png`;
    fs.writeFileSync(f, Buffer.from(shot.data, 'base64'));
    console.log('shot ->', f);
  }

  if (errors.length) console.log('ERRORS:', errors.slice(0, 5));
  await send('Target.closeTarget', { targetId });
  process.exit(0);
};
