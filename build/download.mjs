// Batch-export every item in animations/manifest.json through the logged-in Mixamo page,
// then pull each S3 result URL from Node and save with an explicit filename.
import fs from 'node:fs';
import path from 'node:path';

const PORT = process.env.CDP_PORT || '9222';
const ROOT = '/Users/justrun/project/boxing-3';
const ANIM_DIR = path.join(ROOT, process.env.ANIM_DIR || 'animations');
const MANIFEST = path.join(ANIM_DIR, 'manifest.json');
const CONCURRENCY = Number(process.env.CONCURRENCY || 3);
const FBX_MAGIC = 'Kaydara FBX Binary';
const ONLY = process.env.ONLY ? process.env.ONLY.split(',').map(Number) : null;

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
  if (m.id && pending.has(m.id)) { const { res, rej } = pending.get(m.id); pending.delete(m.id);
    m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result); }
};
const sleep = ms => new Promise(r => setTimeout(r, ms));

function pageJobScript(pid, skin) {
  return `(async () => {
  const tok = localStorage.getItem('access_token');
  const H = {'X-Api-Key':'mixamo2','Authorization':'Bearer '+tok,'Content-Type':'application/json'};
  const rd = await fetch('/api/v1/products/${pid}', {headers:H});
  if (!rd.ok) return JSON.stringify({ok:false, stage:'detail', status:rd.status, body:(await rd.text()).slice(0,200)});
  const d = await rd.json();
  const mk = (h) => ({'model-id':h['model-id'], mirror:h.mirror||false, trim:h.trim||[0,100], overdrive:0,
                      params:(h.params||[]).map(p=>p[1]).join(','), 'arm-space':h['arm-space']||0, inplace:h.inplace||false});
  const clips = (d.type === 'MotionPack')
    ? (d.details.motions||[]).map(m => mk(m.gms_hash))
    : [mk(d.details.gms_hash)];
  const payload = { gms_hash: clips, preferences: {format:'fbx7_2019', skin:'${skin ? 'true' : 'false'}', fps:'30', reducekf:'0'},
                    character_id: '${CHARACTER_ID}', type: d.type, product_name: d.name };
  const re = await fetch('/api/v1/animations/export', {method:'POST', headers:H, body: JSON.stringify(payload)});
  if (re.status !== 202 && !re.ok) return JSON.stringify({ok:false, stage:'export', status:re.status, body:(await re.text()).slice(0,200)});
  const je = await re.json();
  if (!je.uuid) return JSON.stringify({ok:false, stage:'export-nouuid', body: JSON.stringify(je).slice(0,200)});
  for (let i=0;i<100;i++){
    await new Promise(r=>setTimeout(r,1500));
    const rm = await fetch('/api/v1/characters/'+je.uuid+'/monitor', {headers:H});
    if (!rm.ok) continue;
    const jm = await rm.json();
    if (jm.status === 'completed') return JSON.stringify({ok:true, url: jm.job_result, polls: i+1, product: d.description});
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

async function processOne(it) {
  const dest = path.join(ANIM_DIR, it.file);
  await sleep(Math.floor(Math.random() * 900));
  if (fs.existsSync(dest) && fs.statSync(dest).size > 10000) {
    const head = fs.readFileSync(dest).slice(0, 20).toString('latin1');
    if (head.includes(FBX_MAGIC)) {
      it.status = 'done'; it.bytes = fs.statSync(dest).size; stats.skipped++; stats.bytes += it.bytes;
      console.log(`  [${pad(it.index)}] SKIP ${it.file}`); return;
    }
  }
  let lastErr = null;
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      const job = await runPageJob(it.id, it.skin);
      if (!job.ok) throw new Error(`${job.stage} ${job.body || ''}`);
      const rf = await fetch(job.url);
      if (!rf.ok) throw new Error(`s3 status ${rf.status}`);
      const buf = Buffer.from(await rf.arrayBuffer());
      if (buf.length < 10000 || !buf.slice(0, 20).toString('latin1').includes(FBX_MAGIC))
        throw new Error(`bad payload (${buf.length}B)`);
      fs.writeFileSync(dest, buf);
      it.status = 'done'; it.bytes = buf.length; it.polls = job.polls;
      stats.done++; stats.bytes += buf.length;
      console.log(`  [${pad(it.index)}] OK ${(buf.length / 1024).toFixed(0)}KB skin=${it.skin} ${it.file}`);
      return;
    } catch (e) {
      lastErr = e;
      const wait = 1500 * attempt * attempt;
      console.log(`  [${pad(it.index)}] retry ${attempt}/4 (${e.message}) wait ${wait}ms`);
      await sleep(wait);
    }
  }
  it.status = 'failed'; it.error = String((lastErr && lastErr.message) || lastErr);
  stats.failed++; failures.push(it);
  console.log(`  [${pad(it.index)}] FAIL ${it.file}: ${it.error}`);
}

ws.onopen = async () => {
  try {
    const { targetInfos } = await send('Target.getTargets');
    const t = targetInfos.find(x => x.type === 'page' && (x.url || '').includes('mixamo.com'));
    if (!t) throw new Error('no mixamo page target');
    sid = (await send('Target.attachToTarget', { targetId: t.targetId, flatten: true })).sessionId;
    await send('Runtime.enable', {}, sid);

    const todo = items.filter(i => (!ONLY || ONLY.includes(i.index)) && i.status !== 'done');
    console.log(`start: ${todo.length} items, concurrency ${CONCURRENCY}, character ${CHARACTER_ID}`);

    let cursor = 0;
    const workers = Array.from({ length: CONCURRENCY }, async () => {
      while (cursor < todo.length) await processOne(todo[cursor++]);
    });
    const saver = setInterval(saveManifest, 10000);
    await Promise.all(workers);
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
