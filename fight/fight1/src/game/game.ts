import * as THREE from 'three'
import type { GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'
import { ACTION_BY_ID, type ActionDef } from './actions'
import { AnchorOverlay, type Anchor, type Fist } from './anchors'
import { Arena } from './arena'
import { RobotBrain } from './ai'
import { FightCamera } from './camera'
import { ContactTracker, segmentSegment, sweptSphereCapsule } from './combat'
import { CONFIG, DEFAULT_CONFIG, type FighterTransform, type Side } from './config'
import { Fighter } from './fighter'
import { ImpactFx } from './fx'
import { extractRigs, prepareMeshes } from './rig'
import { FightSfx } from './sfx'
import type { Renderer } from '../engine/renderer'

/** GLB character nodes: the black boxer is authored as "attack", the red one as "defence". */
export const CHARACTER_NODES: Record<Side, string> = { black: 'attack', red: 'defence' }

export type HitEvent = { attacker: Side; region: Anchor['region']; anchor: string; fist: string; point: THREE.Vector3; power: number; reacted: boolean }

type Overlap = { fist: string; anchor: string; strikeId: number; f: Fist; an: Anchor; att: Fighter; def: Fighter }

export class Game {
  readonly scene = new THREE.Scene()
  readonly black: Fighter
  readonly red: Fighter
  readonly brain: RobotBrain
  readonly cam: FightCamera
  readonly overlay = new AnchorOverlay()
  private readonly arena: Arena
  private readonly fx = new ImpactFx()
  private readonly tracker = new ContactTracker()
  private hitstop = 0
  private firstStep = true
  readonly hits: HitEvent[] = []
  onAction?: (side: Side, def: ActionDef) => void
  onHit?: (e: HitEvent) => void

  constructor(private readonly renderer: Renderer, gltf: GLTF, private readonly sfx: FightSfx, stage: HTMLElement) {
    this.scene.background = new THREE.Color('#07070b')
    this.scene.fog = new THREE.Fog('#07070b', 9, 24)
    this.arena = new Arena(renderer.shadowMapSize)
    this.scene.add(this.arena.group)

    const rigs = extractRigs(gltf, Object.values(CHARACTER_NODES))
    gltf.scene.getObjectByName('Speaker')?.removeFromParent()
    // Soft image-based light applied to the fighters only, so they read brighter without
    // washing out the dark arena.
    const pmrem = new THREE.PMREMGenerator(renderer.gl)
    const fighterEnv = pmrem.fromScene(new RoomEnvironment(), 0.04).texture
    pmrem.dispose()
    const make = (side: Side) => {
      const rig = rigs.get(CHARACTER_NODES[side])!
      prepareMeshes(rig)
      const f = new Fighter(side, rig, structuredClone(CONFIG[side]))
      f.root.traverse(o => {
        const mesh = o as THREE.Mesh
        if (!mesh.isMesh) return
        for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
          const std = m as THREE.MeshStandardMaterial
          if (!std.isMeshStandardMaterial) continue
          std.envMap = fighterEnv
          std.envMapIntensity = 0.9
          std.needsUpdate = true
        }
      })
      f.onAction = def => this.onAction?.(side, def)
      f.onSwing = () => this.sfx.swing()
      this.scene.add(f.root)
      return f
    }
    this.black = make('black')
    this.red = make('red')
    this.black.opponent = this.red
    this.red.opponent = this.black
    // Start facing each other.
    this.black.yaw = Math.atan2(this.red.pos.x - this.black.pos.x, this.red.pos.z - this.black.pos.z)
    this.red.yaw = Math.atan2(this.black.pos.x - this.red.pos.x, this.black.pos.z - this.red.pos.z)
    this.black.syncRoot()
    this.red.syncRoot()
    this.red.request(ACTION_BY_ID.get('idle')!)
    this.brain = new RobotBrain(this.red, this.black)

    for (const f of [this.black, this.red]) f.updateWorld(0, true)
    this.overlay.add(this.black.anchors, this.black.fists, '#3fe0c5', '#ffd23f')
    this.overlay.add(this.red.anchors, this.red.fists, '#ff5a7a', '#ff9a3f')
    this.scene.add(this.overlay.group, this.fx.group)

    this.cam = new FightCamera(stage)
    this.cam.update(this.black.pos, this.red.pos, 0, true)
  }

  // ---- Player commands (black fighter) ------------------------------------------------------
  doAction(id: string): void {
    const def = ACTION_BY_ID.get(id)
    if (def) this.black.request(def)
  }

  /** Footwork for the player: move the black fighter's home spot toward (+1) or away from (−1) the robot. */
  stepBlack(dir: 1 | -1): void {
    const b = this.black
    const line = new THREE.Vector3().subVectors(this.red.pos, b.pos).setY(0)
    const len = line.length()
    if (len < 1e-4) return
    line.divideScalar(len)
    const amount = 0.28 * b.scale
    const minD = CONFIG.fight.minSeparation * (b.scale + this.red.scale) / 2 + 0.05
    const move = dir > 0 ? Math.min(amount, Math.max(0, len - minD)) : amount
    const x = THREE.MathUtils.clamp(b.transform.x + line.x * move * dir, -2.4, 2.4)
    const z = THREE.MathUtils.clamp(b.transform.z + line.z * move * dir, -2.4, 2.4)
    b.transform.x = x
    b.transform.z = z
    b.hurryHome()
  }

  setTransform(side: Side, patch: Partial<FighterTransform>): void {
    this[side].setTransform(patch)
    if (patch.x !== undefined || patch.z !== undefined) this.fistsTeleported = true
  }

  resetTransforms(): void {
    for (const side of ['black', 'red'] as const) {
      CONFIG[side] = structuredClone(DEFAULT_CONFIG[side]) as FighterTransform
      this[side].setTransform({ ...DEFAULT_CONFIG[side] })
    }
    this.fistsTeleported = true
    this.cam.resetView()
  }

  setAutoReach(on: boolean): void {
    this.black.autoReach = on
    this.red.autoReach = on
  }

  private fistsTeleported = false

  // ---- Simulation ----------------------------------------------------------------------------
  step(dt: number): void {
    if (this.hitstop > 0) {
      this.hitstop -= dt
      return
    }
    this.brain.step(dt)
    this.black.step(dt)
    this.red.step(dt)
    this.separate()
    const reset = this.firstStep || this.fistsTeleported
    this.firstStep = false
    this.fistsTeleported = false
    this.black.updateWorld(dt, reset)
    this.red.updateWorld(dt, reset)
    this.collide()
  }

  /** Keep the bodies from passing through each other. */
  private separate(): void {
    const a = this.black.pos
    const b = this.red.pos
    const d = new THREE.Vector3().subVectors(b, a).setY(0)
    const len = d.length()
    const min = CONFIG.fight.minSeparation * (this.black.scale + this.red.scale) / 2
    if (len >= min) return
    if (len < 1e-5) d.set(1, 0, 0)
    else d.divideScalar(len)
    const push = (min - len) / 2
    a.addScaledVector(d, -push)
    b.addScaledVector(d, push)
    this.black.syncRoot()
    this.red.syncRoot()
  }

  private collide(): void {
    const overlaps: Overlap[] = []
    for (const [att, def] of [[this.black, this.red], [this.red, this.black]] as const) {
      if (!att.striking) continue
      for (const f of att.fists) {
        // Slow hands (guard drifting into contact) and teleports do not count as punches.
        if (f.speed < 0.9 * att.scale || f.prev.distanceTo(f.pos) > 0.5 * att.scale) continue
        // Fighters are only ever tested against the opponent's anchors: no self-hits.
        for (const an of def.anchors) {
          if (sweptSphereCapsule(f.prev, f.pos, f.r, an.a, an.b, an.r)) {
            overlaps.push({ fist: f.id, anchor: an.id, strikeId: att.strikeId, f, an, att, def })
          }
        }
      }
    }
    for (const o of this.tracker.update(overlaps)) this.resolveHit(o)
  }

  private resolveHit({ f, an, att, def }: Overlap): void {
    const { s, t } = segmentSegment(f.prev, f.pos, an.a, an.b)
    const fistAt = new THREE.Vector3().lerpVectors(f.prev, f.pos, s)
    const anchorAt = new THREE.Vector3().lerpVectors(an.a, an.b, t)
    const point = anchorAt.lerp(fistAt, an.r / (an.r + f.r))
    const travel = new THREE.Vector3().subVectors(f.pos, f.prev)
    if (travel.lengthSq() < 1e-8) travel.subVectors(def.pos, att.pos)
    const power = THREE.MathUtils.clamp(f.speed / (4.5 * att.scale), 0.6, 1.4)
    const push = new THREE.Vector3().subVectors(def.pos, att.pos).setY(0).normalize()
    an.flash = 1
    this.fx.impact(point, travel, an.region, power)
    this.sfx.hit(an.region, power)
    const reacted = def.takeHit(an.region, push, power)
    if (an.region !== 'arm') {
      this.hitstop = CONFIG.fx.hitstop * power
      this.cam.shake(CONFIG.fx.shake * power)
    } else {
      this.cam.shake(CONFIG.fx.shake * 0.35)
    }
    const event: HitEvent = { attacker: att.side, region: an.region, anchor: an.id, fist: f.id, point: point.clone(), power, reacted }
    this.hits.push(event)
    if (this.hits.length > 50) this.hits.shift()
    this.onHit?.(event)
  }

  // ---- Rendering ----------------------------------------------------------------------------
  render(frameSeconds: number): void {
    this.black.animate(frameSeconds)
    this.red.animate(frameSeconds)
    this.overlay.update(frameSeconds)
    this.fx.update(frameSeconds)
    this.cam.update(this.black.pos, this.red.pos, frameSeconds)
    this.arena.update(this.cam.camera, frameSeconds)
    this.renderer.render(this.scene, this.cam.camera)
  }
}
