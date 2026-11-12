import './styles/fight.css'
import { Audio } from './engine/audio'
import { GameLoop } from './engine/loop'
import { CONFIG } from './game/config'
import { FIGHTERS_MODEL } from './game/assetTable'
import type { Game } from './game/game'

const canvas = document.querySelector<HTMLCanvasElement>('#game')!
const stage = document.querySelector<HTMLElement>('#stage')!
const loader = document.querySelector<HTMLElement>('.loader')!
const bar = loader.querySelector<HTMLElement>('.bar')!
const fill = bar.querySelector<HTMLElement>('i')!
const status = loader.querySelector<HTMLElement>('.status')!
const retry = loader.querySelector<HTMLButtonElement>('.retry')!

const audio = new Audio()
const unlock = () => audio.unlock()
window.addEventListener('pointerdown', unlock, { capture: true })
window.addEventListener('keydown', unlock, { capture: true })

function progress(p: number, text?: string): void {
  fill.style.width = `${Math.round(Math.max(0, Math.min(1, p)) * 100)}%`
  if (text) status.textContent = text
}

/**
 * Boot: three.js and the game code load as a separate chunk while the 6 MB fighter model streams
 * with byte progress. Any failure shows a Retry button that restarts the whole load.
 */
async function boot(): Promise<void> {
  retry.hidden = true
  bar.classList.remove('is-indeterminate')
  progress(0.04, 'Loading fighters')
  const [{ Game }, { Renderer, suggestQuality }, { Assets }, { FightSfx }] = await Promise.all([
    import('./game/game'), import('./engine/renderer'), import('./engine/assets'), import('./game/sfx'),
  ])
  const assets = new Assets()
  const onBytes = (p: number) => progress(0.08 + p * 0.82)
  let gltf
  try {
    gltf = await assets.gltf(FIGHTERS_MODEL.url, onBytes)
  } catch (err) {
    // The dev server may not reach Storage; fall back to the editable local copy there only.
    if (!import.meta.env.DEV) throw err
    gltf = await assets.gltf(FIGHTERS_MODEL.local, onBytes)
  }
  progress(0.93, 'Warming up')
  await new Promise(r => requestAnimationFrame(r))

  const renderer = new Renderer(canvas, suggestQuality())
  const sfx = new FightSfx(audio.ctx, audio.sfx)
  const game: Game = new Game(renderer, gltf, sfx, stage)
  // Compile shaders before revealing the stage so the first punches do not hitch.
  renderer.gl.compile(game.scene, game.cam.camera)

  const { Controls } = await import('./ui/controls')
  const controls = new Controls(document.querySelector<HTMLElement>('#controls')!, {
    action: id => game.doAction(id),
    step: dir => game.stepBlack(dir),
    toggle: (name, on) => {
      if (name === 'robot') game.brain.enabled = on
      if (name === 'anchors') game.overlay.group.visible = on
      if (name === 'reach') game.setAutoReach(on)
    },
    transform: (side, patch) => game.setTransform(side, patch),
    reset: () => game.resetTransforms(),
    read: side => game[side].transform,
    press: unlock,
  })
  game.onAction = (side, def) => {
    if (side === 'black') controls.setActive(def)
  }

  if (import.meta.env.DEV) {
    const [{ registerGameTuning }, { tuning }] = await Promise.all([
      import('../scripts/manus-tuning/adapter.js'), import('./game/tuning'),
    ])
    await registerGameTuning(tuning)
  }

  let volume = -1
  let syncTimer = 0
  const loop = new GameLoop({
    step: dt => game.step(dt),
    render: (_alpha, frameSeconds) => {
      if (volume !== CONFIG.fx.volume) {
        volume = CONFIG.fx.volume
        audio.setVolume(volume)
      }
      syncTimer += frameSeconds
      if (syncTimer > 0.2) {
        syncTimer = 0
        controls.sync()
      }
      game.render(frameSeconds)
    },
  })
  loop.start()
  document.addEventListener('visibilitychange', () => {
    loop.paused = document.hidden
    if (!document.hidden) loop.resetAccumulator()
  })

  progress(1, 'Ready')
  loader.classList.add('is-done')
  window.setTimeout(() => { loader.hidden = true }, 500)
  // Debug/test hook (read-only use): smoke tests inspect fight state through it.
  ;(window as unknown as { __game: unknown }).__game = { game, ready: true }
}

function start(): void {
  boot().catch(err => {
    console.error(err)
    loader.hidden = false
    loader.classList.remove('is-done')
    status.textContent = 'Could not load the fighters. Check your connection.'
    retry.hidden = false
  })
}
retry.addEventListener('click', () => location.reload())
start()
