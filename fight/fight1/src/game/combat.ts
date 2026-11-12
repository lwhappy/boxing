/**
 * Pure collision helpers (no three.js scene access) so they can be unit tested.
 * Fists are swept spheres (previous → current position); body anchors are capsules
 * (segment a→b with radius r; a sphere is a capsule with a === b).
 */
export type Vec3 = { x: number; y: number; z: number }

const sub = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z })
const dot = (a: Vec3, b: Vec3) => a.x * b.x + a.y * b.y + a.z * b.z
const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v)

/**
 * Closest points between segments p1-q1 and p2-q2 (Ericson, Real-Time Collision Detection 5.1.9).
 * Returns squared distance and the parameters s (on segment 1) and t (on segment 2).
 */
export function segmentSegment(p1: Vec3, q1: Vec3, p2: Vec3, q2: Vec3): { dist2: number; s: number; t: number } {
  const d1 = sub(q1, p1)
  const d2 = sub(q2, p2)
  const r = sub(p1, p2)
  const a = dot(d1, d1)
  const e = dot(d2, d2)
  const f = dot(d2, r)
  const EPS = 1e-12
  let s: number
  let t: number
  if (a <= EPS && e <= EPS) {
    s = t = 0
  } else if (a <= EPS) {
    s = 0
    t = clamp01(f / e)
  } else {
    const c = dot(d1, r)
    if (e <= EPS) {
      t = 0
      s = clamp01(-c / a)
    } else {
      const b = dot(d1, d2)
      const denom = a * e - b * b
      s = denom > EPS ? clamp01((b * f - c * e) / denom) : 0
      t = (b * s + f) / e
      if (t < 0) {
        t = 0
        s = clamp01(-c / a)
      } else if (t > 1) {
        t = 1
        s = clamp01((b - c) / a)
      }
    }
  }
  const c1 = { x: p1.x + d1.x * s, y: p1.y + d1.y * s, z: p1.z + d1.z * s }
  const c2 = { x: p2.x + d2.x * t, y: p2.y + d2.y * t, z: p2.z + d2.z * t }
  const d = sub(c1, c2)
  return { dist2: dot(d, d), s, t }
}

export type Contact = { penetration: number; s: number; t: number }

/** Swept sphere (from→to, radius rf) against capsule (a→b, radius ra). Null when apart. */
export function sweptSphereCapsule(from: Vec3, to: Vec3, rf: number, a: Vec3, b: Vec3, ra: number): Contact | null {
  const { dist2, s, t } = segmentSegment(from, to, a, b)
  const reach = rf + ra
  if (dist2 > reach * reach) return null
  return { penetration: reach - Math.sqrt(dist2), s, t }
}

/**
 * Enter-edge debounce. A (fist, anchor) pair fires once when it starts touching, and only re-arms
 * after it has been separated. Additionally each fist fires at most once per action (`strikeId`),
 * so one punch produces one impact even if it brushes several anchors.
 */
export class ContactTracker {
  private touching = new Set<string>()
  private spent = new Set<string>()

  /** Call once per step with every pair currently overlapping; returns pairs that should fire. */
  update<T extends { fist: string; anchor: string; strikeId: number }>(overlaps: readonly T[]): T[] {
    const now = new Set<string>()
    const fired: T[] = []
    for (const o of overlaps) {
      const pair = `${o.fist}|${o.anchor}`
      now.add(pair)
      if (this.touching.has(pair)) continue
      const strike = `${o.fist}#${o.strikeId}`
      if (this.spent.has(strike)) continue
      this.spent.add(strike)
      fired.push(o)
    }
    this.touching = now
    if (this.spent.size > 256) this.spent = new Set([...this.spent].slice(-64))
    return fired
  }

  reset(): void {
    this.touching.clear()
    this.spent.clear()
  }
}
