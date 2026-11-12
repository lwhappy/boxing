import * as THREE from 'three'

export type Region = 'head' | 'body' | 'arm' | 'leg'

/**
 * An anchor bound to one bone. With `to`, it is a capsule from the bone toward that child bone
 * (trimmed by `from`/`until` in 0..1); without `to` it is a sphere on the bone. Radii are metres at
 * fighter scale 1 and follow the fighter's scale.
 */
export type AnchorSpec = { bone: string; to?: string; from?: number; until?: number; radius: number; region: Region }

export type Anchor = AnchorSpec & {
  id: string
  /** World-space segment end points and radius, refreshed by `updateAnchors`. */
  a: THREE.Vector3
  b: THREE.Vector3
  r: number
  mesh?: THREE.Mesh
  flash: number
}

export type Fist = {
  id: string
  hand: 'Left' | 'Right'
  pos: THREE.Vector3
  prev: THREE.Vector3
  r: number
  speed: number
  mesh?: THREE.Mesh
}

const side = (s: 'Left' | 'Right', spec: Omit<AnchorSpec, 'bone' | 'to'> & { bone: string; to?: string }): AnchorSpec => ({
  ...spec, bone: s + spec.bone, to: spec.to ? s + spec.to : undefined,
})

/**
 * Every bone of the Mixamo-style skeleton gets an anchor. Head and torso come first so that, when a
 * fist touches several anchors in the same step, the clean hit wins over a glancing arm contact.
 */
export const BODY_ANCHORS: readonly AnchorSpec[] = [
  { bone: 'Head', to: 'HeadTop_End', from: 0.12, until: 0.72, radius: 0.105, region: 'head' },
  { bone: 'Neck', to: 'Head', radius: 0.06, region: 'head' },
  { bone: 'Spine2', to: 'Neck', from: 0, until: 0.55, radius: 0.15, region: 'body' },
  { bone: 'Spine1', to: 'Spine2', radius: 0.14, region: 'body' },
  { bone: 'Spine', to: 'Spine1', radius: 0.135, region: 'body' },
  { bone: 'Hips', to: 'Spine', radius: 0.14, region: 'body' },
  ...(['Left', 'Right'] as const).flatMap(s => [
    side(s, { bone: 'Shoulder', to: 'Arm', radius: 0.065, region: 'body' }),
    side(s, { bone: 'Arm', to: 'ForeArm', radius: 0.055, region: 'arm' }),
    side(s, { bone: 'ForeArm', to: 'Hand', radius: 0.05, region: 'arm' }),
    side(s, { bone: 'Hand', to: 'HandIndex1', from: 0, until: 1.1, radius: 0.065, region: 'arm' }),
    side(s, { bone: 'UpLeg', to: 'Leg', radius: 0.085, region: 'leg' }),
    side(s, { bone: 'Leg', to: 'Foot', radius: 0.06, region: 'leg' }),
    side(s, { bone: 'Foot', to: 'ToeBase', radius: 0.055, region: 'leg' }),
    side(s, { bone: 'ToeBase', to: 'Toe_End', radius: 0.045, region: 'leg' }),
  ]),
]

/** Fist centre: from the wrist toward the index knuckle, slightly past it (gloved fist). */
export const FIST = { along: 0.85, radius: 0.07 }

const tmpA = new THREE.Vector3()
const tmpB = new THREE.Vector3()

export function createAnchors(bones: Map<string, THREE.Bone>, owner: string): Anchor[] {
  return BODY_ANCHORS.filter(s => bones.has(s.bone) && (!s.to || bones.has(s.to))).map(spec => ({
    ...spec, id: `${owner}.${spec.bone}`, a: new THREE.Vector3(), b: new THREE.Vector3(), r: spec.radius, flash: 0,
  }))
}

export function createFists(owner: string): Fist[] {
  return (['Left', 'Right'] as const).map(hand => ({
    id: `${owner}.${hand}Fist`, hand, pos: new THREE.Vector3(), prev: new THREE.Vector3(), r: FIST.radius, speed: 0,
  }))
}

/** Refresh world-space anchor geometry from the current (already world-updated) skeleton pose. */
export function updateAnchors(anchors: Anchor[], bones: Map<string, THREE.Bone>, scale: number): void {
  for (const an of anchors) {
    bones.get(an.bone)!.getWorldPosition(tmpA)
    if (an.to) {
      bones.get(an.to)!.getWorldPosition(tmpB)
      an.a.copy(tmpA).lerp(tmpB, an.from ?? 0)
      an.b.copy(tmpA).lerp(tmpB, an.until ?? 1)
    } else {
      an.a.copy(tmpA)
      an.b.copy(tmpA)
    }
    an.r = an.radius * scale
  }
}

export function updateFists(fists: Fist[], bones: Map<string, THREE.Bone>, scale: number, dt: number, reset = false): void {
  for (const f of fists) {
    f.prev.copy(f.pos)
    bones.get(`${f.hand}Hand`)!.getWorldPosition(tmpA)
    const knuckle = bones.get(`${f.hand}HandIndex1`)
    if (knuckle) knuckle.getWorldPosition(tmpB).sub(tmpA).multiplyScalar(FIST.along)
    else tmpB.set(0, 0, 0)
    f.pos.copy(tmpA).add(tmpB)
    if (reset) f.prev.copy(f.pos)
    f.speed = dt > 0 ? f.pos.distanceTo(f.prev) / dt : 0
    f.r = FIST.radius * scale
  }
}

/** Translucent capsules/spheres that visualise anchors; they live in world space, not on bones. */
export class AnchorOverlay {
  readonly group = new THREE.Group()
  private readonly items: { anchor?: Anchor; fist?: Fist; mesh: THREE.Mesh; base: THREE.Color; baseOpacity: number }[] = []

  constructor() {
    this.group.name = 'anchor-overlay'
    this.group.renderOrder = 10
  }

  add(anchors: Anchor[], fists: Fist[], color: THREE.ColorRepresentation, fistColor: THREE.ColorRepresentation): void {
    for (const an of anchors) {
      const length = an.a.distanceTo(an.b) / Math.max(an.r / an.radius, 1e-6)
      const geo = length > 1e-4 ? new THREE.CapsuleGeometry(an.radius, length, 2, 8) : new THREE.SphereGeometry(an.radius, 8, 6)
      const mesh = this.mesh(geo, color, 0.07)
      an.mesh = mesh
      this.items.push({ anchor: an, mesh, base: new THREE.Color(color), baseOpacity: 0.07 })
    }
    for (const f of fists) {
      const mesh = this.mesh(new THREE.SphereGeometry(FIST.radius, 10, 8), fistColor, 0.22)
      f.mesh = mesh
      this.items.push({ fist: f, mesh, base: new THREE.Color(fistColor), baseOpacity: 0.22 })
    }
  }

  private mesh(geo: THREE.BufferGeometry, color: THREE.ColorRepresentation, opacity: number): THREE.Mesh {
    const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false, toneMapped: false })
    const mesh = new THREE.Mesh(geo, mat)
    const wire = new THREE.LineSegments(new THREE.EdgesGeometry(geo, 25), new THREE.LineBasicMaterial({ color, transparent: true, opacity: Math.min(1, opacity * 3.5), depthWrite: false }))
    mesh.add(wire)
    mesh.renderOrder = 10
    this.group.add(mesh)
    return mesh
  }

  update(dt: number): void {
    if (!this.group.visible) return
    const up = new THREE.Vector3(0, 1, 0)
    const dir = new THREE.Vector3()
    for (const item of this.items) {
      const mat = item.mesh.material as THREE.MeshBasicMaterial
      if (item.anchor) {
        const an = item.anchor
        an.flash = Math.max(0, an.flash - dt * 3)
        item.mesh.position.copy(an.a).add(an.b).multiplyScalar(0.5)
        dir.subVectors(an.b, an.a)
        if (dir.lengthSq() > 1e-10) item.mesh.quaternion.setFromUnitVectors(up, dir.normalize())
        item.mesh.scale.setScalar(an.r / an.radius)
        mat.color.copy(item.base).lerp(WHITE, an.flash)
        mat.opacity = item.baseOpacity + an.flash * 0.7
      } else if (item.fist) {
        item.mesh.position.copy(item.fist.pos)
        item.mesh.scale.setScalar(item.fist.r / FIST.radius)
      }
    }
  }
}

const WHITE = new THREE.Color('#ffffff')
