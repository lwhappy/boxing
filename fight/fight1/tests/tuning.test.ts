import { describe, expect, it } from 'vitest'
import { CONFIG, DEFAULT_CONFIG } from '../src/game/config'
import { tuning } from '../src/game/tuning'

describe('preview tuning', () => {
  it('exposes defaults that match the immutable config', () => {
    for (const c of tuning.controls) {
      const [section, key] = c.id.split('.') as [keyof typeof DEFAULT_CONFIG, string]
      expect((DEFAULT_CONFIG[section] as Record<string, number>)[key]).toBe(c.default)
      expect(c.default).toBeGreaterThanOrEqual(c.min)
      expect(c.default).toBeLessThanOrEqual(c.max)
    }
  })
  it('applies live values and rejects invalid patches atomically', () => {
    tuning.apply({ 'fight.attackSpeed': 1.5 })
    expect(CONFIG.fight.attackSpeed).toBe(1.5)
    expect(() => tuning.apply({ 'robot.thinkMin': 5, 'robot.thinkMax': 1 })).toThrow()
    expect(CONFIG.robot.thinkMin).toBe(DEFAULT_CONFIG.robot.thinkMin)
    expect(() => tuning.apply({ 'fight.nope': 1 })).toThrow()
    expect(() => tuning.apply({ 'fight.attackSpeed': 99 })).toThrow()
    tuning.apply({ 'fight.attackSpeed': DEFAULT_CONFIG.fight.attackSpeed })
  })
})
