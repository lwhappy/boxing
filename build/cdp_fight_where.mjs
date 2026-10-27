/* locate real skinned geometry, then try framing options and screenshot each */
import fs from 'node:fs';
const PORT = process.env.CDP_PORT || '9333';
const URL = process.argv[2] || 'http://127.0.0.1:8958/fight.html';
const ver = await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json();
const ws = new WebSocket(ver.webSocketDebuggerUrl);
let idc = 0; const pending = new Map();
const send = (method, params = {}, sessionId) => {
  const id = ++idc; const msg = { id, method, params }; if (sessionId) msg.sessionId = sessionId;
  ws.send(JSON.stringify(msg));
  return new Promise((res, rej) => pending.set(id, { res, rej }));
};
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) { const { res, rej } = pending.get(m.id); pending.delete(m.id); m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result); }
};
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
ws.onopen = async () => {
  const { targetInfos } = await send('Target.getTargets');
  const t = targetInfos.find(x => x.type === 'page');
  const sid = (await send('Target.attachToTarget', { targetId: t.targetId, flatten: true })).sessionId;
  await send('Runtime.enable', {}, sid);
  await send('Page.navigate', { url: URL }, sid);
  const ev = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }, sid);
    if (r.exceptionDetails) return { error: (r.exceptionDetails.exception && r.exceptionDetails.exception.description) || r.exceptionDetails.text };
    return r.result.value;
  };
  for (let i = 0; i < 200; i++) { await sleep(300); if (await ev(`!!(window.__fight && window.__fight.ready)`) === true) break; }

  const info = await ev(`(() => {
    const F = window.__fight, m = F.model, cam = F.camera;
    const V = cam.position.constructor;
    m.updateMatrixWorld(true);
    const pts = [];
    m.traverse(o => {
      if (!o.isMesh || !o.geometry.attributes.position) return;
      const pos = o.geometry.attributes.position;
      const step = Math.max(1, Math.floor(pos.count / 3000));
      for (let i = 0; i < pos.count; i += step) {
        const v = new V().fromBufferAttribute(pos, i);
        if (o.isSkinnedMesh) o.applyBoneTransform(i, v);
        v.applyMatrix4(o.matrixWorld);
        pts.push(v);
      }
    });
    let mn=[1e9,1e9,1e9], mx=[-1e9,-1e9,-1e9];
    for (const p of pts) { mn=[Math.min(mn[0],p.x),Math.min(mn[1],p.y),Math.min(mn[2],p.z)]; mx=[Math.max(mx[0],p.x),Math.max(mx[1],p.y),Math.max(mx[2],p.z)]; }
    // bone anchors
    const bones = {};
    for (const [k, c] of Object.entries(F.chars)) {
      const h = c.root.getObjectByName('mixamorigHips') || c.root.getObjectByName('mixamorig:Hips');
      const hd = c.root.getObjectByName('mixamorigHead') || c.root.getObjectByName('mixamorig:Head');
      bones[k] = {
        rootPos: c.root.position.toArray().map(n=>+n.toFixed(2)),
        hips: h ? h.getWorldPosition(new V()).toArray().map(n=>+n.toFixed(2)) : null,
        head: hd ? hd.getWorldPosition(new V()).toArray().map(n=>+n.toFixed(2)) : null
      };
    }
    return { n: pts.length, bbox: { min: mn.map(n=>+n.toFixed(2)), max: mx.map(n=>+n.toFixed(2)) }, bones };
  })()`);
  console.log(JSON.stringify(info, null, 2));

  // Option A: aim the existing init-camera position at the bbox center, keep fov
  const shots = [
    ['a-aim', `(() => { const F=window.__fight, c=F.camera; const cx=(${info.bbox.min[0]}+${info.bbox.max[0]})/2, cy=(${info.bbox.min[1]}+${info.bbox.max[1]})/2, cz=(${info.bbox.min[2]}+${info.bbox.max[2]})/2; c.lookAt(cx, cy, cz); c.updateMatrixWorld(true); return c.position.toArray(); })()`],
    ['b-pullback', `(() => { const F=window.__fight, c=F.camera; const cx=(${info.bbox.min[0]}+${info.bbox.max[0]})/2, cy=(${info.bbox.min[1]}+${info.bbox.max[1]})/2, cz=(${info.bbox.min[2]}+${info.bbox.max[2]})/2; c.position.set(cx+0.9, cy+1.0, cz+2.2); c.lookAt(cx, cy, cz); c.updateMatrixWorld(true); return c.position.toArray(); })()`]
  ];
  for (const [name, expr] of shots) {
    console.log(name, JSON.stringify(await ev(expr)));
    await sleep(300);
    const s = await send('Page.captureScreenshot', { format: 'png' }, sid);
    fs.writeFileSync('/tmp/cdp-fight-' + name + '.png', Buffer.from(s.data, 'base64'));
  }
  process.exit(0);
};
