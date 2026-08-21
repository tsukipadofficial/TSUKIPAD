"""TSUKIPAD trailer frames.

Rendered in the product's own design system (web/app/globals.css tokens +
components/Logo.tsx): near-black ground, 2px rules, offset shadows with no
blur, one acid-lime accent. Neo-brutalism is all flat fills and hard edges, so
it rasterises exactly -- no gradients to band, no blur to approximate.

24s @ 30fps, 120 BPM. BAR = 2.0s, so every cut lands on a bar line.
"""
import math, os
from PIL import Image, ImageDraw, ImageFont

W, H, FPS = 1920, 1080, 30
BAR, DUR = 2.0, 24.0
NFRAMES = int(DUR * FPS)
OUT = 'frames'

# --- design tokens (verbatim from globals.css) ----------------------------
VOID   = (8, 8, 10);      SURFACE = (18, 18, 22);   SURF2 = (26, 26, 32)
LINE   = (44, 44, 53);    LINEBR  = (67, 67, 79)
LIME   = (200, 255, 46);  LIMEDIM = (147, 191, 31)
PINK   = (255, 61, 139);  CYAN    = (41, 229, 245); AMBER = (255, 176, 32)
INK    = (244, 244, 240); MUTED   = (140, 140, 153); FAINT = (91, 91, 104)

F = 'fonts/'
def sg(sz):  return ImageFont.truetype(F + 'sg-bold.ttf', sz)
def sgm(sz): return ImageFont.truetype(F + 'sg-med.ttf', sz)
def jb(sz):  return ImageFont.truetype(F + 'jb-bold.ttf', sz)
def jbr(sz): return ImageFont.truetype(F + 'jb-reg.ttf', sz)
JP = lambda sz: ImageFont.truetype('/System/Library/Fonts/Hiragino Sans GB.ttc', sz, index=0)

# --- easing ---------------------------------------------------------------
def clamp(x, a=0.0, b=1.0): return max(a, min(b, x))
def out_expo(x):  x = clamp(x); return 1 - 2 ** (-10 * x) if x < 1 else 1
def out_back(x):
    x = clamp(x); c = 1.9
    return 1 + (c + 1) * (x - 1) ** 3 + c * (x - 1) ** 2
def out_cubic(x): x = clamp(x); return 1 - (1 - x) ** 3
def in_cubic(x):  return clamp(x) ** 3
def mix(c0, c1, k):
    k = clamp(k); return tuple(int(a + (b - a) * k) for a, b in zip(c0, c1))


def stroke_poly(pts, w, cap='square'):
    """Outline of a stroked path as one polygon.

    Pillow's line(joint='curve') stamps a wedge at every vertex, which on a
    thick stroke over a densely sampled bezier sprays visible teeth along the
    edge. Offsetting the centreline by +/-w/2 along the normal and filling the
    result gives an exact stroke instead.
    """
    n = len(pts)
    if n < 2: return []
    hw = w / 2.0
    tan = []
    for i in range(n):
        if i == 0:      dx, dy = pts[1][0]-pts[0][0],   pts[1][1]-pts[0][1]
        elif i == n-1:  dx, dy = pts[-1][0]-pts[-2][0], pts[-1][1]-pts[-2][1]
        else:           dx, dy = pts[i+1][0]-pts[i-1][0], pts[i+1][1]-pts[i-1][1]
        L = math.hypot(dx, dy) or 1.0
        tan.append((dx/L, dy/L))
    P = list(pts)
    if cap == 'square':                      # matches strokeLinecap="square"
        P[0]  = (P[0][0]  - tan[0][0]*hw,  P[0][1]  - tan[0][1]*hw)
        P[-1] = (P[-1][0] + tan[-1][0]*hw, P[-1][1] + tan[-1][1]*hw)
    left  = [(P[i][0] - tan[i][1]*hw, P[i][1] + tan[i][0]*hw) for i in range(n)]
    right = [(P[i][0] + tan[i][1]*hw, P[i][1] - tan[i][0]*hw) for i in range(n)]
    return left + right[::-1]

def aa_stroke(im, pts, w, color, ss=3):
    """Composite a stroked path onto im, supersampled so the edge is smooth."""
    if len(pts) < 2: return
    pad = w + 6
    xs = [p[0] for p in pts]; ys = [p[1] for p in pts]
    x0, y0 = int(min(xs) - pad), int(min(ys) - pad)
    x1, y1 = int(max(xs) + pad), int(max(ys) + pad)
    lw, lh = max(1, x1-x0), max(1, y1-y0)
    lay = Image.new('RGBA', (lw*ss, lh*ss), (0, 0, 0, 0))
    ld = ImageDraw.Draw(lay)
    sp = [((p[0]-x0)*ss, (p[1]-y0)*ss) for p in pts]
    ld.polygon(stroke_poly(sp, w*ss), fill=tuple(color) + (255,))
    lay = lay.resize((lw, lh), Image.LANCZOS)
    im.paste(lay, (x0, y0), lay)

# --- background: the faint 45-degree grain from body{} --------------------
def make_ground():
    g = Image.new('RGB', (W, H), VOID)
    d = ImageDraw.Draw(g)
    for k in range(-H, W + H, 3):                 # 1px line every 3px, 45deg
        d.line([(k, 0), (k + H, H)], fill=(11, 11, 13), width=1)
    return g
GROUND = make_ground()

# --- primitives -----------------------------------------------------------
def brut(d, box, fill=SURFACE, border=LINE, bw=2, shadow=LINE, off=8):
    """The .brut utility: flat fill, hard rule, offset shadow with no blur."""
    x0, y0, x1, y1 = box
    if off: d.rectangle([x0 + off, y0 + off, x1 + off, y1 + off], fill=shadow)
    d.rectangle([x0, y0, x1, y1], fill=fill, outline=border, width=bw)

def tsize(d, s, f):
    b = d.textbbox((0, 0), s, font=f); return b[2] - b[0], b[3] - b[1], b[0], b[1]

def ctext(d, cx, y, s, f, fill=INK, anchor_mid=False):
    """Draw centred on cx; y is top (or vertical centre if anchor_mid)."""
    w, h, ox, oy = tsize(d, s, f)
    d.text((cx - w / 2 - ox, (y - h / 2 if anchor_mid else y) - oy), s, font=f, fill=fill)
    return w, h

def arrow(d, x, y, ln, col=LIME, th=10):
    """Hard geometric arrow -- the font subset has no U+2192."""
    d.rectangle([x, y - th // 2, x + ln - th * 2, y + th // 2], fill=col)
    hx = x + ln - th * 2
    d.polygon([(hx - 2, y - th * 1.7), (x + ln, y), (hx - 2, y + th * 1.7)], fill=col)

def logomark(im, cx, cy, size, draw_frac=1.0, alpha=255):
    """components/Logo.tsx LogoMark, on its 52x52 grid.

    Drawn 4x oversampled and reduced: the mark is the one place with a curved
    edge against a flat fill, so it is the one place aliasing shows.
    """
    SS = 4
    s = size / 52.0
    ls = s * SS
    side = int(52 * ls)
    lay = Image.new('RGBA', (side, side), (0, 0, 0, 0))
    d = ImageDraw.Draw(lay)
    P = lambda x, y: (x * ls, y * ls)
    d.rectangle([*P(6, 6), *P(50, 50)], fill=LIMEDIM + (alpha,))
    d.rectangle([*P(2, 2), *P(46, 46)], fill=LIME + (alpha,),
                outline=VOID + (alpha,), width=max(1, int(2.5 * ls)))
    # the curve: flat and cheap early, vertical near the ceiling
    pts = []
    for i in range(81):
        u = i / 80.0
        bx = (1-u)**3*8 + 3*(1-u)**2*u*22 + 3*(1-u)*u**2*31 + u**3*38
        by = (1-u)**3*39 + 3*(1-u)**2*u*39 + 3*(1-u)*u**2*34 + u**3*10
        pts.append(P(bx, by))
    n = max(2, int(len(pts) * clamp(draw_frac)))
    poly = stroke_poly(pts[:n], 6.5 * ls, 'square')
    if poly: d.polygon(poly, fill=VOID + (alpha,))
    if draw_frac > 0.93:
        d.rectangle([*P(33, 6), *P(42, 15)], fill=VOID + (alpha,))   # ceiling marker
    d.rectangle([*P(6, 36), *P(12, 42)], fill=PINK + (alpha,))       # start marker
    out = int(52 * s)
    lay = lay.resize((out, out), Image.LANCZOS)
    im.paste(lay, (int(cx - out / 2), int(cy - out / 2)), lay)

def strike(d, cx, y, w, frac, col=PINK, th=9):
    """Cross-out rule that wipes in from the left."""
    if frac <= 0: return
    d.rectangle([cx - w / 2, y - th / 2, cx - w / 2 + w * clamp(frac), y + th / 2], fill=col)

def curve_pts(x0, y0, x1, y1, n=180):
    """The launch curve: cheap and flat early, vertical near the ceiling."""
    out = []
    for i in range(n + 1):
        u = i / n
        px = x0 + (x1 - x0) * u
        py = y0 - (y0 - y1) * (u ** 3.1)
        out.append((px, py))
    return out

def label(d, x, y, s, col=FAINT, sz=26):
    d.text((x, y), s, font=jbr(sz), fill=col)

# --- scenes ---------------------------------------------------------------
def scene_logo_in(im, d, t):                      # bar 1  (0-2s)
    logomark(im, W/2, H/2 - 30, 260, draw_frac=clamp(t / 0.95))
    if t > 1.15:
        a = out_expo((t - 1.15) / 0.7)
        ctext(d, W/2, H/2 + 165, 'FAIR LAUNCH INFRASTRUCTURE',
              jbr(30), fill=mix(VOID, MUTED, a))

def scene_wordmark(im, d, t):                     # bar 2  (2-4s)
    logomark(im, W/2 - 330, H/2 - 20, 190)
    k = out_back(t / 0.55)
    f = sg(int(150 * (0.85 + 0.15 * k)))
    x = W/2 - 330 + 140
    d.text((x, H/2 - 20 - 92), 'TSUKI', font=f, fill=INK)
    wt = d.textlength('TSUKI', font=f)
    d.text((x + wt, H/2 - 20 - 92), 'PAD', font=f, fill=LIME)
    if t > 0.75:
        a = out_cubic((t - 0.75) / 0.5)
        jf = JP(int(96))
        d.text((x + wt + d.textlength('PAD', font=f) + 34, H/2 - 20 - 66), '月',
               font=jf, fill=LIMEDIM if a > 0.5 else LINE)
    if t > 1.1:
        w = int(760 * out_expo((t - 1.1) / 0.8))
        d.rectangle([W/2 - 380, H/2 + 130, W/2 - 380 + w, H/2 + 134], fill=LINE)

STRIKES = ['PRESALE.', 'SEED ROUND.', 'INSIDER ALLOCATION.']
def scene_strikes(im, d, t):                      # bar 3  (4-6s)
    ys = [H/2 - 190, H/2 - 20, H/2 + 150]
    for i, s in enumerate(STRIKES):
        st = t - i * 0.5
        if st < 0: continue
        f = sg(96)
        a = out_expo(st / 0.22)
        dx = int((1 - a) * -70)
        w, h, ox, oy = tsize(d, s, f)
        col = MUTED if st > 0.34 else INK
        d.text((W/2 - w/2 - ox + dx, ys[i] - h/2 - oy), s, font=f, fill=col)
        strike(d, W/2 + dx, ys[i], w + 40, (st - 0.24) / 0.26)

def scene_none(im, d, t):                         # bar 4  (6-8s)
    for i, s in enumerate(STRIKES):               # hold the struck list, shrunk
        f = sgm(40); ys = H/2 - 300 + i * 56
        w, _, ox, oy = tsize(d, s, f)
        d.text((W/2 - w/2 - ox, ys - oy), s, font=f, fill=(48, 48, 58))
        strike(d, W/2, ys + 22, w + 16, 1.0, col=(70, 30, 46), th=5)
    k = out_back(t / 0.5)
    f = sg(int(190 * (0.8 + 0.2 * k)))
    w, h, ox, oy = tsize(d, 'NONE OF IT.', f)
    d.text((W/2 - w/2 - ox, H/2 + 30 - h/2 - oy), 'NONE OF IT.', font=f, fill=LIME)
    if t > 0.6:
        a = out_cubic((t - 0.6) / 0.6)
        ctext(d, W/2, H/2 + 190, 'ONE TRANSACTION. STRAIGHT INTO A REAL POOL.',
              jbr(32), fill=MUTED if a > 0.4 else VOID)

def scene_mechanism(im, d, t):                    # bars 5-6 (8-12s)
    cy = H/2 - 40
    # left card: the cost
    a1 = out_back(clamp(t / 0.55))
    bw, bh = 460, 300
    x0 = W/2 - 620
    if True:
        brut(d, [x0, cy - bh/2, x0 + bw, cy + bh/2], fill=SURFACE, border=LINEBR, off=int(10*a1))
        label(d, x0 + 34, cy - bh/2 + 30, 'OPENS AT')
        f = sg(110); ctext(d, x0 + bw/2, cy + 18, '$3,000', f, fill=INK, anchor_mid=True)
        ctext(d, x0 + bw/2, cy + 96, 'USDC MARKET CAP', jbr(26), fill=FAINT, anchor_mid=True)
    # arrow
    if t > 0.62:
        ln = int(240 * out_expo((t - 0.62) / 0.5))
        arrow(d, W/2 - 130, cy, ln)
    if t > 1.15:                                   # USDC moving down the wire
        for k in range(3):
            u = ((t - 1.15) * 0.62 + k / 3.0) % 1.0
            px = W/2 - 150 + 250 * u
            a = math.sin(math.pi * u)
            sz = 9
            d.rectangle([px - sz, cy - sz, px + sz, cy + sz], fill=mix(VOID, CYAN, a))
    # right card: the destination
    if t > 0.9:
        a2 = out_back(clamp((t - 0.9) / 0.55))
        x1 = W/2 + 170
        brut(d, [x1, cy - bh/2, x1 + bw + 40, cy + bh/2], fill=SURF2, border=LIME, off=int(10*a2))
        label(d, x1 + 34, cy - bh/2 + 30, 'DESTINATION', col=LIMEDIM)
        ctext(d, x1 + (bw+40)/2, cy + 4, 'UNISWAP', sg(72), fill=LIME, anchor_mid=True)
        ctext(d, x1 + (bw+40)/2, cy + 76, 'V3 POOL', sg(72), fill=LIME, anchor_mid=True)
    if t > 1.7:
        a = out_cubic((t - 1.7) / 0.7)
        ctext(d, W/2, cy + 260, 'NO PRESALE  ·  NO SEED CAPITAL  ·  NO TEAM ALLOCATION',
              jbr(30), fill=mix(VOID, MUTED, a))
    if t > 2.7:
        a = out_expo((t - 2.7) / 0.6)
        w = int(560 * a)
        d.rectangle([W/2 - w/2, cy + 330, W/2 + w/2, cy + 334], fill=LINE)
        if t > 3.05:
            ctext(d, W/2, cy + 392, 'YOU PAY NOTHING. 100% OF SUPPLY IS THE LIQUIDITY.',
                  jb(34), fill=mix(VOID, LIME, out_expo((t - 3.05) / 0.5)), anchor_mid=True)

TILES = [('SINGLE-SIDED', 'you supply one side.\nthe curve supplies\nthe rest.', CYAN),
         ('COSTS YOU NOTHING', 'your entire supply\nbecomes the liquidity.\nyou pay nothing.', LIME),
         ('LOCKED FOREVER',   'LP tokens burned\non launch. nobody\ncan pull it. ever.', PINK)]
def scene_tiles(im, d, t):                        # bars 7-8 (12-16s)
    tw, th = 500, 400; gap = 46
    total = tw * 3 + gap * 2; x0 = W/2 - total/2; cy = H/2 + 10
    for i, (title, body, col) in enumerate(TILES):
        st = t - i * 0.5
        if st < 0: continue
        a = out_back(clamp(st / 0.6))
        dy = int((1 - out_expo(st / 0.5)) * 90)
        x = x0 + i * (tw + gap)
        brut(d, [x, cy - th/2 + dy, x + tw, cy + th/2 + dy], fill=SURFACE, border=col, off=int(10 * a))
        d.rectangle([x, cy - th/2 + dy, x + tw, cy - th/2 + dy + 8], fill=col)
        d.text((x + 36, cy - th/2 + dy + 52), f'0{i+1}', font=jb(30), fill=col)
        f = sg(46)
        # wrap the title onto two lines if it is wide
        words = title.split(); lines = [title]
        if d.textlength(title, font=f) > tw - 72:
            lines = [words[0], ' '.join(words[1:])]
        for li, ln in enumerate(lines):
            d.text((x + 36, cy - th/2 + dy + 112 + li * 56), ln, font=f, fill=INK)
        if st > 0.35:
            for li, ln in enumerate(body.split('\n')):
                d.text((x + 36, cy - th/2 + dy + 240 + li * 34), ln, font=jbr(24), fill=MUTED)
        if st > 1.05:                              # accent rule keeps the hold alive
            fw = int((tw - 72) * out_expo((st - 1.05) / 0.7))
            d.rectangle([x + 36, cy + th/2 + dy - 40, x + 36 + fw, cy + th/2 + dy - 36], fill=col)

def scene_curve(im, d, t):                        # bars 9-10 (16-20s)
    gx0, gy0, gx1, gy1 = W/2 - 640, H/2 + 210, W/2 + 500, H/2 - 250
    d.rectangle([gx0, gy0, gx0 + 1140, gy0 + 3], fill=LINE)
    for k in range(1, 5):                          # grid
        y = gy0 - (gy0 - gy1) * k / 4.5
        d.line([(gx0, y), (gx0 + 1140, y)], fill=(24, 24, 30), width=2)
    pts = curve_pts(gx0, gy0, gx1, gy1)
    n = max(2, int(len(pts) * out_cubic(t / 2.55)))
    seg = pts[:n]
    aa_stroke(im, seg, 10, LIME)
    hx, hy = seg[-1]
    d.rectangle([hx - 13, hy - 13, hx + 13, hy + 13], fill=LIME, outline=VOID, width=3)
    d.rectangle([gx0 - 8, gy0 - 8, gx0 + 8, gy0 + 8], fill=PINK)
    # ticking market cap, easing to the ceiling with the curve
    prog = out_cubic(t / 2.55)
    mc = 3000 + (420000 - 3000) * (prog ** 3.1)
    f = jb(76)
    s = f'${mc:,.0f}'
    d.text((gx0 + 8, gy1 - 130), s, font=f, fill=INK)
    label(d, gx0 + 10, gy1 - 168, 'MARKET CAP', col=FAINT, sz=26)
    if t > 1.25:
        a = out_expo((t - 1.25) / 0.6)
        ctext(d, W/2 + 430, H/2 + 300, 'FAIR LAUNCH.', sg(64),
              fill=mix(VOID, INK, a), anchor_mid=True)
    if t > 0.35:
        ctext(d, W/2, H/2 - 430, 'EVERY TOKEN WALKS THE SAME CURVE', jbr(32),
              fill=mix(VOID, MUTED, out_expo((t - 0.35) / 0.6)), anchor_mid=True)
    if t > 2.7:                                    # ceiling stamp, hard-cut in
        a = out_back(clamp((t - 2.7) / 0.45))
        bw2, bh2 = int(300 * a), 74
        bx, by = gx1 - 40, gy1 - 46
        brut(d, [bx, by, bx + bw2, by + bh2], fill=VOID, border=LIME, off=7)
        if a > 0.75:
            ctext(d, bx + bw2/2, by + bh2/2, 'LP BURNED', jb(34), fill=LIME, anchor_mid=True)

def scene_impact(im, d, t):                       # bar 11 (20-22s)
    k = out_back(clamp(t / 0.5))
    sz = int(230 * (0.7 + 0.3 * k))
    logomark(im, W/2, H/2 - 120, sz)
    f = sg(int(140))
    tot = d.textlength('TSUKI', font=f) + d.textlength('PAD', font=f)
    x = W/2 - tot/2
    if t > 0.28:
        d.text((x, H/2 + 40), 'TSUKI', font=f, fill=INK)
        d.text((x + d.textlength('TSUKI', font=f), H/2 + 40), 'PAD', font=f, fill=LIME)
    if t > 0.6:
        d.text((x + tot + 30, H/2 + 62), '月', font=JP(88), fill=LIMEDIM)
    if t > 0.85:
        w = int(700 * out_expo((t - 0.85) / 0.7))
        d.rectangle([W/2 - 350, H/2 + 230, W/2 - 350 + w, H/2 + 234], fill=LIME)

def scene_endcard(im, d, t):                      # bar 12 (22-24s)
    logomark(im, W/2, H/2 - 250, 130)
    a = out_expo(t / 0.5)
    ctext(d, W/2, H/2 - 100, 'tsukipad.com', sg(int(104)), fill=INK, anchor_mid=True)
    if t > 0.3:
        ctext(d, W/2, H/2 + 10, '@tsukipad_', jb(46), fill=LIME, anchor_mid=True)
    if t > 0.55:
        bw2, bh2 = 520, 66
        brut(d, [W/2 - bw2/2, H/2 + 90, W/2 + bw2/2, H/2 + 90 + bh2],
             fill=SURFACE, border=LINE, off=6)
        ctext(d, W/2, H/2 + 90 + bh2/2, 'BUILT ON ARC NETWORK', jbr(30), fill=MUTED, anchor_mid=True)
    if t > 0.9:
        ctext(d, W/2, H - 96,
              'Arc is a trademark of Circle Internet Group, Inc.', jbr(21), fill=(78, 78, 90), anchor_mid=True)
        ctext(d, W/2, H - 66,
              'This project is not affiliated with or endorsed by Circle.', jbr(21), fill=(78, 78, 90), anchor_mid=True)

SCENES = [(0, scene_logo_in), (1, scene_wordmark), (2, scene_strikes), (3, scene_none),
          (4, scene_mechanism), (6, scene_tiles), (8, scene_curve),
          (10, scene_impact), (11, scene_endcard)]

def render(t):
    im = GROUND.copy()
    d = ImageDraw.Draw(im)
    bar = int(t / BAR)
    start, fn = SCENES[0]
    for s, f in SCENES:
        if bar >= s: start, fn = s, f
    fn(im, d, t - start * BAR)
    # 6-frame flash on each hard cut, and the bar-11 impact
    for s, _ in SCENES:
        dt = t - s * BAR
        if 0 <= dt < 0.09 and s in (3, 10):
            ov = Image.new('RGB', (W, H), LIME if s == 10 else INK)
            im = Image.blend(im, ov, 0.30 * (1 - dt / 0.09))
    if t < 0.35:  im = Image.blend(Image.new('RGB', (W, H), VOID), im, out_cubic(t / 0.35))
    if t > 23.6:  im = Image.blend(im, Image.new('RGB', (W, H), VOID), out_cubic((t - 23.6) / 0.4))
    return im

os.makedirs(OUT, exist_ok=True)
for i in range(NFRAMES):
    render(i / FPS).save(f'{OUT}/f{i:04d}.png')
    if i % 90 == 0: print(f'  {i}/{NFRAMES}  t={i/FPS:5.2f}s')
print('frames done:', NFRAMES)
