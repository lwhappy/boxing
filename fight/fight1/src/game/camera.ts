import * as THREE from 'three'
import { CONFIG } from './config'

/**
 * Broadcast-style side camera. It frames the midpoint of both fighters from the side of their line,
 * zooming to fit their separation for any aspect ratio. Drag to orbit, wheel/pinch to zoom,
 * double-click/tap to reset the view.
 */
export class FightCamera {
  readonly camera: THREE.PerspectiveCamera
  private orbitYaw = 0.32
  private orbitPitch = 0.1
  private zoom = 1
  private shakeAmount = 0
  private readonly target = new THREE.Vector3(0, 1, 0)
  private readonly side = new THREE.Vector3(0, 0, 1)
  private distance = 4
  private pointers = new Map<number, { x: number; y: number }>()
  private pinchStart = 0
  private zoomStart = 1

  constructor(element: HTMLElement) {
    this.camera = new THREE.PerspectiveCamera(CONFIG.camera.fov, 16 / 9, 0.05, 80)
    element.addEventListener('pointerdown', e => {
      element.setPointerCapture(e.pointerId)
      this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY })
      if (this.pointers.size === 2) {
        this.pinchStart = this.pinchDistance()
        this.zoomStart = this.zoom
      }
    })
    element.addEventListener('pointermove', e => {
      const p = this.pointers.get(e.pointerId)
      if (!p) return
      if (this.pointers.size === 1) {
        this.orbitYaw -= (e.clientX - p.x) * 0.006
        this.orbitPitch = THREE.MathUtils.clamp(this.orbitPitch + (e.clientY - p.y) * 0.004, -0.15, 0.85)
        this.orbitYaw = THREE.MathUtils.clamp(this.orbitYaw, -1.35, 1.35)
      }
      p.x = e.clientX
      p.y = e.clientY
      if (this.pointers.size === 2 && this.pinchStart > 0) {
        this.zoom = THREE.MathUtils.clamp(this.zoomStart * (this.pinchStart / Math.max(this.pinchDistance(), 1)), 0.55, 1.8)
      }
    })
    const release = (e: PointerEvent) => {
      this.pointers.delete(e.pointerId)
      if (this.pointers.size < 2) this.pinchStart = 0
    }
    element.addEventListener('pointerup', release)
    element.addEventListener('pointercancel', release)
    element.addEventListener('wheel', e => {
      e.preventDefault()
      this.zoom = THREE.MathUtils.clamp(this.zoom * Math.exp(e.deltaY * 0.0012), 0.55, 1.8)
    }, { passive: false })
    element.addEventListener('dblclick', () => this.resetView())
  }

  private pinchDistance(): number {
    const [a, b] = [...this.pointers.values()]
    return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0
  }

  resetView(): void {
    this.orbitYaw = 0.32
    this.orbitPitch = 0.1
    this.zoom = 1
  }

  shake(amount: number): void {
    this.shakeAmount = Math.max(this.shakeAmount, amount)
  }

  update(a: THREE.Vector3, b: THREE.Vector3, dt: number, snap = false): void {
    const cam = this.camera
    if (cam.fov !== CONFIG.camera.fov) {
      cam.fov = CONFIG.camera.fov
      cam.updateProjectionMatrix()
    }
    const mid = new THREE.Vector3().addVectors(a, b).multiplyScalar(0.5)
    const line = new THREE.Vector3().subVectors(b, a).setY(0)
    const sep = line.length()
    if (sep > 1e-3) line.divideScalar(sep)
    else line.set(1, 0, 0)
    // Perpendicular to the fighters' line, kept on the same side as before (no flipping).
    const perp = new THREE.Vector3(-line.z, 0, line.x)
    if (perp.dot(this.side) < 0) perp.negate()
    const k = snap ? 1 : 1 - Math.exp(-dt * 3)
    this.side.lerp(perp, k).normalize()
    this.target.lerp(new THREE.Vector3(mid.x, CONFIG.camera.height * 0.72, mid.z), snap ? 1 : 1 - Math.exp(-dt * 5))
    // Fit both fighters horizontally and a standing body vertically.
    const vHalf = THREE.MathUtils.degToRad(cam.fov / 2)
    const hHalf = Math.atan(Math.tan(vHalf) * cam.aspect)
    const fitW = (sep / 2 + (cam.aspect < 1 ? 0.5 : 0.75)) / Math.tan(hHalf)
    const fitH = 1.15 / Math.tan(vHalf)
    const want = (Math.max(fitW, fitH) + CONFIG.camera.distance) * this.zoom
    this.distance += (want - this.distance) * (snap ? 1 : 1 - Math.exp(-dt * 3))
    const dir = this.side.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), this.orbitYaw)
    const pitch = this.orbitPitch + 0.06
    cam.position.copy(this.target)
      .addScaledVector(dir, Math.cos(pitch) * this.distance)
      .add(new THREE.Vector3(0, Math.sin(pitch) * this.distance + (CONFIG.camera.height - this.target.y) * 0.35, 0))
    cam.lookAt(this.target)
    if (this.shakeAmount > 0.0005) {
      const s = this.shakeAmount
      cam.position.add(new THREE.Vector3((Math.random() - 0.5) * s, (Math.random() - 0.5) * s, (Math.random() - 0.5) * s))
      this.shakeAmount *= Math.exp(-dt * 16)
    }
  }
}
