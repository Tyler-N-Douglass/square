# Sensor trace format

One format for three jobs, deliberately: the **replay harness** (`src/sensors/replay.ts`), the
**regression corpus** (`npm run verify:fixtures`), and the in-app **DEMO** walkthroughs all read
these files. They are the same artifact — a tutorial cannot drift from tested behavior if the
tutorial *is* the test.

```jsonc
{
  "schema": "square.trace/1",
  "id": "drywall-16oc-synthetic",
  "synthetic": true,              // true = generated; false = recorded on a real wall
  "note": "...",                  // what this trace is, in one line
  "device": { "platform": "…", "magTier": "FIELD" | "PROXY" | "NONE" },
  "hz": 40,
  "units": { "mag": "uT", "t": "s", "distance": "in" },
  "anchors": [                    // maps time to physical distance along the sweep
    { "t": 0.0, "in": 0.0 },
    { "t": 8.0, "in": 24.0 }
  ],
  "samples": [ { "t": 0.0, "x": 21.4, "y": -8.2, "z": 41.9 } ],
  "expected": {                   // asserted by the fixture suite; shown by DEMO
    "peaks_in": [4.0, 20.0],
    "tolerance_in": 0.75,
    "pitch_in": 16.0,
    "confidence": "STRONG",
    "warnings": []
  }
}
```

Rules:
- `expected` is required. A fixture with no assertion is not a fixture.
- Failure traces are first-class and just as valuable: `expected.warnings` carries the exact
  warning keys the pipeline must raise (`WALL_HOT`, `MAGNETIC_ACCESSORY`, `SWEEP_TOO_FAST`,
  `RATE_COLLAPSE`), and `expected.peaks_in` is `[]` when the correct behavior is to find nothing.
- `synthetic: true` must be surfaced in the DEMO UI. Never show a generated trace as if it came
  off a real wall.
- Required corpus before Phase 2 closes: `drywall-16oc`, `drywall-24oc-noisy`, `metal-stud-hot`,
  `plaster-lath-dense`, `magsafe-attached`, `sweep-too-fast`, `tierB-heading-proxy`.
  Real recordings replace synthetic ones as field data arrives; keep both.
