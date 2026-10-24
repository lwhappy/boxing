// Sweep every page, screenshot its 3D stage, and report the dominant color of the
// rendered character so we can tell "textured" from "gray" objectively.
// usage: node build/cdp_sweep.mjs
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';

const PORT = process.env.CDP_PORT || '9222';
const BASE = process.env.BASE || 'http://127.0.0.1:8123/web';
const OUT = process.env.OUT || '/tmp/sweep';
fs.mkdirSync(OUT, { recursive: true });

const PAGES = process.env.PAGES
  ? process.env.PAGES.split(',')
  : ['index.html', 'jab.html', 'cross.html', 'leadhook.html', 'rearhook.html',
     'leaduppercut.html', 'rearuppercut.html', 'training.html',
     'combo_jab_cross.html', 'combo_jab_cross_hook.html',
     'combo_jab_cross_leadhook_rearhook.html', 'combo_jab_jab_cross.html',
     'combo_jab_cross_leadhook_cross.html', 'combo_jab_cross_leaduppercut.html',
     'combo_jab_rearuppercut_leadhook.html', 'combo_jab_cross_leadhook_cross_dup.html',
     'combo_cross_leadhook_cross.html', 'combo_idle_jab_cross_leadhook.html'];

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
  const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
  const sid = (await send('Target.attachToTarget', { targetId, flatten: true })).sessionId;
  await send('Runtime.enable', {}, sid);
  await send('Page.enable', {}, sid);
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false }, sid);

  for (const page of PAGES) {
    try {
      await send('Page.navigate', { url: `${BASE}/${page}` }, sid);
      await sleep(9000);
      await send('Runtime.evaluate', {
        expression: `(() => { const c = document.getElementById('stage-canvas'); if (c) c.scrollIntoView({block:'center'}); return 1; })()`,
        returnByValue: true
      }, sid);
      await sleep(2000);

      const rect = await send('Runtime.evaluate', {
        expression: `(() => { const c = document.getElementById('stage-canvas'); if (!c) return null;
          const r = c.getBoundingClientRect(); return JSON.stringify({x:r.x,y:r.y,width:r.width,height:r.height}); })()`,
        returnByValue: true
      }, sid);

      if (!rect.result.value) { console.log(`${page.padEnd(42)} NO CANVAS`); continue; }
      const r = JSON.parse(rect.result.value);
      const shot = await send('Page.captureScreenshot', {
        format: 'png', clip: { x: r.x, y: r.y, width: r.width, height: r.height, scale: 1 }
      }, sid);
      const file = `${OUT}/${page.replace(/\.html$/, '')}.png`;
      fs.writeFileSync(file, Buffer.from(shot.data, 'base64'));

      // analyse the saved PNG for colour variety -> a textured character has many hues
      const stats = execFileSync('/Users/justrun/.workbuddy-ai/binaries/python/versions/3.13.12/bin/python3', ['-c', `
import sys
from PIL import Image
im = Image.open(sys.argv[1]).convert('RGB').resize((120,120))
px = list(im.getdata())
n = len(px)
r = sum(p[0] for p in px)/n; g = sum(p[1] for p in px)/n; b = sum(p[2] for p in px)/n
# saturation: how far each pixel is from grey
sat = sum(max(p)-min(p) for p in px)/n
dark = sum(1 for p in px if sum(p) < 260)/n
print(f'{r:.0f} {g:.0f} {b:.0f} {sat:.1f} {dark:.3f}')
`, file]).toString().trim().split(' ');

      const [ar, ag, ab] = stats.slice(0, 3).map(Number);
      const sat = Number(stats[3]);
      const dark = Number(stats[4]);
      const verdict = sat < 6 ? 'GRAY' : (dark < 0.002 ? 'EMPTY' : 'TEXTURED');
      console.log(`${page.padEnd(42)} avgRGB=${ar},${ag},${ab}  sat=${String(sat).padStart(5)}  dark%=${(dark * 100).toFixed(1).padStart(5)}  ${verdict}`);
    } catch (e) {
      console.log(`${page.padEnd(42)} ERROR ${e.message}`);
    }
  }

  await send('Target.closeTarget', { targetId });
  process.exit(0);
};
