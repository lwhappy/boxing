// Usage: URL=... SHOT=/tmp/x.png WAIT=15000 W=1280 H=800 EXTRA=/tmp/extra.js AFTER=800 node cdp_fight1.mjs
// CDP screenshot + optional injected JS for the fight1 dev page.
import fs from 'node:fs'

const url = process.env.URL || 'http://127.0.0.1:3011/'
const shot = process.env.SHOT || '/tmp/shot.png'
const wait = Number(process.env.WAIT || 15000)
const w = Number(process.env.W || 1280)
const h = Number(process.env.H || 800)
const extra = process.env.EXTRA
const keys = process.env.KEYS // e.g. "KeyW" or "KeyU*2"

const targets = await (await fetch('http://127.0.0.1:9222/json')).json()
const page = targets.find(t => t.type === 'page') ?? targets[0]
const ws = new WebSocket(page.webSocketDebuggerUrl)
await new Promise(res => (ws.onopen = res))

let id = 0
const pending = new Map()
const logs = []
ws.onmessage = ev => {
  const msg = JSON.parse(ev.data)
  if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); return }
  if (msg.method === 'Runtime.exceptionThrown') logs.push('EXC: ' + JSON.stringify(msg.params.exceptionDetails).slice(0, 700))
  if (msg.method === 'Runtime.consoleAPICalled' && ['error', 'warning'].includes(msg.params.type))
    logs.push(msg.params.type + ': ' + JSON.stringify(msg.params.args).slice(0, 500))
  if (msg.method === 'Log.entryAdded') logs.push('log: ' + JSON.stringify(msg.params.entry).slice(0, 500))
}
const send = (method, params = {}) => new Promise(res => {
  const mid = ++id
  pending.set(mid, res)
  ws.send(JSON.stringify({ id: mid, method, params }))
})
const evalJs = async expression => {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
  if (r.result?.exceptionDetails) return { error: r.result.exceptionDetails.exception?.description || 'exception' }
  return r.result?.result?.value
}

await send('Page.enable')
await send('Runtime.enable')
const mobile = process.env.MOBILE === '1'
await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile })
if (mobile) {
  await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 })
  await send('Emulation.setEmitTouchesOnMouseEvents', { enabled: true })
}
await send('Page.navigate', { url })
await new Promise(res => setTimeout(res, wait))

if (extra) {
  const code = fs.readFileSync(extra, 'utf8')
  const value = await evalJs(code)
  console.log('--- extra ---')
  console.log(typeof value === 'string' ? value : JSON.stringify(value))
}
if (keys) {
  for (const part of keys.split(',')) {
    const [code, times] = part.split('*')
    for (let i = 0; i < Number(times || 1); i++) {
      await send('Input.dispatchKeyEvent', { type: 'keyDown', code, windowsVirtualKeyCode: 0 })
      await send('Input.dispatchKeyEvent', { type: 'keyUp', code })
      await new Promise(res => setTimeout(res, 300))
    }
    await new Promise(res => setTimeout(res, 500))
  }
}
const after = Number(process.env.AFTER || 800)
if (after > 0) await new Promise(res => setTimeout(res, after))

const cdp = await send('Page.captureScreenshot', { format: 'png' })
if (!cdp.result) { console.error('screenshot failed:', JSON.stringify(cdp)); process.exit(1) }
fs.writeFileSync(shot, Buffer.from(cdp.result.data, 'base64'))
const errors = await evalJs('window.__errors ? JSON.stringify(window.__errors) : "[]"')
console.log('--- errors ---', errors)
console.log('--- console ---')
for (const l of logs) console.log(l)
console.log('screenshot:', shot)
ws.close()
process.exit(0)
