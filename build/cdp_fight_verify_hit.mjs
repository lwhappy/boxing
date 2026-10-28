/* fight.html 专项验证：
 * 1. Next 按钮已移除（DOM 无 #fight-next）
 * 2. ancher1 作为命中锚点（名称 + 世界坐标 + 与头骨距离）
 * 3. 点击出拳 → 命中瞬间 defender 切到 defence-hit，结束后回 defence-idle
 * 用法：先起 headless chrome（CDP 端口 9335），再 node build/cdp_fight_verify_hit.mjs
 */
const PORT = process.env.CDP_PORT || '9335';
const URL = process.env.FIGHT_URL || 'http://127.0.0.1:8127/web/fight.html';
import fs from 'node:fs';

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
  const { targetInfos } = await send('Target.getTargets');
  const t = targetInfos.find((x) => x.type === 'page');
  const sid = (await send('Target.attachToTarget', { targetId: t.targetId, flatten: true })).sessionId;
  await send('Runtime.enable', {}, sid);
  await send('Page.enable', {}, sid);
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false }, sid);
  await send('Page.navigate', { url: URL }, sid);

  let ready = false;
  for (let i = 0; i < 90; i++) {
    await sleep(1000);
    const r = await send('Runtime.evaluate', { expression: '!!(window.__fight && window.__fight.ready)', returnByValue: true }, sid);
    if (r.result.value) { ready = true; break; }
  }
  if (!ready) { console.log('NOT READY'); process.exit(1); }

  /* 1 + 2: Next 按钮 & 锚点状态 */
  const st = await send('Runtime.evaluate', { expression: `(() => {
    const F = window.__fight;
    const pos = (o) => { o.updateWorldMatrix(true, false); return o.matrixWorld.elements.slice(12, 15).map(n => +n.toFixed(3)); };
    let head = null;
    F.chars.defence.root.traverse(o => { if (!head && o.isBone && /mixamorigHead(_\\d+)?$/.test(o.name)) head = o; });
    return JSON.stringify({
      nextBtnInDom: !!document.getElementById('fight-next'),
      ancherName: F.ancher1 && F.ancher1.name,
      ancherIsBone: !!(F.ancher1 && F.ancher1.isBone),
      ancherPos: F.ancher1 ? pos(F.ancher1) : null,
      headPos: head ? pos(head) : null,
      defenceClips: Object.keys(F.chars.defence.actions)
    });
  })()`, returnByValue: true }, sid);
  console.log('STATE:', st.result.value);

  /* 3: 点击 jab，追踪 defence.current */
  async function testPunch(key) {
    await send('Runtime.evaluate', { expression: `window.__fight.playPunch('${key}')` }, sid);
    const seq = [];
    let shotAt = -1;
    for (let i = 0; i < 80; i++) {          /* 最多 8s */
      await sleep(100);
      const r = await send('Runtime.evaluate', {
        expression: `(() => { const d = window.__fight.chars.defence; return JSON.stringify({ cur: d.current, fx: window.__fight.effects(), phase: window.__fight.phase() }); })()`,
        returnByValue: true }, sid);
      const s = JSON.parse(r.result.value);
      if (!seq.length || seq[seq.length - 1].cur !== s.cur || seq[seq.length - 1].fx !== s.fx) {
        seq.push(s);
        if (s.cur === 'defence-hit' && shotAt < 0) {
          shotAt = seq.length;
          const shot = await send('Page.captureScreenshot', { format: 'png' }, sid);
          fs.writeFileSync(`/tmp/fight_hit_${key}.png`, Buffer.from(shot.data, 'base64'));
        }
      }
      if (s.cur === 'defence-idle' && seq.length > 1) break;
    }
    console.log(`PUNCH ${key}:`, JSON.stringify(seq));
  }
  await testPunch('jab');
  await sleep(1200);
  await testPunch('cross');
  process.exit(0);
};
