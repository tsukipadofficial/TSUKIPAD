"""TSUKIPAD mainnet piece -- 1920x1080, 12s, 120 BPM (bar = 2.0s).

Two cuts from one file:
  python render3.py announce   -> date reveal, post before mainnet
  python render3.py live       -> "MAINNET IS LIVE", post on the day

The first half is a scrambling counter that locks digit by digit, landing its
last digit exactly on the bar-4 drop at t=6.0s.
"""
import sys, os, random
from PIL import Image, ImageDraw, ImageFilter
from kit import *

MODE = (sys.argv[1] if len(sys.argv) > 1 else 'announce')
assert MODE in ('announce', 'live'), MODE

W, H, FPS, BAR = 1920, 1080, 30, 2.0
DUR = BAR * 6
NFRAMES = int(DUR * FPS)
OUT = f'frames3_{MODE}'

DATE_STR   = '09.16.26'
DATE_LONG  = 'SEPTEMBER 16, 2026'
DIGIT_POS  = [i for i, c in enumerate(DATE_STR) if c.isdigit()]
LOCK_ORDER = [6, 7, 0, 1, 3, 4]        # year, then month, then day
LOCK_T     = {p: 2.0 + k * 0.8 for k, p in enumerate(LOCK_ORDER)}  # last locks at 6.0
GROUND     = ground(W, H)

def counter(im, d, cx, cy, t, size=250, locked=False):
    """Flip-clock that resolves year -> month -> day.

    Unsettled digits are drawn as a blurred vertical reel rather than a crisp
    numeral. A still frame of a crisp wrong digit reads as a real date, and
    people screenshot frames off the timeline -- so no frame is allowed to show
    a settled number that isn't the real one.
    """
    f = jb(size)
    cw = d.textlength('0', font=f)
    dw = d.textlength('.', font=f)
    total = sum(dw if c == '.' else cw for c in DATE_STR)
    step = size * 0.82
    cell_h = int(size * 1.34)
    x = cx - total / 2
    for i, c in enumerate(DATE_STR):
        if c == '.':
            d.text((x, cy), '.', font=f, fill=LINEBR); x += dw; continue
        is_lock = locked or t >= LOCK_T[i]
        if is_lock:
            w = d.textlength(c, font=f)
            d.text((x + (cw - w) / 2, cy), c, font=f, fill=INK)
            if not locked and t - LOCK_T[i] < 0.16:                  # lock flash
                d.rectangle([x - 6, cy - 14, x + cw + 6, cy + size * 1.16],
                            outline=LIME, width=4)
        else:
            lay = Image.new('RGBA', (int(cw) + 8, cell_h), (0, 0, 0, 0))
            ld = ImageDraw.Draw(lay)
            phase = t * 11.0 + i * 0.37
            frac, base = phase % 1.0, int(phase)
            for k in (-1, 0, 1, 2):
                dig = str((base + k) % 10)
                w = ld.textlength(dig, font=f)
                ld.text(((cw + 8 - w) / 2, (k - frac) * step), dig,
                        font=f, fill=FAINT + (165,))
            lay = lay.filter(ImageFilter.GaussianBlur(size * 0.020))  # motion smear
            im.paste(lay, (int(x) - 4, int(cy)), lay)
        x += cw

def jp_date(d, cx, y, size):
    """9月16日 -- 月 is the brand character, so it carries the accent."""
    f = JP(size)
    parts = [('9', INK), ('月', LIME), ('16', INK), ('日', LIMEDIM)]
    total = sum(d.textlength(p, font=f) for p, _ in parts)
    x = cx - total / 2
    for p, col in parts:
        d.text((x, y), p, font=f, fill=col)
        x += d.textlength(p, font=f)

def ticks(d, t):
    """Beat ticks marching across a rule -- the clock, visualised."""
    y = H - 180
    d.rectangle([160, y, W - 160, y + 2], fill=LINE)
    n_beats = int(t / (BAR / 4)) + 1
    for k in range(min(n_beats, 12)):
        x = 160 + k * (W - 320) / 11.0
        tall = (k % 4 == 0)
        col = LIME if tall else LINEBR
        d.rectangle([x - 2, y - (26 if tall else 14), x + 2, y], fill=col)

PILLARS = [('$3,000', 'OPENING MARKET CAP'),
           ('100%', 'OF SUPPLY IS LIQUIDITY'),
           ('0', 'PRESALE. SEED. INSIDERS.')]

# --- scenes ---------------------------------------------------------------
def s_wait(im, d, t, bar):
    """bars 0-2: tension. Counter scrambles, ticks march, logo watermark."""
    logomark(im, W / 2, 210, 96)
    ctext(d, W / 2, 300, 'ARC NETWORK MAINNET', jbr(34), fill=MUTED, mid=True)
    counter(im, d, W / 2, H / 2 - 130, t)
    ticks(d, t)
    if t > 4.2:
        ctext(d, W / 2, H - 300, 'TSUKIPAD IS READY', jb(36),
              fill=mix(VOID, LIME, out_expo((t - 4.2) / 0.8)), mid=True)

def s_reveal(im, d, t):
    """bar 3: the drop."""
    if MODE == 'announce':
        ctext(d, W / 2, 250, 'ARC NETWORK MAINNET', jbr(34), fill=MUTED, mid=True)
        counter(im, d, W / 2, H / 2 - 210, t, size=250, locked=True)
        if t > 0.30:
            a = out_expo((t - 0.30) / 0.5)
            ctext(d, W / 2, H / 2 + 190, DATE_LONG, sg(72), fill=mix(VOID, INK, a), mid=True)
        if t > 0.62:
            jp_date(d, W / 2, H / 2 + 250, 96)
    else:
        k = out_back(clamp(t / 0.45))
        ctext(d, W / 2, 250, 'ARC NETWORK MAINNET', jbr(34), fill=MUTED, mid=True)
        ctext(d, W / 2, H / 2 - 40, 'IS LIVE.', sg(int(300 * (0.82 + 0.18 * k))), fill=LIME, mid=True)
        if t > 0.55:
            a = out_expo((t - 0.55) / 0.5)
            ctext(d, W / 2, H / 2 + 190, 'AND SO ARE WE.', sg(72), fill=mix(VOID, INK, a), mid=True)
    if t > 1.15:
        w = int(760 * out_expo((t - 1.15) / 0.7))
        d.rectangle([W / 2 - 380, H / 2 + 360, W / 2 - 380 + w, H / 2 + 364], fill=LIME)

def s_pillars(im, d, t):
    """bar 4: the three numbers that matter, one per half-beat."""
    head = 'LAUNCH YOUR TOKEN ON DAY ONE' if MODE == 'announce' else 'LAUNCH YOUR TOKEN RIGHT NOW'
    ctext(d, W / 2, 210, head, jb(40), fill=mix(VOID, LIME, out_expo(t / 0.28)), mid=True)
    cw, gap = 500, 50
    x0 = W / 2 - (cw * 3 + gap * 2) / 2
    for i, (big, small) in enumerate(PILLARS):
        st = t - i * 0.35
        if st < 0: continue
        a = out_back(clamp(st / 0.5))
        dy = int((1 - out_expo(st / 0.45)) * 70)
        x = x0 + i * (cw + gap)
        brut(d, [x, 400 + dy, x + cw, 700 + dy], fill=SURFACE, border=LINEBR, off=int(9 * a))
        ctext(d, x + cw / 2, 500 + dy, big, sg(96), fill=INK, mid=True)
        ctext(d, x + cw / 2, 610 + dy, small, jbr(25), fill=MUTED, mid=True)
    if t > 1.5:
        ctext(d, W / 2, 830, 'LIQUIDITY LOCKED FOREVER. LP BURNED ON LAUNCH.', jbr(32),
              fill=mix(VOID, MUTED, out_expo((t - 1.5) / 0.5)), mid=True)

def s_end(im, d, t):
    logomark(im, W / 2, H / 2 - 290, 150)
    f = sg(120)
    tot = d.textlength('TSUKI', font=f) + d.textlength('PAD', font=f)
    x = W / 2 - tot / 2 - 40
    d.text((x, H / 2 - 155), 'TSUKI', font=f, fill=INK)
    d.text((x + d.textlength('TSUKI', font=f), H / 2 - 155), 'PAD', font=f, fill=LIME)
    d.text((x + tot + 26, H / 2 - 137), '月', font=JP(78), fill=LIMEDIM)
    if t > 0.22:
        ctext(d, W / 2, H / 2 + 75, 'tsukipad.com', sg(88), fill=INK, mid=True)
    if t > 0.42:
        ctext(d, W / 2, H / 2 + 185, '@tsukipad_', jb(44), fill=LIME, mid=True)
    if t > 0.62:
        tag = DATE_LONG if MODE == 'announce' else 'LIVE NOW'
        bw, bh = 560, 68
        brut(d, [W / 2 - bw / 2, H / 2 + 260, W / 2 + bw / 2, H / 2 + 260 + bh],
             fill=SURFACE, border=LINE, off=6)
        ctext(d, W / 2, H / 2 + 260 + bh / 2, tag, jbr(32), fill=MUTED, mid=True)
    if t > 0.9:
        ctext(d, W / 2, H - 96, TRADEMARK[0], jbr(21), fill=(78, 78, 90), mid=True)
        ctext(d, W / 2, H - 66, TRADEMARK[1], jbr(21), fill=(78, 78, 90), mid=True)

def render(t):
    im = GROUND.copy(); d = ImageDraw.Draw(im)
    bar = int(t / BAR)
    if bar <= 2:   s_wait(im, d, t, bar)
    elif bar == 3: s_reveal(im, d, t - 3 * BAR)
    elif bar == 4: s_pillars(im, d, t - 4 * BAR)
    else:          s_end(im, d, t - 5 * BAR)
    dt = t - 3 * BAR                                   # flash on the drop
    if 0 <= dt < 0.11:
        im = Image.blend(im, Image.new('RGB', (W, H), LIME), 0.42 * (1 - dt / 0.11))
    dt = t - 5 * BAR
    if 0 <= dt < 0.08:
        im = Image.blend(im, Image.new('RGB', (W, H), INK), 0.22 * (1 - dt / 0.08))
    if t < 0.4:       im = Image.blend(Image.new('RGB', (W, H), VOID), im, out_cubic(t / 0.4))
    if t > DUR - 0.4: im = Image.blend(im, Image.new('RGB', (W, H), VOID), out_cubic((t - (DUR - 0.4)) / 0.4))
    return im

os.makedirs(OUT, exist_ok=True)
for i in range(NFRAMES):
    render(i / FPS).save(f'{OUT}/f{i:04d}.png')
    if i % 90 == 0: print(f'  {i}/{NFRAMES}')
print(f'frames done ({MODE}):', NFRAMES)
