import { CONFIG, DEFAULT_CONFIG } from './config'

/**
 * Preview Tweak catalog. Every control is LIVE: fighters read CONFIG on their next step/action.
 * Fighter transforms are not exposed here because the in-game Adjust panel owns them.
 */
type Mode = 'LIVE'
type Section = 'fight' | 'robot' | 'fx' | 'camera'
type Control = { id: string; type: 'number'; category: string; label: string; description: string; unit: string;
  default: number; min: number; max: number; step: number; applyMode: Mode; integrity: 'COSMETIC' | 'GAMEPLAY' }
type Binding = { control: Control; read(): number; write(value: number): void }

const CATEGORY: Record<Section, string> = { fight: 'Fight', robot: 'Robot', fx: 'Impact', camera: 'Camera' }
const bindings: Binding[] = []
function number<S extends Section>(section: S, key: keyof typeof CONFIG[S] & string,
  label: string, min: number, max: number, step: number, unit: string): void {
  const values = CONFIG[section] as Record<string, number>
  const defaults = DEFAULT_CONFIG[section] as Record<string, number>
  bindings.push({ control: Object.freeze({ id: `${section}.${key}`, type: 'number', category: CATEGORY[section],
    label, description: 'Updates this preview immediately.',
    unit, default: defaults[key], min, max, step, applyMode: 'LIVE',
    integrity: section === 'camera' || section === 'fx' ? 'COSMETIC' : 'GAMEPLAY' }),
    read: () => values[key], write: value => { values[key] = value } })
}
number('fight', 'attackSpeed', 'Punch speed', 0.5, 2, 0.05, '×')
number('fight', 'blend', 'Animation blend', 0.04, 0.4, 0.02, 's')
number('fight', 'stepSpeed', 'Step speed', 0.6, 5, 0.1, 'm/s')
number('fight', 'reachDepth', 'Punch depth', 0, 0.12, 0.01, 'm')
number('fight', 'knockback', 'Knock-back', 0, 0.4, 0.02, 'm')
number('robot', 'aggression', 'Robot aggression', 0, 1, 0.05, '')
number('robot', 'thinkMin', 'Robot min delay', 0.2, 4, 0.1, 's')
number('robot', 'thinkMax', 'Robot max delay', 0.2, 6, 0.1, 's')
number('robot', 'combo', 'Robot combo chance', 0, 1, 0.05, '')
number('fx', 'hitstop', 'Hit-stop', 0, 0.2, 0.01, 's')
number('fx', 'shake', 'Camera shake', 0, 0.2, 0.01, '')
number('fx', 'volume', 'Volume', 0, 1, 0.05, '')
number('camera', 'fov', 'Field of view', 25, 70, 1, '°')
number('camera', 'distance', 'Camera distance', -1, 4, 0.1, 'm')

const byId = new Map(bindings.map(binding => [binding.control.id, binding]))
let requested = Object.fromEntries(bindings.map(({ control }) => [control.id, control.default]))
const valid = (values: Record<string, number>) => values['robot.thinkMin'] <= values['robot.thinkMax']

export const tuning = {
  controls: Object.freeze(bindings.map(binding => binding.control)),
  read() {
    return { requested: { ...requested }, active: Object.fromEntries(bindings.map(binding => [binding.control.id, binding.read()])) }
  },
  apply(patch: unknown): void {
    if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw new Error('Invalid patch')
    const entries = Object.entries(patch)
    if (entries.length > bindings.length) throw new Error('Invalid patch')
    for (const [id, value] of entries) {
      const control = byId.get(id)?.control
      if (!control || typeof value !== 'number' || !Number.isFinite(value) || value < control.min || value > control.max) throw new Error('Invalid value')
      const steps = (value - control.min) / control.step
      if (value !== control.default && Math.abs(steps - Math.round(steps)) > 1e-7) throw new Error('Invalid increment')
    }
    const candidate = { ...requested, ...patch } as Record<string, number>
    if (!valid(candidate)) throw new Error('Robot min delay must not exceed max delay')
    // All writes are simple assignments, synchronously committed before the next
    // simulation/render callback. No engine callbacks run during this transaction.
    requested = candidate
    for (const [id, value] of entries) byId.get(id)!.write(value)
  },
}
