/**
 * QA for the rotate toggle + latching GUARD on /fight/game/
 *   node build/cdp_rotate_guard.mjs
 */
import fs from 'node:fs';

const PORT = process.env.CDP_PORT || '9333';
const BASE = process.env.BASE || 'http://127.0.0.1:8945';
const OUT = process.env.OUT || '/tmp/rotate-guard';
fs.mkdirSync(OUT, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ver = await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json();
const ws = new WebSocket(ver.webSocketDebuggerUrl);
let idc = 0; const pending = new Map();
const send = (m, p = {}, s) => { const id = ++idc; const msg = { id, method: m, params: p }; if (s) msg.sessionId = s; ws.send(JSON.stringify(msg)); return new Promise((res, rej) => pending.set(id, { res, rej })); };
ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { const { res, rej } = pending.get(m.id); pending.delete(m.id); m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result); } };

const DEVICES = [
  { name: 'port', w: 390, h: 844 },
  { name: 'land', w: 844, h: 390 },
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
    await send('Emulation.setDeviceMetricsOverride', { width: d.w, height: d.h, deviceScaleFactor: 2, mobile: true }, sid);
    await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 }, sid);
    await send('Emulation.setUserAgentOverride', { userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1' }, sid);
    await send('Page.navigate', { url: `${BASE}/fight/game/?demo=woman&level=1&touch=1` }, sid);
    await sleep(4200);
    await shot(sid, `${d.name}-1.png`);

    const geo = await send('Runtime.evaluate', {
      expression: `(() => {
        const r = (id) => { const e = document.getElementById(id); if (!e) return null; const b = e.getBoundingClientRect(); return [Math.round(b.x), Math.round(b.y), Math.round(b.width), Math.round(b.height)]; };
        const rot = document.getElementById('rot');
        const cs = rot && getComputedStyle(rot);
        return JSON.stringify({
          vw: innerWidth, vh: innerHeight,
          rot: r('rot'), rotVisible: !!rot && cs.display !== 'none',
          dpad: r('dpad'), acts: r('acts'),
          rect: (() => { const q = document.getElementById('rotRect'); return q && [q.getAttribute('x'), q.getAttribute('y'), q.getAttribute('width'), q.getAttribute('height')]; })(),
          label: rot && rot.getAttribute('aria-label'),
        });
      })()`, returnByValue: true,
    }, sid);
    console.log(`\n[${d.name}]`, geo.result.value);

    // tap GUARD via a real touch tap
    const g = await send('Runtime.evaluate', {
      expression: `(() => {
        const b = [...document.querySelectorAll('#acts button')].find(x => x.textContent.trim() === 'GUARD');
        if (!b) return 'no-guard-btn';
        const r = b.getBoundingClientRect();
        return JSON.stringify({ x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) });
      })()`, returnByValue: true,
    }, sid);
    const pos = JSON.parse(g.result.value);
    await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: pos.x, y: pos.y }] }, sid);
    await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }, sid);
    await sleep(1800);
    await shot(sid, `${d.name}-2-guard.png`);
    const guard = await send('Runtime.evaluate', {
      expression: `(() => {
        const p = window.__game && window.__game.player;
        const b = [...document.querySelectorAll('#acts button')].find(x => x.textContent.trim() === 'GUARD');
        return JSON.stringify({ guarding: p && p.guarding, state: p && p.state, btnOn: b && b.classList.contains('on') });
      })()`, returnByValue: true,
    }, sid);
    console.log('  guard after 1.8s:', guard.result.value);

    await sleep(2500);
    const guard2 = await send('Runtime.evaluate', {
      expression: `(() => { const p = window.__game && window.__game.player; return JSON.stringify({ guarding: p && p.guarding, state: p && p.state }); })()`,
      returnByValue: true,
    }, sid);
    console.log('  guard after 4.3s:', guard2.result.value);

    // tap the rotate button
    const rb = await send('Runtime.evaluate', {
      expression: `(() => { const b = document.getElementById('rot').getBoundingClientRect(); return JSON.stringify({ x: Math.round(b.x + b.width / 2), y: Math.round(b.y + b.height / 2) }); })()`,
      returnByValue: true,
    }, sid);
    const rp = JSON.parse(rb.result.value);
    await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: rp.x, y: rp.y }] }, sid);
    await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }, sid);
    await sleep(700);
    await shot(sid, `${d.name}-3-rot-tap.png`);
    const tip = await send('Runtime.evaluate', {
      expression: `(() => { const t = document.getElementById('rotTip'); return JSON.stringify({ tip: t.classList.contains('on'), fs: !!document.fullscreenElement }); })()`,
      returnByValue: true,
    }, sid);
    console.log('  after rotate tap:', tip.result.value);

    await send('Target.closeTarget', { targetId });
  }
  process.exit(0);
};
