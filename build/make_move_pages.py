"""
Rewire moves pages onto the shared cinematic move-stage show.

Surgical transform of each existing article page (all copy/SEO kept):
  1. inject the jab.html stage <style> block after the home.css link;
  2. replace the old home-stage markup block with the jab-style stage
     (.jab-canvas-box wrapper + docked Replay + big Replay/Close);
  3. replace the window.STAGE/home-stage.js footer with the page's
     window.MOVE_STAGE config + move-stage.js.

Usage: python3 build/make_move_pages.py
"""
import re

ROOT = "/Users/justrun/project/boxing-3"

# style block: copied verbatim from web/moves/jab.html (move-generic)
jab = open(f"{ROOT}/web/moves/jab.html").read()
style_block = re.search(r"<style>.*?</style>", jab, re.S).group(0)

# new stage markup (aria label substituted per page)
STAGE_TMPL = """      <!-- Left: 3D stage (fullscreen {label} show on load, then docks
           bottom-left). .jab-canvas-box keeps the render + callout overlay
           tied to the canvas area only, so the docked corner widget can
           reserve a bottom strip for its Replay button. -->
      <div class="stage hero-stage jab-stage jab-live" id="jab-stage" aria-label="3D demo of the {label}">
        <div class="jab-canvas-box">
          <canvas id="stage-canvas"></canvas>
        </div>
        <button type="button" class="jab-replay" id="jab-replay" hidden>↻ Replay</button>
        <div class="jab-actions" id="jab-actions">
          <button type="button" class="jab-action" id="jab-replay-big">↻ Replay</button>
          <button type="button" class="jab-action jab-action-close" id="jab-close">✕ Close</button>
        </div>
        <div class="stage-loading" id="stage-loading">
          <div class="ring"></div>
          <span id="stage-loading-text">Loading 3D model…</span>
        </div>
        <div class="stage-error" id="stage-error" hidden></div>
      </div>"""

PAGES = {
    "cross.html": {
        "label": "cross",
        "cfg": """window.MOVE_STAGE = {
  glb: '../media/glb/cross-woman.glb?v=1',
  move: 'cross',
  word: 'CROSS',
  probeBone: 'RightHand',
  straighten: 'Right',   // straight punch: unbend the rear arm at full reach
  callouts: [
    ['Rear fist', 'Travels a straight line across your body, snapping out from the chin.', 'RightHand', 'l', 13],
    ['Lead hand', 'Stays welded to your cheek while the shoulders square up for the landing.', 'LeftHand', 'r', 13],
    ['Rear hip', 'Turns through the punch — the power starts here, not in the arm.', 'Hips', 'l', 40],
    ['Rear foot', 'Pivots inward on the ball of the foot, opening the hip line.', 'RightFoot', 'r', 55],
    ['Lead leg', 'Stays braced and planted — no weight spills over the front toes.', 'LeftFoot', 'l', 69],
  ],
};""",
    },
    "rearhook.html": {
        "label": "rear hook",
        "cfg": """window.MOVE_STAGE = {
  glb: '../media/glb/rearhook-woman.glb?v=1',
  move: 'rearhook',
  word: 'REAR HOOK',
  probeBone: 'RightHand',
  straighten: null,      // the hook keeps its bend — no arm corrective
  callouts: [
    ['Rear fist', 'Swings on a level arc into the side of the jaw, knuckles leading.', 'RightHand', 'l', 13],
    ['Lead hand', 'Stays welded to the chin, covering you through the whole turn.', 'LeftHand', 'r', 13],
    ['Hips', 'The rear side whips through — the arm is just the delivery.', 'Hips', 'l', 40],
    ['Lead leg', 'Absorbs the rotation and keeps the base under you.', 'LeftFoot', 'l', 69],
    ['Rear foot', 'Pivots hard inward — the whole hook spins on this foot.', 'RightFoot', 'r', 55],
  ],
};""",
    },
    "leaduppercut.html": {
        "label": "lead uppercut",
        "cfg": """window.MOVE_STAGE = {
  glb: '../media/glb/leaduppercut-woman.glb?v=1',
  move: 'leaduppercut',
  word: 'UPPERCUT',
  probeBone: 'LeftHand',
  straighten: null,      // the uppercut keeps its bend — no arm corrective
  callouts: [
    ['Lead fist', 'Drops a few inches, then drives up under the guard into the chin.', 'LeftHand', 'l', 13],
    ['Rear hand', 'Never leaves the jaw — the uppercut is short and vertical.', 'RightHand', 'r', 13],
    ['Waist', 'A small upward hip pulse puts the body behind the shot.', 'Hips', 'l', 40],
    ['Lead leg', 'Bends first — the lift is built from the floor upward.', 'LeftFoot', 'l', 69],
    ['Rear leg', 'Stays loaded and planted, ready to chain the next punch.', 'RightFoot', 'r', 55],
  ],
};""",
    },
}

for fname, spec in PAGES.items():
    path = f"{ROOT}/web/moves/{fname}"
    html = open(path).read()
    orig = html

    # 1. style block after the home.css link
    css_link = '<link rel="stylesheet" href="../assets/home.css?v=11" />'
    assert css_link in html, f"{fname}: home.css link missing"
    if "<style>" not in html:
        html = html.replace(css_link, css_link + "\n" + style_block, 1)

    # 2. replace the old stage markup
    m = re.search(r"<!-- Left: 3D stage.*?aria-label=\"3D demo of the [^\"]+\">\s*"
                  r"<canvas id=\"stage-canvas\"></canvas>\s*"
                  r"<div class=\"stage-bar\"[^>]*></div>\s*"
                  r"(<div class=\"stage-loading\".*?id=\"stage-error\" hidden></div>\s*)</div>",
                  html, re.S)
    assert m, f"{fname}: stage block not matched"
    new_stage = STAGE_TMPL.format(label=spec["label"])
    # keep loading/error chunks from the original (identical markup)
    html = html[:m.start()] + new_stage + html[m.end():]

    # 3. replace the script footer
    m = re.search(r"<!-- Shared stage.*?<script type=\"module\" src=\"\.\./assets/home-stage\.js\?v=\d+\"></script>",
                  html, re.S)
    assert m, f"{fname}: footer scripts not matched"
    footer = f"""<!-- Shared cinematic stage: this page plays its own move, freezes on
     the reach frame, annotates, then docks bottom-left -->
<script type="importmap">
{{
  "imports": {{
    "three": "../vendor/three/three.module.min.js",
    "three/addons/": "../vendor/three/addons/"
  }}
}}
</script>
<script>
{spec['cfg']}
</script>
<script type="module" src="../assets/move-stage.js?v=1"></script>"""
    html = html[:m.start()] + footer + html[m.end():]

    assert html != orig
    open(path, "w").write(html)
    print(f"[ok] {fname}: style + stage + footer rewired")
