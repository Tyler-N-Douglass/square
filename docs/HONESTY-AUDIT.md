# HONESTY AUDIT — A11 red-team pass (Gate 2 → Gate 4 input)

Charter (SPEC §12, A11): find any place the app implies more certainty than it has, any number
without a unit or a ±, any silent failure, any state where a denied permission leaves a dead end;
prove zero network egress at runtime. Findings below are filed against A1–A9/A13 for fix before
Gate 4. Deviations already ruled in DECISIONS.md were audited against their own rulings, not
against the raw spec text.

Audit date: 2026-08-12 · Repo state: Gate 2 (998 pre-existing tests green; 26 new honesty pins
added by this audit, 1 of which fails deliberately — it pins finding H-03 in the live code).

---

## 1. Methodology

Read the actual code, not the reports. Every lens below was swept with targeted greps plus a
full read of every tool's mount/render path and every sensor source.

| Lens | What was swept | How |
|---|---|---|
| Bare / under-qualified numbers | `src/tools/**`, `src/ui/**`, `src/app/**`, `src/guidance/**` | read of every render path; grep of every `toFixed` inside `textContent =` template strings; grep of every canvas `fillText` call site (6 total, each inspected); export surfaces (CSV, print sheet, burned photos) read line-by-line |
| Silent failures | every `catch` in `src/` (34 sites, each classified), every `?? fallback` on sensor values, `.health` consumption per tool | grep + read |
| Dead ends on denial | motion, camera, magnetometer denial paths in every consuming tool; iOS `requestPermission` gesture discipline | traced each `requestMotionPermissions` / `getUserMedia` call site back to its user gesture |
| Certainty inflation | every `°`, `µT`, `″`, `%`, `±` claim in string literals vs `docs/ACCURACY.md`; the confidence pipeline end to end (`snrToConfidence` → `aggregateConfidence` → tool caps → save path) | read + new pinning tests |
| Provenance styling | `.measured` / orange on anything not live sensor output: after stop, replay, demo, frozen stills, canvas drawings | read of tokens.css, number.ts, every canvas color literal |
| Zero egress | `src/**`, `dist/**`, `index.html`, `scripts/build-sw.mjs`, `netlify.toml` | grep for `fetch(`, XHR, WebSocket, EventSource, sendBeacon, importScripts, hosted URLs; new pinning test `honesty-egress.test.ts` |
| Storage honesty | logStore memory fallback, calibrationStore persistence, guidance fading storage | read + existing dom test verified |
| Guidance completeness | every `warningBanner(` call site; explainer registries vs closed unions | grep + type-level check |
| Voice | forbidden-word sweep (`simply/just/easy/sorry/please`) over all `src/` string literals | grep `-i` word-boundary |

New pinning tests (this audit's teeth), all in `tests/unit/`:

| File | Tests | Status |
|---|---|---|
| `honesty-egress.test.ts` | 7 | **all pass** — egress is provably zero (see §3) |
| `honesty-proxy-cap.test.ts` | 8 | **all pass** — PROXY cap, save-path cap, UNRELIABLE-ships-no-positions all pinned |
| `honesty-number-provenance.test.ts` | 11 | **all pass** — bare-number render paths stay closed |
| `honesty-home-replay.test.ts` | 1 | **FAILS — deliberately.** Pins finding H-03; fix `src/app/home.ts`, not the test |

---

## 2. Findings

Severity: **CRITICAL** = a wrong or over-claimed number a user could act on; **MAJOR** = silent
degradation or provenance falsification; **MINOR** = copy/labeling gap, secondary surface.
"Charter" cites the clause violated. Every finding names the smallest fix that closes it.

### CRITICAL

**H-01 — LAYOUT's level line claims tighter than ±0.5° with no reversal calibration, and ignores the stored bias when one exists.**
`src/tools/layout/index.ts:356-390` (renderRoll), `src/tools/layout/levelLine.ts:34-97` (RollCapture).
Charter: SPEC §2.3.5 ("Force the two-position reversal calibration before allowing a claim
tighter than ±0.5°"), §15.1, §15.5.
The roll capture subscribes to `OrientationFusion` raw: it never subtracts
`getProfile().levelBias`, its ± is pure 500 ms window scatter floored at **0.05°**, and its
confidence maps `stddev ≤ 0.3° → STRONG` regardless of calibration state. On an uncalibrated
phone whose zero is off by the typical few tenths of a degree, LAYOUT displays e.g.
`Roll: 0.42° ±0.05° STRONG` and derives `Drop over 96″: 0.70″ ±0.08″` — an order of magnitude
tighter than the app is entitled to claim, on the screen that tells the user where to mark a
wall. LEVEL's own `levelState.ts` states the principle this violates: "a very quiet sensor
cannot talk its way past an uncalibrated zero."
*Smallest fix:* in the fusion subscription, subtract `levelBias` (degrees, per the A5 unit
contract); build the Measurement with `plusMinus = max(claimFor(getProfile()).plusMinus,
stddevDeg)` and basis per LEVEL's `uncertaintyForSave`; cap confidence at LIKELY when
uncalibrated (reuse `confidenceFor(stable, calibrated)` from `levelState.ts`). Propagate the
same ± into `levelLineDrop`.

### MAJOR

**H-02 — A dead sensor stream keeps rendering the last numbers; `source.health` is consumed by no tool.**
Evidence: grep — `.health` is read only in `src/tools/calibrate/selftest.ts:115,119` (and the
pass-through `src/sensors/orientation.ts:44`). Sources do their job: `magnetometer.ts:79-84`,
`headingProxy.ts:91-95`, `imu.ts:57-62` all run watchdogs that set `health='dead'`/`'degraded'`,
and `magnetometer.ts:53-61` records mid-stream sensor errors in `lastError`. Nobody listens.
Charter: §15.4 ("degrade visibly, never silently"); A11 charter verbatim: "a source that reports
dead while the tool keeps rendering old numbers is a lie."
Consequences: SCAN (`src/tools/scan/index.ts`) — if the Magnetometer errors or stalls mid-sweep
(background throttle to zero, sensor death), `onSample` simply stops firing: the last orange
readout, state word, tone state and event list stay on screen, the button still says STOP, and
RATE_COLLAPSE never fires because that warning is computed from samples that are no longer
arriving. LEVEL (`src/tools/level/index.ts:940-943`) — the no-sample watchdog covers only the
first 2.5 s; a stream that dies after HOLD leaves a frozen "HOLD + orange angle" indefinitely.
BEVEL and LAYOUT captures share the failure shape (they hold in "MOVING"/"HOLD…" forever, which
is at least not a wrong number).
*Smallest fix:* while running, poll `source.health` (the sources already maintain it) on a 1 s
interval in SCAN and LEVEL; on `'dead'`: stop the tone, blank the state word to a `SENSOR LOST`
state, and show the existing recovery panel (`showRecovery` / `showNoSensors` already exist —
call them). On `'degraded'`, surface the existing RATE_COLLAPSE banner from source side too.

**H-03 — Home ?replay= readout labels a degrees-valued PROXY residual "µT", with no ± or confidence.**
`src/app/home.ts:101` — `write(\`${s.mag.toFixed(2)} µT\`)`, unit hardcoded.
Charter: §15.1 (unit must be the value's own unit; every displayed measurement carries ± or
confidence). Replaying `tierB-heading-proxy` (units.mag = `'deg'`) on the home screen renders
`0.05 µT` in `.measured` styling. **Pinned by the failing test
`tests/unit/honesty-home-replay.test.ts`** — fix the code, not the test.
*Smallest fix:* derive the unit from the trace (`t.units.mag === 'deg' ? '°' : 'µT'`) and either
attach the live noise floor as ± (as SCAN's readout does) or restyle the panel as a raw signal
trace (drop `.measured`, label "raw signal — SCAN qualifies it").

**H-04 — CALIBRATE announces "PASS — stored" for saves that silently failed to persist.**
`src/app/calibrationStore.ts:36` (`catch { /* ignore */ }` on `localStorage.setItem`), claimed at
`src/tools/calibrate/index.ts:444-446` ("PASS — stored…"), `:714-716` ("Reversal zero stored.
Level claims tighten."), `:870-872` ("Lens calibration stored."), and by LEVEL's reversal panel
(`src/tools/level/index.ts:641` "It is subtracted from every reading now"). In private mode /
quota exhaustion the profile lives only in memory: claims tighten for this session, then
silently revert on next launch with no notice ever shown. Contrast LOG, which does this right
(visible session-only notice, tested).
Charter: §15.4. *Smallest fix:* `updateProfile` returns `{ profile, persisted: boolean }` (or
exposes `persistenceOk()`); the three PASS screens and LEVEL's reversal panel append the LOG
notice line ("Storage is session-only in this browser mode — this calibration lasts until the
tab closes") when persistence failed.

**H-05 — Every calibration part shares one `updatedAt`: any calibration write makes stale calibrations look fresh.**
`src/app/calibrationStore.ts:33-39` (single `updatedAt` bumped by every `updateProfile`),
`:53-57` (`calibrationAgeMs` keys all four parts off it), `:64-71` (`calibrationsForProvenance`
stamps those ages into every saved Measurement). Consumers: SCAN's cal chip
(`src/tools/scan/index.ts:271-277` — "CAL 2m ago" after a *lens* calibration, when the mag
figure-8 is two months old), LEVEL's claim age (`levelState.ts:60-62` — reversal claim reads
"run today" after any other routine), and the provenance block on every saved measurement in
LOG. ADR-013.7 ruled that per-routine ages come from CALIBRATE's outcome store "until
CalibrationProfile grows per-part timestamps" — CALIBRATE's cards comply
(`calibrate/index.ts:173-184`), but the chips and the recorded provenance do not.
Charter: §15.4 (staleness must surface; here it is actively masked), §4.6.
*Smallest fix:* additive per-part stamps (`updatedAtByPart?: Record<part, number>`) written by
`updateProfile(patch)` for exactly the parts in the patch; `calibrationAgeMs` prefers them.
No consumer changes needed.

**H-06 — LEVEL's frozen overlay photo burns a bare angle, in orange, with no ± and no calibration state.**
`src/ui/overlay/cameraOverlay.ts:275-277` — `bctx.fillText(\`${lastTiltDeg.toFixed(1)}°\`, …)`
in `colors.wedge` (= `--orange`) onto the saved still.
Charter: §15.1 ("not once, not on the simple screen" — a saved photo is an export surface that
outlives the session), §7.1 (a frozen frame is not a live sensor value). CORNER does this right:
its annotated photo burns `CORNER 88.4° ±0.6° · LIKELY` plus the lens state
(`src/tools/corner/index.ts:493-498`, `annotate.ts:55-65`).
*Smallest fix:* burn `${tilt}° ±${claim.plusMinus}°` plus `reversal-calibrated|uncalibrated`,
in the label-card style annotate.ts uses (ink card, off-white type), not orange.

**H-07 — LAYOUT's photo-scale canvas paints derived marks and labels in orange.**
`src/tools/layout/index.ts:439` (`cx.strokeStyle = isRef ? '#1A1A1A' : '#F15A22'`), `:452`
(A–B line), `:472-473` (mark X's and cumulative-distance labels, `fillStyle = '#F15A22'`).
Charter: §7.1 ("nothing static, decorative, or user-entered ever wears orange" — these are
DERIVED positions from ENTERED spans), and the module's own header comment: "the only orange on
this screen is the live roll reading while the level-line sensor runs." Also hardcoded hex
instead of tokens, so NIGHT theme keeps light-theme ink for R1/R2.
*Smallest fix:* draw layout line/marks/labels in `--type` (via `getComputedStyle` like
ribbon.ts does) and reserve orange for nothing on this canvas.

### MINOR

**H-08 — SCAN's "CAL *age*" chip never re-renders with time.** `src/tools/scan/index.ts:207-215,
271-277` — computed on mount and on profile change only; says "CAL now" for the rest of a long
session. (Also inherits H-05's skew.) Fix: refresh on a minute interval while mounted.

**H-09 — A failed `?replay=` fixture load falls back to live sensors with only a console.warn.**
`src/main.ts:15-21`. The user asked for a replay and silently gets live mode. Charter §15.4;
replay is the spec's user-facing bug-repro path (§3.3). Fix: reuse the capability banner:
"Replay fixture '<id>' failed to load — running live."

**H-10 — CORNER photo-stash failure is silent: "Saved to log" either way.**
`src/tools/corner/index.ts:499-508` (photoId null path), `annotate.ts:74-76,90-92,115-118,138-141`
(every failure resolves null). The measurement saves; the annotated photo the spec promises
(§4.3.4) is silently absent. Fix: branch the announce — "Saved to log — the photo could not be
stored on this browser."

**H-11 — LEVEL overlay freeze: burn/blob failure silently saves without media.**
`src/ui/overlay/cameraOverlay.ts:290-293` (comment admits it), `src/tools/level/index.ts:759-774`
(`onOverlayFreeze` never mentions a missing photo). Same fix shape as H-10.

**H-12 — Uncalibrated CORNER with an unevaluable focal sweep understates its ± and the explainer says "adds ±0.00°".**
`src/tools/corner/index.ts:164-166` (`(d.spreadDeg ?? 0).toFixed(2)` in the ± explainer) and
`:135` (displayed ± = MC half-width alone when `focalSpreadDeg` returns null —
`corner/math.ts:373-385`). The LENS_UNCALIBRATED banner still shows the ±1.5–3° expectation, and
confidence caps below STRONG, so the number is qualified — but the tappable ± explainer states a
falsehood in that branch. Fix: branch the copy on `spreadDeg === null`: "the focal spread could
not be evaluated for this shot — treat the band as ±1.5–3° until CALIBRATE."

**H-13 — Rack readout's parenthetical diagonals carry no ±.** `src/tools/corner/index.ts:344-348`
— `(41.3" vs 41.8")` beside a properly-qualified difference. §15.1 borderline. Fix: drop the
parenthetical or render both through `derivedEl` with the MC ±.

**H-14 — Missing gyro silently substitutes 0 rad/s; `hasGyro` is assumed from devicemotion presence.**
`src/sensors/imu.ts:49-51` (`(r?.beta ?? 0) * DEG2RAD`), `src/sensors/capability.ts:76-77`
(`hasGyro = hasDeviceMotion`). On the (rare) gyro-less device, BEVEL 3D mode is offered
(`bevel/index.ts:118-126` gates on the assumed flag), links its two placements with an identity
rotation, and reports a confident wrong dihedral (~0° for any fold). Fix: track whether any
event carried non-null `rotationRate`; expose it (health `'degraded'` or a flag) and have BEVEL
3D refuse on it the way it refuses on drift.

**H-15 — Private-mode saves announce "Saved to log" with no session-only caveat outside LOG.**
SCAN/LEVEL/CORNER/BEVEL save via `saveMeasurement` and announce success; only LOG's screen shows
the memory-backend notice (`src/tools/log/index.ts:89-100`, tested). A user who saves from SCAN
and never opens LOG never learns the data dies with the tab. Fix: `backendMode()` is already
async-cached — append "(session-only in this browser mode)" to the save announcements when
`'memory'`.

**H-16 — LOG detail rows show calibration age without saying it is the age *at capture*.**
`src/tools/log/index.ts:174` — "CAL · MAG — 3 min ago" read a week later implies now. Fix: label
the row "CAL AT CAPTURE · MAG".

**H-17 — Stopped/ended streams keep the last value in live-measured styling.**
SCAN: after STOP (`scan/index.ts:801-823`) the last orange readout, SNR and state word persist
as if live (ADR-013.1's principle: orange means "a sensor is producing this now"). LEVEL demos:
`level/index.ts:807-812` — at demo end the synthetic banner hides while the last synthetic value
stays rendered in `.measured` orange on a device with no live sensors to overwrite it. Fix: on
stop/demo-end, restyle the readout to recorded (the component seam exists: `recordedEl`'s class
swap) or clear to '—'; keep the synthetic banner until a live sample replaces the value.

### NOTES (no action required to ship, recorded for honesty)

- **H-18** `formatAge` returns `'just now'` (`calibrate/logic.ts:117`) and BEVEL uses
  `'moments ago'` — "just" here is a temporal idiom, not the banned minimizer; the mechanical
  voice lint would flag it if calibrate copy were ever routed through `voiceViolations`.
  Decide once and document, or switch to "now".
- `docs/ACCURACY.md` still lists "Gravity capture valid only with a horizontal shared edge —
  pending Phase 2" and "Photo-scaled layout uncertainty — pending Phase 2"; both shipped and are
  tested (`bevel-capture.test.ts`, `layout-tool-photo.test.ts`). Stale in the safe direction —
  A12 should refresh the table.
- `calibrate/logic.ts:378` docstring says levelBias is "stored (in radians)" two paragraphs
  above the unit contract that says degrees; code stores degrees. Fix the comment before it
  misleads a future patch.

---

## 3. Zero network egress — verdict: **PROVEN (static)**

- `src/**`: no `fetch(`, `XMLHttpRequest`, `WebSocket`, `EventSource`, `sendBeacon`,
  `importScripts`, `new URL('http…')` anywhere in code (comments carry two doc mentions).
  Only hosted-URL strings: the SVG namespace identifier `http://www.w3.org/2000/svg`
  (`ui/components/mark.ts`) and instructional copy (`chrome://flags/…`, "its https:// address")
  — none reachable by the network stack.
- `dist/` (built): swept — same two classes of hit only; `dist/index.html` references only
  same-origin assets; no preconnect/prefetch to any host.
- `dist/sw.js` / `scripts/build-sw.mjs`: the only `fetch(` in the product, inside the SW, behind
  `if (url.origin !== self.location.origin) return;` — the SW cannot be used as a proxy, and the
  precache list is same-origin paths only.
- `netlify.toml` CSP is the backstop: `default-src 'self'; connect-src 'self'; script-src
  'self'; font-src 'self'; …` — no host named anywhere in the policy, so even injected code
  could not beacon out.
- Zero runtime dependencies (`package.json` dependencies `{}`) — no third-party code to smuggle
  a request in.

All six properties are **pinned forever** by `tests/unit/honesty-egress.test.ts` (7 tests,
green). Runtime confirmation on a device (airplane-mode Lighthouse/devtools pass) remains a
Gate 4 checklist line, but statically there is no code path to the network.

---

## 4. Verified clean (checked, passed — evidence named)

The clean list is the other half of the audit. Each line was actively attacked.

**Numbers & provenance**
- The only render paths for numbers (`measuredEl` / `derivedEl` / `enteredEl` / `recordedEl`)
  enforce unit + ±/confidence at runtime and throw on violation — pinned by
  `honesty-number-provenance.test.ts` (11 green) on top of A7's existing
  `components-number.test.ts`. UNRELIABLE/NOISE always wear their badge even beside a ±.
- Saved/recorded values shed the orange class (ADR-013.1) — pinned.
- SCAN's initial readout is `—` (NaN, basis unknown) — no fake reading before the first sample
  (`scan/index.ts:1033-1055`).
- Un-spanned sweeps save in **seconds** with the no-span note; positions never pretend to inches
  (ADR-006) — pinned in `honesty-proxy-cap.test.ts`.
- LAYOUT tables: exact rational fractions with visible rounding markers (▴/▾), the anti-chaining
  warning rendered verbatim beside every table, entered spans echoed in ENTERED styling; CSV and
  print surfaces carry units in every cell (`geometry/layout.ts`, `layout-tool-solver.test.ts`).
- LOG CSV export keeps kind/value/unit/±/confidence and *states what it drops* (`CSV_DROPS`);
  JSON round-trips NaN ± honestly; import never overwrites, skips with stated reasons
  (`exporter.ts`, `log-export.test.ts`).
- Ribbon canvas: tick labels carry units (`2s` / `4″`); orange only on the live line and
  detected events; predicted lattice dashed gray and captioned "derived, not measured"
  (`ribbon.ts`, `scan/model.ts latticeStatement`).

**Confidence pipeline**
- PROXY never reaches STRONG — pinned at three seams (mapping at absurd SNR, full pipeline on a
  huge-SNR synthetic PROXY trace with a FIELD control, the shipped tierB fixture) in
  `honesty-proxy-cap.test.ts` (8 green). ADR-005 honored.
- Uncalibrated-FIELD cap (ADR-013.2): screen aggregate capped at LIKELY
  (`scan/index.ts:489-496,616`), save path capped via `buildStudMeasurements.capAt` — pinned.
- UNRELIABLE ships **zero** positions: any environment guard empties the peak list
  (`analyze.ts:198-219`, ADR-011.1) — pinned on the hot-wall fixture and on a
  sweep-too-fast synthetic where the raw signal alone would have detected fasteners.
- Guards themselves are honest and physical: whole-trace MAD floor, physical prominence floor,
  bipolar shape gate, dense-irregular cap at POSSIBLE (ADR-011, `dsp-guards.test.ts`).

**Silent failures that turned out not to be**
- Scan pipeline analyzer errors surface ("ANALYSIS FAILED … Stop and sweep again",
  `scan/index.ts:498-503`); worker construction failure falls back to the in-process analyzer
  running the *same* functions (`workerClient.ts`, `pipeline.ts createSyncAnalyzer`).
- DEMO fixture load failure surfaces ("DEMO UNAVAILABLE", `scan/index.ts:1099-1105`).
- Clipboard failure in diagnostics surfaces with a manual-copy path (`selftest.ts:334-336`).
- Guidance-storage failures degrade toward *re-showing* guidance — the safe direction
  (`fading.ts`, ADR-013.6).
- LOG memory fallback is visible and announced — `log-tool.test.ts` asserts the exact copy.

**Denial paths — no dead ends found**
- SCAN: Magnetometer construct/permission failure → recovery panel with per-platform
  instructions + manual mode + demos ("no dead end here" is literally rendered); Tier NONE →
  honest disable copy, chrome-flag remedy, manual mode first, demo offer (`scan-tool.test.ts`).
- LEVEL: gesture-gated wake panel; denial → recovery instructions + working practice math;
  desktop no-sample watchdog → "NO MOTION DATA" + practice math (`level-denial.test.ts`).
- CORNER: camera denial → recovery + file-picker fallback, tool fully usable from any photo
  (`corner/capture.ts:141-144`); overlay denial → "SURFACE, EDGE, and PLUMB keep working."
- BEVEL/LAYOUT: denial → recovery instructions; PRACTICE mode stays fully functional (§7B.9).
- iOS gesture discipline: every `requestPermission()` call is inside a click handler's
  synchronous task chain (level wake, scan start, bevel wake, layout wake) — verified by trace;
  no call site outside a gesture.
- Nothing blocks the whole app: capability banner only for secure-context/permissions-policy,
  informational (`shell.ts:116-125`).

**Replay / DEMO labeling**
- `?replay=` shows `REPLAY · <id> · SYNTHETIC` badge and a full provenance line in SCAN; DEMO
  swaps the badge to `DEMO · REPLAY · <id>`; `runDemo` *requires* `onSyntheticLabel` (a demo
  that cannot label a synthetic trace does not get to play one — `guidance/demo.ts:36-49`);
  ADR-012 synthetic streams and worked examples all label themselves (LEVEL banner, CORNER
  `WORKED_LABEL`, BEVEL demo label; demo saves/zeros are blocked in LEVEL). The fixture-corpus
  unification test (`guidance-demo-corpus.test.ts`) holds.

**Guidance completeness**
- `warningBanner(key, message, onExplain)` — the explain handler is a *required* parameter; all
  call sites (grep: scan, corner ×3, bevel ×2, calibrate demo) pass a real card. The explainer
  registries are `Record<WarningKey|Confidence, Explainer>` over closed unions — a warning
  without a card is a compile error (ADR-003). Every ± is tappable at the major readouts with
  basis-true copy (`UNCERTAINTY_EXPLAINER`).

**Voice**
- Forbidden-word sweep over all `src/` strings: zero hits in user-facing copy (only code
  comments + the `'just now'` idiom, noted as H-18). No apologies, no "may/might" hedges in
  warning copy; BRAND's good/bad examples are followed (the canonical warning lines ship
  verbatim in `WARNING_COPY`).

**The three frozen load-bearing tests — intact, and not gamed**
- `zero-crossing.test.ts`: runs the real `analyzeMagTrace` (the same function the worker and the
  live pipeline call — no test-only path); asserts the amplitude estimator's *failure* as well,
  so the wrong estimator cannot quietly ship. The shipped default is `'zeroCrossing'`
  (`analyze.ts:155`); nothing in `src/tools/` ever passes `'amplitude'` (grep).
- `miter-canonical.test.ts`: `miter.ts` is a genuine rotation-matrix construction (run vectors →
  mirror-plane normal → saw frame), not transcribed canonicals; the header even documents where
  the spec's candidate formula fails (flat splice), and the continuity/monotonicity sweeps would
  catch a hardcode. Matches ADR-009.
- `angle-solver-groundtruth.test.ts`: builds its own projection math with plain arrays,
  importing nothing from `src/geometry` but the solver under test (A10 independence); covers
  obtuse/acute resolution, degenerate refusal (`POOR_GEOMETRY`, §15.3), and the fronto-parallel
  vanishing-points-at-infinity case. The solver it tests is the one CORNER uses
  (`cornerAngleFromQuad` via `corner/math.ts` and the solver worker).

---

## 5. Verdict

**Must fix before deploy (Gate 4 blockers):**
- **H-01** (LAYOUT level-line over-claim — violates a named §2.3 honesty flag; wrong-confidence
  number on a mark-the-wall screen)
- **H-02** (dead source keeps rendering — the exact lie the charter names)
- **H-03** (wrong unit on a measured display — pinned by the failing
  `honesty-home-replay.test.ts`; the suite stays red until it is fixed)
- **H-04** (claimed calibration save that didn't persist)
- **H-06** (bare orange angle burned into an exported photo)
- **H-07** (orange on derived canvas marks — the one absolute styling rule)

**Fix before Gate 4 unless the lead rules otherwise:** H-05 (provenance-age falsification —
arguably blocker-grade since it stamps wrong ages into saved records; fix is small and additive).

**Acceptable with a note (ship if time forces it, record in ACCURACY/known-issues):**
H-08…H-17 — all are labeling/secondary-surface gaps where the primary readout remains honest;
none produces a wrong primary number. H-18 and the doc notes are housekeeping.

Zero-egress: **proven statically, pinned by tests**; the airplane-mode device pass stays on the
Gate 4 checklist as confirmation, not as an open question.

— A11
