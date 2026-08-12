# DECISIONS — architecture decision records

Format: ADR-N — title. Context / Decision / Consequences. Newest last. Cross-boundary changes
between subagent territories require an entry here before the change lands.

---

## ADR-001 — The app ships as SQUARE, not CORNER

**Context.** `kit/SPEC.md` line 2 says "App name: **CORNER**", but every other artifact in the kit
says SQUARE: BRAND.md ("Name: SQUARE", "tool #3 is called CORNER *so the app name and a tool name
never collide*"), `manifest.webmanifest` (`"name": "SQUARE"`), `head-snippet.html` (`<title>SQUARE
— is it square?`), the icon set, KIT-MANIFEST.md, README.md. If the app were named CORNER it would
collide with tool #3 — exactly the collision BRAND.md exists to prevent. The SPEC header line has
the signature of a stray `rename.sh` pass over the doc.

**Decision.** App name SQUARE. Tool #3 stays CORNER. Tool #2 stays LEVEL. `rename.sh` not run.

**Consequences.** All kit assets used verbatim with zero edits; copy follows BRAND.md.

## ADR-002 — Zero-dependency toolchain: Vite + TypeScript strict + Vitest; hand-rolled service worker

**Context.** SPEC mandates zero entries in `dependencies` and permits dev dependencies. A service
worker generator (workbox) is allowed by the spec but adds a build-time dependency surface for
something small.

**Decision.** `dependencies: {}` — enforced by a unit test that reads package.json. Dev deps:
`vite`, `typescript`, `vitest` (+ `@types/node` for build scripts). The service worker is written
by hand; the precache list is generated at build time by a small in-repo Vite plugin that emits
`sw.js` with the hashed asset manifest baked in. Playwright e2e scaffolding is included but the
heavy visual-regression matrix is out of scope for this environment (PLAN §7.5).

**Consequences.** All math implemented in-repo (svd, ellipsoid fit, quaternions, homography,
peaks, rational arithmetic) and unit-tested, per spec. SW stays ~100 lines and auditable.

## ADR-003 — Shared contracts are lead-owned files; subagents import, never redefine

**Context.** Risk R1: parallel agents drifting the §8/§3.3 contracts.

**Decision.** `src/sensors/types.ts` (CapabilityReport, MagSample, ImuSample, Orientation,
SensorSource, MagTier) and `src/types.ts` (Measurement, CalibrationProfile, warning keys,
confidence states) are written in Phase 0 by the lead and are read-only for all subagents.
`Measurement.uncertainty` and `.confidence` are non-optional. Warning keys are a closed union:
`WALL_HOT | MAGNETIC_ACCESSORY | SWEEP_TOO_FAST | RATE_COLLAPSE | SATURATED | UNCALIBRATED |
GYRO_DRIFT | LENS_UNCALIBRATED | POOR_GEOMETRY`.

**Consequences.** A bare number has no render path; a warning invented ad hoc doesn't compile.
Changing a contract requires an ADR here plus a lead-run full-suite pass.

## ADR-004 — The three load-bearing tests are frozen before implementation

**Context.** Prompt and SPEC §10.1 require test-first on real math, with three named tests:
synthetic-projection ground truth (≤0.3°), compound-miter canonicals (35.26/30.00, 31.62/33.86,
0/0), and zero-crossing-not-amplitude fastener position on the seed fixture (3.90″/20.02″ vs
truth 4.00″/20.00″; amplitude lands ~1″ off on the wrong side of the stud edge).

**Decision.** All three are committed in Phase 0, red, before any solver exists. Subagents may
not edit them. The zero-crossing test asserts the amplitude estimator's *failure* as well as the
zero-crossing estimator's success, so the wrong estimator can't quietly become the shipped one.

**Consequences.** If a future change makes the amplitude estimator pass, the test is broken, not
the algorithm — exactly as SPEC §4.1.2 6b instructs.

## ADR-005 — Tier NONE first; capability is consumed, never assumed

**Context.** SPEC §2.2: raw magnetometer is Chromium/Android flag-gated; iOS has none. A build
that assumes FIELD is broken on most phones.

**Decision.** Build order within SCAN: MANUAL STUD MODE (pure arithmetic) → capability probe and
honest disable copy → Tier B heading-proxy → Tier A. Every tool receives a `CapabilityReport` and
renders its degraded state deliberately. Spec contradiction resolved: §2.2 says Tier B caps
confidence at "possible", §4.1.7's table says STRONG conditions on Tier B map to LIKELY. The
§4.1.7 table is the operational contract, so **Tier B caps at LIKELY; STRONG requires Tier A**.
UNRELIABLE beats a guess everywhere.

**Consequences.** The app is never a blank screen on any device; iOS users get LEVEL, CORNER,
LAYOUT, BEVEL, CALIBRATE, LOG plus manual SCAN and (when heading is available) Tier B.

## ADR-006 — Position from paced/anchored sweeps only; never accelerometer double-integration

**Context.** SPEC §4.1.4 forbids double-integrating accelerometer for position (drifts uselessly).

**Decision.** Three sweep modes as specified: MARK-ON-BEEP (default, no position math), PACED
(time→distance after a declared span), TWO-POINT ANCHOR (linear map between anchor taps). The
fixture schema's `anchors` array is the same mapping, so replay and live share one code path.

**Consequences.** Distances shown only after a span is declared; before that the ribbon is in
time units and says so.

## ADR-007 — Complementary filter first; Madgwick behind a flag

**Context.** SPEC §4.2.1 allows either, orders complementary first.

**Decision.** Complementary filter (α≈0.02 at 60 Hz) is the shipped fusion. A Madgwick
implementation lands only if fixture A/B shows it wins, behind a flag, off by default.

**Consequences.** Simpler, testable against the six cardinal orientations; drift bounded by the
motion gate rather than by filter sophistication.

## ADR-008 — Orchestration mapped to this session's Agent tool

**Context.** SPEC §12 assumes long-running parallel subagents across multiple sessions. This
build runs in one remote session with the Agent tool available.

**Decision.** Phases keep their gates and their file-ownership boundaries. Phase 1 fans out
A2/A3/A4 (+A7 shell) as parallel subagents with charters quoted verbatim from §12 and explicit
owned-path lists; Phase 2 fans out A5/A6/A8 (+A13 guides). The lead (this session) is A1, A10 at
gates, and the integrator; A11 runs as a dedicated adversarial pass before deploy. If a subagent
underdelivers, the lead redoes the work rather than gate-waiving it.

**Consequences.** Same guarantees as the spec's plan (no cross-boundary edits, gates hold),
compressed to the session's shape. Honest scope notes live in PLAN §7.5.

## ADR-009 — Compound miter derived from rotation matrices; spec formula treated as a candidate

**Context.** SPEC §4.5.2 explicitly distrusts its own bevel formula (`asin(cos S · cos D)` is the
*candidate*; the canonical table is the truth).

**Decision.** `miter.ts` constructs the geometry: crown cross-section at spring angle S, corner
bisecting plane for corner angle C, cut plane expressed in the saw frame as table rotation
(miter) + blade tilt (bevel). The canonical test values arbitrate. The nested (in-position)
setting is derived the same way and labeled distinctly on the saw card, because handing a
carpenter the wrong family wastes a stick of molding.

**Consequences.** If derivation and candidate formula disagree, the derivation + canonicals win;
PHYSICS.md documents the derivation.

## ADR-010 — The ghost bob wears currentColor, not orange

**Context.** SPEC §7.5.2 says the LEVEL out-of-tolerance state shows "the same bob silhouette at
15% opacity"; the shipped bob is orange. But §7.1's orange rule is absolute: orange marks a value
a sensor is producing right now, and nothing static or decorative ever wears it. The ghost bob is
the *gravity reference* the live reading is compared against — a reference, not a reading.

**Decision.** `ghostBob()` renders in currentColor at 15% opacity. The orange rule outranks the
literal reading of §7.5.2. (Raised by A7; adopted at Gate 1.)

**Consequences.** Orange stays perfectly reliable as "live measured value" everywhere in the app.

## ADR-011 — DSP guard and threshold decisions beyond the spec text (A2, Gate 1)

**Context.** Implementing §4.1.2/§4.1.6 exposed places where the letter of the spec under-serves
its own honesty charter.

**Decisions.**
1. Peak suppression widened: warnings SWEEP_TOO_FAST and RATE_COLLAPSE also suppress reported
   positions (spec mandated suppression only for WALL_HOT / MAGNETIC_ACCESSORY / SATURATED).
   Smeared or aliased positions are fictions; §15.3 wins.
2. Detection noise floor uses whole-trace MAD; the trailing-3 s form ships alongside for the live
   ribbon. A trailing window that contains the first fastener inflates the floor exactly where the
   first detection must happen.
3. Two threshold additions (never relaxations): a physical prominence floor (0.4 µT field /
   0.5° proxy, from §4.1.1's 0.5–8 µT anomaly range) and a derivative-of-Gaussian shape gate at
   the physically expected lobe width. Blank-wall false events dropped 990 → 84 per 200 traces,
   and noise can never fabricate STRONG (max false SNR < 8, tested).
4. DENSE_SPACING_IN = 8″: median nearest-neighbor spacing under 8″ cannot be a stud lattice
   (tightest real pitch is 12″) → plaster/metal signature, confidence capped.
5. 16.0″ vs 15.748″ (400 mm) lattice candidates differ by 0.252″ per interval — legitimately
   indistinguishable at ±0.3″ peak error with ≤4 peaks. Documented and tested as ambiguous rather
   than pretended otherwise.
6. The tierB fixture carries three fasteners over 40″ (charter said two): with two peaks, one
   interval cannot honestly discriminate the pitch candidates.

**Consequences.** All encoded in fixtures and tests; docs/physics-dsp.md carries justifications.

## ADR-012 — DEMO fidelity per tool

**Context.** §7B.4 wants every tool to DEMO by replaying a bundled trace through the real
pipeline. The trace schema is magnetometer-shaped; CORNER/LEVEL/BEVEL/LAYOUT measure with other
sensors.

**Decision.** SCAN demos replay the shared fixture corpus (strict §7B.4). LEVEL and BEVEL demos
drive the real fusion/capture pipeline with deterministic synthesized IMU streams, labeled
SYNTHETIC. CORNER and LAYOUT demos run worked examples through the real solvers (the same
projection math the ground-truth suite uses). Every demo surfaces its synthetic provenance.

**Consequences.** No demo bypasses the real pipeline anywhere; the strict fixture-unification
test applies to SCAN, where the corpus exists.

## ADR-013 — Gate 2 integration rulings

**Context.** Five Phase 2 agents landed with flagged judgment calls needing a single ruling.

**Decisions.**
1. **Saved values do not wear orange.** LOG renders history through `recordedEl` — same
   mandatory unit + ±/confidence as `measuredEl`, ink instead of orange. Orange means "a sensor
   is producing this now" (§7.1); a recorded reading is history. (Raised by A8.)
2. **Uncalibrated FIELD caps at LIKELY with a standing UNCALIBRATED banner** rather than blanket
   UNRELIABLE: detrending removes hard-iron DC and the accessory guard catches gross offsets, so
   total refusal would overclaim the problem. STRONG still requires calibration. Replayed
   fixtures are exempt — they replay under their recorded conditions. (Raised by A6.)
3. **`CalibrationProfile.levelBias` is in degrees.** Set by A5, honored by CALIBRATE, pinned by
   test on both sides.
4. **Demo registry split**: only fixture-backed demos live in `DEMO_SPECS` (where the corpus
   test enforces the fixture link); synthetic-stream and worked-example demos (ADR-012) stay in
   their tools' own registries with the same mandatory synthetic labeling. A6's three
   fixture-backed additions merged into `DEMO_SPECS`; glossary additions from all seven tools
   merged into `GLOSSARY` (spread-first, base canonical).
5. **First run is the lean form of §7B.2**: a home panel offering the SCAN guided run (which
   itself sequences permissions → sweep → first detection) plus an always-working, remembered
   "Skip setup". The full-grid lockout is deliberately NOT implemented: "never trap anyone"
   outranks it, and a lockout tuned blind (no real device in this environment) risks exactly
   that. Recorded as a known §7B.2 partial in ACCURACY/HONESTY notes.
6. **Guidance fading storage**: LOG self-wires the warmed IDB adapter; other tools use the
   localStorage default. Both converge through the adapter's adoption path (kv wins). Accepted;
   unifying in main.ts is a later cleanup, not a correctness issue — lost guidance state re-shows
   guidance, the safe direction.
7. **A3b implementation notes accepted**: per-routine calibration ages come from CALIBRATE's
   outcome store until `CalibrationProfile` grows per-part timestamps; annotated corner photos
   live in a tool-local IDB store pending a media seam in logStore.

**Consequences.** All rulings encoded in code or tests where they bite; no open contract drift
between the five Phase 2 deliveries.
