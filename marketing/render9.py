"""TSUKIPAD no-owner piece -- 1:1 square, 16s, 120 BPM (bar = 2.0s).

The companion to the trust piece, aimed one level up: that one argues the
*token* cannot be rugged, this one argues the *pad* cannot change its terms.
Every launchpad ships an admin key that can move the treasury or raise the fee.
This contract was deployed without one, so the argument is an absence again --
four function names that do not resolve, and a call that reverts.

Everything on screen is checkable. The functions listed are the ones a pad of
this kind would normally expose; none of them exist in ArcLaunchpad.sol. The
terminal frame is the real call against the deployed contract.
"""
import os
from PIL import Image, ImageDraw
from kit import *

W = H = 1080
FPS, BAR = 30, 2.0
DUR = BAR * 8
NFRAMES = int(DUR * FPS)
OUT = 'frames9'
GROUND = ground(W, H)

PAD_ADDR = '0xdd173E00...B35f468A'

def chrome(im, d):
    logomark(im, 96, 92, 54)
    d.text((142, 72), 'TSUKIPAD', font=sg(34), fill=INK)

ADMIN = ['setProtocolFee()', 'setTreasury()', 'transferOwnership()', 'upgradeTo()']

def admin_panel(im, d, t, strike=0.0):
    """The console every other pad keeps behind a key."""
    x0, x1, y0 = 140, W - 140, 400
    rh, gap = 108, 16
    h = 92 + len(ADMIN) * (rh + gap)
    brut(d, [x0, y0, x1, y0 + h])
    ctext(d, W/2, y0 + 50, 'ADMIN', jb(30), fill=MUTED, mid=True)
    for i, fn in enumerate(ADMIN):
        a = out_cubic(clamp((t - i * 0.16) / 0.4))
        if a <= 0: continue
        ry = y0 + 92 + i * (rh + gap)
        d.rectangle([x0 + 26, ry, x1 - 26, ry + rh], fill=mix(VOID, SURF2, a),
                    outline=mix(VOID, LINE, a), width=2)
        col = INK
        # Each name is crossed out in turn, then labelled for what it is.
        sk = clamp((strike - i * 0.18) / 0.34)
        if sk > 0:
            col = mix(INK, FAINT, sk)
        d.text((x0 + 60, ry + 32), fn, font=jb(38), fill=mix(VOID, col, a))
        if sk > 0:
            tw = tsize(d, fn, jb(38))[0]
            d.rectangle([x0 + 60, ry + rh/2 - 2, x0 + 60 + tw * sk, ry + rh/2 + 3], fill=PINK)
        if sk > 0.85:
            lab = 'NO SUCH FUNCTION'
            lw = tsize(d, lab, jbr(22))[0]
            d.text((x1 - 60 - lw, ry + 42), lab, font=jbr(22), fill=PINK)

# ---------------------------------------------------------------- scenes
def s_hook(im, d, t):                                   # bar 0
    logomark(im, W/2, H/2 - 210, 170, draw_frac=clamp(t / 0.7))
    if t > 0.4:
        k = out_back((t - 0.4) / 0.5)
        f = sg(int(96 * (0.88 + 0.12 * k)))
        ctext(d, W/2, H/2 + 30, 'WHO CAN CHANGE', f, fill=INK, mid=True)
        ctext(d, W/2, H/2 + 140, 'THE RULES?', f, fill=LIME, mid=True)
    if t > 1.1:
        ctext(d, W/2, H/2 + 282, 'every launchpad keeps a key', jbr(30),
              fill=mix(VOID, MUTED, out_expo((t - 1.1) / 0.6)), mid=True)

def s_panel(im, d, t):                                  # bar 1
    chrome(im, d)
    ctext(d, W/2, 300, 'THE USUAL CONTROLS', jbr(30), fill=MUTED, mid=True)
    admin_panel(im, d, t)

def s_strike(im, d, t):                                 # bar 2
    chrome(im, d)
    ctext(d, W/2, 300, 'NONE OF THESE EXIST', jbr(30), fill=PINK, mid=True)
    admin_panel(im, d, 1.4, strike=t / 1.25)

def s_revert(im, d, t):                                 # bar 3 -- the cut
    """Matches the bed dropping out. Near-black, one line, no flourish."""
    a = out_expo(clamp(t / 0.6))
    ctext(d, W/2, H/2 - 60, 'owner()', jb(74), fill=mix(VOID, MUTED, a), mid=True)
    if t > 0.55:
        b = out_expo((t - 0.55) / 0.5)
        ctext(d, W/2, H/2 + 60, 'reverted', sg(112), fill=mix(VOID, LIME, b), mid=True)
    if t > 1.2:
        c = out_expo((t - 1.2) / 0.5)
        ctext(d, W/2, H/2 + 200, 'there is no owner to ask', jbr(30),
              fill=mix(VOID, MUTED, c), mid=True)

def s_terminal(im, d, t):                               # bar 4
    chrome(im, d)
    ctext(d, W/2, 268, 'RUN IT YOURSELF', jbr(30), fill=MUTED, mid=True)
    x0, x1, y0, y1 = 120, W - 120, 380, 700
    brut(d, [x0, y0, x1, y1], fill=(14, 14, 17))
    d.rectangle([x0, y0, x1, y0 + 46], fill=SURF2)
    for i, c in enumerate((PINK, AMBER, LIME)):
        d.ellipse([x0 + 22 + i * 30, y0 + 16, x0 + 36 + i * 30, y0 + 30], fill=c)
    lines = [('$ cast call ' + PAD_ADDR, INK, 0.0),
             ("    'owner()'", INK, 0.18),
             ('Error: execution reverted', PINK, 0.7)]
    for txt, col, at in lines:
        if t < at: continue
        n = int(len(txt) * clamp((t - at) / 0.55))
        d.text((x0 + 34, y0 + 84 + lines.index((txt, col, at)) * 62),
               txt[:n], font=jbr(27), fill=col)
    if t > 1.35:
        a = out_expo((t - 1.35) / 0.45)
        ctext(d, W/2, 790, 'no admin key was ever deployed', jbr(30),
              fill=mix(VOID, INK, a), mid=True)

FIXED = [('treasury', 'where fees go'),
         ('fee split', 'how they divide'),
         ('launch fee', 'set to zero')]

def s_fixed(im, d, t):                                  # bar 5
    chrome(im, d)
    ctext(d, W/2, 262, 'FIXED WHEN WE DEPLOYED', jbr(30), fill=MUTED, mid=True)
    for i, (big, small) in enumerate(FIXED):
        st = t - 0.2 - i * 0.26
        if st <= 0: continue
        a = out_cubic(clamp(st / 0.45))
        y = 372 + i * 176
        brut(d, [140, y, W - 140, y + 142], fill=mix(VOID, SURFACE, a),
             border=mix(VOID, LINE, a), shadow=mix(VOID, LINE, a))
        d.text((186, y + 26), big, font=sg(54), fill=mix(VOID, INK, a))
        d.text((186, y + 92), small, font=jbr(25), fill=mix(VOID, MUTED, a))
        lab = 'IMMUTABLE'
        lw = tsize(d, lab, jb(26))[0]
        d.text((W - 186 - lw, y + 56), lab, font=jb(26), fill=mix(VOID, LIME, a))

def s_us(im, d, t):                                     # bar 6
    chrome(im, d)
    k = out_back(clamp(t / 0.55))
    f = sg(int(92 * (0.9 + 0.1 * k)))
    ctext(d, W/2, H/2 - 60, 'WE CANNOT', f, fill=INK, mid=True)
    ctext(d, W/2, H/2 + 60, 'CHANGE IT EITHER.', f, fill=LIME, mid=True)
    if t > 0.8:
        a = out_expo((t - 0.8) / 0.5)
        ctext(d, W/2, H/2 + 210, 'the terms you launch under are the terms', jbr(28),
              fill=mix(VOID, MUTED, a), mid=True)
        ctext(d, W/2, H/2 + 252, 'that outlive us', jbr(28),
              fill=mix(VOID, MUTED, a), mid=True)

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

SCENES = [(0, s_hook), (1, s_panel), (2, s_strike), (3, s_revert),
          (4, s_terminal), (5, s_fixed), (6, s_us), (7, s_cta)]
PAYOFF = 3

def render(t):
    im = GROUND.copy(); d = ImageDraw.Draw(im)
    bar = int(t / BAR); start, fn = SCENES[0]
    for sb, f in SCENES:
        if bar >= sb: start, fn = sb, f
    fn(im, d, t - start * BAR)
    # No lime flash here. The bed cuts out at this bar, so the picture cuts to
    # black with it -- a flash would argue the opposite of what the scene says.
    dt = t - PAYOFF * BAR
    if 0 <= dt < 0.16:
        im = Image.blend(im, Image.new('RGB', (W, H), VOID), 1 - dt / 0.16)
    if t < 0.35:      im = Image.blend(Image.new('RGB', (W, H), VOID), im, out_cubic(t / 0.35))
    if t > DUR - 0.4: im = Image.blend(im, Image.new('RGB', (W, H), VOID), out_cubic((t - (DUR - 0.4)) / 0.4))
    return im

os.makedirs(OUT, exist_ok=True)
for i in range(NFRAMES):
    render(i / FPS).save(f'{OUT}/f{i:04d}.png')
    if i % 120 == 0: print(f'  {i}/{NFRAMES}')
print('frames done:', NFRAMES)
