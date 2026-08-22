"""Trust piece bed. 120 BPM half-time, C minor, 16s / 8 bars.

Heavier and slower-feeling than the others -- kick on 1 and 3, a lot of space --
because this one is answering a suspicion rather than making an offer. A ticking
figure carries the doubt for three bars and stops dead on the answer.
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

# C minor, resolving to Ab then G -- unsettled until the answer, settled after.
ROOTS = [24, 24, 24, 24, 20, 20, 22, 24]
CHORD = {24:[48,51,55], 20:[44,48,51], 22:[46,50,53]}
PAYOFF = 3   # bar index where "there is no function" lands

for b in range(8):
    t0=b*BAR; root=ROOTS[b]
    add(pad(CHORD[root], 4, 900 if b < PAYOFF else 1600), t0,
        gain=0.8 if b < PAYOFF else 1.0)

    if b < PAYOFF:
        # The doubt: a clock, and almost nothing else.
        add(sub(root, 4, g=0.42+0.12*b), t0)
        for k in range(8):
            add(tick(), t0+k*BEAT/2, pan=(0.25 if k%2 else -0.25), gain=0.75+0.05*b)
        if b == PAYOFF-1:
            add(riser(BAR), t0, gain=1.0)
    else:
        if b == PAYOFF:
            add(impact(), t0, gain=1.0)
            add(stab(CHORD[root], 4), t0, gain=1.0)
        # Half-time: kick on 1 and 3, snare on 3. Space is the point.
        for beat in (0, 2):
            add(kick(), t0+beat*BEAT)
            add(sub(root, 2), t0+beat*BEAT+0.012, gain=0.95)
        add(snare(), t0+BEAT*2, pan=0.1, gain=0.9)
        for k in range(4):
            add(hat(o=(k==3)), t0+k*BEAT+BEAT/2, pan=0.28, gain=0.8)
        if b > PAYOFF:
            add(stab(CHORD[root], 2), t0, gain=0.6)

L=np.tanh(L*0.84)*1.05; R=np.tanh(R*0.84)*1.05
pk=max(np.abs(L).max(),np.abs(R).max()); L,R=L/pk*0.89,R/pk*0.89
fi,fo=idx(0.05),idx(0.5)
L[:fi]*=np.linspace(0,1,fi); R[:fi]*=np.linspace(0,1,fi)
L[-fo:]*=np.linspace(1,0,fo); R[-fo:]*=np.linspace(1,0,fo)
inter=np.empty(N*2); inter[0::2]=L; inter[1::2]=R
with wave.open('trust_audio.wav','wb') as w:
    w.setnchannels(2); w.setsampwidth(2); w.setframerate(SR)
    w.writeframes((inter*32767).astype('<i2').tobytes())
print(f'wrote trust_audio.wav  {DUR}s  payoff at {BAR*PAYOFF}s')
