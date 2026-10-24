"""
Generate 10 combo HTML pages based on the existing jab.html template.
Each page loads a combo GLB and auto-plays the combined animation.
"""
import os

WEB_DIR = "/Users/justrun/project/boxing-3/web"

# All 10 combos with their metadata
COMBOS = [
    {
        "filename": "combo_jab_cross.html",
        "glb": "combo_jab_cross.glb",
        "action": "idle_jab_cross",
        "title": "Jab-Cross Combo — Basic Boxing Combinations in 3D | SilentJab",
        "h1": "Jab-Cross",
        "subtitle": "The classic 1-2: lead-hand jab to occupy the guard, rear-hand cross to land the power.",
        "chips": ["Combo 1-2", "Two punches", "Entry combo", "Lead + rear"],
        "seq": "idle → jab → cross",
        "notes": [
            ("The sequence", "Start from idle guard. The jab snaps out first — lead hand, straight line, back to chin. The instant the jab returns, the rear hip pivots and the cross fires through the gap the jab just opened. The cross lands while the opponent is still tracking the lead hand."),
            ("When to use", "This is the first combination every boxer learns and the most thrown combo in the sport. Use it to establish distance, test the guard, and score points. The jab sets the table; the cross does the damage."),
            ("Key detail", "The transition between jab and cross is seamless — no pause, no reset. The jab hand comes back as the cross hand goes out, so both fists are moving at the same time in opposite directions. The hips rotate through both punches in one continuous motion."),
            ("Common mistake", "Throwing the jab and then pausing to load the cross. The pause telegraphs the power shot and gives the opponent time to slip or counter. Keep the rhythm continuous: one-two, not one… two."),
        ],
        "prev_link": ("index.html#combos", "← All combos"),
        "next_link": ("combo_jab_cross_hook.html", "Jab-Cross-Hook →"),
    },
    {
        "filename": "combo_jab_cross_hook.html",
        "glb": "combo_jab_cross_hook.glb",
        "action": "idle_jab_cross_leadhook",
        "title": "Jab-Cross-Hook Combo — Basic Boxing Combinations in 3D | SilentJab",
        "h1": "Jab-Cross-Hook",
        "subtitle": "The 1-2-3: jab to open, cross to load, lead hook to finish on the inside.",
        "chips": ["Combo 1-2-3", "Three punches", "Power finish", "Lead hook end"],
        "seq": "idle → jab → cross → lead hook",
        "notes": [
            ("The sequence", "From guard, fire the jab to occupy the eyes. The cross follows immediately, driving the hips through to the lead side. As the cross returns, the lead arm is already coiling — the hook fires in a tight horizontal arc around the opponent's guard, aimed at the jaw."),
            ("When to use", "When the opponent's guard is high and tight: the jab and cross pull their hands up to protect the center line, which opens the side of the jaw for the hook. This is a finishing combination — throw it when you're in range and want to hurt."),
            ("Key detail", "The hook is thrown from the lead hand because the cross's hip rotation has already loaded the lead side. The lead foot pivots inward, the lead hip turns through, and the fist travels in a short arc — not a wide swing. The tighter the arc, the harder it lands."),
            ("Common mistake", "Throwing the hook too wide after the cross. A wide hook is slow, telegraphed, and leaves your chin exposed to a counter right hand. Keep the elbow tight and the arc compact."),
        ],
        "prev_link": ("combo_jab_cross.html", "← Jab-Cross"),
        "next_link": ("combo_jab_cross_leadhook_rearhook.html", "Jab-Cross-Lead Hook-Rear Hook →"),
    },
    {
        "filename": "combo_jab_cross_leadhook_rearhook.html",
        "glb": "combo_jab_cross_leadhook_rearhook.glb",
        "action": "idle_jab_cross_leadhook_rearhook",
        "title": "Jab-Cross-Lead Hook-Rear Hook Combo — Boxing Combinations in 3D | SilentJab",
        "h1": "Jab-Cross-Lead Hook-Rear Hook",
        "subtitle": "Four-punch combination: the 1-2-3 extended with a rear hook to close the exchange.",
        "chips": ["Combo 1-2-3-4", "Four punches", "Both hooks", "High output"],
        "seq": "idle → jab → cross → lead hook → rear hook",
        "notes": [
            ("The sequence", "Jab to open, cross to load the lead side, lead hook to go around the guard — then the rear hook arrives as the coup de grâce. The lead hook's rotation carries your weight to the rear side, which loads the rear hip for the final hook. Four punches, one continuous flow."),
            ("When to use", "When you have the opponent hurt or covering up and want to maximize damage. This combo puts pressure on both sides of the guard — the lead hook attacks one side, the rear hook the other, giving the opponent nowhere to hide."),
            ("Key detail", "The rear hook is the heaviest punch in the sequence. It benefits from the momentum of the three punches before it — your body is already rotating, the rear hip is loaded from the lead hook's recoil, and the rear fist swings through with the full weight of your torso behind it."),
            ("Common mistake", "Running out of breath or balance by punch four. Four-punch combos require conditioning and tight mechanics. If the stance widens or the hands drop after the third punch, the rear hook becomes a lazy arm swing with no power and a wide-open chin."),
        ],
        "prev_link": ("combo_jab_cross_hook.html", "← Jab-Cross-Hook"),
        "next_link": ("combo_jab_jab_cross.html", "Jab-Jab-Cross →"),
    },
    {
        "filename": "combo_jab_jab_cross.html",
        "glb": "combo_jab_jab_cross.glb",
        "action": "idle_jab_jab_cross",
        "title": "Jab-Jab-Cross Combo — Basic Boxing Combinations in 3D | SilentJab",
        "h1": "Jab-Jab-Cross",
        "subtitle": "Double jab to disrupt rhythm, cross to capitalize on the opening.",
        "chips": ["Combo 1-1-2", "Three punches", "Double jab", "Rhythm breaker"],
        "seq": "idle → jab → jab → cross",
        "notes": [
            ("The sequence", "First jab measures distance and occupies the guard. Second jab — thrown faster, not harder — disrupts the opponent's timing and pulls their attention fully to the lead side. The cross arrives a beat later, shooting through the center as the opponent's eyes are still tracking the second jab."),
            ("When to use", "Against an opponent who reads single jabs and counters. The second jab breaks their counter rhythm — they expected one jab, committed to a response, and now the cross is already on its way. Also excellent against a taller fighter who leans back to avoid the jab."),
            ("Key detail", "The two jabs are not identical. The first is a measuring jab — relaxed, informational. The second is a disruptor — snappier, with a half-step forward. The cross then commits fully, riding the forward momentum from the second jab's step."),
            ("Common mistake", "Throwing both jabs at the same speed and then pausing before the cross. The combo works because of rhythm disruption — if all three punches are thrown at the same tempo, the opponent can simply shell up and wait. Vary the cadence: slow-fast-power."),
        ],
        "prev_link": ("combo_jab_cross_leadhook_rearhook.html", "← Jab-Cross-Lead Hook-Rear Hook"),
        "next_link": ("combo_jab_cross_leadhook_cross.html", "Jab-Cross-Lead Hook-Cross →"),
    },
    {
        "filename": "combo_jab_cross_leadhook_cross.html",
        "glb": "combo_jab_cross_leadhook_cross.glb",
        "action": "idle_jab_cross_leadhook_cross",
        "title": "Jab-Cross-Lead Hook-Cross Combo — Boxing Combinations in 3D | SilentJab",
        "h1": "Jab-Cross-Lead Hook-Cross",
        "subtitle": "Four-punch flow: 1-2-3-2 — the cross returns to finish what the hook started.",
        "chips": ["Combo 1-2-3-2", "Four punches", "Double cross", "Flow combo"],
        "seq": "idle → jab → cross → lead hook → cross",
        "notes": [
            ("The sequence", "Jab opens, cross loads the hips, lead hook goes around the guard — then the cross fires again, this time from the opposite rotation. The lead hook spins your torso toward the rear side, which loads the rear hip for a second cross that the opponent does not expect."),
            ("When to use", "When the opponent is covering up after the hook. Their guard is focused on the lead side after the hook, so the cross comes back through the center with a clear lane. This combo keeps the pressure on from multiple angles without giving the opponent time to reset."),
            ("Key detail", "The second cross is different from the first. The first cross is a standard power shot from a neutral stance. The second cross rides the rotational momentum from the hook — the rear hip is already loaded from the hook's recoil, so the second cross lands with surprising power despite being punch four."),
            ("Common mistake", "Throwing the second cross from a squared-up stance. After the hook, your hips may be facing forward. You must re-coil the rear side before the second cross — pivot the rear foot, turn the hip back through, and let the shoulder follow the fist."),
        ],
        "prev_link": ("combo_jab_jab_cross.html", "← Jab-Jab-Cross"),
        "next_link": ("combo_jab_cross_leaduppercut.html", "Jab-Cross-Lead Uppercut →"),
    },
    {
        "filename": "combo_jab_cross_leaduppercut.html",
        "glb": "combo_jab_cross_leaduppercut.glb",
        "action": "idle_jab_cross_leaduppercut",
        "title": "Jab-Cross-Lead Uppercut Combo — Boxing Combinations in 3D | SilentJab",
        "h1": "Jab-Cross-Lead Uppercut",
        "subtitle": "Three-punch combo that splits a high guard from underneath.",
        "chips": ["Combo 1-2-5", "Three punches", "Uppercut finish", "Guard splitter"],
        "seq": "idle → jab → cross → lead uppercut",
        "notes": [
            ("The sequence", "Jab to occupy the eyes, cross to pull the guard high and tight — then the lead uppercut drives up through the gap between the opponent's forearms. The cross's impact makes them tighten their guard, which is exactly when the uppercut can split it."),
            ("When to use", "Against a tight shell guard or a fighter who covers up under pressure. The jab and cross force them to bring both gloves up to protect the center line; the uppercut then goes underneath, where the gloves can't reach."),
            ("Key detail", "The lead uppercut is a short punch — the fist drops slightly, then drives up through the chin in a vertical line. The power comes from the lead leg pushing up, not from the arm. The cross's hip rotation loads the lead side, making the uppercut feel explosive despite being punch three."),
            ("Common mistake", "Dropping the hand too far before the uppercut. The wind-up telegraphs the punch and exposes the chin. The drop should be minimal — just enough to change the angle from horizontal to vertical. The fist should travel less than a fist-width downward before going up."),
        ],
        "prev_link": ("combo_jab_cross_leadhook_cross.html", "← Jab-Cross-Lead Hook-Cross"),
        "next_link": ("combo_jab_rearuppercut_leadhook.html", "Jab-Rear Uppercut-Lead Hook →"),
    },
    {
        "filename": "combo_jab_rearuppercut_leadhook.html",
        "glb": "combo_jab_rearuppercut_leadhook.glb",
        "action": "idle_jab_rearuppercut_leadhook",
        "title": "Jab-Rear Uppercut-Lead Hook Combo — Boxing Combinations in 3D | SilentJab",
        "h1": "Jab-Rear Uppercut-Lead Hook",
        "subtitle": "Power uppercut from the rear hand, finished with a lead hook to the jaw.",
        "chips": ["Combo 1-6-3", "Three punches", "Power uppercut", "Hook finish"],
        "seq": "idle → jab → rear uppercut → lead hook",
        "notes": [
            ("The sequence", "The jab sets distance and disrupts the guard. Instead of following with a cross, the rear hand drops and fires an uppercut — driving up from the floor through the rear leg, hip, and fist. The uppercut's recoil loads the lead side, and the lead hook snaps around as the opponent's head snaps back from the uppercut."),
            ("When to use", "When the opponent leans forward or ducks after the jab — the rear uppercut catches them coming in, lifting their chin into the perfect position for the lead hook. This combo is devastating against pressure fighters who slip forward to avoid the cross."),
            ("Key detail", "The rear uppercut is the heaviest uppercut you own — the rear leg, hip, and shoulder all drive up in one line. The transition to the lead hook is natural: the uppercut's upward force rocks the opponent's head back, and the hook comes around the side while their weight is on their heels."),
            ("Common mistake", "Throwing the uppercut from too far away. The rear uppercut is a short-range punch — if you throw it at cross range, it becomes an arm punch with no power. Step in with the jab to close distance, then fire the uppercut from inside."),
        ],
        "prev_link": ("combo_jab_cross_leaduppercut.html", "← Jab-Cross-Lead Uppercut"),
        "next_link": ("combo_jab_cross_leadhook_cross_dup.html", "Jab-Cross-Lead Hook-Cross →"),
    },
    {
        "filename": "combo_jab_cross_leadhook_cross_dup.html",
        "glb": "combo_jab_cross_leadhook_cross_dup.glb",
        "action": "idle_jab_cross_leadhook_cross",
        "title": "Jab-Cross-Lead Hook-Cross (Alt) — Boxing Combinations in 3D | SilentJab",
        "h1": "Jab-Cross-Lead Hook-Cross",
        "subtitle": "Four-punch flow: the cross comes back to close the exchange after the hook.",
        "chips": ["Combo 1-2-3-2", "Four punches", "Alternate take", "Flow combo"],
        "seq": "idle → jab → cross → lead hook → cross",
        "notes": [
            ("The sequence", "Jab opens the guard, cross loads the rotation, lead hook goes around — then the cross returns through the center. This is the same combination as the primary 1-2-3-2, rendered from a slightly different source animation to show how the same punch sequence can flow with different timing and emphasis."),
            ("When to use", "When the opponent is shell-covered after three punches and you want one more shot before resetting. The returning cross often finds a clean lane because the opponent's guard is still tracking the hook."),
            ("Key detail", "Watch the hips: after the hook, the rear side is loaded from the rotational recoil. The second cross doesn't need a fresh wind-up — it rides that stored rotation, making it fast and surprisingly heavy despite being the fourth punch in the chain."),
            ("Common mistake", "Forgetting to reset after punch four. Four punches is a lot of output — after the second cross, snap both hands back to the guard and reset your stance immediately. The counter is coming."),
        ],
        "prev_link": ("combo_jab_rearuppercut_leadhook.html", "← Jab-Rear Uppercut-Lead Hook"),
        "next_link": ("combo_cross_leadhook_cross.html", "Cross-Lead Hook-Cross →"),
    },
    {
        "filename": "combo_cross_leadhook_cross.html",
        "glb": "combo_cross_leadhook_cross.glb",
        "action": "idle_cross_leadhook_cross",
        "title": "Cross-Lead Hook-Cross Combo — Boxing Combinations in 3D | SilentJab",
        "h1": "Cross-Lead Hook-Cross",
        "subtitle": "No jab to set up — straight to power: cross, hook, cross again.",
        "chips": ["Combo 2-3-2", "Three punches", "No jab", "Power-first"],
        "seq": "idle → cross → lead hook → cross",
        "notes": [
            ("The sequence", "From idle guard, skip the jab and fire the cross directly. The cross loads the lead hip for the hook, which comes around immediately. As the hook returns, the cross fires again — three power shots in a row, no measuring jab in between."),
            ("When to use", "When the opponent is hurt, backing up, or has already been softened up by jabs earlier in the round. Without the jab to measure distance, you must already be in range — but if you are, this combo maximizes damage in minimum time."),
            ("Key detail", "Every punch in this combo is a power shot. The cross drives from the rear leg, the hook from the lead hip rotation, and the second cross from the hook's recoil. There's no breather punch — each one commits fully. This makes it devastating but also tiring and risky if you miss."),
            ("Common mistake", "Throwing it from too far out. Without the jab to close distance, the cross can fall short if you're not already in range. Step in with the cross — push off the rear foot and let the step carry you into range as the fist extends."),
        ],
        "prev_link": ("combo_jab_cross_leadhook_cross_dup.html", "← Jab-Cross-Lead Hook-Cross"),
        "next_link": ("combo_idle_jab_cross_leadhook.html", "Jab-Cross-Lead Hook →"),
    },
    {
        "filename": "combo_idle_jab_cross_leadhook.html",
        "glb": "combined_idle_jab_cross_leadhook.glb",
        "action": "idle_jab_cross_leadhook",
        "title": "Jab-Cross-Lead Hook Combo — Basic Boxing Combinations in 3D | SilentJab",
        "h1": "Jab-Cross-Lead Hook",
        "subtitle": "The full 1-2-3 from idle guard: the bread-and-butter three-punch combination.",
        "chips": ["Combo 1-2-3", "Three punches", "Classic combo", "All ranges"],
        "seq": "idle → jab → cross → lead hook",
        "notes": [
            ("The sequence", "From the idle guard, the jab snaps out first — lead hand, straight line, back to chin. The cross follows immediately, driving through the gap the jab opened. As the cross returns, the lead hook fires in a tight arc around the guard. Three punches, three angles, one continuous motion."),
            ("When to use", "This is the most versatile combination in boxing. Use it at long range (the jab measures, the cross and hook follow if in range), at mid range (all three land clean), or as an entry combination to close distance. It works against any guard because it attacks from straight, straight, and circular angles."),
            ("Key detail", "Each punch loads the next. The jab's recoil sets the cross's hip rotation. The cross's hip turn loads the lead side for the hook. The hook's arc naturally brings the guard back to center. The whole combo flows like a single motion — no resets, no pauses, no telegraphing between punches."),
            ("Common mistake", "Throwing the hook as a separate action after the cross. The hook should begin as the cross is returning — both fists are moving at the same time. If you finish the cross, pause, then start the hook, you've given the opponent a full beat to recover and counter."),
        ],
        "prev_link": ("combo_cross_leadhook_cross.html", "← Cross-Lead Hook-Cross"),
        "next_link": ("index.html#combos", "← All combos"),
    },
]


def generate_html(combo):
    """Generate a combo HTML page based on the jab.html template."""
    filename = combo["filename"]
    title = combo["title"]
    h1 = combo["h1"]
    subtitle = combo["subtitle"]
    chips = combo["chips"]
    seq = combo["seq"]
    notes = combo["notes"]
    glb = combo["glb"]
    action = combo["action"]
    prev_link, prev_text = combo["prev_link"]
    next_link, next_text = combo["next_link"]

    chips_html = "\n          ".join(f'<span class="chip">{c}</span>' for c in chips)
    notes_html = "\n          ".join(
        f'<section class="note">\n            <h2>{h}</h2>\n            <p>{p}</p>\n          </section>'
        for h, p in notes
    )

    html = f'''<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
<link rel="icon" href="data:," />
<title>{title}</title>
<meta name="description" content="{subtitle}" />
<link rel="canonical" href="https://silentjab.com/{filename}" />
<meta property="og:type" content="article" />
<meta property="og:site_name" content="SilentJab" />
<meta property="og:title" content="{title}" />
<meta property="og:description" content="{subtitle}" />
<meta name="twitter:card" content="summary_large_image" />
<script type="application/ld+json">
{{
  "@context": "https://schema.org",
  "@type": "WebPage",
  "name": "{title}",
  "description": "{subtitle}",
  "inLanguage": "en",
  "isPartOf": {{ "@type": "WebSite", "name": "SilentJab" }},
  "breadcrumb": {{
    "@type": "BreadcrumbList",
    "itemListElement": [
      {{ "@type": "ListItem", "position": 1, "name": "Home", "item": "https://silentjab.com/" }},
      {{ "@type": "ListItem", "position": 2, "name": "Combinations", "item": "https://silentjab.com/index.html#combos" }},
      {{ "@type": "ListItem", "position": 3, "name": "{h1}", "item": "https://silentjab.com/{filename}" }}
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
      <a href="./index.html#combos">Combos</a>
    </nav>
  </div>
</header>

<main class="wrap">

  <section class="hero">
    <div class="hero-grid move-hero">

      <!-- Left: 3D stage (auto-plays the combo, Replay + slow-mo buttons) -->
      <div class="stage hero-stage" aria-label="3D demo of the {h1.lower()} combo">
        <canvas id="stage-canvas"></canvas>
        <div class="stage-bar" id="stage-bar" role="toolbar" aria-label="Replay the combo" hidden></div>
        <div class="stage-loading" id="stage-loading">
          <div class="ring"></div>
          <span id="stage-loading-text">Loading combo model…</span>
        </div>
        <div class="stage-error" id="stage-error" hidden></div>
      </div>

      <!-- Right: technique text -->
      <div class="hero-copy">
        <div class="kicker">Boxing combinations · 3D demo</div>
        <h1>{h1}</h1>
        <p>{subtitle}</p>
        <div class="quick">
          {chips_html}
          <span class="chip">Sequence: {seq}</span>
        </div>
        <div class="move-notes">
          {notes_html}
        </div>
        <div class="pager">
          <a class="chip" href="./{prev_link}">{prev_text}</a>
          <a class="chip" href="./{next_link}">{next_text}</a>
        </div>
      </div>

    </div>
  </section>

</main>

<footer class="site-foot">
  <span>© 2026 SilentJab — technique reference for striking sports.</span>
  <span><a href="./index.html#combos">All combos</a></span>
</footer>

<!-- Combo stage: loads a single combo GLB and auto-plays it -->
<script>
window.COMBO = {{
  glb: '{glb}'
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
<script type="module" src="./assets/combo-stage.js"></script>
</body>
</html>
'''
    path = os.path.join(WEB_DIR, filename)
    with open(path, 'w') as f:
        f.write(html)
    print(f"Created: {filename}")


# Generate all 10 combo HTML files
for combo in COMBOS:
    generate_html(combo)

print(f"\nAll {len(COMBOS)} combo HTML files created.")
