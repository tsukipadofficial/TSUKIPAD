"""TSUKIPAD trust piece -- 1:1 square, 16s, 120 BPM (bar = 2.0s).

The first of these aimed at buyers rather than launchers. Everyone asks whether
a pad will rug, every pad answers "liquidity locked", and a lock is a promise
with a key and an expiry. The answer here is structural, so the video shows the
absence rather than asserting the guarantee.
"""
import os
from PIL import Image, ImageDraw
from kit import *

W = H = 1080
FPS, BAR = 30, 2.0
DUR = BAR * 8
NFRAMES = int(DUR * FPS)
OUT = 'frames6'
GROUND = ground(W, H)

def chrome(im, d):
    logomark(im, 96, 92, 54)
    d.text((142, 72), 'TSUKIPAD', font=sg(34), fill=INK)

def strike(d, cx, y, w, frac, col=PINK, th=8):
    if frac <= 0: return
    d.rectangle([cx - w/2, y - th/2, cx - w/2 + w * clamp(frac), y + th/2], fill=col)

def s_question(im, d, t):                               # bar 0
    logomark(im, W/2, H/2 - 200, 170, draw_frac=clamp(t / 0.7))
    if t > 0.4:
        k = out_back((t - 0.4) / 0.5)
        ctext(d, W/2, H/2 + 40, 'WILL IT RUG?', sg(int(110 * (0.88 + 0.12 * k))), fill=INK, mid=True)
    if t > 1.0:
        ctext(d, W/2, H/2 + 170, 'the only question that matters', jbr(30),
              fill=mix(VOID, MUTED, out_expo((t - 1.0) / 0.6)), mid=True)

def s_claim(im, d, t):                                  # bar 1
    chrome(im, d)
    ctext(d, W/2, 300, 'EVERY LAUNCHPAD SAYS', jbr(30), fill=MUTED, mid=True)
    k = out_back(clamp(t / 0.5))
    f = sg(int(92 * (0.88 + 0.12 * k)))
    ctext(d, W/2, 430, 'LIQUIDITY', f, fill=INK, mid=True)
    ctext(d, W/2, 540, 'LOCKED', f, fill=INK, mid=True)
    if t > 0.9:
        a = out_expo((t - 0.9) / 0.6)
        ctext(d, W/2, 700, 'and you are supposed to take that on faith', jbr(28),
              fill=mix(VOID, FAINT, a), mid=True)

def s_problem(im, d, t):                                # bar 2
    chrome(im, d)
    ctext(d, W/2, 300, 'EVERY LAUNCHPAD SAYS', jbr(30), fill=(48, 48, 58), mid=True)
    f = sg(92)
    ctext(d, W/2, 430, 'LIQUIDITY', f, fill=MUTED, mid=True)
    ctext(d, W/2, 540, 'LOCKED', f, fill=MUTED, mid=True)
    w = tsize(d, 'LIQUIDITY', f)[0]
    strike(d, W/2, 478, w + 60, t / 0.35)
    strike(d, W/2, 588, w + 60, (t - 0.18) / 0.35)

    rows = ['a lock has a key', 'a lock has an expiry', 'somebody still holds it']
    for i, line in enumerate(rows):
        st = t - 0.55 - i * 0.28
        if st < 0: continue
        a = out_expo(st / 0.4)
        ctext(d, W/2, 700 + i * 54, line, jbr(32), fill=mix(VOID, PINK, a), mid=True)

def s_answer(im, d, t):                                 # bar 3 -- the payoff
    chrome(im, d)
    k = out_back(clamp(t / 0.45))
    ctext(d, W/2, 300, 'SO WE DID NOT LOCK IT', jbr(32), fill=MUTED, mid=True)
    ctext(d, W/2, 430, 'THERE IS NO', sg(int(104 * (0.85 + 0.15 * k))), fill=LIME, mid=True)
    ctext(d, W/2, 545, 'FUNCTION', sg(int(104 * (0.85 + 0.15 * k))), fill=LIME, mid=True)

    if t > 0.6:
        a = out_expo((t - 0.6) / 0.5)
        bw, bh = 760, 96
        brut(d, [W/2 - bw/2, 700, W/2 + bw/2, 700 + bh], fill=VOID, border=LIME, off=8)
        ctext(d, W/2, 700 + bh/2, 'nothing on-chain can withdraw it', jb(32),
              fill=mix(VOID, LIME, a), mid=True)
    if t > 1.2:
        ctext(d, W/2, 860, 'not the creator. not us. not anyone.', jbr(28),
              fill=mix(VOID, MUTED, out_expo((t - 1.2) / 0.5)), mid=True)

def s_quote(im, d, t):                                  # bar 4
    chrome(im, d)
    ctext(d, W/2, 280, 'FROM THE CONTRACT ITSELF', jbr(28), fill=FAINT, mid=True)
    bw = W - 160
    brut(d, [80, 350, 80 + bw, 720], fill=SURFACE, border=LINE, off=8)
    lines = [
        'The principal is not locked by',
        'policy or by a timelock that',
        'someone can let lapse; there is',
        'simply no function that can',
        'withdraw it.',
    ]
    for i, ln in enumerate(lines):
        st = t - 0.15 - i * 0.14
        if st < 0: continue
        col = LIME if i >= 2 else MUTED
        d.text((124, 392 + i * 62), ln, font=jbr(34), fill=mix(VOID, col, out_expo(st / 0.35)))
    if t > 1.3:
        ctext(d, W/2, 800, 'liquidity is not held back — it is unreachable', jbr(28),
              fill=mix(VOID, MUTED, out_expo((t - 1.3) / 0.5)), mid=True)

FACTS = [('NO MINT', 'supply is fixed forever', CYAN),
         ('NO OWNER', 'the token has no admin key', LIME),
         ('NO TAX', 'nothing is skimmed from transfers', PINK)]
def s_facts(im, d, t):                                  # bar 5
    chrome(im, d)
    ctext(d, W/2, 280, 'AND THE TOKEN ITSELF', jbr(30), fill=MUTED, mid=True)
    for i, (head, body, col) in enumerate(FACTS):
        st = t - i * 0.28
        if st < 0: continue
        a = out_back(clamp(st / 0.5))
        dy = int((1 - out_expo(st / 0.45)) * 50)
        y = 380 + i * 165 + dy
        brut(d, [90, y, W - 90, y + 132], fill=SURFACE, border=col, off=int(8 * a))
        d.rectangle([90, y, W - 90, y + 7], fill=col)
        d.text((130, y + 32), head, font=sg(48), fill=col)
        d.text((130, y + 88), body, font=jbr(27), fill=MUTED)

def s_verify(im, d, t):                                 # bar 6
    chrome(im, d)
    k = out_back(clamp(t / 0.45))
    ctext(d, W/2, 350, "DON'T TRUST US.", sg(int(88 * (0.88 + 0.12 * k))), fill=INK, mid=True)
    ctext(d, W/2, 460, 'READ IT.', sg(int(88 * (0.88 + 0.12 * k))), fill=LIME, mid=True)
    if t > 0.5:
        a = out_expo((t - 0.5) / 0.5)
        bw, bh = W - 180, 92
        brut(d, [90, 600, 90 + bw, 600 + bh], fill=VOID, border=LINEBR, off=8)
        ctext(d, 90 + bw/2, 600 + bh/2, 'github.com/tsukipadofficial', jb(32),
              fill=mix(VOID, INK, a), mid=True)
    if t > 1.0:
        ctext(d, W/2, 760, 'the contracts are public. so are the tests.', jbr(28),
              fill=mix(VOID, MUTED, out_expo((t - 1.0) / 0.5)), mid=True)

def s_cta(im, d, t):                                    # bar 7
    logomark(im, W/2, H/2 - 250, 140)
    f = sg(86)
    tot = d.textlength('TSUKI', font=f) + d.textlength('PAD', font=f)
    x = W/2 - tot/2 - 30
    d.text((x, H/2 - 130), 'TSUKI', font=f, fill=INK)
    d.text((x + d.textlength('TSUKI', font=f), H/2 - 130), 'PAD', font=f, fill=LIME)
    d.text((x + tot + 20, H/2 - 118), '月', font=JP(56), fill=LIMEDIM)
    if t > 0.2:
        ctext(d, W/2, H/2 + 20, 'tsukipad.com', sg(74), fill=INK, mid=True)
    if t > 0.45:
        ctext(d, W/2, H/2 + 130, '@tsukipad_', jb(38), fill=LIME, mid=True)
    if t > 0.65:
        ctext(d, W/2, H - 150, 'BUILT ON ARC NETWORK', jbr(26), fill=MUTED, mid=True)
        ctext(d, W/2, H - 104, TRADEMARK[0], jbr(19), fill=(78, 78, 90), mid=True)
        ctext(d, W/2, H - 76, TRADEMARK[1], jbr(19), fill=(78, 78, 90), mid=True)

SCENES = [(0, s_question), (1, s_claim), (2, s_problem), (3, s_answer),
          (4, s_quote), (5, s_facts), (6, s_verify), (7, s_cta)]

def render(t):
    im = GROUND.copy(); d = ImageDraw.Draw(im)
    bar = int(t / BAR); start, fn = SCENES[0]
    for sb, f in SCENES:
        if bar >= sb: start, fn = sb, f
    fn(im, d, t - start * BAR)
    dt = t - 3 * BAR                                    # flash on the answer
    if 0 <= dt < 0.11:
        im = Image.blend(im, Image.new('RGB', (W, H), LIME), 0.38 * (1 - dt / 0.11))
    if t < 0.35:      im = Image.blend(Image.new('RGB', (W, H), VOID), im, out_cubic(t / 0.35))
    if t > DUR - 0.4: im = Image.blend(im, Image.new('RGB', (W, H), VOID), out_cubic((t - (DUR - 0.4)) / 0.4))
    return im

os.makedirs(OUT, exist_ok=True)
for i in range(NFRAMES):
    render(i / FPS).save(f'{OUT}/f{i:04d}.png')
    if i % 120 == 0: print(f'  {i}/{NFRAMES}')
print('frames done:', NFRAMES)
