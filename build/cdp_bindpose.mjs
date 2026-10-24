/**
 * Check the BIND (rest) pose of any page's GLB: is the character lying down
 * or standing when no animation is applied?
 *
 * usage: URL=... CDP_PORT=9222 node build/cdp_bindpose.mjs
 */
const PORT = process.env.CDP_PORT || '9222';
const URL_ = process.env.URL || 'http://127.0.0.1:8123/jab.html';

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
const errors = [];
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) {
    const { res, rej } = pending.get(m.id);
    pending.delete(m.id);
    m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result);
    return;
  }
  if (m.method === 'Runtime.exceptionThrown') {
    errors.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text);
  }
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

ws.onopen = async () => {
  const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
  const sid = (await send('Target.attachToTarget', { targetId, flatten: true })).sessionId;
  await send('Runtime.enable', {}, sid);
  await send('Page.enable', {}, sid);
  await send('Page.navigate', { url: URL_ }, sid);
  await sleep(11000);

  const r = await send('Runtime.evaluate', {
    returnByValue: true,
    awaitPromise: true,
    expression: `(() => {
      // find any THREE namespace or a live mixer
      const st = window.__comboStage || window.__stage || window.__homeStage;
      const out = { url: location.pathname, hasStage: !!st };
      if (!st) {
        // try to find bones in the scene graph via the renderer's scene
        out.note = 'no known stage handle';
        return JSON.stringify(out);
      }
      const model = st.model;
      const mixer = st.mixer;
      if (mixer) { mixer.stopAllAction(); }
      model.updateMatrixWorld(true);
      let hips=null,head=null,foot=null;
      model.traverse((o)=>{ if(o.isBone&&!hips&&/Hips$/.test(o.name))hips=o;
                              if(o.isBone&&!head&&/Head$/.test(o.name))head=o;
                              if(o.isBone&&!foot&&/Foot$/.test(o.name))foot=o; });
      const V=(b)=>b?b.getWorldPosition(new b.position.constructor()):null;
      const hp=V(head),sp=V(hips),fp=V(foot);
      let up=null; if(hp&&sp){const L=hp.distanceTo(sp); up=L>1e-6?(hp.y-sp.y)/L:null;}
      out.bindHeadY=hp?+hp.y.toFixed(3):null;
      out.bindHipsY=sp?+sp.y.toFixed(3):null;
      out.bindFootY=fp?+fp.y.toFixed(3):null;
      out.bindUp=up===null?null:+up.toFixed(3);
      out.modelY=+model.position.y.toFixed(4);
      return JSON.stringify(out);
    })()`,
  }, sid);

  console.log(URL_);
  console.log('  ', r.result ? r.result.value : JSON.stringify(r).slice(0, 600));
  if (errors.length) console.log('  ERRORS:', errors.slice(0, 3));
  await send('Target.closeTarget', { targetId });
  process.exit(0);
};
