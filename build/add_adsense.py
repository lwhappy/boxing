#!/usr/bin/env python3
"""Insert the Google AdSense loader into every HTML page under web/.

Idempotent: pages that already contain adsbygoogle.js are skipped.
Run from anywhere:  python3 build/add_adsense.py
"""

from pathlib import Path

WEB = Path(__file__).resolve().parent.parent / "web"

SNIPPET = (
    '<!-- Google AdSense -->\n'
    '<meta name="google-adsense-account" content="ca-pub-8470399807799168" />\n'
    '<script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-8470399807799168" crossorigin="anonymous"></script>\n'
)

added, skipped, failed = [], [], []

for page in sorted(WEB.rglob("*.html")):
    html = page.read_text(encoding="utf-8")
    if "adsbygoogle.js" in html:
        skipped.append(page)
        continue
    if "</head>" not in html:
        failed.append(page)
        continue
    page.write_text(html.replace("</head>", SNIPPET + "</head>", 1), encoding="utf-8")
    added.append(page)

print(f"added   {len(added)}")
print(f"skipped {len(skipped)} (already had it)")
if failed:
    print(f"NO </head> in {len(failed)}:")
    for p in failed:
        print("  ", p.relative_to(WEB))
