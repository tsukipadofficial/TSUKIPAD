"""Original trailer bed for TSUKIPAD. 120 BPM, F minor, 24s / 12 bars.

Written rather than sourced: X mutes or flags licensed audio, and a launch
trailer that gets silenced on upload is worse than one with no sound.
Everything here is generated from oscillators, so the track is ours outright.
"""
import numpy as np, wave, struct

SR   = 44100
BPM  = 120.0
BEAT = 60.0 / BPM          # 0.5s
BAR  = BEAT * 4            # 2.0s  -> every scene cut lands on a bar
DUR  = BAR * 12            # 24s
N    = int(DUR * SR)

L = np.zeros(N); R = np.zeros(N)

def midi(n):  return 440.0 * 2 ** ((n - 69) / 12.0)
def idx(t):   return int(t * SR)

def add(buf_l, buf_r, sig, t, pan=0.0, gain=1.0):
    i = idx(t); j = min(i + len(sig), N)
    if i >= N: return
    s = sig[: j - i] * gain
    buf_l[i:j] += s * (1 - max(0.0, pan)); buf_r[i:j] += s * (1 + min(0.0, pan))

def env(n, a, d, s=0.0, sl=0.0, r=0.0):
    """ADSR in samples-from-seconds."""
    a, d, r = int(a * SR), int(d * SR), int(r * SR)
    sus = max(0, n - a - d - r)
    return np.concatenate([
        np.linspace(0, 1, a, endpoint=False) if a else np.array([]),
        np.linspace(1, sl, d, endpoint=False) if d else np.array([]),
        np.full(sus, sl),
        np.linspace(sl, 0, r) if r else np.array([]),
    ])[:n]

def lowpass(x, cutoff):
    """One-pole, cutoff in Hz (scalar or per-sample array)."""
    a = np.exp(-2 * np.pi * np.asarray(cutoff, dtype=float) / SR)
    a = np.broadcast_to(a, x.shape).copy()
    y = np.zeros_like(x); prev = 0.0
    for k in range(len(x)):
        prev = (1 - a[k]) * x[k] + a[k] * prev
        y[k] = prev
    return y

def saw(f, n, detune=0.0):
    t = np.arange(n) / SR
    if np.isscalar(f): ph = 2 * np.pi * f * t
    else:              ph = 2 * np.pi * np.cumsum(f) / SR
    out = 2 * (ph / (2 * np.pi) % 1.0) - 1.0
    if detune:
        ph2 = ph * (1 + detune)
        out = 0.5 * out + 0.5 * (2 * (ph2 / (2 * np.pi) % 1.0) - 1.0)
    return out

# --- voices ---------------------------------------------------------------
def kick():
    n = idx(0.42); t = np.arange(n) / SR
    f = 48 + 150 * np.exp(-t * 32)                       # pitch drop
    body = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * 7.5)
    click = (np.random.RandomState(1).randn(n) * np.exp(-t * 420)) * 0.5
    return np.tanh((body + click) * 1.7) * 0.95

def sub(note, beats):
    n = idx(beats * BEAT); t = np.arange(n) / SR
    f = midi(note)
    s = np.sin(2 * np.pi * f * t) + 0.28 * np.sin(4 * np.pi * f * t)
    return s * env(n, 0.006, 0.05, sl=0.85, r=0.09) * 0.62

def hat(open_=False):
    d = 0.16 if open_ else 0.045
    n = idx(d); t = np.arange(n) / SR
    noise = np.random.RandomState(2 if open_ else 3).randn(n)
    hp = noise - lowpass(noise, 7000)                    # crude high-pass
    return hp * np.exp(-t * (14 if open_ else 62)) * 0.3

def arp(note, beats, bright=5200):
    n = idx(beats * BEAT); t = np.arange(n) / SR
    s = saw(midi(note), n, detune=0.004)
    s = lowpass(s, bright * np.exp(-t * 6) + 700)        # plucky filter sweep
    return s * env(n, 0.004, 0.10, sl=0.34, r=0.14) * 0.30

def stab(notes, beats):
    n = idx(beats * BEAT); t = np.arange(n) / SR
    s = sum(saw(midi(m), n, detune=0.006) for m in notes) / len(notes)
    s = lowpass(s, 3400 * np.exp(-t * 3) + 500)
    return s * env(n, 0.008, 0.22, sl=0.30, r=0.30) * 0.34

def riser(dur, f0=200, f1=3000):
    n = idx(dur); t = np.arange(n) / SR; k = t / dur
    noise = np.random.RandomState(7).randn(n)
    swept = lowpass(noise, f0 + (f1 - f0) * k ** 2.2)
    tone  = np.sin(2 * np.pi * np.cumsum(midi(53) * (1 + 1.6 * k ** 2)) / SR)
    return (swept * 1.9 + tone * 0.30) * (k ** 1.7) * 0.42

def impact():
    n = idx(2.0); t = np.arange(n) / SR
    boom = np.sin(2 * np.pi * np.cumsum(38 + 60 * np.exp(-t * 9)) / SR) * np.exp(-t * 2.6)
    crash = lowpass(np.random.RandomState(11).randn(n), 9000) * np.exp(-t * 3.4)
    return np.tanh((boom * 1.5 + crash * 0.55)) * 0.72

# --- arrangement ----------------------------------------------------------
# F minor. Root per bar drives sub + arp.
ROOTS = [29, 29, 29, 29, 32, 32, 27, 27, 29, 29, 29, 29]   # F1 F1 F1 F1 Ab1 Ab1 Eb1 Eb1 F1..
CHORD = {29: [53, 56, 60], 32: [56, 60, 63], 27: [51, 55, 58]}

for b in range(12):
    t0 = b * BAR
    root = ROOTS[b]

    # intro pad-ish sub drone (bars 1-2), full drums from bar 3
    if b < 2:
        add(L, R, sub(root, 4) * 0.55, t0)
    if b == 1:
        add(L, R, riser(BAR, 180, 4200), t0, gain=0.85)

    if 2 <= b <= 9 or b == 11:
        drive = (b != 11)
        for beat in range(4):
            t = t0 + beat * BEAT
            if drive:
                add(L, R, kick(), t, gain=1.0)
                add(L, R, sub(root, 1), t + 0.012, gain=0.9)
            # hats: 8ths, 16ths during the bar-9/10 build
            add(L, R, hat(open_=(beat == 3)), t + BEAT / 2, pan=0.25, gain=0.9)
            if b in (8, 9):
                for k in (0.25, 0.75):
                    add(L, R, hat(), t + BEAT * k, pan=-0.2, gain=0.55)

    # arp from bar 3, brighter as it goes
    if 2 <= b <= 9:
        pat = [0, 3, 7, 12, 7, 3, 10, 7]
        for k, step in enumerate(pat):
            bright = 3800 + 420 * b
            add(L, R, arp(root + 24 + step, 0.5, bright),
                t0 + k * BEAT / 2, pan=(-0.3 if k % 2 else 0.3), gain=0.9)

    # chord stabs once the mechanism copy lands
    if 4 <= b <= 9:
        add(L, R, stab(CHORD[root], 2), t0, gain=0.9)
        add(L, R, stab(CHORD[root], 1), t0 + BEAT * 2.5, gain=0.62)

    # build into the logo hit
    if b == 9:
        add(L, R, riser(BAR, 300, 7000), t0, gain=1.0)

    # bar 11 = impact + breakdown under the wordmark
    if b == 10:
        add(L, R, impact(), t0, gain=1.0)
        add(L, R, sub(root - 12, 4), t0, gain=0.75)
        add(L, R, stab(CHORD[root], 4), t0, gain=0.75)

    # bar 12 = tail out under the URL card
    if b == 11:
        add(L, R, sub(root, 4), t0, gain=0.55)
        add(L, R, stab(CHORD[root], 4), t0, gain=0.5)

# --- master ---------------------------------------------------------------
def master(x):
    x = np.tanh(x * 0.82) * 1.06                 # soft clip / glue
    return x

L, R = master(L), master(R)
peak = max(np.abs(L).max(), np.abs(R).max())
L, R = L / peak * 0.89, R / peak * 0.89

# 60ms fade in, 400ms fade out so it never clicks
fi, fo = idx(0.06), idx(0.40)
L[:fi] *= np.linspace(0, 1, fi); R[:fi] *= np.linspace(0, 1, fi)
L[-fo:] *= np.linspace(1, 0, fo); R[-fo:] *= np.linspace(1, 0, fo)

inter = np.empty(N * 2); inter[0::2] = L; inter[1::2] = R
pcm = (inter * 32767).astype('<i2').tobytes()
with wave.open('trailer_audio.wav', 'wb') as w:
    w.setnchannels(2); w.setsampwidth(2); w.setframerate(SR); w.writeframes(pcm)
print(f'wrote trailer_audio.wav  {DUR:.1f}s  {BPM:.0f}bpm  bar={BAR}s  peak={peak:.2f}')
