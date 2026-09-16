"""TSUKI 月 -- the name piece. 1:1, 16s, 120 BPM (bar = 2.0s). Bed: music10.py.

Every earlier piece argues a mechanism. This one only says what the name means,
so it is typography all the way down: a moon rising behind a horizon with the
kanji cut out of it, English words slammed on each shime hit while the Japanese
sentence assembles underneath in its own word order, and a wall of marquees
when the odaiko drops. Everything lands on something audible in the bed.

The only product line is bar 5, and it is the app's own copy.
"""
from motion import *

BAR = 2.0; BEAT = BAR / 4; DUR = BAR * 8
OUT = 'frames10'
GROUND = ground(W, H)
HORIZON = 700

def chrome(im, tag):
    logomark(im, 88, 86, 46)
    text(im, 'TSUKIPAD', SG, 30, 128, 86, anchor='l')
    text(im, tag, JBR, 22, W - 72, 86, fill=MUTED, anchor='r', track=2)

def moon_with_kanji(im, cx, cy, r, kanji_a, clip=None, ch='月', size=300):
    lay = Image.new('RGBA', (2 * r + 1, 2 * r + 1), (0, 0, 0, 0))
    d = disc_layer(r, LIME); lay.paste(d, (0, 0), d)
    if kanji_a > 0:
        place(lay, word(ch, MINCHO, size, VOID), r, r + size * 0.02, alpha=kanji_a)
    x0, y0 = round(cx - r), round(cy - r)
    if clip is not None:
        keep = int(clip - y0)
        if keep <= 0: return
        lay = lay.crop((0, 0, lay.width, min(lay.height, keep)))
    im.paste(lay, (x0, y0), lay)

# ---------------------------------------------------------------- scenes
def s_rise(im, t):                                          # bar 0 -- the moon comes up
    hw = 430 * out_expo(t / 0.6)
    ImageDraw.Draw(im).rectangle([W / 2 - hw, HORIZON, W / 2 + hw, HORIZON + 2], fill=LINEBR)
    cy = HORIZON + 250 - 420 * out_cubic((t - 0.05) / 1.35)
    moon_with_kanji(im, W / 2, cy, 230, out_cubic((t - 0.75) / 0.5), clip=HORIZON)
    if t > 1.2:
        rise(im, 'TSUKI', SG, 64, W / 2, 810, t - 1.2, anchor='c', track=18, stagger=0.05)
    if t > 1.5:
        text(im, 'つき  ·  THE MOON', MINCHO, 30, W / 2, 880, fill=mix(VOID, MUTED, out_expo((t - 1.5) / 0.4)))

SLAMS = [('EVERY', INK), ('TOKEN', INK), ('WANTS', INK), ('THE MOON', LIME)]
JA_SENTENCE = ['すべての', 'トークンは', '月を', '目指す。']

def s_slams(im, t):                                         # bar 1 -- one word per shime hit
    chrome(im, 'TSUKI / 01')
    k = min(3, int(t / BEAT)); tb = t - k * BEAT
    s, col = SLAMS[k]
    size = fit(s, DELA, 900, 250)
    sc = 1 + 0.32 * (1 - out_expo(tb / 0.22))
    text(im, s, DELA, size, W / 2, 470, fill=col, scale=sc)
    # The Japanese reads in its own order, so it assembles rather than translates word for word.
    f = font(MINCHO, 62); total = f.getlength(''.join(JA_SENTENCE)); x = W / 2 - total / 2
    for j, chunk in enumerate(JA_SENTENCE):
        lt = t - j * BEAT
        if lt > 0:
            rise(im, chunk, MINCHO, 62, x, 820, lt, fill=(LIME if j == 2 else INK), stagger=0.03, dur=0.35)
        x += f.getlength(chunk)
    for i in range(4):
        c = LIME if i <= k else LINE
        ImageDraw.Draw(im).rectangle([W / 2 - 86 + i * 46, 930, W / 2 - 86 + i * 46 + 34, 936], fill=c)

def s_build(im, t):                                         # bar 2 -- the roll tightens
    if t >= 1.875:                                          # the clapper: everything stops
        ImageDraw.Draw(im).rectangle([0, H / 2 - 1, W, H / 2 + 1], fill=INK)
        return
    d = ImageDraw.Draw(im); n = 24 + int(t * 44)
    for i in range(n):
        ang = i * 2.39996; spd = 0.6 + (i % 5) * 0.25
        r0 = 180 + ((t * spd * (1 + t) + i * 0.137) % 1.0) * 640
        ln = 30 + 90 * t
        c = mix(LINE, LINEBR, (i % 3) / 2)
        d.line([(W / 2 + math.cos(ang) * r0, H / 2 + math.sin(ang) * r0),
                (W / 2 + math.cos(ang) * (r0 + ln), H / 2 + math.sin(ang) * (r0 + ln))], fill=c, width=3)
    j = (t / 1.875) ** 3 * 9
    rise(im, 'TO THE MOON', SG, 54, W / 2, 230, t, anchor='c', track=14, stagger=0.03)
    sc = 0.86 + 0.22 * out_cubic(t / 1.875)
    text(im, '月へ', MINCHO, 400, W / 2 + math.sin(t * 83) * j, 540 + math.cos(t * 67) * j, fill=LIME, scale=sc)
    if t > 0.6:
        text(im, 'つきへ', MINCHO, 40, W / 2, 860, fill=mix(VOID, MUTED, out_expo((t - 0.6) / 0.4)), track=10)

ROWS = [('TSUKIPAD  ', DELA, 150, INK, 0, 520),
        ('月  TSUKI  ', MINCHO, 150, LIME, 3, -360),
        ('トークン発行  ', DELA, 128, INK, 0, 610),
        ('TO THE MOON  ', DELA, 128, INK, 3, -440),
        ('月へ  ', MINCHO, 150, LIME, 0, 380),
        ('TSUKIPAD  ', DELA, 150, LINEBR, 3, -540)]

def s_drop(im, t):                                          # bar 3 -- odaiko
    if t < 0.1:
        im.paste(LIME, (0, 0, W, H))
        text(im, 'TSUKIPAD', DELA, fit('TSUKIPAD', DELA, 980, 300), W / 2, H / 2, fill=VOID)
        return
    for i, (s, p, sz, col, ol, spd) in enumerate(ROWS):
        # every row gets shoved forward on the big hits, then glides
        push = 90 * sum(out_expo((t - h) / 0.3) for h in (0.0, 1.0, 1.25, 1.5))
        marquee(im, s, p, sz, 90 + i * 180, (spd * t + push * (1 if spd > 0 else -1)) + i * 211, fill=col, outline=ol * 2, gap=70)
    ImageDraw.Draw(im).rectangle([W / 2 - 190, H / 2 - 190, W / 2 + 190, H / 2 + 190], fill=VOID)
    hanko(im, W / 2, H / 2, 300, '月', t - 0.02)

def s_equation(im, t):                                      # bar 4 -- three spellings of one word
    chrome(im, 'TSUKI / 02')
    d = ImageDraw.Draw(im)
    text(im, 'ROMAJI', JBR, 22, 110, 232, fill=MUTED, anchor='l', track=3)
    rise(im, 'TSUKI', DELA, 170, 104, 430, t, fill=INK, stagger=0.05)
    if t > 1.0:
        tk = t - 1.0
        text(im, 'KANJI', JBR, 22, W - 110, 420, fill=MUTED, anchor='r', track=3)
        text(im, 'つき', MINCHO, 44, 890, 490, fill=mix(VOID, MUTED, out_expo(tk / 0.4)), track=18)
        text(im, '月', MINCHO, 300, 890, 690, fill=LIME, scale=1 + 0.35 * (1 - out_expo(tk / 0.25)))
    if t > 1.5:
        text(im, 'ENGLISH', JBR, 22, 110, 690, fill=MUTED, anchor='l', track=3)
        rise(im, 'MOON', DELA, 150, 104, 900, t - 1.5, fill=INK, outline=4, stagger=0.04)
    hw = 300 * out_expo((t - 0.3) / 0.6)
    d.rectangle([110, 520, 110 + hw, 522], fill=LINE)

def s_launch(im, t):                                        # bar 5 -- the product, in its own words
    chrome(im, 'TSUKI / 03')
    d = ImageDraw.Draw(im)
    for i, (s, col) in enumerate([('LAUNCH', INK), ('A TOKEN', INK), ('ON ARC.', LIME)]):
        if t > i * BEAT:
            rise(im, s, DELA, 128, 96, 390 + i * 170, t - i * BEAT, fill=col, stagger=0.035)
    lh = 720 * out_expo((t - 0.1) / 0.9)
    d.rectangle([790, 190, 792, 190 + lh], fill=LINE)
    vcol(im, 'トークンを発行', MINCHO, 92, 905, 200, t - 0.25, fill=INK, stagger=0.11)
    if t > 1.3:
        text(im, 'fixed supply  ·  no mint  ·  no owner keys', JBR, 26, 96, 960,
             fill=mix(VOID, MUTED, out_expo((t - 1.3) / 0.5)), anchor='l')

def s_zero(im, t):                                          # bar 6 -- nought becomes moon
    if t < 0.95:
        rise(im, 'FROM ZERO', SG, 56, W / 2, 190, t, anchor='c', track=14, stagger=0.03, out=(t - 0.75) if t > 0.75 else None)
    else:
        rise(im, 'TO THE MOON', SG, 56, W / 2, 190, t - 0.95, anchor='c', track=14, stagger=0.03)
    zero_a = 1 - out_cubic((t - 0.85) / 0.25)
    if zero_a > 0:
        text(im, '0', DELA, 620, W / 2, 530, fill=INK, outline=6, alpha=zero_a,
             scale=1 + 0.08 * out_expo(t / 0.4) - 0.2 * in_cubic((t - 0.7) / 0.35))
    if t > 0.95:
        k = out_back((t - 0.95) / 0.35, 1.6)
        r = int(max(1, 250 * k))
        moon_with_kanji(im, W / 2, 530 - 40 * out_cubic((t - 1.0) / 1.0), r, out_cubic((t - 1.2) / 0.3), size=int(330 * min(1, k)))
    if t > 1.25:
        rise(im, 'ゼロから、月へ。', MINCHO, 64, W / 2, 900, t - 1.25, anchor='c', stagger=0.04)

def s_cta(im, t):                                           # bar 7
    cta(im, t)

SCENES = [s_rise, s_slams, s_build, s_drop, s_equation, s_launch, s_zero, s_cta]
BIG = [6.0, 8.0, 10.0, 12.0, 14.0]
SMALL = [2.0, 2.5, 3.0, 3.5, 7.0, 7.25, 7.5, 9.0, 11.0, 13.0]

def render(t):
    im = GROUND.copy()
    bar = min(7, int(t / BAR))
    SCENES[bar](im, t - bar * BAR)
    zoom = 1 + 0.07 * punch(t, BIG, 12) + 0.03 * punch(t, SMALL, 18)
    dx, dy = shake(t, BIG[:1] + [7.0, 7.5], 16)
    im = camera(im, zoom, dx, dy)
    return finish(im, t, DUR)

if __name__ == '__main__':
    run(render, DUR, OUT, 'tsuki_audio.wav', 'tsukipad-tsuki.mp4', poster_t=8.9, poster='tsukipad-tsuki-poster.png')
