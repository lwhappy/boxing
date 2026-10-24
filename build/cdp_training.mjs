/* CDP 测试：训练页交互（真实时间，不依赖虚拟时间）
 * 用法：
 *   1) 先起静态服务：cd web && python3 -m http.server 8938
 *   2) 起 Chrome：--headless=new --remote-debugging-port=9333 --use-gl=angle --use-angle=swiftshader ...
 *   3) node build/cdp_training.mjs http://127.0.0.1:8938/training.html [clipName]
 *      clipName 可选，默认 jab：jab / cross / lead-hand-hook / back-hand-hook /
 *      lead-hand-uppercut / back-hand-uppercut
 * 验证：命中帧拳套与锚点距离、进攻方位移、命中火花、序列播完回位、控制台异常。
 */
import fs from 'node:fs';

const URL = process.argv[2] || 'http://127.0.0.1:8938/training.html';
const PORT = process.env.CDP_PORT || '9333';
const MOVE = process.argv[3] || 'jab';
const FIST_OF = {
  'jab': 'LeftHand', 'cross': 'RightHand',
  'lead-hand-hook': 'LeftHand', 'back-hand-hook': 'RightHand',
  'lead-hand-uppercut': 'LeftHand', 'back-hand-uppercut': 'RightHand'
};
const SHOT = process.env.SHOT || `/tmp/cdp-training-${MOVE}.png`;

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
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) {
    const { res, rej } = pending.get(m.id); pending.delete(m.id);
    m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result); return;
  }
  if (m.method === 'Runtime.exceptionThrown') logs.push('[exception] ' + JSON.stringify(m.params.exceptionDetails).slice(0, 500));
  if (m.method === 'Runtime.consoleAPICalled' && ['error', 'warning'].includes(m.params.type)) {
    logs.push(`[${m.params.type}] ` + m.params.args.map(a => a.value ?? a.description ?? '').join(' ').slice(0, 300));
  }
};

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

ws.onopen = async () => {
  const { targetInfos } = await send('Target.getTargets');
  const t = targetInfos.find(x => x.type === 'page');
  const sid = (await send('Target.attachToTarget', { targetId: t.targetId, flatten: true })).sessionId;
  await send('Runtime.enable', {}, sid);
  await send('Page.enable', {}, sid);

  const ev = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }, sid);
    if (r.exceptionDetails) return { error: r.exceptionDetails.text + ' ' + (r.exceptionDetails.exception?.description || '') };
    return r.result.value;
  };

  await send('Page.navigate', { url: URL }, sid);

  // 等模型就绪（真实时间轮询，最多 60s）
  let ready = false;
  for (let i = 0; i < 200; i++) {
    await sleep(300);
    const ok = await ev(`!!(window.__training && window.__training.getCurrent)`);
    if (ok === true) { ready = true; break; }
  }
  console.log('ready =', ready);
  if (!ready) {
    console.log('LOGS:\n' + [...new Set(logs)].join('\n'));
    process.exit(1);
  }

  console.log('impactData =', JSON.stringify(await ev(`window.__training.impactData`)));
  console.log('anchors =', await ev(`window.__training.anchors.length`));
  console.log('basePos =', JSON.stringify(await ev(`window.__training.getBase().toArray().map(n=>+n.toFixed(3))`)));
  console.log('anchorWorld =', JSON.stringify(await ev(`[0,1].map(i=>window.__training.getAnchorPos(i).toArray().map(n=>+n.toFixed(3)))`)));

  // 勾选待测招式，点确认
  await ev(`[...document.querySelectorAll('.combo-btn[data-move]')].filter(b=>b.dataset.move==='${MOVE}').forEach(b=>b.click()); true`);
  await ev(`document.getElementById('combo-confirm').click(); true`);

  // 等第一个动作命中
  let hit = null;
  for (let i = 0; i < 120; i++) {
    await sleep(100);
    const r = await ev(`(() => {
      const T = window.__training, c = T.getCurrent();
      if (!c || !c.fired) return null;
      const which = '${FIST_OF[MOVE]}';
      const f = T.getFistPos(which).toArray().map(n=>+n.toFixed(3));
      const a = T.getAnchorPos(c.data.anchor).toArray().map(n=>+n.toFixed(3));
      return { name: c.name, actT: +c.act.time.toFixed(3), impactT: +c.data.impactT.toFixed(3),
               anchorIdx: c.data.anchor, fist: f, anchor: a,
               dist: +Math.hypot(f[0]-a[0], f[1]-a[1], f[2]-a[2]).toFixed(4),
               pos: T.attackerRoot.position.toArray().map(n=>+n.toFixed(3)),
               effects: T.effects.length,
               hint: document.getElementById('combo-hint').textContent };
    })()`);
    if (r) { hit = r; break; }
  }
  console.log('firstHit =', JSON.stringify(hit));

  // 先截图（越靠近命中帧越好，火花只活 0.36s），再读埋点
  const shot = await send('Page.captureScreenshot', { format: 'png' }, sid);
  fs.writeFileSync(SHOT, Buffer.from(shot.data, 'base64'));
  console.log('screenshot =', SHOT);


  await ev(`(() => {
    const T = window.__training;
    T.mixer.timeScale = 0;
    const c = T.camera;
    const p = c.position.clone();
    const t = T.controls.target.clone();
    c.position.copy(t).add(p.sub(t).multiplyScalar(1.45));
    c.updateMatrixWorld(true);
    T.renderOnce && T.renderOnce();
    return true;
  })()`);
  await sleep(400);
  const wide = await send('Page.captureScreenshot', { format: 'png' }, sid);
  fs.writeFileSync(`/tmp/cdp-training-${MOVE}-wide.png`, Buffer.from(wide.data, 'base64'));
  await ev(`window.__training.mixer.timeScale = 1; true`);
  console.log('lastStep =', JSON.stringify(await ev(`window.__lastStep`)));
  console.log('lastHit  =', JSON.stringify(await ev(`window.__lastHit`)));
  console.log('step     =', JSON.stringify(await ev(`window.__lastStep`)));
  console.log('crouchState =', await ev(`JSON.stringify({ target: +window.__training.crouch.target.toFixed(3), amount: +window.__training.crouch.amount.toFixed(3), max: window.__training.crouch.max })`));

  // 等序列播完（jab + cross 两条），确认回位与 UI 解锁
  await sleep(6500);
  console.log('endState =', JSON.stringify(await ev(`(() => {
    const T = window.__training;
    return { pos: T.attackerRoot.position.toArray().map(n=>+n.toFixed(3)),
             locked: document.getElementById('combo-bar').classList.contains('locked'),
             hint: document.getElementById('combo-hint').textContent,
             current: !!T.getCurrent() };
  })()`)));

  console.log('LOGS:\n' + ([...new Set(logs)].join('\n') || '(none)'));

  // 单独验证火花渲染（头部锚点，避开红色拳套/红衣）
  await ev(`window.__training.spawnHit(window.__training.getAnchorPos(0)); true`);
  await sleep(60);
  const s2 = await send('Page.captureScreenshot', { format: 'png' }, sid);
  fs.writeFileSync(SHOT.replace('.png', '-spark.png'), Buffer.from(s2.data, 'base64'));
  await sleep(700);
  const s3 = await send('Page.captureScreenshot', { format: 'png' }, sid);
  fs.writeFileSync(SHOT.replace('.png', '-spark-after.png'), Buffer.from(s3.data, 'base64'));
  console.log('spark shots written');

  process.exit(0);
};
