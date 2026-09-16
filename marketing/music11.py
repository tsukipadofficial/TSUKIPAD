"""Three-promises bed. 140 BPM half-time trap, A hirajoshi, 10 bars (~17.1s).

The fastest piece, so the bed is a shamisen over an 808: each promise lands on a
bar, and each bar is announced by a bachi slap on the downbeat. Bar 4 stops
dead on a kabuki clapper -- the cut where the video says it is written in code --
then bars 5-7 run the promises back as a double-time recap. Bars 8-9 hold the CTA.
"""
from jpsynth import *

BPM = 140.0; BEAT = 60 / BPM; BAR = BEAT * 4; NBARS = 10; DUR = BAR * NBARS
CUT = 4

front = Mix(DUR); drums = Mix(DUR)
def b(bar, beat=0.0): return (bar + beat / 4) * BAR

A = 57  # A3, hirajoshi on A: A B C E F
RIFF_A = [(0.0, 69, 1.0), (0.5, 72, 0), (0.75, 71, 0), (1.0, 69, 0), (1.5, 64, 0),
          (2.0, 65, 0.8), (2.5, 64, 0), (3.0, 69, 0), (3.5, 71, 0), (3.75, 72, 0)]
RIFF_B = [(0.0, 76, 1.0), (0.5, 77, 0), (0.75, 76, 0), (1.0, 72, 0), (1.5, 71, 0),
          (2.0, 69, 0.8), (2.5, 71, 0), (3.0, 72, 0), (3.25, 71, 0), (3.5, 69, 0)]

def riff(bar, pattern, g=0.9, oct=0):
    for i, (beat, note, bend) in enumerate(pattern):
        front.add(shamisen(note + oct, 0.5, bend=bend, seed=bar * 13 + i), b(bar, beat),
                  pan=(0.2 if i % 2 else -0.1), gain=g)

def trap_bar(bar, root, roll=False, g=1.0):
    drums.add(kick(g=0.9 * g, dec=5), b(bar, 0))
    drums.add(bass808(root, BEAT * 2.4, g=0.95 * g, glide_from=root + 5 if bar % 2 else None), b(bar, 0))
    drums.add(kick(g=0.7 * g), b(bar, 2.5))
    drums.add(bass808(root, BEAT * 1.4, g=0.8 * g), b(bar, 2.5))
    drums.add(clap(g=1.0 * g, seed=bar), b(bar, 2))
    drums.add(taiko(g=0.45 * g, pitch=1.25, seed=bar), b(bar, 2))
    for k in range(8):
        if roll and k >= 6:
            continue
        drums.add(hat(g=0.7 if k % 2 == 0 else 0.45, seed=bar * 9 + k), b(bar, k / 2), pan=0.25)
    if roll:  # triplet sixteenth roll into the next bar
        for k in range(6):
            drums.add(hat(g=0.35 + 0.08 * k, seed=bar * 11 + k), b(bar, 3 + k / 6), pan=0.25)

# bar 0: shamisen alone, a bowl under it
front.add(orin(81, 3.5, g=0.5), b(0))
riff(0, RIFF_A, g=1.0)
drums.add(taiko(g=0.8, dur=2.0), b(0, 0))
front.add(riser(BAR * 0.5, g=0.5), b(0, 2))

# bars 1-3: one promise per bar, each downbeat slapped
ROOTS = {1: 33, 2: 29, 3: 28}
for bar in (1, 2, 3):
    riff(bar, RIFF_A if bar != 3 else RIFF_B)
    trap_bar(bar, ROOTS[bar], roll=(bar == 3))
    front.add(hyoshigi(g=0.55, seed=bar), b(bar, 0), pan=0.0)
    drums.add(taiko(g=0.8, seed=bar + 50), b(bar, 0))
front.add(riser(BAR, g=0.6), b(3))

# bar 4: the cut. Clapper, then a single sustained shamisen note and air.
front.add(hyoshigi(g=1.1, seed=77), b(CUT, 0))
front.add(hyoshigi(g=0.8, seed=78), b(CUT, 0.5))
front.add(shamisen(69, BAR, bend=-2.0, seed=400), b(CUT, 1.0), gain=0.9)
front.add(sho([57, 64, 69, 71, 76], BAR * 1.1, g=0.5, attack=0.8), b(CUT, 0.5))
drums.add(bass808(33, BAR, g=0.6), b(CUT, 2.0))
front.add(riser(BEAT * 1.5, g=0.8), b(CUT, 2.5))

# bars 5-7: recap, riff doubled at the octave, hats in 16ths
for bar in (5, 6, 7):
    riff(bar, RIFF_B if bar == 6 else RIFF_A, g=0.85)
    riff(bar, RIFF_B if bar == 6 else RIFF_A, g=0.35, oct=12)
    trap_bar(bar, {5: 33, 6: 29, 7: 28}[bar], roll=(bar == 7))
    for k in range(8):
        drums.add(hat(g=0.3, seed=bar * 21 + k), b(bar, k / 2 + 0.25), pan=-0.3)
    drums.add(taiko(g=0.7, seed=bar + 70), b(bar, 0))
    for beat in (1, 3):
        drums.add(ka(g=0.7, seed=bar + beat), b(bar, beat + 0.5), pan=-0.2)

# bar 8: CTA -- one hit and it rings
drums.add(taiko(g=1.1, dur=2.4, seed=123), b(8))
drums.add(bass808(33, BAR, g=0.8), b(8))
drums.add(kick(g=0.8), b(8))
front.add(hyoshigi(g=0.9, seed=5), b(8))
front.add(orin(81, 3.0, g=0.7), b(8))
front.add(shamisen(81, BAR, bend=-1.0, seed=900), b(8, 1.0), gain=0.8)
front.add(sho([57, 64, 69, 71, 76], BAR * 2, g=0.35, attack=0.6), b(8, 0.5))
front.add(shamisen(69, BAR, bend=-0.5, seed=901), b(9, 0.0), gain=0.5)

reverb(front, t60=1.8, wet=0.18)
reverb(drums, t60=0.9, wet=0.05, damp=3000, seed=41)
out = front.bus(); out.absorb(front); out.absorb(drums)
master(out, 'promises_audio.wav', drive=1.0, fade_out=0.8)
print(f'wrote promises_audio.wav  {DUR:.3f}s  bar={BAR:.4f}s  cut at {BAR * CUT:.3f}s')
