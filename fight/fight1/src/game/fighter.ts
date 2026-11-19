import * as THREE from 'three'
import { ACTIONS, ACTION_BY_ID, type ActionDef } from './actions'
import { CONFIG, type FighterTransform, type Side } from './config'
import { createAnchors, createFists, FIST, updateAnchors, updateFists, type Anchor, type Fist, type Region } from './anchors'
import { describeStrike, SAMPLE_HZ, solveStrikeDistance, type Strike } from './reach'
import type { Rig } from './rig'

export type FighterState = 'idle' | 'approach' | 'acting' | 'hit'

const UP = new THREE.Vector3(0, 1, 0)
const RING_LIMIT = 2.45
/** Both characters are normalised to this standing height so anchors and reach use real metres. */
export const FIGHTER_HEIGHT = 1.75
const tmpA = new THREE.Vector3()
const tmpB = new THREE.Vector3()
const tmpDir = new THREE.Vector3()

function approachAngle(current: number, target: number, maxStep: number): number {
  let d = target - current
  d = Math.atan2(Math.sin(d), Math.cos(d))
  return current + Math.max(-maxStep, Math.min(maxStep, d))
}

/**
 * One boxer. Hierarchy: `root` (ring position, facing yaw, user scale) → `pivot` (fixed yaw that turns
 * the authored model to face +Z) → the GLB character node (authored rotation and 0.01 scale).
 */
export class Fighter {
  readonly root = new THREE.Group()
  private readonly pivot = new THREE.Group()
  readonly mixer: THREE.AnimationMixer
  readonly anchors: Anchor[]
  readonly fists: Fist[]
  readonly strikes = new Map<string, Strike>()
  readonly bones: Map<string, THREE.Bone>
  /** The rig's character node (container + skinned mesh + bones), used to clone a retarget probe. */
  readonly model: THREE.Object3D
  private readonly actions = new Map<string, THREE.AnimationAction>()
  private readonly materials: THREE.MeshStandardMaterial[] = []

  opponent!: Fighter
  state: FighterState = 'idle'
  stance: ActionDef = ACTION_BY_ID.get('idle')!
  current: { def: ActionDef; action: THREE.AnimationAction; strike?: Strike } | null = null
  /** Increments every time an action starts; the hit tracker allows one impact per fist per strike. */
  strikeId = 0
  pending: ActionDef | null = null
  /** Floor position of the root (y = 0). */
  readonly pos = new THREE.Vector3()
  yaw = 0
  /** Optional temporary footwork destination (robot); otherwise the fighter rests at home. */
  footwork: THREE.Vector3 | null = null
  autoReach = true
  private approachDistance = 0
  /** Extra yaw toward the current strike's line (radians). */
  private aim = 0
  /** Last reach solution (debug/test visibility). */
  lastSolve: { distance: number; hit: boolean } | null = null
  private approachTimer = 0
  private restTimer = 0
  private flash = 0
  private flashColor = new THREE.Color('#ffffff')
  /** Called whenever the visible action changes (for button highlighting). */
  onAction?: (def: ActionDef) => void
  /** Called when a strike enters its active window (whoosh sound). */
  onSwing?: (fighter: Fighter) => void
  private swung = false
  /** Match over: the fighter plays its victory/defeat clip and ignores all further commands. */
  ko = false
  private endAction: THREE.AnimationAction | null = null

  constructor(readonly side: Side, rig: Rig, readonly transform: FighterTransform) {
    this.root.name = `fighter-${side}`
    this.bones = rig.bones
    this.model = rig.model
    rig.model.position.set(0, 0, 0)
    this.pivot.add(rig.model)
    this.root.add(this.pivot)
    this.mixer = new THREE.AnimationMixer(this.root)
    for (const def of ACTIONS) {
      const clip = rig.clips.get(def.clip)
      if (!clip) throw new Error(`Missing animation "${def.clip}"`)
      const action = this.mixer.clipAction(clip)
      if (def.kind !== 'stance') {
        action.setLoop(THREE.LoopOnce, 1)
        action.clampWhenFinished = true
      }
      this.actions.set(def.id, action)
    }
    for (const mesh of rig.meshes) {
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
      for (const m of mats) if ((m as THREE.MeshStandardMaterial).isMeshStandardMaterial) this.materials.push(m as THREE.MeshStandardMaterial)
    }
    this.anchors = createAnchors(this.bones, side)
    this.fists = createFists(side)
    this.normalise()
    this.sampleStrikes()
    this.actions.get(this.stance.id)!.reset().play()
    this.mixer.update(0)
    this.pos.set(transform.x, 0, transform.z)
    this.syncRoot()
  }

  /**
   * Normalise the authored model: scale to FIGHTER_HEIGHT, face +Z, centre the hips over the origin
   * and stand the feet on the floor. All later maths (anchors, reach, spacing) is then in metres.
   */
  private normalise(): void {
    // Measure on the fighting guard clip (attack-idle) so size and facing do not depend on button mapping.
    const idle = this.actions.get(ACTIONS.find(a => a.clip === 'attack-idle')!.id)!
    idle.reset().play()
    this.mixer.update(0)
    this.root.updateMatrixWorld(true)
    const top = this.bones.get('HeadTop_End') ?? this.bones.get('Head')!
    const feet = ['LeftToe_End', 'RightToe_End', 'LeftToeBase', 'RightToeBase', 'LeftFoot', 'RightFoot']
    const floorY = () => Math.min(...feet.map(n => this.bones.get(n)).filter(Boolean).map(b => b!.getWorldPosition(tmpA).y))
    // The idle guard is crouched; measure head-top to floor and allow for the stance bend.
    const height = top.getWorldPosition(tmpA).y - floorY()
    if (height > 1e-3) this.pivot.scale.setScalar((FIGHTER_HEIGHT * 0.93) / height)
    this.root.updateMatrixWorld(true)
    const l = this.bones.get('LeftArm')!.getWorldPosition(new THREE.Vector3())
    const r = this.bones.get('RightArm')!.getWorldPosition(new THREE.Vector3())
    const forward = new THREE.Vector3().crossVectors(UP, r.sub(l)).setY(0).normalize()
    this.pivot.rotation.y = -Math.atan2(forward.x, forward.z)
    this.root.updateMatrixWorld(true)
    // pivot.position lives in the root's (unrotated) space, so the world offset applies directly.
    const hips = this.bones.get('Hips')!.getWorldPosition(new THREE.Vector3())
    this.pivot.position.x -= hips.x
    this.pivot.position.z -= hips.z
    this.root.updateMatrixWorld(true)
    this.pivot.position.y -= floorY() - 0.03
    this.root.updateMatrixWorld(true)
    idle.stop()
  }

  /** Record each attack's fist path in the fighter's own frame (origin, facing +Z, scale 1). */
  private sampleStrikes(): void {
    for (const def of ACTIONS) {
      if (def.kind !== 'attack') continue
      const action = this.actions.get(def.id)!
      const duration = action.getClip().duration
      action.reset().play()
      const times: number[] = []
      const left: THREE.Vector3[] = []
      const right: THREE.Vector3[] = []
      for (let t = 0; t <= duration + 1e-6; t += 1 / SAMPLE_HZ) {
        action.time = Math.min(t, duration)
        this.mixer.update(0)
        this.root.updateMatrixWorld(true)
        updateFists(this.fists, this.bones, 1, 0, true)
        times.push(action.time)
        left.push(this.fists[0].pos.clone())
        right.push(this.fists[1].pos.clone())
      }
      action.stop()
      this.strikes.set(def.id, describeStrike(def.clip, duration, times, left, right))
    }
  }

  get scale(): number {
    return this.transform.scale
  }

  get home(): THREE.Vector3 {
    return tmpB.set(this.transform.x, 0, this.transform.z)
  }

  get busy(): boolean {
    return this.state !== 'idle'
  }

  /** Clip time of the running action, in seconds. */
  get actionTime(): number {
    return this.current?.action.time ?? 0
  }

  /** True while the running attack is inside its strike window: only then do fist contacts count. */
  get striking(): boolean {
    const c = this.current
    if (this.state !== 'acting' || !c?.strike) return false
    const t = c.action.time
    return t >= c.strike.windowStart && t <= c.strike.windowEnd
  }

  /** Ask for an action. Attacks first step/turn into range (auto reach), then play. */
  request(def: ActionDef): void {
    if (this.ko) return
    if (def.kind === 'stance') {
      const shown = this.actions.get(this.stance.id)!
      const next = this.actions.get(def.id)!
      this.stance = def
      // Picking a stance mid-motion (hit react / punch / step-in) cuts straight to it: a crossfade
      // out of the crumpled hit pose read as "getting up off the floor", which players hated.
      if (this.state !== 'idle') this.cutToStance(def)
      // Same stance already on screen: do nothing. Re-fading from weight 0 would collapse the
      // skeleton to its bind pose for a moment, which looked like sinking to the floor and rising.
      else if (next !== shown) this.fadeTo(next, shown)
      this.onAction?.(this.current?.def ?? def)
      return
    }
    if (def.kind === 'react') {
      this.pending = null
      this.play(def)
      return
    }
    if (this.state === 'acting' || this.state === 'hit') {
      this.pending = def
      return
    }
    this.beginAttack(def)
  }

  /** Hard-cut to a looping stance: stop whatever is playing and show the stance pose at once. */
  private cutToStance(def: ActionDef): void {
    this.pending = null
    this.footwork = null
    this.aim = 0
    this.current = null
    this.state = 'idle'
    this.restTimer = 0
    const next = this.actions.get(def.id)!
    for (const a of this.actions.values()) if (a !== next) a.stop()
    next.reset().setEffectiveWeight(1).play()
  }

  private beginAttack(def: ActionDef): void {
    const strike = this.strikes.get(def.id)!
    if (!this.autoReach) {
      this.aim = 0
      this.play(def)
      return
    }
    const foe = this.opponent
    tmpDir.subVectors(foe.pos, this.pos).setY(0)
    const current = tmpDir.length()
    tmpDir.divideScalar(Math.max(current, 1e-6))
    const targets = foe.anchors.filter(a => a.region === 'head' || a.region === 'body')
    const minD = CONFIG.fight.minSeparation * (this.scale + foe.scale) / 2
    // Change transform before acting: turn so the strike's fist path lines up with the target and
    // step to the farthest spacing at which that path still lands on the head/torso anchors.
    this.aim = strike.aimYaw
    const solved = solveStrikeDistance(strike, targets, foe.pos, tmpDir, THREE.MathUtils.degToRad(this.transform.yaw) + this.aim,
      this.scale, CONFIG.fight.reachDepth * this.scale, { min: minD, max: 2.6 })
    this.approachDistance = solved.distance
    this.lastSolve = solved
    this.pending = def
    this.approachTimer = 0
    this.state = 'approach'
  }

  private play(def: ActionDef): void {
    const next = this.actions.get(def.id)!
    const prev = this.current?.action ?? this.actions.get(this.stance.id)!
    next.reset()
    next.setEffectiveTimeScale(def.kind === 'attack' ? CONFIG.fight.attackSpeed : 1)
    this.fadeTo(next, prev === next ? null : prev)
    this.current = { def, action: next, strike: this.strikes.get(def.id) }
    this.state = def.kind === 'react' ? 'hit' : 'acting'
    if (def.kind !== 'attack') this.aim = 0
    this.strikeId += 1
    this.swung = false
    this.restTimer = 0
    this.onAction?.(def)
  }

  private fadeTo(next: THREE.AnimationAction, prev: THREE.AnimationAction | null): void {
    // Already the only visible clip: fading in again would start from weight 0 and flash the bind pose.
    if (!prev && next.isRunning() && next.getEffectiveWeight() > 0.99) return
    const blend = CONFIG.fight.blend
    next.enabled = true
    next.setEffectiveWeight(1)
    next.play()
    if (prev && prev !== next) next.crossFadeFrom(prev, blend, false)
    else next.fadeIn(blend)
    // Any other still-weighted clips fade out too, so rapid input never stacks poses.
    for (const a of this.actions.values()) if (a !== next && a !== prev && a.isRunning() && a.getEffectiveWeight() > 0) a.fadeOut(blend)
  }

  /** Called by the game when an opponent fist lands on one of this fighter's anchors. */
  takeHit(region: Region, push: THREE.Vector3, power: number): boolean {
    if (this.ko) return false
    this.flash = 1
    this.flashColor.set(region === 'arm' ? '#7fe8ff' : '#ffb27a')
    const k = region === 'arm' ? 0.35 : region === 'leg' ? 0.5 : 1
    this.pos.addScaledVector(push, CONFIG.fight.knockback * k * power)
    if (region === 'arm') return false
    const c = this.current
    // Trading blows: a fighter already past the peak of its own punch finishes it.
    if (this.state === 'acting' && c?.strike && c.action.time > c.strike.tPeak) return false
    this.pending = null
    this.play(ACTION_BY_ID.get('hit')!)
    return true
  }

  step(dt: number): void {
    // Match over: keep playing the victory/defeat clip, ignore all fight logic.
    if (this.ko) {
      this.mixer.update(dt)
      this.syncRoot()
      return
    }
    const foe = this.opponent
    // Always face the opponent, plus the user's yaw offset and the current strike's aim.
    tmpDir.subVectors(foe.pos, this.pos).setY(0)
    const dist = tmpDir.length()
    if (dist > 1e-4) tmpDir.divideScalar(dist)
    const desiredYaw = Math.atan2(tmpDir.x, tmpDir.z) + THREE.MathUtils.degToRad(this.transform.yaw) + this.aim
    this.yaw = approachAngle(this.yaw, desiredYaw, dt * 9)
    const aligned = Math.abs(Math.atan2(Math.sin(desiredYaw - this.yaw), Math.cos(desiredYaw - this.yaw))) < 0.05

    switch (this.state) {
      case 'approach': {
        this.approachTimer += dt
        const goal = tmpA.copy(foe.pos).addScaledVector(tmpDir, -this.approachDistance).setY(0)
        const arrived = this.moveToward(goal, CONFIG.fight.stepSpeed * this.scale, dt)
        if ((arrived && aligned) || this.approachTimer > 1.6) {
          const def = this.pending!
          this.pending = null
          this.play(def)
        }
        break
      }
      case 'acting':
      case 'hit': {
        const c = this.current!
        if (this.striking && !this.swung) {
          this.swung = true
          this.onSwing?.(this)
        }
        const remaining = (c.action.getClip().duration - c.action.time) / Math.max(c.action.getEffectiveTimeScale(), 0.01)
        if (remaining <= CONFIG.fight.blend || !c.action.isRunning()) this.finish()
        break
      }
      case 'idle': {
        this.restTimer += dt
        if (this.restTimer > CONFIG.fight.returnDelay) {
          const goal = this.footwork ?? this.home
          this.moveToward(goal, CONFIG.fight.stepSpeed * 0.55 * this.scale, dt)
        }
        break
      }
    }
    this.mixer.update(dt)
    this.pos.x = THREE.MathUtils.clamp(this.pos.x, -RING_LIMIT, RING_LIMIT)
    this.pos.z = THREE.MathUtils.clamp(this.pos.z, -RING_LIMIT, RING_LIMIT)
    this.syncRoot()
  }

  private finish(): void {
    const c = this.current!
    const next = this.pending
    this.pending = null
    this.current = null
    this.state = 'idle'
    this.restTimer = 0
    this.aim = 0
    this.fadeTo(this.actions.get(this.stance.id)!, c.action)
    this.onAction?.(this.stance)
    // A buffered attack starts from the stance blend (stepping in first when needed).
    if (next && next.kind === 'attack') this.beginAttack(next)
  }

  private moveToward(goal: THREE.Vector3, speed: number, dt: number): boolean {
    tmpB.subVectors(goal, this.pos).setY(0)
    const d = tmpB.length()
    if (d < 0.012) return true
    const stepLen = Math.min(d, speed * dt * Math.min(1, 0.35 + d * 4))
    this.pos.addScaledVector(tmpB, stepLen / d)
    return d - stepLen < 0.012
  }

  /** Apply the user/tuned transform. When idle the fighter snaps to the new home spot immediately. */
  setTransform(t: Partial<FighterTransform>): void {
    Object.assign(this.transform, t)
    if (t.x !== undefined || t.z !== undefined) {
      this.footwork = null
      if (this.state === 'idle') this.pos.set(this.transform.x, 0, this.transform.z)
    }
    this.syncRoot()
  }

  /** Start walking to the home spot right away (used by the Step buttons). */
  hurryHome(): void {
    this.footwork = null
    if (this.state === 'idle') this.restTimer = Math.max(this.restTimer, CONFIG.fight.returnDelay + 0.01)
  }

  /** Match over: play the victory or defeat clip and freeze in its last pose. */
  playEnd(clip: THREE.AnimationClip): void {
    if (this.endAction && this.endAction.getClip() === clip) return
    this.ko = true
    this.pending = null
    this.footwork = null
    const prev = this.current?.action ?? this.actions.get(this.stance.id)!
    const next = this.mixer.clipAction(clip)
    next.reset()
    next.setLoop(THREE.LoopOnce, 1)
    next.clampWhenFinished = true
    next.enabled = true
    next.setEffectiveWeight(1)
    next.play()
    next.crossFadeFrom(prev, CONFIG.fight.blend * 2, false)
    this.endAction = next
    this.current = null
    this.state = 'idle'
    this.restTimer = 0
    this.onAction?.(this.stance)
  }

  /** Restore a playable state after a rematch. */
  resetForRematch(): void {
    this.ko = false
    this.pending = null
    this.current = null
    this.aim = 0
    this.state = 'idle'
    this.restTimer = 0
    this.footwork = null
    if (this.endAction) {
      this.endAction.stop()
      this.endAction = null
    }
    this.pos.copy(this.home)
    this.syncRoot()
    // Cut, don't fade: blending out of the clamped defeat pose dragged the body up off the mat.
    this.cutToStance(this.stance)
    this.onAction?.(this.stance)
  }

  syncRoot(): void {
    this.root.position.copy(this.pos)
    this.root.rotation.y = this.yaw
    this.root.scale.setScalar(this.scale)
  }

  /** Refresh world matrices, anchors and fists after movement and animation. */
  updateWorld(dt: number, resetFists = false): void {
    this.root.updateMatrixWorld(true)
    updateAnchors(this.anchors, this.bones, this.scale)
    updateFists(this.fists, this.bones, this.scale, dt, resetFists)
  }

  /** Visual-only work per rendered frame. */
  animate(dt: number): void {
    this.flash = Math.max(0, this.flash - dt * 4.5)
    for (const m of this.materials) {
      m.emissive.copy(this.flashColor)
      m.emissiveIntensity = this.flash * this.flash * 0.55
    }
  }

  /** Fist radius at the current scale (used for effects). */
  get fistRadius(): number {
    return FIST.radius * this.scale
  }
}
