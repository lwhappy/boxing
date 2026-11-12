# Dual Impact (three.js)

A browser 3D boxing sparring duel built from the supplied `all2.glb`. The page shows only the stage
and the control deck beneath it. The player controls the black fighter (GLB node `attack`) with
the action buttons; the red fighter (GLB node `defence`) is an automated robot.

```bash
pnpm dev      # PORT/HOST from the environment
pnpm build    # typecheck + production build + budgets + sharing metadata
pnpm test     # unit tests (collision, hit debounce, reach solver, tuning, loop)
pnpm smoke    # after build: headless duel, button presses, hit checks, screenshots in shots/
```

## How it works

| Path | Role |
| --- | --- |
| `src/game/rig.ts` | Splits the two skinned characters out of the GLB, renames `mixamorig:*` bones to canonical names and retargets all 10 clips so any clip drives either fighter. |
| `src/game/fighter.ts` | Normalises each model (1.75 m, faces +Z, feet on the floor), cross-fades clips, faces the opponent, auto-reach approach, hit reactions, strike windows. |
| `src/game/reach.ts` | Samples each attack's fist path once; before an attack the fighter turns by the strike's aim yaw and steps to the farthest spacing where the path still lands on head/torso anchors. |
| `src/game/anchors.ts` | One anchor per bone (capsule to its child bone or sphere), with head/body/arm/leg regions, plus fist anchors; optional translucent overlay. |
| `src/game/combat.ts` | Pure swept-sphere vs capsule tests and the contact tracker (fires on contact start only, one impact per fist per strike). Opponent anchors only, so no self-hits. |
| `src/game/ai.ts` | Robot footwork, weighted attack choice, combos, counters and back-off after being hit. |
| `src/game/fx.ts`, `src/game/sfx.ts` | Impact flash, starburst, shockwave rings, spark streaks; synthesized punch/block/whoosh sounds. |
| `src/game/arena.ts`, `src/game/camera.ts` | Procedural ring and lights; auto-framing side camera (drag to orbit, wheel/pinch zoom, double-click reset). |
| `src/game/config.ts`, `src/game/tuning.ts` | All tuning values and the Preview Tweak catalog. |
| `src/ui/controls.ts` | Action buttons, footwork, Robot / Auto Reach / Anchors toggles and the Adjust panel (position, side, rotation, scale per fighter, Reset). |

Keyboard: `Q` Idle (`defence-idle`), `E` Guard (`attack-idle`), `1`–`7` attacks, `←/→` (or `A/D`) step.
Hit React (`defence-hit`) plays automatically when a fighter is hit and has no button.

The runtime model is loaded from its registered Storage address in `src/game/assetTable.ts`
(`assets/models/fighters.glb` is the editable source copy with 2048 px WebP textures).
