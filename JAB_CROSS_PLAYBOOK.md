# Jab + Cross Page — Build Playbook

**How the "Jab + Cross" scene was built, how it behaves today, and the exact brief you can hand to another AI to reproduce it.**

Last updated: 2026-10-22 · Page: `web/index.html` · Asset: `resources/glb/2.glb`

---

## 1. What the page is (成品是什么)

A single-page 3D boxing demo. Two animated fighters face each other in a dark gym; the red fighter throws
combos at the black fighter, who blocks, winces and reels back. Every impact is synchronized — sound,
particle burst, floating text — to the exact animation frame where glove meets glove.

The page is a **scene player driven by data**, not hand-scripted animation: the `SCENES` config declares
what clips exist, when each hit happens, which anchor it lands on, and how the receiver reacts. The engine
does the rest.

### Two attack buttons in this scene

| Button | Red clip | Length | Impacts | Receiver reaction |
|---|---|---|---|---|
| **Hit Head** | `red-jab-cross` | 2.17 s (65f) | f15 jab → glove, f21 cross → glove | `black-low-block` (1.5×) at f15, then `black-backward` (1.4×) after the block finishes |
| **Hit Body** | `red-jab-cross-body` | 2.23 s | f21 right fist → stomach | `black-hit-stomach`, then back to idle |

Idle loop for the black fighter in this scene: `black-idle` only (no taunt).

---

## 2. Asset pipeline (Blender → glb)

1. **One armature per fighter**, animations exported as separate actions, all baked at 30 fps.
   *Blender frame `f` ↔ clip time `t = f / 30`* — this single identity is the backbone of every timing
   decision on the page.
2. **NLA**: each action that must ship is placed as its own NLA strip; export with
   *glTF → Animation mode = NLA Tracks* (or ACTIONS with manual frame ranges). Unused actions with
   `F` (fake user) were purged so the glb stays lean.
3. **Anchor empties** mark where a punch "lands". They are *children of bones*, so they travel with the
   body and the gloves:
   - `black-hit-glove-center` → child of `mixamorig:LeftHandIndex1` (the actual glove centre — this is
     the anchor both punches use)
   - `black-hit-head`, `black-hit-glove`, `back-hit-stomach` (child of `Hips`)
   > Hanging an anchor on the wrong bone is the #1 cause of "the punch hits her neck". A glove anchor
   > parented to the neck bone follows the *neck* animation, no matter where you saw it in the viewport.
4. Export → `resources/glb/2.glb`. Clip inventory after export:

| Clip | Duration | Role |
|---|---|---|
| `red-jab-cross` | 2.167 s | Hit Head combo |
| `red-jab-cross-body` | 2.233 s | Hit Body combo |
| `black-idle` | 2.233 s | receiver loop |
| `black-low-block` | 1.633 s | block reaction |
| `black-backward` | 0.833 s | knockback |
| `black-hit-stomach` | 1.433 s | body-shot reaction |

---

## 3. Page architecture (页面结构)

```
SCENES (data)                     ENGINE (behavior)
┌───────────────────────┐         ┌──────────────────────────────────────────┐
│ cross: {              │         │ loadScene(id) → GLTFLoader → split by name│
│   glb, blackCycle,    │  ────▶  │ buildChar() → mixer + actions + carrier    │
│   hits{clip:[...]},   │         │ tick(): mixer.update → hit detect → FX     │
│   blackPreSlide,      │         │ fireHit(): sound + FX + floater + react    │
│   attacks[...]        │         │ finished: chain queue / back to idle       │
└───────────────────────┘         └──────────────────────────────────────────┘
```

### 3.1 Scene config (data)

```js
cross: {
  label: 'Jab + Cross',
  glb: '../resources/glb/2.glb',
  blackCycle: ['black-idle'],                 // receiver idle loop
  hits: {                                     // keyed by ATTACKER clip name
    'red-jab-cross': [
      { t: 15/30, url: '...punch-impact.wav', gain: 0.85, shake: 0.012,
        anchor: 'black-hit-glove-center',
        label: 'BLOCK', tone: 'block',
        fx: { color: '#ffd9a0', size: 0.38, life: 0.4 },
        react: 'black-low-block', reactFade: 0, reactSpeed: 1.5 },

      { t: 21/30, url: '...punch-impact.wav', gain: 0.95, shake: 0.02,
        anchor: 'black-hit-glove-center',
        label: 'BLOCK', tone: 'block',
        fx: { color: '#ffd9a0', size: 0.45, life: 0.45 },
        react: 'black-backward', appendReact: true, reactFade: 0, reactSpeed: 1.4 }
    ],
    'red-jab-cross-body': [ /* f21 → back-hit-stomach, label HIT, react black-hit-stomach */ ]
  },
  blackPreSlide: { step: -0.017, dur: 0.2 },  // idle phase sync + sub-2cm micro nudge
  attacks: [ { id:'jab-cross-head', label:'Hit Head', clip:'red-jab-cross', brief:{...} },
             { id:'jab-cross-body', label:'Hit Body', clip:'red-jab-cross-body', brief:{...} } ]
}
```

**Hit object fields**

| Field | Meaning |
|---|---|
| `t` | clip time (seconds) where the punch connects = `frame / 30` |
| `anchor` | scene node name; FX, floater and shake all originate there |
| `url / gain` | impact sound (WebAudio buffer, unlocked by first user gesture) |
| `shake` | camera shake amplitude |
| `label / tone` | floating text: `BLOCK` (guard hit) or `HIT` (clean hit) |
| `fx` | particle burst color / size / life |
| `react` | reaction clip **or array** = chain (`['black-low-block','black-backward']`) |
| `reactFade` | cross-fade time into the reaction; `0` = hard cut, no perceived lag |
| `reactSpeed` | playback rate for the reaction (and queued chain segments) |
| `appendReact` | if the receiver is already reacting, **queue** the clip instead of interrupting |
| `push` | optional small receiver translation at the impact moment |
| `pauseAttacker` | freeze the attacker on the impact frame (used by the first page) |

### 3.2 Engine capabilities (what makes this feel right)

| Capability | Where | Why it matters |
|---|---|---|
| **Frame-accurate hit detection** | `tick()` compares `prevTime < t <= now` per action | a hit fires on the exact frame, never "somewhere after the animation" |
| **Anchor-driven FX** | `triggerFX`, `showFloater`, `spawnImpact` | particles/debris align with the glove because the anchor lives on a bone |
| **Two audio layers** | `playHit` + `triggerShake` | punch buffer + camera shake = weight |
| **Receiver state machine** | `blackState { mode, index, reactQueue }` | idle loop ⇄ reaction, with a queue for chains |
| **Chain queue** | `finished` handler shifts `reactQueue` | low-block → backward plays back-to-back without extra code |
| **Append mode** | `reactBlack(clip, { append: true })` | a second impact can *wait its turn* instead of cutting the block short |
| **Fade / speed control** | `reactFade`, `reactSpeed` | kill perceived input lag (fade 0), tune reaction tempo (1.4–1.5×) |
| **Carrier group** | `key + 'PushCarrier'` wraps each rig | lets the engine translate a fighter without touching baked clips |
| **Idle-phase sync** | `blackPreSlide` sets `black-idle.time` before the punch | makes contact geometry reproducible every single round |
| **Scene switching** | `loadScene(id)` + `disposeScene()` | tabs swap glb, camera fit, attack bar and copy |
| **Test hook** | `window.__app` | headless CDP probes read live state instead of guessing |

---

## 4. The craft: contact calibration (最核心的技术动作)

The hard part is not "play a clip"; it is **making the glove visibly touch the other glove**. The pipeline
that solves it, repeatable for any new punch:

1. **Find the hand bone.** `mixamorigLeftHand_1` / `mixamorigRightHand_1` on the attacker.
2. **Sample every frame.** For `f = 0..N`, set `action.time = f/30`, force `scene.updateMatrixWorld(true)`,
   and record `hand.getWorldPosition()` vs `anchor.getWorldPosition()` → distance + dx/dy/dz per frame.
   → yields the *closest frame* and *how far off it is*.
3. **Reproduce the receiver pose.** A punch is only "aligned" for one receiver pose. Freeze the receiver
   in the exact clip+phase it will be in at that moment (`black-idle @ 0.4`, `black-low-block @ 0.3`,
   `black-backward @ 0.3` …) before measuring.
4. **Grid scan when two variables interact.** For the second punch the variables are *receiver block phase*
   × *attacker hit frame*. Scanning 5 phases × 13 frames (65 combinations) found the optimum in one run:
   `low-block @ 0.3s` + `hit at f21` → **0.059 m** (was 0.19 m).
5. **Convert the optimum back into config.** Block phase 0.3 s at 0.2 s after the first hit ⇒
   `reactSpeed = 1.5`; hit frame 21 ⇒ `t: 21/30`.
6. **Fix residual drift.** Repetition drifts because `black-idle` starts at a random phase each round.
   `blackPreSlide` snaps `black-idle.time` to the calibrated phase and applies a sub-2 cm x-offset, so
   round 1 and round 10 give identical contact.
7. **Verify in the real runtime**, not just in the frozen measurement: sample with `requestAnimationFrame`
   at the live hit instant and assert the distance is small (< 0.08 m reads as contact at this scale).

Typical accepted results on this page: **f15 0.054 m**, **f21 0.059 m** (glove radius ≈ 0.06 m).

---

## 5. Iteration history (why today's page looks the way it does)

Each row is a real requirement change and the structural consequence. The lesson: **timing lives in data,
so a change of mind is a config edit — as long as the engine has the right primitives.**

| # | Request | Change made |
|---|---|---|
| 1 | Build the Jab+Cross page: load `2.glb`, idle, one button, play combo, FX at f14/f20, receiver knocked back, both freeze | `SCENES.cross` + `hits` table + `pauseAttacker` + `holdOnFinish` |
| 2 | Don't reset between clicks — keep pushing her left | engine-side translation via `carrier` + `pushTween` (the clip turned out to be in-place: root x never moves) |
| 3 | Attacker loops 0→20 and steps forward with her | `advanceCombo`, wrap `act.time = 0` at the impact frame |
| 4 | Only two rounds, then stop at frame 38 | `{loops:2, stopAt:38/30}` |
| 5 | One round; both step left | `loops: 1` |
| 6 | Step in *before* punching, not during | pre-punch `pushTween` with `onDone → playOnce` |
| 7 | First round: no step in | `st.round` counter gates the pre-step |
| 8 | Play the whole clip; step at frame 38 | `advanceCombo { moveAt: 38/30 }` |
| 9 | Scrap translation, back to idle, both hits show `BLOCK` | deleted all translation config; reaction returns to idle |
| 10 | Nudge her back after the first punch so the longer cross can reach | measured the real reach first: **both punches were short**, so it became a forward nudge |
| 11 | Both punches must hit `black-hit-glove-center` | re-parented the anchor to the index-finger bone; recalibrated (0.148 / 0.052 → 0.055 / 0.062) |
| 12 | Second punch: `black-low-block` then `black-backward` | chain array + queue in the `finished` handler |
| 13 | Backward should start on the *first* punch | f15 react → `black-backward` |
| 14 | Rename button to *Hit Head*, add *Hit Body* | second attack entry + `red-jab-cross-body` + `back-hit-stomach` |
| 15 | Body hit shows `HIT`, not `BLOCK` | `label/tone` change only |
| 16 | Backward starts late and too slow | `reactFade: 0` (same-frame switch) + `reactSpeed: 1.4` |
| 17 | low-block should start on the first punch | f15 react → chain `['black-low-block','black-backward']` |
| 18 | First punch must not look like it hits her head | grid scan → block at 1.5× + second hit moved f24 → f21 (0.19 → 0.059) |
| 19 | Don't cut the block: play it, *then* backward | new `appendReact`: queue instead of interrupt |

---

## 6. Verification loop (how each change was proven)

1. `python3 -m http.server 8123 --bind 127.0.0.1` (project root) and headless Chrome with
   `--headless=new --enable-unsafe-swiftshader --remote-debugging-port=9222`.
2. A CDP script (`build/cdp_page.mjs`) opens the page, executes a `probe.js` snippet and screenshots.
3. Probes read real state through `window.__app` (chars, actions, mixer times, audio log, DOM floaters) and
   assert *numbers*, e.g. `redTime == 1.267`, `blackX` delta `-0.18`, `hits.length == 2`, floater text `HIT`.
4. Screenshot at the exact impact frame to confirm the visual, not just the numbers.

Non-obvious pitfalls worth remembering:

- Multi-page probes must read `window.__app` **fresh** after a scene switch; the old object keeps a stale `sceneId`.
- `THREE` is not global inside probe snippets — use numeric constants (`LoopOnce = 2200`).
- A probe that clicks the next round too early measures a receiver still mid-reaction → phantom contact error.
- Never append to a log with `open(p,'a').write(old + new)` — that doubles the file every run. (This repo's
  README hit 5.4 GB that way and had to be rebuilt by de-duplicating headings.)

---

## 7. The brief — what I would tell an AI to build this page

> Copy everything below into a single prompt. It is self-contained: assets, schema, behaviors,
> calibration procedure, acceptance tests.

---

### Role

You are building one scene of an existing 3D boxing web demo. Work inside the existing single-file page
`web/index.html` (three.js via importmap) and the existing `SCENES` config pattern. Do not introduce a
framework, a build step, or new dependencies.

### Assets (already produced in Blender, exported to `resources/glb/2.glb`)

- Attacker "red": `red-jab-cross` (2.17 s), `red-jab-cross-body` (2.23 s) — includes both fighters in one glb,
  split at load time into `chars.red` / `chars.black` by node naming.
- Receiver "black": `black-idle` (2.23 s loop), `black-low-block` (1.63 s), `black-backward` (0.83 s),
  `black-hit-stomach` (1.43 s).
- Anchor empties (children of bones, so they follow the body): `black-hit-glove-center`
  (parent `mixamorig:LeftHandIndex1`), `black-hit-head`, `black-hit-glove`, `back-hit-stomach`.
- All clips are baked at **30 fps**, so **Blender frame `f` = clip time `f/30`**.

### Deliverable

A `cross` scene reachable from a tab labelled **Jab + Cross**:

1. Switching to the tab loads `2.glb`, shows both fighters in idle, keeps the same camera framing, lighting,
   UI chrome and effect style as the existing first scene.
2. Two attack buttons at the top, styled like existing ones: **Hit Head** and **Hit Body**.
   The right-hand description card updates with the selected attack (title, Chinese subtitle, meta rows and
   three text sections: Action / Usage / Features).
3. Clicking a button plays the attacker's clip once, then returns to idle. The receiver never moves on screen
   (no translation) — reactions are pure animation, and both fighters return to idle when the reaction chain ends.

### Behavior spec (frame-accurate)

**Hit Head** — `red-jab-cross`:

- `f15` = 0.500 s: jab connects.
  - impact sound (`resources/audio/punch-impact.wav`, gain 0.85), camera shake 0.012,
  - particle burst + floating text `BLOCK` at anchor `black-hit-glove-center`,
  - receiver starts `black-low-block` **on that same frame**: `reactFade 0` (hard cut, no blend) and
  `reactSpeed 1.5`.
- `f21` = 0.700 s: cross connects.
  - impact sound (gain 0.95), shake 0.02, burst + `BLOCK` at the same anchor,
  - receiver must **not** be interrupted: queue `black-backward` (`appendReact: true`), so the block finishes
    its 1.09 s wall-clock run first, then `black-backward` plays at `reactSpeed 1.4`, then idle.
- Attacker plays the full clip and returns to idle; the receiver returns to idle after the chain (~2.2 s total).

**Hit Body** — `red-jab-cross-body`:

- `f21`: right fist into the stomach.
  - impact sound (gain 0.95), shake 0.02, burst + floating text **`HIT`** (not `BLOCK`) at `back-hit-stomach`,
  - receiver plays `black-hit-stomach`, then idle.

### Engineering requirements

- Data-driven: every timing, anchor, sound, FX and reaction lives in the scene config; the engine has no
  clip-name literals.
- Hit detection: per action, compare the previous and current clip time each frame — fire the hit when
  `prev < t <= now`, exactly once. Reset the cached time on every action switch.
- Attacker playback: `LoopOnce` + `clampWhenFinished`; on `finished`, if the clip belongs to an attack, fade
  back to idle.
- Receiver: a small state machine `{ mode: 'cycle' | 'react', index, reactQueue, reactFade, reactSpeed }`.
  On reaction finish: if the queue is non-empty, shift and play the next segment **with the stored fade/speed**;
  otherwise return to the idle loop.
- `reactBlack(clip, { fade, speed, append })`: `append` = if the receiver is mid-reaction, only push the clip
  onto the queue; never restart or cut the current action.
- Contact calibration is mandatory, not optional — see next section. Ship only measurements, not guesses.

### Calibration procedure (must be done, must be reported)

1. For each punch, sample `f = 0..N` and record the glove bone's world position vs the target anchor
   (distance plus dx/dy/dz), with the receiver frozen in the pose it will really be in at that moment
   (idle phase, block phase, knockback phase).
2. Pick the hit frame with the smallest distance. If it exceeds ~0.08 m, adjust the system — never accept a
   visible gap. Adjustable knobs, in order of preference:
   (a) the receiver's reaction clip phase at contact, driven by `reactSpeed`;
   (b) the hit frame `t`;
   (c) a tiny `blackPreSlide` x-offset.
3. When two knobs interact, run a **grid scan** (receiver phase × hit frame) and take the global minimum
   instead of iterating by eye.
4. Make it reproducible: before each attack, snap the receiver's idle phase to the calibrated value,
   otherwise the contact drifts round to round.

### Acceptance tests (run them, paste the numbers)

1. Buttons render with the labels `Hit Head` / `Hit Body`; clicking each selects its description card.
2. Hit Head: exactly 2 impact sounds per round; live contact distance at f15 and f21 both < 0.08 m.
3. Hit Head: the receiver's clip order is `black-idle → black-low-block → black-backward → black-idle`,
   with `black-low-block` starting within one rendered frame of the f15 impact and running its full length
   before `black-backward`.
4. Hit Body: exactly 1 impact, floater text is `HIT`, receiver plays `black-hit-stomach`, both fighters end
   in idle.
5. Two consecutive rounds give the same contact distances (±0.01 m) — reproducibility proof.
6. No console errors; screenshots at both impact frames show glove-to-glove / glove-to-body contact.

### Don'ts

- Don't fake hits with timers — bind them to clip time.
- Don't translate a fighter to "make it look right" before checking whether the punch is short or long;
  measure first (this scene's punches were *short*, not long).
- Don't parent anchors to the wrong bone (a glove anchor on the neck bone will always look like a miss).
- Don't cut a block/reaction short unless asked — queue instead.
- Don't add camera cuts, motion blur or post-processing; match the existing scene's visual language.

---

## 8. One-paragraph version (TL;DR)

The page is a data-driven scene player: `2.glb` provides two rigs, one combo clip per button, and four
reaction clips; bone-parented anchor empties mark where punches land; `SCENES.cross.hits` maps *clip time →
impact event* (sound + particle burst + floating text + receiver reaction + playback speed/fade/queueing);
a per-frame hit detector fires those events at exactly `frame/30`; and every impact position was solved by
sampling bone-to-anchor distances frame by frame, then grid-scanning receiver pose against hit frame until
contact sat inside the glove radius (0.05–0.06 m). Iteration stayed cheap because all timing and reaction
logic is config, not code.
