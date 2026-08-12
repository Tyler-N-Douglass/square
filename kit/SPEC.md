# SQUARE — MASTER BUILD SPEC & CLAUDE CODE ORCHESTRATION PROMPT
> App name: **CORNER**. Tagline: **Is it square?** If the name changes, run `./rename.sh NEWNAME` — it swaps every occurrence across the kit. The tool named LEVEL inside the app keeps its name; that is correct.
> This is the source of truth. It ships inside the SQUARE build kit alongside finished brand assets. Do not regenerate what the kit already contains — use it verbatim.

---

## 0. HOW TO RUN THIS (read first, agent)

**You are the lead engineer and orchestrator.** Before writing a single line of code:

1. `ultrathink` on this entire document. Do not skim. The physics and the browser-API constraints in §2 are the whole ballgame — a beautiful app built on an API that doesn't exist on the target device is a total failure.
2. Write `PLAN.md` at repo root: your interpretation, your open questions, your risk register, your subagent assignment table, and your phase gates. Then self-critique it once against §14 (Definition of Done) and §15 (Honesty Charter) before proceeding.
3. Fan out subagents per §12. Each subagent gets its charter verbatim, the shared contracts in §8, and a hard boundary on which files it owns. Subagents run in parallel within a phase; integration happens at phase gates only.
4. Work test-first everywhere the math is real (§10). **Never mock physics to make a test pass.** If a test fails, the algorithm is wrong, not the test.
5. Do not ask the user questions you can answer by choosing well and documenting the choice in `DECISIONS.md`. Ship a complete, working, deployed artifact. This user values complete deliverables over discussion.
6. Every phase gate: run the full verification suite, update `PLAN.md`, and print a one-screen status. Do not proceed past a red gate.

**Hard constraints, non-negotiable:**

- No API keys. No network calls at runtime. No accounts. No analytics. No third-party CDN (fonts, scripts, styles all bundled locally). The app must work with the phone in airplane mode, in a crawlspace, on the first load after install.
- No runtime dependencies in `package.json` `dependencies` — zero. All math (quaternions, matrices, ellipsoid fitting, SVD, homography, peak detection) is implemented in-repo and unit-tested. Dev dependencies (Vite, TypeScript, Vitest, Playwright, workbox-build or hand-rolled SW) are fine.
- Deploys to Netlify from a git repo or a drag-and-drop `dist/` folder. `netlify.toml` committed and correct on the first try.
- Installable PWA, offline-first, portrait and landscape, one-handed operation, usable with work gloves and in the dark.
- Every displayed number carries a stated uncertainty or a confidence state. No false precision, ever. See §15.

---

## 1. THE PRODUCT

**SQUARE — Photograph a wall. Know what's behind it and whether it's straight.**

Out of square, out of level, out of plumb — the three ways a house lies to you. Every screen answers one question, **is it square?**, and answers it with its uncertainty attached. (Tool #3 is named CORNER, not SQUARE, so the tool and the app never collide in copy or in code.)

One tool, in the pocket, that replaces a stud finder, a spirit level, a plumb bob, an angle finder, a bevel gauge, and a layout tape — for the dozen times a year you actually need them. Built entirely from the magnetometer, IMU, and camera already in the phone.

### The seven tools

| # | Tool | One-line job |
|---|------|--------------|
| 1 | **SCAN** | Sweep the wall; find the ferrous screw line; infer the stud. |
| 2 | **LEVEL** | Digital level + plumb with live camera overlay on the actual object. |
| 3 | **CORNER** | Photograph a doorway/cabinet/frame; compute the true corner angles from perspective. |
| 4 | **LAYOUT** | Mark one point; get guided to N more at exact equal spacing on a level line. |
| 5 | **BEVEL** | Hold the phone against an existing cut; capture the angle; get the saw settings to reproduce it. |
| 6 | **CALIBRATE** | Honest calibration for magnetometer, level zero, and camera intrinsics. Gates the accuracy claims of everything else. |
| 7 | **LOG** | Every measurement saved locally with its uncertainty, a note, and an optional photo. Exportable. |

### The user, and the moment

A capable homeowner or a working tradesperson, kneeling in a kitchen, one hand on the wall, phone in the other, no wifi, sawdust on the screen. They need an answer in under ten seconds, and they need to know how much to trust it. The killer moment is SCAN: "it actually found the screws." Everything else earns its keep quietly.

---

## 2. REALITY CONSTRAINTS — READ THIS BEFORE ARCHITECTING

This is a **web app**. Browser sensor access is uneven and partly hostile. The single most important architectural decision in this project is that **capability is detected at runtime and the UI degrades honestly**, never pretending to a measurement it cannot make.

### 2.1 Sensor availability truth table (verify at runtime; do not trust this table blindly)

| Capability | API | Reality |
|---|---|---|
| Raw magnetic field vector (µT) | `Magnetometer` (Generic Sensor API) | Chromium/Android only, and historically gated behind `chrome://flags/#enable-generic-sensor-extra-classes`. Requires secure context + `magnetometer` permission + `Permissions-Policy`. **Not available in Safari/iOS at all.** |
| Absolute orientation (incl. yaw from mag) | `AbsoluteOrientationSensor`, `deviceorientationabsolute` | Widely available on Android Chrome. Provides magnetometer-derived heading, from which a **field-anomaly proxy** can be recovered. |
| Compass heading (iOS) | `DeviceOrientationEvent.webkitCompassHeading` + `.webkitCompassAccuracy` | iOS Safari, after `DeviceOrientationEvent.requestPermission()` from a user gesture. Heading only — no field magnitude. Anomaly proxy only. |
| Accelerometer + gyro | `devicemotion` (`accelerationIncludingGravity`, `acceleration`, `rotationRate`) | Universally available. iOS 13+ requires `DeviceMotionEvent.requestPermission()` from a user gesture. |
| Camera | `getUserMedia({video:{facingMode:{ideal:'environment'}}})` | Universal on HTTPS. Intrinsics partially available via `track.getSettings()` / `getCapabilities()`. |
| Haptics | `navigator.vibrate` | Android yes; **iOS Safari no**. Audio must be the primary non-visual channel. |
| Wake lock | `navigator.wakeLock` | Chromium yes; Safari 16.4+ yes. Feature-detect. |

### 2.2 The three magnetometer tiers — implement all three

**Tier A — TRUE FIELD.** `Magnetometer` sensor available. Full 3-axis µT vector at 20–50 Hz. Full hard-iron/soft-iron calibration, true |B| anomaly detection, best confidence. Display badge: `FIELD · µT`.

**Tier B — HEADING PROXY.** No raw magnetometer, but absolute orientation / `webkitCompassHeading` available. A ferrous screw passing under the sensor deflects the computed heading. Compute a proxy anomaly signal:
- Continuously estimate the "expected" heading from **gyro integration** (short-horizon, drift-bounded) and take the residual `Δψ = ψ_magnetic − ψ_gyro_predicted`. Screws produce a characteristic **bipolar S-curve** in Δψ as the sensor passes over them, and the zero-crossing between the lobes is the screw's position.
- Also monitor `webkitCompassAccuracy` — a sudden accuracy degradation is itself an anomaly signal.
- This tier is **noticeably worse**: coarser, more false positives near the phone's own speaker/vibration motor, unusable on wet plaster with deep fasteners. Display badge: `PROXY · deflection` and cap confidence at "possible" (never "strong").

**Tier C — UNSUPPORTED.** Neither available. SCAN is **disabled with an honest explanation**, not hidden and not faked. Offer: (a) instructions for enabling the Chrome flag on Android; (b) MANUAL STUD MODE (see §4.1.9) which is genuinely useful — it does the 16"/24" on-center arithmetic, edge-of-wall inference, and outlet/corner reasoning without any sensor at all.

> **Agent instruction:** build a `SensorCapability` probe module first, before any feature. Every feature module consumes capability, never assumes it. Write the Tier C experience *first* so the app is never broken — then layer B, then A.

### 2.3 The honesty flags that must appear in the product

1. **Magnetometer finds ferrous fasteners, not wood.** Works well on drywall over standard wood framing with screws/nails. Works poorly-to-uselessly on: plaster over lath (fastener pattern is dense and irregular), glued/panel construction (no fasteners), metal studs (whole wall reads hot), and anywhere near electrical boxes, conduit, plumbing straps, HVAC, or rebar.
2. **Phone case magnets ruin it.** MagSafe rings, magnetic wallets, magnetic mounts, magnetic pop sockets. The app must **detect a large fixed offset** during calibration and say plainly: "Something magnetic is attached to your phone. Take the case off."
3. **The magnetometer is not in the middle of the phone.** It's typically near the top edge, and the exact position varies by model. Locate it (§4.1.3) and draw the crosshair where the sensor actually is, not in the center of the screen.
4. **Photo angles depend on lens calibration.** Uncalibrated, expect ±1.5–3°. Calibrated with a known square, ±0.3–0.8°. Say which one is in effect.
5. **A digital level is only as good as its zero.** Force the two-position reversal calibration before allowing a claim tighter than ±0.5°.

---

## 3. ARCHITECTURE

### 3.1 Stack

- **Vite + TypeScript (strict)**, no UI framework. Direct DOM + a tiny in-repo signal/store primitive. Rationale: 60 Hz sensor loops and canvas overlays; a VDOM is a liability here. All rendering of live values goes through `requestAnimationFrame` writing to pre-created DOM nodes / canvas — **never** re-render on sensor tick.
- **Web Workers** for all DSP and solvers (magnetometer filtering/peak detection, ellipsoid fit, Monte Carlo angle uncertainty). Main thread stays free for the camera and the overlay.
- **OffscreenCanvas** where supported for the field ribbon; graceful fallback.
- **IndexedDB** (hand-rolled thin wrapper) for calibration profiles, scan sessions, measurement log, photos (as Blobs).
- **Service worker**: precache-everything, cache-first, versioned. App must fully function on first offline launch after one online load.
- **Zero runtime deps.** Yes, that means writing `svd3x3`, `ellipsoidFit`, `quaternion`, `homography`, `medianAbsoluteDeviation`, `findPeaks`, `savitzkyGolay` yourself. They are all small, and they all get property tests.

### 3.2 Repo layout

```
square/
  index.html
  netlify.toml
  public/
    manifest.webmanifest
    icons/ (192,512,maskable,apple-touch)
    fonts/ (self-hosted woff2 subsets — NO CDN)
  src/
    main.ts
    app/
      router.ts            # hash router, 7 tools
      shell.ts             # nav, permission gate, capability banner
      store.ts             # tiny reactive store
      haptics.ts           # vibrate + WebAudio fallback (iOS has no vibrate)
      audio.ts             # tone/click engine, must work with screen off
      wakelock.ts
    sensors/
      capability.ts        # THE probe. Everything depends on this.
      permissions.ts       # iOS requestPermission choreography (user gesture!)
      magnetometer.ts      # Tier A source
      headingProxy.ts      # Tier B source
      imu.ts               # devicemotion normalization, units, sign conventions
      orientation.ts       # complementary/Madgwick fusion → quaternion
      replay.ts            # DETERMINISTIC playback of recorded sensor traces
      record.ts            # capture real traces to JSON for fixtures
    dsp/                   # (worker-side)
      calibration.ts       # hard-iron offset, soft-iron ellipsoid fit
      filters.ts           # detrend, bandpass, Savitzky-Golay, median
      peaks.ts             # prominence-based peak detect + MAD threshold
      confidence.ts        # SNR → honest confidence state machine
      spacing.ts           # screw-spacing inference, 16/24 OC lattice fit
    geometry/
      vec.ts quat.ts mat.ts
      levelMath.ts         # pitch/roll/plumb from gravity, zero offsets
      vanishing.ts         # line fit → vanishing point → 3D direction
      angleSolver.ts       # true angle between edges given intrinsics
      intrinsics.ts        # focal estimate, calibration, distortion
      montecarlo.ts        # uncertainty propagation
      layout.ts            # spacing solver (equal centers / equal gaps)
      miter.ts             # simple + compound miter/bevel solver
      units.ts             # in / ft-in-fraction / mm / cm, exact fractions
    tools/
      scan/  level/  corner/  layout/  bevel/  calibrate/  log/
    ui/
      tokens.css  components/  overlay/  charts/
    workers/
      dsp.worker.ts  solver.worker.ts
  tests/
    unit/  property/  fixtures/  e2e/
  docs/
    PLAN.md DECISIONS.md PHYSICS.md FIELD-TEST.md ACCURACY.md
```

### 3.3 The sensor abstraction contract (all tools code against this, never raw events)

```ts
export type MagTier = 'FIELD' | 'PROXY' | 'NONE';

export interface CapabilityReport {
  magTier: MagTier;
  hasAccel: boolean; hasGyro: boolean; hasAbsoluteOrientation: boolean;
  hasCamera: boolean; cameraCount: number;
  hasVibrate: boolean; hasWakeLock: boolean; hasOffscreenCanvas: boolean;
  secureContext: boolean; permissionsPolicyOk: boolean;
  platformHint: 'ios' | 'android' | 'desktop' | 'unknown';
  sampleRates: { mag?: number; motion?: number };
  blockers: Blocker[];        // human-readable, each with a remedy
}

export interface MagSample { t: number; x: number; y: number; z: number; mag: number; tier: MagTier; }
export interface ImuSample { t: number; ax: number; ay: number; az: number; gx: number; gy: number; gz: number; }
export interface Orientation { t: number; q: Quat; pitch: number; roll: number; yaw: number|null; stable: boolean; }

export interface SensorSource<T> {
  start(): Promise<void>; stop(): void;
  subscribe(fn: (s: T) => void): () => void;
  readonly nominalHz: number;
  readonly health: 'ok' | 'degraded' | 'dead';
}
```

**Replay is mandatory.** `replay.ts` must be able to drive the entire app from a recorded JSON trace, selected via `?replay=fixtures/drywall-16oc.json`. This is how the whole thing gets tested without a wall, and it is how the user reproduces a bug on his desk.

---

## 4. FEATURE SPECS

### 4.1 SCAN — magnetometer stud finding

The signature feature. Build it with more care than everything else combined.

#### 4.1.1 Physical model
Drywall is fastened to studs with ferrous screws roughly every 8–16" vertically along each stud, studs at 16" or 24" on center. Each screw is a small dipole that perturbs the ambient geomagnetic field (~25–65 µT). At 12–15 mm standoff (drywall + phone glass), a drywall screw typically produces a **0.5–8 µT** local anomaly with a characteristic bipolar signature along the sweep axis. The Earth field is a large, slowly-varying baseline that must be removed — the anomaly is a small AC signal on a big DC pedestal, and the pedestal moves as the phone rotates.

#### 4.1.2 Signal chain (worker-side, per sample)
1. **Apply calibration**: `B_cal = S⁻¹ (B_raw − b)` where `b` is hard-iron offset and `S` is the soft-iron ellipsoid→sphere transform (§4.6).
2. **Rotate to a stable frame.** Because the user's hand rotates during a sweep, the raw components swing wildly. Two signals are computed:
   - `|B|` magnitude — rotation-invariant, robust, primary.
   - `B_wall` — the component along the wall normal, obtained by rotating `B_cal` into the world frame using the fused orientation. Sharper spatial signature, but only trustworthy when orientation is stable.
3. **Detrend**: subtract a long-window (2.0 s) moving median → removes Earth field and slow drift.
4. **Band-limit**: Savitzky-Golay smooth (window ~9 samples, order 2) to kill sensor noise without smearing the peak.
5. **Adaptive noise floor**: `σ = 1.4826 × MAD(residual over trailing 3 s)`.
6. **Peak detection**: prominence-based, requiring prominence `≥ k·σ` (k default 3.5, user-adjustable "sensitivity" 2.0–6.0), minimum peak separation derived from the current sweep speed estimate, and a **bipolar-shape test** (does a lobe of opposite sign flank it?) to reject drift artifacts.
6b. **Position estimate — THE ZERO CROSSING, NOT THE PEAK.** A fastener passing under the sensor produces a bipolar signature, and the fastener sits at the **zero crossing between the two lobes**, not at either amplitude extremum. Estimate it by finding an adjacent pair of opposite-sign local extrema separated by less than one lobe-width in time, then linearly interpolating the sign change between them. This is not a refinement — it is the difference between a hole in the stud and a hole beside it. Measured on the shipped seed fixture (`tests/fixtures/drywall-16oc-synthetic.json`, 3 in/s paced sweep, fasteners at 4.00" and 20.00"):

    | estimator | recovered | error |
    |---|---|---|
    | amplitude extremum | 3.00", 18.98" | ~1.0" — **wrong side of the stud edge** |
    | zero crossing between lobes | 3.90", 20.02" | 0.10", 0.02" |

    Unit-test both estimators against that fixture and assert the zero-crossing one. If a future change makes the amplitude estimator pass, the test is broken, not the algorithm.
7. **Confidence** per peak: `SNR = prominence/σ`, mapped through §4.1.7.

#### 4.1.3 Sensor locator (do this — it's the difference between "close" and "exact")
One-time, per device, in CALIBRATE:
- Prompt: "Hold a screw or a paperclip and slide it slowly around the edge of your phone, starting at the top-left."
- Record `|B|` anomaly amplitude vs. the touch point the user is dragging with their other finger (on-screen crosshair drag), or simpler and better: run a 9-point grid — the user places the metal object on each of 9 screen positions for 1.5 s while the app records amplitude.
- Fit a 2D peak → store `sensorOffset = {x, y}` in screen coordinates.
- **The scan crosshair renders at `sensorOffset`, not at screen center.** Show it as a small etched reticle labeled `SENSOR`.

#### 4.1.4 Sweep model & position estimation
Do **not** double-integrate accelerometer to get position. It drifts uselessly in under a second. Instead:

- **Primary mode — PACED SWEEP.** The app plays a metronome (audio + haptic) and instructs a constant-speed sweep: "match the tick, about one hand-width per second." Position is estimated as `x ≈ v̄ · t` where `v̄` is calibrated by the user's declared sweep distance at the end ("that was about 24 inches" / "I swept from the outlet to the corner" with a known span). The strip chart is in *time*, and converts to *distance* only after a span is declared.
- **Secondary mode — TWO-POINT ANCHOR.** User taps ANCHOR at the start, sweeps, taps ANCHOR at the end, enters the physical distance between anchors. Everything between is linearly mapped. This is accurate enough for spacing inference and honest about what it is.
- **Live mode — MARK ON BEEP.** No position math at all. The app beeps/buzzes/flashes when the sensor is over a peak; the user pencils the wall. **This is the default and the most useful mode.** Show a big, unambiguous, high-contrast state: `— NOTHING —` / `> EDGE <` / `[ ● PEAK ]`.

#### 4.1.5 Stud inference from screws
Once ≥2 peaks with known spacing exist:
- Fit candidate **lattices** of 16.0" and 24.0" on-center (and 12", 19.2" for engineered/TJI layouts, and metric 400/600 mm) by minimizing squared residual over phase `φ` and pitch `p`. Report best fit, residual RMS, and how many observed peaks are explained.
- If ≥3 peaks fit a 16" lattice within ±0.75", state: `16" on center, phase locked — predicting studs at ...` and draw the predicted lattice extending off both edges of the chart.
- If the peaks are **irregular and dense**, that's a signature of plaster/lath or a metal-stud wall — say so and drop confidence.
- A vertical line of screws = a stud. Offer VERTICAL CONFIRM: "Move up 12 inches and sweep the same span. If the peaks land in the same place, it's a stud, not a stray fastener." This is the highest-value trust-building interaction in the app. Overlay the second sweep on the first, aligned by anchors, and score the agreement.

#### 4.1.6 Environment/anomaly guard (runs continuously)
- **Hot wall**: if the detrended signal's RMS exceeds a threshold across the entire sweep with no isolated peaks → `WALL READS HOT. Likely metal studs, conduit, ductwork, or rebar. Fastener detection is not reliable here.`
- **Saturation / near-field**: if |B| exceeds ~120 µT → something big and magnetic is near (or a case magnet).
- **Fixed offset**: if the calibration hard-iron offset magnitude is large (> ~40 µT), `MAGNETIC ACCESSORY DETECTED — remove case/wallet/mount and recalibrate.`
- **Sweep too fast**: if the estimated sweep rate exceeds ~2× the paced rate, throttle and warn — peaks get smeared and missed.
- **Sensor rate collapse**: if actual sample rate drops below 12 Hz (background throttling), warn and pause.

#### 4.1.7 Confidence display — the honesty core
Five states only, always visible, never hidden behind a tap:

| State | Trigger | Copy |
|---|---|---|
| `STRONG` | SNR ≥ 8, bipolar shape confirmed, Tier A, calibrated | Screw. Mark it. |
| `LIKELY` | SNR 5–8, or STRONG conditions on Tier B | Probably a fastener. |
| `POSSIBLE` | SNR 3.5–5 | Something's there. Sweep again to confirm. |
| `NOISE` | below threshold | Nothing found on this pass. |
| `UNRELIABLE` | hot wall / uncalibrated / saturated / rate collapse | Conditions are bad. Here's why: [reason]. |

Confidence is a **first-class output** attached to every logged reading. Never render a stud marker without its state.

#### 4.1.8 SCAN screen layout
- Top: capability badge (`FIELD µT` / `PROXY` ), calibration age, sensitivity slider.
- Center: **the field ribbon** — a scrolling strip chart, right-to-left, of the detrended signal, with the noise floor drawn as a soft band and detected peaks pinned as vertical ember lines. This is the signature visual of the whole app (§7).
- The sensor reticle sits at the true sensor position with a vertical "you are here" line into the ribbon.
- Big state word (`PEAK`) in condensed display type, and the numeric anomaly in mono HUD numerals: `+3.42 µT  SNR 9.1`.
- Bottom: `MARK` (drop a marker), `ANCHOR`, `SWEEP AGAIN`, `SAVE SCAN`.
- Screen-off-friendly: audio pitch rises with anomaly amplitude so the user can scan with the phone flat against the wall where the screen isn't visible. **This is essential — the phone's screen faces the wall during a scan.** Audio and haptics are the primary channel; the screen is the review channel.

#### 4.1.9 MANUAL STUD MODE (Tier C, and always available)
Pure arithmetic, no sensors, genuinely useful:
- Inputs: a known reference (corner, door jamb, window edge, outlet box, previously-found stud), assumed OC spacing, wall length, layout direction.
- Outputs: predicted stud centerlines with a ± band, plus the standard-practice notes (outlets and switch boxes are usually fastened to the side of a stud; the first stud from a corner is often irregular; door/window openings have king + jack studs and a header).
- Renders a printable/screenshot-able tape map.

### 4.2 LEVEL — level, plumb, and camera overlay

#### 4.2.1 Fusion
- Gravity vector from low-passed `accelerationIncludingGravity` (α ≈ 0.02 at 60 Hz), fused with gyro integration via a **complementary filter** (or Madgwick — implement complementary first, Madgwick as an upgrade behind a flag, and A/B them on recorded fixtures).
- `pitch = atan2(-ax, sqrt(ay² + az²))`, `roll = atan2(ay, az)` — define and document the exact axis convention in `PHYSICS.md` and unit-test all six cardinal orientations plus the gimbal-adjacent cases.
- **Motion gate**: if `|‖a‖ − 9.81| > 0.35 m/s²` or `‖ω‖ > 0.25 rad/s`, the reading is `MOVING` and the numeral goes dim; only display a `HOLD` reading when stable for 400 ms. Never show a twitching number as a measurement.

#### 4.2.2 Zeroing (both required)
- **Zero here**: single-point offset for the current surface.
- **Reversal calibration** (the real one): measure on a surface, rotate the phone 180° in plane, measure again. True surface angle = (m1 − m2)/2; sensor bias = (m1 + m2)/2. Store bias per axis. Walk the user through it with an animation. Until this is done, the app claims ±0.5°; after, ±0.15° (verify empirically and put the real number in `ACCURACY.md`).

#### 4.2.3 Modes
- **Surface level** (phone flat): 2-axis bubble, pitch + roll, big numerals.
- **Edge level** (phone on its long edge, against a shelf): 1-axis, huge numeral, `LEVEL` lock state with a distinct tone and haptic pulse at |θ| < 0.2°.
- **Plumb**: phone flat against a vertical surface; reports deviation from vertical, and rise/run + "out by X over 8 ft" (`out = tan(θ) × height`, height user-set, default 96").
- **Camera overlay**: live rear camera, with a true-horizontal and true-vertical line drawn through the tap point, rotated by the measured roll, plus a ghost of the object edge the user is aligning to. Draw the **discrepancy wedge** between the true line and the detected/target edge, with the angle labeled. Freeze-frame + save to LOG.
- **Slope outputs**, all simultaneously: degrees, percent grade, in/ft, mm/m, rise:run ratio, and the plumbing/drainage callout (`1/4 in per ft` is the code-standard drain slope; flag when a measured pipe slope is inside/outside ¼"–½" per ft).

#### 4.2.4 Sound
A continuous tone whose pitch maps to deviation, silent at level, with a soft click at exact level. The user should be able to level a shelf with the phone on it and their eyes on the bracket.

### 4.3 CORNER — angles from a photograph

This is the most mathematically interesting piece. Get it right or don't ship it.

#### 4.3.1 The math (implement exactly this; document in `PHYSICS.md`)
1. Camera model: pinhole, intrinsics `K = [[f,0,cx],[0,f,cy],[0,0,1]]`, principal point at image center, square pixels (state these assumptions in the UI).
2. The user marks the two edges forming the corner of interest by dragging **two endpoints per edge** onto the photo, with a magnifier loupe (essential — finger occlusion otherwise makes this useless). Optionally snap-assist to a local gradient/edge maximum within ±6 px.
3. Each image line `l` (through points p₁,p₂ in homogeneous coords) is `l = p₁ × p₂`.
4. For an edge whose 3D direction we want: the direction in camera coordinates is `d = normalize(K⁻¹ · v)` where `v` is the vanishing point of that edge's family. With a **single visible edge** we cannot get `v` from one line alone — so we require, per edge, either (a) a second line parallel to it in the real world (the two sides of a door jamb, the two rails of a frame, top and bottom of a cabinet face), giving `v = l₁ × l₂`, or (b) the planar assumption below.
5. **Angle between two edges**: `θ = acos(|d₁ · d₂|)`, reported in [0°,180°] with the sign/orientation resolved from the image ordering.
6. **Planar fallback (the common case: photographing a rectangle-ish frame flat-on).** If the user marks four corners of a quadrilateral that is planar in the world, compute the homography `H` from the image quad to a rectified plane. Recover the two vanishing points `v₁ = H·[1,0,0]ᵀ`, `v₂ = H·[0,1,0]ᵀ` (columns of H are exactly these), then the true angle between the two edge families is `acos(|(K⁻¹v₁)·(K⁻¹v₂)|)` after normalization. Reject configurations where a vanishing point is near-infinite in a numerically unstable way and say so rather than emitting garbage.
7. **Gravity assist**: capture the device orientation at shutter time. The world-vertical direction projects to a known image line family; use it to (a) sanity-check the vertical vanishing point, and (b) report *plumb-referenced* angles ("the left jamb is 1.1° out of plumb, the head is 0.4° out of level, so the corner is 88.5°") — which is far more actionable than a bare corner angle.

#### 4.3.2 Intrinsics & calibration
- Default `f_px = (imageWidth/2) / tan(hFOV/2)`. Try `track.getSettings()` for a reported FOV; if absent, default hFOV = 67° (main rear camera), and **say the estimate is uncalibrated**.
- **Calibration routine** (in CALIBRATE): photograph a US Letter sheet (or A4, user picks) lying flat, mark its four corners. Since the true aspect ratio is known, solve for `f` that makes the rectified quad match the true ratio. Store per-device, per-camera-track. Optionally solve a single radial distortion coefficient `k₁` with a second shot of the sheet near the frame edge.
- After calibration, display `LENS: CALIBRATED (f = 1123 px)` and tighten the reported uncertainty.

#### 4.3.3 Uncertainty (mandatory)
Monte-Carlo it in the solver worker: perturb every marked corner by Gaussian noise `σ = 2 px` (scale with zoom level and image resolution), 500 samples, recompute θ each time, and report **median ± half-width of the 5–95% interval**. Display as `88.4° ± 0.6°`. If the interval exceeds ±2.5°, tell the user the geometry is poor and how to fix it (get more square-on, capture more of both edges, move back, use the loupe).

#### 4.3.4 Outputs
- The measured corner angle, its deviation from 90°, and the practical consequence: for a piece of trim `L` inches long meeting that corner, the gap at the heel/toe is `L · tan(Δ)`; the correct miter for each side is `(180° − θ)/2` when the two pieces meet at that corner and split the difference — and **the asymmetric option** when one piece is fixed.
- "Rack" readout for a cabinet/frame: the difference between the two diagonals, computed from the rectified quad and a declared reference dimension, because that's how a cabinetmaker actually checks square.
- Save annotated photo to LOG with the marks, the angle, and the uncertainty burned in.

### 4.4 LAYOUT — repeat spacing

#### 4.4.1 The solver
Inputs: total span `S`, item count `n`, item width `w` (optional), and mode:
- **Equal centers**: centers at `S·(i+1)/(n+1)` (hang-from-wall-to-wall gallery) or `margin + i·pitch` (fixed margins).
- **Equal gaps**: `gap = (S − n·w)/(n+1)`, centers at `gap·(i+1) + w·(i+0.5)`.
- **Fixed pitch, centered**: user gives pitch (e.g., cabinet pulls at 96 mm CTC), app centers the run and reports leftover margins.
Outputs in **exact fractions** (nearest 1/16", with 1/32" available) as well as decimal inches and mm. Show the tape-measure reading for each mark from the chosen datum, and also a **cumulative** vs **incremental** column, because cumulative is how you avoid stacking error and incremental is how people actually work. Warn explicitly: "Measure all marks from the same end. Don't chain."

#### 4.4.2 The guided placement
- Mark point A. Establish a level line from A using the LEVEL engine and camera overlay (draw the true-level line across the live view through A).
- Enter span (measured with a tape, or derived from a photo scale — see below) and count.
- The app overlays the computed marks on the live camera view along the level line, with distance callouts, and pins them to the frozen photo when you tap SNAP. This is a **planning and verification overlay, not a substitute for the tape** — say that.
- **Photo-scaled layout**: on a frozen, gravity-rectified photo of the wall, the user taps two points and enters the real distance between them; that sets the scale on the wall plane; all other marks are then computed and dimensioned in real units. Uncertainty grows with the ratio of measured span to reference span — display it (`±¼" over 8 ft`).
- **Story pole export**: generate a printable strip (PDF via canvas → `window.print()`, no libraries) with the marks at true scale for short spans, plus a plain text/CSV cut list. Also a big-type "read-aloud" list for when you're on a ladder.

#### 4.4.3 The presets that make it feel built by someone who's done it
Gallery wall (57" center height standard), cabinet pulls (edge offsets and CTC standards), shelf brackets (align to found studs from SCAN — **wire SCAN's stud lattice directly into LAYOUT as an available datum**), fence pickets, tile spacing with grout lines, curtain rod brackets, TV mount to stud centers.

### 4.5 BEVEL — angle capture and transfer

#### 4.5.1 Capture
- **Gravity mode (default, robust)**: place the phone flat against the reference face → capture gravity vector `g₁` in device frame; place against the second face → `g₂`. If both faces share a common horizontal edge (the normal case for a miter), the dihedral angle is `θ = acos(ĝ₁·ĝ₂)` — but **only valid when the shared edge is horizontal**. Detect and enforce that condition; refuse and explain otherwise.
- **3D mode (advanced)**: full orientation fusion including yaw. Capture quaternions at both placements, compute face normals in world frame, `θ = acos(n̂₁·n̂₂)`. On Tier A/B, yaw is magnetically referenced (warn: nearby steel corrupts it). Without magnetic yaw, integrate the gyro between placements and **display a drift budget that grows with elapsed time** — after 20 s, refuse to report.
- Capture requires 500 ms of stillness; average over the still window; report the standard deviation as the reading's uncertainty.

#### 4.5.2 Solve for saw settings
- **Simple miter**: two pieces meeting at corner angle `C`, split evenly → each miter `= (180° − C)/2`. Asymmetric option when one piece is pre-cut.
- **Bevel/tilt**: for a compound cut, report both the miter (table rotation) and the bevel (blade tilt).
- **Compound crown molding** with spring angle `S` measured from the wall, corner angle `C`, and `D = (180° − C)/2`:
  - `miter = atan( sin(S) · tan(D) )`
  - `bevel = asin( cos(S) · cos(D) )` *(candidate form — see mandatory verification)*
  - **MANDATORY VERIFICATION:** do not trust the formulas above. Derive the compound-cut angles from first principles with rotation matrices (build the two wall planes at corner angle C, the molding plane at spring angle S, the bisecting cut plane, then express the cut plane in the saw's frame as a table rotation + blade tilt). Then unit-test against these canonical values and fix the derivation until they pass exactly:
    - 90° corner, 45/45 crown → **miter 35.26°, bevel 30.00°**
    - 90° corner, 52/38 crown → **miter 31.62°, bevel 33.86°**
    - 180° (flat splice) → **miter 0°, bevel 0°**
    - Also verify monotonic, continuous behavior across C ∈ [60°,180°] and S ∈ [30°,60°] — no discontinuities, no NaN.
  - Also provide the **nested (in-position) crown** setting: single miter `= atan(tan(D)/cos(S))`-family — again, derive and verify; state clearly which method the numbers are for, because giving a carpenter the wrong one wastes a stick of molding.
- Output a **saw card**: the setting numbers in huge mono numerals, the direction of blade tilt (left/right), which face goes against the fence, which side is the keeper, and the "flip or not" instruction for the mating piece. Include a "these are the settings, here's the test cut instruction" line — a real carpenter tests on scrap; the app should tell them to.
- Common-angle table: hold-and-transfer for 90/45/22.5/135, plus the measured value pinned at the top.

### 4.6 CALIBRATE

Four routines, each with a pass/fail and an age timestamp. Any tool that depends on a stale or failed calibration says so on its own screen.

1. **Magnetometer hard/soft iron.** Figure-8 rotation for 20–30 s while collecting samples. Fit an ellipsoid (least-squares quadric fit, then eigen-decomposition → center `b` and transform `S`). Show live coverage as a 3D sphere filling in — this is a delightful, honest progress display. Pass criteria: coverage of all octants, residual sphericity error < 5%, `|b|` reported. Fail loudly on `|b| > 40 µT` with the case-magnet message.
2. **Sensor locator** (§4.1.3).
3. **Level reversal zero** (§4.2.2), per axis.
4. **Lens intrinsics** (§4.3.2).

Also: a **SELF-TEST** screen showing live sample rates, sensor health, permission states, capability report, and a "copy diagnostics" button that puts a JSON blob on the clipboard for debugging in the field.

### 4.7 LOG

Every measurement can be saved with: type, value(s), uncertainty, confidence state, calibration state at time of capture, timestamp, optional note, optional photo, optional room/project tag. Views: chronological, by project, by type. Export: JSON, CSV, and a printable "job sheet" (canvas → print stylesheet). Import back for continuity. All local, IndexedDB, with a clear "delete all data" control. No cloud, ever.

---

## 5. UNITS, FORMATTING, AND NUMBERS

- Full support for imperial fractions: parse and display `3' 4-7/16"`. Implement exact rational arithmetic (integer numerator/denominator) for layout math to avoid float fraction drift; round to the user's chosen precision (1/8, 1/16, 1/32) only at display time, and show the rounding direction when it matters.
- Metric: mm default for layout, m for spans.
- Angles: degrees to 2 dp internally, displayed at 1 dp with uncertainty. Also offer percent grade and in/ft.
- Every number in the UI is one of: **MEASURED** (with ±), **DERIVED** (from measured, with propagated ±), or **ENTERED** (by the user). Style them distinguishably — this is a core honesty mechanism, not a nicety.

---

## 6. PERMISSIONS & FIRST-RUN CHOREOGRAPHY

1. **Cold open shows something useful immediately** — the LEVEL tool works off `devicemotion` and, on iOS, needs a gesture. So: a full-screen `TAP TO WAKE SENSORS` panel with a one-line reason, then `DeviceMotionEvent.requestPermission()` and `DeviceOrientationEvent.requestPermission()` in the same gesture handler.
2. Camera permission is requested **only** when CORNER/LAYOUT/overlay is opened, with an inline explanation.
3. Magnetometer permission (`navigator.permissions.query({name:'magnetometer'})` + sensor construction in a try/catch) is requested when SCAN is opened.
4. **Every denial has a recovery path**: exact instructions per platform, and the app remains usable in reduced form.
5. Never block the whole app behind a permission. Ever.

---

## 7. DESIGN SYSTEM — DRAPLIN DESIGN CO.

The direction is Aaron Draplin's house style: flat, heavy, high-contrast, gray/white/orange. No
gradients. No glows. No drop shadows. No soft anything. Thick rules, hard edges, generous solid
fields of color, and type doing the heavy lifting. If a surface needs separating from another
surface it gets a 3px rule or a different flat fill — never a shadow.

DDC's own site offers a straight white-on-black / black-on-white switch, and that is the theme
model here: two hard-contrast modes, nothing in between.

### 7.1 Palette

| Token | Hex | Use |
|---|---|---|
| `--orange` | `#F15A22` | **live measured values only** — the one loud color |
| `--orange-deep` | `#C8481A` | pressed states, orange-on-orange rules |
| `--ink` | `#1A1A1A` | night ground, shop type |
| `--charcoal` | `#2E2E2E` | night raised surface, icon ground |
| `--gray` | `#58595B` | rules, secondary type on light |
| `--gray-mid` | `#939598` | disabled, inactive ticks |
| `--gray-light` | `#D1D3D4` | light-mode rules and fills |
| `--off-white` | `#F1F2F2` | shop ground, night type |
| `--white` | `#FFFFFF` | the blade, cards on light |

Two state colors, used sparingly and never decoratively: `--red #C1272D` for UNRELIABLE and out
of tolerance, `--green #007A3D` for LOCK / TRUE / in tolerance. Nothing else enters the palette.

**The orange rule is absolute.** `--orange` marks a value a sensor is producing right now.
Nothing static, decorative, or user-entered ever wears orange. It is a functional signal, not a
brand flourish, and it is what makes a reading legible at arm's length with a drill in the other
hand.

### 7.2 Themes
- **SHOP** (default): `--off-white` ground, `--ink` type, `--gray-light` rules, orange readings.
  Light-first because this tool lives outdoors and in bright garages, and because DDC is
  light-first.
- **NIGHT**: `--ink` ground, `--off-white` type, `--gray` rules, orange readings. Attics,
  crawlspaces, jobs with the power off.
- One-tap switch reachable from every screen, persisted. Honor `prefers-color-scheme` on first
  run, then the user's choice wins permanently.

### 7.3 Type — DDC Hardware

Shipped in `fonts/`, self-hosted, three faces, 24 KB total for all three. Wired by `fonts.css`.

| Role | Face | Notes |
|---|---|---|
| Display — tool names, state words | DDC Hardware Compressed | uppercase, `letter-spacing: 0.06em` |
| UI — labels, buttons, table headers | DDC Hardware Regular | sentence case |
| HUD — every live number | DDC Hardware Condensed | **verified tabular**: every digit advances 1032/2048 em, so readouts do not jitter as they change |
| Prose — Field Manual, long explainers | system stack | DDC Hardware is a display family: superb on numerals and labels, fatiguing over a paragraph. The manual is read, not glanced at. |

Two glyphs were missing from the originals and have been patched into the shipped woff2 files:
**U+00B5 MICRO SIGN** (built from `u` plus a stem descender matched to each face's stem weight)
and **U+2032 PRIME** (mapped to the straight quotesingle). Both are load-bearing — µT for field
readings, ′ for feet. Do not re-subset from the original TTFs or you will lose both.

Licensing: DDC Hardware is Lost Type Co-op. Their commercial license covers use on a single
website and permits modification so long as the font is not redistributed. The app owner holds
the license. Do not add a download link to the font files and do not publish them to any package
registry.

### 7.4 Layout and form
- Hard 8px grid. Rules are 3px, or 6px for section breaks.
- Border radius 0 by default. The only rounded things are the physical-object illustrations.
- Buttons: flat fill, 2px hard border, uppercase display type, no shadow, no gradient. Pressed
  state swaps fill and border with no motion.
- Cards: flat fill plus a 3px rule. Never a shadow.
- Big blocks of flat color are encouraged. Empty space is fine; fussiness is not.

### 7.5 The mark — SHIPPED, DO NOT REGENERATE

`icons/` contains the finished set. Copy to `public/icons/` unmodified and wire with the supplied
`manifest.webmanifest` and `head-snippet.html`. Do not draw new icons or substitute an icon font.

The mark is a **framing square with a plumb bob dropped through the heel** — flat white blade with
the graduations cut out as negative space, orange bob, charcoal ground. Two instruments in one
silhouette: the square checks the corner, the bob answers only to gravity. The app's name as an
object.

Required in-app reuses:
1. **Loading mark** — the bob drops into place once, 400 ms, then holds. `prefers-reduced-motion`
   gets the settled state with no motion.
2. **LEVEL / plumb out-of-tolerance state** — the same bob silhouette at 15% opacity behind the
   live readout. It hangs true while the measured line does not, and the gap between them is the
   error, shown rather than described.
3. **Favicon, tab, install** — via the supplied files.

Alternates shipped, not selected: `app-icon-square-hung.svg` (bob hung in the open quadrant with
an eyelet) and `app-icon-square-orange.svg` (orange field, charcoal bob — strong badge, loud on a
home screen).

### 7.6 Illustration
Flat two-color line-and-fill only, in `--ink` and `--orange` on the theme ground. Tool icons are
the instruments themselves: the square, the vial, the bob, the story pole, the bevel gauge, the
stud bay. No perspective, no shading, no texture. Draplin logo discipline — if it does not read
as a solid silhouette at 24px, redraw it.

### 7.7 Ergonomics (non-negotiable)
- All primary controls in the bottom third, reachable one-handed.
- Minimum touch target 56px; glove mode expands to 72px and increases spacing.
- The live value is legible at arm's length: ≥ 64px numerals on the primary readout.
- Landscape support on every tool, especially LEVEL.
- `prefers-reduced-motion` respected everywhere; this design has almost no motion to begin with.
- Visible keyboard focus: 3px orange outline, no glow. Full ARIA labeling and live regions for
  state words. A screen-reader user must be able to run SCAN by audio alone — and so should
  everyone else, because the screen faces the wall during a scan.
- Wake lock during active measurement, released when idle.
- Dynamic type to 200% without breaking any layout.

## 7B. GUIDANCE, ONBOARDING & SUPPORT — CO-EQUAL WITH THE TOOLS

Treat this section with the same weight as the physics. A stud finder a person cannot confidently
operate on their own kitchen wall has failed, no matter how good the DSP is. This is an
instructional problem and it gets designed like one: scaffolding, worked examples, fading prompts,
and just-in-time correction.

### 7B.1 Three layers, always all three
1. **Ambient** — the interface teaches itself. Plain-language labels, honest state words, no
   jargon that is not either self-evident or one tap from a definition. Most users must never need
   layers 2 or 3.
2. **On demand** — every control, badge and readout has a help affordance opening a short card in
   a fixed three-part shape: **what this does / what it can't do / how to check it**. That third
   part is mandatory and is what separates this app from everything else in the category.
3. **Guided run** — a walkthrough that drives the real tool with live sensor data, one instruction
   at a time, advancing on actual sensor events rather than on a Next button.

### 7B.2 First run: prove it, don't pitch it
Ninety seconds, no slideshow, no feature tour. The goal is one real detection on the user's own
wall. Sequence: permissions with a one-line reason each → case-magnet check → 20-second figure-8
calibration → "walk to any interior wall and sweep here" → first peak → "that's a screw. There's a
stud behind it." Only after a successful first detection does the full tool grid unlock; until
then the app shows SCAN and one quiet "skip setup" link. Never trap anyone: skip always works, and
the tour is resumable from the Field Manual forever.

### 7B.3 Per-tool walkthroughs with fading
All seven tools ship a guided run. Prompts fade on a schedule stored per tool in IndexedDB:
- Runs 1–2: full guidance, every step narrated, one control highlighted at a time.
- Runs 3–5: reduced to the steps where people actually go wrong — sweep speed, standoff, corner
  marking precision, stillness before capture.
- Run 6+: silent, with a persistent unobtrusive "guide me" affordance.
Per-tool reset available. Never re-show a dismissed prompt without an explicit reset.

### 7B.4 Worked examples from the fixture corpus
Every tool has a **DEMO** mode that replays a bundled recorded sensor trace through the real
pipeline, so a user can watch the tool work on a known-good wall before trying it — including the
failures: watch it correctly refuse on a metal-stud wall, watch it catch a MagSafe case. **The
test fixtures and the tutorial content are the same files.** This is the highest-leverage decision
in the build: A10's regression corpus and A13's teaching material are one artifact, so the
tutorials can never drift from the behavior.

### 7B.5 Tooltips and coach marks — the rules
- One at a time. Never two visible at once, never a stacked queue.
- Anchored to the element, dismissible by tapping anywhere, never blocking the control underneath.
- Two lines maximum, verb first, one idea. Needing three lines makes it an explainer card, not a
  tooltip.
- Fully accessible: `aria-describedby`, focus-reachable, announced by screen readers, dismissible
  by keyboard.
- No animation beyond instant appearance. This design does not bounce.

### 7B.6 Just-in-time explainers on every failure and every uncertainty
- Every warning links to a card: **why this is happening / what to do / what happens if you ignore
  it**. `WALL READS HOT`, `MAGNETIC ACCESSORY DETECTED`, `SWEEPING TOO FAST`, `LENS NOT
  CALIBRATED`, `GYRO DRIFT BUDGET EXCEEDED` — all of them, no exceptions.
- Tapping any confidence badge opens what produced this number, what would raise it, and a one-tap
  route to the calibration that would help.
- Tapping any `±` explains in one sentence what the uncertainty is derived from.

### 7B.7 The Field Manual
A complete offline help section, searchable, organized by **task, not by feature**: "Hang a heavy
mirror" · "Find a stud with no power tools" · "Why won't my trim fit this corner?" · "Space five
frames evenly" · "Cut crown for a corner that isn't 90°" · "Check a shelf is level before
drilling" · "What this app can't do." Each entry states the goal, the tools it uses, the steps with
real numbers, the failure modes, and a button that opens the right tool preconfigured. Every entry
ends with a verification step, because the honesty charter applies to teaching too: small bit
before the big one, test cut on scrap, second sweep twelve inches up.

### 7B.8 Glossary
Every domain term is tappable wherever it appears: on center, plumb, spring angle, miter, bevel,
kerf, witness mark, king stud, header, standoff, hard iron, soft iron, SNR, prominence, vanishing
point, dihedral. One short definition plus one line on why it matters here. Underline style:
dotted 2px `--gray`, never orange — orange is reserved for live values.

### 7B.9 Practice and recovery
- **Practice mode** for LAYOUT and BEVEL: run the full math with typed numbers, no wall required.
  Useful on the drive to the store.
- **Undo everywhere.** Marks, anchors, corner points, log entries. Nothing destructive is one tap
  from gone, and "restore last scan" survives a reload.
- **Diagnostics**: one button copies a JSON blob with the capability report, calibration state,
  sample rates and the last error. Plus a printable one-page quick-start card generated from the
  manual.

### 7B.10 Copy rules for all guidance
Verb first. Present tense. Second person. One idea per sentence. Never explain the same thing twice
in one flow. Never apologize. Never say "simply", "just", or "easy" — the user is holding a phone
against a wall in a dusty room and nothing about that is simple. State the action, then the reason,
in that order: "Sweep slower — peaks smear above about six inches per second."

## 8. SHARED CONTRACTS (subagents must not change these without a documented ADR)

```ts
export interface Measurement<T = number> {
  id: string; kind: 'stud'|'angle'|'level'|'plumb'|'corner'|'layout'|'bevel';
  value: T; unit: string;
  uncertainty: { plusMinus: number; basis: 'montecarlo'|'stddev'|'nominal'|'unknown' };
  confidence: 'STRONG'|'LIKELY'|'POSSIBLE'|'NOISE'|'UNRELIABLE';
  provenance: {
    tier: MagTier; calibrations: Record<string, {ok: boolean; ageMs: number}>;
    sampleCount: number; capturedAt: number; notes?: string;
  };
  media?: { photoId?: string; overlay?: unknown };
}

export interface CalibrationProfile {
  deviceKey: string; updatedAt: number;
  mag?: { hardIron: Vec3; softIron: Mat3; residual: number; coverage: number };
  sensorOffset?: { x: number; y: number };           // normalized screen coords
  levelBias?: { pitch: number; roll: number };
  lens?: Record<string, { fPx: number; k1?: number; width: number; height: number }>;
}
```
Everything the UI displays as a measurement flows through `Measurement`. The uncertainty and confidence fields are **required** — make them non-optional in the type so no one can forget.

---

## 9. PERFORMANCE BUDGET

- Sensor→display latency < 50 ms for SCAN audio/haptic feedback (this is what makes it feel real).
- Sustained 60 fps on the ribbon with camera off; ≥ 30 fps with camera preview active on a 4-year-old mid-range Android.
- Main-thread long tasks < 50 ms, always. Move any solver that exceeds it into a worker.
- Cold start to interactive < 1.5 s on a mid-range phone, offline.
- Total bundle < 300 KB gzipped including fonts. (Zero runtime deps makes this easy; don't blow it on font weights — two weights per family, subset to Latin + the glyphs actually used.)
- Battery: no polling loops when idle; unsubscribe sensors when a tool is not visible (`visibilitychange` + route change).

---

## 10. TESTING & VERIFICATION

### 10.1 Unit + property tests (Vitest), minimum coverage of the math
- Quaternion/matrix algebra: round-trip identities, normalization, `q → euler → q` stability, property test against 10⁴ random rotations.
- `levelMath`: all six device orientations, ±90° edges, sign conventions, bias removal, reversal-calibration algebra.
- Ellipsoid fit: generate synthetic sphere data, apply a known hard-iron offset + soft-iron matrix + noise, verify recovery within tolerance. Property-test over 200 random distortions.
- Peak detection: synthetic dipole signatures at known positions with injected noise at multiple SNRs — verify precision/recall curves and that reported confidence correlates monotonically with true SNR. **Publish that curve in `ACCURACY.md`.**
- Lattice fit: synthetic 16"/24" screw patterns with missing and spurious fasteners; verify correct pitch/phase recovery and correct refusal on random patterns.
- `vanishing`/`angleSolver`: **synthesize ground truth** — construct a virtual 3D corner at a known angle, project it through a known `K` from many camera poses, feed the projected points to the solver, assert recovered angle within tolerance. Sweep angle ∈ [70°,110°], pose ∈ realistic range. This is the single most important test in the repo.
- Monte Carlo uncertainty: verify calibration — for a given injected pixel noise, the reported ±band should contain the truth ~90% of the time. Test it.
- `miter`: the canonical values in §4.5.2, plus continuity sweeps.
- `units`: fraction parse/format round trips, exact rational layout arithmetic, no accumulated drift over 100 marks.

### 10.2 Fixture-driven integration
Record (or synthesize, clearly labeled) sensor traces and commit them:
- `drywall-16oc-clean.json`, `drywall-24oc-noisy.json`, `metal-stud-hot-wall.json`, `plaster-lath-dense.json`, `magsafe-case-attached.json`, `sweep-too-fast.json`, `tierB-heading-proxy.json`.
The kit ships `fixtures/SCHEMA.md` and one verified synthetic seed trace, `fixtures/drywall-16oc-synthetic.json` (both land in `tests/fixtures/` — see `kit/KIT-MANIFEST.md`) (two fasteners 16" on centre, bipolar signatures on a drifting pedestal, 0.22 µT rms noise, with its `expected` block asserted). Use its format exactly. Replace synthetic traces with real recordings as field data arrives, and keep both — `synthetic: true` must be visible anywhere a DEMO shows one.
Each fixture has an expected-outcome file. `npm run verify:fixtures` replays all of them headlessly through the real pipeline and asserts detected positions, confidence states, and warning messages. **This is the regression net for the entire product.**

### 10.3 E2E (Playwright)
- Boot with mocked sensor APIs at each capability tier; assert the correct degraded UI, correct copy, no crashes, no false claims.
- Permission-denied paths for motion, orientation, camera, magnetometer.
- Offline: load once, go offline, hard reload, verify full function.
- Install: manifest validity, icon set, standalone display.
- A11y: axe scan on every route, zero serious violations; keyboard-only traversal of every tool.
- Visual regression snapshots for all 7 tools × 3 themes × 2 orientations.

### 10.4 Real-device field validation (for the human — write this up in `FIELD-TEST.md`)
The agent cannot do this; it must produce the protocol and the recording tools so the human can, in about **90 minutes total**:
1. **(10 min)** Calibrate all four routines. Record the diagnostics blob.
2. **(20 min)** Known wall: find a stud by knocking/nail-test, mark it, then scan and record. Repeat across 6 ft. Compare app peaks to a tape measurement of the true screw line. Log error in inches.
3. **(10 min)** Level: check against a known-good 4-ft spirit level and a machinist's square on a countertop. Record the delta before and after reversal calibration.
4. **(15 min)** Square: photograph a door frame from 5 different positions and distances; compare the five reported angles to each other (repeatability) and to a framing-square/protractor ground truth (accuracy).
5. **(15 min)** Bevel: capture a known 45° cut and a known 22.5° cut; check the saw card numbers against a digital angle gauge if available.
6. **(20 min)** Adversarial: scan over an outlet, over a copper supply line, over a metal-stud wall if available, with a MagSafe case on, and with the phone sweeping too fast. **Verify the app warns instead of lying in every case.** This is the acceptance test for the honesty charter.
Record every session with `record.ts` and drop the traces into `tests/fixtures/real/` so the suite gets stronger every time.

---

## 11. DEPLOYMENT (Netlify, no keys)

`netlify.toml`:

```toml
[build]
  command = "npm ci && npm run build"
  publish = "dist"

[build.environment]
  NODE_VERSION = "20"

[[headers]]
  for = "/*"
  [headers.values]
    Permissions-Policy = "accelerometer=(self), gyroscope=(self), magnetometer=(self), camera=(self), ambient-light-sensor=(self)"
    Referrer-Policy = "no-referrer"
    X-Content-Type-Options = "nosniff"
    Cross-Origin-Opener-Policy = "same-origin"
    Content-Security-Policy = "default-src 'self'; img-src 'self' blob: data:; media-src 'self' blob:; script-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self'; connect-src 'self'; worker-src 'self' blob:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'"

[[headers]]
  for = "/sw.js"
  [headers.values]
    Cache-Control = "public, max-age=0, must-revalidate"

[[headers]]
  for = "/assets/*"
  [headers.values]
    Cache-Control = "public, max-age=31536000, immutable"

[[redirects]]
  from = "/*"
  to = "/index.html"
  status = 200
```

Notes for the agent: the `Permissions-Policy` header is **required** or the Generic Sensor API will be blocked even where supported. Verify the CSP does not break workers or blob URLs — test the built artifact, not just dev. Confirm `npm run build && npx serve dist` works fully offline before declaring done. Use the `netlify.toml` and `manifest.webmanifest` shipped in this kit verbatim. Produce a `README.md` with a two-line deploy path (drag `dist/` to Netlify, or connect the repo) and the exact Chrome flag instructions for Tier A on Android.

---

## 12. SUBAGENT FAN-OUT PLAN

Spawn these as parallel subagents. Each gets: this document, its charter, its owned paths, and the §8 contracts. **No subagent edits another's owned files** — cross-boundary needs go through the contracts or an ADR in `DECISIONS.md`. Integrate only at phase gates.

| # | Agent | Owns | Charter |
|---|---|---|---|
| A1 | **Sensor Platform** | `src/sensors/**` | Capability probe, permission choreography, all three mag tiers, IMU normalization, orientation fusion, record/replay harness. Deliver replay first — everyone else depends on it. |
| A2 | **DSP / Magnetics** | `src/dsp/**`, `src/workers/dsp.worker.ts` | Calibration fitting, filtering, peak detection, confidence state machine, lattice inference, environment guards. Owns `ACCURACY.md` precision/recall curves. |
| A3 | **Geometry / Vision** | `src/geometry/**`, `src/tools/corner/**` | Vanishing points, intrinsics + lens calibration, angle solver, Monte Carlo uncertainty, homography, rectification. Owns the synthetic-projection ground-truth test suite. |
| A4 | **Craft Math** | `src/geometry/{layout,miter,units}.ts`, `src/tools/{layout,bevel}/**` | Spacing solvers, exact rational arithmetic, fraction I/O, simple + compound miter with mandatory canonical verification, saw cards, story pole export. |
| A5 | **Level & Overlay** | `src/tools/level/**`, `src/ui/overlay/**` | Fusion consumption, motion gating, zeroing/reversal, camera overlay rendering, slope outputs, level tone engine. |
| A6 | **Scan Experience** | `src/tools/scan/**`, `src/ui/charts/**` | The field ribbon, sweep modes, audio/haptic feedback loop, sensor reticle, vertical confirm, manual stud mode. This agent owns the signature moment — hold it to a higher bar. |
| A7 | **Shell / Design System** | `index.html`, `src/app/**`, `src/ui/tokens.css`, `src/ui/components/**` | Routing, navigation, capability banner, three themes, glove mode, typography, self-hosted fonts, ergonomics, all copy. Owns tone of voice: plain, direct, active, never apologetic, never vague. |
| A8 | **Persistence & Log** | `src/tools/log/**`, IndexedDB wrapper | Storage schema + migrations, media blobs, export/import, print sheets, delete-all. |
| A9 | **PWA / Deploy / Perf** | `public/**`, service worker, `netlify.toml`, build config | Offline correctness, install, caching strategy, CSP/headers, bundle budget enforcement in CI, Lighthouse ≥ 95 across the board. |
| A10 | **Verification** | `tests/**`, CI | Owns every test tier in §10, the fixture corpus, and the gate scripts. Has **veto power** at phase gates. Must independently re-derive the compound-miter math and the vanishing-point math rather than trusting A3/A4. |
| A11 | **Red Team / Honesty** | `docs/HONESTY-AUDIT.md`, cross-cutting review | Adversarial pass on every screen: find any place the app implies more certainty than it has, any number without a unit or a ±, any silent failure, any state where a denied permission leaves a dead end. Files issues that A1–A9 must fix before Gate 4. Also does the security/privacy audit: prove zero network egress at runtime. |
| A13 | **Guidance & Learning** | `src/guidance/**`, `src/tools/*/guide.ts`, Field Manual + glossary content | Owns §7B end to end: tour engine, tooltip and coach-mark primitives, per-tool walkthroughs with fading, DEMO replay, the Field Manual, the glossary, every explainer card. Pairs with A10 so the fixture corpus and the tutorial content stay one artifact. Nothing in §7B is a Phase 3 bolt-on — a tool's guide ships in the same PR as the tool. |
| A12 | **Docs** | `README.md`, `docs/**` | `PHYSICS.md` (every formula with derivation and axis convention), `ACCURACY.md` (honest measured performance), `FIELD-TEST.md`, `DECISIONS.md` (ADRs). |

**Orchestration rules for the lead:**
- Run A1 alone in Phase 0 (everything depends on the sensor contract + replay).
- Phase 1: A2, A3, A4, A7, A9 in parallel (pure logic and shell; no cross-dependencies).
- Phase 2: A5, A6, A8 in parallel (they consume Phase 1 output).
- A13 runs in Phase 1 (tour engine, tooltip primitives, glossary data model) and Phase 2 (per-tool walkthroughs, DEMO mode, Field Manual). A tool is not done until its guided run is done.
- A10 and A12 run continuously alongside every phase. A11 runs in Phase 3 and again at the end.
- At each gate, the lead reads every subagent's diff personally, runs the full suite, and resolves contract drift. Do not rubber-stamp.

---

## 13. PHASES & TIMEFRAMES

Timeframes are agent-session estimates, not human-hours.

| Phase | Content | Gate criteria | Est. |
|---|---|---|---|
| **0 — Foundation** | Repo, TS strict, Vite, test harness, `capability.ts`, sensor contracts, record/replay, empty shell with 7 routes, Netlify deploy of the skeleton. | Skeleton is live on Netlify, offline-capable, passes a11y scan, replay drives a dummy readout. | 1 session |
| **1 — The math** | DSP pipeline, calibration fitting, geometry solvers, layout/miter math, design tokens, PWA plumbing. All headless, all tested against synthetic ground truth. | Every math test in §10.1 green. Compound miter canonical values exact. Vanishing-point solver within 0.3° on synthetic data. | 2 sessions |
| **2 — The tools** | All 7 tool UIs wired to real sensors, camera overlay, ribbon, audio/haptics, log, export — each shipping with its guided walkthrough and DEMO replay in the same PR. | Fixture suite green. Every tool usable one-handed. Every tool has a working guided run. Lighthouse ≥ 95. Bundle < 300 KB gz. | 3–4 sessions |
| **3 — Honesty & hardening** | A11 red-team pass, all degraded paths, all permission denials, all warning states, copy pass, three themes, glove mode, reduced motion. | Zero findings open from `HONESTY-AUDIT.md`. Every capability tier demoed end-to-end via mocks. | 1 session |
| **4 — Field-ready** | `FIELD-TEST.md`, diagnostics export, real-device protocol, README, production deploy, install verified. | Deployed URL installs as a PWA, works in airplane mode, produces a diagnostics blob. | 1 session |
| **5 — Post-field (human loop)** | Human runs §10.4; real traces come back as fixtures; agent tunes thresholds against reality and republishes `ACCURACY.md` with measured numbers. | Real-wall detection error documented; thresholds tuned; no regression. | 1 session after field data |

---

## 14. DEFINITION OF DONE

Do not report completion until every line is true:

- [ ] `npm ci && npm run build && npm test && npm run test:e2e && npm run verify:fixtures` all pass from a clean clone.
- [ ] Zero entries in `dependencies`. Zero network requests at runtime (verified by a Playwright test that fails the build on any request beyond same-origin precached assets).
- [ ] Deployed to Netlify; URL in `README.md`; installs as a PWA on Android and iOS; works fully in airplane mode after one load.
- [ ] All three magnetometer tiers implemented, and the app is honest and useful in Tier C.
- [ ] Every permission denial has a working recovery path and the app never dead-ends.
- [ ] Every displayed measurement carries a unit and either a ± or a confidence state.
- [ ] Compound miter matches the canonical values exactly; angle solver validated against synthetic projections; ellipsoid fit validated against synthetic distortions; peak detector has a published precision/recall curve.
- [ ] `PHYSICS.md` documents every formula, every axis convention, and every assumption, with derivations.
- [ ] `ACCURACY.md` states expected accuracy per feature per calibration state, and explicitly names what the tool cannot do.
- [ ] Lighthouse PWA/Perf/A11y/Best-Practices ≥ 95 on mobile emulation; axe reports zero serious violations on all routes.
- [ ] Bundle ≤ 300 KB gzipped; cold start ≤ 1.5 s offline on mid-range emulation.
- [ ] `HONESTY-AUDIT.md` closed out by A11.
- [ ] `FIELD-TEST.md` is a protocol a person can actually follow with a tape measure and a spirit level in 90 minutes.
- [ ] All seven tools have a guided walkthrough that advances on real sensor events, and a DEMO mode replaying a bundled fixture through the real pipeline.
- [ ] Every warning state and every confidence badge opens an explainer with what / why / what to do.
- [ ] Every domain term used in the UI exists in the glossary and is tappable where it appears.
- [ ] First run reaches a real detection on a real wall in under 90 seconds, and "skip setup" works at every step.
- [ ] The Field Manual is task-organized, fully offline, searchable, and every entry ends with a verification step.
- [ ] The fixture corpus and the tutorial content are the same files — verified by a test that fails if a DEMO references a fixture the suite does not use.
- [ ] DDC Hardware is self-hosted from `fonts/`, the patched µ and ′ render correctly, and no font file is linked for download.

---

## 15. THE HONESTY CHARTER (governing principle — when in doubt, this wins)

This tool tells people where to drill holes in their house and how to cut expensive material. A confident wrong answer costs money and drywall patches. Therefore:

1. **Never display a measurement without its uncertainty or confidence state.** Not once, not on the "simple" screen, not in the widget.
2. **Say what the tool cannot do, in the tool, at the moment it matters.** The SCAN screen says what it can't find. The CORNER screen says the lens isn't calibrated. The BEVEL screen says the gyro is drifting.
3. **Prefer refusing to guessing.** `UNRELIABLE — the whole wall reads hot, likely metal studs` beats a stud marker that isn't there.
4. **Degrade visibly, never silently.** A dropped sample rate, a stale calibration, a denied permission — all surface immediately, with the remedy.
5. **Distinguish measured from derived from entered.** Visually, always.
6. **The physical world is the arbiter.** Every claim of accuracy in `ACCURACY.md` must trace to a test — synthetic ground truth or real field data — not to a hope.
7. **Teach the limits first.** The guidance layer explains what the tool cannot do before what it can. A user who knows the failure modes trusts the successes more, and drills fewer holes in the wrong place.
8. **Tell people to verify.** Small drill bit before the big one. Test cut on scrap. Second sweep 12 inches up. The best tool in the world still says "check me."

Write the copy so a person trusts it *because* it admits its limits. That's the product.

---

## 16. FIRST THREE ACTIONS FOR THE AGENT

1. `ultrathink`. Then write `PLAN.md` and `DECISIONS.md`, self-critique against §14 and §15, and print the subagent assignment table you'll actually run.
2. Build Phase 0 solo (foundation + `capability.ts` + record/replay + skeleton deploy). Prove the sensor contract on a real page before anyone builds on it.
3. Fan out Phase 1 per §12 and hold the gate.

Go.
