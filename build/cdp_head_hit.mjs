// Probe: during the fullscreen show, is the site header / breadcrumb row
// hit-testable (i.e. can the user click Moves / Combos / Home)?
const CHROME = 'http://127.0.0.1:9222';
const PAGE_PAT = new RegExp(process.env.PAGE_PAT || 'rearuppercut');
const list = await (await fetch(CHROME + '/json')).json();
const page = list.find((t) => t.type === 'page' && PAGE_PAT.test(t.url))
  || list.find((t) => t.type === 'page' && /127\.0\.0\.1/.test(t.url));
if (!page) { console.error('no page tab for ' + PAGE_PAT); process.exit(1); }

const ws = new WebSocket(page.webSocketDebuggerUrl);
let id = 0;
const pending = new Map();
ws.addEventListener('message', (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
});
function send(method, params = {}) {
  return new Promise((res) => {
    const mid = ++id;
    pending.set(mid, res);
    ws.send(JSON.stringify({ id: mid, method, params }));
  });
}
await new Promise((r) => ws.addEventListener('open', r, { once: true }));
await send('Page.enable');
await send('Runtime.enable');

async function evalJs(expr) {
  const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
  if (r.result && r.result.exceptionDetails) return { error: r.result.exceptionDetails.text };
  return r.result && r.result.result ? r.result.result.value : undefined;
}

await send('Page.navigate', { url: 'http://127.0.0.1:8945/moves/' + (process.env.PAGE || 'rearuppercut') + '.html' });
await new Promise((r) => setTimeout(r, 1500));

// wait for the fullscreen show to exist
for (let i = 0; i < 60; i++) {
  const ph = await evalJs('window.__move && window.__move.phase');
  if (ph === 'intro' || ph === 'live') break;
  await new Promise((r) => setTimeout(r, 250));
}

const out = await evalJs(`(() => {
  const probe = (el) => {
    if (!el) return null;
    const r = el.getBoundingClientRect();
    const x = r.left + r.width / 2, y = r.top + r.height / 2;
    const top = document.elementFromPoint(x, y);
    return {
      rect: [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)],
      topEl: top ? top.tagName.toLowerCase() + '.' + (top.className || '').toString().split(' ')[0] : null,
      hittable: !!(top && (top === el || el.contains(top) || top.contains(el))),
    };
  };
  const stage = document.getElementById('jab-stage');
  const navA = document.querySelector('.site-head .nav a');
  const crumb = document.querySelector('.breadcrumbs li a');
  const cs = stage ? getComputedStyle(stage) : null;
  const head = document.querySelector('.site-head');
  const crumbBar = document.querySelector('.breadcrumbs');
  return {
    phase: window.__move ? window.__move.phase : null,
    stage: cs ? { z: cs.zIndex, pos: cs.position, pe: cs.pointerEvents, rect: [stage.getBoundingClientRect().top, stage.getBoundingClientRect().height] } : null,
    headZ: head ? getComputedStyle(head).zIndex : null,
    crumbZ: crumbBar ? getComputedStyle(crumbBar).zIndex : null,
    headH: head ? Math.round(head.getBoundingClientRect().height) : null,
    crumbBarRect: crumbBar ? [Math.round(crumbBar.getBoundingClientRect().top), Math.round(crumbBar.getBoundingClientRect().height)] : null,
    nav: probe(navA),
    crumb: probe(crumb),
  };
})()`);
console.log(JSON.stringify(out, null, 2));
ws.close();
process.exit(0);
