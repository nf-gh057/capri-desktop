"""Her chat's frames for Android, as 9-patch images (android/app/src/main/res/drawable-xxhdpi/*.9.png): the same
shapes as talk.css (a bubble with its top right corner cut, her HUD bar with both ends cut), the frame drawn whole
across every cut corner, stretched by Android without touching the corners.

    python tools/build-ninepatch.py
"""
from pathlib import Path
from PIL import Image, ImageDraw

OUT = Path(__file__).resolve().parent.parent / 'android' / 'app' / 'src' / 'main' / 'res' / 'drawable-xxhdpi'
DP = 3     # xxhdpi
SS = 4     # drawn this much bigger, then scaled down: smooth diagonals


def rgba(hex_, alpha=1.0):
    h = hex_.lstrip('#')
    return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4)) + (round(alpha * 255),)


def shape(w, h, cut_tr=0, cuts_all=0):
    """the outline's corners, in px of the final image"""
    if cuts_all:
        c = cuts_all
        return [(c, 0), (w - c, 0), (w, c), (w, h - c), (w - c, h), (c, h), (0, h - c), (0, c)]
    return [(0, 0), (w - cut_tr, 0), (w, cut_tr), (w, h), (0, h)]


def frame(name, w, h, fill, stroke, stroke_dp=1.0, cut_tr=0, cuts_all=0, stretch=None, pad=None):
    big = Image.new('RGBA', (w * SS, h * SS), (0, 0, 0, 0))
    d = ImageDraw.Draw(big)
    half = stroke_dp * DP * SS / 2
    pts = [(x * SS, y * SS) for x, y in shape(w, h, cut_tr * DP, cuts_all * DP)]
    # the outline inset by half its width, so all of it is inside the image
    cx, cy = w * SS / 2, h * SS / 2
    inset = [(x + (half if x < cx else -half), y + (half if y < cy else -half)) for x, y in pts]
    d.polygon(inset, fill=fill)
    d.line(inset + [inset[0]], fill=stroke, width=round(stroke_dp * DP * SS), joint='curve')
    img = big.resize((w, h), Image.LANCZOS)
    # the 9-patch's own border: what stretches (top, left), where the content goes (bottom, right)
    out = Image.new('RGBA', (w + 2, h + 2), (0, 0, 0, 0))
    out.paste(img, (1, 1))
    black = (0, 0, 0, 255)
    sx, sy = stretch
    for x in range(sx[0], w - sx[1]):
        out.putpixel((x + 1, 0), black)
    for y in range(sy[0], h - sy[1]):
        out.putpixel((0, y + 1), black)
    px, py = pad
    for x in range(px[0], w - px[1]):
        out.putpixel((x + 1, h + 1), black)
    for y in range(py[0], h - py[1]):
        out.putpixel((w + 1, y + 1), black)
    OUT.mkdir(parents=True, exist_ok=True)
    out.save(OUT / f'{name}.9.png')
    print(name, out.size)


W, H = 40 * DP, 30 * DP
bubble = dict(cut_tr=8, stretch=((4 * DP, 12 * DP), (12 * DP, 4 * DP)), pad=((8 * DP, 8 * DP), (5 * DP, 5 * DP)))
RED, GREEN, CRIMSON = '#ff5f56', '#57e389', '#ff1f4b'
frame('bubble_capri', W, H, rgba(RED, 0.15), rgba(RED), **bubble)
frame('bubble_you', W, H, rgba(GREEN, 0.15), rgba(GREEN), **bubble)
frame('bubble_line_capri', W, H, (0, 0, 0, 0), rgba(RED, 0.45), **bubble)
frame('bubble_line_you', W, H, (0, 0, 0, 0), rgba(GREEN, 0.45), **bubble)
frame('bubble_erebus', W, H, rgba(CRIMSON, 0.12), rgba(CRIMSON), stroke_dp=2, **bubble)
frame('hud_frame', 40 * DP, 40 * DP, rgba('#0b0a0f', 0.88), rgba('#e8392d'), cuts_all=8,
      stretch=((10 * DP, 10 * DP), (10 * DP, 10 * DP)), pad=((12 * DP, 12 * DP), (4 * DP, 4 * DP)))
