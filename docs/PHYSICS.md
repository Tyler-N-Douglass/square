# PHYSICS — every formula, convention, and assumption

This is the umbrella document. Each subsystem's derivations live in its own file, written by the
agent that owns the code and audited at phase gates; this file carries the shared conventions
everything else builds on. Every claim here traces to a test (SPEC §15.6).

| Part | File | Owner |
|---|---|---|
| Magnetics & DSP — signal chain, zero-crossing geometry, guards, ellipsoid fit | `physics-dsp.md` | A2 |
| Vision & geometry — pinhole model, homography → vanishing points, sign resolution, Monte Carlo | `physics-geometry.md` | A3 |
| Craft math — compound miter derivation, rational arithmetic, layout, slopes | `physics-craft.md` | A4 |

## Shared axis conventions (the one true frame)

Device frame (W3C devicemotion): **x right, y toward the top edge of the screen, z out of the
screen.** All sensor code normalizes into this frame in `src/sensors/imu.ts` — rotation rates
arrive in deg/s about (z, x, y) as (alpha, beta, gamma) and are emitted in **rad/s as (gx, gy,
gz) about (x, y, z)**. Nothing downstream ever sees degrees per second.

`accelerationIncludingGravity` at rest face-up reads **az ≈ +9.81 m/s²** (the vector points away
from the earth).

## Level angles

```
pitch = atan2(−ax, √(ay² + az²))    rotation about x — 0 when the side edges are level
roll  = atan2(ay, az)               rotation about y — 0 face-up, +90° standing upright
```

Truth table for all six cardinal orientations plus gimbal-adjacent cases:
`tests/unit/level-math.test.ts`. At pitch ±90° roll degenerates (atan2(0,0) → 0 — finite, never
NaN; the LEVEL tool switches to plumb language well before that).

## Orientation fusion (ADR-007)

Complementary filter in `src/sensors/orientation.ts`: the gravity estimate is rotated by the gyro
(g′ = g − ω×g·dt, body frame) then pulled toward the accelerometer with α = 0.02 per sample at
60 Hz (~0.8 s time constant). Yaw is **null** without a magnetic reference — never invented.

Motion gate: a sample is *still* when `| ‖a‖ − 9.80665 | ≤ 0.35 m/s²` and `‖ω‖ ≤ 0.25 rad/s`;
a reading is *stable* (displayable as HOLD) after 400 ms of stillness. A moving number is shown
dim, labeled MOVING, and cannot be logged.

## Magnetometer tiers (SPEC §2.2, ADR-005)

- **FIELD**: raw 3-axis µT (Chromium/Android, flag-gated). Working signal |B| = √(x²+y²+z²) —
  rotation-invariant. A fastener's dipole superimposed on the earth field B_e appears in |B| as
  approximately the anomaly's projection onto B̂_e — bipolar along the sweep.
- **PROXY**: no raw field. Signal = Δψ = ψ_magnetic − ψ_gyro-predicted (degrees, signed): gyro
  integration predicts the heading over a short horizon; a ferrous mass deflects the magnetic
  heading against that prediction, producing the same bipolar S-curve. Confidence caps at LIKELY.
- **NONE**: no sensing claims at all; MANUAL mode is arithmetic on user references, labeled
  ENTERED/DERIVED.

The trace schema (`tests/fixtures/SCHEMA.md`) stores FIELD samples as µT vectors and PROXY
samples as the signed residual in `x` — the sign is load-bearing (the fastener is at the zero
crossing between the lobes).

## Position along the sweep (ADR-006)

Never accelerometer double-integration. Time→distance is piecewise-linear through user anchors
(`timeToDistanceIn`), identical for live sweeps and replayed traces; before a span is declared,
charts are in seconds and say so.

## The zero-crossing rule (SPEC §4.1.2 6b)

A fastener's along-sweep signature is derivative-of-Gaussian shaped: s(x) ∝ −(x−x₀)·e^((x−x₀)²/2σ²).
Its extrema sit at x₀ ± σ — **one lobe-width off the fastener** — while the zero crossing between
the lobes sits at x₀ itself. On the seed fixture the shipped estimator recovers 4.003″/20.016″
(truth 4.00″/20.00″) and the amplitude estimator lands 0.78″/1.03″ off, outside the stud's
half-width. Both facts are frozen in `tests/unit/zero-crossing.test.ts`. Full treatment:
`physics-dsp.md`.

## Compound miter (ADR-009)

Derived from the vector construction (see `physics-craft.md` for the full derivation):

```
D = (180° − C)/2
miter = atan( sin S · tan D )     — matches the spec's candidate formula
bevel = asin( cos S · sin D )     — the candidate said cos D; it agrees only at C = 90°
                                    (sin 45° = cos 45°) and fails the flat splice
```

Canonicals (frozen test): 90°/45 → 35.26°/30.00°; 90°/38 → 31.62°/33.86°; 180°/any → 0°/0°.
Nested (in-position) crown: miter = D, bevel = 0 — spring angle drops out. The spec's
`atan(tan D / cos S)` family is a face-marking line, not a saw setting, and is labeled as such.

## Camera model (SPEC §4.3.1)

Pinhole, K = [[f,0,cx],[0,f,cy],[0,0,1]], principal point at image center, square pixels — all
three assumptions stated in the CORNER UI. Default f from a 67° horizontal FOV until the sheet
calibration solves the real one. Full derivations (homography columns → vanishing points,
homogeneous back-projection that never divides by w, sign resolution from image ordering,
refusal thresholds, Monte-Carlo procedure): `physics-geometry.md`.
