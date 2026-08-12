# SCAN / DSP measured accuracy (A2)

Honest numbers only: every figure below is produced by a deterministic, seeded test
in this repo and regresses if the pipeline changes. Nothing here is a hope.
This file feeds `ACCURACY.md`. Method details: `docs/physics-dsp.md`.

## Peak detector: precision/recall vs true SNR

Synthetic dipole sweeps through the full pipeline (`analyzeMagTraceDetailed`):
24″ at 3 in/s, 40 Hz, one fastener at 10.00″, drifting pedestal, 0.4 µT/axis noise,
50 seeded traces per SNR level. **True SNR** = lobe amplitude ÷ post-filter noise
floor (0.505·σ_raw, the Savitzky-Golay window-9 white-noise gain). A detection is
true within ±0.75″ of the fastener. "LIKELY+" counts only detections the app would
report as LIKELY or better (measured SNR ≥ 5).

Source: `tests/unit/dsp-accuracy.test.ts` — the test prints this table; copy it here
when it changes.

| true SNR | recall | precision (all) | precision (LIKELY+) | mean detected SNR | mean \|err\| | mean confidence rank |
|---|---|---|---|---|---|---|
| 2 | 0.78 | 0.62 | 0.81 | 5.3 | 0.19″ | 1.58 |
| 3 | 0.96 | 0.71 | 0.92 | 6.1 | 0.16″ | 1.96 |
| 4 | 0.96 | 0.72 | 0.92 | 6.5 | 0.10″ | 2.00 |
| 5 | 1.00 | 0.83 | 1.00 | 7.0 | 0.10″ | 2.08 |
| 6 | 1.00 | 0.78 | 1.00 | 7.6 | 0.08″ | 2.32 |
| 8 | 1.00 | 0.81 | 1.00 | 8.8 | 0.06″ | 2.80 |
| 10 | 1.00 | 0.88 | 0.98 | 9.7 | 0.06″ | 2.98 |
| 12 | 1.00 | 0.91 | 1.00 | 11.1 | 0.05″ | 2.98 |

Confidence rank: NOISE/UNRELIABLE 0 · POSSIBLE 1 · LIKELY 2 · STRONG 3.

How to read it, honestly:

- **Recall saturates from SNR 5** and is already high at SNR 3: the bipolar pairing
  uses both lobes, so the effective evidence is roughly twice the single-lobe height.
- **"Precision (all)" includes POSSIBLE-grade detections.** Those exist by design —
  POSSIBLE means "something's there, sweep again to confirm" — and they are where
  nearly all false claims live. What the app calls **LIKELY or better is right ≥ 92%
  of the time from SNR 3 up, and ≥ 98% from SNR 5 up.**
- **Mean detected SNR at low true SNR is survivor-biased** (only lucky alignments
  cross the bar); monotonicity is what the test asserts, and it holds.
- **Position error** of true detections: 0.05–0.19″ mean — an order of magnitude
  inside the ±0.75″ stud half-width.

## Blank-wall false positives (the number that matters in MARK-ON-BEEP mode)

200 seeded blank sweeps (0.22 µT noise — the seed fixture's sensor grade), full
detector settings. Source: `dsp-peaks.test.ts`, "statistical honesty" test.

- **84 false events / 200 ten-second sweeps** ≈ 0.42 per sweep, all POSSIBLE/LIKELY grade.
- **Max false SNR < 8: noise has never fabricated a STRONG** across the corpus.
- A quiet sensor (0.1 µT) produces **zero** false events — the 0.4 µT physical
  prominence floor is below no real fastener (SPEC §4.1.1: 0.5–8 µT).

## Position estimators on the frozen seed fixture

Truth: fasteners at 4.00″ and 20.00″ (stud half-width 0.75″).
Source: `tests/unit/zero-crossing.test.ts` (frozen, ADR-004).

| estimator | recovered | error | verdict |
|---|---|---|---|
| **zero crossing** (shipped) | 4.003″, 20.016″ | 0.003″, 0.016″ | inside the stud |
| amplitude extremum (kept to be provably wrong) | 3.225″, 18.975″ | 0.775″, 1.025″ | **outside the stud edge — a hole beside the stud** |

## Lattice inference

Source: `tests/unit/dsp-spacing.test.ts`.

- 16″/24″ recovery with 4 peaks and ≤±0.12″ jitter: **100/100 seeds exact**, including
  a missing fastener and a spurious one.
- At ±0.3″ jitter, 16.0″ vs 15.748″ (400 mm) is genuinely ambiguous — the candidates
  differ by 0.252″ per interval. The pipeline reports one of the two neighbors, never
  anything wilder. Tape-check the second stud before committing to a long run.
- Dense random patterns (1.5–6″ gaps): **100/100 seeds refused** (no pitch claimed).

## Magnetometer calibration (ellipsoid fit)

Source: `tests/unit/dsp-calibration.test.ts` — 200 seeded random distortions,
soft-iron eigenvalues 0.8–1.25, hard iron up to ~52 µT, 0.25 µT sample noise,
300 samples per fit.

- Hard-iron recovery: **worst error 0.98 µT** (bound asserted: < 1.5 µT).
- Sphericity after correction: **worst residual 2.4%** (bound asserted: < 3%;
  the CALIBRATE pass bar is 5%).
- Planar (degenerate) data: fit **refuses with a reason**, never returns a matrix.
- Half-space sweeps report partial octant coverage — the CALIBRATE screen shows the gap.

## Fixture corpus outcomes (regression net)

Source: `tests/fixtures.verify.test.ts` (frozen) — every trace replayed through the
real pipeline, positions, pitch, confidence, and warnings asserted exactly.

| fixture | outcome the pipeline reproduces |
|---|---|
| `drywall-16oc-synthetic` (seed, read-only) | 4.003″/20.016″, pitch 16″, STRONG, no warnings |
| `drywall-24oc-noisy` | 3.34″/27.57″, pitch 24″, LIKELY (SNR 7.8/7.3), no warnings |
| `metal-stud-hot` | no peaks, no pitch, UNRELIABLE, `WALL_HOT` |
| `plaster-lath-dense` | 4 of 12 nails found, no pitch, POSSIBLE (dense-pattern cap), no warnings |
| `magsafe-attached` | two real fasteners present, **none reported**, UNRELIABLE, `MAGNETIC_ACCESSORY` |
| `sweep-too-fast` | no peaks, UNRELIABLE, `SWEEP_TOO_FAST` |
| `tierB-heading-proxy` | 3.00″/19.06″/35.02″, pitch 16″, **LIKELY (capped — SNR 15–18 would be STRONG on FIELD)**, no warnings |

## What SCAN cannot do (measured, not disclaimed)

- Plaster/lath: finds strong nails only (4 of 12 in the fixture), refuses the lattice.
- Metal studs: refuses entirely — that is the correct output.
- With a magnet on the phone: refuses even though real fasteners are in the trace.
- Above 6 in/s sweep speed: refuses positions.
- PROXY tier never claims STRONG regardless of signal quality (ADR-005).
