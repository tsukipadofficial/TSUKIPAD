import math, random, wave, struct
SR, DUR = 44100, 15.0
N = int(SR*DUR)
L = [0.0]*N; R = [0.0]*N
random.seed(7)

def mix(buf, start_t, samples, gain=1.0):
    i = int(start_t*SR)
    for k, s in enumerate(samples):
        j = i+k
        if 0 <= j < N: buf[j] += s*gain

def kick(dur=0.34):
    out=[]
    for k in range(int(SR*dur)):
        t=k/SR
        f = 46 + 105*math.exp(-t*38)              # pitch drop
        env = math.exp(-t*11)
        click = (random.uniform(-1,1)*math.exp(-t*400))*0.35
        out.append((math.sin(2*math.pi*f*t)*env + click)*0.95)
    return out

def sub(freq, dur):
    out=[]
    for k in range(int(SR*dur)):
        t=k/SR
        a = min(1.0, t/0.02) * math.exp(-t*0.55)
        out.append((math.sin(2*math.pi*freq*t)*0.8
                   + math.sin(2*math.pi*freq*2*t)*0.16)*a)
    return out

def pluck(freq, dur=0.34):
    out=[]
    for k in range(int(SR*dur)):
        t=k/SR
        env = math.exp(-t*9.5)*min(1.0,t/0.004)
        v = (math.sin(2*math.pi*freq*t)
             + 0.34*math.sin(2*math.pi*freq*2*t)
             + 0.14*math.sin(2*math.pi*freq*3*t))
        out.append(v*env*0.33)
    return out

def hat(dur=0.06):
    return [random.uniform(-1,1)*math.exp(-(k/SR)*95)*0.16 for k in range(int(SR*dur))]

def riser(dur):
    out=[]
    for k in range(int(SR*dur)):
        t=k/SR; p=t/dur
        f = 190*math.exp(p*2.25)                  # sweep up ~190 -> 1800
        amp = (p**2.1)*0.30
        noise = random.uniform(-1,1)*(p**3.2)*0.14
        out.append(math.sin(2*math.pi*f*t)*amp + noise)
    return out

def impact(dur=2.2, big=1.0):
    out=[]
    for k in range(int(SR*dur)):
        t=k/SR
        boom = math.sin(2*math.pi*(38+52*math.exp(-t*15))*t)*math.exp(-t*3.1)
        body = math.sin(2*math.pi*110*t)*math.exp(-t*5.0)*0.4
        nz   = random.uniform(-1,1)*math.exp(-t*13)*0.20
        out.append((boom+body+nz)*0.85*big)
    return out

def pad(freqs, dur):
    out=[]
    for k in range(int(SR*dur)):
        t=k/SR
        a = min(1.0,t/0.35)*math.exp(-t*0.62)
        v = sum(math.sin(2*math.pi*f*t + i)*0.9**i for i,f in enumerate(freqs))
        out.append(v*a*0.10)
    return out

# ---- arrangement, locked to the video's beats -------------------------------
A1,F1,G1 = 55.00, 43.65, 49.00
A4,C5,E5,G5 = 440.00, 523.25, 659.25, 783.99

K, IM, HT = kick(), impact(), hat()

mix(L, 0.0, riser(2.55), 0.9); mix(R, 0.0, riser(2.55), 0.9)   # curve drawing

for b,buf in ((2.55,None),):                                    # wordmark lands
    imp = impact(2.4, 1.0)
    mix(L, 2.55, imp); mix(R, 2.55, imp)

t = 2.5                                                          # 120 BPM pulse
while t < 12.85:
    mix(L, t, K); mix(R, t, K)
    t += 0.5

t = 5.0                                                          # offbeat hats
while t < 12.6:
    mix(L, t, HT, 1.0); mix(R, t, HT, 0.8)
    t += 0.25

bass_seq = [(2.5,A1),(4.5,A1),(6.5,F1),(8.5,G1),(10.5,A1)]       # slow root move
for st,f in bass_seq:
    s = sub(f, 2.1); mix(L, st, s); mix(R, st, s)

arp = [A4,C5,E5,C5,A4,E5,G5,E5]                                  # 16ths under the claims
t, i = 4.0, 0
while t < 12.55:
    p = pluck(arp[i % len(arp)])
    mix(L, t, p, 1.0 if i%2==0 else 0.55)                        # ping-pong stereo
    mix(R, t, p, 0.55 if i%2==0 else 1.0)
    t += 0.25; i += 1

imp2 = impact(2.6, 1.25)                                         # end card
mix(L, 12.82, imp2); mix(R, 12.82, imp2)
pd = pad([A1*2, A1*3, C5, E5], 2.4)
mix(L, 12.82, pd); mix(R, 12.82, pd)

# ---- master: soft clip, normalise, fade out ---------------------------------
def finish(buf):
    peak = max(abs(x) for x in buf) or 1.0
    g = 0.89/peak
    for k in range(N):
        v = buf[k]*g
        v = math.tanh(v*1.18)*0.86                               # gentle glue
        if k > N-int(0.45*SR):                                   # tail fade
            v *= (N-k)/(0.45*SR)
        buf[k] = v
finish(L); finish(R)

w = wave.open("score.wav", "w")
w.setnchannels(2); w.setsampwidth(2); w.setframerate(SR)
w.writeframes(b"".join(struct.pack("<hh", int(l*32000), int(r*32000)) for l,r in zip(L,R)))
w.close()
print("wrote score.wav", round(DUR,2), "s")
