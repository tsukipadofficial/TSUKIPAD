"""TSUKI bed. 120 BPM, D miyako-bushi (in scale), 16s / 8 bars.

The name piece, so the bed is the most Japanese of the set: a temple bowl and a
solo koto phrase with bends, a koto ostinato under shime-daiko, a roll that
tightens into a kabuki clapper, then odaiko drops the whole thing at bar 3.
Bars 4-6 are a groove with shakuhachi over it; bar 7 is one last drum and the
bowl ringing out under the CTA.
"""
from jpsynth import *

BPM = 120.0; BEAT = 60 / BPM; BAR = BEAT * 4; DUR = BAR * 8
DROP = 3

front = Mix(DUR)     # strings, winds, bells -- these get the room
drums = Mix(DUR)     # low end stays mostly dry

def b(bar, beat=0.0): return (bar + beat / 4) * BAR

# ---------------------------------------------------------------- bar 0
front.add(orin(74, 5.0, g=0.8), b(0, 0), pan=0.1)
front.add(sho([62, 67, 69, 74], BAR * 2.2, g=0.4, attack=1.6), b(0, 0))
for beat, note, bend, pan in [(0.5, 69, 0, -0.2), (1.0, 70, 0, -0.1), (1.5, 74, -1.0, 0.0),
                              (2.5, 69, 0, 0.1), (3.0, 67, 0, 0.15), (3.5, 69, 1.0, 0.0)]:
    front.add(koto(note, 1.6, bend=bend, seed=int(beat * 4)), b(0, beat), pan=pan, gain=0.7)

# ---------------------------------------------------------------- bar 1-2
OSTINATO = [62, 69, 70, 69, 74, 69, 70, 67]
for bar in (1, 2):
    for k, note in enumerate(OSTINATO):
        front.add(koto(note, 0.9, seed=bar * 10 + k), b(bar, k / 2), pan=-0.25 if k % 2 else 0.2, gain=0.6)
        if bar == 2 and k >= 4:
            front.add(koto(note + 12, 0.6, seed=bar * 30 + k), b(bar, k / 2), pan=0.35, gain=0.5)
    drums.add(sub(38, BAR, g=0.55 + 0.15 * (bar - 1)), b(bar))
for beat in range(4):
    drums.add(shime(g=0.6, seed=beat), b(1, beat), pan=0.1)
    drums.add(ka(g=0.5, seed=beat), b(1, beat + 0.5), pan=-0.3)
drums.add(taiko(g=0.55), b(1, 0))
# bar 2: the roll tightens -- eighths, sixteenths, then thirty-seconds
roll = [k / 2 for k in range(4)] + [2 + k / 4 for k in range(4)] + [3 + k / 8 for k in range(6)]
for i, beat in enumerate(roll):
    drums.add(shime(g=0.35 + 0.55 * i / len(roll), seed=40 + i, pitch=1 + 0.002 * i), b(2, beat),
              pan=(-0.2 if i % 2 else 0.2))
front.add(riser(BAR, g=0.75), b(2))
front.add(hyoshigi(g=1.0), b(2, 3.75), pan=0.0)

# ---------------------------------------------------------------- bar 3+: drop
RIFF = {3: [74, 0, 75, 74, 69, 0, 70, 69],
        4: [74, 0, 75, 74, 69, 0, 70, 67],
        5: [70, 0, 74, 70, 69, 0, 67, 69],
        6: [67, 0, 69, 70, 74, 75, 77, 79]}
ROOT = {3: 38, 4: 38, 5: 34, 6: 31}
for bar in range(3, 7):
    t0 = b(bar)
    drums.add(taiko(g=1.1 if bar == DROP else 0.9, seed=bar), t0)
    drums.add(kick(g=0.7), t0)
    drums.add(taiko(g=0.55, pitch=1.12, seed=bar + 20), b(bar, 2.0), pan=-0.15)
    drums.add(taiko(g=0.45, pitch=1.18, seed=bar + 30), b(bar, 2.5), pan=0.15)
    drums.add(taiko(g=0.75, seed=bar + 40), b(bar, 3.0))
    drums.add(kick(g=0.6), b(bar, 2.0))
    for beat in (1, 3):
        drums.add(clap(g=0.8, seed=bar + beat), b(bar, beat), pan=0.05)
    for k in range(8):
        drums.add(shime(g=0.28 + (0.12 if k % 2 == 0 else 0), seed=bar * 8 + k), b(bar, k / 2), pan=0.3)
        drums.add(hat(g=0.55, seed=bar + k), b(bar, k / 2 + 0.25), pan=-0.3)
    for k, note in enumerate(RIFF[bar]):
        if note:
            front.add(koto(note, 0.8, bend=(1.0 if k == 0 else 0.0), seed=bar * 50 + k), b(bar, k / 2),
                      pan=0.25, gain=0.85)
    for beat in (0, 1.5, 2, 3.5):
        drums.add(sub(ROOT[bar], BEAT * 1.4, g=0.9), b(bar, beat))
front.add(orin(86, 3.0, g=0.35), b(DROP, 0), pan=-0.2)
front.add(downer(1.4, g=0.5), b(DROP, 0))

# shakuhachi over bars 5-6
for beat, note, dur, scoop in [(0.0, 74, 1.5, -1.5), (1.5, 75, 0.5, -0.6), (2.0, 74, 2.0, 0.0),
                               (4.0, 79, 1.0, -2.0), (5.0, 77, 1.0, -0.8), (6.0, 75, 0.5, -0.5), (6.5, 74, 1.5, -0.4)]:
    front.add(shakuhachi(note, dur * BEAT + 0.08, scoop=scoop, fall=(1.2 if beat == 6.5 else 0), seed=int(beat * 7)),
              b(5, beat), pan=-0.1, gain=0.55)

# ---------------------------------------------------------------- bar 7: out
drums.add(taiko(g=1.15, seed=99, dur=2.2), b(7))
drums.add(kick(g=0.6), b(7))
drums.add(sub(38, BAR, g=0.9), b(7))
front.add(orin(74, 4.0, g=0.9), b(7), pan=0.1)
front.add(koto(74, 2.0, bend=-1.0, bend_t=0.25, vib=0.25, seed=777), b(7, 0.5), pan=0.0, gain=1.0)
front.add(hyoshigi(g=0.7, seed=3), b(7, 0))

reverb(front, t60=2.6, wet=0.26)
reverb(drums, t60=1.4, wet=0.07, damp=3000, seed=31)
out = front.bus(); out.absorb(front, 1.0); out.absorb(drums, 1.0)
master(out, 'tsuki_audio.wav', drive=0.95, fade_out=0.9)
print(f'wrote tsuki_audio.wav  {DUR}s  drop at {BAR * DROP}s')
