import './styles/fight.css'
import * as THREE from 'three'
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
const startScreen = document.querySelector<HTMLElement>('#start')!
const startBtn = document.querySelector<HTMLButtonElement>('#startBtn')!

/** The match only begins once the player leaves the rules modal. */
let running = false

const audio = new Audio()
const unlock = () => audio.unlock()
window.addEventListener('pointerdown', unlock, { capture: true })
window.addEventListener('keydown', unlock, { capture: true })

function progress(p: number, text?: string): void {
  const pct = Math.round(Math.max(0, Math.min(1, p)) * 100)
  fill.style.width = `${pct}%`
  if (text) status.textContent = text
  if (!running && startBtn.disabled) startBtn.textContent = `Loading fighters… ${pct}%`
}

/** Health bars + result overlay, built once and updated from game callbacks. */
function buildHud(): {
  set(hp: Record<'black' | 'red', number>): void
  end(winner: 'black' | 'red'): void
  reset(): void
} {
  const hud = document.createElement('div')
  hud.className = 'hud'
  hud.innerHTML = `
    <div class="hud-side you">
      <span class="hud-name">YOU</span>
      <div class="hud-track"><i></i></div>
      <span class="hud-score">100</span>
    </div>
    <div class="hud-vs">VS</div>
    <div class="hud-side robot">
      <span class="hud-name">ROBOT</span>
      <div class="hud-track"><i></i></div>
      <span class="hud-score">100</span>
    </div>`
  stage.appendChild(hud)

  const result = document.createElement('div')
  result.className = 'result'
  result.hidden = true
  result.innerHTML = `
    <div class="result-card">
      <div class="result-word"></div>
      <div class="result-sub"></div>
      <button type="button" class="slab tool rematch"><span class="label">Rematch</span></button>
    </div>`
  stage.appendChild(result)

  const tracks = {
    black: hud.querySelector<HTMLElement>('.you .hud-track i')!,
    red: hud.querySelector<HTMLElement>('.robot .hud-track i')!,
  }
  const scores = {
    black: hud.querySelector<HTMLElement>('.you .hud-score')!,
    red: hud.querySelector<HTMLElement>('.robot .hud-score')!,
  }
  const word = result.querySelector<HTMLElement>('.result-word')!
  const sub = result.querySelector<HTMLElement>('.result-sub')!

  return {
    set(hp) {
      for (const side of ['black', 'red'] as const) {
        tracks[side].style.width = `${(hp[side] / 100) * 100}%`
        scores[side].textContent = String(hp[side])
        tracks[side].classList.toggle('low', hp[side] <= 30)
      }
    },
    end(winner) {
      const win = winner === 'black'
      word.textContent = win ? 'YOU WIN' : 'YOU LOSE'
      word.classList.toggle('lose', !win)
      sub.textContent = win ? 'The robot is down for the count.' : 'Knocked down. Train and come back.'
      result.hidden = false
    },
    reset() {
      result.hidden = true
    },
  }
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
  progress(0.96, 'Loading end poses')
  const [{ loadEndClips }, { clone: cloneSkeleton }] = await Promise.all([
    import('./game/endclips'),
    import('three/examples/jsm/utils/SkeletonUtils.js'),
  ])
  // Reference clip gives the FBX position-unit scale; the rigs' bones are already canonically named.
  const refTrack = gltf.animations.flatMap(a => a.tracks).find(t => t.name.endsWith('Hips.position'))!
  const refClip = new THREE.AnimationClip('ref', -1, [refTrack])
  // Detached clone of a fighter rig: retarget probe with canonical bone names and no animated state.
  const probe = cloneSkeleton(game.black.model)
  const endClips = await loadEndClips(
    `${import.meta.env.BASE_URL}models/action-Victory.fbx`,
    `${import.meta.env.BASE_URL}models/action-Defeat.fbx`,
    new Set(game.black.bones.keys()),
    probe,
    refClip,
  )
  game.setEndClips(endClips)
  // Compile shaders before revealing the stage so the first punches do not hitch.
  renderer.gl.compile(game.scene, game.cam.camera)

  const { Controls } = await import('./ui/controls')
  const controls = new Controls(document.querySelector<HTMLElement>('#controls')!, {
    action: id => game.doAction(id),
    step: dir => game.stepBlack(dir),
    strafe: dir => game.strafeBlack(dir),
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

  const hud = buildHud()
  hud.set(game.hp)
  game.onHp = hp => hud.set(hp)
  game.onMatchEnd = winner => hud.end(winner)
  resultRematch(game, hud)

  if (import.meta.env.DEV) {
    const [{ registerGameTuning }, { tuning }] = await Promise.all([
      import('../scripts/manus-tuning/adapter.js'), import('./game/tuning'),
    ])
    await registerGameTuning(tuning)
  }

  let volume = -1
  let syncTimer = 0
  const loop = new GameLoop({
    // Fight logic stays frozen behind the rules modal; only the scene keeps rendering.
    step: dt => { if (running) game.step(dt) },
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
  startBtn.disabled = false
  startBtn.textContent = 'Start the fight'
  // Debug/test hook (read-only use): smoke tests inspect fight state through it.
  ;(window as unknown as { __game: unknown }).__game = { game, ready: true, start: startMatch }
}

/** Leave the rules modal and let the fight begin. */
function startMatch(): void {
  if (running) return
  running = true
  startScreen.classList.remove('on')
  audio.unlock()
}
startBtn.addEventListener('click', startMatch)

function resultRematch(game: Game, hud: ReturnType<typeof buildHud>): void {
  stage.querySelector('.rematch')!.addEventListener('click', () => {
    hud.reset()
    game.rematch()
  })
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
