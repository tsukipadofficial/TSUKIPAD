"""Hours left -- the night before Arc mainnet and TSUKIPAD mainnet. 1:1, 20s,
120 BPM (bar = 2.0s). Bed: music13.py.

The night before, told on a clock. Bars 0-1: stars, a ticking second hand and
"a few hours left". Bar 2 is the clock racing -- reels of digits spinning down
while the odaiko closes in. The drop at bar 3 cuts HOURS out of a full moon.
Then both mainnets on one day, the two ways to launch, what launching costs,
and the end card.

Every number on screen is what the deployed contracts enforce: launch fee 0,
curve graduation at $10,400 raised (a $52K market cap), creator tax capped at
500 bps, and direct launches open at DEFAULT_START_MCAP_USD in web/lib/config.ts.
No clock time is shown -- Circle has published the date, not the hour.
"""
from motion import *

BAR = 2.0; BEAT = BAR / 4; DUR = BAR * 10
OUT = 'frames13'
GROUND = ground(W, H)
HORIZON = 780

import random
_rnd = random.Random(13)
STARS = [(_rnd.uniform(40, W - 40), _rnd.uniform(60, HORIZON - 80), _rnd.uniform(1.5, 3.5), _rnd.uniform(0, 6.28))
         for _ in range(70)]

def stars(im, t, a=1.0):
    d = ImageDraw.Draw(im)
    for x, y, r, ph in STARS:
        k = a * (0.35 + 0.65 * (0.5 + 0.5 * math.sin(t * 2.2 + ph)))
        d.ellipse([x - r, y - r, x + r, y + r], fill=mix(VOID, INK, k * 0.7))

def chrome(im):
    logomark(im, 88, 86, 46)
    text(im, 'TSUKIPAD', SG, 30, 128, 86, anchor='l')
    text(im, '09.16', JB, 30, W - 72, 86, fill=LIME, anchor='r')

def clockface(im, cx, cy, r, t, a=1.0):
    """A dial with a second hand that steps on every beat, the way the ticks sound."""
    d = ImageDraw.Draw(im)
    for k in range(60):
        ang = k / 60 * 2 * math.pi
        long = k % 5 == 0
        r0 = r - (26 if long else 12)
        col = mix(VOID, INK if long else LINEBR, a)
        d.line([(cx + r0 * math.sin(ang), cy - r0 * math.cos(ang)), (cx + r * math.sin(ang), cy - r * math.cos(ang))],
               fill=col, width=4 if long else 2)
    step = math.floor(t / BEAT); frac = (t / BEAT) - step
    pos = step + out_back(frac / 0.18, 2.6)                   # snap to each tick with a little overshoot
    ang = pos / 60 * 2 * math.pi * 5                          # five marks per beat so it visibly moves
    aa_stroke(im, [(cx, cy), (cx + (r - 40) * math.sin(ang), cy - (r - 40) * math.cos(ang))], 5, mix(VOID, LIME, a))
    disc(im, cx, cy, 12, mix(VOID, PINK, a))

def s_night(im, t):                                         # bar 0 -- the night before
    stars(im, t, out_cubic(t / 1.0))
    clockface(im, 360, 470, 250, t, out_cubic(t / 0.6))
    text(im, 'ARC MAINNET', JBR, 24, W / 2, 110, fill=mix(VOID, MUTED, out_expo((t - 0.2) / 0.8)), track=10)
    vcol(im, 'あと数時間', MINCHO, 92, 900, 190, t - 0.2, fill=INK, stagger=0.3, dur=0.55)
    if t > 1.0:
        rise(im, 'THE NIGHT BEFORE', SG, 52, 110, 900, t - 1.0, track=8, stagger=0.03)

def s_fewhours(im, t):                                      # bar 1 -- a few hours left
    stars(im, t + 2, 1 - 0.5 * out_cubic(t / 2))
    ImageDraw.Draw(im).rectangle([W / 2 - 470, HORIZON, W / 2 + 470, HORIZON + 2], fill=LINEBR)
    disc(im, 860, HORIZON + 170 - 250 * out_cubic(t / 2.0), 150, LIME, clip_bottom=HORIZON)
    for i, (s, col, ol) in enumerate([('A FEW', INK, 0), ('HOURS', LIME, 0), ('LEFT.', INK, 3)]):
        if t > i * BEAT * 0.6:
            rise(im, s, DELA, 140, 90, 300 + i * 170, t - i * BEAT * 0.6, fill=col, outline=ol, stagger=0.035)
    if t > 1.1:
        rise(im, 'メインネットまで', MINCHO, 54, 90, 900, t - 1.1, stagger=0.05)

REEL_W, COLON_W, REEL_H = 132, 44, 200

def reel(im, cx, cy, t, speed, seed, settle):
    """A digit counting DOWN. `settle` > 0 slows it into a blur-free stop on 0."""
    lay = Image.new('RGBA', (REEL_W, REEL_H), SURFACE + (255,))
    pos = -(t * speed * (1 - 0.85 * settle)) + seed * 0.61
    cur = int(math.floor(pos)) % 10; frac = pos - math.floor(pos)
    for k, dy in ((0, 0), (1, REEL_H)):
        place(lay, word(str((cur + k) % 10), DELA, 150, INK if settle > 0.5 else MUTED),
              REEL_W / 2, REEL_H / 2 + dy - frac * REEL_H)
    im.paste(lay, (round(cx - REEL_W / 2), round(cy - REEL_H / 2)))
    ImageDraw.Draw(im).rectangle([cx - REEL_W / 2, cy - REEL_H / 2, cx + REEL_W / 2, cy + REEL_H / 2],
                                 outline=LIME if settle > 0.5 else LINE, width=3)

def s_race(im, t):                                          # bar 2 -- the clock races
    chrome(im)
    rise(im, 'T-MINUS', DELA, 90, W / 2, 300, t, anchor='c', stagger=0.03)
    widths = [REEL_W, REEL_W, COLON_W, REEL_W, REEL_W, COLON_W, REEL_W, REEL_W]; gap = 12
    x = W / 2 - (sum(widths) + gap * (len(widths) - 1)) / 2
    j = (t / 2) ** 3 * 10; ri = 0
    speeds = [2, 5, 0, 7, 11, 0, 16, 23]
    for i, wdt in enumerate(widths):
        cx = x + wdt / 2 + math.sin(t * 90 + i) * j
        if wdt == COLON_W:
            if int(t / BEAT * 2) % 2 == 0:
                text(im, ':', DELA, 150, cx, 520, fill=LIME)
        else:
            reel(im, cx, 540, t, speeds[i] * (1 + t), ri, 0); ri += 1
        x += wdt + gap
    if t > 0.5:
        rise(im, '秒読み', MINCHO, 70, W / 2, 830, t - 0.5, anchor='c', stagger=0.12)
    bar = 1080 * out_cubic(t / 2)
    ImageDraw.Draw(im).rectangle([0, H - 12, bar, H], fill=LIME)

@lru_cache(maxsize=4)
def disc_mask(cx, cy, r):
    m = Image.new('L', (W, H), 0); lay = disc_layer(r, LIME)
    m.paste(lay.getchannel('A'), (round(cx - lay.width / 2), round(cy - lay.height / 2))); return m

def s_drop(im, t):                                          # bar 3 -- HOURS cut from the moon
    WORD = 'HOURS'
    size = fit(WORD, DELA, 1000, 360)
    if t < 0.1:
        im.paste(LIME, (0, 0, W, H)); text(im, WORD, DELA, size, W / 2, H / 2, fill=VOID); return
    cx, cy = W / 2, 520
    r = int(330 + 12 * out_expo((t - 0.1) / 0.5))
    disc(im, cx, cy, r, LIME)
    sc = 1 + 0.25 * (1 - out_expo((t - 0.1) / 0.25))
    lay = word(WORD, DELA, size, INK)
    if abs(sc - 1) > 1e-3:
        lay = lay.resize((round(lay.width * sc), round(lay.height * sc)), Image.BICUBIC)
    x0, y0 = round(cx - lay.width / 2), round(cy - lay.height / 2)
    full = Image.new('L', (W, H), 0); full.paste(lay.getchannel('A'), (x0, y0))
    inside = ImageChops.multiply(full, disc_mask(cx, cy, r))
    im.paste(INK, (0, 0, W, H), ImageChops.subtract(full, inside))
    im.paste(VOID, (0, 0, W, H), inside)
    rise(im, 'ONLY A FEW', SG, 44, W / 2, 130, t - 0.1, anchor='c', track=12, stagger=0.02)
    if t > 0.5:
        rise(im, 'LEFT.', DELA, 80, W / 2, 940, t - 0.5, anchor='c', stagger=0.04, fill=LIME)

def s_sameday(im, t):                                       # bar 4 -- both mainnets, one day
    chrome(im)
    rise(im, 'ARC', DELA, 150, 90, 350, t, stagger=0.04)
    rise(im, 'MAINNET', DELA, 110, 90, 480, t - 0.1, stagger=0.03, outline=3)
    if t > BEAT:
        rise(im, 'TSUKIPAD', DELA, fit('TSUKIPAD', DELA, 700, 150), 90, 660, t - BEAT, fill=LIME, stagger=0.035)
        rise(im, 'MAINNET', DELA, 110, 90, 790, t - BEAT - 0.1, fill=LIME, stagger=0.03, outline=3)
    ImageDraw.Draw(im).rectangle([818, 190, 820, 190 + 720 * out_expo(t / 0.8)], fill=LINE)
    vcol(im, '同じ日', MINCHO, 140, 945, 230, t - 0.4, stagger=0.16)
    if t > 1.3:
        text(im, 'SAME DAY.', JB, 40, 90, 930, anchor='l', fill=mix(VOID, INK, out_expo((t - 1.3) / 0.4)), track=4)

def curve_panel(im, x0, y0, x1, y1, t):
    d = ImageDraw.Draw(im); d.rectangle([x0, y0, x1, y1], fill=SURFACE, outline=LINE, width=3)
    pts = curve_pts(x0 + 50, y1 - 70, x1 - 50, y0 + 150)
    n = max(2, int(len(pts) * out_cubic(t / 1.0)))
    aa_stroke(im, pts[:n], 9, LIME)
    if n > 2: disc(im, pts[n - 1][0], pts[n - 1][1], 14, PINK)
    if t > 1.0:
        gx, gy = pts[-1]
        text(im, '$52K', JB, 34, gx - 10, gy - 44, anchor='r', fill=mix(VOID, INK, out_expo((t - 1.0) / 0.3)))

def direct_panel(im, x0, y0, x1, y1, t):
    d = ImageDraw.Draw(im); d.rectangle([x0, y0, x1, y1], fill=SURFACE, outline=LINE, width=3)
    k = out_back(t / 0.5, 1.6)
    bw = (x1 - x0 - 100)
    top = y1 - 70 - (y1 - y0 - 230) * k
    d.rectangle([x0 + 50, top, x0 + 50 + bw, y1 - 70], fill=CYAN)
    if t > 0.6:
        text(im, 'POOL', JB, 34, (x0 + x1) / 2, top - 40, fill=mix(VOID, INK, out_expo((t - 0.6) / 0.3)))

def s_choice(im, t):                                        # bar 5 -- curve or direct
    chrome(im)
    rise(im, 'CURVE', DELA, 96, 90, 290, t, stagger=0.03)
    rise(im, 'OR DIRECT.', DELA, 96, 90, 400, t - 0.15, stagger=0.03, fill=LIME)
    if t > 0.3:
        tt_ = t - 0.3
        curve_panel(im, 90, 470, 520, 860, tt_)
        direct_panel(im, 560, 470, 990, 860, tt_ - 0.2)
        text(im, 'BONDING CURVE', JB, 28, 305, 900, fill=mix(VOID, INK, out_expo(tt_ / 0.4)))
        text(im, 'STRAIGHT TO POOL', JB, 28, 775, 900, fill=mix(VOID, INK, out_expo((tt_ - 0.2) / 0.4)))
    if t > 1.2:
        rise(im, '選ぶのは、あなた。', MINCHO, 44, W / 2, 990, t - 1.2, anchor='c', stagger=0.04)

FEATURES = [('FREE', 'TO LAUNCH', '発行無料', LIME),
            ('$52K', 'GRADUATION', 'カーブ卒業', INK),
            ('5%', 'MAX CREATOR TAX', '発行者税', PINK)]

def s_features(im, t):                                      # bar 6 -- what it costs
    chrome(im)
    for i, (big, small, jp, col) in enumerate(FEATURES):
        lt = t - i * BEAT * 1.2
        if lt <= 0: continue
        y = 300 + i * 250
        ImageDraw.Draw(im).rectangle([90, y + 105, 90 + 900 * out_expo(lt / 0.6), y + 107], fill=LINE)
        rise(im, big, DELA, 150, 90, y + 60, lt, fill=col, stagger=0.04)
        if lt > 0.15:
            rise(im, small, SG, 44, 990, y - 10, lt - 0.15, anchor='r', track=4, stagger=0.02)
            rise(im, jp, MINCHO, 44, 990, y + 60, lt - 0.25, anchor='r', stagger=0.06, fill=MUTED)

def s_early(im, t):                                         # bar 7 -- be early
    for i in range(6):
        marquee(im, '09.16  ', DELA, 170, 90 + i * 180, (1 if i % 2 else -1) * (t * 300) + i * 170, fill=LINE, outline=3, gap=40)
    ImageDraw.Draw(im).rectangle([120, 330, W - 120, 830], fill=VOID)
    text(im, 'BE', DELA, 150, W / 2, 440, fill=INK, scale=1 + 0.3 * (1 - out_expo(t / 0.2)))
    if t > BEAT:
        text(im, 'EARLY.', DELA, fit('EARLY.', DELA, 760, 200), W / 2, 610, fill=LIME,
             scale=1 + 0.3 * (1 - out_expo((t - BEAT) / 0.2)))
    if t > BEAT * 2:
        rise(im, '一番乗りで。', MINCHO, 58, W / 2, 790, t - BEAT * 2, anchor='c', stagger=0.05)

def s_seeyou(im, t):                                        # bar 8 -- the clock again, then the moon
    stars(im, t + 16, 0.8)
    clockface(im, 820, 330, 150, t, 0.9)
    for i, (s, col, ol) in enumerate([('SEE YOU', INK, 0), ('ON THE', INK, 3), ('MOON.', LIME, 0)]):
        if t > i * BEAT:
            rise(im, s, DELA, 128, 90, 600 + i * 150, t - i * BEAT, fill=col, outline=ol, stagger=0.035)
    if t > 1.4:
        rise(im, '月で会おう。', MINCHO, 56, W - 90, 1000, t - 1.4, anchor='r', stagger=0.05)

def s_cta(im, t):
    cta(im, t, extra='ARC MAINNET  ·  09.16.2026')

SCENES = [s_night, s_fewhours, s_race, s_drop, s_sameday, s_choice, s_features, s_early, s_seeyou, s_cta]
BIG = [6.0, 8.0, 10.0, 12.0, 14.0, 16.0, 18.0]
SMALL = [4.0, 4.75, 5.25, 5.5, 5.75, 5.875, 7.0, 9.0, 11.0, 13.0, 15.0, 15.0 + 0.5, 15.5 + 0.25]

def render(t):
    im = GROUND.copy()
    bar = min(9, int(t / BAR))
    SCENES[bar](im, t - bar * BAR)
    im = camera(im, 1 + 0.07 * punch(t, BIG, 12) + 0.03 * punch(t, SMALL, 18), *shake(t, [6.0, 16.0], 16))
    return finish(im, t, DUR, fade_in=0.6)

if __name__ == '__main__':
    run(render, DUR, OUT, 'hoursleft_audio.wav', 'tsukipad-hoursleft.mp4', poster_t=6.9, poster='tsukipad-hoursleft-poster.png')
