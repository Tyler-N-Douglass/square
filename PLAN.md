# PLAN — SQUARE

> Lead engineer's plan of record. Source of truth for the build is `kit/SPEC.md`; this file is my
> interpretation of it, the risk register, the subagent assignments, and the phase gates. Decisions
> with alternatives are ADRs in `DECISIONS.md`.

## 1. Interpretation

**What this is.** A zero-dependency, offline-first PWA (Vite + strict TypeScript, no UI framework)
that does five measuring jobs with phone sensors — stud finding by magnetometer, level/plumb with
camera overlay, corner angles from a photo, repeat-spacing layout, and bevel capture/transfer —
plus CALIBRATE and LOG. Every number displayed carries a unit and a ± or a confidence state.
Honesty is the product: the app must refuse rather than guess, and degrade visibly, never silently.

**What decides the architecture.** Browser sensor reality (SPEC §2). Raw magnetometer exists only
on Chromium/Android behind a flag; iOS exposes heading only. So capability is probed at runtime,
every feature consumes a `CapabilityReport`, and the three tiers — FIELD, PROXY, NONE — are all
implemented, **NONE first**, so the app is never broken on any device. MANUAL STUD MODE (§4.1.9)
is a real tool, not a consolation screen.

**What the kit already provides (never regenerate):** icons, manifest, fonts (with patched µ and ′
— never re-subset), fonts.css, tokens.css, netlify.toml, head snippet, the trace schema, and one
verified seed fixture. The app name is SQUARE (ADR-001).

**The one artifact that multiplies.** The trace format (`tests/fixtures/SCHEMA.md`) is shared by
the replay harness, the regression suite, and the in-app DEMO walkthroughs. Fixtures ARE the
tutorial content; the tutorials cannot drift from tested behavior. Replay ships first because
every other agent depends on it.

**Guidance is co-equal (§7B).** Every tool ships its guided run and DEMO in the same change as the
tool. Every warning has an explainer (why / what to do / cost of ignoring). Every domain term is
in the glossary. The Field Manual is organized by task, not by feature.

## 2. Load-bearing tests, written before their implementations

These three are written and committed in Phase 0, before any solver code exists. Subagents make
them pass and may not edit them; A10 (me, at gates) owns them.

1. **Photo-angle synthetic ground truth** (`tests/unit/angle-solver-groundtruth.test.ts`) — build a
   virtual corner at known angles θ ∈ [70°,110°], project through known K from many poses, assert
   recovery within 0.3°.
2. **Compound-miter canonicals** (`tests/unit/miter-canonical.test.ts`) — 90° corner, 45/45 crown →
   miter 35.26°, bevel 30.00°; 52/38 → 31.62°, 33.86°; flat splice → 0/0. Implementation must be
   derived from rotation matrices, not the spec's candidate formula; continuity sweep over
   C ∈ [60°,180°], S ∈ [30°,60°] with no NaN and no jumps.
3. **Zero-crossing fastener position** (`tests/unit/zero-crossing.test.ts`) — against
   `tests/fixtures/drywall-16oc-synthetic.json`: the zero-crossing estimator recovers 3.90″ and
   20.02″ (truth 4.00″/20.00″); the amplitude estimator lands ~1″ off, on the wrong side of the
   stud edge, and the test asserts *both* facts so nobody "fixes" the wrong estimator.

## 3. Risk register

| # | Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| R1 | A subagent redefines a shared type and drifts the contract | High | High | I write all shared contracts in Phase 0 (`src/sensors/types.ts`, `src/types.ts`); agents import, never redefine; cross-boundary change requires an ADR; I diff every agent's output at the gate |
| R2 | Spec's candidate bevel formula is wrong and gets shipped as-is | Medium | High | Canonical-value test written first; implementation must derive from rotation matrices; A10 gate asserts exact values |
| R3 | Amplitude-peak estimator ships instead of zero-crossing (1″ error, wrong side of stud edge) | Medium | High | Load-bearing test #3 asserts both estimators' behavior against the seed fixture |
| R4 | App broken on iOS (no raw magnetometer, permission choreography) | High | High | Tier NONE built first; iOS `requestPermission` only from a user gesture; e2e mocks per tier |
| R5 | Fonts re-subset and patched µ/′ lost | Low | High | woff2 used verbatim from kit; unit check in CI that the files carry U+00B5/U+2032; LICENSE-NOTES honored |
| R6 | CSP/Permissions-Policy breaks workers or sensors only in production | Medium | High | Ship kit netlify.toml verbatim; test the built artifact (`vite preview`), not just dev; workers built as module workers from same origin |
| R7 | Silent degradation (rate collapse, stale calibration) reaches the UI | Medium | High | Confidence/warning states are non-optional in the `Measurement` type; A11 red-team pass at the end; every warning key has an explainer card |
| R8 | Session/context limits vs. spec scope (8–10 estimated sessions) | High | Medium | Phases compressed but gates kept; test-first math so correctness survives even where UI polish is thin; anything not shipped is listed honestly in PLAN §6 status, never claimed |
| R9 | Netlify deploy blocked from this environment | Medium | Low | Netlify MCP tools available; if deploy fails, README carries the two-line drag-`dist/` path and the repo connects cleanly via committed netlify.toml |
| R10 | Monte-Carlo/solvers jank the main thread | Medium | Medium | Workers for DSP and solvers from Phase 0 scaffolding; long-task budget in §9 checked at Gate 2 |
| R11 | Guidance deferred under time pressure ("Phase 3 bolt-on") | High | High | Per SPEC: a tool without its guided run and DEMO is not done — gate criterion at Phase 2, not Phase 3; DEMO reads the same fixture files the suite asserts |

## 4. Subagent assignment (SPEC §12 mapped to this session)

I am the lead: I orchestrate, hold gates, read every diff, and own A1 (sensor platform) plus the
three load-bearing tests. Verification (A10) authority stays with me at every gate; docs (A12)
are written continuously by whichever agent owns the formula, then audited by me.

| Agent | Phase | Owns (hard boundary) | Charter source |
|---|---|---|---|
| A1 Sensor Platform | 0 (me, solo) | `src/sensors/**` | SPEC §12 A1 |
| A2 DSP / Magnetics | 1 | `src/dsp/**`, `src/workers/dsp.worker.ts` | SPEC §12 A2 |
| A3 Geometry / Vision | 1 | `src/geometry/{vec,quat,mat,vanishing,angleSolver,intrinsics,montecarlo}.ts` | SPEC §12 A3 |
| A4 Craft Math | 1 | `src/geometry/{layout,miter,units}.ts`, `src/geometry/levelMath.ts` | SPEC §12 A4 |
| A7 Shell / Design System | 1 | `index.html`, `src/app/**`, `src/ui/components/**` | SPEC §12 A7 |
| A9 PWA / Deploy / Perf | 1 | `public/sw-*`, service worker, build config | SPEC §12 A9 |
| A13 Guidance & Learning | 1–2 | `src/guidance/**`, `src/tools/*/guide.ts` | SPEC §12 A13 |
| A5 Level & Overlay | 2 | `src/tools/level/**`, `src/ui/overlay/**` | SPEC §12 A5 |
| A6 Scan Experience | 2 | `src/tools/scan/**`, `src/ui/charts/**` | SPEC §12 A6 |
| A8 Persistence & Log | 2 | `src/tools/log/**`, `src/app/db.ts` | SPEC §12 A8 |
| A3/A4 (cont.) | 2 | `src/tools/{corner,layout,bevel,calibrate}/**` | SPEC §12 |
| A10 Verification | every gate | `tests/**` (three load-bearing tests frozen) | SPEC §12 A10 — veto power |
| A11 Red Team / Honesty | 3 | `docs/HONESTY-AUDIT.md` (read-only elsewhere; files issues) | SPEC §12 A11 |
| A12 Docs | 3–4 | `README.md`, `docs/**` | SPEC §12 A12 |

Rules: no subagent edits another's files; shared types live in files I own; cross-boundary needs
go through an ADR in `DECISIONS.md`; integration happens at gates only, by me, reading the diffs.

## 5. Phase gates

| Gate | Criteria (all must be green) |
|---|---|
| **G0** | Repo builds (`npm run build`); TS strict clean; Vitest runs; capability probe + §3.3 contracts committed; replay harness plays the seed fixture and drives a dummy readout; 7-route shell renders; SW precaches; the three load-bearing tests exist and are red (no implementations yet) |
| **G1** | Every §10.1 math test green: quat/mat round-trips, ellipsoid recovery, peak precision/recall, lattice fit, angle solver ≤ 0.3° on synthetic projections, miter canonicals exact, units round-trip; zero-crossing test green; no runtime deps |
| **G2** | All 7 tools usable; each has guided run + DEMO replaying a bundled fixture through the real pipeline; fixture corpus complete (`drywall-16oc`, `drywall-24oc-noisy`, `metal-stud-hot`, `plaster-lath-dense`, `magsafe-attached`, `sweep-too-fast`, `tierB-heading-proxy`) and `verify:fixtures` green; Tier NONE experience whole |
| **G3** | HONESTY-AUDIT closed: no number without unit+±/confidence; every warning explains itself; every permission denial has a recovery; measured/derived/entered visually distinct; zero network egress at runtime |
| **G4** | Built artifact works offline from `vite preview`; deployed to Netlify; branch pushed; README has deploy path + Chrome-flag instructions; PHYSICS/ACCURACY/FIELD-TEST complete with every accuracy claim traced to a test |

Never proceed past a red gate. A10 (me, wearing that hat, with the suite as arbiter) can veto.

## 6. Status

- [x] Kit unpacked, placed per KIT-MANIFEST, all four checks pass
- [x] PLAN.md, DECISIONS.md
- [ ] G0 — foundation
- [ ] G1 — math
- [ ] G2 — tools + guidance
- [ ] G3 — honesty
- [ ] G4 — deployed

## 7. Self-critique against §14 and §15 (one pass, as required)

Findings against the Definition of Done and the Honesty Charter, and what changed in this plan:

1. **§14 "guided walkthrough … advances on real sensor events"** — my first draft treated guides
   as static coach marks. Fixed: the tour engine subscribes to the same `SensorSource` streams as
   the tool and advances on events (peak detected, stillness held, calibration coverage reached);
   in DEMO the same guide runs against replay. This is why A13 starts in Phase 1, not 2.
2. **§14 "fixture corpus and tutorial content are the same files — verified by a test"** — added
   an explicit suite check: every fixture id referenced by a DEMO must exist in the corpus the
   suite asserts, else the test fails. Cheap, and it pins the highest-leverage kit decision.
3. **§15.1 "never display a measurement without uncertainty"** — enforcement can't be a copy
   convention; it's the type system. `Measurement.uncertainty` and `.confidence` are non-optional,
   and the one formatting component that renders numbers takes a `Measurement | Entered | Derived`
   union, so a bare number has no render path. tokens.css already styles the three provenances.
4. **§15.3/§15.4 refusal and visible degradation** — the confidence state machine and warning keys
   (`WALL_HOT`, `MAGNETIC_ACCESSORY`, `SWEEP_TOO_FAST`, `RATE_COLLAPSE`) are part of the DSP
   contract from Phase 0, not UI strings invented later; failure fixtures assert them.
5. **§14 Lighthouse ≥ 95 / bundle ≤ 300 KB / e2e matrix** — honest scope note: full Playwright
   visual-regression across 7 tools × 3 themes × 2 orientations and device-emulated Lighthouse
   runs may exceed what this environment can execute. The plan keeps the budgets (checked at build
   time: gzip sizes printed, long-task discipline by architecture) and ships the e2e scaffolding
   with the capability-tier mocks; whatever isn't machine-verified here is listed in ACCURACY.md
   as *unverified*, per the charter — claimed nowhere.
6. **§15.7 "teach the limits first"** — the Field Manual outline starts with "What this app can't
   do", and each tool's guide opens with its failure modes, not its feature list. First-run copy
   follows BRAND.md voice: verb first, no "simply".

## 8. Execution notes for this environment

- Vitest for all math/DSP tests (jsdom not required; pure TS). Playwright e2e scaffolding with
  tier mocks; Chromium is preinstalled at `/opt/pw-browsers`.
- Deploy via Netlify MCP tools; fallback is the README drag-`dist/` path (R9).
- Branch: `claude/ultrathink-build-kit-setup-v0ooqv`. Commits at every gate, push at G4 (and
  earlier if the session risks recycling).
