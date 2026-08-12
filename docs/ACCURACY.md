# ACCURACY — what this app can honestly claim

Every number in this file traces to a named test or a recorded field session, or it does not
appear (SPEC §15.6). "Expected" figures below come from synthetic ground truth; they get replaced
by measured figures after the `docs/FIELD-TEST.md` protocol runs on a real device — and if the
wall disagrees with the synthetic claim, the wall wins.

Status legend: **verified-synthetic** (green test against synthetic ground truth, named),
**unverified** (stated design target, no test yet — not shown in the app as a claim),
**field-measured** (from a real session, dated, device noted).

## SCAN — fastener position

| Claim | State | Basis |
|---|---|---|
| Zero-crossing estimator error ≤ 0.25″ on the seed trace (truth 4.00″/20.00″) | verified-synthetic | `tests/unit/zero-crossing.test.ts` |
| Amplitude estimator misses by > 0.75″ (why the app doesn't use it) | verified-synthetic | `tests/unit/zero-crossing.test.ts` |
| 16″/24″ on-center lattice recovery, phase-locked, ≥2 peaks within ±0.75″ | verified-synthetic | `tests/fixtures.verify.test.ts` |
| Detector precision/recall vs. SNR | verified-synthetic | `docs/accuracy-dsp.md` (published curve) |
| Real-wall position error | — | pending `FIELD-TEST.md` §2 |

Tier caps: PROXY (heading-deflection) confidence never exceeds LIKELY. Tier NONE reports nothing —
MANUAL mode does arithmetic on references you supply and labels every output ENTERED/DERIVED.

What SCAN cannot do: see wood, plastic, or PEX; distinguish a screw from any other small ferrous
object; work over metal studs, dense plaster lath, or near live conduit, ductwork, or rebar
(it warns instead); work with a magnetic case attached (it tells you to remove it).

## LEVEL

| Claim | State | Basis |
|---|---|---|
| Reversal-calibration algebra removes sensor bias exactly | verified-synthetic | `tests/unit/level-math.test.ts` |
| Pre-reversal display claim ±0.5°, post-reversal ±0.15° | unverified until field | `FIELD-TEST.md` §3 |
| Motion gate: no HOLD reading until 400 ms of stillness | verified-synthetic | orientation fusion tests |

## CORNER — photo angles

| Claim | State | Basis |
|---|---|---|
| Solver recovery ≤ 0.3° on noise-free synthetic projections, θ ∈ [70°,110°], 10 poses | verified-synthetic | `tests/unit/angle-solver-groundtruth.test.ts` |
| Monte-Carlo ± band contains truth ~90% of the time at σ = 2 px | verified-synthetic | montecarlo calibration test |
| Uncalibrated lens: expect ±1.5–3° (displayed as such) | unverified until field | `FIELD-TEST.md` §4 |
| Calibrated lens: expect ±0.3–0.8° | unverified until field | `FIELD-TEST.md` §4 |
| Degenerate geometry refuses rather than reports | verified-synthetic | groundtruth test, refusal case |

## LAYOUT

| Claim | State | Basis |
|---|---|---|
| Exact rational arithmetic — zero drift over 100 cumulative marks | verified-synthetic | `tests/unit/units.test.ts` |
| Photo-scaled layout uncertainty grows with span ratio and is displayed | pending Phase 2 | — |

## BEVEL

| Claim | State | Basis |
|---|---|---|
| Compound miter canonicals exact (35.26/30.00, 31.62/33.86, 0/0) | verified-synthetic | `tests/unit/miter-canonical.test.ts` |
| Gravity capture valid only with a horizontal shared edge (enforced) | pending Phase 2 | — |
| Gyro drift budget: refuse after 20 s without magnetic yaw | pending Phase 2 | — |

## CALIBRATE

| Claim | State | Basis |
|---|---|---|
| Ellipsoid fit recovers synthetic hard/soft iron within tolerance | verified-synthetic | dsp calibration tests |
| Case-magnet detection at hard-iron offset > 40 µT | verified-synthetic | fixture `magsafe-attached` |
