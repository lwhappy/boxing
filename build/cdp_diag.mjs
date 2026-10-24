// Diagnose why the character renders gray: inspect the live material state in the browser.
// usage: URL=... SHOT=... node build/cdp_diag.mjs
import fs from 'node:fs';

const PORT = process.env.CDP_PORT || '9222';
const URL_ = process.env.URL || 'http://127.0.0.1:8123/web/index.html';
const SHOT = process.env.SHOT || '/tmp/diag.png';
const WAIT = Number(process.env.WAIT || 25000);

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
  if (m.method === 'Runtime.consoleAPICalled') {
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
    netFails.push(`${m.params.type} ${m.params.errorText}`);
  }
  if (m.method === 'Network.responseReceived') {
    const r = m.params.response;
    if (r.url.includes('.glb')) netFails.push(`RESP ${r.status} ${r.url} ${r.mimeType} len=${r.encodedDataLength}`);
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
    await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false }, sessionId);

    await send('Page.navigate', { url: URL_ }, sessionId);
    await sleep(WAIT);

    // scroll the 3D stage into view and let it render
    await send('Runtime.evaluate', {
      expression: `(() => {
        const c = document.getElementById('stage-canvas');
        if (c) c.scrollIntoView({block:'center'});
        window.scrollTo(0,0);
        return 'ok';
      })()`,
      returnByValue: true
    }, sessionId);
    await sleep(2500);

    const diag = await send('Runtime.evaluate', {
      expression: `(() => {
        const out = { url: location.href, hasStage: !!window.__comboStage, hasHome: !!window.__homeStage };
        const st = window.__comboStage || window.__homeStage;
        if (!st) return JSON.stringify(out);
        const mats = [];
        st.model.traverse((o) => {
          if (!o.isMesh || !o.material) return;
          const list = Array.isArray(o.material) ? o.material : [o.material];
          for (const m of list) {
            const rec = {
              name: m.name,
              type: m.type,
              color: '#' + m.color.getHexString(),
              map: m.map ? (m.map.image ? m.map.image.src || m.map.image.name || 'canvas' : 'no-image') : null,
              mapColorSpace: m.map ? m.map.colorSpace : null,
              mapImgW: m.map && m.map.image ? m.map.image.width : null,
              mapImgH: m.map && m.map.image ? m.map.image.height : null,
              normalMap: !!m.normalMap,
              roughnessMap: !!m.roughnessMap,
              metalnessMap: !!m.metalnessMap,
              aoMap: !!m.aoMap,
              metalness: m.metalness,
              roughness: m.roughness,
              transparent: m.transparent,
              opacity: m.opacity,
              alphaTest: m.alphaTest,
              depthWrite: m.depthWrite,
              side: m.side,
              envMapIntensity: m.envMapIntensity,
              visible: o.visible,
              uvCount: o.geometry.attributes.uv ? o.geometry.attributes.uv.count : 0,
              hasUv1: !!o.geometry.attributes.uv1,
            };
            mats.push(rec);
          }
        });
        out.materials = mats;
        out.clips = [];
        return JSON.stringify(out, null, 1);
      })()`,
      returnByValue: true
    }, sessionId);

    console.log('--- material state ---');
    console.log(diag.result.value);

    // Sample the actual rendered pixel colors from the canvas
    const px = await send('Runtime.evaluate', {
      expression: `(() => {
        const c = document.getElementById('stage-canvas');
        if (!c) return 'no canvas';
        const t = document.createElement('canvas');
        t.width = c.width; t.height = c.height;
        const g = t.getContext('2d');
        g.drawImage(c, 0, 0);
        const d = g.getImageData(0, 0, t.width, t.height).data;
        const counts = {};
        let opaque = 0;
        for (let i = 0; i < d.length; i += 4 * 37) {
          if (d[i+3] < 10) continue;
          opaque++;
          const k = (d[i]>>4) + ',' + (d[i+1]>>4) + ',' + (d[i+2]>>4);
          counts[k] = (counts[k]||0)+1;
        }
        const top = Object.entries(counts).sort((a,b)=>b[1]-a[1]).slice(0,8);
        return JSON.stringify({ canvas: c.width + 'x' + c.height, opaqueSamples: opaque, topColors: top });
      })()`,
      returnByValue: true
    }, sessionId);
    console.log('--- rendered pixels (16-level buckets) ---');
    console.log(px.result.value);

    const shot = await send('Page.captureScreenshot', { format: 'png' }, sessionId);
    fs.writeFileSync(SHOT, Buffer.from(shot.data, 'base64'));

    // crop to the stage canvas so we can see the character clearly
    const rectRes = await send('Runtime.evaluate', {
      expression: `(() => {
        const c = document.getElementById('stage-canvas');
        if (!c) return null;
        const r = c.getBoundingClientRect();
        return JSON.stringify({x: r.x, y: r.y, width: r.width, height: r.height});
      })()`,
      returnByValue: true
    }, sessionId);
    if (rectRes.result.value) {
      const r = JSON.parse(rectRes.result.value);
      const cshot = await send('Page.captureScreenshot', {
        format: 'png',
        clip: { x: r.x, y: r.y, width: r.width, height: r.height, scale: 1 }
      }, sessionId);
      fs.writeFileSync(SHOT.replace(/\.png$/, '-canvas.png'), Buffer.from(cshot.data, 'base64'));
      console.log('canvas crop:', SHOT.replace(/\.png$/, '-canvas.png'));
    }

    console.log('--- console ---');
    console.log(logs.slice(0, 25).join('\n') || '(none)');
    console.log('--- errors ---');
    console.log(errors.slice(0, 15).join('\n') || '(none)');
    console.log('--- net ---');
    console.log(netFails.slice(0, 15).join('\n') || '(none)');
    console.log('screenshot:', SHOT);

    if (process.env.KEEP !== '1') await send('Target.closeTarget', { targetId });
    process.exit(0);
  } catch (e) {
    console.log('FATAL', e.message);
    process.exit(1);
  }
};
