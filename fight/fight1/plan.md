# Dual Impact — implementation plan

## Product
A single-screen Three.js sparring game. The page contains only the 3D stage (top) and a control
bar of buttons below it. The black boxer (the `attack` rig in the supplied GLB) is player-driven;
the red boxer (the `defence` rig) is an automated robot opponent.

## Asset approach
- Source: user-supplied `all2.glb` (two skinned Mixamo-style rigs, 10 clips). No new models are
  generated. A web copy with 2048px WebP textures (`assets/models/fighters.glb`, 6.4 MB vs 40 MB) is
  registered through the managed asset lock and loaded from `/manus-storage/...` (local path in dev).
- Retargeting: GLTFLoader de-duplicates identical bone names, so `rig.ts` maps every node back to its
  original glTF name (`parser.associations`), renames bones to canonical names (`Hips`, `LeftHand`...)
  and rewrites every clip to canonical track names. Paired clips that animate both rigs keep one set.
  Every action is therefore playable by either fighter; tracks for bones a rig lacks are filtered.
- Normalisation: after posing the idle frame, each rig's forward vector is derived from its shoulders,
  a yaw pivot turns it to +Z, hips are centred and feet are put on the floor.

## Gameplay systems (src/game)
- `actions.ts`: catalog of all 10 clips as buttons (Idle, Guard, Jab, Cross, Cross II, Lead/Rear Hook,
  Lead/Rear Uppercut, Hit React) plus key bindings.
- `fighter.ts`: wrapper transform (home position, lateral offset, yaw offset, scale), mixer with
  cross-fades, state machine (idle → approach → acting → recover / hit), facing the opponent.
- `reach.ts`: pre-samples each clip's fist trajectories; before an attack the solver finds the
  farthest distance at which the strike path penetrates the opponent's head/torso anchors and the
  attacker steps/turns there first ("change transform before acting").
- `anchors.ts`: one anchor per bone (capsule bone→child, or sphere), region tags (head, body, arm,
  leg), plus fist anchors on both hands; optional visual overlay attached to bones.
- `combat.ts` (pure, unit-tested): swept fist-vs-capsule tests, enter-edge debounce (one event per
  fist per action), never tests a fighter against itself.
- `ai.ts`: robot footwork (forward/back/lateral), weighted attack choice, combos, counters, cooldown
  after being hit.
- `fx.ts`, `sfx.ts`: impact flash, shockwave ring, spark particles, body flash, camera shake,
  hit-stop; synthesized WebAudio punch/block/whoosh sounds.
- `arena.ts`: procedural boxing ring, lights, camera follow + limited orbit.
- `game.ts`: fixed-step orchestration. `ui/controls.ts`: action buttons, step buttons, robot toggle,
  anchor toggle, Adjust panel (position, lateral, rotation, scale per fighter + reset).

## Project structure
`src/engine` (loop, renderer, assets, audio — kept), `src/game` (above), `src/ui` (controls),
`src/styles/main.css`. Starter sky-island modules, physics, i18n, save, HUD/menus are removed.

## Design
Candidate styles: (1) Fight-night broadcast — ink black, impact yellow, hard edges (p=0.06);
(2) Retro arcade cabinet — CRT glow and pixel bevels (p=0.04); (3) Gym-chalk minimal — off-white,
pencil lines (p=0.03). Chosen: **Fight-night broadcast**.
- Movement: late-night boxing TV graphics. Principles: the ring is the hero; controls are tactile
  and dense; red vs. black identity everywhere; zero chrome beyond stage and buttons.
- Colour: near-black `#0b0b0f` surfaces, signature **Impact Yellow `#ffd23f`** for the player's
  buttons, ring rope red `#e2273a` for the robot, cool cyan for blocks.
- Layout: full-bleed stage over a slanted bottom control deck; buttons are skewed slabs grouped
  as Moves / Footwork / Setup. Adjust panel slides up inside the deck.
- Signature elements: skewed button slabs with a hard offset shadow; tiny key-cap hints.
- Interaction: buttons depress on press, lit border while the action is running.
- Animation: 120 ms button press, impact flashes 150–400 ms, camera shake decays in 250 ms.
- Typography: bundled ManusCC0 Bold, uppercase, tight tracking for labels.
- Brand: "A pocket fight night for poking at punch timing." — punchy, technical, playful.
  Voice examples: "Jab", "Rear Upper". Wordmark: italic DUAL / IMPACT split by a yellow slash
  (favicon: yellow slash fist mark on black).
