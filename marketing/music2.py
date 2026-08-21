"""Second trailer bed: 150 BPM, D minor, 16s / 10 bars.

Deliberately faster and drier than the 120 BPM manifesto track so the two
posts don't sound like the same video recut. Same rule: synthesised, so X
can't flag it.
"""
import numpy as np, wave

SR, BPM = 44100, 150.0
BEAT = 60.0 / BPM            # 0.4s
BAR  = BEAT * 4              # 1.6s
DUR  = BAR * 10              # 16s
N    = int(DUR * SR)
L = np.zeros(N); R = np.zeros(N)

def midi(n): return 440.0 * 2 ** ((n - 69) / 12.0)
def idx(t):  return int(t * SR)

def add(sig, t, pan=0.0, gain=1.0):
    i = idx(t); j = min(i + len(sig), N)
    if i >= N: return
    s = sig[: j - i] * gain
    L[i:j] += s * (1 - max(0.0, pan)); R[i:j] += s * (1 + min(0.0, pan))

def env(n, a, d, sl=0.0, r=0.0):
    a, d, r = int(a*SR), int(d*SR), int(r*SR)
    sus = max(0, n - a - d - r)
    return np.concatenate([
        np.linspace(0,1,a,endpoint=False) if a else np.array([]),
        np.linspace(1,sl,d,endpoint=False) if d else np.array([]),
        np.full(sus, sl),
        np.linspace(sl,0,r) if r else np.array([]),
    ])[:n]

def lowpass(x, cutoff):
    a = np.exp(-2*np.pi*np.asarray(cutoff,dtype=float)/SR)
    a = np.broadcast_to(a, x.shape).copy()
    y = np.zeros_like(x); prev = 0.0
    for k in range(len(x)):
        prev = (1-a[k])*x[k] + a[k]*prev; y[k] = prev
    return y

def saw(f, n, detune=0.0):
    t = np.arange(n)/SR
    ph = 2*np.pi*f*t if np.isscalar(f) else 2*np.pi*np.cumsum(f)/SR
    o = 2*(ph/(2*np.pi) % 1.0) - 1.0
    if detune:
        p2 = ph*(1+detune); o = 0.5*o + 0.5*(2*(p2/(2*np.pi) % 1.0) - 1.0)
    return o

def kick():
    n = idx(0.34); t = np.arange(n)/SR
    f = 50 + 165*np.exp(-t*36)
    body = np.sin(2*np.pi*np.cumsum(f)/SR)*np.exp(-t*9.0)
    click = np.random.RandomState(1).randn(n)*np.exp(-t*500)*0.55
    return np.tanh((body+click)*1.85)*0.95

def sub(note, beats):
    n = idx(beats*BEAT); t = np.arange(n)/SR; f = midi(note)
    s = np.sin(2*np.pi*f*t) + 0.3*np.sin(4*np.pi*f*t)
    return s*env(n,0.005,0.04,sl=0.8,r=0.07)*0.60

def hat(open_=False):
    d = 0.13 if open_ else 0.036
    n = idx(d); t = np.arange(n)/SR
    nz = np.random.RandomState(2 if open_ else 3).randn(n)
    return (nz - lowpass(nz, 8000))*np.exp(-t*(16 if open_ else 78))*0.30

def clap():
    n = idx(0.20); t = np.arange(n)/SR
    nz = np.random.RandomState(5).randn(n)
    bp = lowpass(nz, 3000) - lowpass(nz, 900)
    burst = np.ones(n)
    for o in (0.0, 0.010, 0.021):                  # three-slap clap
        k = idx(o); burst[k:] += 0.8
    return bp*burst*np.exp(-t*22)*0.42

def arp(note, beats, bright):
    n = idx(beats*BEAT); t = np.arange(n)/SR
    s = saw(midi(note), n, detune=0.005)
    s = lowpass(s, bright*np.exp(-t*7) + 800)
    return s*env(n,0.003,0.08,sl=0.28,r=0.10)*0.30

def stab(notes, beats):
    n = idx(beats*BEAT); t = np.arange(n)/SR
    s = sum(saw(midi(m), n, detune=0.007) for m in notes)/len(notes)
    s = lowpass(s, 3800*np.exp(-t*4)+520)
    return s*env(n,0.006,0.18,sl=0.26,r=0.24)*0.33

def riser(dur, f0=250, f1=6500):
    n = idx(dur); t = np.arange(n)/SR; k = t/dur
    nz = lowpass(np.random.RandomState(7).randn(n), f0+(f1-f0)*k**2.3)
    tone = np.sin(2*np.pi*np.cumsum(midi(50)*(1+1.9*k**2))/SR)
    return (nz*2.0 + tone*0.3)*(k**1.8)*0.44

def impact():
    n = idx(1.6); t = np.arange(n)/SR
    boom = np.sin(2*np.pi*np.cumsum(40+70*np.exp(-t*10))/SR)*np.exp(-t*3.0)
    crash = lowpass(np.random.RandomState(11).randn(n), 10000)*np.exp(-t*4.0)
    return np.tanh(boom*1.6 + crash*0.6)*0.74

# D minor. One chord move per pair of bars, matching the step cuts.
ROOTS = [26, 26, 26, 31, 31, 29, 29, 26, 26, 26]
CHORD = {26:[50,53,57], 31:[55,58,62], 29:[53,57,60]}

for b in range(10):
    t0 = b*BAR; root = ROOTS[b]

    if b == 0:                                    # title card: air only
        add(riser(BAR, 200, 3000), t0, gain=0.7)
        add(sub(root, 4)*0.5, t0)

    if 1 <= b <= 9:
        for beat in range(4):
            t = t0 + beat*BEAT
            add(kick(), t)
            add(sub(root, 1), t + 0.010, gain=0.9)
            if beat % 2 == 1: add(clap(), t, pan=0.15, gain=0.85)
            add(hat(open_=(beat == 3)), t + BEAT/2, pan=0.28, gain=0.85)
            if b >= 5:
                for k in (0.25, 0.75): add(hat(), t + BEAT*k, pan=-0.22, gain=0.5)

    if 2 <= b <= 9:                               # arp from step 01 onward
        pat = [0, 7, 12, 7, 15, 12, 7, 3]
        for k, st in enumerate(pat):
            add(arp(root + 24 + st, 0.5, 3600 + 480*b),
                t0 + k*BEAT/2, pan=(-0.3 if k % 2 else 0.3), gain=0.9)

    if 3 <= b <= 9:
        add(stab(CHORD[root], 2), t0, gain=0.9)
        add(stab(CHORD[root], 1), t0 + BEAT*2.5, gain=0.6)

    if b == 6: add(riser(BAR, 350, 8000), t0, gain=0.95)   # into the payoff
    if b == 7: add(impact(), t0, gain=0.9)
    if b == 9:                                            # endcard tail
        add(impact(), t0, gain=0.8); add(stab(CHORD[root], 4), t0, gain=0.6)

L = np.tanh(L*0.85)*1.05; R = np.tanh(R*0.85)*1.05
pk = max(np.abs(L).max(), np.abs(R).max())
L, R = L/pk*0.89, R/pk*0.89
fi, fo = idx(0.05), idx(0.35)
L[:fi] *= np.linspace(0,1,fi); R[:fi] *= np.linspace(0,1,fi)
L[-fo:] *= np.linspace(1,0,fo); R[-fo:] *= np.linspace(1,0,fo)
inter = np.empty(N*2); inter[0::2] = L; inter[1::2] = R
with wave.open('trailer2_audio.wav','wb') as w:
    w.setnchannels(2); w.setsampwidth(2); w.setframerate(SR)
    w.writeframes((inter*32767).astype('<i2').tobytes())
print(f'wrote trailer2_audio.wav  {DUR}s  {BPM:.0f}bpm  bar={BAR}s')
