/**
 * LEVEL guided run, reversal walkthrough, DEMOs, glossary additions — A5.
 *
 * Per docs/guidance-notes.md and the Phase-2 amendment: this file exports
 * `DEMOS: DemoSpec[]`-shaped specs and `GLOSSARY_ADDITIONS`; the lead merges
 * them into src/guidance/demo.ts / glossary.ts. LEVEL's `fixtureId`s resolve
 * against LEVEL_DEMO_STREAMS in ./demoStream.ts (seeded in-repo IMU
 * synthesis, ADR-012) — NOT against tests/fixtures/, because the trace
 * corpus is magnetometer-shaped. The strict corpus-unification test applies
 * to SCAN, where the corpus exists (ADR-012); LEVEL's determinism is pinned
 * by tests/unit/level-tool-demo.test.ts instead.
 *
 * All copy obeys §7B.10 / voice.ts (linted in the level unit suite).
 */
import type { GuideSpec } from '../../guidance/tour';
import type { DemoSpec } from '../../guidance/demo';
import type { GlossaryEntry } from '../../guidance/glossary';
import type { Orientation } from '../../sensors/types';
import type { ReversalMachine } from './levelState';

const DEG = 180 / Math.PI;

function asOrientation(sample: unknown): Orientation | null {
  const s = sample as Partial<Orientation> | null;
  if (!s || typeof s.pitch !== 'number' || typeof s.roll !== 'number' || typeof s.stable !== 'boolean') return null;
  return s as Orientation;
}

/**
 * The guided run — advances on real events only (SPEC §7B.1): sensors live
 * (custom event fired by the tool), the phone set flat (sensor predicate),
 * stillness achieved (sensor predicate on the fusion's stable flag), then
 * the reading and the reversal offer. Step ids are stable — they key
 * dismissal memory.
 */
export const LEVEL_GUIDE: GuideSpec = {
  toolId: 'level',
  steps: [
    {
      id: 'wake',
      text: 'Tap TAP TO WAKE SENSORS — the level runs on motion sensors and nothing leaves the phone.',
      anchor: '.level__wake',
      advanceOn: { event: 'custom', name: 'sensors-live' },
    },
    {
      id: 'set-surface',
      text: 'Set the phone flat on the surface you are checking and take your hand away.',
      anchor: '.level__stage',
      critical: true,
      advanceOn: {
        event: 'sensor',
        predicate: (sample: unknown): boolean => {
          const o = asOrientation(sample);
          if (!o) return false;
          return Math.abs(o.pitch * DEG) < 20 && Math.abs(o.roll * DEG) < 20;
        },
      },
    },
    {
      // The stillness step — where people actually go wrong (charter:
      // critical). Advances on the fusion's own stable flag, never a button.
      id: 'hold-still',
      text: 'Hold still — HOLD appears after 400 ms of stillness. A moving number is not a measurement.',
      anchor: '.level__state',
      critical: true,
      advanceOn: {
        event: 'sensor',
        predicate: (sample: unknown): boolean => asOrientation(sample)?.stable === true,
      },
    },
    {
      id: 'reading',
      text: 'Read the orange number with its ± — the claim is part of the reading, not decoration.',
      anchor: '.level__readout',
      advanceOn: 'tap',
    },
    {
      id: 'reversal-offer',
      text: 'Run REVERSE to earn ±0.15° — measure, turn the phone 180°, measure again.',
      anchor: '.level__reverse',
      advanceOn: 'tap',
    },
  ],
};

/**
 * The reversal walkthrough (SPEC §4.2.2), driven by the guide engine over a
 * ReversalMachine. Runs memory-free (a calibration flow must never lose a
 * step to remembered dismissals). The turn step advances on the machine
 * observing motion-then-stillness — the observable signature of a 180°
 * in-plane turn with a yaw-free fusion — or on tap-dismiss, which the next
 * step converts to forceTurnDone().
 */
export function reversalGuideSpec(machine: ReversalMachine): GuideSpec {
  return {
    toolId: 'level-reversal',
    steps: [
      {
        id: 'rev-m1',
        text: 'Set the phone on the surface and hold still — capturing the first reading.',
        anchor: '.level__stage',
        critical: true,
        advanceOn: {
          event: 'sensor',
          predicate: (sample: unknown): boolean => {
            const o = asOrientation(sample);
            if (!o) return false;
            machine.feed({ stable: o.stable, pitchDeg: o.pitch * DEG, rollDeg: o.roll * DEG });
            return machine.state !== 'first';
          },
        },
      },
      {
        id: 'rev-turn',
        text: 'Turn the phone 180° in place — same spot on the surface, same face up.',
        anchor: '.level__stage',
        critical: true,
        advanceOn: {
          event: 'sensor',
          predicate: (sample: unknown): boolean => {
            const o = asOrientation(sample);
            if (!o) return false;
            machine.feed({ stable: o.stable, pitchDeg: o.pitch * DEG, rollDeg: o.roll * DEG });
            return machine.state === 'second' || machine.state === 'done';
          },
        },
      },
      {
        id: 'rev-m2',
        text: 'Hold still again — capturing the second reading.',
        anchor: '.level__stage',
        critical: true,
        advanceOn: {
          event: 'sensor',
          predicate: (sample: unknown): boolean => {
            const o = asOrientation(sample);
            if (!o) return false;
            // The user tap-dismissed the turn prompt: honor it.
            if (machine.state === 'turn') machine.forceTurnDone();
            machine.feed({ stable: o.stable, pitchDeg: o.pitch * DEG, rollDeg: o.roll * DEG });
            return machine.state === 'done';
          },
        },
      },
    ],
  };
}

/**
 * DEMOs — DemoSpec-shaped for the lead to merge. Limits first (§15.7): the
 * refusal demo leads. Both play seeded synthetic IMU through the REAL
 * fusion via runLevelImuDemo (./demoStream.ts) — never runDemo/ReplayMagSource.
 */
export const DEMOS: DemoSpec[] = [
  {
    toolId: 'level',
    fixtureId: 'level-imu-motion-gate',
    narration: [
      { atT: 0.3, text: 'Synthetic stream — a phone that never stops moving. Watch what the level refuses to do.' },
      { atT: 1.5, text: 'The number twitches and stays dim. MOVING is the state word, and no ± is attached.' },
      { atT: 3.2, text: 'The motion gate wants 400 ms of stillness. This stream never grants it.' },
      { atT: 5.2, text: 'No HOLD, no measurement, no save. Refusing is the correct answer here.' },
    ],
  },
  {
    toolId: 'level',
    fixtureId: 'level-imu-surface-settle',
    narration: [
      { atT: 0.3, text: 'Synthetic stream — a surface tilted +1.2°, held by a hand with normal tremor.' },
      { atT: 1.4, text: 'Tremor keeps the reading in MOVING: dim number, no claim.' },
      { atT: 3.5, text: 'Hand off. Stillness starts the 400 ms clock.' },
      { atT: 4.3, text: 'HOLD. The reading settles at +1.2° and carries its ± claim.' },
      { atT: 7.0, text: 'Same seed, same stream, every run — generated, labeled, and tested.' },
    ],
  },
];

/** Terms LEVEL's copy uses that the shipped glossary does not yet carry.
 *  The lead merges into src/guidance/glossary.ts. */
export const GLOSSARY_ADDITIONS: Readonly<Record<string, GlossaryEntry>> = {
  'drain-slope': {
    term: 'drain slope',
    def: 'The fall a drain line needs — code standard is ¼″ per foot, working band ¼″–½″.',
    whyItMatters: 'LEVEL flags a measured pipe slope inside or outside the band before the strapping goes on.',
  },
  grade: {
    term: 'percent grade',
    def: 'Rise over run times one hundred — a 100% grade is 45°.',
    whyItMatters: 'Trades state one tilt in degrees, percent, and inches per foot; the strip shows all of them from one measurement.',
    alt: ['percent grade'],
  },
  deadband: {
    term: 'deadband',
    def: 'The tolerance band around level where the tone goes silent and LEVEL locks — two tenths of a degree here.',
    whyItMatters: 'Inside the band the surface is level at the claim the calibration state supports.',
  },
};
