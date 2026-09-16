"""Japanese instrument voices for the TSUKIPAD beds -- all synthesised, no samples.

Everything is vectorised numpy so a 16s bed renders in seconds. Plucked strings
are Karplus-Strong run a whole period at a time (each sample only depends on the
previous period, so a block can be computed at once) and then resampled to the
exact pitch, which also gives us bends for free. Filters are done in the
frequency domain because none of them need to be causal.

    koto      -- bright tsume pluck, optional oshide bend into the note
    shamisen  -- harder, brighter pluck with sawari buzz and a bachi slap
    shakuhachi-- breathy bamboo flute, scoop up, delayed vibrato
    sho       -- gagaku mouth-organ cluster, slow swell
    taiko / shime / ka / hyoshigi -- drums and clappers
    orin      -- temple bowl
"""
import numpy as np, wave

SR = 44100

# Scales as pitch-class offsets from the root.
IN_SCALE  = [0, 1, 5, 7, 8]      # miyako-bushi
HIRAJOSHI = [0, 2, 3, 7, 8]
YO_SCALE  = [0, 2, 5, 7, 9]

def scale_note(root, scale, degree):
    o, k = divmod(degree, len(scale))
    return root + 12 * o + scale[k]

def midi(n): return 440.0 * 2 ** ((n - 69) / 12.0)
def idx(t): return int(round(t * SR))
def tt(n): return np.arange(n) / SR
def clampv(x, a=0.0, b=1.0): return np.minimum(b, np.maximum(a, x))

class Mix:
    def __init__(self, dur):
        self.N = idx(dur); self.L = np.zeros(self.N); self.R = np.zeros(self.N)
    def add(self, sig, t, pan=0.0, gain=1.0):
        i = idx(t)
        if i >= self.N or i + len(sig) <= 0: return
        s = sig * gain
        if i < 0: s = s[-i:]; i = 0
        j = min(i + len(s), self.N); s = s[:j - i]
        # constant-power-ish pan
        self.L[i:j] += s * np.sqrt(0.5 * (1 - pan)) * 1.41
        self.R[i:j] += s * np.sqrt(0.5 * (1 + pan)) * 1.41
    def bus(self):
        m = Mix.__new__(Mix); m.N = self.N; m.L = np.zeros(self.N); m.R = np.zeros(self.N); return m
    def absorb(self, other, gain=1.0):
        self.L += other.L * gain; self.R += other.R * gain

# ------------------------------------------------------------------ dsp
def fftfilt(x, lo=None, hi=None, order=2):
    X = np.fft.rfft(x); fr = np.fft.rfftfreq(len(x), 1 / SR); H = np.ones_like(fr)
    if hi: H *= 1 / np.sqrt(1 + (fr / hi) ** (2 * order))
    if lo: H *= 1 / np.sqrt(1 + (lo / np.maximum(fr, 1e-6)) ** (2 * order))
    return np.fft.irfft(X * H, n=len(x))

def sweep_noise(dur, f0, f1, seed=7, curve=2.0, lo=None):
    """Noise through a lowpass whose cutoff moves f0 -> f1. Blends a handful of
    static filterings instead of running a time-varying filter."""
    n = idx(dur); nz = np.random.RandomState(seed).randn(n)
    cuts = np.geomspace(min(f0, f1), max(f0, f1), 8)
    bank = np.stack([fftfilt(nz, lo=lo, hi=c) for c in cuts])
    k = (np.arange(n) / n) ** curve
    if f1 < f0: k = 1 - k
    pos = k * (len(cuts) - 1); i0 = np.floor(pos).astype(int).clip(0, len(cuts) - 2); fr = pos - i0
    return bank[i0, np.arange(n)] * (1 - fr) + bank[i0 + 1, np.arange(n)] * fr

def _conv(x, ir):
    nfft = 1 << int(np.ceil(np.log2(len(x) + len(ir))))
    return np.fft.irfft(np.fft.rfft(x, nfft) * np.fft.rfft(ir, nfft), nfft)[:len(x)]

def reverb(mix, t60=2.4, wet=0.22, damp=5200, seed=11, pre=0.018):
    n = idx(t60); t = tt(n); out = []
    for ch, s in ((mix.L, seed), (mix.R, seed + 1)):
        ir = np.random.RandomState(s).randn(n) * 10 ** (-3 * t / t60)
        ir = fftfilt(ir, lo=180, hi=damp)
        ir[:idx(pre)] = 0; ir /= np.sqrt((ir ** 2).sum())
        out.append(_conv(ch, ir))
    mix.L = mix.L + out[0] * wet * 6; mix.R = mix.R + out[1] * wet * 6

def master(mix, path, drive=0.9, ceil=0.89, fade_in=0.03, fade_out=0.8):
    L = np.tanh(mix.L * drive); R = np.tanh(mix.R * drive)
    pk = max(np.abs(L).max(), np.abs(R).max()); L, R = L / pk * ceil, R / pk * ceil
    fi, fo = idx(fade_in), idx(fade_out)
    if fi: L[:fi] *= np.linspace(0, 1, fi); R[:fi] *= np.linspace(0, 1, fi)
    L[-fo:] *= np.linspace(1, 0, fo) ** 1.5; R[-fo:] *= np.linspace(1, 0, fo) ** 1.5
    inter = np.empty(len(L) * 2); inter[0::2] = L; inter[1::2] = R
    with wave.open(path, 'wb') as w:
        w.setnchannels(2); w.setsampwidth(2); w.setframerate(SR)
        w.writeframes((inter * 32767).astype('<i2').tobytes())

# ------------------------------------------------------------ strings
def _ks(f, dur, t60, a=0.5, pluck=0.14, bright=1.0, seed=0, bend=None):
    """Block Karplus-Strong. `bend(t)` returns semitones of offset over time."""
    n = idx(dur)
    P = max(4, int(SR / f)); f_nat = SR / (P + (1 - a))
    semis = bend(tt(n)) if bend is not None else np.zeros(n)
    rate = f * 2 ** (semis / 12) / f_nat
    pos = np.concatenate([[0], np.cumsum(rate)[:-1]])
    m = int(pos[-1]) + 3 * P + 4
    rng = np.random.RandomState(seed)
    exc = rng.uniform(-1, 1, P)
    if bright < 1.0:
        for _ in range(int((1 - bright) * 6)): exc = 0.5 * (exc + np.roll(exc, 1))
    exc = exc - np.roll(exc, max(1, int(P * pluck)))           # pluck position
    exc -= exc.mean()
    g = 10 ** (-3 / (t60 * f_nat))
    y = np.zeros(m + 1)                                         # y[j] is sample j-1
    y[1:P + 1] = exc
    for s in range(P, m, P):
        e = min(s + P, m)
        y[s + 1:e + 1] = g * (a * y[s + 1 - P:e + 1 - P] + (1 - a) * y[s - P:e - P])
    y = y[1:]
    y /= (np.abs(y[:4 * P]).max() + 1e-9)                        # every pluck starts at unity
    return np.interp(pos, np.arange(m), y)

def koto(note, dur=1.8, g=1.0, bend=0.0, bend_t=0.12, vib=0.0, seed=0):
    """bend > 0: string pressed sharp then released onto the note (or the
    reverse with a negative value), the koto's signature ornament."""
    f = midi(note)
    def bf(t):
        b = bend * np.exp(-t / bend_t) if bend else 0 * t
        return b + vib * clampv((t - 0.25) / 0.4) * np.sin(2 * np.pi * 5.5 * t)
    t60 = float(np.clip(3.2 - (note - 55) * 0.05, 0.9, 3.4))
    s = _ks(f, dur, t60, a=0.62, pluck=0.12, seed=seed, bend=bf)
    n = len(s); t = tt(n)
    click = fftfilt(np.random.RandomState(seed + 99).randn(n), lo=2200, hi=7000) * np.exp(-t * 260) * 0.35
    body = fftfilt(s, lo=140, hi=6500)
    env = clampv(t / 0.002) * clampv((dur - t) / 0.06)
    return (body * 0.9 + click) * env * 0.42 * g

def shamisen(note, dur=0.9, g=1.0, bend=0.0, seed=0):
    f = midi(note)
    bf = (lambda t: bend * np.exp(-t / 0.08)) if bend else None
    s = _ks(f, dur, t60=0.75, a=0.86, pluck=0.08, seed=seed, bend=bf)
    n = len(s); t = tt(n)
    s = s + 0.35 * np.tanh(s * 4) * np.exp(-t * 3)                # sawari buzz
    slap = fftfilt(np.random.RandomState(seed + 5).randn(n), lo=900, hi=4800) * np.exp(-t * 90) * 0.55
    thump = np.sin(2 * np.pi * 190 * t) * np.exp(-t * 45) * 0.5
    env = clampv(t / 0.001) * clampv((dur - t) / 0.03)
    return (fftfilt(s, lo=160) * 0.8 + slap + thump) * env * 0.42 * g

# -------------------------------------------------------------- winds
def shakuhachi(note, dur, g=1.0, scoop=-1.2, vib=0.22, fall=0.0, seed=0, breath=1.0):
    n = idx(dur); t = tt(n); f0 = midi(note)
    semis = (scoop * np.exp(-t * 9)
             + vib * clampv((t - 0.25) / 0.6) ** 2 * np.sin(2 * np.pi * 5.1 * t + 0.3 * np.sin(2 * np.pi * 0.7 * t))
             - fall * clampv((t - (dur - 0.3)) / 0.3) ** 2)
    ph = 2 * np.pi * np.cumsum(f0 * 2 ** (semis / 12)) / SR
    tone = np.sin(ph) + 0.20 * np.sin(2 * ph + 0.4) + 0.07 * np.sin(3 * ph) + 0.025 * np.sin(4 * ph)
    rng = np.random.RandomState(seed)
    air = fftfilt(rng.randn(n), lo=f0 * 0.8, hi=f0 * 2.6, order=3)
    air /= (np.sqrt((air ** 2).mean()) + 1e-9)
    hiss = fftfilt(rng.randn(n), lo=2500, hi=8000); hiss /= (np.sqrt((hiss ** 2).mean()) + 1e-9)
    swell = (1 - np.exp(-t * 14)) * (1 + 0.45 * np.exp(-t * 5)) * clampv((dur - t) / 0.16)
    puff = 0.9 * np.exp(-t * 11) + 0.10
    # the tone rides on the breath: slight amplitude flutter
    flutter = 1 + 0.06 * np.sin(2 * np.pi * 7.3 * t) * clampv(t / 0.4)
    s = tone * swell * flutter * 0.55 + (air * 0.10 + hiss * 0.02) * puff * swell * breath
    return s * 0.5 * g

def sho(notes, dur, g=1.0, attack=1.2):
    n = idx(dur); t = tt(n); s = np.zeros(n)
    for k, m in enumerate(notes):
        f = midi(m) * (1 + 0.0012 * (k - len(notes) / 2))
        ph = 2 * np.pi * f * t + k
        s += np.sin(ph) + 0.45 * np.sin(2 * ph) + 0.25 * np.sin(3 * ph) + 0.12 * np.sin(5 * ph)
    s /= len(notes)
    env = clampv(t / attack) ** 1.6 * clampv((dur - t) / 0.9)
    return fftfilt(s, hi=3200) * env * (1 + 0.04 * np.sin(2 * np.pi * 0.4 * t)) * 0.30 * g

# -------------------------------------------------------------- drums
def taiko(g=1.0, pitch=1.0, seed=0, dur=1.6):
    """Odaiko: huge low membrane, pitch drops as the skin settles."""
    n = idx(dur); t = tt(n); rng = np.random.RandomState(seed)
    f = (54 + 70 * np.exp(-t * 22)) * pitch
    ph = 2 * np.pi * np.cumsum(f) / SR
    body = np.sin(ph) * np.exp(-t * 3.4)
    m2 = np.sin(ph * 1.59 + 0.5) * np.exp(-t * 7) * 0.35
    m3 = np.sin(ph * 2.14 + 1.1) * np.exp(-t * 11) * 0.18
    skin = fftfilt(rng.randn(n), hi=700) * np.exp(-t * 20) * 0.9
    stick = fftfilt(rng.randn(n), lo=1200, hi=4500) * np.exp(-t * 110) * 0.30
    return np.tanh((body + m2 + m3 + skin + stick) * 1.5) * 0.9 * g

def shime(g=1.0, seed=0, pitch=1.0):
    """Shime-daiko: tight, high, cracking."""
    n = idx(0.35); t = tt(n); rng = np.random.RandomState(seed)
    f = (330 + 140 * np.exp(-t * 60)) * pitch
    tone = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * 26)
    crack = fftfilt(rng.randn(n), lo=1500, hi=6500) * np.exp(-t * 70) * 0.7
    return np.tanh((tone + crack) * 1.3) * 0.42 * g

def ka(g=1.0, seed=0):
    """Rim of the drum."""
    n = idx(0.12); t = tt(n)
    w = np.sin(2 * np.pi * 1750 * t) * np.exp(-t * 95) + 0.6 * np.sin(2 * np.pi * 2900 * t) * np.exp(-t * 130)
    nz = fftfilt(np.random.RandomState(seed).randn(n), lo=1800, hi=6000) * np.exp(-t * 160)
    return (w + nz * 0.8) * 0.30 * g

def hyoshigi(g=1.0, seed=0):
    """Two hardwood clappers -- the kabuki 'curtain' clack."""
    n = idx(0.5); t = tt(n)
    ring = (np.sin(2 * np.pi * 2230 * t) + 0.7 * np.sin(2 * np.pi * 3410 * t + 1) + 0.35 * np.sin(2 * np.pi * 5120 * t)) * np.exp(-t * 32)
    snap = fftfilt(np.random.RandomState(seed).randn(n), lo=1200, hi=9000) * np.exp(-t * 400) * 2.2
    return np.tanh((ring * 0.6 + snap)) * 0.55 * g

def orin(note=74, dur=4.5, g=1.0):
    n = idx(dur); t = tt(n); f = midi(note); s = np.zeros(n)
    for r, a, d in ((1.0, 1.0, 0.55), (2.71, 0.55, 1.1), (5.03, 0.30, 2.0), (8.1, 0.14, 3.4)):
        beat = 1 + 0.25 * np.sin(2 * np.pi * (0.9 * r) * t)
        s += a * np.sin(2 * np.pi * f * r * t) * np.exp(-t * d) * beat
    strike = fftfilt(np.random.RandomState(4).randn(n), lo=2000) * np.exp(-t * 300) * 0.3
    return (s * 0.28 + strike) * clampv(t / 0.002) * g

# -------------------------------------------------------- modern kit
def kick(g=1.0, dec=6.0):
    n = idx(0.45); t = tt(n)
    f = 44 + 160 * np.exp(-t * 28)
    b = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * dec)
    c = np.random.RandomState(1).randn(n) * np.exp(-t * 400) * 0.3
    return np.tanh((b + c) * 1.8) * 0.85 * g

def bass808(note, dur, g=1.0, glide_from=None, glide_t=0.08):
    n = idx(dur); t = tt(n); f = midi(note)
    if glide_from is not None:
        f = midi(note) + (midi(glide_from) - midi(note)) * np.exp(-t / glide_t)
    ph = 2 * np.pi * np.cumsum(np.broadcast_to(f, (n,))) / SR
    s = np.sin(ph) * np.exp(-t * 1.1) * clampv((dur - t) / 0.05)
    return np.tanh(s * 2.6) * 0.55 * g

def clap(g=1.0, seed=0):
    n = idx(0.4); t = tt(n); nz = fftfilt(np.random.RandomState(seed).randn(n), lo=900, hi=5200)
    e = np.zeros(n)
    for k, o in enumerate((0.0, 0.011, 0.023)):
        tk = t - o; e += (tk >= 0) * np.exp(-np.maximum(tk, 0) * (220 if k < 2 else 26))
    return nz * e * 0.32 * g

def hat(g=1.0, seed=3, dec=90):
    n = idx(0.06 if dec > 50 else 0.3); t = tt(n)
    return fftfilt(np.random.RandomState(seed).randn(n), lo=7200) * np.exp(-t * dec) * 0.20 * g

def sub(note, dur, g=1.0):
    n = idx(dur); t = tt(n); f = midi(note)
    s = np.sin(2 * np.pi * f * t) + 0.2 * np.sin(4 * np.pi * f * t)
    return s * clampv(t / 0.01) * clampv((dur - t) / 0.12) * 0.5 * g

def riser(dur, g=1.0, seed=7):
    n = idx(dur); k = np.arange(n) / n
    return sweep_noise(dur, 250, 9000, seed=seed, curve=2.2, lo=150) * k ** 2.2 * 0.5 * g

def whoosh(dur=0.5, g=1.0, seed=9):
    n = idx(dur); k = np.arange(n) / n
    s = sweep_noise(dur, 400, 6000, seed=seed, curve=0.7, lo=300)
    return s * np.sin(np.pi * k) ** 2 * 0.45 * g

def downer(dur=1.2, g=1.0, seed=21):
    n = idx(dur); k = np.arange(n) / n
    return sweep_noise(dur, 9000, 200, seed=seed, curve=0.6) * (1 - k) ** 2 * 0.5 * g
