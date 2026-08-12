# Craft math — derivations and conventions (A4)

Covers `src/geometry/miter.ts`, `units.ts`, `layout.ts`, `levelMath.ts`.
Everything here traces to a unit test; the frozen canonical values in
`tests/unit/miter-canonical.test.ts` arbitrate the compound miter (ADR-004,
ADR-009).

---

## 1. Compound miter, derived from rotation geometry

### 1.1 Conventions

- **C** — the wall corner angle, measured wall to wall in plan. 90° is a
  square inside corner; 180° is a flat wall (a splice); values above 180°
  describe outside corners.
- **S** — the crown's spring angle, measured **from the wall** to the back of
  the crown. A "52/38" crown installed the standard way has S = 38°.
- **D** = (180° − C)/2 — the plan-view half-angle each piece is cut to.
- **miter** — table rotation from square. **bevel** — blade tilt from
  vertical. Both are magnitudes; direction is the saw card's job.

### 1.2 The construction (what the code does)

World frame: z up, corner at the origin, corner bisector along +x.

1. **Run directions.** The two pieces leave the joint along horizontal unit
   vectors
   `u₁ = (cos C/2, sin C/2, 0)`, `u₂ = (cos C/2, −sin C/2, 0)`,
   so the angle between them is C. At C = 180° they are collinear-opposite —
   the flat splice.

2. **The bisecting cut plane.** The joint surface of two identical prisms is
   the mirror plane that reflects one onto the other while fixing the
   vertical (both pieces keep the same relation to floor and ceiling). A
   mirror that swaps u₁ ↔ u₂ and fixes z has normal along **u₁ − u₂**. That
   plane contains the vertical and the corner bisector, and `u₁ − u₂` stays
   well-defined at the splice (where `u₁ + u₂` vanishes — this is why the
   code builds the normal from the difference, not the bisector).
   Normalized: `n_world = (0, 1, 0)` in this frame, for every C.

3. **The installed piece's body triad.** Wall 1 contains u₁ and z; its
   horizontal into-room normal is `h₁ = u₁ × z`. The crown's back leans off
   the wall by the spring angle, so the back-face normal is the wall normal
   swung about the run axis:
   `a₃ = cos S · h₁ − sin S · z`.
   With `a₁ = u₁` (the length) and `a₂ = a₃ × a₁` (across the face), the
   triad {a₁, a₂, a₃} is orthonormal.

4. **Installed → saw-table rotation.** Cutting "flat", the crown lies with
   its back on the table and its length along the fence: a₁ → saw X (fence),
   a₂ → saw Y (table), a₃ → saw Z (table normal). That rotation is exactly
   "express vectors in the body triad", so the cut-plane normal in the saw
   frame is
   `(n·a₁, n·a₂, n·a₃)`.

5. **Extraction.** For a unit cut-plane normal (nx, ny, nz) in the saw frame:
   - **miter = atan(|ny| / |nx|)** — the angle between the blade's plan-view
     trace and a square cut;
   - **bevel = asin(|nz|)** — the blade's tilt from vertical (a vertical
     blade has a horizontal plane normal; tilting it by β lifts the normal's
     vertical component to sin β).

Carrying the symbols through steps 2–4:

```
nx = sin(C/2)          ny = −sin S · cos(C/2)         nz = −cos S · cos(C/2)
```

(unit-length by inspection), giving the closed forms

```
miter = atan( sin S · tan D )        [ tan D = cot(C/2) ]
bevel = asin( cos S · sin D )        [ sin D = cos(C/2) ]
```

Checks against the frozen canonicals: 90/45 → 35.264°/30.000°; 90/38 →
31.619°/33.863°; 180/S → 0/0 for every S; both settings decrease
monotonically and continuously as the corner opens toward the splice.

### 1.3 Why the spec's candidate bevel formula is wrong

SPEC §4.5.2 offers `bevel = asin(cos S · cos D)` as a candidate. Compare:

| | derived | candidate |
|---|---|---|
| formula | asin(cos S · **sin** D) | asin(cos S · **cos** D) |
| 90° corner (D = 45°) | asin(cos S · sin 45°) | asin(cos S · cos 45°) — **identical**, since sin 45° = cos 45° |
| flat splice (D = 0°) | asin(0) = **0°** | asin(cos S) = **90° − S** |
| 120° corner, 45° spring | **20.7°** | 37.8° |

The candidate coincides with the truth at every 90° corner — which is where
both published canonical pairs live — and diverges everywhere else, failing
hardest at the flat splice, where it claims a 52° blade tilt (for a 38°
spring) to butt two sticks on a straight wall. A splice is a plain square
cut; the geometry returns 0/0. This is exactly why ADR-009 mandates deriving
from the rotation construction and letting the canonical table arbitrate.
The candidate **miter** formula, by contrast, agrees with the derivation
everywhere. Both facts are pinned in `tests/unit/miter-derivation.test.ts`.

### 1.4 Nested (in-position) crown

Held nested, the crown stands against the fence at its spring angle, upside
down: the fence plays the wall, the table plays the ceiling. The installed
frame maps rigidly onto the saw frame with world-up going into the table
plane, so the cut normal has **no component along the table normal**:

```
miter = D = (180° − C)/2        bevel = 0
```

The spring angle drops out entirely — that is the whole appeal of cutting
nested. For a square corner: miter 45°, blade square, done.

The spec floats `atan(tan D / cos S)` as the nested "single miter" family.
It is **not a saw setting of either method**. It belongs to the face-line
family below.

### 1.5 The face line (marking angle — not a saw setting)

Intersect the cut plane with the plane of the crown's face (spanned by the
run u₁ and the up-slope direction `cos S · z + sin S · h₁`). Measuring the
resulting line inside the face:

- **from square across the face**: atan(sin S · tan D) — *equal to the
  flat-cut miter setting*, necessarily: it is the same physical line the
  flat-set saw draws across the face;
- **from the long edge of the stock**: the complement, 90° − that
  = atan(tan(C/2) / sin S).

The spec's `atan(tan D / cos S)` reproduces the from-edge value at the
90°-corner/45°-spring canonical (54.74°, the classic hopper "face cut"
number) and drifts off it elsewhere — at 90°/38° it says 51.8° where the
geometry says 58.4°, a 6.6° error, which is a ruined stick. The printed form
matches the true from-edge line only under a convention swap (D read as the
half-corner C/2 **and** S read as spring-from-ceiling); with this project's
conventions plugged in literally it is another 90°/45° coincidence, the same
trap structure as the candidate bevel. `crownFaceLine()` returns both true
angles, labeled, and the saw card never presents them as saw settings.

### 1.6 What the saw card must say

Flat and nested settings for the same corner are far apart (90°/38°: flat
= 31.6° + 33.9° tilt; nested = 45° + no tilt). A card that shows numbers
without the hold wastes molding, so `sawCard()` always states, as data the
BEVEL tool renders verbatim:

- **method** — flat or nested, with the hold spelled out (flat: back on the
  table, face up, ceiling edge against the fence; nested: upside down,
  ceiling contact on the table, wall contact on the fence, stop block);
- **tilt direction and table swing** for the specific piece (left/right of
  the corner, inside/outside corner — the swing mirrors);
- **keeper side** — which side of the blade the piece lives on;
- **flip instruction** for the mating piece;
- **test cut note** — "Cut a test piece from scrap first." Always. §15.8.

`asymmetricMiter(C, fixed)` covers the pre-cut-piece case: the two miters at
a corner must sum to 180° − C, so the mate takes the remainder — reported
truthfully even when it is not cuttable (never clamped).

---

## 2. Exact rational arithmetic (units.ts)

Layout marks are sums and scalings of user-entered fractions. In IEEE
floats, `0.1` summed one hundred times is 9.99999999999998 — a 1/50 000″
error that compounds silently and *sometimes* crosses a 1/32″ rounding
boundary, which is how the 87th mark ends up a 32nd off. So:

- `Rational` = normalized bigint `num/den` (den > 0, gcd 1). Add, subtract,
  multiply, divide, compare — all exact, no overflow ceiling.
- Constructors refuse floats: build fractions from integers or exact decimal
  strings (`'40.5'` → 81/2). Tests assert **equality of rationals over 100
  cumulative marks** (repeated addition equals multiplication, mark by
  mark), not closeness.
- Metric is exact too: 1 in ≝ 25.4 mm = 127/5, so `1220mm` is 6100/127
  inches with zero loss, and mm→in→mm round trips are identities.
- Rounding to the display precision (1/8, 1/16, 1/32) happens **only at
  format time**, ties away from zero, and every formatted value reports its
  direction: `exact`, `up`, or `down`. The UI shows the direction when it
  matters (SPEC §5).
- Output uses U+2032 PRIME (′) and U+2033 DOUBLE PRIME (″) — the shipped DDC
  Hardware fonts carry a patched ′ glyph specifically for this. Parsing
  accepts both the typographic and ASCII forms.

Parser coverage: `3' 4-7/16"`, `3′ 4-7/16″`, `40.5"`, `7/16`, `1-3/8`,
`1 3/8`, `12`, `12in`, `3'`, `1220mm`, `2.5cm`, `1.2m`, leading minus.
Anything else returns null — no guessing.

---

## 3. Layout solvers (layout.ts)

All in rationals, all returning per-mark **cumulative-from-datum** (measure
every mark from the same end — no stacking error) and
**incremental-from-previous** (how a tape is actually walked). The two
columns are proven to chain exactly in tests.

| solver | centers | extras |
|---|---|---|
| `equalCenters(S, n)` | S·(i+1)/(n+1) | pitch |
| `fixedMargins(S, n, m, p)` | m + i·p | leftover to far end |
| `equalGaps(S, n, w)` | g·(i+1) + w·(i+½), g = (S − n·w)/(n+1) | gap |
| `fixedPitchCentered(S, n, p)` | M + i·p, M = (S − (n−1)·p)/2 | margin |

Impossible inputs (n·w > S, run > S, negative margin, zero pitch,
non-integer count, non-positive span) return `{ ok: false, reason }` with
the numbers in the reason ("… 40″; the span is 36″ — 4″ short."). Nothing is
clamped. `storyPoleRows`/`storyPoleCsv` emit the export rows (tape fraction,
decimal inches, mm); the printable strip is Phase 2 UI. Presets (57″ gallery
height, 96 mm CTC, …) are Phase 2 data.

---

## 4. Level math (levelMath.ts)

### 4.1 Axis convention and the cardinal truth table

Device frame (W3C devicemotion): x right, y toward the top edge, z out of
the screen. `accelerationIncludingGravity` points **away** from the earth at
rest (face-up ⇒ az ≈ +9.81).

```
pitch = atan2(−ax, √(ay² + az²))      roll = atan2(ay, az)
```

Operationally: **pitch** is how far the device's x axis dips from horizontal
(+90° = right edge straight down); **roll** is rotation about x from face-up
(+90° = standing upright, ±180° = face-down). Worked truth table, pinned in
`tests/unit/level-math.test.ts`:

| orientation | a (m/s²) | pitch | roll |
|---|---|---|---|
| flat, face-up | (0, 0, +g) | 0° | 0° |
| flat, face-down | (0, 0, −g) | 0° | +180° |
| portrait, top edge up | (0, +g, 0) | 0° | +90° |
| portrait, upside down | (0, −g, 0) | 0° | −90° |
| landscape, right edge down | (−g, 0, 0) | +90° | undefined → 0 |
| landscape, left edge down | (+g, 0, 0) | −90° | undefined → 0 |

At pitch ±90° roll is gimbal-degenerate; `atan2(0, 0)` returns 0, so the
output stays finite and the motion gate (A5) owns the "don't trust roll
here" call. Pitch is bounded to [−90°, +90°], roll to (−180°, +180°].

### 4.2 Reversal calibration

Measure a surface (m₁), rotate the phone 180° in plane, measure again (m₂).
With sensor bias b and true surface angle t: m₁ = t + b, m₂ = −t + b, so

```
t = (m₁ − m₂)/2        b = (m₁ + m₂)/2
```

— both recovered exactly, no reference surface needed. `removeBias`
subtracts the stored b from later readings.

### 4.3 Slope forms and the drain band

From one measured angle θ, all simultaneously (SPEC §4.2.3): degrees;
percent grade = 100·tan θ; in/ft = 12·tan θ; mm/m = 1000·tan θ; rise:run
normalized to 1:n (level = 0:1; signs follow θ). Out-over-run:
`out = tan(θ) · L` — "out by 0.84″ over 8 ft" at half a degree.

`drainSlopeCheck(inPerFt)`: the code-standard drain slope is ¼″ per foot,
working band ¼″–½″ per foot, edges inclusive. Under: water stands. Over:
liquids outrun solids. Both callouts state the band and the consequence, in
BRAND voice.
