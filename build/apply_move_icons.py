#!/usr/bin/env python3
"""Swap the generic SVG glyphs on every move/combo card for the cut-out figures.

Single-move cards get one figure inside the existing 44px tile; combo cards get
a horizontal strip of figures in punch order, joined by arrows. The order comes
straight from the href (combo_jab_cross_leadhook_rearhook -> 1-2-3-4), so a new
combo page only needs a slug that follows the naming convention.

    python3 build/apply_move_icons.py
"""
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

PAGES = [
    ROOT / "web" / "index.html",
    ROOT / "web" / "moves" / "index.html",
    ROOT / "web" / "combos" / "index.html",
]

MOVES = ["leadhook", "rearhook", "leaduppercut", "rearuppercut", "jab", "cross"]
ALIASES = {"hook": "leadhook"}          # combo_jab_cross_hook -> ...lead hook
SKIP = {"idle", "dup", "alt", "combo"}

CARD_RE = re.compile(
    r'(<a class="card" href="([^"]+)">\s*)<span class="(?:ico|fig-strip)[^"]*"[^>]*>.*?</span>',
    re.S,
)


def figures_for(href: str) -> list[str]:
    slug = href.rsplit("/", 1)[-1].removesuffix(".html")
    if "moves/" in href:                       # single technique
        return [slug]
    rest = slug.removeprefix("combo_")
    seq = []
    for word in rest.split("_"):
        if word in MOVES:
            seq.append(word)
        elif word in ALIASES:
            seq.append(ALIASES[word])
        elif word not in SKIP:
            raise RuntimeError(f"unknown token {word!r} in {href}")
    if not seq:
        raise RuntimeError(f"no moves parsed from {href}")
    return seq


def markup(figs: list[str], base: str) -> str:
    img = ('<img src="{b}assets/img/moves/fig-{f}.png" alt="" width="{w}" height="{h}" '
           'loading="lazy" decoding="async">')
    if len(figs) == 1:
        return ('<span class="ico ico-fig" aria-hidden="true">'
                + img.format(b=base, f=figs[0], w=52, h=56) + "</span>")
    parts = []
    for i, f in enumerate(figs):
        parts.append(img.format(b=base, f=f, w=36, h=48))
        if i < len(figs) - 1:
            parts.append("<i>&rarr;</i>")
    return '<span class="fig-strip" aria-hidden="true">' + "".join(parts) + "</span>"


def main() -> None:
    total = 0
    for page in PAGES:
        base = "../" if page.parent.name in {"moves", "combos"} else "./"
        html = page.read_text()
        count = 0

        def repl(m: re.Match) -> str:
            nonlocal count
            figs = figures_for(m.group(2))
            count += 1
            return m.group(1) + markup(figs, base)

        new = CARD_RE.sub(repl, html)
        if new != html:
            page.write_text(new)
        total += count
        print(f"{count:2} cards  {page.relative_to(ROOT)}")
    print(f"{total} icons replaced")


if __name__ == "__main__":
    main()
