"""No-owner piece bed. 120 BPM, A minor settling on D, 16s / 8 bars.

Both earlier beds build into their payoff. This one cannot: the subject is the
absence of a function, so the drop at bar 3 is a drop *out*. Three bars of a
clinical scanner blip searching, then everything cuts to one low sustained note
and a tail. What rebuilds afterwards is deliberately thinner than what came
before, because nothing was added -- something was found not to exist.
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

def blip(note, k=0):
    """The scan. Same pitch every time -- a query being run, not a melody."""
    n=idx(0.09); t=np.arange(n)/SR
    s=np.sin(2*np.pi*midi(note)*t)+0.5*np.sin(2*np.pi*midi(note+12)*t)
    return s*np.exp(-t*38)*0.20
def kick(soft=True):
    n=idx(0.5); t=np.arange(n)/SR
    f=41+150*np.exp(-t*26)
    b=np.sin(2*np.pi*np.cumsum(f)/SR)*np.exp(-t*(6.6 if soft else 5.2))
    c=np.random.RandomState(1).randn(n)*np.exp(-t*380)*(0.24 if soft else 0.45)
    return np.tanh((b+c)*1.7)*(0.80 if soft else 0.98)
def sub(note,beats,g=1.0):
    n=idx(beats*BEAT); t=np.arange(n)/SR; f=midi(note)
    s=np.sin(2*np.pi*f*t)+0.28*np.sin(4*np.pi*f*t)
    return s*env(n,0.014,0.10,sl=0.82,r=0.20)*0.60*g
def hat():
    n=idx(0.032); t=np.arange(n)/SR
    nz=np.random.RandomState(3).randn(n)
    return (nz-lowpass(nz,7600))*np.exp(-t*80)*0.15
def pad(notes,beats,bright=1100,g=1.0):
    n=idx(beats*BEAT); t=np.arange(n)/SR
    s=sum(saw(midi(m),n,det=0.009) for m in notes)/len(notes)
    return lowpass(s, bright+420*np.sin(2*np.pi*0.18*t))*env(n,0.5,0.6,sl=0.58,r=1.0)*0.25*g
def bell(note,beats,g=1.0):
    n=idx(beats*BEAT); t=np.arange(n)/SR; f=midi(note)
    mod=np.sin(2*np.pi*f*2.01*t)*np.exp(-t*6.0)*2.4
    return np.sin(2*np.pi*f*t+mod)*env(n,0.004,0.55,sl=0.14,r=0.6)*0.24*g
def riser(dur):
    n=idx(dur); t=np.arange(n)/SR; k=t/dur
    nz=lowpass(np.random.RandomState(7).randn(n), 200+6500*k**2.4)
    return nz*(k**2.0)*0.40
def dropout():
    """What replaces the drop. One low note and a long tail, nothing else."""
    n=idx(3.4); t=np.arange(n)/SR
    low=np.sin(2*np.pi*np.cumsum(np.full(n, midi(26)))/SR)*np.exp(-t*0.85)
    air=lowpass(np.random.RandomState(17).randn(n), 900*np.exp(-t*1.1)+120)*np.exp(-t*1.6)
    return np.tanh(low*1.5+air*0.35)*0.62

# A minor while the search runs, resolving down to D and staying there.
ROOTS  = [33, 33, 33, 26, 26, 26, 28, 26]
CHORD  = {33: [57, 60, 64], 26: [50, 53, 57], 28: [52, 55, 59]}
PAYOFF = 3

for b in range(8):
    t0 = b*BAR; root = ROOTS[b]

    if b < PAYOFF:
        # Searching. Blips on every eighth, tightening, never resolving.
        add(pad(CHORD[root], 4, 700, g=0.75), t0)
        for k in range(8):
            add(blip(69 + (0 if k % 2 else 7), k), t0 + k*BEAT/2,
                pan=(-0.35 if k % 2 else 0.35), gain=0.6 + 0.15*b)
            add(hat(), t0 + k*BEAT/2, pan=0.2, gain=0.4 + 0.1*b)
            add(sub(root, 0.5, g=0.22 + 0.09*b), t0 + k*BEAT/2)
        add(kick(), t0)
        if b >= 1: add(kick(), t0 + BEAT*2)
        if b == PAYOFF - 1:
            add(riser(BAR), t0, gain=0.9)

    elif b == PAYOFF:
        # The cut. Nothing is added here on purpose.
        add(dropout(), t0, gain=1.0)
        add(sub(root - 12, 4, g=0.5), t0)

    else:
        # Rebuilt thinner than it started.
        add(pad(CHORD[root], 4, 1500, g=0.9), t0)
        add(kick(), t0, gain=0.85)
        add(kick(), t0 + BEAT*2, gain=0.85)
        add(sub(root, 2, g=0.75), t0)
        add(sub(root, 2, g=0.75), t0 + BEAT*2)
        if b >= 6:
            for k in (0, 2):
                add(hat(), t0 + k*BEAT + BEAT/2, pan=0.22, gain=0.5)
        if b in (5, 7):
            add(bell(root + 24, 2, g=0.9), t0 + BEAT*2, pan=-0.15)
        if b == 4:
            add(bell(root + 19, 2, g=0.8), t0 + BEAT, pan=0.18)

L=np.tanh(L*0.86)*1.04; R=np.tanh(R*0.86)*1.04
pk=max(np.abs(L).max(),np.abs(R).max()); L,R=L/pk*0.89,R/pk*0.89
fi,fo=idx(0.05),idx(0.7)
L[:fi]*=np.linspace(0,1,fi); R[:fi]*=np.linspace(0,1,fi)
L[-fo:]*=np.linspace(1,0,fo); R[-fo:]*=np.linspace(1,0,fo)
inter=np.empty(N*2); inter[0::2]=L; inter[1::2]=R
with wave.open('noowner_audio.wav','wb') as w:
    w.setnchannels(2); w.setsampwidth(2); w.setframerate(SR)
    w.writeframes((inter*32767).astype('<i2').tobytes())
print(f'wrote noowner_audio.wav  {DUR}s  cut at {BAR*PAYOFF}s')
