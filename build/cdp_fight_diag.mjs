/* quick diagnostics for fight page: bbox, camera dir, visibility */
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
    if (r.exceptionDetails) return { error: r.exceptionDetails.text };
    return r.result.value;
  };
  for (let i = 0; i < 200; i++) { await sleep(300); if (await ev(`!!(window.__fight && window.__fight.ready)`) === true) break; }
  console.log(JSON.stringify(await ev(`(() => {
    const THREE = window.__fight.model.constructor === Object ? null : null;
    const F = window.__fight;
    const m = F.model, cam = F.camera;
    // bbox via traversal of geometry bounding spheres is unreliable; use three from the page module scope? use manual points
    let min = [1e9,1e9,1e9], max = [-1e9,-1e9,-1e9];
    let meshes = 0, skinned = 0, transparent = 0;
    m.updateMatrixWorld(true);
    const v = { x:0,y:0,z:0 };
    m.traverse(o => {
      if (!o.isMesh) return;
      meshes++; if (o.isSkinnedMesh) skinned++;
      if (o.material && o.material.transparent) transparent++;
      const g = o.geometry;
      if (!g.boundingBox) g.computeBoundingBox();
      const bb = g.boundingBox;
      for (const sx of [bb.min.x, bb.max.x]) for (const sy of [bb.min.y, bb.max.y]) for (const sz of [bb.min.z, bb.max.z]) {
        const p = new o.position.constructor(sx, sy, sz).applyMatrix4(o.matrixWorld);
        if (p.x<min[0]) min[0]=p.x; if (p.y<min[1]) min[1]=p.y; if (p.z<min[2]) min[2]=p.z;
        if (p.x>max[0]) max[0]=p.x; if (p.y>max[1]) max[1]=p.y; if (p.z>max[2]) max[2]=p.z;
      }
    });
    const dir = new cam.position.constructor(0,0,-1).applyQuaternion(cam.quaternion);
    const kids = [];
    m.traverse(o => { if (o.isMesh) kids.push({ name: o.name, skinned: !!o.isSkinnedMesh, visible: o.visible,
      matType: o.material && o.material.type, transparent: !!(o.material && o.material.transparent),
      opacity: o.material && o.material.opacity, side: o.material && o.material.side }); });
    return { bbox: { min: min.map(n=>+n.toFixed(2)), max: max.map(n=>+n.toFixed(2)) }, meshes, skinned, transparent,
      cam: { pos: cam.position.toArray().map(n=>+n.toFixed(2)), dir: dir.toArray().map(n=>+n.toFixed(2)), fov: cam.fov, near: cam.near, far: cam.far },
      ancher: F.ancher1 ? F.ancher1.getWorldPosition(new cam.position.constructor()).toArray().map(n=>+n.toFixed(2)) : null,
      kids };
  })()`), null, 2));
  const shot = await send('Page.captureScreenshot', { format: 'png' }, sid);
  fs.writeFileSync('/tmp/cdp-fight-diag.png', Buffer.from(shot.data, 'base64'));  process.exit(0);
};
