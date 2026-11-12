import * as THREE from 'three'
import { sweptSphereCapsule } from './combat'
import { FIST, type Anchor } from './anchors'

/**
 * Fist trajectory of one clip in the fighter's own frame (origin on the floor between the feet,
 * facing +Z, scale 1). Pre-sampled once so that approach distances can be solved instantly.
 */
export type Strike = {
  clip: string
  duration: number
  /** Time (clip seconds) of the strike fist's furthest forward extension. */
  tPeak: number
  hand: 'Left' | 'Right'
  /** Clip-time window in which fist contacts count as punches. */
  windowStart: number
  windowEnd: number
  /** Samples for both fists. */
  times: number[]
  left: THREE.Vector3[]
  right: THREE.Vector3[]
  /** Forward reach gained over the idle guard, m. */
  extension: number
  /**
   * Extra yaw (radians) that puts the strike fist's peak on the fighter's forward line. Boxers stand
   * bladed, so without it straight punches pass beside the opponent's head.
   */
  aimYaw: number
}

export const SAMPLE_HZ = 40

/** Build a strike description from per-sample fist positions (pure; unit tested). */
export function describeStrike(clip: string, duration: number, times: number[], left: THREE.Vector3[], right: THREE.Vector3[]): Strike {
  let best = -Infinity
  let tPeak = 0
  let hand: 'Left' | 'Right' = 'Left'
  for (let i = 0; i < times.length; i += 1) {
    if (left[i].z > best) { best = left[i].z; tPeak = times[i]; hand = 'Left' }
    if (right[i].z > best) { best = right[i].z; tPeak = times[i]; hand = 'Right' }
  }
  const base = Math.max(left[0].z, right[0].z)
  // Count contacts from the start of the drive (fist travelling forward) until shortly after the peak.
  const track = hand === 'Left' ? left : right
  const threshold = track[0].z + (best - track[0].z) * 0.25
  let windowStart = tPeak
  for (let i = times.indexOf(tPeak); i >= 0; i -= 1) {
    if (track[i].z < threshold) break
    windowStart = times[i]
  }
  windowStart = Math.max(0, windowStart - 0.08)
  const windowEnd = Math.min(duration, tPeak + 0.22)
  const peak = track[times.indexOf(tPeak)]
  const aimYaw = -Math.atan2(peak.x, Math.max(peak.z, 1e-3))
  return { clip, duration, tPeak, hand, windowStart, windowEnd, times, left, right, extension: best - base, aimYaw }
}

export type Placement = { origin: THREE.Vector3; yaw: number; scale: number }

const tmp = new THREE.Vector3()
const tmpPrev = new THREE.Vector3()
const fistWorld = (out: THREE.Vector3, local: THREE.Vector3, p: Placement) =>
  out.copy(local).multiplyScalar(p.scale).applyAxisAngle(UP, p.yaw).add(p.origin)
const UP = new THREE.Vector3(0, 1, 0)

/**
 * Largest origin-to-origin distance (along `dir`, from the attacker toward `target`) at which the
 * strike fist path penetrates one of `anchors` by at least `depth`. Searching from far to near
 * finds the spacing where the punch just lands instead of burying the fist inside the opponent.
 * `anchors` are the opponent's current world anchors; `target` is the opponent origin.
 */
export function solveStrikeDistance(strike: Strike, anchors: readonly Anchor[], target: THREE.Vector3, dir: THREE.Vector3,
  yawOffset: number, scale: number, depth: number, range: { min: number; max: number }): { distance: number; hit: boolean } {
  const yaw = Math.atan2(dir.x, dir.z) + yawOffset
  const track = strike.hand === 'Left' ? strike.left : strike.right
  const placement: Placement = { origin: new THREE.Vector3(), yaw, scale }
  const first = strike.times.findIndex(t => t >= strike.windowStart)
  const last = strike.times.findIndex(t => t > strike.windowEnd)
  const end = last < 0 ? strike.times.length : last
  const rf = FIST.radius * scale
  const lands = (d: number): number => {
    placement.origin.copy(target).addScaledVector(dir, -d).setY(0)
    let deepest = -Infinity
    for (let i = Math.max(1, first); i < end; i += 1) {
      fistWorld(tmpPrev, track[i - 1], placement)
      fistWorld(tmp, track[i], placement)
      for (const an of anchors) {
        const c = sweptSphereCapsule(tmpPrev, tmp, rf, an.a, an.b, an.r)
        if (c && c.penetration > deepest) deepest = c.penetration
      }
    }
    return deepest
  }
  let bestGap = -Infinity
  let bestD = range.min
  for (let d = range.max; d >= range.min; d -= 0.02) {
    const pen = lands(d)
    if (pen >= depth) {
      // Refine between this step and the previous (non-landing) one.
      let lo = d
      let hi = Math.min(range.max, d + 0.02)
      for (let k = 0; k < 5; k += 1) {
        const mid = (lo + hi) / 2
        if (lands(mid) >= depth) lo = mid
        else hi = mid
      }
      return { distance: lo, hit: true }
    }
    if (pen > bestGap) { bestGap = pen; bestD = d }
  }
  return { distance: bestD, hit: false }
}
