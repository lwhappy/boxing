/**
 * Mobile audit for /fight/game.html
 *   node build/cdp_mobile_audit.mjs
 * Screens: intro / select / fight on a few phone viewports, plus layout metrics.
 */
import fs from 'node:fs';

const PORT = process.env.CDP_PORT || '9333';
const BASE = process.env.BASE || 'http://127.0.0.1:8938';
const OUT = process.env.OUT || '/tmp/mobile-audit';
fs.mkdirSync(OUT, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ver = await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json();
const ws = new WebSocket(ver.webSocketDebuggerUrl);
let idc = 0; const pending = new Map();
const send = (m, p = {}, s) => { const id = ++idc; const msg = { id, method: m, params: p }; if (s) msg.sessionId = s; ws.send(JSON.stringify(msg)); return new Promise((res, rej) => pending.set(id, { res, rej })); };
ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { const { res, rej } = pending.get(m.id); pending.delete(m.id); m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result); } };

const DEVICES = [
  { name: 'iphone14-land', w: 844, h: 390, dsf: 3, mobile: true },
  { name: 'iphone14-port', w: 390, h: 844, dsf: 3, mobile: true },
  { name: 'se-land', w: 667, h: 375, dsf: 2, mobile: true },
  { name: 'android-land', w: 800, h: 360, dsf: 2, mobile: true },
];

const shot = async (sid, file) => {
  const r = await send('Page.captureScreenshot', { format: 'png' }, sid);
  fs.writeFileSync(`${OUT}/${file}`, Buffer.from(r.data, 'base64'));
};

ws.onopen = async () => {
  for (const d of DEVICES) {
    const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
    const { sessionId: sid } = await send('Target.attachToTarget', { targetId, flatten: true });
    await send('Page.enable', {}, sid);
    await send('Runtime.enable', {}, sid);
    await send('Emulation.setDeviceMetricsOverride', { width: d.w, height: d.h, deviceScaleFactor: 1, mobile: d.mobile }, sid);
    await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 }, sid);
    await send('Emulation.setUserAgentOverride', { userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1' }, sid);
    await send('Page.navigate', { url: `${BASE}/fight/game.html` }, sid);
    await sleep(3000);

    await shot(sid, `${d.name}-1-intro.png`);
    const introInfo = await send('Runtime.evaluate', {
      expression: `(() => {
        const c = document.querySelector('#intro .card');
        const cs = getComputedStyle(c);
        return JSON.stringify({
          vw: innerWidth, vh: innerHeight, coarse: matchMedia('(pointer:coarse)').matches,
          cardH: Math.round(c.getBoundingClientRect().height),
          scrollH: document.getElementById('intro').scrollHeight,
          overflow: document.getElementById('intro').scrollHeight > innerHeight,
          ctaVisible: (() => { const b = document.getElementById('startBtn').getBoundingClientRect(); return b.bottom <= innerHeight && b.top >= 0; })(),
        });
      })()`, returnByValue: true,
    }, sid);

    await send('Runtime.evaluate', { expression: `document.getElementById('startBtn').click()` }, sid);
    await sleep(600);
    await shot(sid, `${d.name}-2-select.png`);
    const selInfo = await send('Runtime.evaluate', {
      expression: `(() => {
        const g = document.getElementById('goBtn').getBoundingClientRect();
        const p = document.querySelector('#picks .pick').getBoundingClientRect();
        return JSON.stringify({ goVisible: g.bottom <= innerHeight, pickH: Math.round(p.height), picksW: Math.round(document.getElementById('picks').getBoundingClientRect().width) });
      })()`, returnByValue: true,
    }, sid);

    await send('Runtime.evaluate', { expression: `document.getElementById('goBtn').click()` }, sid);
    await sleep(2500);
    await shot(sid, `${d.name}-3-fight.png`);
    const fightInfo = await send('Runtime.evaluate', {
      expression: `(() => {
        const r = (id) => { const b = document.getElementById(id)?.getBoundingClientRect(); return b ? [Math.round(b.x), Math.round(b.y), Math.round(b.width), Math.round(b.height)] : null; };
        const btns = [...document.querySelectorAll('#acts button')].map(b => { const rr = b.getBoundingClientRect(); return Math.round(rr.height); });
        const canvas = document.querySelector('canvas').getBoundingClientRect();
        return JSON.stringify({
          dpad: r('dpad'), acts: r('acts'), canvas: [Math.round(canvas.width), Math.round(canvas.height)],
          actBtnCount: btns.length, actBtnH: btns.slice(0, 3),
          touchOn: document.getElementById('touch').classList.contains('on'),
          rotateOn: document.getElementById('rotate').classList.contains('on'),
          hudBars: r('hud'),
          overlap: (() => { const a = document.getElementById('acts').getBoundingClientRect(); const dp = document.getElementById('dpad').getBoundingClientRect(); return a.left < dp.right; })(),
        });
      })()`, returnByValue: true,
    }, sid);

    console.log(`\n[${d.name}] ${d.w}x${d.h}`);
    console.log('  intro ', introInfo.result.value);
    console.log('  select', selInfo.result.value);
    console.log('  fight ', fightInfo.result.value);

    await send('Target.closeTarget', { targetId });
  }
  process.exit(0);
};
