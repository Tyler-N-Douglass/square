# License notes

## DDC Hardware — Lost Type Co-op
Three faces ship in `fonts/` as subset woff2, plus the patched TTF sources.

**Modified.** Two glyphs were added because the originals lacked them and both are load-bearing
in this app:
- `U+00B5` MICRO SIGN — built from the `u` outline plus a stem descender, sized per face to that
  face's own narrowest stem. Needed for µT field readings.
- `U+2032` PRIME — mapped to the straight `quotesingle`. Needed for feet in `3′ 4-7/16″`.

Lost Type's commercial license covers use on a single website and permits modification provided
the font is not redistributed. Before this app is public:
1. Buy the commercial license for DDC Hardware from Lost Type.
2. Do not link the font files for download anywhere in the app or the repo README.
3. Do not publish the font files to npm or any other package registry.
4. Serving them via `@font-face` from your own domain is normal webfont use, not redistribution.

If the license ever becomes a problem, the fallback is a system stack — but the tabular figures
go with it, so the HUD readouts will jitter. Substitute a tabular-figure face, not a default sans.

## Everything else
Icons, spec, tokens and copy in this kit are original work made for this project. No third-party
code ships in the kit, and the built app is specified to have zero runtime dependencies.
