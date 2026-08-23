"""TSUKIPAD traders piece -- 1:1 square, 16s, 120 BPM (bar = 2.0s).

Aimed at traders rather than launchers. The pitch is that the pad already knows
who is winning, because positions are rebuilt from the pools themselves -- so
you are ranked whether or not you ever filled in a profile.

Numbers in the mocked interface are illustrative and the frames say so. The
product claim here is the mechanism, not anybody's returns.
"""
import os, colorsys
from PIL import Image, ImageDraw
from kit import *

W = H = 1080
FPS, BAR = 30, 2.0
DUR = BAR * 8
NFRAMES = int(DUR * FPS)
OUT = 'frames7'
GROUND = ground(W, H)

def chrome(im, d):
    logomark(im, 96, 92, 54)
    d.text((142, 72), 'TSUKIPAD', font=sg(34), fill=INK)

def preview_note(d):
    """Mocked data must never read as a record of what somebody earned."""
    ctext(d, W/2, H - 62, 'interface preview · testnet', jbr(21), fill=(70, 70, 82), mid=True)

def hue_of(seed):
    h = 0
    for ch in seed.lower():
        h = (h * 31 + ord(ch)) & 0xFFFFFFFF
    return (h % 360) / 360.0

def avatar(d, x, y, s, seed, k=1.0):
    """The generated mark from components/Avatar.tsx: hue from the name."""
    hu = hue_of(seed)
    bg = tuple(int(c * 255) for c in colorsys.hls_to_rgb(hu, 0.17, 0.55))
    fg = tuple(int(c * 255) for c in colorsys.hls_to_rgb(hu, 0.72, 0.85))
    d.rectangle([x, y, x + s, y + s], fill=mix(VOID, bg, k), outline=mix(VOID, LINE, k), width=2)
    ctext(d, x + s/2, y + s/2, seed[0].upper(), sg(int(s * 0.46)), fill=mix(VOID, fg, k), mid=True)

ROWS = [
    ('Lunar Otter',   'lunarotter84',   '+$412', LIME),
    ('Copper Manta',  'coppermanta19',  '+$286', LIME),
    ('Golden Bison',  'goldenbison07',  '+$173', LIME),
    ('Silent Lynx',   'silentlynx55',   '+$64',  LIME),
    ('Azure Kestrel', 'azurekestrel31', '-$38',  PINK),
]
MEDAL = [AMBER, INK, (200, 139, 74)]

def lb_row(d, x, y, w, i, name, handle, val, col, k=1.0):
    if k <= 0: return
    h = 96
    d.rectangle([x, y, x + w, y + h], fill=mix(VOID, SURFACE, k), outline=mix(VOID, LINE, k), width=2)
    rank = MEDAL[i] if i < 3 else FAINT
    ctext(d, x + 40, y + h/2, str(i + 1), jb(26), fill=mix(VOID, rank, k), mid=True)
    avatar(d, x + 62, y + 20, 56, name, k)
    d.text((x + 138, y + 22), name, font=sg(30), fill=mix(VOID, INK, k))
    d.text((x + 138, y + 58), '@' + handle, font=jbr(21), fill=mix(VOID, FAINT, k))
    tw = tsize(d, val, jb(30))[0]
    d.text((x + w - 34 - tw, y + 34), val, font=jb(30), fill=mix(VOID, col, k))

# ---------------------------------------------------------------- scenes
def s_hook(im, d, t):                                   # bar 0
    logomark(im, W/2, H/2 - 210, 170, draw_frac=clamp(t / 0.7))
    if t > 0.4:
        k = out_back((t - 0.4) / 0.5)
        f = sg(int(96 * (0.88 + 0.12 * k)))
        ctext(d, W/2, H/2 + 30, 'WHO ACTUALLY', f, fill=INK, mid=True)
        ctext(d, W/2, H/2 + 140, 'MADE MONEY?', f, fill=LIME, mid=True)
    if t > 1.1:
        ctext(d, W/2, H/2 + 280, 'every pad shows you a chart', jbr(30),
              fill=mix(VOID, MUTED, out_expo((t - 1.1) / 0.6)), mid=True)

def s_problem(im, d, t):                                # bar 1
    chrome(im, d)
    ctext(d, W/2, 330, 'A CHART TELLS YOU', jbr(30), fill=MUTED, mid=True)
    ctext(d, W/2, 420, 'WHAT HAPPENED.', sg(78), fill=MUTED, mid=True)
    if t > 0.55:
        k = out_expo((t - 0.55) / 0.55)
        ctext(d, W/2, 590, 'IT NEVER TELLS YOU', jbr(30), fill=mix(VOID, MUTED, k), mid=True)
        ctext(d, W/2, 680, 'WHO WAS RIGHT.', sg(78), fill=mix(VOID, INK, k), mid=True)

def s_build(im, d, t):                                  # bar 2 -- rows arrive
    chrome(im, d)
    ctext(d, W/2, 210, 'TOP PNL', jb(28), fill=LIME, mid=True)
    for i, (name, handle, val, col) in enumerate(ROWS):
        k = out_cubic(clamp((t - i * 0.19) / 0.42))
        if k <= 0: continue
        lb_row(d, 90, 290 + i * 112 + int(26 * (1 - k)), 900, i, name, handle, val, col, k)
    preview_note(d)

def s_board(im, d, t):                                  # bar 3 -- PAYOFF
    chrome(im, d)
    ctext(d, W/2, 210, 'TOP PNL', jb(28), fill=LIME, mid=True)
    for i, (name, handle, val, col) in enumerate(ROWS):
        lb_row(d, 90, 290 + i * 112, 900, i, name, handle, val, col)
    if t > 0.5:
        k = out_expo((t - 0.5) / 0.6)
        ctext(d, W/2, 900, 'rebuilt from on-chain swaps', jbr(28), fill=mix(VOID, MUTED, k), mid=True)
        ctext(d, W/2, 946, 'you are ranked whether you signed up or not', jbr(26),
              fill=mix(VOID, FAINT, k), mid=True)
    preview_note(d)

def s_name(im, d, t):                                   # bar 4 -- auto naming
    chrome(im, d)
    ctext(d, W/2, 300, 'SIGN IN AND YOU GET', jbr(30), fill=MUTED, mid=True)
    k = out_back(clamp(t / 0.5))
    ctext(d, W/2, 400, 'A NAME.', sg(int(92 * (0.88 + 0.12 * k))), fill=INK, mid=True)
    if t > 0.55:
        a = out_cubic((t - 0.55) / 0.4)
        avatar(d, W/2 - 46, 540, 92, 'Lunar Otter', a)
        ctext(d, W/2, 680, 'Lunar Otter', sg(46), fill=mix(VOID, INK, a), mid=True)
        ctext(d, W/2, 736, '@lunarotter84', jbr(26), fill=mix(VOID, FAINT, a), mid=True)
    if t > 1.15:
        a = out_expo((t - 1.15) / 0.5)
        ctext(d, W/2, 856, 'change it to anything not already taken', jbr(28),
              fill=mix(VOID, MUTED, a), mid=True)

def s_profile(im, d, t):                                # bar 5 -- the book
    chrome(im, d)
    brut(d, (90, 250, 990, 690), fill=SURFACE, border=LINE, bw=2, off=8)
    avatar(d, 130, 292, 92, 'Lunar Otter')
    d.text((250, 300), 'Lunar Otter', font=sg(44), fill=INK)
    d.text((250, 356), '@lunarotter84', font=jbr(26), fill=FAINT)

    val = 412 * out_expo(clamp(t / 0.85))               # counts up on entry
    ctext(d, 300, 470, f'+${val:,.0f}', jb(76), fill=LIME, mid=True)
    ctext(d, 300, 534, 'NET PNL', jbr(22), fill=MUTED, mid=True)

    cols = [('REALISED', '+$281'), ('UNREALISED', '+$131'), ('FEES EARNED', '$18')]
    for i, (lab, v) in enumerate(cols):
        if t < 0.5 + i * 0.14: continue
        a = out_cubic((t - 0.5 - i * 0.14) / 0.35)
        d.text((150 + i * 290, 600), lab, font=jbr(20), fill=mix(VOID, MUTED, a))
        d.text((150 + i * 290, 630), v, font=jb(30), fill=mix(VOID, LIME if i < 2 else INK, a))
    if t > 1.25:
        a = out_expo((t - 1.25) / 0.5)
        ctext(d, W/2, 780, 'every position, entry shown as market cap', jbr(28),
              fill=mix(VOID, MUTED, a), mid=True)
    preview_note(d)

def s_earners(im, d, t):                                # bar 6 -- fees board
    chrome(im, d)
    ctext(d, W/2, 250, 'TOP EARNERS', jb(28), fill=LIME, mid=True)
    ctext(d, W/2, 330, 'A SECOND BOARD', sg(62), fill=INK, mid=True)
    if t > 0.4:
        a = out_expo((t - 0.4) / 0.5)
        ctext(d, W/2, 424, 'for the fees the pad paid out', jbr(28), fill=mix(VOID, MUTED, a), mid=True)
    items = [('creator shares', LIME), ('referral shares', CYAN), ('claimed earmarks', PINK)]
    for i, (lab, col) in enumerate(items):
        st = t - 0.75 - i * 0.22
        if st <= 0: continue
        a = out_cubic(st / 0.4)
        y = 540 + i * 96
        d.rectangle([200, y, 210, y + 62], fill=mix(VOID, col, a))
        d.text((246, y + 12), lab, font=sg(38), fill=mix(VOID, INK, a))

def s_cta(im, d, t):                                    # bar 7
    logomark(im, W/2, H/2 - 190, 128, draw_frac=clamp(t / 0.5))
    if t > 0.2:
        ctext(d, W/2, H/2 + 20, 'tsukipad.com', sg(74), fill=INK, mid=True)
    if t > 0.45:
        ctext(d, W/2, H/2 + 130, '@tsukipad_', jb(38), fill=LIME, mid=True)
    if t > 0.65:
        ctext(d, W/2, H - 150, 'BUILT ON ARC NETWORK', jbr(26), fill=MUTED, mid=True)
        ctext(d, W/2, H - 104, TRADEMARK[0], jbr(19), fill=(78, 78, 90), mid=True)
        ctext(d, W/2, H - 76, TRADEMARK[1], jbr(19), fill=(78, 78, 90), mid=True)

SCENES = [(0, s_hook), (1, s_problem), (2, s_build), (3, s_board),
          (4, s_name), (5, s_profile), (6, s_earners), (7, s_cta)]
PAYOFF = 3

def render(t):
    im = GROUND.copy(); d = ImageDraw.Draw(im)
    bar = int(t / BAR); start, fn = SCENES[0]
    for sb, f in SCENES:
        if bar >= sb: start, fn = sb, f
    fn(im, d, t - start * BAR)
    dt = t - PAYOFF * BAR
    if 0 <= dt < 0.11:
        im = Image.blend(im, Image.new('RGB', (W, H), LIME), 0.34 * (1 - dt / 0.11))
    if t < 0.35:      im = Image.blend(Image.new('RGB', (W, H), VOID), im, out_cubic(t / 0.35))
    if t > DUR - 0.4: im = Image.blend(im, Image.new('RGB', (W, H), VOID), out_cubic((t - (DUR - 0.4)) / 0.4))
    return im

os.makedirs(OUT, exist_ok=True)
for i in range(NFRAMES):
    render(i / FPS).save(f'{OUT}/f{i:04d}.png')
    if i % 120 == 0: print(f'  {i}/{NFRAMES}')
print('frames done:', NFRAMES)
