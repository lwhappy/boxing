// Pipeline downloader: export jobs are serialized (Mixamo dedupes concurrent
// exports of the same character), but the resulting S3 files are fetched with
// several parallel connections (single-connection bandwidth is throttled).
import fs from 'node:fs';
import path from 'node:path';

const PORT = process.env.CDP_PORT || '9222';
const ROOT = '/Users/justrun/project/boxing-3';
const ANIM_DIR = path.join(ROOT, process.env.ANIM_DIR || 'animations');
const MANIFEST = path.join(ANIM_DIR, 'manifest.json');
const DL_CONCURRENCY = Number(process.env.DL_CONCURRENCY || 5);
const EXPORT_RETRIES = Number(process.env.EXPORT_RETRIES || 4);
const ONLY = process.env.ONLY ? process.env.ONLY.split(',').map(Number) : null;
const MAX_QUEUE = Number(process.env.MAX_QUEUE || 4);
const FBX_MAGIC = 'Kaydara FBX Binary';

const manifest = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
const CHARACTER_ID = process.env.CHARACTER_ID || manifest.character_id;
const items = manifest.items;

const ver = await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json();
const ws = new WebSocket(ver.webSocketDebuggerUrl);
let idc = 0; const pending = new Map();
function send(method, params = {}, sessionId) {
  const id = ++idc; const msg = { id, method, params };
  if (sessionId) msg.sessionId = sessionId;
  ws.send(JSON.stringify(msg));
  return new Promise((res, rej) => pending.set(id, { res, rej }));
}
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) {
    const { res, rej } = pending.get(m.id); pending.delete(m.id);
    m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result);
  }
};
const sleep = ms => new Promise(r => setTimeout(r, ms));

function pageJobScript(pid, skin) {
  return `(async () => {
  const H = {'X-Api-Key':'mixamo2','Authorization':'Bearer '+localStorage.getItem('access_token'),'Content-Type':'application/json'};
  const rd = await fetch('/api/v1/products/${pid}', {headers:H});
  if (!rd.ok) return JSON.stringify({ok:false, stage:'detail', status:rd.status, body:(await rd.text()).slice(0,200)});
  const d = await rd.json();
  const mk = (h) => ({'model-id':h['model-id'], mirror:h.mirror||false, trim:h.trim||[0,100], overdrive:0,
                      params:(h.params||[]).map(p=>p[1]).join(','), 'arm-space':h['arm-space']||0, inplace:h.inplace||false});
  const clips = (d.type === 'MotionPack') ? (d.details.motions||[]).map(m => mk(m.gms_hash)) : [mk(d.details.gms_hash)];
  const payload = { gms_hash: clips, preferences: {format:'fbx7_2019', skin:'${skin ? 'true' : 'false'}', fps:'30', reducekf:'0'},
                    character_id: '${CHARACTER_ID}', type: d.type, product_name: d.name };
  const re = await fetch('/api/v1/animations/export', {method:'POST', headers:H, body: JSON.stringify(payload)});
  if (re.status !== 202 && !re.ok) return JSON.stringify({ok:false, stage:'export', status:re.status, body:(await re.text()).slice(0,200)});
  const je = await re.json();
  if (!je.uuid) return JSON.stringify({ok:false, stage:'export-nouuid', body: JSON.stringify(je).slice(0,200)});
  for (let i=0;i<150;i++){
    await new Promise(r=>setTimeout(r,1500));
    const rm = await fetch('/api/v1/characters/'+je.uuid+'/monitor', {headers:H});
    if (!rm.ok) continue;
    const jm = await rm.json();
    if (jm.status === 'completed') return JSON.stringify({ok:true, url: jm.job_result, polls: i+1});
    if (jm.status === 'failed') return JSON.stringify({ok:false, stage:'job-failed', body: JSON.stringify(jm).slice(0,200)});
  }
  return JSON.stringify({ok:false, stage:'poll-timeout'});
})()`;
}

let sid = null;
async function runPageJob(pid, skin) {
  const r = await send('Runtime.evaluate', { expression: pageJobScript(pid, skin), awaitPromise: true, returnByValue: true }, sid);
  if (r.exceptionDetails) return { ok: false, stage: 'exception', body: JSON.stringify(r.exceptionDetails).slice(0, 200) };
  try { return JSON.parse(r.result.value); } catch { return { ok: false, stage: 'parse', body: String(r.result.value).slice(0, 200) }; }
}

const stats = { done: 0, skipped: 0, failed: 0, bytes: 0 };
const failures = [];
const t0 = Date.now();
const pad = n => String(n).padStart(3, '0');
const saveManifest = () => fs.writeFileSync(MANIFEST, JSON.stringify(manifest, null, 1));
const destOf = it => path.join(ANIM_DIR, it.file);

function alreadyGood(it) {
  const dest = destOf(it);
  if (!fs.existsSync(dest) || fs.statSync(dest).size < 10000) return false;
  const head = fs.readFileSync(dest).slice(0, 20).toString('latin1');
  return head.includes(FBX_MAGIC);
}

// ---- stage 1: serialized exports ----
const jobs = [];
let exportDone = false;
let consumed = 0;

// Exports must never overlap (Mixamo dedupes concurrent jobs for one character),
// so both the producer and the recovery path go through this lock.
let exportLock = Promise.resolve();
function withExportLock(fn) {
  const p = exportLock.then(fn, fn);
  exportLock = p.then(() => {}, () => {});
  return p;
}

async function exporter() {
  for (const it of items) {
    if (ONLY && !ONLY.includes(it.index)) continue;
    if (alreadyGood(it)) {
      it.status = 'done'; it.bytes = fs.statSync(destOf(it)).size; delete it.error;
      stats.skipped++; stats.bytes += it.bytes; continue;
    }
    let lastErr = null, ok = false;
    for (let attempt = 1; attempt <= EXPORT_RETRIES && !ok; attempt++) {
      try {
        // Keep the queue short: signed S3 URLs expire while waiting.
        while (jobs.length - consumed >= MAX_QUEUE) await sleep(400);
        const job = await withExportLock(() => runPageJob(it.id, it.skin));
        if (!job.ok) throw new Error(`${job.stage} ${job.body || ''}`);
        jobs.push({ it, url: job.url, polls: job.polls });
        it.status = 'exported';
        console.log(`  [${pad(it.index)}] EXPORT ok polls=${job.polls} queue=${jobs.length - consumed} ${it.file}`);
        ok = true;
      } catch (e) {
        lastErr = e;
        const wait = 2000 * attempt * attempt;
        console.log(`  [${pad(it.index)}] export retry ${attempt}/${EXPORT_RETRIES} (${e.message}) wait ${wait}ms`);
        await sleep(wait);
      }
    }
    if (!ok) {
      it.status = 'failed'; it.error = String((lastErr && lastErr.message) || lastErr);
      stats.failed++; failures.push(it);
      console.log(`  [${pad(it.index)}] FAIL ${it.file}: ${it.error}`);
    }
  }
  exportDone = true;
  console.log('--- export stage finished, waiting for downloads ---');
}

// ---- stage 2: parallel downloads ----
async function downloader(n) {
  while (true) {
    if (consumed < jobs.length) {
      const entry = jobs[consumed++];
      const { it } = entry;
      let { url, polls } = entry;
      const dest = destOf(it);
      let ok = false, lastErr = null;
      let attempt = 0;
      while (attempt < 6 && !ok) {
        attempt++;
        try {
          const ctl = new AbortController();
          const timer = setTimeout(() => ctl.abort(), 180000);
          const rf = await fetch(url, { signal: ctl.signal });
          clearTimeout(timer);
          if (rf.status === 403 || rf.status === 404) {
            // signed URL expired -> re-export this single item to get a fresh link
            console.log(`  [${pad(it.index)}] stale url (${rf.status}), re-exporting`);
            const job = await withExportLock(() => runPageJob(it.id, it.skin));
            if (!job.ok) throw new Error(`re-export ${job.stage} ${job.body || ''}`);
            url = job.url; polls = job.polls;
            continue;
          }
          if (!rf.ok) throw new Error(`s3 status ${rf.status}`);
          const buf = Buffer.from(await rf.arrayBuffer());
          if (buf.length < 10000 || !buf.slice(0, 20).toString('latin1').includes(FBX_MAGIC))
            throw new Error(`bad payload (${buf.length}B)`);
          fs.writeFileSync(dest, buf);
          it.status = 'done'; it.bytes = buf.length; it.polls = polls; delete it.error;
          stats.done++; stats.bytes += buf.length;
          console.log(`  [${pad(it.index)}] OK ${(buf.length / 1048576).toFixed(1)}MB w${n} ${it.file}`);
          ok = true;
        } catch (e) {
          lastErr = e;
          console.log(`  [${pad(it.index)}] dl retry ${attempt}/6 w${n} (${e.message})`);
          await sleep(2000 * attempt);
        }
      }
      if (!ok) {
        it.status = 'failed'; it.error = String((lastErr && lastErr.message) || lastErr);
        stats.failed++; failures.push(it);
        console.log(`  [${pad(it.index)}] FAIL ${it.file}: ${it.error}`);
      }
      continue;
    }
    if (exportDone) break;
    await sleep(500);
  }
}

ws.onopen = async () => {
  try {
    const { targetInfos } = await send('Target.getTargets');
    const t = targetInfos.find(x => x.type === 'page' && (x.url || '').includes('mixamo.com'));
    if (!t) throw new Error('no mixamo page target');
    sid = (await send('Target.attachToTarget', { targetId: t.targetId, flatten: true })).sessionId;
    await send('Runtime.enable', {}, sid);

    console.log(`pipeline: exports serial, downloads x${DL_CONCURRENCY}, character ${CHARACTER_ID}`);
    const saver = setInterval(saveManifest, 5000);
    const dl = Array.from({ length: DL_CONCURRENCY }, (_, i) => downloader(i + 1));
    await exporter();
    await Promise.all(dl);
    clearInterval(saver);
    saveManifest();

    const secs = ((Date.now() - t0) / 1000).toFixed(0);
    console.log(`\n===== DONE in ${secs}s =====`);
    console.log(`downloaded=${stats.done} skipped=${stats.skipped} failed=${stats.failed} bytes=${(stats.bytes / 1048576).toFixed(1)}MB`);
    if (failures.length) console.log('failures:', failures.map(f => `${f.index}:${f.file}(${f.error})`).join(', '));
    process.exit(failures.length ? 2 : 0);
  } catch (e) { console.log('FATAL:', e.message); process.exit(1); }
};
ws.onerror = () => { console.log('WS ERR'); process.exit(1); };
