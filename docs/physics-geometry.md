# Geometry & vision physics — CORNER's angle solver, intrinsics, and uncertainty

Owner: A3 (Geometry/Vision). Covers `src/geometry/{vec,quat,mat,homography,vanishing,angleSolver,intrinsics,montecarlo}.ts` and `src/workers/solver.worker.ts`.
Every accuracy claim in this document traces to a named test (SPEC §15.6); the traceability table is at the end.

---

## 1. Camera model and assumptions

Pinhole camera with intrinsic matrix

```
K = [ f  0  cx ]
    [ 0  f  cy ]
    [ 0  0  1  ]
```

Assumptions, stated in the UI whenever a photo angle is displayed (SPEC §4.3.1.1):

1. **Square pixels** — one focal length `f`, in pixels.
2. **Principal point at the image center** — `cx = W/2`, `cy = H/2`.
3. **Zero skew.**
4. **No lens distortion model** in the solver itself. Uncalibrated accuracy expectation ±1.5–3°, calibrated ±0.3–0.8° (SPEC §2.3.4); the `LENS_UNCALIBRATED` warning key carries the state.

Pixel coordinates: x right, y **down** (image convention). Camera frame: x right, y down, z forward through the lens. A world point `X` in camera coordinates projects to `p = K·X` (homogeneous), `(x, y) = (p₁/p₃, p₂/p₃)`.

## 2. Quaternion / Euler conventions (`quat.ts`)

- Hamilton product; `qMultiply(a, b) = a⊗b` composes as `R(a⊗b) = R(a)∘R(b)` (b first).
- `qRotateVec(q, v) = q ⊗ (0,v) ⊗ q*` — active, right-handed rotation of the vector.
- Euler triple is **intrinsic Tait–Bryan Z-Y′-X″** (yaw, then pitch, then roll), radians: `q = qz(yaw) ⊗ qy(pitch) ⊗ qx(roll)`. `qFromEuler` is built by composition of axis-angle quaternions, not by transcribed formulas.
- Extraction (`qToEuler`): `pitch = asin(2(wy − xz))` (clamped), `roll = atan2(2(yz + wx), 1 − 2(x² + y²))`, `yaw = atan2(2(xy + wz), 1 − 2(y² + z²))`.
- **Gimbal lock** (|pitch| = 90°): only `yaw − roll` (at +90°) / `yaw + roll` (at −90°) is defined, and the generic expressions degenerate to `atan2(0, 0)`. The lock branch sets `roll = 0` and recovers the combined angle from the quaternion components directly (`yaw = 2·atan2(∓x, w)`; derivation in the source comment), so `q → euler → q` always reconstructs the same rotation. Verified over 10⁴ seeded random rotations and at both exact lock poles.

## 3. Homography by normalized DLT (`homography.ts`)

`homographyUnitSquareToQuad` maps the unit square `(0,0),(1,0),(1,1),(0,1)` to the marked image quad `P0,P1,P2,P3` (same order as the CORNER contract: P0 corner, P1 along family one, P2 diagonal, P3 along family two).

1. **Hartley normalization** of both point sets: translate the centroid to the origin and scale so the mean distance from it is √2 (`T_src`, `T_dst`). This keeps the DLT system's entries O(1) regardless of where in the frame the quad sits — without it the 8×8 system mixes units of 1 and 10⁶ and the pivots mean nothing.
2. With `h₃₃ = 1` in normalized space, each correspondence `(X,Y) → (x,y)` contributes two rows:
   `x(h₇X + h₈Y + 1) = h₁X + h₂Y + h₃` and `y(h₇X + h₈Y + 1) = h₄X + h₅Y + h₆`.
   The resulting **8×8 system is solved by in-repo Gaussian elimination with partial pivoting** (`solveLinear`, zero dependencies per SPEC §0). Fixing `h₃₃ = 1` is safe here because the quad is pre-validated convex and consistently ordered, so the image of the source centroid is finite.
3. Denormalize `H = T_dst⁻¹ · H_n · T_src` and scale to unit Frobenius norm. H is homogeneous: scale and global sign carry no meaning.

**Degeneracy detection — two independent detectors, because they catch different failures:**

- **Pivot ratio** `min|pivot| / max|pivot|` of the normalized system. Fails (`< 1e-10`) when the system itself is singular — repeated points, degenerate correspondences.
- **`|det H|` at unit Frobenius norm** (`< 1e-10` fails). A rank-2 H — the whole plane projected onto a line — *satisfies four collinear-target correspondences exactly with healthy pivots*, so the pivot ratio alone cannot see the most important degenerate case (all marks on a line). The determinant can: it is 0 there and ≥ ~10⁻⁶ for every usable pixel-scale quad (measured floor over 500 seeded random convex quads: 6.9×10⁻⁶; condition proxy floor 0.15).

## 4. Homography → vanishing points (`vanishing.ts`)

The world edge families of the quad are the images of the unit square's axis directions. In homogeneous coordinates the point at infinity of the source x-axis is `[1,0,0]ᵀ`, so its image — the vanishing point of edge family one — is

```
v₁ = H·[1,0,0]ᵀ = column 0 of H,   v₂ = H·[0,1,0]ᵀ = column 1 of H.
```

**Everything stays homogeneous; we never divide by `v₃`.** A fronto-parallel edge family has `v₃ = 0` exactly — the projected quad is a parallelogram, H is affine (bottom row `[0, 0, ·]`), and the vanishing point is a pure direction. That configuration is *valid and exact*, not an error (frozen test: `handles the fronto-parallel case`). What gets refused is the quad whose DLT is ill-conditioned or whose shape is degenerate — the "near-infinite in a numerically unstable way" of SPEC §4.3.1.6 always manifests as one of the §6 refusal triggers, never as a special case on `v₃`.

**Two-parallel-lines path** (SPEC §4.3.1.4a, `vanishingFromParallelSegments`): an image line through `p₁, p₂` is `l = p₁ × p₂`; two image segments whose world lines are parallel meet at `v = l₁ × l₂`. Nearly-parallel image lines put `v` far away — fine and correct. Refused (null) only when the construction has no information: a zero-length segment, or both segments on the *same* image line (`|l₁ × l₂| ≤ 1e-12·|l₁||l₂|`). Feeding these v's into `cornerAngleFromVanishingPoints` reproduces the quad path to < 10⁻⁶° on synthetic projections.

## 5. Back-projection and sign resolution

A vanishing point back-projects to the family's 3D direction in camera coordinates:

```
d = K⁻¹·v = [ (vx − cx·vw)/f,  (vy − cy·vw)/f,  vw ]
```

kept homogeneous (at `vw = 0` this is a direction parallel to the image plane) and then normalized. `d` is **sign-ambiguous** — H's columns carry an arbitrary projective scale, including sign — and the sign is exactly the obtuse/acute answer, so it is resolved from the image ordering, never guessed:

> **Rule.** Compute the homogeneous-safe image direction from the corner toward the vanishing point, `dirImg = (vx − P0.x·vw, vy − P0.y·vw)`. If `dirImg` opposes the image direction `P0→adjacent vertex`, flip `d`.

**Why this is correct** (`docs`-level sketch; the parametrization is in the source): the image of `X(t) = X₀ + t·D` has 1D projective coordinate `u(t) = (a + bt)/(z₀ + D_z t)`, so `u′(0) = (v − p₀)·D_z/z₀` where `v = dehom(K·D)`. With `z₀ > 0`:

- `D_z > 0`: the image point moves **toward** dehom(v); `dirImg = (v − p₀)·vw` with `vw = D_z > 0` — aligned.
- `D_z < 0`: the image point moves **away from** dehom(v); `dirImg` has the extra sign flip from `vw < 0` — still aligned.
- `D_z = 0`: `dirImg = (vx, vy)` is the image line direction itself — aligned.

So `dirImg` computed from the representative `v = K·d` is positively aligned with the image motion along `+d` in *all three cases*, which makes the flip test exact. The comparison refuses (POOR_GEOMETRY) instead of guessing when it is numerically ambiguous (|cos| < 0.05 between `dirImg` and the adjacent-edge direction — on the quad path the two are collinear by construction, so this only fires on numerical junk).

Finally `θ = acos(clamp(d̂₁·d̂₂, −1, 1))` in degrees, full (0°, 180°) range — **not** folded through `acos|·|`, which is what keeps 110° from collapsing to 70° (frozen test: `resolves obtuse vs acute`).

## 6. Refusal criteria (`POOR_GEOMETRY`) and thresholds

Refusing is a first-class outcome (SPEC §15.3). `cornerAngleFromQuad` refuses when any of the following trips. Thresholds live in `QUAD_LIMITS` (`angleSolver.ts`) and the H floors in `homography.ts`.

| # | Trigger | Threshold | Catches |
|---|---------|-----------|---------|
| 1 | Non-finite coordinates / invalid intrinsics | — | garbage input, `fPx ≤ 0` |
| 2 | Quad too small | longest edge < **8 px** | mis-taps |
| 3 | Merged vertices | shortest edge < **10⁻³ ×** longest | double-marked corner |
| 4 | Near-collinear vertex | \|sin(vertex angle)\| < **0.02** | marks on a line (frozen refusal case) |
| 5 | Non-convex / inconsistent order | mixed turn signs | bowtie marking, wrong corner order |
| 6 | Degenerate area | \|area\|/longest² < **5×10⁻³** | extreme foreshortening |
| 7 | DLT near-singular | pivot ratio < **10⁻¹⁰** (hard), < **10⁻⁸** (solver) | singular correspondence systems |
| 8 | H rank-deficient | \|det H\| < **10⁻¹⁰** at unit Frobenius | collinear targets that pass #7 |
| 9 | Sign resolution ambiguous | alignment \|cos\| < **0.05**, or vanishing point on the corner | numerically meaningless vanishing configuration |

Margins: the entire frozen ground-truth sweep (θ ∈ [70°,110°] × 10 poses) clears #4 by 40× (worst |sin| 0.81) and #6 by 88× (worst normalized area 0.44), asserted with ≥10× headroom in `geometry-anglesolver.test.ts` so the thresholds cannot silently creep up and eat valid geometry. Conversely, exact-at-infinity vanishing points (fronto-parallel) pass everything and recover θ to float precision — the refusals target *instability*, not *infinity*.

`validateQuadGeometry` (checks 1–6) is shared with `calibrateFromSheet`: a quad degenerate for the angle solve is degenerate for every planar solve.

## 7. Lens calibration from a known sheet (`intrinsics.ts`)

**Default (uncalibrated):** `f = (W/2)/tan(hFOV/2)` with hFOV = 67° unless the camera track reports one; `uncalibrated: true` rides along and the UI must say so (SPEC §4.3.2).

**Calibration:** photograph a US Letter (aspect 11/8.5) or A4 (297/210) sheet, mark the corners in CORNER order with P0→P1 the edge matching the aspect numerator. For a candidate focal `f`:

1. Back-project rays `rᵢ = K⁻¹·pᵢ = ((xᵢ−cx)/f, (yᵢ−cy)/f, 1)`; the world corners are `Xᵢ = λᵢ·rᵢ` with unknown depths `λᵢ > 0`.
2. The sheet is a rectangle, hence a parallelogram: `X₀ + X₂ = X₁ + X₃`. With the overall scale fixed by `λ₀ ≡ 1` this is a 3×3 linear system `λ₁r₁ − λ₂r₂ + λ₃r₃ = r₀` for `(λ₁, λ₂, λ₃)` (solved via `mat3Inverse`; non-positive depths invalidate the candidate `f`).
3. Rectified edges `u = X₁ − X₀`, `w = X₃ − X₀` give `aspect(f) = |u|/|w|`.
4. Solve `aspect(f) = sheetAspect` by log-grid search (121 points over f ∈ [0.1, 10]× the FOV-default guess) + golden-section refinement — the "1D search" option of SPEC §4.3.2.

**Residual quality metric:** the rectangle has a *second* metric constraint the fit never used — its corners are right angles. `squareResidualDeg = |90° − acos(û·ŵ)|` is therefore an independent check on the whole solve: ~10⁻¹⁴° on clean synthetic data, and it grows with marking error and real lens distortion. `aspectResidual` (how exactly the search met the target) is reported alongside.

**Refusals:** a fronto-parallel sheet makes `aspect(f)` constant — the view carries **no focal information** — detected as < 0.5% aspect swing across the entire bracket and refused with instructions to re-shoot at an angle (never an arbitrary f). Also refused: degenerate quads (shared `validateQuadGeometry`), no valid depth solve, or a "solution" pinned to the bracket edge.

Measured: exact recovery of f = 1100 (Letter) and f = 1450 (A4) on clean projections; under 1 px seeded marking noise, worst |Δf|/f = 4.1% over 40 trials (single-view sheet calibration is genuinely noise-sensitive; the CALIBRATE flow should advise a careful, zoomed marking pass).

## 8. Monte Carlo uncertainty (`montecarlo.ts`)

Per SPEC §4.3.3, run in the solver worker:

- Perturb each marked corner with Gaussian noise, σ = 2 px default (callers scale with zoom/resolution), via **Box–Muller over mulberry32** — fully deterministic per seed, no `Math.random` anywhere in the pipeline or tests.
- N = 500 re-solves through the *full* solver (validation + DLT + refusals included).
- Report `median ± half-width of the 5–95% interval`, displayed as e.g. `88.4° ± 0.6°`, basis `'montecarlo'` in the `Measurement` contract.
- **Refusals propagate:** if the base quad refuses, the result refuses; if > 25% of perturbed samples refuse, the surviving samples are a biased subset and the result refuses (`geometry is fragile under … px noise`) instead of reporting a cheerfully narrow band.
- The UI treats half-width > 2.5° as "geometry is poor, here's how to fix it" (SPEC §4.3.3) — that consumption is the CORNER tool's job.

**Calibration of the band** (SPEC §10.1): over 200 seeded trials (two poses × two true angles, marks = truth + 2 px noise), the reported band contained the truth **89.0%** of the time against the 90% nominal — asserted to stay in [82%, 98%].

Performance: one full solve ≈ 8 µs in Node on this container (~100k solves in < 1 s in the Monte Carlo suite), so N = 500 costs ~4 ms inside `solver.worker.ts` — far inside the §9 budget, and off the main thread regardless.

## 9. Accuracy traceability (SPEC §15.6: every number traces to a test)

| Claim | Measured value | Test |
|---|---|---|
| Noise-free angle recovery, θ ∈ [70°,110°] × 10 poses | worst error **1.14×10⁻¹³°** (bound asserted: 10⁻⁶°) | `geometry-anglesolver.test.ts` › *recovers within 1e-6° at 1° steps* |
| Frozen ground-truth bound (≤ 0.3°) | passes with ~12 orders of magnitude margin | `angle-solver-groundtruth.test.ts` (frozen, ADR-004) |
| Obtuse/acute resolution at every pose | 110° > 100°, 70° < 80°, all 10 poses | `geometry-anglesolver.test.ts` › *resolves obtuse vs acute at EVERY pose* |
| Fronto-parallel (v at infinity) stability | error < 10⁻⁹° | `geometry-anglesolver.test.ts` › *fronto-parallel … float precision*; frozen suite case |
| Refusal coverage of degenerate classes | 6 classes all refuse with `POOR_GEOMETRY` | `geometry-anglesolver.test.ts` › *refusals* block; frozen collinear case |
| Threshold headroom on valid geometry | area 88×, vertex-sin 40× above limits | `geometry-anglesolver.test.ts` › *clears every refusal threshold with ≥ 10× margin* |
| Homography corner interpolation / inversion | < 10⁻⁸ px over 500 seeded quads | `geometry-homography.test.ts` › *interpolates the four corners exactly* |
| Rank-deficiency floor separation | valid-quad min \|det H\| 6.9×10⁻⁶ vs floor 10⁻¹⁰ | `geometry-homography.test.ts` (same test, asserted > 10⁻⁸) |
| Two-parallel-lines path agrees with quad path | < 10⁻⁶° | `geometry-vanishing.test.ts` › *agrees with the homography-column vanishing points* |
| Quaternion euler round-trip (10⁴ rotations) | worst action error **1.8×10⁻¹⁴** | `geometry-algebra.test.ts` › *q → euler → q round-trips over 10⁴ seeded random rotations* |
| Gimbal-lock round-trip validity | < 10⁻⁹ action error at ±90° pitch | `geometry-algebra.test.ts` › *stays a valid rotation at gimbal lock* |
| Sheet calibration, clean input | f exact; square residual ~10⁻¹⁴° | `geometry-intrinsics.test.ts` › *recovers the true focal (Letter / A4)* |
| Sheet calibration under 1 px noise | worst \|Δf\|/f = **4.1%**, 40/40 solved | `geometry-intrinsics.test.ts` › *stays within a usable band under 1 px marking noise* |
| Monte Carlo band calibration | **89.0%** coverage vs 90% nominal (asserted ∈ [82, 98]%) | `geometry-montecarlo.test.ts` › *CALIBRATION* |
| Monte Carlo determinism | bit-identical per seed | `geometry-montecarlo.test.ts` › *bit-identical for the same seed*; worker echo in `geometry-anglesolver.test.ts` |

Numbers above are from this container's run; they are properties of the algorithms (double-precision float), not of hardware, and the asserted bounds in the tests are the contract.
