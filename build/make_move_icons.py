#!/usr/bin/env python3
"""Cut the six boxers out of the reference pin sheet into transparent pictograms.

The sheet is cream *outline* art on a navy plate. Outlines disappear at icon
size, so each figure is converted to a filled silhouette:

    ink mask -> close stroke breaks -> fill the body -> keep the main blob
    -> flatten to the site's cream with the mask as alpha

    python3 build/make_move_icons.py

Output: web/assets/img/moves/fig-<name>.png  (200x260 RGBA, figure 238 px tall)
"""
from pathlib import Path

import numpy as np
from PIL import Image, ImageOps
from scipy import ndimage

ROOT = Path(__file__).resolve().parent.parent
SOURCE = Path("/tmp/boxing-moves-6.jpg")
OUT_DIR = ROOT / "web" / "assets" / "img" / "moves"

NAMES = ["jab", "cross", "leadhook", "rearhook", "leaduppercut", "rearuppercut"]
INK_THRESHOLD = 88
MIN_AREA = 1500
CANVAS = (200, 260)
FIGURE_H = 238
INK_RGB = (0xE8, 0xE2, 0xD2)      # warm cream, reads on the dark cards
PAD = 5


def disk(r: int) -> np.ndarray:
    y, x = np.ogrid[-r:r + 1, -r:r + 1]
    return x * x + y * y <= r * r


def figure_boxes(img: Image.Image) -> list[tuple]:
    mask = np.asarray(ImageOps.grayscale(img), dtype=np.uint8) > INK_THRESHOLD
    labels, _ = ndimage.label(mask, structure=np.ones((3, 3)))
    found = []
    for i, sl in enumerate(ndimage.find_objects(labels), 1):
        if sl is None:
            continue
        area = int((labels[sl] == i).sum())
        h, w = sl[0].stop - sl[0].start, sl[1].stop - sl[1].start
        if area >= MIN_AREA and h >= 180 and h > w and h < img.height * 0.6:
            found.append((sl[1].start, sl[0].start, sl[1].stop, sl[0].stop))
    if len(found) != 6:
        raise RuntimeError(f"expected 6 figures, detected {len(found)}")
    found.sort(key=lambda b: (0 if b[1] < img.height * 0.4 else 1, b[0]))
    return found


def silhouette(gray: np.ndarray) -> np.ndarray:
    mask = gray > INK_THRESHOLD
    mask = ndimage.binary_closing(mask, structure=disk(2), iterations=1)   # heal strokes
    filled = ndimage.binary_fill_holes(mask)
    # if a break still leaks, bulge, refill, and settle back
    if filled.sum() < mask.sum() * 1.6:
        bulged = ndimage.binary_dilation(mask, structure=disk(3), iterations=1)
        filled = ndimage.binary_erosion(ndimage.binary_fill_holes(bulged),
                                        structure=disk(3), iterations=1)
    labels, n = ndimage.label(filled, structure=np.ones((3, 3)))
    if n > 1:                                    # drop arrows / stray bits
        sizes = ndimage.sum(filled, labels, range(1, n + 1))
        filled = labels == (int(np.argmax(sizes)) + 1)
    return ndimage.binary_closing(filled, structure=disk(2), iterations=1)


def to_icon(gray: np.ndarray) -> Image.Image:
    solid = silhouette(gray)
    alpha = ndimage.gaussian_filter(solid.astype(np.float32), 0.7)
    rgba = np.zeros((*alpha.shape, 4), dtype=np.uint8)
    rgba[..., 0], rgba[..., 1], rgba[..., 2] = INK_RGB
    rgba[..., 3] = (np.clip(alpha, 0, 1) * 255).astype(np.uint8)

    art = Image.fromarray(rgba, "RGBA")
    scale = FIGURE_H / art.height
    art = art.resize((max(1, round(art.width * scale)), FIGURE_H), Image.LANCZOS)

    canvas = Image.new("RGBA", CANVAS, (0, 0, 0, 0))
    if art.width > CANVAS[0]:
        left = (art.width - CANVAS[0]) // 2
        art = art.crop((left, 0, left + CANVAS[0], art.height))
    canvas.paste(art, ((CANVAS[0] - art.width) // 2, (CANVAS[1] - art.height) // 2), art)
    return canvas


def main() -> None:
    img = Image.open(SOURCE).convert("RGB")
    gray_full = np.asarray(ImageOps.grayscale(img))
    for name, (x0, y0, x1, y1) in zip(NAMES, figure_boxes(img)):
        gray = gray_full[max(0, y0 - PAD):y1 + PAD, max(0, x0 - PAD):x1 + PAD]
        icon = to_icon(gray)
        path = OUT_DIR / f"fig-{name}.png"
        icon.save(path, optimize=True)
        print(f"{path.relative_to(ROOT)}  {path.stat().st_size / 1024:.1f} kB")


if __name__ == "__main__":
    main()
