// End-to-end smoke test: builds must already exist in dist/ (`npm run build`).
// Serves dist/, boots the duel in headless Chromium (the fighter model is served from the local
// source copy because vite preview has no Storage), presses every action button, checks that
// fists land on anchors, fails on any console error, and writes screenshots to ./shots/.
import { spawn } from 'node:child_process'
import { mkdirSync, readFileSync } from 'node:fs'
import { chromium } from 'playwright'

const port = 4300 + Math.floor(Math.random() * 500)
const url = `http://127.0.0.1:${port}/`
const out = process.env.SHOTS_DIR ?? 'shots'
mkdirSync(out, { recursive: true })

const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--port', String(port), '--strictPort', '--host', '127.0.0.1'], { stdio: 'ignore', detached: false })
let browser
const guard = setTimeout(() => fail('timed out'), 120_000)

function cleanup() {
  clearTimeout(guard)
  try { server.kill('SIGTERM') } catch {}
}
async function fail(msg) {
  console.error(`smoke: FAIL — ${msg}`)
  await browser?.close().catch(() => {})
  cleanup()
  process.exit(1)
}

async function waitForServer() {
  for (let i = 0; i < 60; i += 1) {
    try {
      if ((await fetch(url)).ok) return
    } catch {}
    await new Promise(r => setTimeout(r, 250))
  }
  throw new Error('preview server did not start')
}

async function openGame(context, errors) {
  const page = await context.newPage()
  page.on('console', m => m.type() === 'error' && errors.push(m.text()))
  page.on('pageerror', e => errors.push(String(e)))
  page.on('response', r => r.status() >= 400 && errors.push(`HTTP ${r.status()} ${r.url()}`))
  const model = readFileSync('public/models/fighters.glb')
  await page.route('**/manus-storage/**', route => route.fulfill({ status: 200, contentType: 'model/gltf-binary', body: model }))
  await page.goto(url)
  await page.waitForFunction(() => window.__game?.ready, null, { timeout: 90_000 })
  await page.waitForTimeout(800)
  return page
}
try {
  await waitForServer()
  const args = ['--ignore-gpu-blocklist', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader']
  browser = await chromium.launch({ args }).catch(() => chromium.launch({ args, channel: 'chrome' }))
  const errors = []
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 760 } })
  const page = await openGame(ctx, errors)
  await page.screenshot({ path: `${out}/01-stage.png` })
  // Page shows only the stage and the control deck.
  const visible = await page.evaluate(() => [...document.body.querySelectorAll('#app > *')].filter(e => e.getBoundingClientRect().height > 0).map(e => e.id))
  if (visible.join(',') !== 'stage,controls') await fail(`unexpected page sections: ${visible}`)
  const buttons = await page.locator('[data-action]').count()
  if (buttons !== 9) await fail(`expected 9 action buttons, got ${buttons}`)
  await page.evaluate(() => { window.__game.game.brain.enabled = false })
  for (const id of ['jab', 'cross', 'leadHook', 'rearUpper']) {
    await page.click(`[data-action="${id}"]`)
    await page.waitForFunction(() => window.__game.game.black.state === 'acting', null, { timeout: 5000 })
    await page.waitForFunction(() => window.__game.game.black.state === 'idle', null, { timeout: 8000 })
  }
  const hits = await page.evaluate(() => window.__game.game.hits.filter(h => h.attacker === 'black').length)
  if (hits < 3) await fail(`player punches landed only ${hits} times`)
  await page.evaluate(() => { window.__game.game.brain.enabled = true })
  await page.waitForFunction(() => window.__game.game.hits.some(h => h.attacker === 'red'), null, { timeout: 25_000 })
  await page.screenshot({ path: `${out}/02-robot.png` })
  await page.click('[data-toggle="adjust"]')
  await page.locator('input[data-side="black"][data-key="scale"]').fill('1.2')
  const scale = await page.evaluate(() => window.__game.game.black.root.scale.x)
  if (Math.abs(scale - 1.2) > 1e-6) await fail(`adjust panel did not scale the fighter (${scale})`)
  await page.click('[data-reset]')
  await page.screenshot({ path: `${out}/03-adjust.png` })
  await page.setViewportSize({ width: 390, height: 844 })
  await page.waitForTimeout(600)
  await page.screenshot({ path: `${out}/04-phone.png` })
  if (errors.length) await fail(`console errors:\n${errors.join('\n')}`)
  console.log(`smoke: OK — ${hits} player hits, robot landed, adjust works`)
  await browser.close()
  cleanup()
  process.exit(0)
} catch (err) {
  await fail(err?.stack ?? String(err))
}
