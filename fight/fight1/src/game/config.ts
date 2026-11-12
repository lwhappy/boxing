/**
 * All fight tuning in one place. Gameplay reads the mutable `CONFIG`; `DEFAULT_CONFIG` stays the
 * immutable source of truth for Tweak Reset and for the in-game "Reset" button.
 */
export const DEFAULT_CONFIG = {
  fight: {
    /** Playback speed of attack clips (1 = authored speed). */
    attackSpeed: 1.15,
    /** Cross-fade time between clips, seconds. */
    blend: 0.16,
    /** Speed while stepping into range or back to the home spot, m/s. */
    stepSpeed: 2.4,
    /** Fists must penetrate the target anchor by this much when the approach is solved, m. */
    reachDepth: 0.04,
    /** Fighters never get closer than this (origin to origin, at scale 1), m. */
    minSeparation: 0.5,
    /** Seconds a fighter waits after an action before walking back home. */
    returnDelay: 0.7,
    /** Knock-back applied to the victim of a clean hit, m. */
    knockback: 0.12,
  },
  robot: {
    /** Seconds between robot decisions. */
    thinkMin: 0.9,
    thinkMax: 2.2,
    /** Chance (0..1) that a decision is an attack rather than footwork. */
    aggression: 0.62,
    /** Chance (0..1) to chain a second attack. */
    combo: 0.3,
    /** Seconds the robot holds back after taking a clean hit. */
    hitCooldown: 0.8,
  },
  fx: {
    /** Freeze-frame on impact, seconds. */
    hitstop: 0.07,
    /** Camera shake strength on head/body hits. */
    shake: 0.06,
    /** Overall sound-effect volume 0..1. */
    volume: 0.85,
  },
  camera: {
    fov: 38,
    /** Extra distance added to the auto-framed camera, m. */
    distance: 0.6,
    height: 1.45,
  },
  /** Default fighter transforms (home spot on the ring, lateral offset, extra yaw, uniform scale). */
  black: { x: -0.7, z: 0, yaw: 0, scale: 1 },
  red: { x: 0.7, z: 0, yaw: 0, scale: 1 },
} as const

// Gameplay always reads active values here. Source defaults remain immutable for
// Tweak Reset and Save with Manus; Apply never writes source or local storage.
type MutableConfig<T> = { -readonly [K in keyof T]: T[K] extends number ? number : T[K] extends object ? MutableConfig<T[K]> : T[K] }
export type Config = MutableConfig<typeof DEFAULT_CONFIG>
export const CONFIG: Config = structuredClone(DEFAULT_CONFIG) as Config

export type Side = 'black' | 'red'
export type FighterTransform = Config['black']
