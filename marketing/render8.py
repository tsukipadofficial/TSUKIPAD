"""TSUKIPAD free-launch piece -- 1:1 square, 16s, 120 BPM (bar = 2.0s).

Aimed at launchers, and at the one objection that stops them: a launch normally
costs you the liquidity. The answer here is structural rather than promotional
-- the supply *is* the liquidity, seeded as a single-sided V3 position sitting
entirely above spot, which is why the creator posts no USDC at all.

The counter in bars 1-2 is illustrative and the frames say so: it stands for
the cost of seeding a pool in general, not for any particular pad's fee.
"""
import os
from PIL import Image, ImageDraw
from kit import *

W = H = 1080
FPS, BAR = 30, 2.0
DUR = BAR * 8
NFRAMES = int(DUR * FPS)
OUT = 'frames8'
GROUND = ground(W, H)

def chrome(im, d):
    logomark(im, 96, 92, 54)
    d.text((142, 72), 'TSUKIPAD', font=sg(34), fill=INK)

def illustrative(d):
    """The rising number stands for a category, not for anybody's price list."""
    ctext(d, W/2, H - 62, 'illustrative · no pad named', jbr(21), fill=(70, 70, 82), mid=True)

def money(n):
    return '$' + f'{int(n):,}'

def cost_card(im, d, value, k=1.0, jitter=0):
    """The bill. Grows through bars 1-2, then gets answered."""
    x0, x1 = 150 + jitter, W - 150 + jitter
    y0, y1 = 430, 700
    brut(d, [x0, y0, x1, y1], fill=mix(VOID, SURFACE, k),
         border=mix(VOID, LINE, k), shadow=mix(VOID, LINE, k))
    ctext(d, W/2 + jitter, y0 + 52, 'LIQUIDITY YOU MUST BRING', jbr(26),
          fill=mix(VOID, MUTED, k), mid=True)
    ctext(d, W/2 + jitter, y0 + 165, money(value), sg(112),
          fill=mix(VOID, PINK, k), mid=True)

# ---------------------------------------------------------------- scenes
def s_hook(im, d, t):                                   # bar 0
    logomark(im, W/2, H/2 - 210, 170, draw_frac=clamp(t / 0.7))
    if t > 0.4:
        k = out_back((t - 0.4) / 0.5)
        f = sg(int(94 * (0.88 + 0.12 * k)))
        ctext(d, W/2, H/2 + 30, 'WHAT DOES IT COST', f, fill=INK, mid=True)
        ctext(d, W/2, H/2 + 140, 'TO LAUNCH?', f, fill=LIME, mid=True)
    if t > 1.1:
        ctext(d, W/2, H/2 + 282, 'every launch needs liquidity', jbr(30),
              fill=mix(VOID, MUTED, out_expo((t - 1.1) / 0.6)), mid=True)

def s_bill(im, d, t):                                   # bar 1
    chrome(im, d)
    ctext(d, W/2, 300, 'A POOL DOES NOT', jbr(30), fill=MUTED, mid=True)
    ctext(d, W/2, 356, 'FILL ITSELF.', sg(76), fill=MUTED, mid=True)
    cost_card(im, d, 400 + 3200 * out_cubic(t / 1.6), k=out_expo(t / 0.45))
    illustrative(d)

def s_climb(im, d, t):                                  # bar 2
    chrome(im, d)
    ctext(d, W/2, 300, 'AND IT COMES OUT', jbr(30), fill=MUTED, mid=True)
    ctext(d, W/2, 356, 'OF YOUR POCKET.', sg(76), fill=INK, mid=True)
    # Climbs faster and starts to shake -- the ask outrunning the founder.
    v = 3600 + 14000 * (t / BAR) ** 2.2
    j = int(6 * (t / BAR) ** 3 * (1 if int(t * 26) % 2 else -1))
    cost_card(im, d, v, jitter=j)
    illustrative(d)

def s_zero(im, d, t):                                   # bar 3 -- PAYOFF
    chrome(im, d)
    k = out_back(clamp(t / 0.5))
    ctext(d, W/2, 330, 'HERE', jbr(32), fill=MUTED, mid=True)
    f = sg(int(300 * (0.7 + 0.3 * k)))
    ctext(d, W/2, H/2 + 30, '$0', f, fill=LIME, mid=True)
    if t > 0.7:
        a = out_expo((t - 0.7) / 0.5)
        ctext(d, W/2, H - 250, 'you post no USDC to open the pool', jbr(32),
              fill=mix(VOID, INK, a), mid=True)

def s_supply(im, d, t):                                 # bar 4
    chrome(im, d)
    ctext(d, W/2, 250, 'BECAUSE THE SUPPLY', jbr(30), fill=MUTED, mid=True)
    ctext(d, W/2, 306, 'IS THE LIQUIDITY.', sg(72), fill=INK, mid=True)
    n = int(1_000_000_000 * out_expo(clamp(t / 0.85)))
    brut(d, [130, 470, W - 130, 640])
    ctext(d, W/2, 512, 'TOTAL SUPPLY', jbr(24), fill=MUTED, mid=True)
    ctext(d, W/2, 585, f'{n:,}', jb(58), fill=LIME, mid=True)
    if t > 0.95:
        a = out_cubic((t - 0.95) / 0.5)
        ctext(d, W/2, 706, '100% OF IT', jbr(26), fill=mix(VOID, MUTED, a), mid=True)
        brut(d, [130, 748, W - 130, 890], fill=mix(VOID, SURF2, a),
             border=mix(VOID, LIME, a), shadow=mix(VOID, LINE, a))
        ctext(d, W/2, 800, 'UNISWAP V3 · USDC POOL', jbr(24),
              fill=mix(VOID, MUTED, a), mid=True)
        ctext(d, W/2, 852, 'seeded single-sided', sg(38),
              fill=mix(VOID, INK, a), mid=True)

def dashed(d, box, col, dash=14, gap=10, w=2):
    x0, y0, x1, y1 = box
    for x in range(int(x0), int(x1), dash + gap):
        d.rectangle([x, y0, min(x + dash, x1), y0 + w], fill=col)
        d.rectangle([x, y1 - w, min(x + dash, x1), y1], fill=col)
    for y in range(int(y0), int(y1), dash + gap):
        d.rectangle([x0, y, x0 + w, min(y + dash, y1)], fill=col)
        d.rectangle([x1 - w, y, x1, min(y + dash, y1)], fill=col)

def s_range(im, d, t):                                  # bar 5
    """The mechanism, drawn as the pool sees it: everything the creator owns
    sits above spot, and the half that would need USDC is simply empty."""
    chrome(im, d)
    ctext(d, W/2, 236, 'THE POSITION SITS', jbr(30), fill=MUTED, mid=True)
    ctext(d, W/2, 292, 'ABOVE THE PRICE.', sg(72), fill=INK, mid=True)

    gx0, gx1, gy0, gy1 = 150, W - 150, 400, 812
    spot = 660
    d.rectangle([gx0, gy0, gx1, gy1], fill=SURFACE, outline=LINE, width=2)

    # The token side: fills downward to spot as the bar plays.
    k = out_cubic(clamp(t / 0.55))
    if k > 0:
        top = gy0 + 2
        d.rectangle([gx0 + 2, top, gx1 - 2, top + (spot - 6 - top) * k], fill=(26, 35, 15))
        d.rectangle([gx0 + 2, top, gx1 - 2, top + 4], fill=mix(VOID, LIME, k))
    if t > 0.45:
        a = out_expo((t - 0.45) / 0.4)
        ctext(d, W/2, 470, 'YOUR POSITION', jbr(24), fill=mix(VOID, MUTED, a), mid=True)
        ctext(d, W/2, 552, 'ALL TOKENS', sg(62), fill=mix(VOID, LIME, a), mid=True)

    # Spot, and the empty half below it -- the part you never have to fund.
    d.rectangle([gx0, spot, gx1, spot + 3], fill=LINEBR)
    d.text((gx0 + 22, spot - 40), 'spot', font=jbr(23), fill=FAINT)
    if t > 0.8:
        a = out_expo((t - 0.8) / 0.45)
        dashed(d, [gx0 + 26, spot + 30, gx1 - 26, gy1 - 26], mix(VOID, (58, 58, 68), a))
        ctext(d, W/2, spot + 92, 'USDC — none required', jbr(30),
              fill=mix(VOID, MUTED, a), mid=True)

    if t > 1.15:
        a = out_expo((t - 1.15) / 0.5)
        ctext(d, W/2, 890, 'a range above spot holds only the token,', jbr(27),
              fill=mix(VOID, MUTED, a), mid=True)
        ctext(d, W/2, 930, 'so there is nothing for you to put in', jbr(27),
              fill=mix(VOID, MUTED, a), mid=True)

FACTS = [('$0', 'to launch — the pad charges no fee'),
         ('100%', 'of supply becomes the liquidity'),
         ('$3,030', 'opening market cap, every time')]

def s_facts(im, d, t):                                  # bar 6
    chrome(im, d)
    ctext(d, W/2, 268, 'WHAT YOU ACTUALLY GET', jbr(30), fill=MUTED, mid=True)
    for i, (big, small) in enumerate(FACTS):
        st = t - 0.25 - i * 0.28
        if st <= 0: continue
        a = out_cubic(clamp(st / 0.45))
        y = 380 + i * 186
        brut(d, [140, y, W - 140, y + 150], fill=mix(VOID, SURFACE, a),
             border=mix(VOID, LINE, a), shadow=mix(VOID, LINE, a))
        d.text((186, y + 30), big, font=sg(66), fill=mix(VOID, LIME, a))
        d.text((186, y + 104), small, font=jbr(25), fill=mix(VOID, MUTED, a))

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

SCENES = [(0, s_hook), (1, s_bill), (2, s_climb), (3, s_zero),
          (4, s_supply), (5, s_range), (6, s_facts), (7, s_cta)]
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
