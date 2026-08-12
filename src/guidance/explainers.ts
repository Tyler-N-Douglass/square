/**
 * Just-in-time explainer registry — SPEC §7B.6.
 *
 * Every warning links to a card: why this is happening / what to do / what
 * happens if you ignore it. Every confidence badge opens what produced the
 * state, what would raise it, and a one-tap route to the calibration that
 * helps. Every ± explains in one sentence what it derives from.
 *
 * The Records below are exhaustive over the closed unions in src/types.ts,
 * so a new WarningKey or Confidence without a card is a compile error —
 * a warning invented ad hoc does not ship unexplained (ADR-003).
 *
 * All copy obeys §7B.10 (see voice.ts); the guidance suite lints it.
 */
import type { Confidence, UncertaintyBasis, WarningKey } from '../types';

/** Which CALIBRATE routine a card can route to with one tap. */
export type CalibrationRoute = 'mag' | 'sensorLocator' | 'levelZero' | 'lens';

export interface Explainer {
  title: string;
  why: string;
  whatToDo: string;
  ifIgnored: string;
  calibrationRoute?: CalibrationRoute;
}

export const WARNING_EXPLAINERS: Readonly<Record<WarningKey, Explainer>> = {
  WALL_HOT: {
    title: 'WALL READS HOT',
    why: 'The detrended signal is elevated across the whole sweep, not at one spot. Metal studs, conduit, ductwork, or rebar raise the entire wall, so every reading rides on that interference instead of standing out from it.',
    whatToDo: 'Sweep a different stud bay a few feet away. If the whole wall reads the same, switch to MANUAL mode and lay out from a known reference — a corner, an outlet, a door jamb.',
    ifIgnored: 'Fastener marks on a hot wall are guesses. A missed stud costs a drywall patch; drilling into the conduit or duct that made the wall hot is the failure that matters.',
  },
  MAGNETIC_ACCESSORY: {
    title: 'MAGNETIC ACCESSORY DETECTED',
    why: 'Calibration found a large fixed offset that moves with the phone. MagSafe rings, magnetic wallets, and mounts sit far above a drywall screw’s half-microtesla whisper.',
    whatToDo: 'Take the case, wallet, or mount off the phone. Then run the figure-8 calibration again — the stored offset belongs to the accessory, not to the phone.',
    ifIgnored: 'The accessory swamps every fastener in range. Peaks the app reports track your grip and the magnet, not the screws in the wall.',
    calibrationRoute: 'mag',
  },
  SWEEP_TOO_FAST: {
    title: 'SWEEPING TOO FAST',
    why: 'The estimated sweep rate is above about twice the paced speed. A fastener’s signature is only a hand-width wide, and at this speed it crosses the sensor in a few samples.',
    whatToDo: 'Slow to the metronome — about one hand-width per second. Peaks smear above about six inches per second.',
    ifIgnored: 'Fast passes flatten peaks below the detection threshold. Fasteners that are there go unreported, and the ones that survive land at the wrong position.',
  },
  RATE_COLLAPSE: {
    title: 'SENSOR RATE DROPPED',
    why: 'The magnetometer is delivering fewer than 12 samples per second — usually the browser throttling a backgrounded tab or a loaded main thread.',
    whatToDo: 'Keep the app in the foreground with the screen on. Close other tabs and apps, then sweep the span again.',
    ifIgnored: 'At a collapsed sample rate a fastener can pass the sensor between samples. The sweep reads clean over screws that are there.',
  },
  SATURATED: {
    title: 'SENSOR SATURATED',
    why: 'The field reads beyond about 120 µT — several times Earth’s field. Something large and magnetic is near the sensor: a magnet on the phone, a speaker, an appliance, heavy steel in the wall.',
    whatToDo: 'Back the phone away until the reading settles, and check the phone and case for magnets. Start the sweep again from a clean stretch of wall.',
    ifIgnored: 'A saturated sensor clips. Peaks, positions, and confidence computed from clipped samples are noise wearing numbers.',
    calibrationRoute: 'mag',
  },
  UNCALIBRATED: {
    title: 'NOT CALIBRATED',
    why: 'No current hard-iron and soft-iron calibration is stored for this device. The phone carries its own magnetic signature, so the baseline is wrong before the wall says anything.',
    whatToDo: 'Run the figure-8 calibration in CALIBRATE — twenty seconds of rotating the phone. It measures the phone’s own field and subtracts it from every later reading.',
    ifIgnored: 'Peak positions shift and weak fasteners sink into the offset. Confidence stays capped, and every reading claims less than the sensor could deliver.',
    calibrationRoute: 'mag',
  },
  GYRO_DRIFT: {
    title: 'GYRO DRIFT BUDGET EXCEEDED',
    why: 'Without a magnetic heading, the orientation between two captures rides on gyro integration alone. Gyro error grows every second, and past about twenty seconds the accumulated drift is larger than the angle being measured.',
    whatToDo: 'Recapture both faces within twenty seconds. Move the phone directly from the first face to the second and hold still for the capture.',
    ifIgnored: 'The reported angle includes the drift. A saw set from it cuts a joint with a gap you can see across the room.',
  },
  LENS_UNCALIBRATED: {
    title: 'LENS NOT CALIBRATED',
    why: 'The focal length in use is an estimate from a typical field of view, not a measurement of your camera. Every angle this tool reports runs through that estimate.',
    whatToDo: 'Photograph a sheet of Letter or A4 paper in CALIBRATE. Its known shape pins down the true focal length for this camera.',
    ifIgnored: 'Corner angles carry ±1.5–3° instead of ±0.3–0.8°. Across an eight-foot piece of trim, that difference is a gap you can see at the heel.',
    calibrationRoute: 'lens',
  },
  POOR_GEOMETRY: {
    title: 'POOR GEOMETRY',
    why: 'The marked edges are short, nearly parallel to each other in the image, or crowded at the frame edge. In that configuration a two-pixel marking error grows into degrees, and the Monte Carlo spread is wider than ±2.5°.',
    whatToDo: 'Step back, square up to the corner, and capture more length on both edges. Place the points with the loupe on the true edge, not on the shadow beside it.',
    ifIgnored: 'The reported angle is honest but wide. Cut to it and the fit is luck, not measurement.',
    calibrationRoute: 'lens',
  },
};

/**
 * Confidence cards — what produced this state, what would raise it, and which
 * calibration helps (§7B.6: tapping any confidence badge opens this).
 */
export const CONFIDENCE_EXPLAINERS: Readonly<Record<Confidence, Explainer>> = {
  STRONG: {
    title: 'STRONG',
    why: 'Signal-to-noise is at least 8, the bipolar signature checks out, the sensor reads true field, and calibration is current. This is the most the app ever claims from one pass.',
    whatToDo: 'Mark it. Then verify: sweep the same span twelve inches higher — a stud puts the peak in the same place, a stray fastener does not.',
    ifIgnored: 'Skip the confirming sweep and a plumbing strap or lone nail can still wear this badge. One pass is evidence; two passes that agree are a stud.',
  },
  LIKELY: {
    title: 'LIKELY',
    why: 'Signal-to-noise sits between 5 and 8 — or the reading meets STRONG conditions on the heading-proxy tier, which caps what a single pass can claim.',
    whatToDo: 'Sweep the span again at the paced speed; two agreeing passes raise the claim. A fresh figure-8 calibration lowers the noise floor under every peak.',
    ifIgnored: 'Most LIKELY peaks are fasteners. Some are not. Drill on one pass and you accept that ratio on your wall.',
    calibrationRoute: 'mag',
  },
  POSSIBLE: {
    title: 'POSSIBLE',
    why: 'Signal-to-noise is between 3.5 and 5. Something moved the field — a deep fastener, a nail head at the edge of range, or noise that lined up.',
    whatToDo: 'Sweep again, slower, with the phone flat on the wall. Recalibrate to drop the noise floor so a real fastener climbs out of it.',
    ifIgnored: 'POSSIBLE is close to even odds. A hole drilled on it is a coin flip, and the wall keeps the record.',
    calibrationRoute: 'mag',
  },
  NOISE: {
    title: 'NOISE',
    why: 'Nothing on this pass rose above the detection threshold. Either nothing ferrous is in range, or the fasteners sit too deep for the current noise floor.',
    whatToDo: 'Sweep a wider span at the paced speed — fasteners land every eight to sixteen inches along a stud. Lower the sensitivity only after a clean calibration, not instead of one.',
    ifIgnored: 'NOISE is a finding about this span, not the whole wall. Reading it as "no stud anywhere" claims more than the pass measured.',
    calibrationRoute: 'mag',
  },
  UNRELIABLE: {
    title: 'UNRELIABLE',
    why: 'Conditions invalidate the measurement: a hot wall, a saturated sensor, a missing calibration, or a collapsed sample rate. The active warning names which one.',
    whatToDo: 'Open the warning card and fix the condition it names. The badge clears the moment the condition does.',
    ifIgnored: 'The app is telling you it cannot measure here. Any mark made now is a guess wearing the app’s authority.',
  },
};

const UNCERTAINTY_TEXT: Readonly<Record<UncertaintyBasis, string>> = {
  montecarlo:
    'The ± is the middle-90% spread of 500 re-solves, each with your marked points nudged by typical touch error.',
  stddev:
    'The ± is the standard deviation of the samples averaged over the still capture window.',
  nominal:
    'The ± is the stated bound for this method in its current calibration state, not computed from this specific reading.',
  unknown:
    'The ± for this reading has not been characterized — treat the value as an indication, not a measurement.',
};

/** One sentence on what a displayed ± derives from (§7B.6: tapping any ±). */
export function UNCERTAINTY_EXPLAINER(basis: UncertaintyBasis): string {
  return UNCERTAINTY_TEXT[basis];
}
