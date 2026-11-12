# TODO

- [x] **Stage with both characters from the GLB** — render the black one and the red one from
  `all2.glb` on a 3D stage; all actions come from the GLB clips; both fighters stay visible and face
  each other with safe default spacing.
- [x] **Only stage and buttons** — the page shows only the stage and the buttons below it; no header,
  menus, HUD or explanatory panels; usable on desktop and touch screens.
- [x] **All actions as buttons for the black one** — every GLB action is a button below the stage;
  the black one does actions by user input, with smooth transitions and readable timing.
- [x] **Red robot** — the red one moves and plays actions automatically against the black one,
  including hit reactions.
- [x] **Transform before acting** — before playing an attack the fighter changes its transform
  (moves/turns) so its fist can reach and hit the opponent; the user can also tune position,
  rotation and scale of each fighter and restore defaults.
- [x] **Bone anchors** — anchors on the body, each bone can bind an anchor; anchors can be shown.
- [x] **Hit feedback** — whenever a fist touches an opponent anchor: play the hit sound and show
  the special effect; no self-hits; no repeated triggers for one continuous contact.
- [ ] **Delivery** — favicon/sharing metadata, build passes, checkpoint saved.
