"""Free-launch piece bed. 120 BPM, F minor lifting to Ab, 16s / 8 bars.

The opposite shape to the traders bed. That one was a competition and drove
from the top; this one is a question about money, so the first three bars are a
register counting upward -- a metallic tick on every eighth, a sub tightening
under it -- and the whole point is that the counting *stops*. At bar 3 the tick
never comes back, and what replaces it is wide and warm: the cost was zero all
along, so the floor opens rather than kicking harder.
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

def register(k=0):
    """The cost counting up. Metallic, clipped short, deliberately unmusical."""
    n=idx(0.06); t=np.arange(n)/SR
    nz=np.random.RandomState(31+k).randn(n)
    ring=sum(np.sin(2*np.pi*f*t) for f in (3100, 4700, 6300))/3
    return ((nz-lowpass(nz,5200))*0.7 + ring*0.6)*np.exp(-t*150)*0.24
def kick(soft=False):
    n=idx(0.5); t=np.arange(n)/SR
    f=42+150*np.exp(-t*26)
    b=np.sin(2*np.pi*np.cumsum(f)/SR)*np.exp(-t*(6.4 if soft else 5.2))
    c=np.random.RandomState(1).randn(n)*np.exp(-t*380)*(0.28 if soft else 0.45)
    return np.tanh((b+c)*1.75)*(0.82 if soft else 0.98)
def sub(note,beats,g=1.0):
    n=idx(beats*BEAT); t=np.arange(n)/SR; f=midi(note)
    s=np.sin(2*np.pi*f*t)+0.30*np.sin(4*np.pi*f*t)
    return s*env(n,0.012,0.09,sl=0.84,r=0.16)*0.62*g
def hat(o=False):
    d=0.17 if o else 0.036; n=idx(d); t=np.arange(n)/SR
    nz=np.random.RandomState(2 if o else 3).randn(n)
    return (nz-lowpass(nz,7400))*np.exp(-t*(13 if o else 72))*0.19
def snare():
    n=idx(0.24); t=np.arange(n)/SR
    nz=np.random.RandomState(9).randn(n)
    body=np.sin(2*np.pi*180*t)*np.exp(-t*26)*0.5
    return ((nz-lowpass(nz,1500))*np.exp(-t*17)+body)*0.38
def pad(notes,beats,bright=1200):
    n=idx(beats*BEAT); t=np.arange(n)/SR
    s=sum(saw(midi(m),n,det=0.01) for m in notes)/len(notes)
    return lowpass(s, bright+500*np.sin(2*np.pi*0.2*t))*env(n,0.45,0.5,sl=0.62,r=0.9)*0.27
def stab(notes,beats):
    n=idx(beats*BEAT); t=np.arange(n)/SR
    s=sum(saw(midi(m),n,det=0.005) for m in notes)/len(notes)
    return lowpass(s, 3600*np.exp(-t*3.4)+520)*env(n,0.006,0.20,sl=0.24,r=0.26)*0.32
def bell(note,beats,g=1.0):
    """The answer. FM bell -- the one voice that only exists after the payoff."""
    n=idx(beats*BEAT); t=np.arange(n)/SR; f=midi(note)
    mod=np.sin(2*np.pi*f*2.01*t)*np.exp(-t*5.5)*2.6
    s=np.sin(2*np.pi*f*t+mod)
    return s*env(n,0.004,0.5,sl=0.18,r=0.5)*0.26*g
def riser(dur):
    n=idx(dur); t=np.arange(n)/SR; k=t/dur
    nz=lowpass(np.random.RandomState(7).randn(n), 200+7000*k**2.3)
    tone=np.sin(2*np.pi*np.cumsum(midi(48)*(1+1.4*k**2))/SR)
    return (nz*1.9+tone*0.3)*(k**1.8)*0.44
def impact():
    n=idx(2.8); t=np.arange(n)/SR
    boom=np.sin(2*np.pi*np.cumsum(33+56*np.exp(-t*7))/SR)*np.exp(-t*1.9)
    crash=lowpass(np.random.RandomState(11).randn(n),9000)*np.exp(-t*2.6)
    return np.tanh(boom*1.7+crash*0.45)*0.80

# F minor while the cost is still being asked for; Ab from the payoff on, and
# it never returns to the minor -- the question does not come back.
ROOTS  = [29, 29, 29, 32, 32, 25, 27, 32]
CHORD  = {29: [53, 56, 60], 32: [56, 60, 63], 25: [49, 53, 56], 27: [51, 55, 58]}
PAYOFF = 3   # bar index where the number lands on $0

# Descending, unlike the traders arp: the figure falls because the cost does.
BELLS = [12, 7, 3, 0]

for b in range(8):
    t0 = b*BAR; root = ROOTS[b]
    add(pad(CHORD[root], 4, 760 if b < PAYOFF else 1800), t0,
        gain=0.72 if b < PAYOFF else 1.0)

    if b < PAYOFF:
        # The register. Every eighth, tightening, no backbeat to settle into.
        for k in range(8):
            add(register(k), t0 + k*BEAT/2, pan=(-0.3 if k % 2 else 0.3),
                gain=0.55 + 0.14*b)
            add(sub(root, 0.5, g=0.26 + 0.10*b), t0 + k*BEAT/2)
        add(kick(soft=True), t0)
        if b >= 1: add(kick(soft=True), t0 + BEAT*2)
        if b == PAYOFF - 1:
            add(riser(BAR), t0, gain=1.0)
    else:
        if b == PAYOFF:
            add(impact(), t0, gain=1.0)
            add(stab(CHORD[root], 4), t0, gain=0.95)
        for beat in range(4):
            add(kick(soft=True), t0 + beat*BEAT, gain=0.92)
            add(sub(root, 1), t0 + beat*BEAT + 0.012, gain=0.88)
        add(snare(), t0 + BEAT, pan=0.06, gain=0.72)
        add(snare(), t0 + BEAT*3, pan=0.06, gain=0.72)
        for k in range(8):
            add(hat(o=(k == 7)), t0 + k*BEAT/2, pan=0.24, gain=0.62)
        for k, step in enumerate(BELLS):
            add(bell(root + 24 + step, 1), t0 + k*BEAT, pan=0.22 - 0.14*k,
                gain=0.95 - 0.06*k)

L=np.tanh(L*0.84)*1.05; R=np.tanh(R*0.84)*1.05
pk=max(np.abs(L).max(),np.abs(R).max()); L,R=L/pk*0.89,R/pk*0.89
fi,fo=idx(0.05),idx(0.6)
L[:fi]*=np.linspace(0,1,fi); R[:fi]*=np.linspace(0,1,fi)
L[-fo:]*=np.linspace(1,0,fo); R[-fo:]*=np.linspace(1,0,fo)
inter=np.empty(N*2); inter[0::2]=L; inter[1::2]=R
with wave.open('freelaunch_audio.wav','wb') as w:
    w.setnchannels(2); w.setsampwidth(2); w.setframerate(SR)
    w.writeframes((inter*32767).astype('<i2').tobytes())
print(f'wrote freelaunch_audio.wav  {DUR}s  payoff at {BAR*PAYOFF}s')
