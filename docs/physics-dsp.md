# SCAN signal chain — physics and thresholds (A2)

Everything here is implemented in `src/dsp/` and enforced by `tests/unit/dsp-*.test.ts`,
`tests/unit/zero-crossing.test.ts` (frozen), and `tests/fixtures.verify.test.ts` (frozen).
Feeds `PHYSICS.md` and `ACCURACY.md` (A12). Companion: `docs/accuracy-dsp.md`.

## 1. The signal

A drywall screw is a small magnetic dipole 12–15 mm from the sensor (drywall + glass).
Passing it at sweep speed writes a **bipolar derivative-of-Gaussian** signature into the
field component along the pedestal: one lobe up, one lobe down, extrema at roughly
±1″ around the fastener, amplitude 0.5–8 µT on a 25–65 µT Earth pedestal (SPEC §4.1.1).

Working signal per tier:

- **FIELD**: `|B| = √(x² + y² + z²)` — rotation-invariant. For a small anomaly **a** on a
  large pedestal **E**, `|E + a| ≈ |E| + (Ê·a)`: the projection of the dipole onto the
  pedestal direction survives into `|B|` linearly, sign intact.
- **PROXY**: the signed heading residual Δψ (degrees) arrives in `x` with `y = z = 0`
  (`src/sensors/replay.ts` passes it through signed). The sign carries the lobe order —
  never take a magnitude here.

## 2. The chain (SPEC §4.1.2), step by step

| step | operation | implementation |
|---|---|---|
| 3 | detrend | moving median, window `round(2.0·hz)` forced odd, truncated at edges — `filters.detrend` |
| 4 | band-limit | Savitzky-Golay, window 9, order 2 — `filters.savitzkyGolay` |
| 5 | noise floor | σ = 1.4826 × MAD — `filters.noiseSigmaTrailing` (3 s trailing, streaming form) and `filters.robustSigma` (whole trace, detection form) |
| 6 | peaks | prominence ≥ k·σ, bipolar pairing, shape gate — `peaks.detectBipolarEvents` |
| 6b | position | **zero crossing between the lobes**, linear interpolation — never the extremum |
| — | map to inches | piecewise-linear anchors — `replay.timeToDistanceIn` (ADR-006) |
| — | lattice | candidate-pitch fit — `spacing.analyzeLattice` |
| — | confidence | SNR state machine — `confidence.aggregateConfidence` |

### Detrend (step 3)

The Earth field is a big DC pedestal that moves as the hand rotates. A 2.0 s moving
**median** (81 samples at 40 Hz) tracks the pedestal and slow drift but ignores any
excursion occupying under half its window — a fastener event at 3 in/s spans ~0.7 s
of lobes, comfortably under the 1 s half-window. Mean-based detrending would leak the
lobes into the baseline; the median does not (`dsp-filters.test.ts` asserts a constant
pedestal is removed exactly while a 0.4 s pulse survives untouched).

### Savitzky-Golay (step 4)

Order-2 closed form over window 2m+1:

```
c_i = (3(3m² + 3m − 1) − 15 i²) / ((2m−1)(2m+1)(2m+3)),   i ∈ [−m, m]
```

For m = 4: `[−21, 14, 39, 54, 59, 54, 39, 14, −21]/231`. Properties tested: coefficients
sum to 1 (DC preserved), quadratics reproduced exactly, zero phase (a symmetric peak
does not move), white-noise gain `√Σc²ᵢ ≈ 0.505`. A 9-sample window smooths well under
the ~13-sample lobe width at the paced sweep, so lobes keep their height and position.

### Noise floor (step 5)

`σ = 1.4826 × MAD` — the 1.4826 makes MAD consistent with a Gaussian σ, and the median
absolute deviation ignores the lobes themselves (they are minority samples). Two forms:

- **Streaming** (`noiseSigmaTrailing`, 3 s trailing window): what the live ribbon draws
  as the noise band, per SPEC's wording.
- **Detection** (`robustSigma`, whole trace): the headless analyzer uses the whole-trace
  MAD because a 3 s trailing window *contains the first fastener itself* at sweep start
  and over-estimates the floor exactly where the first detection has to happen. Same
  estimator, wider support. Floored at 1e-3 signal units so synthetic noiseless traces
  cannot divide by zero.

### Peak detection (step 6)

A candidate must survive four independent tests:

1. **Prominence** ≥ `max(k·σ, MIN_PROMINENCE_ABS)` for the primary lobe, with k =
   `opts.sensitivity` (default 3.5, range 2.0–6.0). `MIN_PROMINENCE_ABS` = 0.4 µT
   (FIELD) / 0.5° (PROXY): a real fastener at working standoff writes ≥ 0.5 µT
   (§4.1.1), so on a very quiet sensor k·σ alone would chase sub-physical ripples.
2. **Bipolar pairing**: an opposite-sign lobe with prominence ≥ 0.7 of the primary bar
   within 3.5″ (nominal lobe separation is 2″; noise shifts extrema by ~0.5″ each).
   Pairing runs strongest-first, each lobe used once, largest-|value| partner wins —
   a tiny ripple cannot steal a real lobe's partner. Lobes closer than 0.8 lobe-sigma
   are rejected: no dipole makes lobes that narrow; smoothed noise does.
3. **Shape gate**: normalized correlation against a derivative-of-Gaussian template
   whose width is clamped to the physically expected lobe sigma (1″ at the
   anchor-implied speed, ±[0.7, 1.5]×). Band-limited noise forms narrow smooth ripple
   pairs that pass prominence tests but cannot stay coherent across a physically wide
   window. Acceptance: `shapeScore ≥ 0.55`. Measured effect on blank walls (0.22 µT
   noise, 200 seeded sweeps): false events drop 990 → 84, and the max false SNR drops
   below 8 — **noise cannot fabricate a STRONG** (`dsp-peaks.test.ts`, statistical
   honesty test).
4. **Minimum separation**: events with zero crossings closer than 2″ merge into the
   stronger one.

### Position — the zero crossing (step 6b)

The fastener sits at the **zero crossing between the lobes**, not at either extremum.
The DoG `g(u) = −u·e^(−u²/2)` has extrema at u = ±1 — one full lobe-sigma (~1″ at paced
speed) to each side of the fastener. Marking the extremum is a hole *beside* the stud.
The crossing is found by scanning the paired interval for the sign change nearest the
lobe midpoint and linearly interpolating; the time is mapped to inches through the
anchors.

Both estimators ship. On the frozen seed fixture (truth 4.00″ / 20.00″):

| estimator | recovered | error |
|---|---|---|
| zero crossing | 4.003″, 20.016″ | 0.003″, 0.016″ |
| amplitude extremum | 3.225″, 18.975″ | 0.775″, 1.025″ — outside the stud half-width |

`tests/unit/zero-crossing.test.ts` (frozen, ADR-004) asserts the amplitude estimator's
*failure* as well as the zero-crossing estimator's success. If a change ever makes the
amplitude estimator pass, the test is broken, not the algorithm.

## 3. Lattice inference (SPEC §4.1.5) — `spacing.ts`

Candidate pitches: 16.0″, 24.0″, 12.0″, 19.2″, 15.748″ (400 mm), 23.622″ (600 mm).
Per pitch, phase is fit by circular mean —
`φ = (p/2π)·atan2(Σ sin(2πxᵢ/p), Σ cos(2πxᵢ/p))` — plus a deterministic per-peak
candidate search (one off-lattice outlier drags a plain circular mean), refined over
the explained subset. A peak is explained within ±0.75″. Selection: most peaks
explained, then lower RMS; RMS ties within 0.05″ go to the **larger** pitch, because
24″ evidence is always also 12″ evidence and the conservative claim wins.

Honest limits, tested: with 4 peaks and ±0.3″ position error, 16.0″ vs 15.748″ is
genuinely ambiguous (0.252″ per interval); the suite asserts the answer is one of the
two neighbors and nothing wilder. At ±0.12″ jitter recovery is exact.

**Dense irregular refusal**: ≥4 peaks with median nearest-neighbor spacing under 8″
is a plaster-lath or metal-stud signature — the tightest real stud pitch is 12″, so
nothing that dense is a lattice. Pitch reports null and confidence caps at POSSIBLE.

## 4. Confidence (SPEC §4.1.7, ADR-005) — `confidence.ts`

`SNR = prominence / σ`, per event:

| state | trigger |
|---|---|
| STRONG | SNR ≥ 8, bipolar confirmed, FIELD tier |
| LIKELY | SNR 5–8, or STRONG conditions on PROXY (the Tier B cap) |
| POSSIBLE | SNR 3.5–5 |
| NOISE | below threshold / nothing found |
| UNRELIABLE | any environment guard fired |

Scan confidence = best event state, capped by: PROXY → LIKELY (ADR-005), dense
irregular → POSSIBLE, any guard → UNRELIABLE.

## 5. Environment guards (SPEC §4.1.6) — thresholds and reasons

| guard | fires when | why this number |
|---|---|---|
| `WALL_HOT` | whole-trace robust σ > 1.8 µT (FIELD) / 2.5° (PROXY) | The robust MAD floor *is* "elevated across the whole sweep with no isolated peaks": isolated peaks do not move the MAD. 1.8 µT ≈ 15× post-filter sensor noise, above the densest legitimate fastener carpet in the corpus (plaster fixture σ ≈ 1.6) and below the mildest metal wall (σ ≈ 2.5). |
| `SATURATED` | ≥3 samples (or >1%) with \|B\| > 120 µT | ~2× the strongest Earth field; something large and magnetic is near the sensor. |
| `MAGNETIC_ACCESSORY` | median \|B\| > 90 µT | Earth is 25–65 µT everywhere on the planet; a median in the nineties is a magnet riding the phone (MagSafe, wallet, mount). |
| `SWEEP_TOO_FAST` | any anchor segment > 6.0 in/s | 2× the paced 3 in/s; lobes smear into the smoothing window and positions stop meaning anything. |
| `RATE_COLLAPSE` | median sample interval implies < 12 Hz | At 6 samples/lobe the bipolar shape is still resolvable; below that it aliases. |

**Any guard ⇒ UNRELIABLE and an empty peak list.** The spec requires suppression for
the first three; this implementation also refuses positions under `SWEEP_TOO_FAST`
and `RATE_COLLAPSE` because a smeared or aliased position is a fiction with a marker
on it (SPEC §15.3: prefer refusing to guessing). FIELD-magnitude guards never run on
PROXY traces — degrees are not microtesla.

## 6. Ellipsoid calibration (SPEC §4.6.1) — `calibration.ts`

Model: true field on a sphere radius R; hard iron adds offset **b**; soft iron applies
a symmetric distortion **A**. Measurements lie on `(x−b)ᵀM(x−b) = c`, `M = A⁻ᵀA⁻¹`.

Fit pipeline (all linear algebra in `linalg.ts`, in-repo):

1. Least-squares quadric `xᵀMx + 2vᵀx = 1` → 9×9 normal equations → Gaussian
   elimination with partial pivoting.
2. Center `b = −M⁻¹v`. Scale `c = 1 + bᵀMb`. When b pushes the origin outside the
   ellipsoid, the "=1" normalization makes both M and c negative — M/c stays positive
   definite either way, so the ellipsoid test is the eigenvalues of M/c, **not** the
   sign of c.
3. Jacobi eigendecomposition of `M/c` → semi-axes `rᵢ = 1/√λᵢ` → correction
   `W = Q·diag(r̄/rᵢ)·Qᵀ`, `r̄ = ∛(r₁r₂r₃)` — maps the ellipsoid to a sphere of
   radius r̄ while preserving mean field magnitude.
4. Outputs match `CalibrationProfile.mag`: `hardIron` b, `softIron` W, `residual`
   (RMS sphericity error / r̄), `coverage` (octant hit fraction around b).

Degenerate data (planar, insufficient rotation) **fails with a reason** instead of
returning a garbage matrix. Measured accuracy (200 seeded random distortions,
soft-iron eigenvalues 0.8–1.25, |b| ≤ 52 µT, 0.25 µT noise): worst hard-iron error
0.98 µT, worst sphericity residual 2.4% — see `docs/accuracy-dsp.md`.

## 7. Determinism

No `Math.random`, no `Date.now` anywhere in `src/dsp/` or the worker. All synthetic
randomness flows through mulberry32 with fixed seeds (`synth.ts`); two runs of any
pipeline function on the same trace are byte-identical (`dsp-guards.test.ts`).

## 8. Every accuracy number, traced to its test

| claim | test |
|---|---|
| zero crossing within 0.25″ on the seed; amplitude off by >0.75″ | `tests/unit/zero-crossing.test.ts` (frozen) |
| every fixture's expected block reproduced by the pipeline | `tests/fixtures.verify.test.ts` (frozen) |
| precision/recall vs SNR curve | `tests/unit/dsp-accuracy.test.ts` |
| confidence ↑ monotone with true SNR | `tests/unit/dsp-accuracy.test.ts` |
| blank-wall noise never reaches STRONG; ≤0.42 false events per 10 s sweep | `tests/unit/dsp-peaks.test.ts` |
| hard iron recovered < 1.5 µT, sphericity < 3% over 200 distortions | `tests/unit/dsp-calibration.test.ts` |
| 16″/24″ recovery incl. missing + spurious fasteners; dense refusal ×100 seeds | `tests/unit/dsp-spacing.test.ts` |
| SG9 coefficients, DC gain, zero phase, noise gain 0.505 | `tests/unit/dsp-filters.test.ts` |
| guard thresholds and suppression behavior | `tests/unit/dsp-guards.test.ts` |
