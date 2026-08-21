"""Mainnet announcement bed. 120 BPM, F minor, 12s / 6 bars.

Cinematic rather than club: a clock tick carries the first half, everything
drops on the date reveal at bar 4 (t=6.0s). Synthesised, so X can't flag it.
Run as:  python music3.py [announce|live]
"""
import sys, numpy as np, wave

MODE = (sys.argv[1] if len(sys.argv) > 1 else 'announce')
SR, BPM = 44100, 120.0
BEAT = 60.0/BPM; BAR = BEAT*4; DUR = BAR*6; N = int(DUR*SR)
L=np.zeros(N); R=np.zeros(N)

def midi(n): return 440.0*2**((n-69)/12.0)
def idx(t):  return int(t*SR)
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

def tick(hard=False):
    """The clock. Dry, short, slightly metallic."""
    n=idx(0.06); t=np.arange(n)/SR
    nz=np.random.RandomState(21 if hard else 22).randn(n)
    hp=nz-lowpass(nz,4200)
    tone=np.sin(2*np.pi*(2400 if hard else 1750)*t)*0.5
    return (hp+tone)*np.exp(-t*(150 if hard else 190))*(0.34 if hard else 0.22)

def kick():
    n=idx(0.40); t=np.arange(n)/SR
    f=46+160*np.exp(-t*30)
    b=np.sin(2*np.pi*np.cumsum(f)/SR)*np.exp(-t*7.0)
    c=np.random.RandomState(1).randn(n)*np.exp(-t*430)*0.5
    return np.tanh((b+c)*1.75)*0.95
def sub(note,beats,g=1.0):
    n=idx(beats*BEAT); t=np.arange(n)/SR; f=midi(note)
    s=np.sin(2*np.pi*f*t)+0.3*np.sin(4*np.pi*f*t)
    return s*env(n,0.008,0.06,sl=0.85,r=0.10)*0.62*g
def hat(o=False):
    d=0.15 if o else 0.042; n=idx(d); t=np.arange(n)/SR
    nz=np.random.RandomState(2 if o else 3).randn(n)
    return (nz-lowpass(nz,7500))*np.exp(-t*(15 if o else 66))*0.28
def stab(notes,beats):
    n=idx(beats*BEAT); t=np.arange(n)/SR
    s=sum(saw(midi(m),n,det=0.006) for m in notes)/len(notes)
    return lowpass(s,3600*np.exp(-t*3)+520)*env(n,0.008,0.20,sl=0.30,r=0.28)*0.36
def arp(note,beats,bright):
    n=idx(beats*BEAT); t=np.arange(n)/SR
    s=saw(midi(note),n,det=0.004)
    return lowpass(s,bright*np.exp(-t*6)+750)*env(n,0.004,0.09,sl=0.30,r=0.12)*0.30
def riser(dur,f0=180,f1=7000):
    n=idx(dur); t=np.arange(n)/SR; k=t/dur
    nz=lowpass(np.random.RandomState(7).randn(n),f0+(f1-f0)*k**2.2)
    tone=np.sin(2*np.pi*np.cumsum(midi(53)*(1+1.7*k**2))/SR)
    return (nz*2.0+tone*0.32)*(k**1.7)*0.46
def impact():
    n=idx(2.4); t=np.arange(n)/SR
    boom=np.sin(2*np.pi*np.cumsum(36+64*np.exp(-t*8))/SR)*np.exp(-t*2.2)
    crash=lowpass(np.random.RandomState(11).randn(n),9500)*np.exp(-t*3.0)
    return np.tanh(boom*1.6+crash*0.6)*0.80

ROOTS=[29,29,29,29,32,29]
CHORD={29:[53,56,60],32:[56,60,63]}
DROP=3                                   # bar index of the date reveal

for b in range(6):
    t0=b*BAR; root=ROOTS[b]
    if b < DROP:                         # clock half: ticks + a swelling drone
        for beat in range(4):
            add(tick(hard=(beat==0)), t0+beat*BEAT, pan=(0.2 if beat%2 else -0.2))
        add(sub(root,4,g=0.30+0.18*b), t0)
        if b==2: add(riser(BAR,200,6000), t0, gain=1.0)
    else:                                # everything lands
        if b==DROP: add(impact(), t0, gain=1.0)
        for beat in range(4):
            t=t0+beat*BEAT
            add(kick(), t); add(sub(root,1), t+0.012, gain=0.9)
            add(hat(o=(beat==3)), t+BEAT/2, pan=0.25, gain=0.85)
        add(stab(CHORD[root],2), t0, gain=0.95)
        if b>DROP:
            pat=[0,3,7,12,7,3,10,7]
            for k,st in enumerate(pat):
                add(arp(root+24+st,0.5,4200+400*b), t0+k*BEAT/2,
                    pan=(-0.3 if k%2 else 0.3), gain=0.85)
    if b==5:                             # endcard tail
        add(stab(CHORD[root],4), t0, gain=0.55)

if MODE == 'live':                       # extra hit under "IS LIVE"
    add(impact(), BAR*DROP+BEAT*2, gain=0.55)

L=np.tanh(L*0.84)*1.05; R=np.tanh(R*0.84)*1.05
pk=max(np.abs(L).max(),np.abs(R).max()); L,R=L/pk*0.89,R/pk*0.89
fi,fo=idx(0.05),idx(0.45)
L[:fi]*=np.linspace(0,1,fi); R[:fi]*=np.linspace(0,1,fi)
L[-fo:]*=np.linspace(1,0,fo); R[-fo:]*=np.linspace(1,0,fo)
inter=np.empty(N*2); inter[0::2]=L; inter[1::2]=R
out=f'mainnet_{MODE}_audio.wav'
with wave.open(out,'wb') as w:
    w.setnchannels(2); w.setsampwidth(2); w.setframerate(SR)
    w.writeframes((inter*32767).astype('<i2').tobytes())
print(f'wrote {out}  {DUR}s  {BPM:.0f}bpm  drop at {BAR*DROP}s')
