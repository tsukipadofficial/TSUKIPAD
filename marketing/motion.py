"""Kinetic-type toolkit for the TSUKIPAD motion pieces (render10 onwards).

kit.py holds the brand tokens; this adds what typography-led pieces need:
cached text layers, per-letter mask reveals, vertical Japanese columns,
marquees, a camera that punches on drum hits, and a parallel frame runner.

Text layers are built as a solid colour plus an alpha mask rather than drawn
onto a transparent RGBA canvas, so antialiased edges never pick up a dark
fringe when they land on a lime or pink ground.
"""
import os, sys, math, subprocess
from functools import lru_cache
from multiprocessing import get_context
from PIL import Image, ImageDraw, ImageFont, ImageChops
from kit import *

W = H = 1080
FPS = 30
DELA = 'fonts/DelaGothicOne-Regular.ttf'          # heavy JP/EN display
MINCHO = 'fonts/ShipporiMinchoB1-ExtraBold.ttf'   # brush-serif JP
SG, SGM = F + 'sg-bold.ttf', F + 'sg-med.ttf'
JB, JBR = F + 'jb-bold.ttf', F + 'jb-reg.ttf'

@lru_cache(maxsize=None)
def font(path, size): return ImageFont.truetype(path, max(4, int(size)))

def _solid(mask, fill):
    lay = Image.new('RGBA', mask.size, tuple(fill) + (0,)); lay.putalpha(mask); return lay

@lru_cache(maxsize=4096)
def word(s, path, size, fill=INK, outline=0, track=0):
    """Tight RGBA layer for a string. outline>0 draws a hollow stroke."""
    f = font(path, size); size = int(size)
    xs, x = [], 0.0
    for ch in s:
        xs.append(x); x += f.getlength(ch) + track
    wd = int(x + size * 1.2 + outline * 2); ht = int(size * 2.0 + outline * 2)
    ox, oy = size * 0.4 + outline, size * 0.4 + outline

    def draw(stroke):
        m = Image.new('L', (wd, ht), 0); d = ImageDraw.Draw(m)
        if track:
            for ch, cx in zip(s, xs): d.text((ox + cx, oy), ch, font=f, fill=255, stroke_width=stroke, stroke_fill=255)
        else:
            d.text((ox, oy), s, font=f, fill=255, stroke_width=stroke, stroke_fill=255)
        return m
    mask = draw(0)
    if outline:
        mask = ImageChops.subtract(draw(outline), mask)
    bb = mask.getbbox()
    if not bb: return None
    return _solid(mask.crop(bb), fill)

@lru_cache(maxsize=512)
def fit(s, path, maxw, maxsize, track=0):
    """Largest size (<= maxsize) at which s is at most maxw wide."""
    lo, hi = 8, int(maxsize)
    while lo < hi:
        mid = (lo + hi + 1) // 2
        lay = word(s, path, mid, INK, 0, track)
        if lay is not None and lay.width <= maxw: lo = mid
        else: hi = mid - 1
    return lo

def with_alpha(lay, a):
    if a >= 0.999: return lay
    lay = lay.copy(); lay.putalpha(lay.getchannel('A').point(lambda v: int(v * a))); return lay

def place(im, lay, x, y, scale=1.0, rot=0.0, alpha=1.0, anchor='c'):
    """anchor: 'c' centre, 'l' left-middle, 'r' right-middle, 'lt' left-top, 't' top-centre."""
    if lay is None or alpha <= 0.004 or scale <= 0.01: return None
    if abs(scale - 1) > 1e-3:
        lay = lay.resize((max(1, round(lay.width * scale)), max(1, round(lay.height * scale))), Image.BICUBIC)
    if rot: lay = lay.rotate(rot, Image.BICUBIC, expand=True)
    lay = with_alpha(lay, alpha)
    w, h = lay.size
    px = x - w / 2 if anchor in ('c', 't') else (x if anchor in ('l', 'lt') else x - w)
    py = y - h / 2 if anchor in ('c', 'l', 'r') else y
    im.paste(lay, (round(px), round(py)), lay)
    return (px, py, px + w, py + h)

def text(im, s, path, size, x, y, fill=INK, **kw):
    outline = kw.pop('outline', 0); track = kw.pop('track', 0)
    return place(im, word(s, path, int(size), tuple(fill), outline, track), x, y, **kw)

# ------------------------------------------------------------ reveals
def rise(im, s, path, size, x, base, t, fill=INK, stagger=0.035, dur=0.5, out=None,
         anchor='l', track=0, outline=0):
    """Letters rise into a clipped band, one after another -- the house reveal.
    `out` (seconds into the exit) sends them up and out the top of the band."""
    f = font(path, size); size = int(size); asc, desc = f.getmetrics()
    xs, xx = [], 0.0
    for ch in s:
        xs.append(xx); xx += f.getlength(ch) + track
    total = xx - track
    padt, padb = int(size * 0.12), int(size * 0.12)
    bh = asc + desc + padt + padb; pad = outline + 4
    fill_m = Image.new('L', (int(total + pad * 2), bh), 0); dm = ImageDraw.Draw(fill_m)
    stroke_m = Image.new('L', fill_m.size, 0) if outline else None
    ds = ImageDraw.Draw(stroke_m) if outline else None
    any_ink = False
    for i, ch in enumerate(s):
        p = out_expo((t - i * stagger) / dur)
        if p <= 0 or ch == ' ': continue
        dy = (1 - p) * bh
        if out is not None:
            dy -= in_cubic((out - i * stagger * 0.5) / 0.32) * bh
        if abs(dy) >= bh: continue
        any_ink = True
        dm.text((pad + xs[i], padt + dy), ch, font=f, fill=255)
        if outline: ds.text((pad + xs[i], padt + dy), ch, font=f, fill=255, stroke_width=outline, stroke_fill=255)
    if not any_ink: return
    mask = ImageChops.subtract(stroke_m, fill_m) if outline else fill_m
    lay = _solid(mask, fill)
    top = base - asc - padt
    px = x - pad if anchor == 'l' else (x - lay.width / 2 if anchor == 'c' else x - lay.width + pad)
    im.paste(lay, (round(px), round(top)), lay)

SMALL_KANA = set('ァィゥェォッャュョヮっゃゅょぁぃぅぇぉ')
ROTATE_V = set('ー〜～…')
PUNCT_V = set('、。')

def vcol(im, s, path, size, x, top, t, fill=INK, stagger=0.06, dur=0.4, step=1.04, out=None):
    """Vertical Japanese column (tategaki), characters dropping in one by one.
    Long-vowel marks turn 90 degrees and small kana sit high-right, as they do
    in print."""
    y = top
    for i, ch in enumerate(s):
        p = out_expo((t - i * stagger) / dur)
        a = p if out is None else p * (1 - out_cubic((out - i * stagger * 0.4) / 0.3))
        if a > 0.004:
            lay = word(ch, path, int(size), tuple(fill))
            if ch in ROTATE_V: lay = lay.rotate(-90, Image.BICUBIC, expand=True)
            dx = dy = 0
            if ch in SMALL_KANA: dx, dy = size * 0.10, -size * 0.10
            if ch in PUNCT_V: dx, dy = size * 0.30, -size * 0.30
            place(im, lay, x + dx, y + size / 2 + dy - (1 - p) * size * 0.35, alpha=a)
        y += size * step

def marquee(im, s, path, size, y, offset, fill=INK, outline=0, gap=60):
    lay = word(s, path, int(size), tuple(fill), outline)
    if lay is None: return
    period = lay.width + gap
    x = -(offset % period)
    while x < W:
        im.paste(lay, (round(x), round(y - lay.height / 2)), lay); x += period

# ------------------------------------------------------------- shapes
@lru_cache(maxsize=256)
def disc_layer(r, fill):
    r = max(1, int(r)); ss = 4; d = r * 2 * ss + 4
    m = Image.new('L', (d, d), 0); ImageDraw.Draw(m).ellipse([2, 2, d - 2, d - 2], fill=255)
    return _solid(m.resize((r * 2 + 1, r * 2 + 1), Image.LANCZOS), fill)

def disc(im, cx, cy, r, fill=LIME, clip_bottom=None, alpha=1.0):
    lay = disc_layer(int(r), tuple(fill))
    x0, y0 = round(cx - lay.width / 2), round(cy - lay.height / 2)
    if clip_bottom is not None:
        keep = int(clip_bottom - y0)
        if keep <= 0: return
        lay = lay.crop((0, 0, lay.width, min(lay.height, keep)))
    lay = with_alpha(lay, alpha)
    im.paste(lay, (x0, y0), lay)

@lru_cache(maxsize=64)
def hanko_layer(size, ch):
    """The seal. The logo's pink square, carrying a kanji knocked out of it."""
    s = int(size); ss = 3; S = s * ss
    m = Image.new('L', (S, S), 255); d = ImageDraw.Draw(m)
    inset = int(S * 0.08)
    d.rectangle([inset, inset, S - inset, S - inset], outline=0, width=max(2, int(S * 0.025)))
    f = font(MINCHO, int(S * 0.64)); bb = d.textbbox((0, 0), ch, font=f)
    d.text(((S - (bb[2] - bb[0])) / 2 - bb[0], (S - (bb[3] - bb[1])) / 2 - bb[1]), ch, font=f, fill=0)
    return _solid(m.resize((s, s), Image.LANCZOS), PINK)

def hanko(im, cx, cy, size, ch='月', t=1.0, rot=-6):
    """Stamps down: arrives large, lands with a little overshoot."""
    if t <= 0: return
    k = out_back(clamp(t / 0.28), 2.2)
    sc = 1.8 - 0.8 * k
    place(im, hanko_layer(int(size), ch), cx, cy, scale=sc, rot=rot, alpha=clamp(t / 0.08))

# ------------------------------------------------------------- camera
def punch(t, hits, decay=16.0, window=0.45):
    """0..1 envelope that spikes at each hit time and decays."""
    v = 0.0
    for h in hits:
        dt = t - h
        if 0 <= dt < window: v = max(v, math.exp(-dt * decay))
    return v

def camera(im, zoom=1.0, dx=0.0, dy=0.0):
    if abs(zoom - 1) < 1e-4 and abs(dx) < 0.3 and abs(dy) < 0.3: return im
    a = 1 / zoom
    return im.transform((W, H), Image.AFFINE, (a, 0, W / 2 - a * (W / 2 + dx), 0, a, H / 2 - a * (H / 2 + dy)),
                        Image.BILINEAR, fillcolor=VOID)

def shake(t, hits, amp=14.0):
    k = punch(t, hits, decay=20.0, window=0.3)
    return (amp * k * math.sin(t * 91.0), amp * k * math.cos(t * 73.0))

@lru_cache(maxsize=1)
def _grain():
    import random
    rnd = random.Random(5); frames = []
    for i in range(6):
        g = Image.effect_noise((W // 2, H // 2), 22).resize((W, H), Image.NEAREST)
        g = g.point(lambda v: max(0, min(18, (v - 128) // 6 + 9)))
        frames.append(Image.merge('RGB', (g, g, g)))
    return frames

@lru_cache(maxsize=1)
def _vignette():
    v = Image.radial_gradient('L').resize((W, H), Image.BICUBIC)
    v = v.point(lambda p: int(255 - max(0, p - 150) * 1.1))
    return Image.merge('RGB', (v, v, v))

def finish(im, t, dur, fade_in=0.3, fade_out=0.45):
    im = ImageChops.multiply(im, _vignette())
    im = ImageChops.add(im, _grain()[int(t * FPS) % 6], 1.0, -9)
    if t < fade_in: im = Image.blend(Image.new('RGB', (W, H), VOID), im, out_cubic(t / fade_in))
    if t > dur - fade_out: im = Image.blend(im, Image.new('RGB', (W, H), VOID), out_cubic((t - (dur - fade_out)) / fade_out))
    return im

def cta(im, t, extra=None):
    """Shared end card: seal, wordmark, handle, attribution."""
    hanko(im, W / 2, 330, 190, '月', t)
    if t > 0.18:
        rise(im, 'TSUKIPAD', DELA, 104, W / 2, 590, t - 0.18, fill=INK, anchor='c', stagger=0.03)
    if t > 0.42:
        rise(im, 'tsukipad.com', SG, 52, W / 2, 690, t - 0.42, fill=INK, anchor='c', stagger=0.015)
    if t > 0.55:
        rise(im, '@tsukipad_', JB, 36, W / 2, 762, t - 0.55, fill=LIME, anchor='c', stagger=0.015)
    if extra and t > 0.65:
        text(im, extra, JBR, 26, W / 2, 836, fill=mix(VOID, INK, out_expo((t - 0.65) / 0.5)))
    if t > 0.75:
        a = out_expo((t - 0.75) / 0.5)
        text(im, 'BUILT ON ARC NETWORK', JBR, 24, W / 2, H - 150, fill=mix(VOID, MUTED, a), track=3)
        text(im, TRADEMARK[0], JBR, 18, W / 2, H - 106, fill=mix(VOID, (78, 78, 90), a))
        text(im, TRADEMARK[1], JBR, 18, W / 2, H - 80, fill=mix(VOID, (78, 78, 90), a))

# ------------------------------------------------------------- runner
_JOB = {}
def _frame(i):
    _JOB['render'](i / FPS).save(f"{_JOB['out']}/f{i:04d}.png"); return i

def run(render, dur, out, audio, mp4, poster_t=None, poster=None, stills_dir=None):
    """`python renderNN.py --at 1.2 6.05` writes stills instead of the video."""
    if len(sys.argv) > 2 and sys.argv[1] == '--at':
        d = stills_dir or os.environ.get('STILLS', '.')
        for s in sys.argv[2:]:
            p = f'{d}/{os.path.splitext(mp4)[0]}_{s}.png'; render(float(s)).save(p); print(p)
        return
    os.makedirs(out, exist_ok=True)
    for f in os.listdir(out):
        if f.endswith('.png'): os.remove(os.path.join(out, f))
    n = int(round(dur * FPS)); _JOB.update(render=render, out=out)
    with get_context('fork').Pool(os.cpu_count()) as pool:
        for k, _ in enumerate(pool.imap_unordered(_frame, range(n), chunksize=6)):
            if k % 120 == 0: print(f'  {k}/{n}', flush=True)
    subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-framerate', str(FPS), '-i', f'{out}/f%04d.png',
                    '-i', audio, '-c:v', 'libx264', '-preset', 'slow', '-crf', '17', '-pix_fmt', 'yuv420p',
                    '-c:a', 'aac', '-b:a', '192k', '-shortest', '-movflags', '+faststart', mp4], check=True)
    if poster:
        render(poster_t).save(poster)
    print('wrote', mp4)
