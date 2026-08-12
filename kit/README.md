# SQUARE — build kit

Everything Claude Code needs to build and ship the app. Drop this folder's contents into an
empty directory and paste `PROMPT.md` into Claude Code.

```
square-build-kit/
  PROMPT.md              ← paste this into Claude Code
  SPEC.md                ← the source of truth: physics, algorithms, agents, gates, DoD
  BRAND.md               ← palette, type, voice, the orange rule
  fonts/                 ← DDC Hardware, self-hosted woff2 + fonts.css (µ and ′ patched in)
  manifest.webmanifest   ← ready to ship, no edits needed
  head-snippet.html      ← paste into index.html <head>
  netlify.toml           ← headers matter: Permissions-Policy gates the sensors
  rename.sh              ← ./rename.sh NEWNAME
  icons/                 ← finished icon set, 16px → 1024px, maskable, apple, favicon, mask
  docs/                  ← icon previews and the rejected concepts
```

## Deploy path

**Stage 1 — set up (5 minutes).** Either delivery works:

*Unzipped:* put the kit contents in an empty directory, run `claude`, paste `PROMPT.md`.

*Attached:* run `claude` in an empty directory, attach `square-build-kit.zip` to the session, and
paste the prompt. The agent unpacks it and places the files itself — the placement table in
`KIT-MANIFEST.md` is what it follows, and it verifies the unpack before building.

Either way, confirm it writes `PLAN.md` before it writes any code. If it starts coding first, stop
it and make it plan.

**Stage 2 — Phase 0, foundation (about one session).** It builds the repo, the capability probe,
the sensor contracts, the record/replay harness, and an empty seven-route shell, then deploys
the skeleton to Netlify. Gate: the skeleton is live, installs, and works offline. Do not let it
proceed past a red gate.

**Stage 3 — Phases 1–2, math then tools (four to six sessions).** Subagents fan out per §12.
Math is proved against synthetic ground truth before any UI touches it. Every tool ships with its guided walkthrough and DEMO replay in the same PR — guidance is not a Phase 3 bolt-on. Gate: the compound
miter hits the canonical values exactly and the angle solver lands within 0.3° on synthetic
projections.

**Stage 4 — Phases 3–4, honesty pass and field-ready (two sessions).** Red-team audit, all
degraded paths, all permission denials, production deploy. Gate: `HONESTY-AUDIT.md` closed.

**Stage 5 — field validation (90 minutes, yours).** Follow `docs/FIELD-TEST.md` that the agent
writes: calibrate, scan a known wall against a tape, check the level against a 4-ft spirit
level, shoot a door frame from five positions, then the adversarial pass — over an outlet, over
copper, with a MagSafe case on, sweeping too fast. It has to warn instead of lying in all four.

**Stage 6 — tune (one session).** Feed the recorded traces back in as fixtures. The agent tunes
thresholds against reality and republishes `ACCURACY.md` with measured numbers instead of hopes.

## Netlify

Drag `dist/` onto Netlify, or connect the repo and let `netlify.toml` drive it. No environment
variables, no API keys, no build secrets. If the sensors are dead on the deployed site and fine
locally, the `Permissions-Policy` header is the first thing to check.

## Two things to watch

**Fonts.** DDC Hardware ships patched — the originals had no µ and no ′, and both are load-bearing
(µT for field readings, ′ for feet). If anyone re-subsets from the original TTFs, both disappear.
Hold the Lost Type commercial license before this goes public.

**Guidance.** §7B of the spec is as long as it is on purpose. Do not let the agent defer it — a
tool without its guided run is not done, and the DEMO fixtures double as the regression corpus.

## The one thing that matters

This tool tells people where to drill holes in their house. A confident wrong answer costs money
and drywall patches. Every claim in the app traces to a test or it does not ship.
