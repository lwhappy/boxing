/* fight.html 验证脚本：
 * 1. 加载页面，等 __fight.ready
 * 2. 报告：角色、clips、按钮状态、站位 X、相机
 * 3. 对每条 attack-* clip 扫描出手最远点（手骨朝对手方向的最大位移）→ 建议命中帧
 * 4. 点击每个启用的按钮，出拳瞬间截图
 * 用法：CDP_PORT=9335 node build/cdp_fight_check.mjs [--click]
 */
import fs from 'node:fs';

const PORT = process.env.CDP_PORT || '9335';
const URL = process.env.FIGHT_URL || 'http://127.0.0.1:8127/web/fight.html';
const DO_CLICK = process.argv.includes('--click');
const FPS = 30;

const ver = await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json();
const ws = new WebSocket(ver.webSocketDebuggerUrl);
let idc = 0;
const pending = new Map();
const logs = [];
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
    return;
  }
  if (m.method === 'Runtime.consoleAPICalled' && ['error', 'warning', 'log'].includes(m.params.type)) {
    const txt = m.params.args.map((a) => a.value ?? a.description ?? '').join(' ');
    if (/WebGL|swiftshader/i.test(txt)) return;
    logs.push(`[${m.params.type}] ${txt}`.slice(0, 180));
  }
  if (m.method === 'Runtime.exceptionThrown') {
    logs.push('[exception] ' + JSON.stringify(m.params.exceptionDetails).slice(0, 240));
  }
};

ws.onopen = async () => {
  const { targetInfos } = await send('Target.getTargets');
  const t = targetInfos.find((x) => x.type === 'page');
  const sid = (await send('Target.attachToTarget', { targetId: t.targetId, flatten: true })).sessionId;
  await send('Runtime.enable', {}, sid);
  await send('Page.enable', {}, sid);
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false }, sid);

  await send('Page.navigate', { url: URL }, sid);

  /* 等 ready（最长 90s，GLB 6MB 本地很快） */
  let ready = false;
  for (let i = 0; i < 90; i++) {
    await new Promise((r) => setTimeout(r, 1000));
    const r = await send('Runtime.evaluate', { expression: `!!(window.__fight && window.__fight.ready)`, returnByValue: true }, sid);
    if (r.result.value) { ready = true; break; }
  }
  if (!ready) {
    console.log('NOT READY after 90s. console:');
    console.log([...new Set(logs)].join('\n') || '(none)');
    process.exit(1);
  }

  /* 状态报告 */
  const report = await send('Runtime.evaluate', { expression: `(() => {
    const F = window.__fight;
    const v = new (F.model.constructor ? Object.getPrototypeOf(F.model).constructor.prototype.worldMatrix !== undefined ? Object : Object : Object)();
    const wx = (o) => { o.updateWorldMatrix(true, false); return +o.matrixWorld.elements[12].toFixed(3); };
    const atk = F.chars.attack, def = F.chars.defence;
    const btns = [...document.querySelectorAll('.fight-btn')].map(b => ({ key: b.dataset.key, active: b.classList.contains('active'), disabled: b.disabled }));
    return JSON.stringify({
      clips: F.clips,
      attackClips: Object.keys(atk.actions),
      defenceClips: Object.keys(def.actions),
      atkX: wx(atk.root), defX: wx(def.root),
      cam: F.camera.position.toArray().map(n => +n.toFixed(2)),
      target: F.controls.target.toArray().map(n => +n.toFixed(2)),
      buttons: btns,
      ancher: !!F.ancher1
    });
  })()`, returnByValue: true }, sid);
  console.log('STATE:', report.result.value);

  /* 命中帧测量：对每条非 idle attack clip，步进 mixer，
   * 找手骨朝对手方向（attack→defence 的水平方向）的最大位移。 */
  const measure = await send('Runtime.evaluate', { expression: `(() => {
    const F = window.__fight;
    const atk = F.chars.attack, def = F.chars.defence;
    const hands = [];
    atk.root.traverse(o => { if (o.isBone && /Hand(_\d+)?$/.test(o.name) && !/Index|Thumb|Middle|Ring|Pinky|Tip/.test(o.name)) hands.push(o); });
    const from = new (atk.root.position.constructor)();
    from.setFromMatrixPosition(atk.root.matrixWorld);
    const to = new (atk.root.position.constructor)();
    to.setFromMatrixPosition(def.root.matrixWorld);
    const fwd = to.clone().sub(from); fwd.y = 0; fwd.normalize();
    const out = {};
    const tmp = new (atk.root.position.constructor)();
    for (const name of Object.keys(atk.actions)) {
      if (/idle/i.test(name)) continue;
      const action = atk.actions[name];
      const dur = action.getClip().duration;
      /* 基准：idle 姿态下手的位置 */
      atk.mixer.stopAllAction();
      const idleA = atk.actions[atk.idleClip];
      idleA.reset().play(); atk.mixer.setTime(0.1); atk.mixer.update(0);
      const base = hands.map(h => { h.updateWorldMatrix(true, false); return h.getWorldPosition(new (atk.root.position.constructor)()); });
      /* 扫描出拳 */
      atk.mixer.stopAllAction();
      action.reset(); action.play();
      let bestT = 0, bestD = -Infinity;
      const step = 1 / 60;
      for (let t = 0; t <= dur; t += step) {
        atk.mixer.setTime(t);
        for (let i = 0; i < hands.length; i++) {
          hands[i].updateWorldMatrix(true, false);
          hands[i].getWorldPosition(tmp);
          const d = tmp.clone().sub(base[i]).dot(fwd);
          if (d > bestD) { bestD = d; bestT = t; }
        }
      }
      out[name] = { hitTime: +bestT.toFixed(3), frame: Math.round(bestT * 30) + 1, ext: +bestD.toFixed(3) };
    }
    atk.mixer.stopAllAction();
    const idleA2 = atk.actions[atk.idleClip];
    idleA2.reset().play();
    return JSON.stringify(out);
  })()`, returnByValue: true }, sid);
  console.log('HIT-FRAMES:', measure.result.value);
  console.log('console:', [...new Set(logs)].slice(0, 12).join(' | ') || '(none)');

  /* 初始 idle 截图 */
  await new Promise((r) => setTimeout(r, 800));
  let shot = await send('Page.captureScreenshot', { format: 'png' }, sid);
  fs.writeFileSync('/tmp/fight-idle.png', Buffer.from(shot.data, 'base64'));

  /* 点击每个启用的按钮，出拳中段截图 */
  if (DO_CLICK) {
    const st = JSON.parse(report.result.value);
    for (const b of st.buttons.filter((b) => b.active)) {
      const expr = `(async () => {
        const btn = document.querySelector('.fight-btn[data-key="${b.key}"]');
        btn.click();
        await new Promise(r => setTimeout(r, 700));
        return document.querySelector('.fight-btn[data-key="${b.key}"]').disabled;
      })()`;
      const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }, sid);
      shot = await send('Page.captureScreenshot', { format: 'png' }, sid);
      fs.writeFileSync(`/tmp/fight-${b.key}.png`, Buffer.from(shot.data, 'base64'));
      console.log(`clicked ${b.key}: locked=${r.result.value}`);
      await new Promise((r2) => setTimeout(r2, 2600));   /* 等回到 idle */
    }
  }
  process.exit(0);
};
