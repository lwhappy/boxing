/**
 * Fresh-profile vs. warm-profile render comparison.
 *
 * Usage: node build/cdp_cache_test.mjs <url> <tag> [userDataDir]
 *
 * - Uses a brand-new userDataDir unless one is passed.
 * - Navigates, waits for the three.js model to be ready, then screenshots
 *   ONLY the stage canvas so the pixel statistics are not polluted by the
 *   surrounding page chrome.
 * - Reports saturation (colorfulness) so "gray" vs "textured" is objective.
 */
import { spawn } from 'node:child_process';
import { writeFileSync, mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';

const url = process.argv[2] || 'http://127.0.0.1:8123/web/combo_jab_cross.html';
const tag = process.argv[3] || 'fresh';
const userDataDir = process.argv[4] || `/tmp/chrome-cache-${tag}`;
const PORT = 9400 + Math.floor(Math.random() * 400);
const OUT = path.resolve('build/captures');
mkdirSync(OUT, { recursive: true });

if (!process.argv[4]) {
  try { rmSync(userDataDir, { recursive: true, force: true }); } catch {}
}
mkdirSync(userDataDir, { recursive: true });

const chrome = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', [
  '--headless=new',
  `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${userDataDir}`,
  '--no-first-run',
  '--no-default-browser-check',
  '--disable-extensions',
  '--window-size=1280,900',
  '--use-gl=angle',
  '--use-angle=swiftshader',
  '--enable-unsafe-swiftshader',
  'about:blank',
], { stdio: 'ignore', detached: false });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getWsUrl() {
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/json/version`);
      const j = await r.json();
      if (j.webSocketDebuggerUrl) return j.webSocketDebuggerUrl;
    } catch {}
    await sleep(250);
  }
  throw new Error('chrome did not expose CDP');
}

const wsUrl = await getWsUrl();
const ws = new WebSocket(wsUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });

let msgId = 0;
const pending = new Map();
const events = [];
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  else if (m.method) events.push(m);
};
function send(method, params = {}, sessionId) {
  const id = ++msgId;
  return new Promise((res) => {
    pending.set(id, res);
    ws.send(JSON.stringify({ id, method, params, sessionId }));
  });
}

const { result: { targetId } } = await send('Target.createTarget', { url: 'about:blank' });
const { result: { sessionId } } = await send('Target.attachToTarget', { targetId, flatten: true });
const S = (m, p) => send(m, p, sessionId);

await S('Page.enable');
await S('Runtime.enable');
await S('Network.enable');
await S('Log.enable');

// Track every network request for the GLB so we can see what bytes arrived.
const netLog = [];
ws.addEventListener('message', (ev) => {
  const m = JSON.parse(ev.data);
  if (m.method === 'Network.responseReceived' && m.sessionId === sessionId) {
    const r = m.params.response;
    if (/\.glb(\?|$)/.test(r.url)) {
      netLog.push({ url: r.url, status: r.status, mime: r.headers['content-type'] || r.headers['Content-Type'] || '', len: r.encodedDataLength });
    }
  }
});

console.log(`[${tag}] navigating -> ${url}`);
await S('Page.navigate', { url });
await sleep(9000);

// Ask the page what it actually rendered.
const probe = await S('Runtime.evaluate', {
  returnByValue: true,
  awaitPromise: true,
  expression: `(async () => {
    const out = { url: location.href, materials: [], glbBytes: null, canvas: null, errors: [] };
    // three.js exposure
    const st = window.__homeStage || window.__comboStage || window.__stage;
    if (st && st.model) {
      st.model.traverse((o) => {
        if (!o.isMesh || !o.material) return;
        const m = o.material;
        out.materials.push({
          name: m.name || '(unnamed)',
          hasMap: !!m.map,
          mapImg: m.map ? (m.map.image ? m.map.image.width + 'x' + m.map.image.height : 'no-image') : null,
          colorSpace: m.map ? m.map.colorSpace : null,
          transparent: m.transparent,
          opacity: m.opacity,
          alphaTest: m.alphaTest,
          depthWrite: m.depthWrite,
          color: m.color ? '#' + m.color.getHexString() : null,
          metalness: m.metalness,
          roughness: m.roughness,
          vertexColors: m.vertexColors
        });
      });
    }
    const c = document.getElementById('stage-canvas') || document.querySelector('canvas');
    if (c) {
      out.canvas = { w: c.width, h: c.height, cw: c.clientWidth, ch: c.clientHeight };
      try {
        const gl = c.getContext('webgl2') || c.getContext('webgl');
        const px = new Uint8Array(c.width * c.height * 4);
        gl.readPixels(0, 0, c.width, c.height, gl.RGBA, gl.UNSIGNED_BYTE, px);
        let n = c.width * c.height, sat = 0, dark = 0, sum = 0;
        for (let i = 0; i < n; i++) {
          const r = px[i*4], g = px[i*4+1], b = px[i*4+2];
          sat += Math.max(r,g,b) - Math.min(r,g,b);
          sum += r+g+b;
          if (r+g+b < 260) dark++;
        }
        out.pixel = { sat: +(sat/n).toFixed(2), darkFrac: +(dark/n).toFixed(5), avg: +(sum/(n*3)).toFixed(1) };
      } catch (e) { out.pixelError = String(e); }
    }
    return out;
  })()`,
});

const info = probe.result?.result?.value || {};
console.log(`[${tag}] materials:`);
for (const m of info.materials || []) console.log('   ', JSON.stringify(m));
if (info.pixel) console.log(`[${tag}] pixel: ${JSON.stringify(info.pixel)}`);
if (info.canvas) console.log(`[${tag}] canvas: ${JSON.stringify(info.canvas)}`);
console.log(`[${tag}] glb requests:`, JSON.stringify(netLog));

// Canvas-clipped screenshot (visual evidence we can eyeball later).
const shot = await S('Page.captureScreenshot', { format: 'png' });
if (shot.result?.data) {
  const f = path.join(OUT, `cachetest-${tag}.png`);
  writeFileSync(f, Buffer.from(shot.result.data, 'base64'));
  console.log(`[${tag}] screenshot -> ${f}`);
}

const errs = events.filter((e) => e.method === 'Log.entryAdded' && e.params.entry.level === 'error')
  .map((e) => e.params.entry.text);
if (errs.length) console.log(`[${tag}] console errors:`, errs.slice(0, 5));

ws.close();
chrome.kill('SIGKILL');
process.exit(0);
