# SQUARE — brand sheet

**Name:** SQUARE
**Tagline:** Is it square?
**One-liner:** Photograph a wall. Know what's behind it and whether it's straight.

Out of square, out of level, out of plumb — the three ways a house lies to you. The name is also
the ethic: every reading ships with its uncertainty, and the app would rather refuse than guess.

> Naming note: tool #3 inside the app is called **CORNER**, not SQUARE, so the app name and a tool
> name never collide in copy, in code, or in a support conversation. The seven tools are SCAN,
> LEVEL, CORNER, LAYOUT, BEVEL, CALIBRATE, LOG.

## Palette — Draplin Design Co.
Flat, heavy, high contrast. Gray, white, orange. No gradients, no glows, no shadows.

| Token | Hex | Use |
|---|---|---|
| `--orange` | `#F15A22` | **live measured values only** |
| `--orange-deep` | `#C8481A` | pressed states |
| `--ink` | `#1A1A1A` | night ground / shop type |
| `--charcoal` | `#2E2E2E` | night surface, icon ground |
| `--gray` | `#58595B` | rules, secondary type |
| `--gray-mid` | `#939598` | disabled, inactive ticks |
| `--gray-light` | `#D1D3D4` | light rules and fills |
| `--off-white` | `#F1F2F2` | shop ground / night type |
| `--white` | `#FFFFFF` | the blade, cards |
| `--red` | `#C1272D` | UNRELIABLE, out of tolerance |
| `--green` | `#007A3D` | LOCK, TRUE, in tolerance |

**The orange rule is absolute.** Orange marks a value a sensor is producing right now. Nothing
static, decorative, or user-entered ever wears it. Functional signal, not brand flourish.

Two themes, one switch, DDC-style: **SHOP** (off-white ground, default) and **NIGHT** (ink ground).

## Type — DDC Hardware (Lost Type Co-op)
Self-hosted from `fonts/`. Three faces, 24 KB total.

- **Display** — DDC Hardware Compressed, uppercase, +0.06em. Tool names, state words.
- **UI** — DDC Hardware Regular. Labels, buttons, headers.
- **HUD** — DDC Hardware Condensed. Every live number. Verified tabular: all ten digits advance
  1032/2048 em, so readouts do not jitter as they change.
- **Prose** — system stack. DDC Hardware is a display family; the Field Manual is read, not
  glanced at.

Patched into the shipped woff2 files because the originals lacked them and both are load-bearing:
**U+00B5 MICRO SIGN** (built from `u` plus a stem descender matched per face) and **U+2032 PRIME**
(mapped to the straight quotesingle). µT for field readings, ′ for feet.

License: Lost Type's commercial license covers a single website and permits modification provided
the font is not redistributed. Hold the license before going public, don't link the files for
download, don't publish them to a registry.

## Voice
Plain, active, present tense. Never apologize, never hedge, never vague. Never "simply", "just",
or "easy" — the user is holding a phone against a wall in a dusty room.

- Good: `WALL READS HOT. Likely metal studs, conduit, or rebar. Fastener detection is not reliable here.`
- Bad: `We're sorry, we may not be able to detect studs at this time.`
- Good: `Something magnetic is attached to your phone. Take the case off.`
- Bad: `Interference detected.`
- Good: `Sweep slower — peaks smear above about six inches per second.`
- Bad: `Please try sweeping more slowly for best results.`

Errors say what happened and what to do. Empty states invite action. Every number carries a unit
and either a ± or a confidence state.

## Mark
A framing square with a plumb bob dropped through the heel. Flat white blade, graduations cut out
as negative space, orange bob, charcoal ground. Two instruments in one silhouette: the square
checks the corner, the bob answers only to gravity.

Alternates shipped: `app-icon-square-hung.svg` (bob in the open quadrant with an eyelet),
`app-icon-square-orange.svg` (orange field, charcoal bob).
