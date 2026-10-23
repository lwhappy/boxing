import fs from 'node:fs';

const PORT = process.env.CDP_PORT || '9333';
const URLs = (process.argv.slice(2).length ? process.argv.slice(2) : [
  'http://127.0.0.1:8123/web/jab.html',
  'http://127.0.0.1:8123/web/jab-cross.html',
  'http://127.0.0.1:8123/web/index.html'
]);
const WAIT = Number(process.env.WAIT_MS || 15000);

const ver = await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json();
const ws = new WebSocket(ver.webSocketDebuggerUrl);
let idc = 0; const pending = new Map();
const send = (method, params = {}, sessionId) => { const id = ++idc; const msg = { id, method, params }; if (sessionId) msg.sessionId = sessionId; ws.send(JSON.stringify(msg)); return new Promise((res, rej) => pending.set(id, { res, rej })); };
const logs = [];

ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) { const { res, rej } = pending.get(m.id); pending.delete(m.id); m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result); return; }
  if (m.method === 'Runtime.exceptionThrown') logs.push('[exception] ' + JSON.stringify(m.params.exceptionDetails).slice(0, 400));
  if (m.method === 'Runtime.consoleAPICalled' && ['error', 'warning'].includes(m.params.type)) logs.push(`[${m.params.type}] ` + m.params.args.map(a => a.value ?? a.description ?? '').join(' ').slice(0, 300));
  if (m.method === 'Log.entryAdded') logs.push(`[${m.params.entry.level}] ${m.params.entry.text}`.slice(0, 300));
};

ws.onopen = async () => {
  const { targetInfos } = await send('Target.getTargets');
  const t = targetInfos.find(x => x.type === 'page');
  const sid = (await send('Target.attachToTarget', { targetId: t.targetId, flatten: true })).sessionId;
  await send('Runtime.enable', {}, sid); await send('Page.enable', {}, sid); await send('Log.enable', {}, sid);

  for (const u of URLs) {
    logs.length = 0;
    await send('Page.navigate', { url: u }, sid);
    await new Promise(r => setTimeout(r, WAIT));
    const expr = `(() => {
      const hits = [];
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      let n;
      while ((n = walker.nextNode())) {
        const v = n.nodeValue || '';
        let i = v.indexOf('undefined');
        while (i !== -1) {
          hits.push(JSON.stringify({ text: v.trim().slice(0, 120), tag: n.parentElement ? n.parentElement.tagName + '.' + (n.parentElement.className || '') : '?', html: n.parentElement ? n.parentElement.outerHTML.slice(0, 160) : '' }));
          i = v.indexOf('undefined', i + 1);
        }
      }
      const btns = [...document.querySelectorAll('#attackbar button')].map(b => b.innerText.replace(/\\s+/g, ' | '));
      const brief = document.getElementById('brief') ? document.getElementById('brief').innerText.replace(/\\s+/g, ' ').slice(0, 300) : '(no brief)';
      return JSON.stringify({ url: location.pathname, undefinedCount: hits.length, hits, attackbar: btns, brief: brief.slice(0, 300) });
    })()`;
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true }, sid);
    console.log('======== ' + u);
    console.log(r.result.value);
    if (logs.length) console.log('CONSOLE:\n' + [...new Set(logs)].join('\n'));
  }
  process.exit(0);
};
