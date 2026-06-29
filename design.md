# GoodWallet Design System

A design language inspired by Apple Card and Apple Cash, applied to a Taiwanese AI-native wealth-management app. The system favours **calm, dense, high-contrast surfaces** over decoration — every pixel earns its place. The voice is conversational; the visuals stay quiet so the words and numbers can speak.

---

## 1. Visual Theme & Atmosphere

GoodWallet feels like a piece of native Apple software. Page backgrounds are a soft warm gray (`#f5f5f7`). Content lives in **inset white cards** with hairline borders and microscopic shadows. Type is set in SF Pro Display / SF Pro Text with aggressive negative letter-spacing. Color is never decorative — it appears only as **gradient product tiles** (40 px rounded squares) that classify items, as a single brand blue accent for interactive text, or in one signature **conic-gradient hero card** that anchors the wallet.

Two tonal worlds:
- **Daily surfaces** — `#f5f5f7` page on `#ffffff` cards. Light, dense, scannable.
- **Immersive moments** — pure black sheets (login, biometric prompts, full-screen confirmations). Used sparingly; never for everyday content.

**Key characteristics:**
- 20 px corner radius on every card; 980 px (pill) on every button.
- 0.5 px hairline borders (`rgba(0,0,0,0.04)`) instead of strong shadows.
- Negative letter-spacing on every type role; tight 1.0–1.2 line-heights on headings.
- Bar-chart gradients (purple → pink → orange) as the only chart language.
- Brand blue (`#0071e3`) is the *only* interactive color. Status uses Apple system colors.
- Status-bar safe top padding of 56–58 px; no custom top chrome.

---

## 2. Color Palette & Roles

### Surface
| Token | Hex | Use |
|---|---|---|
| `surface/page` | `#f5f5f7` | All page backgrounds |
| `surface/card` | `#ffffff` | Inset content cards |
| `surface/well` | `rgba(118,118,128,0.12)` | Segmented controls, search field, secondary buttons |
| `surface/sheet-dark` | `#000000` | Login, biometric overlays |

### Text
| Token | Hex | Use |
|---|---|---|
| `text/primary` | `#1d1d1f` | Titles, body, big numbers |
| `text/secondary` | `rgba(60,60,67,0.6)` | Subtitles, captions, placeholders |
| `text/tertiary` | `rgba(60,60,67,0.5)` | Trailing metadata, timestamps |
| `text/quaternary` | `rgba(60,60,67,0.35)` | Disclosure chevrons, divider strokes |

### Brand & status
| Token | Hex | Use |
|---|---|---|
| `brand/blue` | `#0071e3` | All interactive text, primary CTA fill |
| `status/positive` | `#34c759` | Realized gains, success |
| `status/warning` | `#ff9500` (text on tint `#b25400`) | Risk disclosures, ELN warnings |
| `status/negative` | `#ff3b30` | Loss states, max-risk callouts |

### Tile gradients
160° linear gradients used for the colored 40 px rounded-square tiles in front of every list row and stat. **Never** as page backgrounds. Pick by category, not aesthetics.

| Token | From | To |
|---|---|---|
| `tile/blue` | `#4fa3ff` | `#0066ff` |
| `tile/orange` | `#ffb84d` | `#ff8800` |
| `tile/purple` | `#b68cff` | `#7a4bff` |
| `tile/pink` | `#ff80b3` | `#ff3380` |
| `tile/green` | `#5de08e` | `#1fb053` |
| `tile/red` | `#ff7a7a` | `#e03030` |
| `tile/teal` | `#5cd1e0` | `#00a8c0` |
| `tile/indigo` | `#8a8aff` | `#5050ff` |
| `tile/gold` | `#ffd97a` | `#e0a030` |
| `tile/gray` | `#b5b5bc` | `#7a7a82` |

### Hero card (signature)
The wallet's primary card uses a **conic gradient** that recalls Apple Card's titanium shimmer:
```
conic-gradient(from 200deg at 55% 42%,
  #ffd17a 0deg, #ff89b5 55deg, #b78dff 130deg,
  #7de0ff 210deg, #ffea8d 290deg, #ffd17a 360deg)
```
Overlaid with a `radial-gradient(110% 60% at 15% 5%, rgba(255,255,255,0.4), transparent 55%)` highlight and a `0 18px 40px rgba(0,0,0,0.14)` lift shadow. Never replicate this gradient elsewhere.

### Chart gradient
Bar charts use a single vertical 3-stop gradient — the active bar is fully saturated, others render at 0.7 opacity with a desaturated variant.
```
0%   #b68cff (purple)
55%  #ff80b3 (pink)
100% #ffb84d (orange)
```

---

## 3. Typography

System font stack only:
```
font-family: -apple-system, "SF Pro Display", "SF Pro Text", system-ui, "PingFang TC", sans-serif;
```
SF Pro Display ≥ 20 px, SF Pro Text < 20 px (the system substitutes automatically). PingFang TC handles Traditional Chinese fallback.

| Role | Family | Size | Weight | Line | Tracking |
|---|---|---|---|---|---|
| Page Title | Display | 34 | 700 | 1.10 | -0.80 px |
| Hero Number | Display | 32 | 700 | 1.05 | -0.80 px |
| Section Header | Text | 20 | 700 | 1.20 | -0.50 px |
| Card Stat (big) | Display | 26 | 700 | 1.10 | -0.50 px |
| Row Title | Text | 16 | 600 | 1.20 | -0.32 px |
| Body | Text | 15 | 400 | 1.45 | -0.32 px |
| Bar / Nav | Text | 17 | 400 | — | -0.374 px |
| Card Label | Text | 13 | 500 | 1.20 | -0.08 px |
| Subtitle | Text | 13 | 400 | 1.30 | -0.08 px |
| Caption | Text | 12 | 400 | 1.30 | -0.08 px |
| Eyebrow (uppercase) | Text | 11–12 | 600 | — | +1.4–2.0 px, uppercase |

**Currency rule.** Render `NT$` at 55–60 % of the number's size, weight 500, color `text/secondary`, with 3 px right margin. The number itself stays at full size and weight.

---

## 4. Components

### Card (`V2Card`)
- Background `#ffffff`, radius `20`, padding `18 20`.
- Shadow: `0 1px 2px rgba(0,0,0,0.04), 0 0 0 0.5px rgba(0,0,0,0.04)`.
- Click state: scales down 0.985 over 120 ms, no color change.

### List row inside a card (`V2Row`)
Five-column grid: `[40 tile] [12 gap] [title + subtitle, flex] [right-top + right-bottom, fixed] [chevron]`. Vertical padding `11`, hairline divider `0.5px solid rgba(60,60,67,0.1)` between rows, none on the last.

### Tile (`V2Tile`)
Default 40 × 40, `border-radius: size × 0.26` (≈ 10.4), one of the gradient tokens above, white SVG glyph at 20 × 20 inside.

### Segmented control (`V2Segmented`)
- Track: `rgba(118,118,128,0.12)`, radius 980, padding 2.
- Thumb: white, radius 980, shadow `0 3px 8px rgba(0,0,0,0.12), 0 0 0 0.5px rgba(0,0,0,0.04)`.
- Labels: 13 / 600, tracking -0.2 px. Inactive labels stay 500.

### Pill button
| Variant | Background | Text |
|---|---|---|
| Primary | `#0071e3` | `#fff` |
| Secondary | `rgba(118,118,128,0.12)` | `#1d1d1f` |
| Filter (active) | `#1d1d1f` | `#fff` |
| Filter (inactive) | `#fff` + `0 0 0 0.5px rgba(0,0,0,0.08)` | `#1d1d1f` |

All pills: radius 980, padding `7 14` (small) / `13 0` (full-width CTA), font 13–17 / 600, tracking -0.2 to -0.4 px.

### Top navigation (`V2NavTop`)
Status-bar safe `padding: 58px 20px 8px`. Left = back (`< 完成`) in brand blue, 17 / 400. Right = icon row, 18 px gap, all icons stroke `#0071e3` at 1.6 weight.

### Search field
Track `rgba(118,118,128,0.12)`, radius 11, padding `8 12`, gap 8. Magnifier glyph stroke `rgba(60,60,67,0.6)` 1.6, placeholder same color, 15 / 400, tracking -0.32.

### Bar chart (`V2BarChart`)
Padding `{t:16, r:54, b:28, l:8}`. 4 horizontal grid lines at `rgba(60,60,67,0.08)`. Right-aligned y-labels in 10.5 px secondary text. Bars are full-height capsules (`rx = bw/2`), max width 28 px, gap = `step × 0.5`.

### Hero gradient header
Used inside cards for featured products / knowledge intros. Padding `22 22`, color `#fff`, 12 px uppercase eyebrow `letter-spacing: 1.5–2px`, then 26–36 px title at 700 / -0.5 px tracking, then 14–16 px caption at `rgba(255,255,255,0.85)`.

---

## 5. Layout & Spacing

8-pt scale: `4 6 8 10 12 14 16 18 20 24 28 32`.

- Outer page padding: **16 px** (cards) / **20 px** (titles & body).
- Inter-card vertical gap: **10 px** in grids, **12–14 px** between sections.
- 2 × 2 stat grid: `gridTemplateColumns: 1fr 1fr; gap: 10`.
- Section header → card list: **`20 / 20 / 10` padding** above the card.
- Bottom safe area: **24–28 px** padding inside the last screen block.

### Border radius scale
- 8 — pills inside chips, dot indicators
- 10–14 — micro-tiles, embedded media in chat
- 18–22 — primary cards (default 20)
- 980 — every pill button & segmented control

---

## 6. Motion

- Segmented thumb / tab change: `transition: all 0.15s`.
- Card press: `transform: scale(0.985)` over 120 ms.
- Biometric pulse: scale 1 → 1.35, opacity 1 → 0, over 1 s, infinite, ease-out.
- Sheet entry: `transform: translateY(8px) → 0`, opacity 0 → 1, 240 ms cubic-bezier(.2,.9,.25,1).

No bouncy springs; no rotating loaders. Loading is suggested by skeleton shimmer at 8 % opacity.

---

## 7. Iconography

- All icons are inline SVG, 18–22 px, stroke 1.6, round caps and joins.
- Interactive icons use `#0071e3`. Tile glyphs are always solid `#fff`.
- Disclosure chevron: 8 × 13, stroke 1.8, color `rgba(60,60,67,0.35)`.
- Industry / product glyphs are abstract pictographs (chip, factory, antenna). Never logos.

---

## 8. Voice & Copy

- Bilingual: Traditional Chinese primary, English for proper nouns (`ELN`, `Face ID`).
- Conversational — the user is talking to a person, not an app: "我今年賺了多少", "查一下我的庫存".
- Numbers always include the unit: `NT$23,151`, `8.2%`, `3 個月`, `5 天`.
- Comparisons in plain language: "比上月少 NT$320,000", "今年已實現比去年同期多 NT$6,751".
- **Risk disclosure is non-negotiable.** ELN-class products always show the warning pill (background `rgba(255,149,0,0.1)`, text `#b25400`) with the exact phrase **"ELN 不保本。本金可能轉換為股票"** before any subscribe CTA.

---

## 9. Do's & Don'ts

### Do
- Use brand blue **only** for interactive text & primary CTAs.
- Group related rows in a single card with hairline dividers.
- Lead with the number; let the label sit above it small and dim.
- Keep tile gradients categorical: same product family = same gradient across screens.
- Place all destructive / dim states with reduced *opacity*, not new colors.

### Don't
- Don't use blue decoratively (no blue gradients, no blue card backgrounds).
- Don't introduce new chart palettes — reuse the purple→orange ramp.
- Don't stack two heavy weights; pair 700 numbers with 500 / 400 labels.
- Don't replace the conic hero card with anything else; it's the wallet's signature.
- Don't add emoji. Use SVG glyphs in tiles instead.
- Don't use shadow-heavy elevation. Hairline borders + 1 px shadow only.

---

## 10. Quick Reference

```css
/* Tokens */
--page: #f5f5f7;
--card: #fff;
--well: rgba(118,118,128,0.12);
--text: #1d1d1f;
--text-secondary: rgba(60,60,67,0.6);
--brand: #0071e3;
--positive: #34c759;
--warning-tint: rgba(255,149,0,0.1);
--warning-fg: #b25400;
--hairline: rgba(60,60,67,0.1);

--radius-card: 20px;
--radius-pill: 980px;
--shadow-card: 0 1px 2px rgba(0,0,0,0.04), 0 0 0 0.5px rgba(0,0,0,0.04);
--shadow-thumb: 0 3px 8px rgba(0,0,0,0.12), 0 0 0 0.5px rgba(0,0,0,0.04);
```

```css
/* Type */
.title    { font: 700 34px/1.10 -apple-system, "SF Pro Display"; letter-spacing: -0.80px; }
.stat-big { font: 700 26px/1.10 -apple-system, "SF Pro Display"; letter-spacing: -0.50px; }
.row      { font: 600 16px/1.20 -apple-system, "SF Pro Text";    letter-spacing: -0.32px; }
.label    { font: 500 13px/1.20 -apple-system, "SF Pro Text";    letter-spacing: -0.08px; color: rgba(60,60,67,0.6); }
```

Designs that follow this system feel quiet, precise, and trustworthy — the same emotional contract Apple Card asks for, transposed onto wealth management.
