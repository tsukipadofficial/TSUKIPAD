"""Referral bed. 120 BPM, G minor, 16s / 8 bars.

Bouncier than the other four: an octave-jumping bass and a plucked lead, so it
reads as an offer rather than an announcement. Payoff lands on bar 5, where the
split appears. Synthesised, so X cannot flag it.
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

def kick():
    n=idx(0.38); t=np.arange(n)/SR
    f=48+158*np.exp(-t*33)
    b=np.sin(2*np.pi*np.cumsum(f)/SR)*np.exp(-t*7.6)
    c=np.random.RandomState(1).randn(n)*np.exp(-t*450)*0.5
    return np.tanh((b+c)*1.8)*0.95
def bass(note, beats):
    """Short and plucky, so the octave jumps read as bounce."""
    n=idx(beats*BEAT); t=np.arange(n)/SR
    s=saw(midi(note), n, det=0.002)
    s=lowpass(s, 900*np.exp(-t*14)+180)
    return s*env(n,0.004,0.10,sl=0.30,r=0.09)*0.55
def hat(o=False):
    d=0.14 if o else 0.036; n=idx(d); t=np.arange(n)/SR
    nz=np.random.RandomState(2 if o else 3).randn(n)
    return (nz-lowpass(nz,8200))*np.exp(-t*(17 if o else 74))*0.26
def clap():
    n=idx(0.19); t=np.arange(n)/SR
    nz=np.random.RandomState(5).randn(n)
    bp=lowpass(nz,3400)-lowpass(nz,900); burst=np.ones(n)
    for o in (0.0,0.010,0.020): burst[idx(o):]+=0.8
    return bp*burst*np.exp(-t*23)*0.40
def pluck(note, beats):
    n=idx(beats*BEAT); t=np.arange(n)/SR; f=midi(note)
    s=(np.sin(2*np.pi*f*t) + 0.45*np.sin(2*np.pi*f*2*t)*np.exp(-t*8)
       + 0.2*np.sin(2*np.pi*f*3*t)*np.exp(-t*14))
    return s*env(n,0.002,0.22,sl=0.16,r=0.30)*0.30
def pad(notes, beats):
    n=idx(beats*BEAT); t=np.arange(n)/SR
    s=sum(saw(midi(m),n,det=0.009) for m in notes)/len(notes)
    return lowpass(s, 1400+700*np.sin(2*np.pi*0.3*t))*env(n,0.30,0.4,sl=0.55,r=0.6)*0.22
def stab(notes, beats):
    n=idx(beats*BEAT); t=np.arange(n)/SR
    s=sum(saw(midi(m),n,det=0.006) for m in notes)/len(notes)
    return lowpass(s, 4000*np.exp(-t*3)+600)*env(n,0.005,0.18,sl=0.26,r=0.24)*0.33
def riser(dur):
    n=idx(dur); t=np.arange(n)/SR; k=t/dur
    nz=lowpass(np.random.RandomState(7).randn(n), 250+6500*k**2.2)
    return nz*2.0*(k**1.8)*0.40
def impact():
    n=idx(2.0); t=np.arange(n)/SR
    boom=np.sin(2*np.pi*np.cumsum(40+64*np.exp(-t*9))/SR)*np.exp(-t*2.6)
    crash=lowpass(np.random.RandomState(11).randn(n),9800)*np.exp(-t*3.4)
    return np.tanh(boom*1.5+crash*0.55)*0.74

# G minor: Gm  Gm  Eb  Eb  Bb  Bb  F  Gm
ROOTS = [31, 31, 27, 27, 34, 34, 29, 31]
CHORD = {31:[55,58,62], 27:[51,55,58], 34:[58,62,65], 29:[53,57,60]}
LEAD  = {31:[74,70,67,70], 27:[70,67,63,67], 34:[77,74,70,74], 29:[72,69,65,69]}
PAYOFF = 4

for b in range(8):
    t0=b*BAR; root=ROOTS[b]
    add(pad(CHORD[root], 4), t0, gain=0.9 if b < PAYOFF else 1.05)

    if b == 0:
        # A lead-in, not silence: an almost-empty first bar reads as a glitch
        # before the beat rather than as anticipation.
        add(bass(root, 1), t0, gain=0.9)
        add(bass(root, 1), t0+BEAT*2, gain=0.9)
        add(pluck(LEAD[root][0], 2), t0+BEAT*2, gain=0.7)
        for beat in range(4):
            add(hat(), t0+beat*BEAT+BEAT/2, pan=0.2, gain=0.75)
        add(riser(BAR*0.9), t0+BAR*0.1, gain=0.55)
    else:
        for beat in range(4):
            t=t0+beat*BEAT
            add(kick(), t)
            # Octave jump on the offbeat is the bounce.
            add(bass(root, 0.5), t, gain=0.95)
            add(bass(root+12, 0.5), t+BEAT/2, gain=0.6)
            if beat%2==1: add(clap(), t, pan=0.15, gain=0.8)
            add(hat(o=(beat==3)), t+BEAT/2, pan=0.26, gain=0.8)

    if b >= 1:
        for k,note in enumerate(LEAD[root]):
            add(pluck(note, 1), t0+k*BEAT, pan=(-0.28 if k%2 else 0.28), gain=0.9)

    if b == PAYOFF-1: add(riser(BAR), t0, gain=0.9)
    if b == PAYOFF:
        add(impact(), t0, gain=1.0)
        add(stab(CHORD[root], 4), t0, gain=1.15)
        add(pluck(LEAD[root][0]+12, 2), t0, gain=0.8)
    if b > PAYOFF: add(stab(CHORD[root], 2), t0, gain=0.6)
    if b == 7: add(pluck(79, 4), t0, gain=0.5)

L=np.tanh(L*0.86)*1.05; R=np.tanh(R*0.86)*1.05
pk=max(np.abs(L).max(),np.abs(R).max()); L,R=L/pk*0.89,R/pk*0.89
fi,fo=idx(0.05),idx(0.45)
L[:fi]*=np.linspace(0,1,fi); R[:fi]*=np.linspace(0,1,fi)
L[-fo:]*=np.linspace(1,0,fo); R[-fo:]*=np.linspace(1,0,fo)
inter=np.empty(N*2); inter[0::2]=L; inter[1::2]=R
with wave.open('referral_audio.wav','wb') as w:
    w.setnchannels(2); w.setsampwidth(2); w.setframerate(SR)
    w.writeframes((inter*32767).astype('<i2').tobytes())
print(f'wrote referral_audio.wav  {DUR}s  {BPM:.0f}bpm  payoff at {BAR*PAYOFF}s')
