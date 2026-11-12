import * as THREE from 'three'
import type { Region } from './anchors'

type Burst = { sprite: THREE.Sprite; life: number; max: number; from: number; to: number; kind: 'flash' | 'ring' | 'star' }
type Spark = { pos: THREE.Vector3; vel: THREE.Vector3; life: number; max: number; color: THREE.Color; len: number }

const MAX_SPARKS = 320
const PALETTE: Record<Region, { core: string; spark: string[] }> = {
  head: { core: '#fff3c4', spark: ['#ffd23f', '#ff8a1f', '#ffffff'] },
  body: { core: '#ffe2c2', spark: ['#ffb02e', '#ff5a1f', '#ffe7a8'] },
  arm: { core: '#d9fbff', spark: ['#7fe8ff', '#ffffff', '#3fb8ff'] },
  leg: { core: '#ffe9d6', spark: ['#ffc06b', '#ffffff'] },
}

function radialTexture(draw: (g: CanvasRenderingContext2D, s: number) => void): THREE.Texture {
  const s = 128
  const c = document.createElement('canvas')
  c.width = c.height = s
  draw(c.getContext('2d')!, s)
  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
}

/** Pooled hit effects. Everything is additive and ignores depth so impacts read through limbs. */
export class ImpactFx {
  readonly group = new THREE.Group()
  private bursts: Burst[] = []
  private sparks: Spark[] = []
  private readonly sparkMesh: THREE.InstancedMesh
  private readonly dummy = new THREE.Object3D()
  private readonly flashTex: THREE.Texture
  private readonly ringTex: THREE.Texture
  private readonly starTex: THREE.Texture

  constructor() {
    this.flashTex = radialTexture((g, s) => {
      const grad = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2)
      grad.addColorStop(0, 'rgba(255,255,255,1)')
      grad.addColorStop(0.25, 'rgba(255,255,255,0.85)')
      grad.addColorStop(0.6, 'rgba(255,255,255,0.18)')
      grad.addColorStop(1, 'rgba(255,255,255,0)')
      g.fillStyle = grad
      g.fillRect(0, 0, s, s)
    })
    this.ringTex = radialTexture((g, s) => {
      g.strokeStyle = 'rgba(255,255,255,1)'
      g.lineWidth = s * 0.06
      g.beginPath()
      g.arc(s / 2, s / 2, s * 0.42, 0, Math.PI * 2)
      g.stroke()
    })
    this.starTex = radialTexture((g, s) => {
      g.translate(s / 2, s / 2)
      g.fillStyle = 'rgba(255,255,255,1)'
      const spikes = 9
      g.beginPath()
      for (let i = 0; i < spikes * 2; i += 1) {
        const r = i % 2 === 0 ? s * 0.48 : s * 0.16
        const a = (i / (spikes * 2)) * Math.PI * 2
        g.lineTo(Math.cos(a) * r, Math.sin(a) * r)
      }
      g.closePath()
      g.fill()
    })
    const sparkMat = new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending, toneMapped: false })
    this.sparkMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(0.014, 0.014, 1), sparkMat, MAX_SPARKS)
    this.sparkMesh.frustumCulled = false
    this.sparkMesh.count = 0
    this.sparkMesh.renderOrder = 30
    this.sparkMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
    this.sparkMesh.setColorAt(0, new THREE.Color())
    this.group.add(this.sparkMesh)
  }

  /** Spawn an impact at `at`; `dir` is the punch travel direction; `power` ~0.5..1.5. */
  impact(at: THREE.Vector3, dir: THREE.Vector3, region: Region, power: number): void {
    const pal = PALETTE[region]
    const big = region === 'arm' ? 0.65 : 1
    this.sprite('flash', at, pal.core, 0.08 * big, 0.62 * big * power, 0.22)
    this.sprite('star', at, pal.spark[0], 0.1 * big, 0.5 * big * power, 0.16)
    this.sprite('ring', at, pal.spark[1], 0.12, 0.95 * big * power, 0.34)
    if (region !== 'arm') this.sprite('ring', at, pal.spark[0], 0.05, 0.55 * power, 0.26)
    const n = Math.round((region === 'arm' ? 18 : 30) * power)
    const d = dir.clone().normalize()
    for (let i = 0; i < n; i += 1) {
      const v = new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.35, Math.random() - 0.5).normalize()
      v.addScaledVector(d, 0.9).normalize().multiplyScalar(2.2 + Math.random() * 3.6 * power)
      if (this.sparks.length >= MAX_SPARKS) this.sparks.shift()
      this.sparks.push({ pos: at.clone(), vel: v, life: 0, max: 0.18 + Math.random() * 0.26, color: new THREE.Color(pal.spark[i % pal.spark.length]), len: 0.06 + Math.random() * 0.1 })
    }
  }

  private sprite(kind: Burst['kind'], at: THREE.Vector3, color: string, from: number, to: number, max: number): void {
    const map = kind === 'flash' ? this.flashTex : kind === 'ring' ? this.ringTex : this.starTex
    const mat = new THREE.SpriteMaterial({ map, color, transparent: true, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending, toneMapped: false })
    mat.rotation = Math.random() * Math.PI * 2
    const sprite = new THREE.Sprite(mat)
    sprite.position.copy(at)
    sprite.renderOrder = 31
    sprite.scale.setScalar(from)
    this.group.add(sprite)
    this.bursts.push({ sprite, life: 0, max, from, to, kind })
  }

  update(dt: number): void {
    this.bursts = this.bursts.filter(b => {
      b.life += dt
      const k = Math.min(1, b.life / b.max)
      const ease = 1 - Math.pow(1 - k, 3)
      b.sprite.scale.setScalar(b.from + (b.to - b.from) * ease)
      const mat = b.sprite.material
      mat.opacity = b.kind === 'flash' ? (k < 0.25 ? 1 : 1 - (k - 0.25) / 0.75) : 1 - k
      if (b.kind === 'star') mat.rotation += dt * 4
      if (k >= 1) {
        this.group.remove(b.sprite)
        mat.dispose()
        return false
      }
      return true
    })
    this.sparks = this.sparks.filter(s => (s.life += dt) < s.max)
    const fwd = new THREE.Vector3()
    this.sparks.forEach((s, i) => {
      s.vel.y -= 6 * dt
      s.vel.multiplyScalar(1 - 3 * dt)
      s.pos.addScaledVector(s.vel, dt)
      const k = 1 - s.life / s.max
      fwd.copy(s.pos).add(s.vel)
      this.dummy.position.copy(s.pos)
      this.dummy.lookAt(fwd)
      this.dummy.scale.set(k * 1.4, k * 1.4, s.len * (0.4 + k))
      this.dummy.updateMatrix()
      this.sparkMesh.setMatrixAt(i, this.dummy.matrix)
      this.sparkMesh.setColorAt(i, s.color)
    })
    this.sparkMesh.count = this.sparks.length
    this.sparkMesh.instanceMatrix.needsUpdate = true
    if (this.sparkMesh.instanceColor) this.sparkMesh.instanceColor.needsUpdate = true
  }

  get active(): number {
    return this.bursts.length + this.sparks.length
  }
}
