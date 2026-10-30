"""Builds the cut-in strips and her faces (the panel portrait) in assets/capri/ from frames of the show.

Source: the "Capri Cyberpunk2" GIF on Tenor (Edgerunners 2 footage, 148 frames), its 498x498 version
(the sharpest one: the webp and mp4 versions smear the colours):
https://tenor.com/view/capri-cyberpunk2-cyberpunk-2-edgerunners-2-cyberpunk-edgerunners-2-capricorn-gif-5541033963201170705
https://media1.tenor.com/m/TOW1CCj7DREAAAAC/capri-cyberpunk2-cyberpunk-2.gif
plus assets/capri/capri-face.png (from the reference stills; it is also her "grin" face).

    python tools/build-cutins.py path/to/capri.gif

Needs Pillow.
"""
import sys
from pathlib import Path
from PIL import Image, ImageSequence

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / 'assets' / 'capri'
CUTIN = (360, 240)    # 3:2, what fx.js expects
FACE = (256, 256)
BASE = 374            # the crop boxes below are for a 374x374 frame; they scale with the GIF

# (frame, crop box)
CUTINS = {
    'laugh': (138, (40, 64, 374, 287)),   # two eyes over the gaping jagged mouth
    'eyes': (135, (0, 128, 374, 377)),    # extreme close-up, the big eyes
    'many': (123, (0, 62, 374, 311)),     # the face covered in eyes
    'look': (99, (0, 74, 374, 323)),      # looking at you, zigzag grin above
}
# her expressions, for the panel portrait (panel.js FACES)
FACES = {
    'calm': (6, (85, 55, 275, 245)),      # watching, mouth shut
    'aside': (36, (55, 40, 245, 230)),    # turned away: a sigh, thinking
    'smug': (57, (80, 40, 270, 230)),     # the fang grin, head cocked
    'wide': (90, (60, 45, 280, 265)),     # eyes gone round, mouth open: surprised
    'look': (99, (34, 58, 334, 358)),     # looking right at you
    'laugh': (138, (92, 26, 374, 308)),   # mouth wide open
    'many': (123, (12, 12, 362, 362)),    # all her eyes on you
}


def possessed(face):
    """Her face with Erebus in her (panel.js FACES.erebus): his colours over hers, as in pose-erebus.png
    (her green skin gone black, her pinks his crimson, her eyes his one burning pink), torn by the
    Blackwall (slices of her shifted, scanlines)."""
    import random
    src = face.convert('RGB')
    out = Image.new('RGB', src.size)
    px, po = src.load(), out.load()
    lerp = lambda a, b, t: tuple(round(a[i] + (b[i] - a[i]) * t) for i in range(3))
    for y in range(src.height):
        for x in range(src.width):
            r, g, b = px[x, y]
            lum = (0.3 * r + 0.59 * g + 0.11 * b) / 255
            if b > r + 25 and b > g + 10:      # her eyes: his glow, white at the core
                po[x, y] = lerp((235, 30, 120), (255, 225, 240), min(1, lum * 1.6))
            elif g > r + 20 and g > b:         # her skin: his black, a dark red sheen on it
                po[x, y] = lerp((4, 0, 2), (34, 0, 8), lum)
            elif r > g + 20:                   # her pinks and reds: his crimson
                po[x, y] = lerp((90, 0, 14), (230, 20, 48), lum)
            else:                              # black lines stay black, her white grin goes hot pink
                po[x, y] = lerp((6, 0, 3), (255, 120, 150), lum)
    rnd = random.Random(7)
    for _ in range(6):                         # torn: a few bands of her slid sideways
        top = rnd.randrange(0, src.height - 12)
        band = out.crop((0, top, src.width, top + rnd.randrange(4, 14)))
        out.paste(band, (rnd.choice((-1, 1)) * rnd.randrange(5, 16), top))
    po = out.load()
    for y in range(0, src.height, 3):          # scanlines
        for x in range(src.width):
            r, g, b = po[x, y]
            po[x, y] = (r * 3 // 4, g * 3 // 4, b * 3 // 4)
    return out


def main():
    # her possessed face only, from her own: python tools/build-cutins.py --erebus
    if sys.argv[1:] == ['--erebus']:
        possessed(Image.open(OUT / 'face-look.png')).save(OUT / 'face-erebus.png', optimize=True)
        print('face-erebus.png written to', OUT)
        return
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    frames = [f.convert('RGB') for f in ImageSequence.Iterator(Image.open(sys.argv[1]))]
    k = frames[0].width / BASE
    crop = lambda i, box: frames[i].crop(tuple(round(v * k) for v in box))
    for name, (i, box) in CUTINS.items():
        crop(i, box).resize(CUTIN, Image.LANCZOS).save(OUT / f'cutin-{name}.png', optimize=True)
    for name, (i, box) in FACES.items():
        crop(i, box).resize(FACE, Image.LANCZOS).save(OUT / f'face-{name}.png', optimize=True)
    # the grin from the stills, same format as the cut-ins
    face = Image.open(OUT / 'capri-face.png').convert('RGB')
    face.crop((16, 58, 241, 208)).resize(CUTIN, Image.LANCZOS).save(OUT / 'cutin-grin.png', optimize=True)
    print('cut-ins and faces written to', OUT)


if __name__ == '__main__':
    main()
