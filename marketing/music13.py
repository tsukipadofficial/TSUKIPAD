"""Hours-left bed. 120 BPM, D in scale, 20s / 10 bars.

A clock that becomes a drum kit. Bars 0-1 are the night before: a ka rim tick
and a lower tock on every beat, sho underneath, a solo shakuhachi. Bar 2 the
ticks double and double again while the odaiko closes in, and the drop lands
at bar 3. Shamisen joins the koto for the feature lines, bar 7 is the peak,
bar 8 pulls back to the clock alone, and bar 9 resolves up onto a yo chord.
"""
from jpsynth import *

BPM = 120.0; BEAT = 60 / BPM; BAR = BEAT * 4; DUR = BAR * 10
DROP = 3

front = Mix(DUR); drums = Mix(DUR)
def b(bar, beat=0.0): return (bar + beat / 4) * BAR

def tick(bar, beat, g=1.0):
    """Tick on the beat, tock off it -- a wall clock played on the rim."""
    hi = int(beat * 2) % 2 == 0
    drums.add(ka(g=(0.55 if hi else 0.4) * g, seed=int(bar * 8 + beat * 2)), b(bar, beat), pan=(0.3 if hi else -0.3))

# bars 0-1: the night before
for bar in (0, 1):
    for beat in range(4):
        tick(bar, beat)
front.add(sho([50, 57, 62, 63, 69], BAR * 2.9, g=0.45, attack=2.0), b(0))
drums.add(sub(38, BAR * 2.9, g=0.2), b(0))
for beat, note, dur, scoop, fall in [(0.5, 74, 1.4, -2.0, 0.0), (2.0, 75, 0.8, -0.6, 0.0), (3.0, 79, 1.8, -1.6, 0.0),
                                     (5.0, 81, 0.7, -0.5, 0.0), (5.75, 79, 0.5, -0.3, 0.0), (6.5, 75, 1.4, -0.4, 1.4)]:
    front.add(shakuhachi(note, dur * BEAT + 0.15, scoop=scoop, fall=fall, vib=0.25, seed=int(beat * 7)),
              b(0, beat), pan=-0.08, gain=0.5)
front.add(orin(74, 4.0, g=0.4), b(1, 0), pan=0.25)
for k, note in enumerate([62, 67, 69, 74]):
    front.add(koto(note, 1.2, seed=40 + k), b(1, 2 + k * 0.5), pan=-0.2 + 0.12 * k, gain=0.45)

# bar 2: the build -- clock speeds up, odaiko closes in
for k in range(8):
    tick(2, k / 2, g=0.8 + 0.03 * k)
for k in range(8):
    drums.add(shime(g=0.12 + 0.035 * k, seed=300 + k), b(2, 2 + k / 4), pan=0.25)
for i, beat in enumerate([0.0, 1.5, 2.5, 3.0, 3.25, 3.5, 3.625, 3.75, 3.875]):
    drums.add(taiko(g=0.55 + 0.05 * i, pitch=1 + 0.012 * i, seed=200 + i), b(2, beat), pan=(-0.15 if i % 2 else 0.15))
front.add(riser(BAR, g=0.95), b(2))
for k, note in enumerate([62, 63, 67, 69, 70, 74, 75, 79]):
    front.add(koto(note, 0.5, seed=500 + k), b(2, 2 + k / 4), pan=-0.3 + 0.08 * k, gain=0.6)

# bars 3-7: drop and groove
GROOVE = {3: [74, 70, 69, 74, 75, 74, 69, 67],
          4: [74, 70, 69, 74, 79, 75, 74, 70],
          5: [70, 69, 67, 70, 74, 70, 69, 67],
          6: [74, 70, 69, 74, 75, 74, 69, 67],
          7: [69, 70, 74, 75, 79, 81, 82, 86]}
ROOT = {3: 38, 4: 38, 5: 34, 6: 38, 7: 33}
SHAMI = [50, 50, 57, 50, 62, 50, 58, 57]
for bar in range(3, 8):
    t0 = b(bar)
    drums.add(taiko(g=1.2 if bar == DROP else 0.95, seed=600 + bar, dur=2.0 if bar == DROP else 1.6), t0)
    drums.add(kick(g=0.85), t0); drums.add(kick(g=0.7), b(bar, 1.5)); drums.add(kick(g=0.75), b(bar, 2.0))
    drums.add(taiko(g=0.6, pitch=1.1, seed=610 + bar), b(bar, 2.5))
    for beat in (1, 3):
        drums.add(clap(g=0.9, seed=620 + bar + beat), b(bar, beat))
        drums.add(ka(g=0.55, seed=bar + beat), b(bar, beat), pan=-0.25)
    for k in range(16):
        if bar < 5 and k % 2: continue
        drums.add(hat(g=0.55 if k % 4 == 2 else 0.32, seed=bar * 17 + k), b(bar, k / 4), pan=0.28)
    for k, note in enumerate(GROOVE[bar]):
        front.add(koto(note, 0.7, bend=(1.0 if k == 0 and bar != DROP else 0), seed=700 + bar * 8 + k),
                  b(bar, k / 2), pan=0.22, gain=0.8)
    if bar >= 5:
        for k, note in enumerate(SHAMI):
            front.add(shamisen(note, 0.4, bend=(0.8 if k == 4 else 0), seed=760 + bar * 8 + k),
                      b(bar, k / 2 + 0.25), pan=-0.3, gain=0.55)
    for beat in (0, 0.75, 2, 2.75, 3.5):
        drums.add(sub(ROOT[bar], BEAT * 0.7, g=0.95), b(bar, beat))
front.add(hyoshigi(g=1.0), b(DROP, 0)); front.add(orin(86, 3.5, g=0.5), b(DROP, 0), pan=-0.2)
front.add(downer(1.5, g=0.45), b(DROP, 0))
front.add(sho([62, 69, 74, 75], BAR * 2, g=0.35, attack=0.4), b(DROP))
# shakuhachi lead over bars 6-7
for beat, note, dur, scoop in [(0.0, 86, 1.0, -1.5), (1.0, 82, 0.5, -0.4), (1.5, 81, 2.5, -0.4),
                               (4.5, 79, 1.0, -1.2), (5.5, 81, 0.5, -0.3), (6.0, 86, 2.0, -0.6)]:
    front.add(shakuhachi(note, dur * BEAT + 0.08, scoop=scoop, seed=800 + int(beat * 3)),
              b(6, beat), pan=-0.12, gain=0.45)
for k in range(8):
    drums.add(shime(g=0.2 + 0.05 * k, seed=880 + k), b(7, 2 + k / 4), pan=0.2)
drums.add(taiko(g=0.9, seed=650), b(7, 3.5)); front.add(riser(BAR * 0.5, g=0.5), b(7, 2))

# bar 8: pull back to the clock
drums.add(taiko(g=1.1, seed=890, dur=2.0), b(8)); drums.add(kick(g=0.8), b(8))
front.add(hyoshigi(g=0.7, seed=4), b(8))
front.add(sho([50, 57, 62, 69, 74], BAR * 1.2, g=0.5, attack=0.3), b(8))
for beat in range(4):
    tick(8, beat, g=0.9)
for k, note in enumerate([74, 69, 67, 62]):
    front.add(koto(note, 1.0, seed=860 + k), b(8, k), pan=0.2 - 0.1 * k, gain=0.6)
drums.add(sub(38, BAR, g=0.7), b(8))

# bar 9: resolve up onto a yo chord and ring
drums.add(taiko(g=1.2, seed=900, dur=2.4), b(9)); drums.add(kick(g=0.8), b(9)); drums.add(sub(38, BAR, g=0.9), b(9))
front.add(hyoshigi(g=0.8, seed=9), b(9))
front.add(orin(74, 4.0, g=0.9), b(9))
front.add(sho([62, 66, 69, 71, 74], BAR * 1.2, g=0.55, attack=0.25), b(9))
for k, note in enumerate([62, 66, 69, 74, 78]):
    front.add(koto(note, 2.2, seed=950 + k, bend=(-1.0 if k == 4 else 0), bend_t=0.2), b(9, k * 0.12), pan=-0.3 + 0.15 * k, gain=0.7)

reverb(front, t60=2.8, wet=0.28)
reverb(drums, t60=1.5, wet=0.08, damp=3000, seed=51)
out = front.bus(); out.absorb(front); out.absorb(drums)
master(out, 'hoursleft_audio.wav', drive=0.95, fade_out=0.9)
print(f'wrote hoursleft_audio.wav  {DUR}s  drop at {BAR * DROP}s')
