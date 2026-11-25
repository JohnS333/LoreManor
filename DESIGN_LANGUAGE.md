# Lore Manor Design Language

**Theme:** *Charcoal-Stained Timber & Aged Brass*

Lore Manor is a chronological lore and clip workspace styled after dark, charcoal-stained woodwork in a dimly lit study. Rather than tinting surfaces heavily brown, the interface preserves a restrained dark charcoal-warm palette and achieves its woody character through **layered wood-grain textures, subtle fiber striations, plank-like depth, and milled-edge bevels**, paired with parchment ink and aged brass accents.

This document is the source of truth for styling. Every token defined below maps directly to a CSS custom property in [`client/src/index.css`](./client/src/index.css) and is consumed by [`client/src/App.css`](./client/src/App.css).

---

## 1. Design Principles

1. **Restrained Dark Charcoal Palette** — Keep surfaces in the original deep, near-neutral dark charcoal-warm range (`#11100f` → `#292521`) so the UI stays crisp, modern, and never muddy or overly brown.
2. **Woody Character Through Texture, Not Brown Tint** — Convey timber through multi-layered CSS wood-grain patterns (fine parallel fibers, subtle irregular grain bands, dark pore grooves, and gentle wood-sheen gradients) plus milled-edge top bevels (`--bevel-highlight`).
3. **High-Contrast Parchment Legibility** — Warm cream typography (`--text`) and muted metadata (`--muted`, `--faint`) keep long VOD titles and event descriptions effortless to scan over textured surfaces.
4. **Restrained Aged Brass** — Gold/brass (`--gold`, `--gold-bright`) and muted wood (`--wood`) are reserved for identity, section kickers, focus rings, resize handles, and primary affordances so VOD color bars remain visually distinct.

---

## 2. Color Tokens (`:root` in `client/src/index.css`)

### Dark Timber Surfaces
| Token | Value | Role |
| --- | --- | --- |
| `--night` | `#11100f` | Deepest charcoal-stained backdrop and thumbnail wells |
| `--night-soft` | `#171513` | Recessed wells, inputs, and inner track backgrounds |
| `--panel` | `#1b1917` | Primary paneling for tracks, columns, and dialogs |
| `--panel-raised` | `#22201d` | Raised cards and secondary buttons |
| `--panel-hover` | `#292521` | Hover state for interactive controls |
| `--panel-header` | `rgba(44, 40, 35, 0.34)` | Header rail tint for track and column headers |

### Joinery & Borders
| Token | Value | Role |
| --- | --- | --- |
| `--line` | `#34302b` | Standard joinery seam and card border |
| `--line-warm` | `#463b31` | Emphasized timber bevel, inputs, and dialog frames |
| `--line-hover` | `#55555d` | Highlighted edge on button and control hover |

### Parchment Ink (Typography)
| Token | Value | Role |
| --- | --- | --- |
| `--text` | `#ece5d8` | Primary parchment cream text |
| `--muted` | `#aaa398` | Secondary text, button labels, URLs |
| `--faint` | `#7d7972` | Metadata, timestamps, separators, and hints |

### Wood & Brass Accents
| Token | Value | Role |
| --- | --- | --- |
| `--wood` | `#806247` | Primary wood action fill (Save, active borders) |
| `--wood-hover` | `#967356` | Hover fill for primary wood buttons |
| `--wood-tint` | `rgba(128, 98, 71, 0.12)` | Soft wood wash for Add / Fetch buttons |
| `--wood-tint-hover` | `rgba(128, 98, 71, 0.20)` | Hover wash for Add / Fetch buttons |
| `--gold` | `#cda978` | Aged brass for kickers, focus outlines, and resize handles |
| `--gold-bright` | `#ead0aa` | Polished brass for brand mark, headings, and hover links |
| `--blue` | `#9f9b91` | Neutral pewter accent for folder and channel icons |
| `--danger` | `#e2a49a` | Muted terracotta for validation and error messages |

---

## 3. Wood-Grain Textures, Elevation & Radii

Woody feel is driven by layered, low-contrast grain tokens rather than shifting base hues:

| Token | Role |
| --- | --- |
| `--grain-fiber-light` | `rgba(255, 245, 230, 0.022)` — fine specular wood-fiber catchlight |
| `--grain-fiber-dark` | `rgba(0, 0, 0, 0.22)` — subtle dark wood-pore groove |
| `--grain-band` | `rgba(205, 169, 120, 0.018)` — wide, soft annual-ring sheen |
| `--wood-grain-workspace` | Multi-frequency angled grain + subtle plank bands for `.workspace` |
| `--wood-grain-panel` | Fine vertical-angled grain + top sheen for `.track` and `.allocation-column` |
| `--wood-grain-card` | Subtle horizontal brushed-wood grain for `.channel-card`, `.vod-card`, `.event-card` |
| `--wood-grain-bar` | Horizontal milled-plank grain for `.topbar` and `.track-header` |
| `--bevel-highlight` | `inset 0 1px 0 rgba(255, 245, 230, 0.05)` — top-edge milled-wood chamfer |
| `--shadow-soft` | `0 12px 28px rgba(0, 0, 0, 0.20)` — standard track and card shadow |
| `--shadow-deep` | `0 24px 70px rgba(0, 0, 0, 0.50)` — modal dialog elevation |
| `--radius-sm` / `--radius-md` / `--radius-lg` / `--radius-xl` | `4px` / `8px` / `10px` / `12px` |

### Grain Direction Conventions
- **Horizontal rails & cards** (`.topbar`, `.track-header`, `.channel-card`, `.vod-card`, `.event-card`): grain runs nearly horizontally (`88deg`–`92deg`) like milled trim and inlaid plaques.
- **Vertical tracks** (`.track`, `.allocation-column`): grain runs steeply (`172deg`–`178deg`) like vertical wainscoting panels.
- **Workspace backdrop** (`.workspace`): broad, low-contrast diagonal grain (`166deg`) with multi-step spacing so it never looks like synthetic stripes.

---

## 4. Typography

| Token | Value | Usage |
| --- | --- | --- |
| `--font-sans` | `Inter, "Segoe UI", ui-sans-serif, system-ui, sans-serif` | Body copy, controls, metadata, event descriptions |
| `--font-serif` | `Georgia, "Times New Roman", serif` | Brand title, track headers, allocation headers, dialog titles, empty-state headings |

---

## 5. Interactive & Accessibility Rules

- **Focus**: All interactive controls use `outline: 2px solid var(--gold); outline-offset: 2px;` on `:focus-visible` (or `1px` offset on inputs).
- **Scrollbars**: Thin scrollbars styled with `#555761` thumbs on a transparent track.
- **Buttons**:
  - *Secondary / Icon*: `--panel-raised` with `--line` border and `--bevel-highlight`; hovers to `--panel-hover` and `--line-hover`.
  - *Wood-tinted action* (`.add-button`, `.channel-fetch-button`): `--wood-tint` fill with `--line-warm` border and `--gold-bright` label.
  - *Primary brass/wood* (`.save-button`, `.add-event-button`): Rich `--wood` or brushed brass-to-wood gradient with crisp contrast.
- **Keep textures subtle**: Grain layers must stay below `0.03` alpha for light streaks so text contrast and VOD thumbnail readability are never compromised.

