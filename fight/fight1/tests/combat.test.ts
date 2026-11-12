import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { ContactTracker, segmentSegment, sweptSphereCapsule } from '../src/game/combat'
import { describeStrike, solveStrikeDistance } from '../src/game/reach'
import type { Anchor } from '../src/game/anchors'

const v = (x: number, y: number, z: number) => ({ x, y, z })

describe('segment geometry', () => {
  it('finds the closest points of crossing segments', () => {
    const r = segmentSegment(v(-1, 0, 0), v(1, 0, 0), v(0, -1, 0.5), v(0, 1, 0.5))
    expect(r.dist2).toBeCloseTo(0.25)
    expect(r.s).toBeCloseTo(0.5)
    expect(r.t).toBeCloseTo(0.5)
  })
  it('handles degenerate segments (sphere anchors and resting fists)', () => {
    expect(segmentSegment(v(0, 0, 0), v(0, 0, 0), v(3, 0, 0), v(3, 0, 0)).dist2).toBeCloseTo(9)
    expect(segmentSegment(v(0, 2, 0), v(0, 2, 0), v(0, 0, 0), v(0, 1, 0)).dist2).toBeCloseTo(1)
  })
  it('detects a fast fist that tunnels through a thin anchor within one step', () => {
    // Fist jumps from z=-1 to z=+1 in one step; a per-frame point test would miss the head at z=0.
    const hit = sweptSphereCapsule(v(0, 1.6, -1), v(0, 1.6, 1), 0.07, v(0, 1.55, 0), v(0, 1.7, 0), 0.1)
    expect(hit).not.toBeNull()
    expect(hit!.penetration).toBeCloseTo(0.17)
    expect(sweptSphereCapsule(v(0.5, 1.6, -1), v(0.5, 1.6, 1), 0.07, v(0, 1.55, 0), v(0, 1.7, 0), 0.1)).toBeNull()
  })
})

describe('ContactTracker', () => {
  it('fires once when contact begins, not every step of a continuous contact', () => {
    const t = new ContactTracker()
    const touch = [{ fist: 'black.L', anchor: 'red.Head', strikeId: 1 }]
    expect(t.update(touch)).toHaveLength(1)
    expect(t.update(touch)).toHaveLength(0)
    expect(t.update(touch)).toHaveLength(0)
  })
  it('allows one impact per fist per strike even across several anchors', () => {
    const t = new ContactTracker()
    expect(t.update([{ fist: 'black.L', anchor: 'red.Head', strikeId: 1 }, { fist: 'black.L', anchor: 'red.Neck', strikeId: 1 }])).toHaveLength(1)
    expect(t.update([{ fist: 'black.L', anchor: 'red.Spine2', strikeId: 1 }])).toHaveLength(0)
    // A new punch (new strike id) can land again after separating.
    t.update([])
    expect(t.update([{ fist: 'black.L', anchor: 'red.Head', strikeId: 2 }])).toHaveLength(1)
  })
  it('tracks both fists independently', () => {
    const t = new ContactTracker()
    const fired = t.update([{ fist: 'red.L', anchor: 'black.Head', strikeId: 4 }, { fist: 'red.R', anchor: 'black.Spine1', strikeId: 4 }])
    expect(fired.map(f => f.fist)).toEqual(['red.L', 'red.R'])
  })
})

describe('strike reach', () => {
  // Synthetic straight punch: the left fist starts 0.3 m ahead of the origin, peaks at 0.9 m.
  const times = Array.from({ length: 21 }, (_, i) => i * 0.05)
  const z = (t: number) => 0.3 + 0.6 * Math.sin(Math.min(1, t / 0.5) * Math.PI / 2) * (t <= 0.5 ? 1 : Math.max(0, 1 - (t - 0.5) * 2))
  const left = times.map(t => new THREE.Vector3(0.1, 1.5, z(t)))
  const right = times.map(() => new THREE.Vector3(-0.1, 1.4, 0.25))
  const strike = describeStrike('test', 1, times, left, right)

  it('describes the strike hand, peak and aim', () => {
    expect(strike.hand).toBe('Left')
    expect(strike.tPeak).toBeCloseTo(0.5)
    expect(strike.extension).toBeCloseTo(0.6, 1)
    // The peak sits 0.1 m to the side; the aim yaw turns it onto the forward line.
    expect(strike.aimYaw).toBeCloseTo(-Math.atan2(0.1, 0.9), 3)
    expect(strike.windowStart).toBeLessThan(strike.tPeak)
    expect(strike.windowEnd).toBeGreaterThan(strike.tPeak)
  })

  it('solves the farthest spacing at which the fist still lands on the head', () => {
    const target = new THREE.Vector3(2, 0, 0)
    const head: Anchor = { bone: 'Head', radius: 0.1, region: 'head', id: 'red.Head', a: new THREE.Vector3(1.95, 1.45, 0), b: new THREE.Vector3(1.95, 1.6, 0), r: 0.1, flash: 0 }
    const dir = new THREE.Vector3(1, 0, 0)
    const res = solveStrikeDistance(strike, [head], target, dir, strike.aimYaw, 1, 0.04, { min: 0.4, max: 2.5 })
    expect(res.hit).toBe(true)
    // Reach ≈ 0.905 m to the fist centre; head surface is 0.05 + 0.1 in front of the target origin.
    expect(res.distance).toBeGreaterThan(0.85)
    expect(res.distance).toBeLessThan(1.1)
    const tooFar = solveStrikeDistance(strike, [head], target, dir, strike.aimYaw, 1, 0.04, { min: 1.5, max: 2.5 })
    expect(tooFar.hit).toBe(false)
  })
})
