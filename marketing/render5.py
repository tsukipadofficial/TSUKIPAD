"""TSUKIPAD referral offer -- 1:1 square, 16s, 120 BPM (bar = 2.0s).

The centrepiece is the split bar. Most referral programs quietly tax the person
being referred; this one does not, and showing the dev's half never moving is
the whole argument, so it gets the payoff bar to itself.
"""
import os
from PIL import Image, ImageDraw
from kit import *

W = H = 1080
FPS, BAR = 30, 2.0
DUR = BAR * 8
NFRAMES = int(DUR * FPS)
OUT = 'frames5'
GROUND = ground(W, H)

def chrome(im, d):
    logomark(im, 96, 92, 54)
    d.text((142, 72), 'TSUKIPAD', font=sg(34), fill=INK)

def split_bar(d, y, reveal, show_ref):
    """50 / 10 / 40, drawn to scale. The dev's half is the point."""
    x0, x1, h = 90, W - 90, 74
    span = x1 - x0
    dev = int(span * 0.50)
    ref = int(span * 0.10 * clamp(reveal))
    plat = span - dev - ref

    d.rectangle([x0, y, x0 + dev, y + h], fill=SURF2, outline=LINEBR, width=3)
    ctext(d, x0 + dev / 2, y + h / 2, 'DEV 50%', jb(30), fill=INK, mid=True)

    if show_ref and ref > 6:
        d.rectangle([x0 + dev, y, x0 + dev + ref, y + h], fill=LIME, outline=VOID, width=3)
        if ref > 62:
            ctext(d, x0 + dev + ref / 2, y + h / 2, '10%', jb(26), fill=VOID, mid=True)

    d.rectangle([x0 + dev + ref, y, x1, y + h], fill=SURFACE, outline=LINE, width=3)
    ctext(d, x0 + dev + ref + plat / 2, y + h / 2,
          f'PLATFORM {40 if show_ref else 50}%', jb(26), fill=MUTED, mid=True)

def s_hook(im, d, t):                                   # bar 0
    logomark(im, W/2, H/2 - 190, 190, draw_frac=clamp(t / 0.7))
    if t > 0.45:
        k = out_back((t - 0.45) / 0.5)
        ctext(d, W/2, H/2 + 30, 'BRING PEOPLE IN.', sg(int(78 * (0.9 + 0.1 * k))), fill=INK, mid=True)
        ctext(d, W/2, H/2 + 120, 'GET PAID FOREVER.', sg(int(78 * (0.9 + 0.1 * k))), fill=LIME, mid=True)
    if t > 1.1:
        ctext(d, W/2, H/2 + 240, 'THE TSUKIPAD REFERRAL PROGRAM', jbr(28),
              fill=mix(VOID, MUTED, out_expo((t - 1.1) / 0.6)), mid=True)

def s_link(im, d, t):                                   # bars 1-2
    chrome(im, d)
    a = out_expo(t / 0.35); dx = int((1 - a) * -60)
    d.text((90 + dx, 300), 'STEP 01', font=jb(38), fill=CYAN)
    d.text((90 + dx, 360), 'SHARE YOUR LINK.', font=sg(int(88 * (0.9 + 0.1 * out_back(clamp(t / 0.5))))), fill=INK)

    if t > 0.5:
        k = out_back(clamp((t - 0.5) / 0.55))
        bw, bh = W - 180, 96
        brut(d, [90, 520, 90 + bw, 520 + bh], fill=VOID, border=CYAN, off=int(9 * k))
        ctext(d, 90 + bw / 2, 520 + bh / 2, 'tsukipad.com/?ref=you', jb(34), fill=CYAN, mid=True)

    if t > 1.2:
        aa = out_expo((t - 1.2) / 0.6)
        for i, line in enumerate([
            'They sign in through it. You are recorded',
            'on their account — not their browser, so it',
            'survives phones, laptops and months.',
        ]):
            d.text((90, 680 + i * 42), line, font=jbr(30), fill=mix(VOID, MUTED, aa))

    if t > 3.0:
        ctext(d, W/2, 900, 'STEP 02 — THEY LAUNCH A TOKEN', jb(32),
              fill=mix(VOID, LIME, out_expo((t - 3.0) / 0.5)), mid=True)

def s_split(im, d, t):                                  # bars 3-4, the payoff
    chrome(im, d)
    ctext(d, W/2, 280, 'EVERY SWAP FEE THAT TOKEN EARNS', jbr(30), fill=MUTED, mid=True)

    # Before: an ordinary launch. After the drop: the referred split.
    show_ref = t >= BAR
    reveal = out_cubic((t - BAR) / 0.7) if show_ref else 0.0
    split_bar(d, 380, reveal, show_ref)

    if not show_ref:
        ctext(d, W/2, 520, 'WITHOUT A REFERRAL', jbr(28), fill=FAINT, mid=True)
    else:
        k = out_back(clamp((t - BAR) / 0.5))
        ctext(d, W/2, 540, 'YOU TAKE 10%', sg(int(96 * (0.85 + 0.15 * k))), fill=LIME, mid=True)
        if t > BAR + 0.5:
            a = out_expo((t - BAR - 0.5) / 0.6)
            ctext(d, W/2, 660, 'out of our share, not theirs', jbr(30),
                  fill=mix(VOID, MUTED, a), mid=True)
        if t > BAR + 0.8:
            a = out_expo((t - BAR - 0.8) / 0.5)
            bw, bh = 700, 84
            brut(d, [W/2 - bw/2, 740, W/2 + bw/2, 740 + bh], fill=VOID, border=PINK, off=8)
            ctext(d, W/2, 740 + bh/2, 'THE DEV KEEPS 50% EITHER WAY', jb(32),
                  fill=mix(VOID, PINK, a), mid=True)

def s_forever(im, d, t):                                # bar 5
    chrome(im, d)
    k = out_back(clamp(t / 0.45))
    ctext(d, W/2, 340, 'PAID IN', jbr(32), fill=MUTED, mid=True)
    ctext(d, W/2, 460, 'USDC', sg(int(150 * (0.85 + 0.15 * k))), fill=LIME, mid=True)
    if t > 0.5:
        a = out_expo((t - 0.5) / 0.5)
        ctext(d, W/2, 620, 'straight to your wallet', jbr(32), fill=mix(VOID, INK, a), mid=True)
    if t > 0.95:
        a = out_expo((t - 0.95) / 0.5)
        ctext(d, W/2, 730, 'never in the token, never a bag to dump', jbr(27),
              fill=mix(VOID, FAINT, a), mid=True)

def s_locked(im, d, t):                                 # bar 6
    chrome(im, d)
    ctext(d, W/2, 320, 'AND IT CANNOT BE TAKEN BACK', jbr(30), fill=MUTED, mid=True)
    rows = [
        ('FIXED AT LAUNCH', 'the rate is written onto that token'),
        ('FOR AS LONG AS IT TRADES', 'no expiry, no cap, no claim window'),
    ]
    for i, (head, body) in enumerate(rows):
        st = t - i * 0.4
        if st < 0: continue
        a = out_back(clamp(st / 0.5))
        dy = int((1 - out_expo(st / 0.45)) * 50)
        y = 420 + i * 190 + dy
        brut(d, [90, y, W - 90, y + 150], fill=SURFACE, border=LIME, off=int(8 * a))
        d.text((130, y + 34), head, font=sg(44), fill=LIME)
        d.text((130, y + 92), body, font=jbr(27), fill=MUTED)

def s_cta(im, d, t):                                    # bar 7
    logomark(im, W/2, H/2 - 250, 140)
    f = sg(86)
    tot = d.textlength('TSUKI', font=f) + d.textlength('PAD', font=f)
    x = W/2 - tot/2 - 30
    d.text((x, H/2 - 130), 'TSUKI', font=f, fill=INK)
    d.text((x + d.textlength('TSUKI', font=f), H/2 - 130), 'PAD', font=f, fill=LIME)
    d.text((x + tot + 20, H/2 - 118), '月', font=JP(56), fill=LIMEDIM)
    if t > 0.2:
        ctext(d, W/2, H/2 + 10, 'tsukipad.com', sg(70), fill=INK, mid=True)
        ctext(d, W/2, H/2 + 88, '/referrals', sg(54), fill=LIME, mid=True)
    if t > 0.45:
        ctext(d, W/2, H/2 + 188, '@tsukipad_', jb(38), fill=LIME, mid=True)
    if t > 0.65:
        ctext(d, W/2, H - 150, 'BUILT ON ARC NETWORK', jbr(26), fill=MUTED, mid=True)
        ctext(d, W/2, H - 104, TRADEMARK[0], jbr(19), fill=(78, 78, 90), mid=True)
        ctext(d, W/2, H - 76, TRADEMARK[1], jbr(19), fill=(78, 78, 90), mid=True)

SCENES = [(0, s_hook), (1, s_link), (3, s_split), (5, s_forever), (6, s_locked), (7, s_cta)]

def render(t):
    im = GROUND.copy(); d = ImageDraw.Draw(im)
    bar = int(t / BAR); start, fn = SCENES[0]
    for sb, f in SCENES:
        if bar >= sb: start, fn = sb, f
    fn(im, d, t - start * BAR)
    dt = t - 4 * BAR                                    # flash on the split reveal
    if 0 <= dt < 0.10:
        im = Image.blend(im, Image.new('RGB', (W, H), LIME), 0.32 * (1 - dt / 0.10))
    if t < 0.35:      im = Image.blend(Image.new('RGB', (W, H), VOID), im, out_cubic(t / 0.35))
    if t > DUR - 0.4: im = Image.blend(im, Image.new('RGB', (W, H), VOID), out_cubic((t - (DUR - 0.4)) / 0.4))
    return im

os.makedirs(OUT, exist_ok=True)
for i in range(NFRAMES):
    render(i / FPS).save(f'{OUT}/f{i:04d}.png')
    if i % 120 == 0: print(f'  {i}/{NFRAMES}')
print('frames done:', NFRAMES)
