"""09.16 -- the mainnet date. 1:1, 16s, 120 BPM (bar = 2.0s). Bed: music12.py.

A dawn in four beats of story. Bars 0-1 are before sunrise: stars, a horizon,
a solo shakuhachi and the moon coming up behind the line. Bar 2 is a slot
machine: four reels spinning while the odaiko closes in, each digit locking on
a drum hit. The date lands at bar 3 cut out of a full moon. Then the launch
lines, and the end card.

The date is Arc mainnet day as recorded in MAINNET.md.
"""
from motion import *

BAR = 2.0; BEAT = BAR / 4; DUR = BAR * 8
OUT = 'frames12'
GROUND = ground(W, H)
HORIZON = 760
DATE = '09.16'

import random
_rnd = random.Random(16)
STARS = [(_rnd.uniform(40, W - 40), _rnd.uniform(60, HORIZON - 80), _rnd.uniform(1.5, 3.5), _rnd.uniform(0, 6.28))
         for _ in range(70)]

def stars(im, t, a=1.0):
    d = ImageDraw.Draw(im)
    for x, y, r, ph in STARS:
        k = a * (0.35 + 0.65 * (0.5 + 0.5 * math.sin(t * 2.2 + ph)))
        d.ellipse([x - r, y - r, x + r, y + r], fill=mix(VOID, INK, k * 0.7))

def horizon(im, t):
    hw = 470 * out_expo(t / 0.8)
    ImageDraw.Draw(im).rectangle([W / 2 - hw, HORIZON, W / 2 + hw, HORIZON + 2], fill=LINEBR)

def chrome(im):
    logomark(im, 88, 86, 46)
    text(im, 'TSUKIPAD', SG, 30, 128, 86, anchor='l')
    text(im, DATE, JB, 30, W - 72, 86, fill=LIME, anchor='r')

def s_dawn(im, t):                                          # bar 0 -- before sunrise
    stars(im, t, out_cubic(t / 1.0)); horizon(im, t)
    text(im, 'ARC MAINNET', JBR, 24, W / 2, 160, fill=mix(VOID, MUTED, out_expo((t - 0.3) / 0.8)), track=10)
    vcol(im, '夜明け前', MINCHO, 92, 920, 250, t - 0.1, fill=MUTED, stagger=0.42, dur=0.6)
    if t > 1.0:
        rise(im, 'BEFORE DAWN', SG, 60, 110, 560, t - 1.0, track=12, stagger=0.04)

def s_moonrise(im, t):                                      # bar 1 -- the moon comes up
    stars(im, t + 2, 1 - 0.6 * out_cubic(t / 2)); horizon(im, 1)
    cy = HORIZON + 270 - 320 * out_cubic(t / 2.0)
    disc(im, W / 2, cy, 260, LIME, clip_bottom=HORIZON)
    rise(im, 'THE MOON', DELA, 110, W / 2, 230, t - 0.1, anchor='c', stagger=0.035)
    rise(im, 'RISES ON', DELA, 110, W / 2, 355, t - 0.6, anchor='c', stagger=0.035, outline=3)
    if t > 1.0:
        rise(im, '月が昇る', MINCHO, 76, W / 2, 900, t - 1.0, anchor='c', stagger=0.08)

REEL_W, DOT_W, REEL_H = 176, 70, 250
LOCKS = [1.25, 1.5, 1.75, 1.875]                            # on the odaiko hits in bar 2

def reel(im, cx, cy, t, final, lock, seed):
    lay = Image.new('RGBA', (REEL_W, REEL_H), SURFACE + (255,))
    if t < lock:
        pos = t * (9 + 5 * t) + seed * 0.37
        cur = int(pos) % 10; frac = pos - int(pos)
        for k, dy in ((0, 0), (1, -REEL_H)):
            place(lay, word(str((cur + k) % 10), DELA, 190, MUTED), REEL_W / 2, REEL_H / 2 + dy + frac * REEL_H)
    else:
        k = out_back((t - lock) / 0.25, 2.4)
        place(lay, word(final, DELA, 190, INK), REEL_W / 2, REEL_H / 2 - (1 - k) * REEL_H * 0.6)
    im.paste(lay, (round(cx - REEL_W / 2), round(cy - REEL_H / 2)))
    ImageDraw.Draw(im).rectangle([cx - REEL_W / 2, cy - REEL_H / 2, cx + REEL_W / 2, cy + REEL_H / 2],
                                 outline=LIME if t >= lock else LINE, width=3)

def s_reels(im, t):                                         # bar 2 -- the date spins in
    chrome(im)
    rise(im, 'ARC MAINNET', SG, 50, W / 2, 290, t, anchor='c', track=12, stagger=0.03)
    widths = [REEL_W, REEL_W, DOT_W, REEL_W, REEL_W]; gap = 18
    x = W / 2 - (sum(widths) + gap * 4) / 2; j = (t / 2) ** 3 * 8
    li = 0
    for i, ch in enumerate(DATE):
        cx = x + widths[i] / 2 + math.sin(t * 90 + i) * j
        if ch == '.':
            text(im, '.', DELA, 190, cx, 520, fill=LIME)
        else:
            reel(im, cx, 520, t, ch, LOCKS[li], i); li += 1
        x += widths[i] + gap
    if t > 0.5:
        rise(im, 'メインネット', MINCHO, 58, W / 2, 800, t - 0.5, anchor='c', stagger=0.05)

@lru_cache(maxsize=4)
def disc_mask(cx, cy, r):
    m = Image.new('L', (W, H), 0); lay = disc_layer(r, LIME)
    m.paste(lay.getchannel('A'), (round(cx - lay.width / 2), round(cy - lay.height / 2))); return m

def s_date(im, t):                                          # bar 3 -- drop: the date cut from the moon
    size = fit(DATE, DELA, 1000, 400)
    if t < 0.1:
        im.paste(LIME, (0, 0, W, H)); text(im, DATE, DELA, size, W / 2, H / 2, fill=VOID); return
    cx, cy = W / 2, 530
    r = int(330 + 12 * out_expo((t - 0.1) / 0.5))
    disc(im, cx, cy, r, LIME)
    sc = 1 + 0.25 * (1 - out_expo((t - 0.1) / 0.25))
    lay = word(DATE, DELA, size, INK)
    if abs(sc - 1) > 1e-3:
        lay = lay.resize((round(lay.width * sc), round(lay.height * sc)), Image.BICUBIC)
    x0, y0 = round(cx - lay.width / 2), round(cy - lay.height / 2)
    full = Image.new('L', (W, H), 0); full.paste(lay.getchannel('A'), (x0, y0))
    inside = ImageChops.multiply(full, disc_mask(cx, cy, r))
    im.paste(INK, (0, 0, W, H), ImageChops.subtract(full, inside))
    im.paste(VOID, (0, 0, W, H), inside)
    rise(im, 'ARC MAINNET', SG, 40, W / 2, 130, t - 0.1, anchor='c', track=12, stagger=0.02)
    if t > 0.5:
        rise(im, '2026年9月16日', MINCHO, 52, W / 2, 960, t - 0.5, anchor='c', stagger=0.03)

def s_launchday(im, t):                                     # bar 4
    chrome(im)
    rise(im, 'LAUNCH', DELA, fit('LAUNCH', DELA, 690, 150), 90, 470, t, stagger=0.035)
    rise(im, 'DAY.', DELA, 230, 90, 710, t - BEAT, fill=LIME, stagger=0.05)
    ImageDraw.Draw(im).rectangle([818, 190, 820, 190 + 700 * out_expo(t / 0.8)], fill=LINE)
    vcol(im, '発行開始', MINCHO, 130, 940, 200, t - 0.4, stagger=0.14)
    if t > 1.2:
        lt = t - 1.2
        text(im, 'tokens on Arc, paired with USDC', JBR, 26, 90, 890, anchor='l', fill=mix(VOID, MUTED, out_expo(lt / 0.4)))
        text(im, 'USDCペアで、Arc上に発行', MINCHO, 32, 90, 940, anchor='l', fill=mix(VOID, MUTED, out_expo((lt - 0.1) / 0.4)))

def s_early(im, t):                                         # bar 5
    for i in range(6):
        marquee(im, '09.16  ', DELA, 170, 90 + i * 180, (1 if i % 2 else -1) * (t * 260) + i * 170, fill=LINE, outline=3, gap=40)
    ImageDraw.Draw(im).rectangle([120, 330, W - 120, 830], fill=VOID)
    text(im, 'BE', DELA, 150, W / 2, 440, fill=INK, scale=1 + 0.3 * (1 - out_expo(t / 0.2)))
    if t > BEAT:
        text(im, 'EARLY.', DELA, fit('EARLY.', DELA, 760, 200), W / 2, 610, fill=LIME,
             scale=1 + 0.3 * (1 - out_expo((t - BEAT) / 0.2)))
    if t > BEAT * 2:
        rise(im, '一番乗りで。', MINCHO, 58, W / 2, 790, t - BEAT * 2, anchor='c', stagger=0.05)

def s_seeyou(im, t):                                        # bar 6
    chrome(im)
    disc(im, 850, 330 - 60 * out_cubic(t / 2), int(40 + 90 * out_back(t / 0.6, 1.4)), LIME)
    for i, (s, col, ol) in enumerate([('SEE YOU', INK, 0), ('ON THE', INK, 3), ('MOON.', LIME, 0)]):
        if t > i * BEAT:
            rise(im, s, DELA, 128, 90, 560 + i * 160, t - i * BEAT, fill=col, outline=ol, stagger=0.035)
    if t > 1.4:
        rise(im, '月で会おう。', MINCHO, 56, W - 90, 980, t - 1.4, anchor='r', stagger=0.05)

def s_cta(im, t):
    cta(im, t, extra='ARC MAINNET  ·  09.16.2026')

SCENES = [s_dawn, s_moonrise, s_reels, s_date, s_launchday, s_early, s_seeyou, s_cta]
BIG = [6.0, 8.0, 10.0, 12.0, 14.0]
SMALL = [4.0, 4.75, 5.25, 5.5, 5.75, 5.875, 7.0, 9.0, 10.5, 11.0, 13.0]

def render(t):
    im = GROUND.copy()
    bar = min(7, int(t / BAR))
    SCENES[bar](im, t - bar * BAR)
    im = camera(im, 1 + 0.07 * punch(t, BIG, 12) + 0.03 * punch(t, SMALL, 18), *shake(t, [6.0, 14.0], 16))
    return finish(im, t, DUR, fade_in=0.6)

if __name__ == '__main__':
    run(render, DUR, OUT, 'mainnet916_audio.wav', 'tsukipad-0916.mp4', poster_t=7.2, poster='tsukipad-0916-poster.png')
