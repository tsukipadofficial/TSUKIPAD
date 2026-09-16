"""三つの約束 / THREE PROMISES -- 1:1, ~17.1s, 140 BPM (bar = 1.714s). Bed: music11.py.

The fast one. Each promise gets a single bar, landed by a bachi slap and a
clapper: a giant index number, the English stacked left, the Japanese set
vertically on the right the way it would be on a poster in Tokyo. Bar 4 turns
the title on its head -- these are not promises, they are code -- and the
recap runs the three back one word per beat before the end card.

All three are in the app's own copy: no owner keys, fixed supply with no mint
function, and liquidity that can never be withdrawn.
"""
from motion import *

BAR = 60 / 140 * 4; BEAT = BAR / 4; NBARS = 10; DUR = BAR * NBARS
OUT = 'frames11'
GROUND = ground(W, H)

PROMISES = [
    ('01', 'NO', 'OWNER', 'オーナー権限なし', 'no admin key can change the terms', '誰も条件を変えられない'),
    ('02', 'NO', 'MINT', 'ミント機能なし', 'fixed supply, forever', '供給量は永久に固定'),
    ('03', 'LOCKED', 'FOREVER', '流動性は永久ロック', 'liquidity can never be withdrawn', '流動性は引き出せない'),
]

def progress(im, lit):
    d = ImageDraw.Draw(im)
    for i in range(3):
        x = 90 + i * 70
        d.rectangle([x, 80, x + 54, 88], fill=LIME if i < lit else LINE)
    text(im, 'TSUKIPAD', SG, 28, W - 90, 84, anchor='r')

def s_title(im, t):                                          # bar 0 -- shamisen alone
    progress(im, 0)
    rise(im, 'THREE', DELA, fit('THREE', DELA, 700, 150), 90, 470, t, stagger=0.04)
    rise(im, 'PROMISES', DELA, fit('PROMISES', DELA, 700, 116), 90, 640, t - BEAT, fill=LIME, stagger=0.035)
    vcol(im, '三つの約束', MINCHO, 136, 930, 170, t - 0.1, stagger=BEAT / 2 + 0.02)
    if t > 1.0:
        text(im, 'on every launch  ·  すべての発行に', MINCHO, 32, 90, 760, anchor='l',
             fill=mix(VOID, MUTED, out_expo((t - 1.0) / 0.4)))

def s_promise(im, t, n):                                     # bars 1-3 -- one each
    num, en1, en2, ja, cap_en, cap_ja = PROMISES[n]
    progress(im, n + 1)
    k = out_expo(t / 0.3)
    text(im, num, DELA, 420, 90 - 40 * (1 - k), 330, fill=LINEBR, outline=3, anchor='l', alpha=k)
    size2 = fit(en2, DELA, 720, 210)
    rise(im, en1, DELA, fit(en1, DELA, 720, 150), 90, 640, t - 0.05, stagger=0.03)
    rise(im, en2, DELA, size2, 90, 640 + size2 + 10, t - BEAT * 0.5, fill=LIME, stagger=0.03)
    vsize = min(104, 760 / (len(ja) * 1.04))
    ImageDraw.Draw(im).rectangle([868, 170, 870, 170 + 760 * out_expo(t / 0.5)], fill=LINE)
    vcol(im, ja, MINCHO, vsize, 960, 170, t - BEAT, stagger=0.045, dur=0.3)
    if t > BEAT * 2:
        lt = t - BEAT * 2
        text(im, cap_en, JBR, 26, 90, 930, anchor='l', fill=mix(VOID, MUTED, out_expo(lt / 0.35)))
        text(im, cap_ja, MINCHO, 30, 90, 978, anchor='l', fill=mix(VOID, MUTED, out_expo((lt - 0.1) / 0.35)))

def s_cut(im, t):                                            # bar 4 -- the clapper stops it
    d = ImageDraw.Draw(im)
    for at, (p0, p1) in ((0.0, ((-40, 820), (W + 40, 180))), (BEAT * 0.5, ((-40, 260), (W + 40, 900)))):
        lt = t - at
        if 0 <= lt < 0.7:
            k = out_expo(lt / 0.08); a = 1 - out_cubic((lt - 0.12) / 0.5)
            x1 = p0[0] + (p1[0] - p0[0]) * k; y1 = p0[1] + (p1[1] - p0[1]) * k
            d.line([p0, (x1, y1)], fill=mix(VOID, INK, a), width=4)
    if t > BEAT:
        rise(im, 'NOT A PROMISE.', DELA, fit('NOT A PROMISE.', DELA, 900, 120), W / 2, 450, t - BEAT, anchor='c', stagger=0.025)
    if t > BEAT * 2.5:
        lt = t - BEAT * 2.5
        text(im, "IT'S CODE.", DELA, fit("IT'S CODE.", DELA, 900, 220), W / 2, 610, fill=LIME,
             scale=1 + 0.3 * (1 - out_expo(lt / 0.2)))
    if t > BEAT * 3:
        rise(im, '約束ではなく、コード。', MINCHO, 58, W / 2, 820, t - BEAT * 3, anchor='c', stagger=0.02, dur=0.3)

RECAP = [('NO OWNER', DELA), ('オーナーなし', MINCHO), ('NO MINT', DELA), ('ミントなし', MINCHO),
         ('LOCKED', DELA), ('FOREVER', DELA), ('永久', MINCHO), ('ロック', MINCHO),
         ('VERIFY', DELA), ('IT', DELA), ('YOURSELF', DELA), ('自分で確認', MINCHO)]

def s_recap(im, t):                                          # bars 5-7 -- one word a beat
    slot = min(11, int(t / BEAT)); lt = t - slot * BEAT
    s, p = RECAP[slot]
    downbeat = slot % 4 == 0
    if downbeat:
        im.paste(LIME, (0, 0, W, H))
    col = VOID if downbeat else (LIME if p == MINCHO else INK)
    size = fit(s, p, 920, 330 if p == DELA else 300)
    text(im, s, p, size, W / 2, H / 2, fill=col, scale=1 + 0.28 * (1 - out_expo(lt / 0.16)))
    d = ImageDraw.Draw(im); group = slot // 4
    for i in range(3):
        c = (VOID if downbeat else LIME) if i == group else (mix(LIME, VOID, 0.5) if downbeat else LINE)
        d.rectangle([W / 2 - 110 + i * 76, H - 120, W / 2 - 110 + i * 76 + 60, H - 112], fill=c)

def s_cta(im, t):
    cta(im, t, extra='no owner  ·  no mint  ·  locked forever')

def render(t):
    im = GROUND.copy()
    bar = min(NBARS - 1, int(t / BAR)); lt = t - bar * BAR
    if bar == 0: s_title(im, lt)
    elif bar <= 3: s_promise(im, lt, bar - 1)
    elif bar == 4: s_cut(im, lt)
    elif bar <= 7: s_recap(im, t - 5 * BAR)
    else: s_cta(im, t - 8 * BAR)
    big = [BAR * b for b in (1, 2, 3, 5, 6, 7, 8)]
    small = [BAR * 5 + BEAT * k for k in range(12)] + [BAR * 4 + BEAT * 2.5]
    im = camera(im, 1 + 0.06 * punch(t, big, 14) + 0.025 * punch(t, small, 20), *shake(t, big, 12))
    return finish(im, t, DUR)

if __name__ == '__main__':
    run(render, DUR, OUT, 'promises_audio.wav', 'tsukipad-promises.mp4', poster_t=BAR * 3 + 1.2,
        poster='tsukipad-promises-poster.png')
