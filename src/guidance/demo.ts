/**
 * DEMO mode — SPEC §7B.4, tests/fixtures/SCHEMA.md.
 *
 * Replays a bundled fixture trace through the real pipeline at recorded
 * speed, with narration lines emitted at their trace times, so a user can
 * watch the tool work on a known-good wall before trying it — and watch it
 * refuse on a known-bad one. The fixtures ARE the regression corpus: the
 * tutorial cannot drift from tested behavior because it is the test
 * (tests/unit/guidance-demo-corpus.test.ts enforces the link).
 *
 * `trace.synthetic` is always surfaced: a generated trace never presents as
 * a recording off a real wall.
 */
import type { MagSample } from '../sensors/types';
import type { SensorTrace, TraceExpected } from '../types';
import { ReplayMagSource } from '../sensors/replay';
import { loadFixture } from './fixtures';

export interface DemoNarrationLine {
  /** Trace time (seconds) at which the line appears. */
  atT: number;
  text: string;
}

export interface DemoSpec {
  toolId: string;
  /** Fixture id in tests/fixtures/ — the same file the suite asserts. */
  fixtureId: string;
  narration: DemoNarrationLine[];
}

/** The label DEMO UIs must show over any generated trace. */
export const SYNTHETIC_LABEL = 'SYNTHETIC TRACE';

export interface DemoDeps {
  onNarration(line: DemoNarrationLine): void;
  /**
   * Called with SYNTHETIC_LABEL before playback when the trace is generated.
   * Required, not optional: a DEMO that cannot label a synthetic trace does
   * not get to play one.
   */
  onSyntheticLabel(text: string): void;
  /** Live samples, for driving the tool's own pipeline/ribbon. */
  onSample?(s: MagSample): void;
  /** The fixture's asserted outcome — what the demo should have shown. */
  onExpected?(expected: TraceExpected): void;
  onEnd?(): void;
}

export interface DemoOptions {
  /** Playback clock: 1 = recorded speed (default), 'sync' for tests. */
  speed?: number | 'sync';
  /** Injectable loader for tests; defaults to the fixture registry. */
  load?(id: string): Promise<SensorTrace>;
}

export interface DemoHandle {
  stop(): void;
  readonly source: ReplayMagSource;
  readonly trace: SensorTrace;
}

export async function runDemo(spec: DemoSpec, deps: DemoDeps, opts: DemoOptions = {}): Promise<DemoHandle> {
  const load = opts.load ?? loadFixture;
  const trace = await load(spec.fixtureId);

  if (trace.synthetic) deps.onSyntheticLabel(SYNTHETIC_LABEL);

  const source = new ReplayMagSource(trace, { speed: opts.speed ?? 1 });
  const lines = [...spec.narration].sort((a, b) => a.atT - b.atT);
  let next = 0;

  source.subscribe((s) => {
    while (next < lines.length && lines[next]!.atT <= s.t) {
      deps.onNarration(lines[next]!);
      next += 1;
    }
    deps.onSample?.(s);
  });

  source.onEnd = () => {
    // Lines timed past the last sample still land, in order, at the end.
    while (next < lines.length) {
      deps.onNarration(lines[next]!);
      next += 1;
    }
    deps.onExpected?.(trace.expected);
    deps.onEnd?.();
  };

  await source.start();
  return { stop: () => source.stop(), source, trace };
}

/**
 * The shipped demos. Failure demos are first-class (§15.7: teach the limits
 * first) — a user who watches SCAN refuse a metal-stud wall and a MagSafe
 * case trusts the successes more, and drills fewer wrong holes.
 *
 * Fixture ids reference the corpus named in SCHEMA.md; the corpus test fails
 * until each referenced file exists in tests/fixtures/.
 */
export const DEMO_SPECS: Readonly<Record<string, DemoSpec>> = {
  'scan-first-wall': {
    toolId: 'scan',
    fixtureId: 'drywall-16oc-synthetic',
    narration: [
      { atT: 0.2, text: 'Watch the ribbon. The line is the field under the sensor with the slow drift removed; the shaded band is the noise floor.' },
      { atT: 1.0, text: 'First fastener coming up — the trace swings one way, then the other. That paired swing is a screw’s bipolar signature.' },
      { atT: 1.7, text: 'The screw sits at the zero crossing between the two lobes, not under either peak. The app marks the crossing.' },
      { atT: 4.0, text: 'Between fasteners the trace stays inside the noise band. Silence is information — this stretch is open stud bay.' },
      { atT: 6.3, text: 'Second fastener, sixteen inches from the first.' },
      { atT: 7.3, text: 'Two fasteners at 16.0″ lock the lattice. The app now predicts stud centers beyond the swept span — confirm one with a second sweep before drilling.' },
    ],
  },
  'scan-hot-wall': {
    toolId: 'scan',
    fixtureId: 'metal-stud-hot',
    narration: [
      { atT: 0.2, text: 'This wall is framed with metal studs. Watch the whole trace ride high — not one peak, the entire sweep.' },
      { atT: 2.5, text: 'Elevation everywhere is the signature of a hot wall: metal studs, conduit, ductwork, or rebar.' },
      { atT: 5.0, text: 'The app refuses: WALL READS HOT, confidence UNRELIABLE. The refusal is the correct answer — fastener marks on a hot wall are guesses.' },
    ],
  },
  'scan-magsafe': {
    toolId: 'scan',
    fixtureId: 'magsafe-attached',
    narration: [
      { atT: 0.2, text: 'A MagSafe ring is attached to this phone. The offset moves with the phone, so no sweep can shake it.' },
      { atT: 2.5, text: 'The magnet sits far above any screw’s signal — the wall cannot get a word in.' },
      { atT: 5.0, text: 'The app stops and says why: MAGNETIC ACCESSORY DETECTED. Take the case off, recalibrate, and the wall comes back.' },
    ],
  },
};

/** Demos for one tool, in declaration order. */
export function demosForTool(toolId: string): Array<{ id: string; spec: DemoSpec }> {
  return Object.entries(DEMO_SPECS)
    .filter(([, spec]) => spec.toolId === toolId)
    .map(([id, spec]) => ({ id, spec }));
}
