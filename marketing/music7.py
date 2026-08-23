"""Traders piece bed. 120 BPM, C minor into Eb, 16s / 8 bars.

Driving rather than spacious -- this one is a competition, not a reassurance.
A pulsing eighth-note sub carries the first three bars, the board lands on an
impact at bar 3, and from there the kit plays straight four-on-the-floor with a
plucked arpeggio counting upward like a leaderboard filling in.
"""
import numpy as np, wave

SR, BPM = 44100, 120.0
BEAT = 60.0/BPM; BAR = BEAT*4; DUR = BAR*8; N = int(DUR*SR)
L=np.zeros(N); R=np.zeros(N)

def midi(n): return 440.0*2**((n-69)/12.0)
def idx(t): return int(t*SR)
def add(sig,t,pan=0.0,gain=1.0):
    i=idx(t); j=min(i+len(sig),N)
    if i>=N: return
    s=sig[:j-i]*gain
    L[i:j]+=s*(1-max(0.0,pan)); R[i:j]+=s*(1+min(0.0,pan))
def env(n,a,d,sl=0.0,r=0.0):
    a,d,r=int(a*SR),int(d*SR),int(r*SR); sus=max(0,n-a-d-r)
    return np.concatenate([np.linspace(0,1,a,endpoint=False) if a else np.array([]),
        np.linspace(1,sl,d,endpoint=False) if d else np.array([]),
        np.full(sus,sl), np.linspace(sl,0,r) if r else np.array([])])[:n]
def lowpass(x,c):
    a=np.exp(-2*np.pi*np.asarray(c,dtype=float)/SR); a=np.broadcast_to(a,x.shape).copy()
    y=np.zeros_like(x); p=0.0
    for k in range(len(x)): p=(1-a[k])*x[k]+a[k]*p; y[k]=p
    return y
def saw(f,n,det=0.0):
    t=np.arange(n)/SR; ph=2*np.pi*f*t if np.isscalar(f) else 2*np.pi*np.cumsum(f)/SR
    o=2*(ph/(2*np.pi)%1.0)-1.0
    if det: p2=ph*(1+det); o=0.5*o+0.5*(2*(p2/(2*np.pi)%1.0)-1.0)
    return o

def tick():
    """The doubt. Dry, mechanical, gone the moment it is answered."""
    n=idx(0.05); t=np.arange(n)/SR
    nz=np.random.RandomState(21).randn(n)
    return ((nz-lowpass(nz,4500)) + np.sin(2*np.pi*2100*t)*0.4)*np.exp(-t*170)*0.26
def kick():
    n=idx(0.5); t=np.arange(n)/SR
    f=44+150*np.exp(-t*26)
    b=np.sin(2*np.pi*np.cumsum(f)/SR)*np.exp(-t*5.4)
    c=np.random.RandomState(1).randn(n)*np.exp(-t*380)*0.45
    return np.tanh((b+c)*1.9)*0.98
def sub(note,beats,g=1.0):
    n=idx(beats*BEAT); t=np.arange(n)/SR; f=midi(note)
    s=np.sin(2*np.pi*f*t)+0.32*np.sin(4*np.pi*f*t)
    return s*env(n,0.01,0.08,sl=0.86,r=0.14)*0.64*g
def hat(o=False):
    d=0.16 if o else 0.038; n=idx(d); t=np.arange(n)/SR
    nz=np.random.RandomState(2 if o else 3).randn(n)
    return (nz-lowpass(nz,7200))*np.exp(-t*(14 if o else 70))*0.22
def snare():
    n=idx(0.24); t=np.arange(n)/SR
    nz=np.random.RandomState(9).randn(n)
    body=np.sin(2*np.pi*185*t)*np.exp(-t*26)*0.5
    return ((nz-lowpass(nz,1500))*np.exp(-t*17)+body)*0.42
def pad(notes,beats,bright=1200):
    n=idx(beats*BEAT); t=np.arange(n)/SR
    s=sum(saw(midi(m),n,det=0.01) for m in notes)/len(notes)
    return lowpass(s, bright+500*np.sin(2*np.pi*0.2*t))*env(n,0.4,0.5,sl=0.6,r=0.8)*0.26
def stab(notes,beats):
    n=idx(beats*BEAT); t=np.arange(n)/SR
    s=sum(saw(midi(m),n,det=0.005) for m in notes)/len(notes)
    return lowpass(s, 3600*np.exp(-t*3.4)+520)*env(n,0.006,0.20,sl=0.24,r=0.26)*0.34
def riser(dur):
    n=idx(dur); t=np.arange(n)/SR; k=t/dur
    nz=lowpass(np.random.RandomState(7).randn(n), 200+7000*k**2.3)
    tone=np.sin(2*np.pi*np.cumsum(midi(48)*(1+1.4*k**2))/SR)
    return (nz*1.9+tone*0.3)*(k**1.8)*0.46
def impact():
    n=idx(2.6); t=np.arange(n)/SR
    boom=np.sin(2*np.pi*np.cumsum(34+58*np.exp(-t*7))/SR)*np.exp(-t*2.0)
    crash=lowpass(np.random.RandomState(11).randn(n),9000)*np.exp(-t*2.8)
    return np.tanh(boom*1.7+crash*0.5)*0.82

# C minor climbing to Eb: unresolved while the question is asked, lifted once
# the board is on screen and never dropping back.
ROOTS  = [24, 24, 24, 27, 27, 29, 27, 24]
CHORD  = {24: [48, 51, 55], 27: [51, 55, 58], 29: [53, 56, 60]}
PAYOFF = 3   # bar index where the leaderboard lands

def pluck(note, beats, g=1.0):
    """Counts upward under the board -- short, bright, slightly detuned."""
    n = idx(beats * BEAT); t = np.arange(n) / SR
    s = saw(midi(note), n, det=0.004)
    return lowpass(s, 2600 * np.exp(-t * 9.0) + 700) * env(n, 0.004, 0.14, sl=0.1, r=0.10) * 0.30

# Rising figure over the chord, one step per eighth: the "filling in" motion.
ARP = [0, 3, 7, 12, 7, 3]

for b in range(8):
    t0 = b * BAR; root = ROOTS[b]
    add(pad(CHORD[root], 4, 800 if b < PAYOFF else 1700), t0,
        gain=0.75 if b < PAYOFF else 1.0)

    if b < PAYOFF:
        # The question. A pulsing sub and a closed hat -- momentum, no payoff.
        for k in range(8):
            add(sub(root, 0.5, g=0.30 + 0.09 * b), t0 + k * BEAT / 2)
            add(hat(), t0 + k * BEAT / 2, pan=(0.22 if k % 2 else -0.22), gain=0.55 + 0.07 * b)
        add(kick(), t0)
        add(kick(), t0 + BEAT * 2)
        if b == PAYOFF - 1:
            add(riser(BAR), t0, gain=1.0)
    else:
        if b == PAYOFF:
            add(impact(), t0, gain=1.0)
            add(stab(CHORD[root], 4), t0, gain=1.0)
        # Four on the floor once the board is up.
        for beat in range(4):
            add(kick(), t0 + beat * BEAT)
            add(sub(root, 1), t0 + beat * BEAT + 0.012, gain=0.92)
        add(snare(), t0 + BEAT, pan=0.08, gain=0.85)
        add(snare(), t0 + BEAT * 3, pan=0.08, gain=0.85)
        for k in range(8):
            add(hat(o=(k == 7)), t0 + k * BEAT / 2, pan=0.26, gain=0.72)
        for k, step in enumerate(ARP):
            add(pluck(root + 24 + step, 0.5), t0 + k * BEAT / 2,
                pan=-0.2 + 0.08 * k, gain=0.9)
        if b > PAYOFF:
            add(stab(CHORD[root], 2), t0, gain=0.55)

L=np.tanh(L*0.84)*1.05; R=np.tanh(R*0.84)*1.05
pk=max(np.abs(L).max(),np.abs(R).max()); L,R=L/pk*0.89,R/pk*0.89
fi,fo=idx(0.05),idx(0.5)
L[:fi]*=np.linspace(0,1,fi); R[:fi]*=np.linspace(0,1,fi)
L[-fo:]*=np.linspace(1,0,fo); R[-fo:]*=np.linspace(1,0,fo)
inter=np.empty(N*2); inter[0::2]=L; inter[1::2]=R
with wave.open('traders_audio.wav','wb') as w:
    w.setnchannels(2); w.setsampwidth(2); w.setframerate(SR)
    w.writeframes((inter*32767).astype('<i2').tobytes())
print(f'wrote traders_audio.wav  {DUR}s  payoff at {BAR*PAYOFF}s')
