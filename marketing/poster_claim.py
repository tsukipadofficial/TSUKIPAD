"""Static X card: fees can be earmarked to a social handle and claimed later.

Accuracy note -- Privy accepts six sign-in methods (email, Google, X, GitHub,
Discord, wallet) but only three of those are *claimable identities*
(lib/commitment.ts PROVIDERS = x, github, discord). A launch earmarks fees to a
public handle, and an email or a Google account is not one. The card lists the
three, not the six.
"""
from PIL import ImageDraw
from kit import (SURFACE, LINE, LIME, PINK, CYAN, INK, MUTED, FAINT,
                 sg, sgm, jb, jbr, ground, brut, ctext, tsize, aa_stroke,
                 logomark, TRADEMARK)

W, H = 1600, 900
im = ground(W, H)
d = ImageDraw.Draw(im)

# ---- header -------------------------------------------------------------
logomark(im, 92, 88, 54)
d.text((128, 66), "TSUKIPAD", font=sg(36), fill=INK)
lab = "FEE CLAIMS"
w, _, ox, oy = tsize(d, lab, jb(20))
d.text((W - 96 - w - ox, 78 - oy), lab, font=jb(20), fill=FAINT)
d.line([(96, 132), (W - 96, 132)], fill=LINE, width=2)

# ---- headline -----------------------------------------------------------
d.text((96, 190), "NO WALLET.", font=sg(92), fill=LIME)
d.text((96, 294), "STILL GET PAID.", font=sg(92), fill=INK)

d.text((96, 418),
       "A launch can earmark its fees to any X, GitHub or Discord account —",
       font=sgm(29), fill=MUTED)
d.text((96, 458),
       "even one that has never touched crypto. The money waits in escrow",
       font=sgm(29), fill=MUTED)
d.text((96, 498),
       "until that account signs in and proves it's theirs.",
       font=sgm(29), fill=MUTED)

# ---- flow card ----------------------------------------------------------
CX0, CX1, CY0, CY1 = 96, 1504, 566, 782
brut(d, (CX0, CY0, CX1, CY1), fill=SURFACE, border=LINE, bw=2, off=8)

cols = [
    (330,  PINK, "EARMARKED TO",  "@yourhandle",         sg(38)),
    (800,  CYAN, "YOU SIGN IN",   "X · GITHUB · DISCORD", sg(30)),
    (1269, LIME, "ESCROW OPENS",  "USDC, YOURS",          sg(38)),
]
for cx, accent, eyebrow, main, font in cols:
    ctext(d, cx, CY0 + 56, eyebrow, jb(21), accent, mid=True)
    ctext(d, cx, CY0 + 128, main, font, INK, mid=True)

# Arrows between the columns. Drawn as strokes rather than a glyph so the
# chevron matches the brand's square caps instead of the font's.
for ax in (566, 1036):
    ay = CY0 + 108
    aa_stroke(im, [(ax - 26, ay), (ax + 22, ay)], 5, FAINT)
    aa_stroke(im, [(ax + 6, ay - 15), (ax + 23, ay), (ax + 6, ay + 15)], 5, FAINT)

# ---- footer -------------------------------------------------------------
ctext(d, W / 2, 824, "tsukipad.com/claim", jb(26), FAINT)
ctext(d, W / 2, 862, TRADEMARK[0], jbr(14), (58, 58, 68))
ctext(d, W / 2, 882, TRADEMARK[1], jbr(14), (58, 58, 68))

im.save("tsukipad-claim.png")
print("wrote tsukipad-claim.png", im.size)
