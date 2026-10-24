/**
 * Diagnose why mixer.setTime() does not change the pose in the combo page.
 * Tries several strategies and reports bone state after each.
 */
const PORT = process.env.CDP_PORT || '9222';
const URL_ = process.env.URL || 'http://127.0.0.1:8123/combo_jab_cross_hook.html';

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
  await send('Page.navigate', { url: URL_ }, sid);
  await sleep(9000);

  const r = await send('Runtime.evaluate', {
    returnByValue: true,
    awaitPromise: true,
    expression: `(() => {
      const st = window.__comboStage;
      if (!st) return JSON.stringify({ error: 'no __comboStage' });
      const { mixer, model, comboAction } = st;

      let hips = null, head = null;
      model.traverse((o) => {
        if (o.isBone && !hips && /Hips$/.test(o.name)) hips = o;
        if (o.isBone && !head && /Head$/.test(o.name)) head = o;
      });

      const rec = [];
      const snap = (label) => {
        model.updateMatrixWorld(true);
        const V = new hips.position.constructor();
        hips.getWorldPosition(V);
        rec.push({
          label,
          mixerTime: +mixer.time.toFixed(3),
          actTime: +comboAction.time.toFixed(3),
          weight: +comboAction.getEffectiveWeight().toFixed(3),
          enabled: comboAction.enabled,
          paused: comboAction.paused,
          loopCount: comboAction._loopCount,
          clipTime: comboAction._clipTime === undefined ? null : +comboAction._clipTime.toFixed(3),
          hipsLocalQ: [...hips.quaternion.toArray()].map(v => +v.toFixed(3)),
          hipsWorldY: +V.y.toFixed(4),
        });
      };

      snap('as-loaded');

      mixer.timeScale = 1;

      comboAction.reset();
      mixer.update(0);
      snap('reset+update0');

      mixer.setTime(0.0);
      snap('setTime(0)');

      mixer.setTime(0.5);
      snap('setTime(0.5)');

      mixer.setTime(1.5);
      snap('setTime(1.5)');

      comboAction.reset();
      comboAction.play();
      mixer.setTime(1.5);
      mixer.update(0);
      snap('reset+play+setTime(1.5)');

      // fresh mixer owning the same model
      const M2 = new mixer.constructor(model);
      const A2 = M2.clipAction(comboAction.getClip());
      A2.play();
      M2.setTime(0.0); M2.update(0);
      snap('fresh M2 t=0');
      M2.setTime(1.5); M2.update(0);
      snap('fresh M2 t=1.5');

      return JSON.stringify({
        clipDur: comboAction.getClip().duration,
        clipTracks: comboAction.getClip().tracks.length,
        firstTrack: comboAction.getClip().tracks[0].name,
        rec,
      });
    })()`,
  }, sid);

  if (!r.result || r.result.value === undefined) {
    console.log('RAW:', JSON.stringify(r).slice(0, 2000));
  } else {
    const d = JSON.parse(r.result.value);
    console.log('clipDur:', d.clipDur, 'tracks:', d.clipTracks, 'first:', d.firstTrack);
    for (const x of d.rec) {
      console.log(
        x.label.padEnd(26),
        'mixerT=' + String(x.mixerTime).padEnd(7),
        'actT=' + String(x.actTime).padEnd(7),
        'w=' + String(x.weight).padEnd(6),
        'en=' + x.enabled,
        'paused=' + x.paused,
        'loop=' + x.loopCount,
        'clipT=' + x.clipTime,
        'hipsQ=[' + x.hipsLocalQ.join(',') + ']',
        'hipsWY=' + x.hipsWorldY
      );
    }
  }
  if (errors.length) console.log('ERRORS:', errors.slice(0, 5));
  await send('Target.closeTarget', { targetId });
  process.exit(0);
};
