# Guidance & Learning — engine notes (A13)

Owner: A13. Scope: SPEC §7B end to end. Phase 1 delivers the engines and the
content data; per-tool guided runs wire up in Phase 2, **in the same PR as the
tool** — nothing in §7B is a bolt-on.

## The modules

| File | What it is |
|---|---|
| `src/guidance/tour.ts` | Guided-run engine. UI-free; advances on real events, never a Next button. |
| `src/guidance/fading.ts` | Per-tool fading schedule + dismissal memory behind `StorageLike`. |
| `src/guidance/demo.ts` | DEMO replay: fixture → `ReplayMagSource` → narration at trace times. |
| `src/guidance/explainers.ts` | Warning / confidence / ± cards, exhaustive over the §8 unions. |
| `src/guidance/glossary.ts` | §7B.8 terms + every term the guidance copy uses, with prose matching. |
| `src/guidance/manual.ts` | The Field Manual: task-organized entries + searchable offline renderer. |
| `src/guidance/voice.ts` | The mechanical half of §7B.10 as code; every string in this package is linted by the suite. |

## Tour engine design

`runGuide(spec, deps, opts)` walks a `GuideSpec` one step at a time. The engine
owns sequencing and memory; everything visual or sensor-bound is injected:

- `deps.render(step, onDismiss) → teardown` — show one coach mark. The engine
  calls the previous teardown before the next render, so two marks can never be
  visible at once (§7B.5).
- `deps.sensorHook(predicate, cb) → unsubscribe` — the host wires the predicate
  to its live sensor stream and calls `cb` when a sample satisfies it.
- `handle.fireCustom(name)` — tools report semantic moments ("anchor-set",
  "photo-taken") to advance `{ event: 'custom', name }` steps.

Advancing (§7B.1): `'tap'` steps advance when the user taps the mark — that is
the tooltip flow, not a Next button. Sensor and custom steps advance on their
event; tapping their mark *dismisses* it, which advances past the step **and is
remembered** — a dismissed prompt never re-shows without an explicit per-tool
reset (§7B.3). `handle.skip()` ends and remembers the whole guide;
`handle.stop()` is teardown-only (route change) and records nothing.

## Fading schedule (§7B.3)

Stored per tool behind `StorageLike` (localStorage wrapper with in-memory
fallback; A8's IndexedDB wrapper swaps in behind the same two methods in
Phase 2 — guidance state is a convenience, and losing it re-shows guidance,
which is the safe direction).

| Completed runs | Next run's level | Behavior |
|---|---|---|
| 0–1 | `full` | every step, one control highlighted at a time |
| 2–4 | `reduced` | only steps flagged `critical: true` — where people actually go wrong (sweep speed, standoff, stillness, marking precision) |
| 5+ | `silent` | no prompts; the tool shows a persistent, unobtrusive "guide me" |

- The tool calls `memory.recordRun(toolId)` when a real run completes — the
  engine does not guess what counts as a run.
- "Guide me" re-entry: `runGuide(spec, deps, { memory, level: 'full' })`. An
  explicit level overrides a remembered skip; individually dismissed steps stay
  hidden until `memory.reset(toolId)` (the per-tool reset control).

## DEMO (§7B.4)

`runDemo(spec, deps)` loads the fixture through the registry
(`src/guidance/fixtures.ts`), plays it through the **same** `ReplayMagSource`
the tests and `?replay=` use, and emits narration lines at their trace times.
`trace.synthetic` is always surfaced — `deps.onSyntheticLabel('SYNTHETIC
TRACE')` is a required callback, so a DEMO that cannot label a generated trace
cannot play one. `deps.onExpected` hands the UI the fixture's asserted outcome
to show at the end ("the suite asserts these peaks — you watched them found").

The corpus link is a test: `tests/unit/guidance-demo-corpus.test.ts` reads
`tests/fixtures/` from disk and fails for any `DemoSpec.fixtureId` without a
committed file — renamed, deleted, or never landed. As of Phase 1 all seven
corpus fixtures exist and the test is green end to end. Do not skip it; do
not stub fixtures to appease it.

## How a tool registers its guide + DEMO in Phase 2 (the how-to)

A tool is not done until its guided run is done (SPEC §12). In the tool's PR:

1. **Write the guide** in `src/tools/<tool>/guide.ts`: a `GuideSpec` with step
   ids stable over time (they key dismissal memory). Flag the steps where
   people actually go wrong `critical: true` — those are the reduced-level
   survivors. Anchor steps to controls with the `anchor` CSS selector.
2. **Wire deps at mount**: `render` binds to A7's coach-mark component;
   `sensorHook` subscribes the tool's own `SensorSource`; call
   `handle.fireCustom(...)` at the tool's semantic moments; call
   `handle.stop()` in the tool's unmount.
3. **Memory**: one shared `FadingStore` (module default is fine);
   `memory.recordRun(toolId)` when a measurement completes; a "guide me"
   affordance calling `runGuide(..., { level: 'full' })`; a reset control in
   the tool's settings calling `memory.reset(toolId)`.
4. **Add the DEMO** to `DEMO_SPECS` in `src/guidance/demo.ts`, referencing a
   fixture id that exists in `tests/fixtures/` and is asserted by the fixture
   suite — the corpus test enforces this. Include at least one failure demo
   per tool where a failure mode exists: the limits teach first (§15.7).
5. **Explainers**: if the tool introduces a new `WarningKey`, the compiler
   already forces a card in `explainers.ts` (exhaustive Record). Route the
   card to the calibration that helps.
6. **Glossary**: any new domain term the tool's copy uses gets an entry in
   `glossary.ts`, and appears wrapped automatically wherever manual prose uses
   it. Never underline a term in orange — dotted 2px gray.

## Copy rules — §7B.10, restated for contributors

Every string in guidance obeys these. The suite enforces the mechanical half
(`voice.ts`); reviewers enforce the rest.

- **Verb first.** "Sweep slower", not "You should sweep slower".
- **Present tense. Second person.**
- **One idea per sentence.** Two lines maximum for a coach mark; three lines
  means it is an explainer card, not a tooltip (§7B.5).
- **Never explain the same thing twice in one flow.**
- **Never apologize.** Never "simply", "just", or "easy" — the user is holding
  a phone against a wall in a dusty room and nothing about that is simple.
- **State the action, then the reason, in that order.** "Sweep slower — peaks
  smear above about six inches per second."
- Explainer cards keep the fixed three-part shape: **why this is happening /
  what to do / what happens if you ignore it** (§7B.6). Help cards keep
  theirs: **what this does / what it can't do / how to check it** (§7B.1) —
  the third part is mandatory and is what separates this app from the
  category.
- Every manual entry **ends with a verification step** — small bit before the
  big one, test cut on scrap, second sweep twelve inches up (§15.8).

## Contract friction / notes for the lead

- `manual.ts` injects a small scoped `<style>` for `.manual`, `.prose`, and
  `.term` because `src/ui/**` is A7's in this phase. When A7 lands shared
  styles for these classes, the injected block can be deleted without touching
  the markup.
- The `.term` underline is dotted 2px `--gray` with an orange-free guarantee;
  A7's stylesheet must keep that rule (§7B.8 — orange is live values only).
- SPEC §2.2 caps Tier B at "possible" while §4.1.7's table maps Tier B STRONG
  conditions to LIKELY. The confidence explainer copy follows §4.1.7 (the
  table is the implementable spec); flagged for A2/A11 to reconcile.
