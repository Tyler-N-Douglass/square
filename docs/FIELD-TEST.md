# FIELD-TEST — real-device validation protocol

**Who:** you, a phone, and about 90 minutes.
**What you need:** a tape measure, a 4-ft spirit level (or any level you trust), a framing square
or protractor, a known interior drywall wall, painter's tape and a pencil. Optional: a digital
angle gauge, a machinist's square, a MagSafe case or magnetic mount (for the adversarial pass —
you want one that *should* break the readings).

The app cannot validate itself against the physical world. This protocol produces the numbers
that go into `ACCURACY.md` — measured, not hoped — and every session recorded here makes the
regression suite stronger. Record every scan with the SELF-TEST screen's recorder and save the
traces; they land in `tests/fixtures/real/`.

Before you start: airplane mode ON. The whole session should work without a network. If anything
fails only in airplane mode, that is itself a finding — file it.

## 1. Calibrate (10 min)

1. Open CALIBRATE. Run all four routines in order:
   - **Magnetometer figure-8** — watch the coverage sphere fill. Note the reported hard-iron
     offset |b| and residual. If |b| > 40 µT the app must tell you something magnetic is attached.
     If it doesn't and you have a magnetic case on, that is a failed test.
   - **Sensor locator** — note where the crosshair lands. It should be near the top of the phone,
     not the center.
   - **Level reversal zero** — follow the two-position walkthrough on a countertop.
   - **Lens** — photograph a Letter/A4 sheet flat on the floor, mark corners with the loupe.
2. Open SELF-TEST. Tap **copy diagnostics** and paste the JSON blob somewhere you can keep it.
   Confirm sample rates: magnetometer ≥ 20 Hz (Tier A) and motion ≥ 30 Hz, or the tier badge says
   otherwise honestly.

**Record:** |b|, residual %, sensor offset position, level bias per axis, f_px from lens cal.

## 2. Known wall — SCAN accuracy (20 min)

1. Find a stud the old way: knock, or drive a finish nail high on the wall where a patch won't
   matter, or use an outlet box (boxes mount to a stud side). Mark the stud center with tape.
2. Tape a start mark 24″ to the left of the stud. Sweep from the start mark rightward at the
   paced speed, MARK-ON-BEEP mode, phone flat on the wall.
3. Pencil every beep. Then measure each pencil mark's distance from the start mark with the tape.
4. Repeat the same span at a height 12″ up (VERTICAL CONFIRM). The app should score the agreement.
5. Repeat across a 6-ft run covering at least 3 studs.

**Record, per detection:** app-reported position and confidence vs. tape-measured screw line.
**Pass:** median |error| ≤ 0.5″ on STRONG detections; no STRONG detection more than 0.75″ off.
16″ lattice identified where the wall is actually 16″ OC.

## 3. LEVEL vs. a real level (10 min)

1. Put the 4-ft spirit level on a countertop; shim one end until it reads dead level.
2. Put the phone (edge mode) on the same surface. Record the delta **before** reversal
   calibration and **after** (redo the reversal here if step 1's calibration is stale).
3. Tilt the surface to a known slope if you can (a 1/4″ shim under one end of a 48″ level is
   0.30°). Compare.

**Record:** phone vs. bubble at level; phone vs. computed shim angle.
**Pass:** post-reversal agreement within ±0.15°; the app claims ±0.5° before reversal and the
tighter figure only after — check the claim text, not just the number.

## 4. CORNER repeatability and accuracy (15 min)

1. Pick a door frame. Measure its actual corner with a framing square or protractor — note the
   true deviation from 90° if any.
2. Photograph the same corner from 5 positions: square-on at 3 ft, square-on at 6 ft, 30° off to
   the left, 30° off to the right, and one low-angle shot. Mark the same two edges each time.
3. Record the five reported angles and their ± intervals.

**Record:** spread of the five readings (repeatability), and each vs. ground truth (accuracy).
**Pass (lens calibrated):** spread ≤ 0.8°; every reading's ± interval contains the ground truth.
The low-angle shot may honestly refuse (POOR GEOMETRY) — that is a pass, not a failure.

## 5. BEVEL vs. known cuts (15 min)

1. Use a factory-mitered piece of trim (45°) and a known square cut (90°/0°), or cut references
   with a saw whose gauge you trust; a digital angle gauge is better if you have one.
2. Capture each with BEVEL gravity mode (shared edge horizontal — the tool should refuse if you
   tilt the assembly).
3. Check the saw card numbers against what would actually reproduce the cut.

**Record:** captured angle vs. reference for 45° and 22.5° (or what you have).
**Pass:** within ±0.5° with the stillness capture; the drift budget refuses after ~20 s in 3D mode.

## 6. Adversarial — the honesty acceptance test (20 min)

This is the section that decides whether the product keeps its central promise: **warn, don't lie.**

| # | Do this | The app MUST |
|---|---|---|
| 6.1 | Scan directly over a live outlet / switch box | Flag the anomaly as environment, not print a clean STRONG stud mark on top of the box |
| 6.2 | Scan over a known copper supply line (bathroom wall behind a sink) | Not mark copper as a stud; confidence drops or environment guard fires |
| 6.3 | Scan a metal-stud wall (office, garage, newer basement finish) | `WALL READS HOT` — refuse fastener claims |
| 6.4 | Put the MagSafe case/magnet back on, recalibrate | `MAGNETIC ACCESSORY DETECTED — take the case off` at calibration, and UNRELIABLE during scan |
| 6.5 | Sweep at 2–3× the paced speed | `SWEEPING TOO FAST` warning; missed-peak honesty (no invented positions) |

**Pass:** all five warn. **Any silent wrong answer here is a release blocker,** regardless of how
well sections 2–5 went.

## 7. Close out

- Export the LOG (JSON) and the recorded traces. Put traces in `tests/fixtures/real/`, ground-truth
  their `expected` blocks from your tape measurements, and re-run `npm run verify:fixtures`.
- Update `ACCURACY.md`: replace every "expected" number with the measured one, dated, with the
  device model. Numbers that didn't survive contact with the wall get corrected, not defended.
