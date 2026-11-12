import * as THREE from 'three'
import { ACTION_BY_ID, ATTACKS, type ActionDef } from './actions'
import { CONFIG } from './config'
import type { Fighter } from './fighter'

const rand = (a: number, b: number) => a + Math.random() * (b - a)

/** Weighted preferences: straight punches are most common, uppercuts rarer. */
const WEIGHTS: Record<string, number> = { jab: 3, cross: 2.2, cross2: 1.6, leadHook: 1.6, rearHook: 1.4, leadUpper: 1, rearUpper: 1 }

/**
 * The red robot: alternates footwork (forward/back/side steps around its home spot) with attacks,
 * chains combos, sometimes counters right after the player's punch and backs off after being hit.
 */
export class RobotBrain {
  enabled = true
  private timer = 1.6
  private comboLeft = 0
  private last = ''
  private wasFoeActing = false

  constructor(private readonly me: Fighter, private readonly foe: Fighter) {}

  step(dt: number): void {
    const me = this.me
    const foeActing = this.foe.state === 'acting' || this.foe.state === 'approach'
    if (!this.enabled) {
      me.footwork = null
      this.wasFoeActing = foeActing
      return
    }
    if (me.state === 'hit') {
      this.comboLeft = 0
      this.timer = Math.max(this.timer, CONFIG.robot.hitCooldown)
      // Back off a little after taking a punch.
      me.footwork = this.spot(0.3, 0.15)
      this.wasFoeActing = foeActing
      return
    }
    // Counter window: the player just finished a punch.
    if (this.wasFoeActing && !foeActing && me.state === 'idle' && Math.random() < 0.35) this.timer = Math.min(this.timer, 0.3)
    this.wasFoeActing = foeActing
    if (me.state !== 'idle') return
    this.timer -= dt
    if (this.timer > 0) return

    if (this.comboLeft > 0) {
      this.comboLeft -= 1
      this.attack()
      this.timer = rand(0.25, 0.5)
      return
    }
    if (Math.random() < CONFIG.robot.aggression) {
      this.attack()
      this.comboLeft = Math.random() < CONFIG.robot.combo ? 1 : 0
      this.timer = rand(CONFIG.robot.thinkMin, CONFIG.robot.thinkMax)
    } else {
      // Footwork: drift in/out and side to side; occasionally switch stance.
      me.footwork = this.spot(rand(-0.35, 0.35), rand(-0.45, 0.45))
      if (Math.random() < 0.25) me.request(ACTION_BY_ID.get(Math.random() < 0.5 ? 'guard' : 'idle')!)
      this.timer = rand(CONFIG.robot.thinkMin * 0.7, CONFIG.robot.thinkMax * 0.8)
    }
  }

  private attack(): void {
    const pool = ATTACKS.filter(a => a.id !== this.last)
    const total = pool.reduce((n, a) => n + (WEIGHTS[a.id] ?? 1), 0)
    let pick = Math.random() * total
    let choice: ActionDef = pool[0]
    for (const a of pool) {
      pick -= WEIGHTS[a.id] ?? 1
      if (pick <= 0) { choice = a; break }
    }
    this.last = choice.id
    this.me.request(choice)
  }

  /** A footwork destination relative to the robot's home: `back` along the line, `side` across it. */
  private spot(back: number, side: number): THREE.Vector3 {
    const home = this.me.home.clone()
    const line = new THREE.Vector3().subVectors(home, this.foe.pos).setY(0)
    if (line.lengthSq() < 1e-6) line.set(1, 0, 0)
    line.normalize()
    const across = new THREE.Vector3(-line.z, 0, line.x)
    return home.addScaledVector(line, back).addScaledVector(across, side)
  }
}
