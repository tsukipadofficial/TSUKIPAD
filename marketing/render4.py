"""TSUKIPAD waitlist CTA -- 1:1 square, 16s, 120 BPM (bar = 2.0s).

Square for feed real estate. The clearance meter runs across the whole piece,
filling 0 -> 50 -> 100 exactly as it does on the real page, so the video
teaches the mechanic rather than describing it.
"""
import os
from PIL import Image, ImageDraw
from kit import *

W = H = 1080
FPS, BAR = 30, 2.0
DUR = BAR * 8
NFRAMES = int(DUR * FPS)
OUT = 'frames4'
GROUND = ground(W, H)

def meter(im, d, pct, y=250):
    """The same bar the page shows, and the spine of the edit."""
    x0, x1, h = 90, W - 90, 22
    d.rectangle([x0, y, x1, y + h], fill=VOID, outline=LINE, width=3)
    w = int((x1 - x0 - 6) * clamp(pct / 100))
    if w > 0:
        d.rectangle([x0 + 3, y + 3, x0 + 3 + w, y + h - 3],
                    fill=LIME if pct >= 100 else CYAN)
    d.text((x0, y - 46), 'YOUR CLEARANCE', font=jbr(26), fill=FAINT)
    lbl = f'{int(round(pct))}%'
    f = jb(46)
    tw = d.textlength(lbl, font=f)
    d.text((x1 - tw, y - 52), lbl, font=f, fill=LIME if pct >= 100 else INK)

def chrome(im, d):
    logomark(im, 96, 92, 54)
    d.text((142, 72), 'TSUKIPAD', font=sg(34), fill=INK)

def s_open(im, d, t):                                   # bar 0
    logomark(im, W/2, H/2 - 150, 210, draw_frac=clamp(t / 0.8))
    if t > 0.5:
        k = out_back((t - 0.5) / 0.5)
        ctext(d, W/2, H/2 + 60, 'THE BOARD', sg(int(104*(0.88+0.12*k))), fill=INK, mid=True)
        ctext(d, W/2, H/2 + 160, 'IS OPEN.', sg(int(104*(0.88+0.12*k))), fill=LIME, mid=True)
    if t > 1.1:
        ctext(d, W/2, H/2 + 270, 'BEFORE ARC MAINNET, 09.16.26', jbr(28),
              fill=mix(VOID, MUTED, out_expo((t - 1.1) / 0.6)), mid=True)

def step(im, d, t, num, title, body, col, pct):
    chrome(im, d)
    meter(im, d, pct)
    a = out_expo(t / 0.35); dx = int((1 - a) * -60)
    d.text((90 + dx, 380), f'STEP {num}', font=jb(38), fill=col)
    k = out_back(clamp(t / 0.5))
    d.text((90 + dx, 440), title, font=sg(int(96 * (0.9 + 0.1 * k))), fill=INK)
    if t > 0.45:
        aa = out_expo((t - 0.45) / 0.5)
        for i, line in enumerate(body):
            d.text((90, 580 + i * 44), line, font=jbr(30), fill=mix(VOID, MUTED, aa))

def s_handle(im, d, t):                                 # bars 1-2
    step(im, d, t, '01', 'CLAIM YOUR HANDLE.',
         ['Your X handle holds your place.', 'Ranked by who was actually first.'],
         CYAN, 50 * out_cubic(t / 1.6))
    if t > 1.9:
        a = out_expo((t - 1.9) / 0.6)
        bw, bh = 420, 84
        brut(d, [90, 760, 90 + bw, 760 + bh], fill=SURFACE, border=CYAN, off=8)
        ctext(d, 90 + bw/2, 760 + bh/2, '@yourhandle', jb(38),
              fill=mix(VOID, INK, a), mid=True)

def s_sign(im, d, t):                                   # bars 3-4
    step(im, d, t, '02', 'SIGN YOUR WALLET.',
         ['One message. No transaction, no gas.', 'Proves the wallet is really yours.'],
         LIME, 50 + 50 * out_cubic(max(0.0, t - 0.6) / 1.5))
    if t > 1.9:
        a = out_expo((t - 1.9) / 0.6)
        bw, bh = 520, 84
        brut(d, [90, 760, 90 + bw, 760 + bh], fill=SURF2, border=LIME, off=8)
        ctext(d, 90 + bw/2, 760 + bh/2, 'SIGNATURE VERIFIED', jb(34),
              fill=mix(VOID, LIME, a), mid=True)

def s_reward(im, d, t):                                 # bar 5 -- the payoff
    chrome(im, d)
    meter(im, d, 100)
    k = out_back(clamp(t / 0.45))
    ctext(d, W/2, 430, 'AT 100%', jbr(30), fill=MUTED, mid=True)
    ctext(d, W/2, 530, 'DAY-ONE', sg(int(112 * (0.85 + 0.15 * k))), fill=LIME, mid=True)
    ctext(d, W/2, 640, 'ALLOWLIST', sg(int(112 * (0.85 + 0.15 * k))), fill=LIME, mid=True)
    # No airdrop is promised here: there is no launchpad token on day one, and
    # a reward you cannot deliver is worse than a smaller one you can.
    if t > 0.55:
        a = out_expo((t - 0.55) / 0.5)
        bw, bh = 700, 92
        brut(d, [W/2 - bw/2, 740, W/2 + bw/2, 740 + bh], fill=VOID, border=PINK, off=8)
        ctext(d, W/2, 740 + bh/2, 'LAUNCH BEFORE THE PUBLIC', jb(36),
              fill=mix(VOID, PINK, a), mid=True)
    if t > 1.1:
        ctext(d, W/2, 890, 'whatever comes later starts with this list', jbr(26),
              fill=mix(VOID, FAINT, out_expo((t - 1.1) / 0.5)), mid=True)

BOARD = [('JohnnOnchain', 100), ('Alphagam', 100), ('hojansh', 100), ('you', None)]
def s_board(im, d, t):                                  # bar 6
    chrome(im, d)
    ctext(d, W/2, 300, 'RANKED BY WHO WAS ACTUALLY FIRST', jbr(28), fill=MUTED, mid=True)
    for i, (name, pct) in enumerate(BOARD):
        st = t - i * 0.22
        if st < 0: continue
        a = out_back(clamp(st / 0.5))
        dy = int((1 - out_expo(st / 0.45)) * 50)
        y = 390 + i * 108 + dy
        mine = pct is None
        brut(d, [90, y, W - 90, y + 88], fill=SURF2 if mine else SURFACE,
             border=LIME if mine else LINE, off=int(7 * a))
        d.text((126, y + 28), str(i + 1), font=jbr(30), fill=FAINT)
        d.text((210, y + 22), f'@{name}', font=jb(38), fill=LIME if mine else INK)
        lbl = 'YOUR PLACE' if mine else f'{pct}%'
        f = jb(32)
        d.text((W - 126 - d.textlength(lbl, font=f), y + 28), lbl, font=f,
               fill=LIME if mine else MUTED)

def s_cta(im, d, t):                                    # bar 7
    logomark(im, W/2, H/2 - 250, 140)
    f = sg(88)
    tot = d.textlength('TSUKI', font=f) + d.textlength('PAD', font=f)
    x = W/2 - tot/2 - 30
    d.text((x, H/2 - 130), 'TSUKI', font=f, fill=INK)
    d.text((x + d.textlength('TSUKI', font=f), H/2 - 130), 'PAD', font=f, fill=LIME)
    d.text((x + tot + 20, H/2 - 118), '月', font=JP(56), fill=LIMEDIM)
    if t > 0.2:
        ctext(d, W/2, H/2 + 10, 'tsukipad.com', sg(72), fill=INK, mid=True)
        ctext(d, W/2, H/2 + 90, '/waitlist', sg(56), fill=LIME, mid=True)
    if t > 0.45:
        ctext(d, W/2, H/2 + 190, '@tsukipad_', jb(38), fill=LIME, mid=True)
    if t > 0.65:
        ctext(d, W/2, H - 150, 'BUILT ON ARC NETWORK', jbr(26), fill=MUTED, mid=True)
        ctext(d, W/2, H - 104, TRADEMARK[0], jbr(19), fill=(78, 78, 90), mid=True)
        ctext(d, W/2, H - 76, TRADEMARK[1], jbr(19), fill=(78, 78, 90), mid=True)

SCENES = [(0, s_open), (1, s_handle), (3, s_sign), (5, s_reward), (6, s_board), (7, s_cta)]

def render(t):
    im = GROUND.copy(); d = ImageDraw.Draw(im)
    bar = int(t / BAR); start, fn = SCENES[0]
    for sb, f in SCENES:
        if bar >= sb: start, fn = sb, f
    fn(im, d, t - start * BAR)
    dt = t - 5 * BAR                                    # flash on the payoff
    if 0 <= dt < 0.10:
        im = Image.blend(im, Image.new('RGB', (W, H), LIME), 0.34 * (1 - dt / 0.10))
    if t < 0.35:      im = Image.blend(Image.new('RGB', (W, H), VOID), im, out_cubic(t / 0.35))
    if t > DUR - 0.4: im = Image.blend(im, Image.new('RGB', (W, H), VOID), out_cubic((t - (DUR - 0.4)) / 0.4))
    return im

os.makedirs(OUT, exist_ok=True)
for i in range(NFRAMES):
    render(i / FPS).save(f'{OUT}/f{i:04d}.png')
    if i % 90 == 0: print(f'  {i}/{NFRAMES}')
print('frames done:', NFRAMES)
