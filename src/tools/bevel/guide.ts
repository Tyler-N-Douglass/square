/**
 * BEVEL guided run + DEMOs — SPEC §7B, ADR-012. Owned by A4 (Phase 2).
 *
 * The guide advances on real events: the tool fires custom events at its
 * semantic moments (sensors started, face captured, result shown) and the
 * engine steps forward — never a Next button. The stillness and the
 * edge-horizontal steps are `critical` — they survive fading to 'reduced'
 * because they are where captures actually go wrong.
 *
 * The DEMOs drive the REAL capture pipeline (GravityCapture / Bevel3DCapture
 * through OrientationFusion) with deterministic synthetic IMU streams,
 * labeled SYNTHETIC — onSyntheticLabel is a required callback, same contract
 * as A13's runDemo. Per ADR-012, the failure demos are first-class: watch
 * the tool refuse a tilted joint edge, and watch the 3D mode refuse when the
 * gyro drift budget runs out. The limits teach first (SPEC §15.7).
 *
 * Merge note (Phase 2 amendment): DEMO specs and GLOSSARY_ADDITIONS are
 * exported from here for the lead to merge; src/guidance/demo.ts and
 * glossary.ts are not edited by A4.
 */
import type { GuideSpec } from '../../guidance/tour';
import type { GlossaryEntry } from '../../guidance/glossary';
import type { ImuSample } from '../../sensors/types';
import {
  Bevel3DCapture,
  GravityCapture,
  dihedralFromCaptures,
  type CapturePhase,
  type DihedralResult,
  type ThreeDPhase,
} from './capture';
import { foldStream, syntheticImuStream, gravityOnFace } from './synthetic';

export const BEVEL_GUIDE: GuideSpec = {
  toolId: 'bevel',
  steps: [
    {
      id: 'wake',
      text: 'Tap WAKE SENSORS — the capture reads the motion sensors, and the phone asks once.',
      anchor: '#bevel-wake',
      advanceOn: { event: 'custom', name: 'sensors-started' },
    },
    {
      id: 'face1-still',
      text: 'Lay the phone flat on the first face, long edge against the joint. Hold still about a second.',
      anchor: '#bevel-state',
      critical: true,
      advanceOn: { event: 'custom', name: 'face1-captured' },
    },
    {
      id: 'edge-level',
      text: 'Keep the joint edge level — a tilted edge bends the math and the tool refuses rather than guess.',
      anchor: '#bevel-state',
      critical: true,
      advanceOn: 'tap',
    },
    {
      id: 'face2-still',
      text: 'Move the phone to the second face, same edge against the joint. Hold still again.',
      anchor: '#bevel-state',
      critical: true,
      advanceOn: { event: 'custom', name: 'face2-captured' },
    },
    {
      id: 'read-card',
      text: 'Read the method line before the numbers — flat and nested take different settings for the same corner.',
      anchor: '#bevel-card',
      advanceOn: 'tap',
    },
    {
      id: 'test-cut',
      text: 'Cut a test piece from scrap before the keeper — the saw card says so because it matters.',
      anchor: '#bevel-card',
      advanceOn: 'tap',
    },
  ],
};

/* ------------------------------------------------------------------------ */
/* DEMOs — synthetic streams through the real pipeline (ADR-012)             */
/* ------------------------------------------------------------------------ */

export const SYNTHETIC_STREAM_LABEL = 'SYNTHETIC STREAM';

export interface BevelNarrationLine {
  /** Stream time (seconds) at which the line appears. */
  atT: number;
  text: string;
}

export type BevelDemoExpected =
  | { kind: 'angle'; thetaDeg: number; tolDeg: number }
  | { kind: 'refusal'; reasonIncludes: string }
  | { kind: 'drift-refusal'; warning: 'GYRO_DRIFT' };

export interface BevelDemoSpec {
  toolId: 'bevel';
  title: string;
  mode: 'gravity' | '3d';
  synthetic: true;
  /** Deterministic stream builder — same spec, same samples, every run. */
  stream(): ImuSample[];
  narration: BevelNarrationLine[];
  expected: BevelDemoExpected;
}

export const BEVEL_DEMOS: Readonly<Record<string, BevelDemoSpec>> = {
  'bevel-known-cut': {
    toolId: 'bevel',
    title: 'Capture a 45° cut (fold reads 135°)',
    mode: 'gravity',
    synthetic: true,
    stream: () => foldStream({ foldDeg: 135, seed: 7 }),
    narration: [
      { atT: 0.2, text: 'The phone lies on the board face, long edge against the cut. Watch the state settle — the motion gate opens after 400 ms still.' },
      { atT: 1.0, text: 'Capture one: gravity averaged over a 500 ms window. The window scatter is the reading’s ±.' },
      { atT: 1.8, text: 'Now the phone folds across the joint onto the cut face — 135° of rotation about the edge.' },
      { atT: 3.2, text: 'Capture two, same stillness rule. Gravity had no pull along the edge in either capture, so the edge is level and the math holds.' },
      { atT: 3.9, text: 'θ = acos(ĝ₁·ĝ₂) = 135° — a 45° blade tilt reproduces this face on flat stock.' },
    ],
    expected: { kind: 'angle', thetaDeg: 135, tolDeg: 0.5 },
  },
  'bevel-tilted-edge': {
    toolId: 'bevel',
    title: 'Refusal: joint edge not level',
    mode: 'gravity',
    synthetic: true,
    stream: () => foldStream({ foldDeg: 135, edgeTiltDeg: 20, seed: 11 }),
    narration: [
      { atT: 0.2, text: 'Same fold — but the piece stands with its joint edge tilted 20° out of level.' },
      { atT: 1.0, text: 'Gravity now pulls along the edge itself: about 3.4 m/s² on the device’s long axis, in both captures.' },
      { atT: 3.2, text: 'With a tilted edge, acos(ĝ₁·ĝ₂) returns a wrong angle with a confident face — the identity only holds across a level edge.' },
      { atT: 3.9, text: 'The tool refuses and says why. Stand the piece so the joint edge is level, then capture again.' },
    ],
    expected: { kind: 'refusal', reasonIncludes: 'Joint edge is not level' },
  },
  'bevel-drift-budget': {
    toolId: 'bevel',
    title: 'Refusal: 3D mode drift budget exceeded',
    mode: '3d',
    synthetic: true,
    stream: () =>
      syntheticImuStream({
        g0: gravityOnFace(0, 0),
        seed: 13,
        segments: [
          { kind: 'still', s: 1.4 },
          { kind: 'shake', s: 21 },
          { kind: 'rotate', axis: [0, 1, 0], totalDeg: 135, s: 1.0 },
          { kind: 'still', s: 1.4 },
        ],
      }),
    narration: [
      { atT: 0.5, text: '3D mode links the two placements through gyro integration — no level-edge rule, but the clock runs.' },
      { atT: 2.0, text: 'The first face is captured. The drift budget starts growing: gyro error accumulates every second.' },
      { atT: 12.0, text: 'The countdown is visible the whole time. Past 20 seconds the drift is larger than the angle being measured.' },
      { atT: 22.6, text: 'GYRO DRIFT BUDGET EXCEEDED — the tool refuses rather than report drift wearing an angle. Capture the first face again.' },
    ],
    expected: { kind: 'drift-refusal', warning: 'GYRO_DRIFT' },
  },
};

export interface BevelDemoDeps {
  onNarration(line: BevelNarrationLine): void;
  /** Required: a demo that cannot label its synthetic stream cannot play one. */
  onSyntheticLabel(text: string): void;
  /** Live capture-machine phase, for driving the tool's own state display. */
  onPhase?(phase: CapturePhase | ThreeDPhase): void;
  onResult?(result: DihedralResult | ThreeDPhase): void;
  onEnd?(): void;
}

export interface BevelDemoHandle {
  stop(): void;
  readonly done: Promise<void>;
}

/**
 * Play a demo stream through the real capture machines. speed 'sync' runs the
 * whole stream in one tick (tests); a number scales the recorded cadence.
 */
export function runBevelDemo(
  spec: BevelDemoSpec,
  deps: BevelDemoDeps,
  opts: { speed?: number | 'sync' } = {},
): BevelDemoHandle {
  deps.onSyntheticLabel(SYNTHETIC_STREAM_LABEL);
  const samples = spec.stream();
  const lines = [...spec.narration].sort((a, b) => a.atT - b.atT);
  let lineIdx = 0;
  let stopped = false;

  const gravity = spec.mode === 'gravity' ? new GravityCapture() : null;
  const threeD = spec.mode === '3d' ? new Bevel3DCapture() : null;
  gravity?.arm();
  threeD?.arm();
  let firstCapture: ReturnType<GravityCapture['ingest']> | null = null;
  let gravityDone = false;
  let threeDDone = false;

  const step = (s: ImuSample): void => {
    while (lineIdx < lines.length && lines[lineIdx]!.atT <= s.t) {
      deps.onNarration(lines[lineIdx]!);
      lineIdx += 1;
    }
    if (gravity) {
      const phase = gravity.ingest(s);
      deps.onPhase?.(phase);
      if (phase.phase === 'captured') {
        if (firstCapture === null) {
          firstCapture = phase;
          gravity.reset();
          gravity.arm();
        }
      }
      if (
        !gravityDone &&
        firstCapture?.phase === 'captured' &&
        phase.phase === 'captured' &&
        phase !== firstCapture
      ) {
        gravityDone = true;
        deps.onResult?.(dihedralFromCaptures(firstCapture.capture, phase.capture));
      }
    }
    if (threeD) {
      const phase = threeD.ingest(s);
      deps.onPhase?.(phase);
      if (!threeDDone && (phase.phase === 'done' || phase.phase === 'refused')) {
        threeDDone = true;
        deps.onResult?.(phase);
      }
    }
  };

  const finish = (): void => {
    while (lineIdx < lines.length) {
      deps.onNarration(lines[lineIdx]!);
      lineIdx += 1;
    }
    deps.onEnd?.();
  };

  let resolveDone: () => void = () => undefined;
  const done = new Promise<void>((r) => {
    resolveDone = r;
  });

  if (opts.speed === 'sync') {
    for (const s of samples) {
      if (stopped) break;
      step(s);
    }
    finish();
    resolveDone();
    return { stop: () => undefined, done };
  }

  const speed = typeof opts.speed === 'number' && opts.speed > 0 ? opts.speed : 1;
  let i = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const t0 = samples.length > 0 ? samples[0]!.t : 0;
  const started = Date.now();
  const pump = (): void => {
    if (stopped) return;
    const elapsed = ((Date.now() - started) / 1000) * speed + t0;
    while (i < samples.length && samples[i]!.t <= elapsed) {
      step(samples[i]!);
      i += 1;
    }
    if (i >= samples.length) {
      finish();
      resolveDone();
      return;
    }
    timer = setTimeout(pump, 33);
  };
  pump();

  return {
    stop: () => {
      stopped = true;
      if (timer !== null) clearTimeout(timer);
      resolveDone();
    },
    done,
  };
}

/* ------------------------------------------------------------------------ */
/* Glossary additions — for the lead to merge into src/guidance/glossary.ts  */
/* ------------------------------------------------------------------------ */

export const GLOSSARY_ADDITIONS: Readonly<Record<string, GlossaryEntry>> = {
  'drift-budget': {
    term: 'drift budget',
    def: 'The error allowance for gyro-only tracking, growing with every second between captures.',
    whyItMatters: 'Past 20 seconds the drift outgrows the angle being measured, so the 3D capture refuses.',
  },
  keeper: {
    term: 'keeper',
    def: 'The side of the cut you keep, as opposed to the offcut.',
    whyItMatters: 'The saw card names the keeper side so the finished piece lands on the correct side of the blade.',
  },
  'nested-cut': {
    term: 'nested',
    def: 'Cutting crown upside down against the fence at its spring angle, the way it sits installed.',
    whyItMatters: 'Nested needs no blade tilt; mixing nested and flat settings wastes a stick of molding.',
    alt: ['nested cut', 'in-position'],
  },
};
