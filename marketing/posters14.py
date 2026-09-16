"""Three stills for the week Arc mainnet opened. 1080x1080, square for X.

Not frames pulled from a video: each one is built to be read on its own, so the
type is heavier, the JP line carries the same claim as the EN line rather than
decorating it, and nothing depends on motion to make sense.

  1. mainnet   -- Arc is live, the moon is up
  2. tax       -- the thing no v3 pad can do: a tax that survives graduation
  3. twoways   -- curve or direct, the choice the create page opens with

Every number here is what the deployed contracts enforce: 1% pool fee, 10% tax
ceiling, 70/30 split, $52K graduation.

  python posters14.py            # writes marketing/tsukipad-poster-*.png
"""
from motion import *
from motion import _vignette, _grain  # underscored, so not re-exported by *

OUT = "tsukipad-poster-%s.png"


def base():
    return ground(W, H)


def chrome(im, tag):
    """Wordmark top-left, one tag top-right. Same on all three."""
    logomark(im, 88, 88, 46)
    text(im, "TSUKIPAD", SG, 30, 128, 88, anchor="l")
    text(im, tag, JB, 28, W - 80, 88, fill=LIME, anchor="r")


def rule(im, y, x0=80, x1=W - 80, col=LINE):
    ImageDraw.Draw(im).rectangle([x0, y, x1, y + 2], fill=col)


def finish_still(im):
    """The film grain and vignette the motion pieces use, minus the fades."""
    im = ImageChops.multiply(im, _vignette())
    return ImageChops.add(im, _grain()[0], 1.0, -9)


# --------------------------------------------------------------- 1. mainnet
def poster_mainnet():
    im = base()
    chrome(im, "09.16.2026")

    # A full moon, low and large, with the horizon cutting under it.
    disc(im, W / 2, 470, 250, LIME)
    ImageDraw.Draw(im).rectangle([80, 700, W - 80, 702], fill=LINEBR)

    text(im, "ARC MAINNET", JBR, 26, W / 2, 200, fill=MUTED, track=10)
    text(im, "IS LIVE.", DELA, fit("IS LIVE.", DELA, 880, 190), W / 2, 830)
    text(im, "メインネット、始動。", MINCHO, 52, W / 2, 950, fill=MUTED)

    rule(im, 1000)
    text(im, "tsukipad.com", SG, 34, W / 2, 1035, fill=LIME)
    return finish_still(im)


# ------------------------------------------------------------------- 2. tax
def poster_tax():
    im = base()
    chrome(im, "CREATOR TAX")

    text(im, "10%", DELA, 300, 80, 300, fill=LIME, anchor="l")
    text(im, "ON BUYS.", DELA, 96, 80, 470, anchor="l")
    text(im, "ON SELLS.", DELA, 96, 80, 580, anchor="l", outline=3)
    text(im, "FOREVER.", DELA, 96, 80, 690, anchor="l", fill=PINK)

    rule(im, 780)

    # The claim, then the mechanism in small type under it.
    text(im, "買いにも、売りにも。卒業後もずっと。", MINCHO, 44, 80, 840, anchor="l", fill=INK)
    for i, line in enumerate(
        (
            "A Uniswap v4 hook charges it inside the pool, so the",
            "rate does not change the day a launch graduates.",
        )
    ):
        text(im, line, JBR, 26, 80, 915 + i * 37, anchor="l", fill=MUTED)

    hanko(im, W - 140, 620, 160, "税")
    rule(im, 1010)
    text(im, "tsukipad.com", SG, 30, 80, 1042, anchor="l", fill=LIME)
    text(im, "BUILT ON ARC", JBR, 24, W - 80, 1042, anchor="r", fill=MUTED, track=3)
    return finish_still(im)


# --------------------------------------------------------------- 3. two ways
def poster_twoways():
    im = base()
    chrome(im, "TWO WAYS")

    text(im, "CURVE", DELA, 110, W / 2, 210, fill=LIME)
    text(im, "OR DIRECT.", DELA, 110, W / 2, 330)

    d = ImageDraw.Draw(im)

    # Left panel: the bonding curve, drawn as the create page draws it.
    d.rectangle([80, 440, 520, 830], fill=SURFACE, outline=LINE, width=3)
    pts = curve_pts(130, 770, 470, 520)
    aa_stroke(im, pts, 9, LIME)
    disc(im, pts[-1][0], pts[-1][1], 13, PINK)
    text(im, "$52K", JB, 30, 460, 480, anchor="r")
    text(im, "graduates into a", JBR, 24, 300, 870, fill=MUTED)
    text(im, "locked pool", JBR, 24, 300, 905, fill=MUTED)

    # Right panel: straight into the pool, full height from the first block.
    d.rectangle([560, 440, 1000, 830], fill=SURFACE, outline=LINE, width=3)
    d.rectangle([610, 560, 950, 770], fill=CYAN)
    text(im, "POOL", JB, 30, 780, 520)
    text(im, "tradeable from", JBR, 24, 780, 870, fill=MUTED)
    text(im, "block one", JBR, 24, 780, 905, fill=MUTED)

    rule(im, 940)
    text(im, "選ぶのは、あなた。", MINCHO, 46, W / 2, 990, fill=INK)
    text(im, "tsukipad.com", SG, 30, W / 2, 1045, fill=LIME)
    return finish_still(im)


if __name__ == "__main__":
    for name, fn in (("mainnet", poster_mainnet), ("tax", poster_tax), ("twoways", poster_twoways)):
        path = OUT % name
        fn().save(path)
        print("wrote", path)
