# SQUARE — is it square?

Phone-sensor measuring tools for home projects: find studs by magnetometer, level and plumb with
a live camera overlay, compute true corner angles from a photograph, lay out repeat spacing, and
capture cut angles for the saw. Offline-first PWA. **Zero runtime dependencies. No network, no
accounts, no analytics — it works in airplane mode in a crawlspace.**

Every displayed number carries a unit and either a ± or a confidence state. The app would rather
refuse than guess; see the Honesty Charter in `kit/SPEC.md` §15.

## Deploy

Two-line path:

1. `npm ci && npm run build`
2. Drag `dist/` onto [Netlify Drop](https://app.netlify.com/drop) — or connect this repo and let
   the committed `netlify.toml` drive the build.

No environment variables, no API keys, no build secrets. The `Permissions-Policy` header in
`netlify.toml` is what lets the browser expose the sensors — if sensors are dead on the deployed
site and fine locally, check that header first.

<!-- DEPLOY-URL -->

## Raw magnetometer on Android (Tier A / FIELD)

Chrome ships the raw magnetometer behind a flag:

1. Open `chrome://flags/#enable-generic-sensor-extra-classes`
2. Set **Generic Sensor Extra Classes** to **Enabled**
3. Restart Chrome, open the app, open SCAN.

Without the flag (and on iOS, always), SCAN runs in heading-deflection mode (`PROXY` badge,
confidence capped) or manual mode — the app tells you which tier you're on and why.

## Develop

```
npm ci
npm run dev          # local dev server
npm test             # full suite (unit + property + fixtures)
npm run verify:fixtures   # replay the trace corpus through the real pipeline
npm run build        # typecheck + build + generate service worker
npm run preview      # serve the built artifact
```

The math is implemented in-repo and test-first — see `tests/unit/`. Three load-bearing tests are
frozen and predate their implementations (`miter-canonical`, `zero-crossing`,
`angle-solver-groundtruth`); if one fails, the algorithm is wrong, not the test.

Sensor traces in `tests/fixtures/` (format: `tests/fixtures/SCHEMA.md`) drive the regression
suite, the replay harness (`?replay=<fixture-id>`), and the in-app DEMO walkthroughs — the same
files, so the tutorials cannot drift from tested behavior.

## Documentation

- `PLAN.md` / `DECISIONS.md` — plan of record and ADRs
- `docs/PHYSICS.md` — every formula, axis convention, and derivation
- `docs/ACCURACY.md` — honest measured accuracy per feature per calibration state
- `docs/FIELD-TEST.md` — the 90-minute real-wall validation protocol
- `kit/` — the source spec and brand kit (reference, not shipped)

## Fonts

DDC Hardware (Lost Type Co-op) ships self-hosted with two patched glyphs (µ, ′). The woff2 files
are pinned byte-for-byte by the test suite — do not re-subset them. They are licensed for this
site only: not for download, not for redistribution. See `kit/LICENSE-NOTES.md`.
