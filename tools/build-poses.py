"""Builds her pose drawings (assets/capri/pose-<name>.png) from generated pictures of her on a flat
key colour (any flat colour that isn't hers; yellow #FFFF00 works best), or already cut out.

The cut-out (capri-full.png) is rigged in the shader; a pose drawing isn't: it's a whole new
drawing swapped in for a while (hand on hip, lying on a ledge, the in-between as she lies down),
with only her mane moving. Each one is keyed and cropped, its reds and greens are brought to the
cut-out's (the shader grades them all the same way afterwards), and it's scaled into sprite space:
  - standing, so that her eyes are as high above her feet as the cut-out's face is, under it;
  - on a ledge, so that her eyes are as far apart as on `like` (the generator draws her head the
    same size from one picture to the next far more reliably than her body), resting on her seat;
    or, drawn from another ledge drawing as its in-between (`from`), at that one's scale exactly;
  - in the air, folded up (nowhere near her feet), with her eyes as far apart as on `like` and
    her face where the cut-out's is: her head stays put, the rest of her draws in under it;
  - walking, the frames of one cycle all at the scale of one of them (`from`, scaled like a
    standing one), each with its lowest foot on the ground and her face a little ahead of her
    feet (seen from the side, her face is at the front of her head), so the cycle doesn't slide
    about under her and turning round flips her about her feet. For each it also prints her
    `step`: how far she has to move on as that drawing comes on so that the foot she's standing
    on stays where it was on the ledge (it's drawn that much further back).
It's written at one texel per sprite pixel, like the cut-out: any finer and the line boil makes
its edges crawl at her usual size.

    python tools/build-poses.py hip=hip.png lie=lie.png lean=lean.png fidget=fidget.png cross=cross.png float=float.png         walk1=w1.png ... walk8=w8.png

prints each drawing's rect and face in sprite pixels: keep POSES in src/renderer/js/sprite.js in
sync with it. Needs Pillow and numpy.
"""
import sys
from pathlib import Path

import numpy as np
from PIL import Image

ASSETS = Path(__file__).resolve().parent.parent / 'assets' / 'capri'
CUTOUT = ASSETS / 'capri-cutout.png'
FEET = (128, 418)    # the cut-out's feet (SPRITE.feet)
FACE = (120, 132)    # about where the cut-out's face is
HIP = 232            # where she sits on a ledge (SPRITE.hip)
D0, D1 = 70.0, 150.0  # distance from the key colour: below D0 it's background, above D1 it's her

# how each drawing sits in sprite space (see above); `mid` is where the middle of a ledge drawing goes
POSES = {
    'hip': {'kind': 'stand'},
    'fidget': {'kind': 'stand'},
    'cross': {'kind': 'stand'},
    'float': {'kind': 'air', 'like': 'hip'},
    # walking to the right, a step on each leg: contact, down, passing, up, and again on the other
    'walk3': {'kind': 'walk'},  # passing: upright on a straight leg, so it's the one the cycle is scaled by
    **{f'walk{i}': {'kind': 'walk', 'from': 'walk3'} for i in (1, 2, 4, 5, 6, 7, 8)},
    'lie': {'kind': 'ledge', 'like': 'hip', 'mid': 120},
    'lean': {'kind': 'ledge', 'from': 'lie', 'mid': 120},  # lying down: between sitting and 'lie'
}


def key(path):
    """Her, on transparency (straight alpha), cropped to her outline."""
    src = Image.open(path)
    if src.mode == 'RGBA' and src.getextrema()[3][0] < 255:  # already cut out
        return src.crop(src.getbbox())
    im = np.asarray(src.convert('RGB')).astype(np.float32)
    border = np.concatenate([im[0], im[-1], im[:, 0], im[:, -1]])
    bg = np.median(border, axis=0)
    a = np.clip((np.linalg.norm(im - bg, axis=2) - D0) / (D1 - D0), 0, 1)
    # take the key colour out of the soft edge, so no fringe of it stays
    rgb = np.clip((im - (1 - a[..., None]) * bg) / np.maximum(a, 1e-3)[..., None], 0, 255)
    rgb[a == 0] = 0
    out = Image.fromarray(np.dstack([rgb, a * 255]).astype(np.uint8), 'RGBA')
    return out.crop(out.getbbox())


def classes(im):
    """HSV (0..1, hue unwrapped around red) and where her reds and greens are."""
    a = np.asarray(im)[..., 3]
    hsv = np.asarray(im.convert('RGB').convert('HSV')).astype(np.float32) / 255
    h = np.where(hsv[..., 0] < 0.5, hsv[..., 0] + 1, hsv[..., 0])
    s, v = hsv[..., 1], hsv[..., 2]
    lit = (a > 0) & (s > 0.3) & (v > 0.25)
    red = lit & ((h >= 0.8) & (h <= 1.06))
    green = lit & (h >= 1.22) & (h <= 1.5)
    return h, s, v, red, green


def recolour(im, ref):
    """Her reds and greens moved to the cut-out's: hue shifted, saturation and value scaled."""
    h, s, v, red, green = classes(im)
    rh, rs, rv, rred, rgreen = ref
    for mine, theirs in ((red, rred), (green, rgreen)):
        h[mine] += np.median(rh[theirs]) - np.median(h[mine])
        s[mine] *= np.median(rs[theirs]) / np.median(s[mine])
        v[mine] *= np.median(rv[theirs]) / np.median(v[mine])
    hsv = np.dstack([np.mod(h, 1), np.clip(s, 0, 1), np.clip(v, 0, 1)])
    rgb = Image.fromarray((hsv * 255).round().astype(np.uint8), 'HSV').convert('RGB')
    out = rgb.convert('RGBA')
    out.putalpha(im.getchannel('A'))
    return out


def eyes(im):
    """Her two eyes (the blue irises), as (left, right) centres in picture pixels."""
    a = np.asarray(im).astype(int)
    blue = (a[..., 2] > 150) & (a[..., 0] < 90) & (a[..., 1] < 170) & (a[..., 3] > 200)
    ys, xs = np.nonzero(blue)
    keep = np.abs(ys - np.median(ys)) < 0.04 * im.height + 20  # stray blue elsewhere isn't an eye
    ys, xs = ys[keep], xs[keep]
    cut = np.median(xs)
    left = (xs[xs < cut].mean(), ys[xs < cut].mean())
    right = (xs[xs >= cut].mean(), ys[xs >= cut].mean())
    return left, right


def soles(im):
    """Where her feet touch the ground on a walk drawing: (from, to) x spans along its bottom rows."""
    a = np.asarray(im)[..., 3] > 100
    xs = np.nonzero(a[-5:].any(axis=0))[0]
    return [(g[0], g[-1]) for g in np.split(xs, np.nonzero(np.diff(xs) > 8)[0] + 1) if len(g)]


def steps(feet):
    """How far she moves on into each walk drawing from the one before (cyclic): the foot she
    stands on is on the ground in both, that much further back in the later one. Of the ways the
    feet on the ground could pair up, it's the shortest move forward."""
    names = sorted(feet, key=lambda n: int(n[4:]))
    out = {}
    for prev, name in zip(names[-1:] + names[:-1], names):
        moves = [(a0 + a1) / 2 - (b0 + b1) / 2 for a0, a1 in feet[prev] for b0, b1 in feet[name]]
        ahead = [m for m in moves if m > 2]
        out[name] = min(ahead) if ahead else 0.0
    return out


def main():
    args = dict(a.split('=', 1) for a in sys.argv[1:])
    feet = {}  # walk drawings: where they touch the ground, in sprite px
    ref = classes(Image.open(CUTOUT).convert('RGBA'))
    apart = {}  # her eyes apart, in sprite px
    scale = {}  # sprite px per picture px
    # standing ones first (the others take their head size), in-betweens last
    for name in sorted(args, key=lambda n: (POSES[n]['kind'] not in ('stand', 'walk'), 'from' in POSES[n])):
        im, spec = key(args[name]), POSES[name]
        (lx, ly), (rx, ry) = eyes(im)
        ex, ey, span = (lx + rx) / 2, (ly + ry) / 2, np.hypot(rx - lx, ry - ly)
        if spec['kind'] in ('stand', 'walk'):
            k = scale[spec['from']] if 'from' in spec else (FEET[1] - FACE[1]) / (im.height - ey)
            x0, y0 = (FEET[0] + 10 if spec['kind'] == 'walk' else FACE[0]) - ex * k, FEET[1] - im.height * k
        elif spec['kind'] == 'air':
            k = apart[spec['like']] / span
            x0, y0 = FACE[0] - ex * k, FACE[1] - ey * k
        elif 'from' in spec:
            k = scale[spec['from']]
            x0, y0 = spec['mid'] - im.width * k / 2, HIP + 3 - im.height * k
        else:
            k = apart[spec['like']] / span
            x0, y0 = spec['mid'] - im.width * k / 2, HIP + 3 - im.height * k
        apart[name], scale[name] = span * k, k
        w, h = im.width * k, im.height * k
        im = recolour(im.resize((round(w), round(h)), Image.LANCZOS), ref)
        im.save(ASSETS / f'pose-{name}.png', optimize=True)
        if spec['kind'] == 'walk':
            feet[name] = [(x0 + a, x0 + b) for a, b in soles(im)]
        print(f"{name}: rect [{x0:.1f}, {y0:.1f}, {w:.1f}, {h:.1f}], face [{x0 + ex * k:.0f}, {y0 + ey * k:.0f}], eyes {span * k:.1f} apart")
    if feet:
        for name, step in steps(feet).items():
            print(f"{name}: step {step:.0f}  (feet on the ground at {[(round(a), round(b)) for a, b in feet[name]]})")


if __name__ == '__main__':
    main()
