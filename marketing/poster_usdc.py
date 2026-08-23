"""Static X card: creators are paid in USDC, never in their own token.

The one differentiator a fork cannot trivially copy -- Uniswap pays sell-side
fees in the token being sold, so every pad that forwards raw fees hands the
creator their own supply. This piece states the mechanism, not an earnings
figure: no dollar amount on the card is a claim about what anyone made.
"""
from PIL import Image, ImageDraw
from kit import (VOID, SURFACE, LINE, LIME, PINK, CYAN, INK, MUTED, FAINT,
                 sg, sgm, jb, jbr, ground, brut, ctext, tsize, logomark, TRADEMARK)

W, H = 1600, 900
im = ground(W, H)
d = ImageDraw.Draw(im)

# ---- header -------------------------------------------------------------
logomark(im, 92, 88, 54)
d.text((128, 66), "TSUKIPAD", font=sg(36), fill=INK)
lab = "ARC NETWORK"
w, _, ox, oy = tsize(d, lab, jb(20))
d.text((W - 96 - w - ox, 78 - oy), lab, font=jb(20), fill=FAINT)
d.line([(96, 132), (W - 96, 132)], fill=LINE, width=2)

# ---- headline -----------------------------------------------------------
d.text((96, 196), "PAID IN DOLLARS.", font=sg(92), fill=LIME)
d.text((96, 300), "NOT IN YOUR OWN BAGS.", font=sg(92), fill=INK)

# Deliberately makes no claim about what other launchpads do -- the mechanism
# is the differentiator and it is checkable; a competitor claim is neither.
d.text((96, 424),
       "Uniswap pays sell-side fees in the token being sold, so part of your",
       font=sgm(30), fill=MUTED)
d.text((96, 466),
       "revenue arrives as your own supply. We convert it before you're paid.",
       font=sgm(30), fill=MUTED)

# ---- three steps --------------------------------------------------------
BOXW, GAP, BY0, BY1 = 448, 32, 546, 754
steps = [
    ("01", PINK, "SELLERS PAY FEES",  "IN YOUR TOKEN"),
    ("02", CYAN, "TSUKIPAD CONVERTS", "IT ON COLLECT"),
    ("03", LIME, "YOU'RE PAID",       "100% USDC"),
]
for i, (num, accent, l1, l2) in enumerate(steps):
    x0 = 96 + i * (BOXW + GAP)
    brut(d, (x0, BY0, x0 + BOXW, BY1), fill=SURFACE, border=LINE, bw=2, off=8)
    d.rectangle([x0, BY0, x0 + 6, BY1], fill=accent)
    d.text((x0 + 34, BY0 + 30), num, font=jb(26), fill=accent)
    d.text((x0 + 34, BY0 + 86),  l1, font=sg(31), fill=INK)
    d.text((x0 + 34, BY0 + 128), l2, font=sg(31), fill=accent)

# ---- footer -------------------------------------------------------------
ctext(d, W / 2, 806, "tsukipad.com   ·   live on Arc testnet", jb(24), FAINT)
ctext(d, W / 2, 852, TRADEMARK[0], jbr(14), (58, 58, 68))
ctext(d, W / 2, 872, TRADEMARK[1], jbr(14), (58, 58, 68))

im.save("tsukipad-usdc-payout.png")
print("wrote tsukipad-usdc-payout.png", im.size)
