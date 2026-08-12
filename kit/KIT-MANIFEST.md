# SQUARE build kit — inventory

Everything the build needs. Nothing here should be regenerated, redrawn, or retyped by the agent.

## Where each file ends up

The kit may arrive unzipped into the project root, or attached to the session and unpacked by the
agent. Either way the files finish here, and the paths below are what the running app and the test
suite expect. This table and the placement map in the prompt say the same thing; if they ever
disagree, this table wins.

| Kit path | Final home |
|---|---|
| `SPEC.md`, `BRAND.md`, `KIT-MANIFEST.md`, `LICENSE-NOTES.md`, `README.md` | `./kit/` — reference, not shipped |
| `head-snippet.html`, `rename.sh`, `docs/` | `./kit/` — reference, not shipped |
| `fonts/*.woff2`, `fonts/fonts.css` | `./public/fonts/` |
| `fonts/*-patched.ttf` | `./kit/fonts/` — sources, never shipped to the browser |
| `icons/*` | `./public/icons/` |
| `manifest.webmanifest` | `./public/manifest.webmanifest` |
| `styles/tokens.css` | `./src/ui/tokens.css` |
| `fixtures/*` | `./tests/fixtures/` |
| `netlify.toml`, `.gitignore` | project root |

`head-snippet.html` is not copied anywhere — its contents are pasted into `index.html`'s `<head>`.
Its URLs (`/fonts/…`, `/icons/…`, `/manifest.webmanifest`) resolve correctly once the table above
is followed, and break if it isn't.

## Verify the placement before building
- `public/manifest.webmanifest` parses as JSON and all five icons it names exist on disk.
- All three `.woff2` files load and each contains `U+00B5` and `U+2032`.
- `tests/fixtures/drywall-16oc-synthetic.json` parses and has an `expected` block.
- `netlify.toml` contains a `Permissions-Policy` header naming `magnetometer`.

| Path | What it is | Agent's instruction |
|---|---|---|
| `PROMPT.md` | The paste-into-Claude-Code prompt | Read first |
| `SPEC.md` | Source of truth — physics, algorithms, contracts, subagent charters, gates, DoD, honesty charter, §7B guidance | Follow exactly |
| `BRAND.md` | Palette, type, voice, the orange rule | Follow exactly |
| `LICENSE-NOTES.md` | Font licensing and the modifications made | Read before publishing |
| `styles/tokens.css` | Every colour and form token, ready to import | Copy in as-is |
| `fonts/*.woff2` | DDC Hardware, three faces, subset, **µ and ′ patched in** | Copy in as-is. Do **not** re-subset from any original TTF |
| `fonts/*-patched.ttf` | The patched sources, in case a re-subset is ever needed | Reference only |
| `fonts/fonts.css` | `@font-face` + the four type-role variables | Copy in as-is |
| `icons/` | Full PWA icon set: 16→1024, maskable, apple-touch, favicon.ico, Safari mask, plus two unselected alternates | Copy to `public/icons/` unmodified |
| `manifest.webmanifest` | Ready to ship | Copy in as-is |
| `head-snippet.html` | `<head>` block incl. font preload | Paste into `index.html` |
| `netlify.toml` | Build config + headers. **`Permissions-Policy` is what gates the sensors** | Copy in as-is |
| `fixtures/SCHEMA.md` | Trace format shared by replay, tests and DEMO (lands in `tests/fixtures/`) | Follow exactly |
| `fixtures/drywall-16oc-synthetic.json` | Verified seed trace, two fasteners 16" OC (lands in `tests/fixtures/`) | First fixture; build the corpus around it |
| `rename.sh` | Swaps the app name across the kit | Only if the name changes |
| `.gitignore` | Standard | Copy in |
| `docs/` | Icon previews, type specimen, the micro-sign check | Reference only |

## What the agent still creates
The application itself: `package.json`, Vite config, `src/**`, service worker, tests, and the docs
the spec calls for (`PLAN.md`, `DECISIONS.md`, `PHYSICS.md`, `ACCURACY.md`, `FIELD-TEST.md`,
`HONESTY-AUDIT.md`). Zero runtime dependencies — all maths implemented in-repo and unit-tested.

## Verified before packing
- `manifest.webmanifest` parses; all five referenced icons exist.
- Every SVG parses; every `head-snippet.html` reference resolves.
- All three woff2 files carry `U+00B5`, `U+2032`, `U+2033`; DDC Hardware Condensed is tabular
  (all ten digits advance 1032/2048 em).
- The seed fixture's `expected` block was checked against a reference implementation: the
  zero-crossing estimator recovers 3.90" and 20.02" against a truth of 4.00" and 20.00".
