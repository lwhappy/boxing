import { MENU_ACTIONS, ATTACKS, type ActionDef } from '../game/actions'
import type { FighterTransform, Side } from '../game/config'

export type ControlHooks = {
  action(id: string): void
  step(dir: 1 | -1): void
  strafe(dir: 1 | -1): void
  toggle(name: 'robot' | 'anchors' | 'reach', on: boolean): void
  transform(side: Side, patch: Partial<FighterTransform>): void
  reset(): void
  read(side: Side): FighterTransform
  /** Any press (unlocks audio). */
  press(): void
}

type Slider = { side: Side; key: keyof FighterTransform; label: string; min: number; max: number; step: number; unit: string }

const SLIDERS: Omit<Slider, 'side'>[] = [
  { key: 'x', label: 'Position', min: -2.4, max: 2.4, step: 0.01, unit: 'm' },
  { key: 'z', label: 'Side', min: -1.5, max: 1.5, step: 0.01, unit: 'm' },
  { key: 'yaw', label: 'Rotation', min: -60, max: 60, step: 1, unit: '°' },
  { key: 'scale', label: 'Scale', min: 0.7, max: 1.4, step: 0.01, unit: '×' },
]

const esc = (s: string) => s.replace(/[&<>"]/g, c => `&#${c.charCodeAt(0)};`)

type MoveKind = 'in' | 'out' | 'left' | 'right'
const MOVE_HOOKS: Record<MoveKind, (h: ControlHooks) => void> = {
  in: h => h.step(1),
  out: h => h.step(-1),
  left: h => h.strafe(-1),
  right: h => h.strafe(1),
}

/** Buttons below the stage (desktop) plus left/right thumb pads (touch). */
export class Controls {
  private readonly buttons = new Map<string, HTMLButtonElement>()
  private readonly inputs: { s: Slider; input: HTMLInputElement; out: HTMLOutputElement }[] = []
  private readonly adjust: HTMLElement
  private active = 'idle'
  private stance = 'idle'

  constructor(private readonly root: HTMLElement, private readonly hooks: ControlHooks) {
    root.innerHTML = `
      <div class="deck-row moves" role="group" aria-label="Black fighter actions">
        ${MENU_ACTIONS.map(a => `<button type="button" class="slab kind-${a.kind}" data-action="${a.id}" aria-keyshortcuts="${a.keyLabel}">
          <span class="key">${esc(a.keyLabel)}</span><span class="label">${esc(a.label)}</span></button>`).join('')}
      </div>
      <div class="deck-row tools" role="group" aria-label="Setup">
        <button type="button" class="slab toggle is-on" data-toggle="robot" aria-pressed="true"><span class="label">Robot</span></button>
        <button type="button" class="slab toggle is-on" data-toggle="reach" aria-pressed="true"><span class="label">Auto Reach</span></button>
        <button type="button" class="slab toggle is-on" data-toggle="anchors" aria-pressed="true"><span class="label">Anchors</span></button>
        <button type="button" class="slab toggle" data-toggle="adjust" aria-pressed="false" aria-controls="adjust-panel"><span class="label">Adjust</span></button>
      </div>
      <div class="adjust" id="adjust-panel" hidden>
        ${(['black', 'red'] as const).map(side => `
          <fieldset class="adjust-side side-${side}">
            <legend>${side === 'black' ? 'Black' : 'Red'}</legend>
            ${SLIDERS.map(s => `<label class="adj">
              <span>${s.label}</span>
              <input type="range" data-side="${side}" data-key="${s.key}" min="${s.min}" max="${s.max}" step="${s.step}" />
              <output></output>
            </label>`).join('')}
          </fieldset>`).join('')}
        <button type="button" class="slab tool reset" data-reset><span class="label">Reset</span></button>
      </div>
      <div class="pads" aria-label="Touch controls">
        <div class="pad pad-left" role="group" aria-label="Footwork">
          <button type="button" class="pad-btn" data-move="left" aria-label="Move left"><span>◀</span><small>A</small></button>
          <button type="button" class="pad-btn" data-move="out" aria-label="Step back"><span>▼</span><small>S</small></button>
          <button type="button" class="pad-btn" data-move="in" aria-label="Step in"><span>▲</span><small>W</small></button>
          <button type="button" class="pad-btn" data-move="right" aria-label="Move right"><span>▶</span><small>D</small></button>
        </div>
        <div class="pad pad-right" role="group" aria-label="Punches">
          <button type="button" class="pad-btn kind-stance" data-action="guard"><span>GUARD</span><small>E</small></button>
          ${ATTACKS.map(a => `<button type="button" class="pad-btn kind-attack" data-action="${a.id}"><span>${esc(a.label)}</span><small>${esc(a.keyLabel)}</small></button>`).join('')}
        </div>
      </div>`
    this.adjust = root.querySelector('.adjust')!

    for (const b of root.querySelectorAll<HTMLButtonElement>('[data-action]')) {
      this.buttons.set(b.dataset.action!, b)
      b.addEventListener('click', () => {
        hooks.press()
        hooks.action(b.dataset.action!)
        this.pulse(b)
      })
    }
    for (const b of root.querySelectorAll<HTMLButtonElement>('[data-move]')) {
      const kind = b.dataset.move as MoveKind
      // One press = one step. No hold-to-repeat: long-pressing a pad pops the
      // context menu on many mobile browsers, so holding does nothing by design.
      b.addEventListener('pointerdown', (e) => {
        e.preventDefault()
        this.startMove(kind)
        this.pulse(b)
      })
    }
    for (const b of root.querySelectorAll<HTMLButtonElement>('[data-toggle]')) {
      b.addEventListener('click', () => {
        hooks.press()
        const on = !b.classList.contains('is-on')
        b.classList.toggle('is-on', on)
        b.setAttribute('aria-pressed', String(on))
        const name = b.dataset.toggle!
        if (name === 'adjust') {
          this.adjust.hidden = !on
          if (on) this.sync()
        } else hooks.toggle(name as 'robot' | 'anchors' | 'reach', on)
      })
    }
    root.querySelector('[data-reset]')!.addEventListener('click', () => {
      hooks.press()
      hooks.reset()
      this.sync()
    })
    for (const input of root.querySelectorAll<HTMLInputElement>('input[type=range]')) {
      const side = input.dataset.side as Side
      const s = { ...SLIDERS.find(x => x.key === input.dataset.key)!, side }
      const out = input.parentElement!.querySelector('output')!
      this.inputs.push({ s, input, out })
      input.addEventListener('input', () => {
        const value = Number(input.value)
        hooks.transform(side, { [s.key]: value })
        out.textContent = this.format(s, value)
      })
    }

    // Movement keys keep hold-to-repeat on desktop (no context-menu risk there);
    // touch pads fire once per press so long-pressing never lingers on the button.
    const MOVE_KEYS: Record<string, MoveKind> = {
      KeyW: 'in', ArrowUp: 'in',
      KeyS: 'out', ArrowDown: 'out',
      KeyA: 'left', ArrowLeft: 'left',
      KeyD: 'right', ArrowRight: 'right',
    }
    window.addEventListener('keydown', e => {
      if (e.ctrlKey || e.metaKey || e.altKey) return
      const target = e.target as HTMLElement | null
      if (target?.tagName === 'INPUT') return
      const move = MOVE_KEYS[e.code]
      if (move) {
        if (!e.repeat) this.startKeyMove(move)
        e.preventDefault()
        return
      }
      if (e.repeat) return
      const def = MENU_ACTIONS.find(a => a.key === e.code)
      if (def) {
        hooks.press()
        hooks.action(def.id)
        this.pulse(this.buttons.get(def.id)!)
        e.preventDefault()
      }
    })
    window.addEventListener('keyup', e => {
      const move = MOVE_KEYS[e.code]
      if (move) this.stopKeyMove(move)
    })
    window.addEventListener('blur', () => this.stopKeyMoves())
    this.setActive(MENU_ACTIONS[0])
  }

  private startMove(kind: MoveKind): void {
    this.hooks.press()
    MOVE_HOOKS[kind](this.hooks)
  }

  /** Keyboard hold-to-repeat (desktop only; cadence 130 ms). */
  private readonly keyHeld = new Set<MoveKind>()
  private keyTimer: number | null = null

  private startKeyMove(kind: MoveKind): void {
    this.startMove(kind)
    this.keyHeld.add(kind)
    if (this.keyTimer === null) {
      this.keyTimer = window.setInterval(() => {
        for (const k of this.keyHeld) MOVE_HOOKS[k](this.hooks)
      }, 130)
    }
  }

  private stopKeyMove(kind: MoveKind): void {
    this.keyHeld.delete(kind)
    if (this.keyHeld.size === 0 && this.keyTimer !== null) {
      window.clearInterval(this.keyTimer)
      this.keyTimer = null
    }
  }

  private stopKeyMoves(): void {
    this.keyHeld.clear()
    if (this.keyTimer !== null) {
      window.clearInterval(this.keyTimer)
      this.keyTimer = null
    }
  }

  private format(s: Slider, v: number): string {
    return `${s.key === 'yaw' ? v.toFixed(0) : v.toFixed(2)}${s.unit}`
  }

  private pulse(b: HTMLElement): void {
    b.classList.remove('pressed')
    void b.offsetWidth
    b.classList.add('pressed')
  }

  /** Refresh slider positions from the live fighter transforms. */
  sync(): void {
    if (this.adjust.hidden) return
    for (const { s, input, out } of this.inputs) {
      const v = this.hooks.read(s.side)[s.key]
      if (document.activeElement !== input) input.value = String(v)
      out.textContent = this.format(s, v)
    }
  }

  /** Highlight the black fighter's running action and its stance. */
  setActive(def: ActionDef): void {
    if (def.kind === 'stance') this.stance = def.id
    this.active = def.id
    for (const [id, b] of this.buttons) {
      b.classList.toggle('is-running', id === this.active && def.kind !== 'stance')
      b.classList.toggle('is-stance', id === this.stance)
    }
  }

  get element(): HTMLElement {
    return this.root
  }
}
