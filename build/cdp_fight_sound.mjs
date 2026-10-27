/* Verify the fight page impact sound + the top-left mute toggle.
 * Usage: node build/cdp_fight_sound.mjs [url] */
import fs from 'node:fs';

const PORT = process.env.CDP_PORT || '9333';
const URL = process.argv[2] || 'http://127.0.0.1:8958/fight.html';

const ver = await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json();
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
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

ws.onopen = async () => {
  const { targetInfos } = await send('Target.getTargets');
  const t = targetInfos.find((x) => x.type === 'page');
  const sid = (await send('Target.attachToTarget', { targetId: t.targetId, flatten: true })).sessionId;
  await send('Runtime.enable', {}, sid);
  await send('Page.enable', {}, sid);
  await send('Network.enable', {}, sid);
  await send('Network.setCacheDisabled', { cacheDisabled: true }, sid);
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false }, sid);

  const logs = [];
  ws.addEventListener('message', (e) => {
    const m = JSON.parse(e.data);
    if (m.method === 'Runtime.consoleAPICalled' && m.sessionId === sid) {
      logs.push(m.params.type + ': ' + m.params.args.map((a) => a.value ?? a.description ?? a.type).join(' '));
    }
  });

  const ev = async (expr) => {
    const r = await send(
      'Runtime.evaluate',
      { expression: expr, returnByValue: true, awaitPromise: true },
      sid
    );
    if (r.exceptionDetails) return { error: (r.exceptionDetails.exception && r.exceptionDetails.exception.description) || r.exceptionDetails.text };
    return r.result.value;
  };

  const shoot = async (file) => {
    const s = await send('Page.captureScreenshot', { format: 'png' }, sid);
    fs.writeFileSync(file, Buffer.from(s.data, 'base64'));
  };

  await send('Page.navigate', { url: URL }, sid);
  for (let i = 0; i < 200; i++) {
    await sleep(300);
    if ((await ev('!!(window.__fight&&window.__fight.ready)')) === true) break;
  }
  /* fresh state: pretend the visitor has never chosen */
  await ev(`localStorage.removeItem('silentjab.fight.muted'); true`);

  console.log('1) sound button =', JSON.stringify(await ev(`(() => {
    const b = document.getElementById('fight-sound'), r = b.getBoundingClientRect();
    const st = document.querySelector('.fight-stage').getBoundingClientRect();
    return { exists: !!b, visible: !b.hidden, label: b.querySelector('.txt').textContent,
      aria: b.getAttribute('aria-pressed'), mutedClass: b.classList.contains('is-muted'),
      inStage: !!b.closest('.fight-stage'), offsetFromLeft: Math.round(r.left - st.left),
      offsetFromTop: Math.round(r.top - st.top), w: Math.round(r.width) };
  })()`)));

  await sleep(1200);  // let the sample decode
  console.log('2) audio before any click =', JSON.stringify(await ev(`window.__fight.sound()`)));

  const punch = async () => {
    await ev(`[...document.querySelectorAll('.fight-btn')].find(b=>b.dataset.key==='jab').click(); true`);
    for (let i = 0; i < 300; i++) {
      await sleep(40);
      if ((await ev(`window.__fight.phase() === 'hitting'`)) === true) break;
    }
    await sleep(120);
    return ev(`window.__fight.sound()`);
  };

  console.log('3) after 1st jab (sound on) =', JSON.stringify(await punch()));
  await shoot('/tmp/sound-on.png');
  /* wait until the flow unlocks */
  for (let i = 0; i < 120; i++) {
    await sleep(100);
    if ((await ev(`window.__fight.phase() === 'idle'`)) === true) break;
  }
  await sleep(400);

  console.log('4) click mute →', JSON.stringify(await ev(`(() => {
    document.getElementById('fight-sound').click();
    const b = document.getElementById('fight-sound');
    return { label: b.querySelector('.txt').textContent, aria: b.getAttribute('aria-pressed'),
      mutedClass: b.classList.contains('is-muted'), stored: localStorage.getItem('silentjab.fight.muted'),
      state: window.__fight.sound() };
  })()`)));
  await shoot('/tmp/sound-muted.png');

  const before = (await ev('window.__fight.sound()')).plays;
  const st = await punch();
  console.log('5) jab while muted =', JSON.stringify(st), '→ plays delta =', st.plays - before);

  /* reload: the choice must survive */
  await send('Page.navigate', { url: URL + (URL.includes('?') ? '&' : '?') + 'r=' + Date.now() }, sid);
  for (let i = 0; i < 200; i++) {
    await sleep(300);
    if ((await ev('!!(window.__fight&&window.__fight.ready)')) === true) break;
  }
  console.log('6) after reload =', JSON.stringify(await ev(`(() => {
    const b = document.getElementById('fight-sound');
    return { label: b.querySelector('.txt').textContent, mutedClass: b.classList.contains('is-muted'),
      stored: localStorage.getItem('silentjab.fight.muted'), state: window.__fight.sound() };
  })()`)));

  /* back to sound on, mobile shot */
  await ev(`document.getElementById('fight-sound').click(); localStorage.setItem('silentjab.fight.muted','0'); true`);
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true }, sid);
  await sleep(900);
  await shoot('/tmp/sound-mobile.png');

  console.log('LOGS:', [...new Set(logs)].join(' | ') || '(none)');
  process.exit(0);
};
