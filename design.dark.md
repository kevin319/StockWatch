# GoodWallet Design System — Dark (War-Room) Variant

The dark companion to `design.md`. Same skeleton — system font, hairline structure, tile gradients, conic signature — but inverted for **always-on big-screen / TV display** in low-light rooms. Use this for dashboards, war-room screens, control panels, and any surface that stays lit and is read from a distance. For interactive product UI (phones, web app), use the light `design.md`.

The emotional contract shifts from "calm and trustworthy" (light) to **"alert, premium, in-command"** (dark). The screen is a black field; data glows on it.

---

## 1. Visual Theme & Atmosphere

A pure black stage (`#000`) holds near-black cards (`#0e0e10`) that lift off the background by the faintest inner hairline, not by shadow. One card per screen earns a **signature treatment**: true black with a conic-gradient border halo and a soft colored bloom — this is where the eye lands first. Everything else stays quiet and monochrome so the single highlighted KPI and the colored data bars carry all the energy.

Numbers are huge and tabular. Charts use the same purple→pink→orange ramp as the light system, which reads vividly against black. Color is functional only: gradient tiles classify, status colors flag, the conic halo anoints the hero.

Two depth layers only:
- **Stage** — `#000`, the room behind the glass.
- **Card** — `#0e0e10` with `inset 0 0 0 0.5px rgba(255,255,255,0.06)`. The signature card drops to `#000` and gains the halo.

**Key characteristics:**
- Pure-black stage; `#0e0e10` cards; 24 px radius.
- Structure from inner white hairlines (`rgba(255,255,255,0.06)`), never heavy shadow.
- Exactly ONE signature card per screen (conic border + bloom). Never two.
- Big tabular numbers (up to 104 px) in white; labels dim white.
- Data gradients (purple→pink→orange) + system status colors are the only chroma.
- Fixed 1920×1080 canvas, JS-scaled to fit any TV, letterboxed on black.

---

## 2. Color Palette & Roles

### Surface
| Token | Value | Use |
|---|---|---|
| `surface/stage` | `#000000` | Page / letterbox background |
| `surface/card` | `#0e0e10` | Standard cards |
| `surface/topbar` | `#0b0b0d` | Top status bar |
| `surface/signature` | `#000000` | The one hero card (+ halo) |
| `surface/well` | `rgba(255,255,255,0.05)` | Inset stat chips, tracks |

### Text (on dark)
| Token | Value | Use |
|---|---|---|
| `text/primary` | `#ffffff` | Titles, big numbers |
| `text/secondary` | `rgba(255,255,255,0.55)` | Labels, captions, units |
| `text/tertiary` | `rgba(255,255,255,0.4)` | Footnotes, axis ticks |
| `text/hairline` | `rgba(255,255,255,0.06–0.10)` | Borders, dividers, tracks |

### Status (tuned brighter for dark)
| Token | Value | Use |
|---|---|---|
| `status/positive` | fill `rgba(52,199,89,0.18)` · text `#9af2b6` | Up / on-track pills |
| `status/negative` | fill `rgba(255,59,48,0.18)` · text `#ffb3ad` | Down / breach pills |
| `status/warning` | fill `rgba(255,149,0,0.18)` · text `#ffd494` | Caution / overheat pills |
| `status/brand` | fill `rgba(255,255,255,0.10)` · text `#fff` | Neutral info pill |
| `accent/blue` | `#5aa9ff` | Progress fills, solid bars (brighter than the light `#0071e3` for contrast on black) |

Raw signal colors for chart series & dots: positive `#34c759`, the light-system `--brand #0071e3` only for off-black contexts — on black use `#5aa9ff`.

### Tile gradients (unchanged from light)
160° linear, white glyph inside. `blue #4fa3ff→#0066ff` · `orange #ffb84d→#ff8800` · `purple #b68cff→#7a4bff` · `pink #ff80b3→#ff3380` · `green #5de08e→#1fb053` · `gold #ffd97a→#e0a030`. Categorical, never decorative.

### Signature elements
- **Conic halo (border):** `conic-gradient(from 200deg at 50% 50%, #ffd17a 0deg, #ff89b5 70deg, #b78dff 150deg, #7de0ff 230deg, #ffea8d 310deg, #ffd17a 360deg)` rendered as a 1.5 px ring via mask-composite.
- **Bloom (glow):** layered `radial-gradient(60% 50% at 0% 0%, rgba(255,137,181,0.10), transparent 65%)` + `radial-gradient(60% 60% at 100% 100%, rgba(125,224,255,0.08), transparent 60%)` plus drop `0 18px 50px rgba(183,141,255,0.18), 0 0 60px rgba(255,137,181,0.10)`.
- **Brand mark / hero tile:** the conic fill from `design.md` (`from 200deg at 55% 42%`).

### Chart gradient
`linear-gradient(180deg, #b68cff 0%, #ff80b3 55%, #ffb84d 100%)`. Active/highlight bars full; historical/context bars `filter:saturate(0.35); opacity:0.55`. Solid single-series bars use `#5aa9ff`.

---

## 3. Typography

Identical stack & scale to `design.md` — only colors invert.
```
-apple-system, "SF Pro Display", "SF Pro Text", system-ui, "PingFang TC", sans-serif
```
All numerics: `font-variant-numeric: tabular-nums`.

| Role | Size | Weight | Tracking | Color |
|---|---|---|---|---|
| Hero number | 104 | 700 | -3.4px | `#fff` |
| Donut center | 56 | 700 | -1.6px | `#fff` |
| Card title | 22 (sig. 24) | 700 | -0.6px | `#fff` |
| Brand / clock | 22 | 700 | -0.6px | `#fff` |
| Split stat value | 22 | 700 | -0.6px | `#fff` |
| Body / sub | 13–14 | 400–500 | -0.08px | `rgba(255,255,255,0.55)` |
| Eyebrow (uppercase) | 11 | 600 | +1.6px | `rgba(255,255,255,0.55)` |
| Axis tick / footnote | 11–12 | 500 | -0.04px | `rgba(255,255,255,0.4–0.7)` |
| Unit suffix (MM/%/u) | 12–30 | 500–600 | — | `rgba(255,255,255,0.55)` |

**Currency / unit rule:** `NT$` and `MM` / `%` render at `text/secondary`, 25–30 % of the number's size; the figure stays full-size white.
**Big-screen legibility:** axis ticks never below 12 px; nothing critical below 11 px (this is read across a room, not held in hand).

---

## 4. Components

### Card
`background:#0e0e10; border-radius:24px; padding:30px 34px; box-shadow:0 1px 2px rgba(0,0,0,0.6), inset 0 0 0 0.5px rgba(255,255,255,0.06);` flex column, `overflow:hidden`, `position:relative`.

### Signature card (one per screen)
Add `background:#000`, the conic `::before` ring, the bloom `::after`, and the drop-glow shadow above. Bump its title to 24 px. Reserve for the single most important metric (e.g. the headline alert, the north-star KPI). All inner content must sit at `position:relative; z-index:1` so it renders above the pseudo-element layers.

### Top bar
`height:72px; background:#0b0b0d; border-bottom:0.5px solid rgba(255,255,255,0.08)`. Left: conic brand mark (40 px, r 11) + name (`#fff`) / sub (dim). Right: a live "同步中" indicator with a pulsing `#34c759` dot, plus a tabular clock + date.

### Live dot (status heartbeat)
8 px `#34c759` circle, `@keyframes pulse` expanding box-shadow ring 0→14px over 1.6 s, infinite. Signals "data is live". A red `#ff3b30` variant signals a breach/alert state.

### Pills
`padding:6px 12px; border-radius:980px; font:600 12px; letter-spacing:-0.08px`. Variants: `pos / neg / warn / brand` per the status table. One pill per card head, right-aligned.

### Hero number block
`display:flex; align-items:baseline; gap:10px`. Currency prefix dim → 104 px white figure → dim unit suffix.

### Progress bar
Track `rgba(255,255,255,0.10)`, 8 px, r 5. Fill variants: default `#5aa9ff`, `.gradient` = chart ramp, `.green` = `#34c759`, `.shimmer` = the four-stop pastel. Meta row below in dim white, space-between.

### Split stat chip
`background:rgba(255,255,255,0.05); inset 0 0 0 0.5px rgba(255,255,255,0.06); r 14; padding:14px 16px`. Dim label, white 22 px value, ±delta in status color. Lay out in 2- or 3-col grids.

### Mini bar history
Full-height flex row (`align-items:stretch`), each column = value label (top) + `.mb-track` (flex:1, `min-height:0`, justify-end) + axis tick (bottom). Bars 18 px wide, r 14, chart-ramp fill; context years dim, current year solid `#5aa9ff`. **`.mb-track` must carry `min-height:0`** or percentage bar heights collapse.

### Donut / radial gauge
240 px SVG rotated −90°. Track ring `rgba(255,255,255,0.12)` 22 px; value arc strokes a `linearGradient` of the four pastel stops, `stroke-linecap:round`, `stroke-dasharray` = `arc 660` (circumference at r 105). Centered value + uppercase dim label absolutely positioned.

### Stacked bar + legend
Stack 18 px, r 10, `background:rgba(255,255,255,0.08)`, segments = tile gradients. Legend in a 2-col grid: 10 px swatch + white name + white tabular value.

---

## 5. Layout & Spacing

- Fixed **1920×1080** canvas; scale = `min(vw/1920, vh/1080)`, `transform-origin:center`, letterboxed on `#000`.
- Top bar 72 px; body fills the rest.
- Default war-room layout: **2×2 card grid**, `padding:20px 24px 28px`, `gap:18px`.
- Footer mini-strip absolute at `bottom:6px`, dim white, source attribution left / sync countdown right.
- Card inner rhythm: head → 26 px → hero number → 22 px → progress → 22 px → splits → `margin-top:auto` pushes the history chart to the card floor.

### Radius
8 (chips) · 10 (stack) · 14 (split / tile / progress-end) · 24 (cards) · 980 (pills) · 50% (dots / donut).

---

## 6. Motion

- Live dot pulse: expanding ring, 1.6 s, infinite (the only persistent loop allowed — it means "live").
- Bar / arc grow on load: height/​dash 600 ms `cubic-bezier(.2,.9,.25,1)`.
- Signature bloom may breathe very slowly (opacity 0.85↔1, 6 s) — optional, off by default; never animate hue.
- No spinners, no bounce, no marquee. A war-room screen is calm even while alert.

---

## 7. Do's & Don'ts

### Do
- Keep the stage pure black; let data be the only light source.
- Anoint exactly one signature card; make it the thing people should look at first.
- Use `#5aa9ff` (not `#0071e3`) for blue accents on black — it survives the contrast.
- Brighten status pills to the dark table values; the light-mode tints disappear on black.
- Keep axis & tick text ≥ 12 px for across-the-room legibility.
- Carry the same tile-gradient categories as the light system so the two stay siblings.

### Don't
- Don't put two signature/halo cards on one screen — the hierarchy collapses.
- Don't use the light system's dark text tokens (`rgba(60,60,67,…)`) here — everything is white-on-black.
- Don't reach for heavy shadows for elevation; use the inner hairline.
- Don't introduce new chart palettes; reuse purple→pink→orange + status colors.
- Don't drop below 11 px for anything, ever, on a TV surface.
- Don't animate the conic hue or add decorative gradients to the stage.

---

## 8. Quick Reference

```css
:root{
  --stage:#000; --card:#0e0e10; --topbar:#0b0b0d;
  --hair:rgba(255,255,255,0.06); --well:rgba(255,255,255,0.05);
  --tx:#fff; --t2:rgba(255,255,255,0.55); --t3:rgba(255,255,255,0.4);
  --accent:#5aa9ff; --pos:#34c759; --neg:#ff3b30;
  --bar:linear-gradient(180deg,#b68cff 0%,#ff80b3 55%,#ffb84d 100%);
  --conic:conic-gradient(from 200deg at 55% 42%,#ffd17a,#ff89b5,#b78dff,#7de0ff,#ffea8d,#ffd17a);
  --radius-card:24px; --radius-pill:980px;
  --shadow-card:0 1px 2px rgba(0,0,0,0.6), inset 0 0 0 0.5px rgba(255,255,255,0.06);
}
/* signature halo */
.signature{background:#000;box-shadow:0 18px 50px rgba(183,141,255,0.18),0 0 60px rgba(255,137,181,0.10);}
.signature::before{content:"";position:absolute;inset:0;border-radius:24px;padding:1.5px;
  background:conic-gradient(from 200deg at 50% 50%,#ffd17a,#ff89b5,#b78dff,#7de0ff,#ffea8d,#ffd17a);
  -webkit-mask:linear-gradient(#000 0 0) content-box,linear-gradient(#000 0 0);
  -webkit-mask-composite:xor;mask-composite:exclude;pointer-events:none;}
```

Pair this file with `design.md`: same bones, inverted skin. Light for things people hold; dark for things people watch.
