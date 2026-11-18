export type ActionKind = 'stance' | 'attack' | 'react'

export type ActionDef = {
  id: string
  /** Animation clip name inside the GLB. */
  clip: string
  label: string
  kind: ActionKind
  /** Keyboard shortcut (KeyboardEvent.code). */
  key: string
  keyLabel: string
}

/** Every clip in the supplied GLB, in button order. PC keys: U I O P (upper row) / J K L (lower row). */
export const ACTIONS: readonly ActionDef[] = [
  { id: 'idle', clip: 'defence-idle', label: 'Idle', kind: 'stance', key: 'KeyQ', keyLabel: 'Q' },
  { id: 'guard', clip: 'attack-idle', label: 'Guard', kind: 'stance', key: 'KeyE', keyLabel: 'E' },
  { id: 'jab', clip: 'attack-jab', label: 'Jab', kind: 'attack', key: 'KeyU', keyLabel: 'U' },
  { id: 'cross', clip: 'attack-cross', label: 'Cross', kind: 'attack', key: 'KeyI', keyLabel: 'I' },
  { id: 'cross2', clip: 'attack-cross2', label: 'Cross II', kind: 'attack', key: 'KeyO', keyLabel: 'O' },
  { id: 'leadHook', clip: 'attack-lead-hook', label: 'Lead Hook', kind: 'attack', key: 'KeyP', keyLabel: 'P' },
  { id: 'rearHook', clip: 'attack-rear-hook2', label: 'Rear Hook', kind: 'attack', key: 'KeyJ', keyLabel: 'J' },
  { id: 'leadUpper', clip: 'attack-lead-uppercut', label: 'Lead Upper', kind: 'attack', key: 'KeyK', keyLabel: 'K' },
  { id: 'rearUpper', clip: 'attack-rear-uppercut', label: 'Rear Upper', kind: 'attack', key: 'KeyL', keyLabel: 'L' },
  // Played automatically when a fighter is hit; not shown in the button menu.
  { id: 'hit', clip: 'defence-hit', label: 'Hit React', kind: 'react', key: '', keyLabel: '' },
]

export const ACTION_BY_ID = new Map(ACTIONS.map(a => [a.id, a]))
/** Actions shown as buttons (and bound to keys) for the player. */
export const MENU_ACTIONS = ACTIONS.filter(a => a.kind !== 'react')
export const ATTACKS = ACTIONS.filter(a => a.kind === 'attack')
