# Her construct sound on top of the cloned voice: the original isn't just a voice, it's a little electronic.
# A light EQ toward the reference's tone, a shadow of her voice an octave down, a feedback comb (a hint of tin)
# and a bit-crushed copy (digital grain), each mixed in by its profile's amount times the strength you set.
import numpy as np
import librosa
from scipy.signal import butter, lfilter, sosfilt


def eq(x, sr):
    # the cloned voice comes out ~3 dB heavier under 200 Hz and ~2 dB duller over 1.6 kHz than the dub
    lo = sosfilt(butter(2, 200, 'low', fs=sr, output='sos'), x)
    hi = sosfilt(butter(2, 1600, 'high', fs=sr, output='sos'), x)
    return x - 0.3 * lo + 0.25 * hi


def octave(x, sr, mix):
    return (1 - mix) * x + mix * librosa.effects.pitch_shift(x, sr=sr, n_steps=-12)


def comb(x, sr, mix, ms=1.2, fb=0.45):
    d = int(sr * ms / 1000)
    a = np.zeros(d + 1)
    a[0], a[d] = 1, -fb
    return (1 - mix) * x + mix * lfilter([1], a, x) * (1 - fb)


def crush(x, sr, mix, rate=11025, bits=9):
    step = sr / rate
    y = x[np.clip((np.floor(np.arange(len(x)) / step) * step).astype(int), 0, len(x) - 1)]
    q = 2 ** (bits - 1)
    return (1 - mix) * x + mix * np.round(y * q) / q


def apply(x, sr, fx, strength=1.0):
    """fx: the profile's { eq, octave, comb, crush }; strength 0 leaves her voice as cloned."""
    x = np.asarray(x, dtype=np.float32)
    if strength <= 0 or not fx:
        return x
    if fx.get('eq'):
        x = eq(x, sr)
    k = min(strength, 2.0)
    if fx.get('octave'):
        x = octave(x, sr, min(0.6, fx['octave'] * k))
    if fx.get('comb'):
        x = comb(x, sr, min(0.8, fx['comb'] * k))
    if fx.get('crush'):
        x = crush(x, sr, min(0.7, fx['crush'] * k))
    peak = float(np.abs(x).max()) if len(x) else 0
    return (x * (0.95 / peak) if peak > 0.95 else x).astype(np.float32)
