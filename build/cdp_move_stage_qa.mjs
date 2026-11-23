// QA for the shared move stage on a moves/ page.
// Usage: node cdp_move_stage_qa.mjs <page-slug> [tag]
//   slug: cross | rearhook | leaduppercut
import fs from 'node:fs';

const slug = process.argv[2] || 'cross';
const TAG = process.argv[3] || slug;
const URL = `http://127.0.0.1:8945/moves/${slug}.html`;

const ver = await (await fetch('http://127.0.0.1:9222/json/version')).json();
const ws = new WebSocket(ver.webSocketDebuggerUrl);
let idc = 0; const pending = new Map();
const send = (method, params = {}, sessionId) => {
  const id = ++idc;
  ws.send(JSON.stringify({ id, method, params, sessionId }));
  return new Promise((res, rej) => pending.set(id, { res, rej }));
};
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) {
    const { res, rej } = pending.get(m.id); pending.delete(m.id);
    m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result);
  }
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
await new Promise((r) => ws.onopen = r);
const { targetInfos } = await send('Target.getTargets');
const page = targetInfos.find((t) => t.type === 'page');
const { sessionId: sid } = await send('Target.attachToTarget', { targetId: page.targetId, flatten: true });
await send('Runtime.enable', {}, sid);
await send('Page.enable', {}, sid);
const MOBILE = process.env.MOBILE === '1';
await send('Emulation.setDeviceMetricsOverride',
  MOBILE ? { width: 390, height: 844, deviceScaleFactor: 2, mobile: true }
         : { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false }, sid);
await send('Emulation.setFocusEmulationEnabled', { enabled: true }, sid);

const errors = [];
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data);
  if (m.method === 'Runtime.exceptionThrown') errors.push(JSON.stringify(m.params.exceptionDetails).slice(0, 300));
});
const ev = async (expr) => {
  const r = await send('Runtime.evaluate', { returnByValue: true, expression: expr }, sid);
  if (r.exceptionDetails) return 'EXC ' + JSON.stringify(r.exceptionDetails).slice(0, 400);
  return r.result.value;
};
const shot = async (name) => {
  const s = await send('Page.captureScreenshot', { format: 'png' }, sid);
  fs.writeFileSync(`${import.meta.dirname}/captures/move_${TAG}_${name}.png`, Buffer.from(s.data, 'base64'));
  console.log(`shot: move_${TAG}_${name}.png`);
};

await send('Page.navigate', { url: URL }, sid);
await sleep(9500);
console.log('boot:', await ev(`(() => {
  const j = window.__move;
  if (!j) return 'NO __move';
  return JSON.stringify({ phase: j.phase, moveImpact: +j.moveImpact.toFixed(3), frames: j.frames,
    clips: Object.keys(j.woman.actions), running: j.running });
})()`));

// let the intro play out to the frozen pose naturally, screenshot it
await ev(`window.__move.stepTo(8)`);   // jumps through reveal into paused
await sleep(600);
console.log('paused:', await ev(`(() => {
  const j = window.__move;
  const cards = document.querySelectorAll('.hero-callout.show').length;
  const lines = document.querySelectorAll('.hero-lines g').length;
  const word = document.querySelector('.hero-word');
  return JSON.stringify({ phase: j.phase, cards, word: word.textContent, wordShown: word.classList.contains('show') });
})()`));
await shot('paused');

// real click: Close -> docked corner widget (click the button's own rect centre)
const clickBtn = async (id) => {
  const r = JSON.parse(await ev(`(() => {
    const b = document.getElementById('${id}').getBoundingClientRect();
    return JSON.stringify({ x: Math.round(b.left + b.width / 2), y: Math.round(b.top + b.height / 2) });
  })()`));
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: r.x, y: r.y, button: 'left', clickCount: 1 }, sid);
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: r.x, y: r.y, button: 'left', clickCount: 1 }, sid);
};
await clickBtn('jab-close');
await sleep(1200);
console.log('docked:', await ev(`(() => {
  const j = window.__move;
  const st = document.getElementById('jab-stage');
  const r = st.getBoundingClientRect();
  const btn = document.getElementById('jab-replay').getBoundingClientRect();
  return JSON.stringify({ phase: j.phase, cls: st.className.split(' ').pop(),
    pos: getComputedStyle(st).position, flush: r.left <= 0.5 && innerHeight - r.bottom <= 0.5,
    w: Math.round(r.width), btnVisible: btn.width > 0 && btn.bottom <= innerHeight,
    callouts: document.querySelectorAll('.hero-callout.show').length });
})()`));
await shot('docked');

// docked replay -> back to the big show
await clickBtn('jab-replay');
await sleep(800);
console.log('replayed:', await ev(`(() => {
  const j = window.__move;
  return JSON.stringify({ phase: j.phase, cls: document.getElementById('jab-stage').className.split(' ').pop(),
    running: j.running, frames: j.frames });
})()`));
console.log('errors:', errors.length ? errors.join(' | ') : '(none)');
process.exit(0);
