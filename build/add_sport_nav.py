#!/usr/bin/env python3
"""Add the Sport nav + footer link to every static page under web/."""
import os, re, sys

WEB = "/Users/justrun/project/boxing-3/web"
changed, skipped = [], []

def depth_from_web(path):
    rel = os.path.relpath(path, WEB)
    d = rel.count(os.sep)
    return d

for root, dirs, files in os.walk(WEB):
    dirs[:] = [d for d in dirs if d not in {"vendor", "media", "assets"}]
    for f in files:
        if not f.endswith(".html"):
            continue
        p = os.path.join(root, f)
        s = open(p, encoding="utf-8").read()
        orig = s
        pre = "../" * depth_from_web(p)

        # nav: insert Sport after Training (skip pages that already have it)
        if 'data-section="sport"' not in s:
            s = s.replace(
                f'<a href="{pre}fight/" data-section="fight">Fight</a>',
                f'<a href="{pre}sport/" data-section="sport">Sport</a>\n      <a href="{pre}fight/" data-section="fight">Fight</a>',
            )
        # footer: insert Sport after Training
        if f'<a href="{pre}sport/">Sport</a>' not in s:
            s = s.replace(
                f'<a href="{pre}training/">Training</a> · <a href="{pre}guides/">',
                f'<a href="{pre}training/">Training</a> · <a href="{pre}sport/">Sport</a> · <a href="{pre}guides/">',
            )
        if s != orig:
            open(p, "w", encoding="utf-8").write(s)
            changed.append(os.path.relpath(p, WEB))
        else:
            skipped.append(os.path.relpath(p, WEB))

print(f"changed {len(changed)}:")
for c in changed:
    print("  +", c)
print(f"skipped {len(skipped)}:")
for c in skipped:
    print("  =", c)
