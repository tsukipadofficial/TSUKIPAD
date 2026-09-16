"""09.16 mainnet bed. 120 BPM, D yo scale into D in scale, 16s / 8 bars.

Opens before dawn: sho drone and a solo shakuhachi, nothing in time. Bar 2 is
the build -- odaiko hits spaced further apart and then closer, the way a taiko
group accelerates -- and the date lands at bar 3 with the whole ensemble. The
koto groove carries the launch lines, and bar 7 resolves onto a major-ish yo
chord so the piece ends looking up rather than down.
"""
from jpsynth import *

BPM = 120.0; BEAT = 60 / BPM; BAR = BEAT * 4; DUR = BAR * 8
DROP = 3

front = Mix(DUR); drums = Mix(DUR)
def b(bar, beat=0.0): return (bar + beat / 4) * BAR

# bars 0-1: dawn
front.add(sho([50, 57, 62, 64, 69], BAR * 2.9, g=0.45, attack=2.2), b(0))
drums.add(sub(26 + 12, BAR * 2.9, g=0.22), b(0))
for beat, note, dur, scoop, fall in [(0.25, 62, 1.6, -2.0, 0.0), (2.0, 64, 0.9, -0.7, 0.0), (3.0, 69, 2.2, -1.8, 0.0),
                                     (5.5, 67, 0.6, -0.5, 0.0), (6.25, 64, 1.6, -0.4, 1.5)]:
    front.add(shakuhachi(note + 12, dur * BEAT * 2 * 0.5 + dur * 0.25, scoop=scoop, fall=fall, vib=0.26, seed=int(beat * 5)),
              b(0, beat), pan=-0.05, gain=0.5)
front.add(orin(74, 4.0, g=0.45), b(1, 0), pan=0.25)

# bar 2: the build -- odaiko closing in, shime underneath, riser
for i, beat in enumerate([0.0, 1.5, 2.5, 3.0, 3.25, 3.5, 3.625, 3.75, 3.875]):
    drums.add(taiko(g=0.55 + 0.05 * i, pitch=1 + 0.01 * i, seed=200 + i), b(2, beat), pan=(-0.15 if i % 2 else 0.15))
for k in range(16):
    drums.add(shime(g=0.12 + 0.03 * k, seed=300 + k), b(2, k / 4), pan=0.25)
front.add(riser(BAR, g=0.9), b(2))
for k, note in enumerate([62, 64, 67, 69, 74, 76, 79, 81]):
    front.add(koto(note, 0.5, seed=500 + k), b(2, 2 + k / 4), pan=-0.3 + 0.08 * k, gain=0.6)

# bars 3-6: date, then groove
GROOVE = {3: [74, 69, 70, 74, 77, 74, 70, 69],
          4: [74, 69, 70, 74, 75, 74, 70, 67],
          5: [70, 67, 69, 70, 74, 70, 69, 67],
          6: [69, 70, 74, 75, 77, 79, 81, 82]}
ROOT = {3: 38, 4: 38, 5: 34, 6: 33}
for bar in range(3, 7):
    t0 = b(bar)
    drums.add(taiko(g=1.2 if bar == DROP else 0.95, seed=600 + bar, dur=2.0 if bar == DROP else 1.6), t0)
    drums.add(kick(g=0.85), t0); drums.add(kick(g=0.7), b(bar, 1.5)); drums.add(kick(g=0.75), b(bar, 2.0))
    drums.add(taiko(g=0.6, pitch=1.1, seed=610 + bar), b(bar, 2.5))
    for beat in (1, 3):
        drums.add(clap(g=0.9, seed=620 + bar + beat), b(bar, beat))
        drums.add(ka(g=0.6, seed=bar + beat), b(bar, beat), pan=-0.25)
    for k in range(16):
        if bar < 5 and k % 2: continue
        drums.add(hat(g=0.55 if k % 4 == 2 else 0.32, seed=bar * 17 + k), b(bar, k / 4), pan=0.28)
    for k, note in enumerate(GROOVE[bar]):
        front.add(koto(note, 0.7, bend=(1.0 if k == 0 and bar != DROP else 0), seed=700 + bar * 8 + k),
                  b(bar, k / 2), pan=0.22, gain=0.8)
    for beat in (0, 0.75, 2, 2.75, 3.5):
        drums.add(sub(ROOT[bar], BEAT * 0.7, g=0.95), b(bar, beat))
front.add(hyoshigi(g=1.0), b(DROP, 0)); front.add(orin(86, 3.5, g=0.5), b(DROP, 0), pan=-0.2)
front.add(downer(1.5, g=0.45), b(DROP, 0))
front.add(sho([62, 69, 74, 76], BAR * 2, g=0.35, attack=0.4), b(DROP))
# shakuhachi answers over bars 4-5
for beat, note, dur, scoop in [(0.0, 81, 1.0, -1.5), (1.0, 79, 0.5, -0.4), (1.5, 76, 2.5, -0.4),
                               (4.5, 74, 1.0, -1.2), (5.5, 76, 0.5, -0.3), (6.0, 74, 2.0, -0.2)]:
    front.add(shakuhachi(note, dur * BEAT + 0.08, scoop=scoop, fall=(1.0 if beat == 6.0 else 0), seed=800 + int(beat * 3)),
              b(4, beat), pan=-0.12, gain=0.5)
drums.add(taiko(g=0.8, seed=650), b(6, 3.5)); front.add(riser(BAR * 0.5, g=0.5), b(6, 2))

# bar 7: resolve up onto a yo chord and ring
drums.add(taiko(g=1.2, seed=900, dur=2.4), b(7)); drums.add(kick(g=0.8), b(7)); drums.add(sub(38, BAR, g=0.9), b(7))
front.add(hyoshigi(g=0.8, seed=9), b(7))
front.add(orin(74, 4.0, g=0.9), b(7))
front.add(sho([62, 66, 69, 71, 74], BAR * 1.2, g=0.55, attack=0.25), b(7))
for k, note in enumerate([62, 66, 69, 74, 78]):
    front.add(koto(note, 2.2, seed=950 + k, bend=(-1.0 if k == 4 else 0), bend_t=0.2), b(7, k * 0.12), pan=-0.3 + 0.15 * k, gain=0.7)

reverb(front, t60=2.8, wet=0.28)
reverb(drums, t60=1.5, wet=0.08, damp=3000, seed=51)
out = front.bus(); out.absorb(front); out.absorb(drums)
master(out, 'mainnet916_audio.wav', drive=0.95, fade_out=0.9)
print(f'wrote mainnet916_audio.wav  {DUR}s  drop at {BAR * DROP}s')
