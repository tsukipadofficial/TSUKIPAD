# TSUKIPAD — image prompts for X (Twitter)

Brand facts any prompt must respect (pulled from `web/lib/brand.ts`,
`web/components/Logo.tsx`, `web/app/globals.css`):

| Token | Hex | Role |
|---|---|---|
| void | `#08080a` | background, all strokes |
| lime | `#c8ff2e` | primary / tile face |
| lime-dim | `#93bf1f` | the offset shadow, never a gradient |
| pink | `#ff3d8b` | single accent dot |
| cyan | `#29e5f5` | secondary accent, use sparingly |
| ink | `#f4f4f0` | text |

- Style: **neo-brutalist** — hard offset shadows, thick black outlines, flat
  fills. No gradients, no glow, no bevels, no 3D, no lens flare.
- Typeface: **Space Grotesk** (display), JetBrains Mono (numerals),
  Noto Sans JP (Japanese).
- Wordmark: **TSUKI** in ink white + **PAD** in lime.
- 月 = tsuki = moon. The name is a moon pun; the mark is a price curve.

---

## 1. Profile picture (400×400)

> A flat neo-brutalist app icon on a square canvas. Deep near-black background
> (#08080a). Centred on it, a bright lime-green square tile (#c8ff2e) with a
> thick 2.5px pure-black outline, and a hard-edged offset drop shadow in darker
> lime (#93bf1f) sitting 4px down and 4px right — a solid shape, not a blur.
> Across the tile runs a thick black exponential price curve: flat and low on
> the left, then sweeping steeply upward to the top-right corner, drawn with
> square stroke caps, weight roughly 1/8 of the tile width. A small solid black
> square marks the top-right end of the curve. A small hot-pink square (#ff3d8b)
> marks the bottom-left start. Perfectly flat vector illustration, no gradients,
> no glow, no texture, no 3D, no text. Centred with even margin so it survives a
> circular crop.

**Do this instead if you can:** the mark already exists as vector at
`web/app/icon.svg` — export that to 400×400 PNG and it will be pixel-exact.
An AI approximation will be slightly off-brand.

---

## 2. Banner — option A: "the curve" (recommended, 1500×500)

> A wide neo-brutalist banner, 1500×500. Deep near-black background (#08080a)
> with a faint dark grid of thin #2c2c35 lines. A single thick lime-green
> (#c8ff2e) exponential curve sweeps from the lower-left across to the upper-
> right, flat and shallow at first then rising almost vertically — drawn as a
> bold flat stroke with square caps and a hard offset shadow in darker lime
> (#93bf1f), no blur. Behind the steep end of the curve sits a large flat
> crescent moon in muted lime, partially cropped by the top edge. A few small
> solid squares in hot pink (#ff3d8b) and cyan (#29e5f5) sit along the curve as
> markers. The lower-left eighth of the image is kept empty and dark. Flat
> vector, no gradients, no glow, no 3D, no photorealism, no text anywhere.

**Layout constraints to enforce afterwards:**
- Keep the **bottom-left ~260×260px empty** — the profile picture covers it.
- X crops the top and bottom on mobile; keep anything important in the
  **middle 1500×250 band**.
- Add the wordmark and tagline as **real text in Figma/Canva**, not in the
  image prompt — image models garble lettering.

---

## 3. Banner — option B: "moon over the pool"

> A wide 1500×500 neo-brutalist banner. Deep near-black background (#08080a).
> A large flat lime-green (#c8ff2e) full moon sits right of centre with a hard
> offset shadow in darker lime (#93bf1f), thick pure-black outline, no gradient
> or crater detail — a clean geometric disc. Beneath it, a horizontal band of
> flat black and dark-grey rectangles suggesting a bar chart or order book,
> rising left to right. One bar is hot pink (#ff3d8b), one is cyan (#29e5f5).
> Thin Japanese-style vertical rule marks along the top edge. Entirely flat
> vector illustration, hard edges, no gradients, no glow, no 3D, no text.

---

## 4. Banner — option C: "hanafuda"

> A wide 1500×500 banner in a neo-brutalist reinterpretation of a Japanese
> hanafuda card. Deep near-black ground (#08080a). Three flat rectangular card
> panels with thick black outlines and hard offset shadows in darker lime
> (#93bf1f), evenly spaced across the right two-thirds. Each card carries one
> flat lime (#c8ff2e) motif: a crescent moon, a rising exponential curve, and a
> simple mountain. One card is hot pink (#ff3d8b) instead of lime. The left
> third is empty dark space. Flat vector, hard geometric edges, no gradients, no
> glow, no shading, no text.

---

## Text to overlay yourself (after generating)

Wordmark: **TSUKI**PAD   ← TSUKI in `#f4f4f0`, PAD in `#c8ff2e`, Space Grotesk Bold

Tagline, pick one:
- `Launch tokens on Arc Network. $0 to launch.`
- `Fair launch. Locked liquidity. Zero cost.`
- `月 — launch into a real Uniswap V3 pool for $0`

Footer line: `tsukipad.com`

---

## Sizes cheat sheet

| Asset | Upload size | Notes |
|---|---|---|
| Profile picture | 400×400 (800×800 safer) | cropped to a circle |
| Banner / header | 1500×500 | bottom-left covered by PFP; top/bottom cropped on mobile |
