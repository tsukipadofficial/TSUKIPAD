"""Waitlist CTA bed. 120 BPM, A minor, 16s / 8 bars.

Built around one turn: sparse and unresolved for five bars while the ask is
being made, then the chord lands on bar 6 where the reward is named. Brighter
than the other three beds -- this piece asks for something rather than
declaring something.
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
    n=idx(0.40); t=np.arange(n)/SR
    f=47+155*np.exp(-t*31)
    b=np.sin(2*np.pi*np.cumsum(f)/SR)*np.exp(-t*7.2)
    c=np.random.RandomState(1).randn(n)*np.exp(-t*440)*0.5
    return np.tanh((b+c)*1.75)*0.95
def sub(note,beats,g=1.0):
    n=idx(beats*BEAT); t=np.arange(n)/SR; f=midi(note)
    s=np.sin(2*np.pi*f*t)+0.28*np.sin(4*np.pi*f*t)
    return s*env(n,0.008,0.06,sl=0.85,r=0.10)*0.60*g
def hat(o=False):
    d=0.15 if o else 0.040; n=idx(d); t=np.arange(n)/SR
    nz=np.random.RandomState(2 if o else 3).randn(n)
    return (nz-lowpass(nz,7600))*np.exp(-t*(15 if o else 68))*0.28
def clap():
    n=idx(0.20); t=np.arange(n)/SR
    nz=np.random.RandomState(5).randn(n)
    bp=lowpass(nz,3200)-lowpass(nz,850); burst=np.ones(n)
    for o in (0.0,0.011,0.022): burst[idx(o):]+=0.8
    return bp*burst*np.exp(-t*21)*0.40
def bell(note,beats):
    """Plucked, glassy — carries the melody without crowding the voice-over."""
    n=idx(beats*BEAT); t=np.arange(n)/SR; f=midi(note)
    s=(np.sin(2*np.pi*f*t) + 0.5*np.sin(2*np.pi*f*2*t)*np.exp(-t*6)
       + 0.25*np.sin(2*np.pi*f*3.01*t)*np.exp(-t*11))
    return s*env(n,0.003,0.30,sl=0.22,r=0.45)*0.30
def pad(notes,beats):
    n=idx(beats*BEAT); t=np.arange(n)/SR
    s=sum(saw(midi(m),n,det=0.008) for m in notes)/len(notes)
    return lowpass(s,1500+900*np.sin(2*np.pi*0.25*t))*env(n,0.35,0.4,sl=0.55,r=0.7)*0.24
def stab(notes,beats):
    n=idx(beats*BEAT); t=np.arange(n)/SR
    s=sum(saw(midi(m),n,det=0.006) for m in notes)/len(notes)
    return lowpass(s,4200*np.exp(-t*3)+600)*env(n,0.006,0.20,sl=0.28,r=0.26)*0.34
def riser(dur,f0=200,f1=7000):
    n=idx(dur); t=np.arange(n)/SR; k=t/dur
    nz=lowpass(np.random.RandomState(7).randn(n),f0+(f1-f0)*k**2.2)
    tone=np.sin(2*np.pi*np.cumsum(midi(57)*(1+1.5*k**2))/SR)
    return (nz*1.9+tone*0.30)*(k**1.7)*0.44
def impact():
    n=idx(2.2); t=np.arange(n)/SR
    boom=np.sin(2*np.pi*np.cumsum(38+62*np.exp(-t*9))/SR)*np.exp(-t*2.4)
    crash=lowpass(np.random.RandomState(11).randn(n),9500)*np.exp(-t*3.2)
    return np.tanh(boom*1.55+crash*0.58)*0.76

# A minor, turning to F then G so bar 6 lands on the lift rather than the root.
ROOTS = [33, 33, 33, 33, 29, 31, 33, 33]           # A A A A F G A A
CHORD = {33:[57,60,64], 29:[53,57,60], 31:[55,59,62]}
MEL   = {33:[69,72,76,72], 29:[65,69,72,69], 31:[67,71,74,71]}
PAYOFF = 5                                          # bar index of the reward

for b in range(8):
    t0=b*BAR; root=ROOTS[b]
    add(pad(CHORD[root], 4), t0, gain=0.8 if b < PAYOFF else 1.0)

    if b < 2:                                       # the ask, still unresolved
        add(sub(root,4,g=0.45), t0)
        for beat in range(4):
            add(hat(), t0+beat*BEAT+BEAT/2, pan=0.25, gain=0.6)
    else:
        for beat in range(4):
            t=t0+beat*BEAT
            add(kick(), t); add(sub(root,1), t+0.012, gain=0.9)
            if beat%2==1: add(clap(), t, pan=0.15, gain=0.8)
            add(hat(o=(beat==3)), t+BEAT/2, pan=0.28, gain=0.85)

    if 2 <= b <= 7:                                 # melody enters with the beat
        for k,note in enumerate(MEL[root]):
            add(bell(note, 1), t0+k*BEAT, pan=(-0.25 if k%2 else 0.25), gain=0.95)

    if b == PAYOFF - 1: add(riser(BAR, 260, 7000), t0, gain=0.95)
    if b == PAYOFF:
        add(impact(), t0, gain=0.9)
        add(stab(CHORD[root], 4), t0, gain=0.95)
    if b > PAYOFF: add(stab(CHORD[root], 2), t0, gain=0.7)
    if b == 7: add(bell(81, 4), t0, gain=0.6)       # tail

L=np.tanh(L*0.86)*1.05; R=np.tanh(R*0.86)*1.05
pk=max(np.abs(L).max(),np.abs(R).max()); L,R=L/pk*0.89,R/pk*0.89
fi,fo=idx(0.05),idx(0.45)
L[:fi]*=np.linspace(0,1,fi); R[:fi]*=np.linspace(0,1,fi)
L[-fo:]*=np.linspace(1,0,fo); R[-fo:]*=np.linspace(1,0,fo)
inter=np.empty(N*2); inter[0::2]=L; inter[1::2]=R
with wave.open('waitlist_audio.wav','wb') as w:
    w.setnchannels(2); w.setsampwidth(2); w.setframerate(SR)
    w.writeframes((inter*32767).astype('<i2').tobytes())
print(f'wrote waitlist_audio.wav  {DUR}s  {BPM:.0f}bpm  payoff at {BAR*PAYOFF}s')
