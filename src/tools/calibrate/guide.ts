/**
 * CALIBRATE guidance — SPEC §4.6 + §7B. The guided run IS the routines:
 * each routine is a GuideSpec advancing on real events the routine fires
 * (coverage thresholds, stillness, capture moments), never a Next button.
 *
 * AMENDMENT (docs/guidance-notes.md): demo specs and GLOSSARY_ADDITIONS are
 * exported from here for the lead to merge — src/guidance/demo.ts and
 * glossary.ts are not edited.
 *
 * DEMO per ADR-012: the trace corpus has no figure-8, so the mag demo runs a
 * deterministic SYNTHETIC sample stream through the REAL ellipsoid fit +
 * the REAL pass/fail gate. The MagSafe failure demo runs FIRST — limits
 * before capability (§15.7), and |b| > 40 µT must fail with the verbatim
 * accessory message.
 */
import type { GuideSpec } from '../../guidance/tour';
import type { GlossaryEntry } from '../../guidance/glossary';
import type { DemoSpec } from '../../guidance/demo';
import type { Vec3 } from '../../types';
import { fitEllipsoid, type EllipsoidFit } from '../../dsp/calibration';
import { CoverageTracker, evaluateMagFit, type MagEvaluation } from './logic';
import { cleanPhoneStream, magsafeStream } from './synth';

/* ------------------------------------------------------------------ */
/* Guided runs — one spec per routine                                  */
/* ------------------------------------------------------------------ */

export const MAG_GUIDE: GuideSpec = {
  toolId: 'calibrate',
  steps: [
    {
      id: 'mag-case-off',
      text: 'Take the phone out of its case — case magnets are exactly what this routine hunts.',
      anchor: '.calib-mag-start',
      critical: true,
      advanceOn: { event: 'custom', name: 'mag-started' },
    },
    {
      id: 'mag-figure8',
      text: 'Roll the phone through a slow figure-8 — every octant cell needs to fill.',
      anchor: '.calib-octants',
      critical: true,
      advanceOn: { event: 'custom', name: 'mag-covered' },
    },
    {
      id: 'mag-read',
      text: 'Read the result — residual under 5% and offset under 40 µT is a pass.',
      anchor: '.calib-mag-result',
      advanceOn: { event: 'custom', name: 'mag-fitted' },
    },
  ],
};

export const LOCATOR_GUIDE: GuideSpec = {
  toolId: 'calibrate',
  steps: [
    {
      id: 'loc-object',
      text: 'Hold a screw or paperclip flat against the glass — the same one for all nine spots.',
      anchor: '.calib-loc-start',
      critical: true,
      advanceOn: { event: 'custom', name: 'loc-started' },
    },
    {
      id: 'loc-dwell',
      text: 'Cover each target and hold still — the dot advances after a second and a half.',
      anchor: '.calib-loc-stage',
      critical: true,
      advanceOn: { event: 'custom', name: 'loc-halfway' },
    },
    {
      id: 'loc-read',
      text: 'The reticle now sits where the sensor really is — SCAN marks from there.',
      anchor: '.calib-loc-result',
      advanceOn: { event: 'custom', name: 'loc-fitted' },
    },
  ],
};

export const LEVEL_ZERO_GUIDE: GuideSpec = {
  toolId: 'calibrate',
  steps: [
    {
      id: 'lz-place',
      text: 'Set the phone flat on any firm surface and let go — stillness is the trigger.',
      anchor: '.calib-lz-stage',
      critical: true,
      advanceOn: { event: 'custom', name: 'lz-first-captured' },
    },
    {
      id: 'lz-rotate',
      text: 'Rotate the phone 180° in place — same spot on the surface, nose swapped.',
      anchor: '.calib-lz-stage',
      critical: true,
      advanceOn: { event: 'custom', name: 'lz-second-captured' },
    },
    {
      id: 'lz-read',
      text: 'The two readings split into surface and sensor bias — the bias is now subtracted everywhere.',
      anchor: '.calib-lz-result',
      advanceOn: { event: 'custom', name: 'lz-stored' },
    },
  ],
};

export const LENS_GUIDE: GuideSpec = {
  toolId: 'calibrate',
  steps: [
    {
      id: 'lens-sheet',
      text: 'Lay a Letter or A4 sheet flat and shoot it at a moderate angle — square-on carries no focal information.',
      anchor: '.calib-lens-capture',
      critical: true,
      advanceOn: { event: 'custom', name: 'lens-captured' },
    },
    {
      id: 'lens-mark',
      text: 'Mark the four sheet corners with the loupe — start anywhere, run the LONG edge first.',
      anchor: '.marker__stage',
      critical: true,
      advanceOn: { event: 'custom', name: 'lens-marked' },
    },
    {
      id: 'lens-read',
      text: 'Read the residual — over 1° means bad marks or a wavy sheet, and nothing is stored.',
      anchor: '.calib-lens-result',
      advanceOn: { event: 'custom', name: 'lens-solved' },
    },
  ],
};

export const CALIBRATE_GUIDES: Readonly<Record<'mag' | 'locator' | 'levelZero' | 'lens', GuideSpec>> = {
  mag: MAG_GUIDE,
  locator: LOCATOR_GUIDE,
  levelZero: LEVEL_ZERO_GUIDE,
  lens: LENS_GUIDE,
};

/* ------------------------------------------------------------------ */
/* DEMO — synthetic stream through the real fit (ADR-012)              */
/* ------------------------------------------------------------------ */

export const CALIBRATE_SYNTH_LABEL = 'SYNTHETIC STREAM';

export interface CalibrateDemoSpec {
  id: string;
  toolId: 'calibrate';
  title: string;
  kind: 'magsafe-fail' | 'clean-pass';
  narration: readonly string[];
}

/** Failure first — teach the limits before the capability (§15.7). */
export const CALIBRATE_DEMOS: readonly CalibrateDemoSpec[] = [
  {
    id: 'calibrate-magsafe-fail',
    toolId: 'calibrate',
    title: 'WATCH IT CATCH A MAGNET',
    kind: 'magsafe-fail',
    narration: [
      'A synthetic phone with a MagSafe ring attached: every sample carries a huge fixed offset that moves with the phone.',
      'The figure-8 fills all eight octants — coverage is not the problem here.',
      'The real fit recovers a hard-iron offset far past 40 µT. That is a magnet, not a sensor bias.',
      'The routine fails loudly and stores nothing. Take the case off, then recalibrate.',
    ],
  },
  {
    id: 'calibrate-mag-clean',
    toolId: 'calibrate',
    title: 'WATCH A CLEAN PASS',
    kind: 'clean-pass',
    narration: [
      'A synthetic clean phone: modest hard iron, slight soft-iron stretch, quiet sensor — built values, stated below.',
      'The stream sweeps every octant the way a slow figure-8 does.',
      'The real ellipsoid fit recovers the built-in offset and flattens the stretch back to a sphere.',
      'Residual under 5%, all octants covered, offset under 40 µT: pass. Compare the recovered offset with the truth.',
    ],
  },
];

export interface CalibrateDemoDeps {
  /** REQUIRED — a demo that cannot label its synthetic stream cannot play. */
  onSyntheticLabel(text: string): void;
  onNarration(line: string): void;
  /** Coverage progress ticks (0–8 octants filled), for the octant grid. */
  onProgress?(octantsFilled: number, samplesSeen: number): void;
  onResult(outcome: CalibrateDemoOutcome): void;
}

export interface CalibrateDemoOutcome {
  kind: CalibrateDemoSpec['kind'];
  fit: EllipsoidFit;
  evaluation: MagEvaluation;
  truthHardIron: Vec3;
  points: Vec3[];
}

/**
 * Run a CALIBRATE mag demo: deterministic synthetic stream → the REAL
 * fitEllipsoid → the REAL pass/fail gate. Same functions the live routine
 * calls; only the sample source is synthetic, and it says so.
 */
export function runCalibrateDemo(spec: CalibrateDemoSpec, deps: CalibrateDemoDeps): CalibrateDemoOutcome {
  deps.onSyntheticLabel(CALIBRATE_SYNTH_LABEL);
  for (const line of spec.narration) deps.onNarration(line);
  const { points, truthHardIron } = spec.kind === 'magsafe-fail' ? magsafeStream() : cleanPhoneStream();
  if (deps.onProgress) {
    // Deterministic coverage ticks at 8 checkpoints through the stream.
    const tracker = new CoverageTracker();
    const step = Math.floor(points.length / 8);
    for (let i = 0; i < points.length; i++) {
      tracker.push(points[i]!);
      if ((i + 1) % step === 0) deps.onProgress(tracker.filledCount(), i + 1);
    }
  }
  const fit = fitEllipsoid(points);
  const evaluation = evaluateMagFit(fit);
  const outcome: CalibrateDemoOutcome = { kind: spec.kind, fit, evaluation, truthHardIron, points };
  deps.onResult(outcome);
  return outcome;
}

/**
 * DemoSpec-shaped registry for the lead to merge (A5's pattern). The
 * `fixtureId`s reference CALIBRATE_DEMOS ids in THIS module — deterministic
 * synthetic streams through the real fit (ADR-012), not trace fixtures.
 */
export const DEMOS: DemoSpec[] = CALIBRATE_DEMOS.map((d) => ({
  toolId: d.toolId,
  fixtureId: d.id,
  narration: d.narration.map((text, i) => ({ atT: i * 1.5, text })),
}));

/* ------------------------------------------------------------------ */
/* Glossary additions (lead merges into src/guidance/glossary.ts)      */
/* ------------------------------------------------------------------ */

export const GLOSSARY_ADDITIONS: Readonly<Record<string, GlossaryEntry>> = {
  octant: {
    term: 'octant',
    def: 'One of the eight direction-space cells around the field center — up/down × left/right × front/back.',
    whyItMatters: 'The ellipsoid fit needs samples in all eight; the fill grid shows which directions still owe a turn.',
    alt: ['octants'],
  },
  'figure-eight': {
    term: 'figure-eight',
    def: 'The tumbling motion that sweeps the phone through every orientation in about twenty seconds.',
    whyItMatters: 'It is the fastest honest way to show the sensor the whole sphere so hard and soft iron separate cleanly.',
    alt: ['figure-8', 'figure 8'],
  },
  residual: {
    term: 'residual',
    def: 'What is left over after the fit — how far the corrected samples still sit from a perfect sphere.',
    whyItMatters: 'Residual under 5% is the pass line; above it, the calibration would claim more than it measured.',
    alt: ['residuals'],
  },
};
