#!/usr/bin/env python3
"""Generate the six move pages (jab / cross / hooks / uppercuts).

Every page shares one template:
  - layout: 3D stage on the left, technique text on the right (home.css hero-grid;
    stacks to "animation on top, text below" below 980px)
  - player: assets/home-stage.js reads window.STAGE and auto-plays this move's
    clip from index.glb, then returns to idle; a single Replay button + slow-mo
  - SEO: title / description / canonical / OG / JSON-LD, prev-next pager

Usage:  python3 gen_move_pages.py   (writes into web/)
"""
import pathlib
import textwrap

WEB = pathlib.Path(__file__).resolve().parent.parent / "web"

MOVES = [
    dict(
        file="jab.html", clip="jab", name="Jab", num="1", hand="Lead hand",
        tagline="The fastest punch in boxing: lead hand, straight line, back to the chin before the opponent sees it.",
        chips=["Punch #1", "Lead hand", "Long range", "Starts every combo"],
        sections=[
            ("Action", "Start from your stance with the lead foot forward and the weight even on both legs. From the guard the lead fist travels in a straight line from your shoulder to the target: the elbow stays directly under the fist, the rear hand stays glued to the chin, the chin tucks behind the lead shoulder and the rear shoulder is slightly higher than the lead one. The fist snaps back along the same path the instant it lands — it should return faster than it went out. No wind-up, almost no hip turn."),
            ("When to use", "The measuring stick of boxing: throw it to read distance, to occupy the opponent's eyes, to interrupt their rhythm, to make them flinch, and to pull the guard open so the rear hand has a gap to shoot through. Also the safest way to keep a taller opponent from walking in."),
            ("Advantages", "The shortest travel time of any punch, so it is the hardest to see and the cheapest to recover from. It keeps you balanced and in stance, it can be thrown while moving in any direction, and it is the entry point of almost every combination. A fast jab wins rounds on its own because it scores without exposing you."),
            ("Limits", "Power is low by design — it does not stop a pressure fighter who is willing to eat it, and judges rarely reward it as a damaging blow. If it is thrown lazy with the hand dropping on the way back, it hands the opponent a free counter over the top; if the lead shoulder stays low, the chin is exposed behind it."),
        ],
    ),
    dict(
        file="cross.html", clip="cross", name="Cross", num="2", hand="Rear hand",
        tagline="The rear-hand straight — the first power punch you learn, driven from the floor through the hip.",
        chips=["Punch #2", "Rear hand", "Power shot", "The “2” in the 1-2"],
        sections=[
            ("Action", "From the guard, push off the ball of the rear foot and let that foot pivot inward. The rear hip turns through, the rear shoulder comes around, and the rear fist travels on a straight line across your body, just past your own chin — that crossing line is what gives the punch its name. The lead hand stays high at the cheek the whole way, because your shoulders square up for a moment as the punch lands. Snap the hand straight back to the guard and re-set your stance immediately."),
            ("When to use", "Almost always behind the jab: the jab steals a beat of attention, and the cross arrives while the opponent is still looking at the lead hand. It is also the standard counter when the guard drops, and the finish of most basic combinations — 1-2, 1-2-3, 1-1-2."),
            ("Advantages", "The hardest straight punch you own. The force comes from the floor through the rear leg, hip and shoulder instead of the arm, so it lands far heavier than the jab while still travelling on a straight, economical line."),
            ("Limits", "The big hip rotation squares your stance and briefly takes you off your base, so a missed cross is expensive — the counter hook is already loaded. Thrown cold from too far away it is easy to see coming, and a rear hand that stays low after the punch is the single most common knockout in boxing."),
        ],
    ),
    dict(
        file="leadhook.html", clip="lead-hand-hook", name="Lead Hook", num="3", hand="Lead hand",
        tagline="A short horizontal arc from the lead hand that goes around the guard instead of through it.",
        chips=["Punch #3", "Lead hand", "Close range", "Comes around the guard"],
        sections=[
            ("Action", "Keep the elbow bent at roughly 90 degrees and level with the fist. From the guard, pivot the lead foot and turn the whole lead side of the body: the hip rotates, the shoulder swings around, and the fist travels in a tight horizontal arc toward the jaw, knuckles facing down. The arm stays rigid — it does not swing. The power is body rotation, not the shoulder. Bring the fist back inside your guard immediately."),
            ("When to use", "At close to mid range, when the guard is high and tight: the hook goes around it, not through it. Classic placements are after the jab (1-3) or after the cross (1-2-3), aimed at the jaw or the temple — or, with the elbow slightly wider, at the ribs and liver."),
            ("Advantages", "It attacks from outside the opponent's field of vision, so it arrives where the guard isn't. With the whole body behind the rotation it is one of the two classic knockout punches, and it needs almost no wind-up."),
            ("Limits", "It only works at the right distance: too far and it becomes a slap, too close and there is no room for the arc. A wide miss swings your own jaw into the counter, and the punch telegraphs badly if the elbow flares before the hip turns."),
        ],
    ),
    dict(
        file="rearhook.html", clip="back-hand-hook", name="Rear Hook", num="4", hand="Rear hand",
        tagline="The heaviest hook you own — the rear hand swings across the body with the whole rear leg behind it.",
        chips=["Punch #4", "Rear hand", "Knockout punch", "Lands off-angle"],
        sections=[
            ("Action", "The same arc as the lead hook, but driven by the rear side: push off the rear foot, pivot it hard, and let the rear hip and shoulder carry the fist around in a horizontal line toward the jaw. The lead hand comes home to protect your own chin while the rear arm swings — for a moment your face is turned toward the punch. Recompose the guard the instant the fist passes the target."),
            ("When to use", "When the opponent circles toward your rear side and walks into range, or as the second power shot in a combination: 1-2-4 and 2-3-2 are the classic patterns. It is also the standard answer to an opponent who slips your cross to the outside."),
            ("Advantages", "The most power available in a hook — the rotation has the whole rear leg and hip behind it, and it lands from an angle the guard rarely covers well. It is the punch behind many of boxing's most famous one-punch knockouts."),
            ("Limits", "It has the longest path of any punch, so it is the easiest to see and the most expensive to miss: a wide rear hook leaves your entire right side open. It also needs the opponent at exactly hooking distance, and the big rotation must be reset before you can punch again."),
        ],
    ),
    dict(
        file="leaduppercut.html", clip="lead-hand-uppercut", name="Lead Uppercut", num="5", hand="Lead hand",
        tagline="A short upward punch from the lead hand that splits a high guard from underneath.",
        chips=["Punch #5", "Lead hand", "Inside range", "Beats a high guard"],
        sections=[
            ("Action", "Dip slightly at the knees — a small drop, not a lunge — and let the lead shoulder sink with them. From there drive the lead fist upward in a vertical line toward the chin, palm facing you, knuckles leading. The legs and hips push the punch up; the arm only guides it. The rear hand never leaves the chin, and the fist comes straight back down into the guard after it lands."),
            ("When to use", "Inside fighting, when the opponent leans in, or when a high guard is covering the face but leaving the line underneath open. Classic setups: after a body shot that doubles her over, or slipping inside the jab and rising with the uppercut."),
            ("Advantages", "It is the shortest route to the chin from inside range, and it travels on a line the guard does not cover — high gloves are almost blind to it. Because it is thrown by the lead hand, it is also the fastest uppercut you own and the easiest to hide behind a jab."),
            ("Limits", "You have to be close — it does almost nothing from outside — and dropping your level puts your own head on the line for hooks. If it misses, the recovery is longer than a jab's because the punch starts from a bent-knee position."),
        ],
    ),
    dict(
        file="rearuppercut.html", clip="back-hand-uppercut", name="Rear Uppercut", num="6", hand="Rear hand",
        tagline="The knockout punch from below — the rear hand drives up through the chin with the whole body behind it.",
        chips=["Punch #6", "Rear hand", "Fight ender", "Comes from below the guard"],
        sections=[
            ("Action", "Bend the knees and load the rear side, then explode upward: the rear leg extends, the hip turns over, and the rear fist travels in a tight vertical line under the guard to the chin, palm facing you, elbow tucked and pointing down. The lead hand stays high at the cheek. Land, then bring the fist straight back to the guard — do not let it hang in the air."),
            ("When to use", "The classic finisher after the head comes down: behind a body shot, when the opponent is rocked and sagging forward, or as the last punch of a combination like 1-2-body-6. It is also a natural answer to an opponent who ducks under your straight punches."),
            ("Advantages", "The most destructive single punch in the basic set — the force travels up through the legs, hip and back into the chin, the one target that turns the lights out. It also comes from below the guard, where most fighters keep almost no defence."),
            ("Limits", "It needs distance control and a set-up: thrown from too far it becomes a slow swing that a hook beats easily. You drop your level to throw it, your head moves into hook range, and if it misses there is a long recovery with the rear side wide open."),
        ],
    ),
]

TEMPLATE = """<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
<link rel="icon" href="data:," />
<title>{title}</title>
<meta name="description" content="{desc}" />
<link rel="canonical" href="https://silentjab.com/{file}" />
<meta property="og:type" content="article" />
<meta property="og:site_name" content="SilentJab" />
<meta property="og:title" content="{title}" />
<meta property="og:description" content="{desc}" />
<meta name="twitter:card" content="summary_large_image" />
<script type="application/ld+json">
{{
  "@context": "https://schema.org",
  "@type": "WebPage",
  "name": "{title}",
  "description": "{desc}",
  "inLanguage": "en",
  "isPartOf": {{ "@type": "WebSite", "name": "SilentJab" }},
  "breadcrumb": {{
    "@type": "BreadcrumbList",
    "itemListElement": [
      {{ "@type": "ListItem", "position": 1, "name": "Home", "item": "https://silentjab.com/" }},
      {{ "@type": "ListItem", "position": 2, "name": "{name}", "item": "https://silentjab.com/{file}" }}
    ]
  }}
}}
</script>
<link rel="stylesheet" href="./assets/home.css" />
</head>
<body>

<header class="site-head">
  <div class="wrap">
    <a class="logo" href="./index.html" aria-label="SilentJab home">
      <span class="logo-mark" aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M6 10a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v3a4 4 0 0 1-4 4h-4a4 4 0 0 1-4-4z"/>
          <path d="M8 13h8"/>
        </svg>
      </span>
      <span class="logo-text">SilentJab</span>
    </a>
    <nav class="nav" aria-label="Main">
      <a href="./training.html">Training</a>
      <a href="./index.html#moves">All moves</a>
    </nav>
  </div>
</header>

<main class="wrap">

  <section class="hero">
    <div class="hero-grid move-hero">

      <!-- Left: 3D stage (auto-plays this move once, Replay + slow-mo buttons) -->
      <div class="stage hero-stage" aria-label="3D demo of the {nameLower}">
        <canvas id="stage-canvas"></canvas>
        <div class="stage-bar" id="stage-bar" role="toolbar" aria-label="Replay the {nameLower}" hidden></div>
        <div class="stage-loading" id="stage-loading">
          <div class="ring"></div>
          <span id="stage-loading-text">Loading 3D model…</span>
        </div>
        <div class="stage-error" id="stage-error" hidden></div>
      </div>

      <!-- Right: technique text -->
      <div class="hero-copy">
        <div class="kicker">Boxing basics · 3D demo</div>
        <h1>How to throw a <em>{nameLower}</em></h1>
        <p>{tagline}</p>
        <div class="quick">
{chips}
        </div>
        <div class="move-notes">
{sections}
        </div>
        <div class="pager">
          <a class="chip" href="./{prevFile}">← {prevName}</a>
          <a class="chip" href="./{nextFile}">{nextName} →</a>
        </div>
      </div>

    </div>
  </section>

</main>

<footer class="site-foot">
  <span>© 2026 SilentJab — technique reference for striking sports.</span>
  <span><a href="./index.html#moves">All moves</a></span>
</footer>

<!-- Shared stage: this page asks for one move only, auto-played on load -->
<script>
window.STAGE = {{
  buttons: ['{clip}'],
  labels: {{ '{clip}': 'Replay' }},
  autoPlay: '{clip}'
}};
</script>
<script type="importmap">
{{
  "imports": {{
    "three": "./vendor/three/three.module.min.js",
    "three/addons/": "./vendor/three/addons/"
  }}
}}
</script>
<script type="module" src="./assets/home-stage.js"></script>
</body>
</html>
"""


def esc(s):
    return s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def render(move, prev, next_):
    chips = "\n".join(f'          <span class="chip">{esc(c)}</span>' for c in move["chips"])
    sections = "\n".join(
        textwrap.indent(
            f'<section class="note">\n  <h2>{esc(h)}</h2>\n  <p>{esc(p)}</p>\n</section>',
            "          ",
        )
        for h, p in move["sections"]
    )
    return TEMPLATE.format(
        title=f"{move['name']} — Boxing Basics in 3D | SilentJab",
        desc=f"{move['tagline']} Watch the 3D demo, then read the action, timing, advantages and limits of punch #{move['num']}.",
        file=move["file"], name=move["name"], nameLower=move["name"].lower(),
        tagline=esc(move["tagline"]), chips=chips, sections=sections,
        prevFile=prev["file"], prevName=prev["name"],
        nextFile=next_["file"], nextName=next_["name"],
        clip=move["clip"],
    )


def main():
    for i, move in enumerate(MOVES):
        prev = MOVES[(i - 1) % len(MOVES)]
        nxt = MOVES[(i + 1) % len(MOVES)]
        out = WEB / move["file"]
        out.write_text(render(move, prev, nxt), encoding="utf-8")
        print(f"wrote {out}  ({out.stat().st_size} bytes)")


if __name__ == "__main__":
    main()
