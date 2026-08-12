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
