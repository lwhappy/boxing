// Pull the full "boxing" motion list through the logged-in Mixamo page and write manifest.json
import fs from 'node:fs';
import path from 'node:path';

const ROOT = '/Users/justrun/project/boxing-3';
const OUT = path.join(ROOT, process.env.ANIM_DIR || 'animations');
fs.mkdirSync(OUT, { recursive: true });

const PORT = process.env.CDP_PORT || '9222';
const ver = await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json();
const ws = new WebSocket(ver.webSocketDebuggerUrl);
let idc = 0; const pending = new Map();
const send = (m, p = {}, s) => { const id = ++idc; const msg = { id, method: m, params: p }; if (s) msg.sessionId = s; ws.send(JSON.stringify(msg)); return new Promise((res, rej) => pending.set(id, { res, rej })); };
ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { const { res, rej } = pending.get(m.id); pending.delete(m.id); m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result); } };

const EXPR = `(async()=>{
  const H = {'X-Api-Key':'mixamo2','Authorization':'Bearer '+localStorage.getItem('access_token')};
  const all = [];
  let page = 1, pag = null;
  while (true) {
    const r = await fetch('/api/v1/products?page='+page+'&limit=96&query=boxing&type=Motion%2CMotionPack&order=', {headers:H});
    if (!r.ok) return JSON.stringify({ok:false, status:r.status, page});
    const j = await r.json();
    all.push(...j.results);
    pag = j.pagination;
    if (!pag || page >= (pag.num_pages||1) || j.results.length === 0) break;
    page++;
  }
  const ch = await (await fetch('/api/v1/characters', {headers:H})).json();
  const users = ch.filter(c=>c.type==='user').map(c=>({uuid:c.uuid,name:c.name,status:c.status}));
  return JSON.stringify({ok:true, count: all.length, pagination: pag, users, results: all.map(p=>({id:p.id,name:p.name,description:p.description,type:p.type,motion_id:p.motion_id}))});
})()`;

ws.onopen = async () => {
  const { targetInfos } = await send('Target.getTargets');
  const t = targetInfos.find(x => x.type === 'page' && (x.url||'').includes('mixamo.com'));
  const sid = (await send('Target.attachToTarget', { targetId: t.targetId, flatten: true })).sessionId;
  await send('Runtime.enable', {}, sid);
  const r = await send('Runtime.evaluate', { expression: EXPR, awaitPromise: true, returnByValue: true }, sid);
  if (r.exceptionDetails) { console.log('EXC', JSON.stringify(r.exceptionDetails).slice(0,500)); process.exit(1); }
  const data = JSON.parse(r.result.value);
  if (!data.ok) { console.log('FAIL', JSON.stringify(data)); process.exit(1); }

  const seen = new Map();
  const items = data.results.map((p, i) => {
    const base = `${p.name} - ${p.description}`.replace(/[\/\\:*?"<>|]/g, '-').replace(/\s+/g, ' ').trim();
    const n = (seen.get(base) || 0) + 1; seen.set(base, n);
    const file = (n === 1 ? base : `${base} (${n})`) + '.fbx';
    return { index: i + 1, id: p.id, name: p.name, description: p.description, type: p.type, file, skin: false, status: 'pending' };
  });

  const special = items.find(i => /^bouncing boxing idle$/i.test(i.description.trim()));
  if (special) special.skin = true;

  const manifest = {
    query: 'boxing',
    source: 'mixamo.com (session via CDP)',
    character_id: (data.users.find(u=>u.status==='ready')||data.users[0]||{}).uuid,
    characters: data.users,
    pagination: data.pagination,
    total: items.length,
    naming: '<name> - <description>.fbx  (dupe gets " (n)")',
    skin_rule: 'description === "Bouncing Boxing Idle" -> skin:true, all others skin:false',
    items,
  };
  fs.writeFileSync(path.join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 1));

  const skins = items.filter(i => i.skin);
  console.log(`total=${items.length}  dupes=${[...seen.values()].filter(v=>v>1).length}  skin=true: ${skins.map(s=>s.file).join(', ') || '(none)'}`);
  console.log(`character=${manifest.character_id}  candidates=${JSON.stringify(data.users)}`);
  const byName = {};
  for (const it of items) byName[it.name] = (byName[it.name]||0)+1;
  console.log('names:', JSON.stringify(byName));
  process.exit(0);
};
