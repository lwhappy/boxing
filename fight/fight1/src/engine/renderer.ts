import * as THREE from 'three'

export type Quality = 'low' | 'medium' | 'high'
type Preset = { pixelRatio: number; shadows: boolean; shadowMap: number; antialias: boolean }
export const QUALITY_PRESETS: Record<Quality, Preset> = {
  low: { pixelRatio: 1, shadows: false, shadowMap: 512, antialias: false },
  medium: { pixelRatio: 1.5, shadows: true, shadowMap: 1024, antialias: true },
  high: { pixelRatio: 2, shadows: true, shadowMap: 2048, antialias: true },
}

/** Pick a starting quality from device hints. */
export function suggestQuality(): Quality {
  const coarse = matchMedia('(pointer: coarse)').matches
  const cores = navigator.hardwareConcurrency ?? 4
  if (coarse || cores <= 4) return 'medium'
  return 'high'
}

/**
 * Owns the WebGL renderer and resize handling. The canvas fills its stage container; a
 * ResizeObserver keeps the drawing buffer in sync when the control deck changes height.
 */
export class Renderer {
  readonly gl: THREE.WebGLRenderer
  private preset: Preset

  constructor(readonly canvas: HTMLCanvasElement, quality: Quality) {
    this.preset = QUALITY_PRESETS[quality]
    this.gl = new THREE.WebGLRenderer({ canvas, antialias: this.preset.antialias, powerPreference: 'high-performance' })
    this.gl.outputColorSpace = THREE.SRGBColorSpace
    this.gl.toneMapping = THREE.NeutralToneMapping
    this.gl.toneMappingExposure = 0.95
    this.gl.shadowMap.type = THREE.PCFShadowMap
    this.applyQuality(quality)
    window.addEventListener('resize', () => this.resize())
    new ResizeObserver(() => this.resize()).observe(canvas)
  }

  get shadowMapSize(): number {
    return this.preset.shadowMap
  }

  applyQuality(quality: Quality): void {
    this.preset = QUALITY_PRESETS[quality]
    this.gl.shadowMap.enabled = this.preset.shadows
    this.gl.setPixelRatio(Math.min(window.devicePixelRatio || 1, this.preset.pixelRatio))
    this.resize()
  }

  resize(): void {
    const w = this.canvas.clientWidth || window.innerWidth
    const h = this.canvas.clientHeight || window.innerHeight
    this.gl.setSize(w, h, false)
  }

  render(scene: THREE.Scene, camera: THREE.PerspectiveCamera): void {
    const w = this.canvas.clientWidth || window.innerWidth
    const h = this.canvas.clientHeight || window.innerHeight
    if (Math.abs(camera.aspect - w / h) > 1e-3) {
      camera.aspect = w / h
      camera.updateProjectionMatrix()
    }
    this.gl.render(scene, camera)
  }
}
