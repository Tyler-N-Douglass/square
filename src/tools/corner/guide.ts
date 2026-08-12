/**
 * CORNER guidance — the guided run (SPEC §7B.3), the DEMO worked examples
 * (§7B.4 per ADR-012), and this tool's glossary additions (§7B.8).
 *
 * AMENDMENT (docs/guidance-notes.md): this file does NOT edit
 * src/guidance/demo.ts or glossary.ts — it exports CORNER_DEMOS and
 * GLOSSARY_ADDITIONS for the lead to merge.
 *
 * ADR-012: CORNER's demo is a worked example through the REAL solver — the
 * same projection construction the ground-truth suite uses, with the truth
 * printed beside the recovery, always labeled a synthetic worked example.
 * The refusal demo is listed FIRST: limits teach before capability (§15.7).
 */
import type { GuideSpec } from '../../guidance/tour';
import type { GlossaryEntry } from '../../guidance/glossary';
import type { DemoSpec } from '../../guidance/demo';
import type { QuadAngleResult, Intrinsics, Px } from '../../geometry/angleSolver';
import type { MonteCarloAngleResult } from '../../geometry/montecarlo';
import type { SolverRunner } from './solverClient';
import { degenerateExample, workedExample } from './worked';

/* ------------------------------------------------------------------ */
/* Guided run                                                          */
/* ------------------------------------------------------------------ */

/**
 * Advances on real tool events (never a Next button): the tool fires
 * 'photo-captured', 'mark-1'…'mark-4' (point count), and 'solved'.
 * Critical steps — where people actually go wrong (§7B.3): camera distance
 * and marking precision.
 */
export const CORNER_GUIDE: GuideSpec = {
  toolId: 'corner',
  steps: [
    {
      id: 'limits',
      text: 'Expect ±1.5–3° until the lens is calibrated — CALIBRATE pins the real focal length.',
      anchor: '.corner-lens',
      advanceOn: 'tap',
    },
    {
      id: 'frame',
      text: 'Step back and frame both edges long — distance beats a tight crop for angle accuracy.',
      anchor: '.capture__controls',
      critical: true,
      advanceOn: { event: 'custom', name: 'photo-captured' },
    },
    {
      id: 'mark-corner',
      text: 'Mark the corner first — the exact meeting point.',
      anchor: '.marker__stage',
      critical: true,
      advanceOn: { event: 'custom', name: 'mark-1' },
    },
    {
      id: 'mark-edge1',
      text: 'Mark far out along one edge — short marks make wide error bars.',
      anchor: '.marker__stage',
      advanceOn: { event: 'custom', name: 'mark-2' },
    },
    {
      id: 'mark-diagonal',
      text: 'Mark the diagonal corner, across the opening.',
      anchor: '.marker__stage',
      advanceOn: { event: 'custom', name: 'mark-3' },
    },
    {
      id: 'mark-edge2',
      text: 'Mark the other edge, then drag any point — the loupe shows the edge under your finger.',
      anchor: '.marker__stage',
      critical: true,
      advanceOn: { event: 'custom', name: 'mark-4' },
    },
    {
      id: 'read',
      text: 'Read the ± before the angle — past ±2.5°, the fix is re-shooting, not re-cutting.',
      anchor: '.corner-result',
      advanceOn: { event: 'custom', name: 'solved' },
    },
  ],
};

/* ------------------------------------------------------------------ */
/* DEMO — worked examples through the real solver (ADR-012)            */
/* ------------------------------------------------------------------ */

/** The label every CORNER demo surface must show. */
export const WORKED_LABEL = 'WORKED EXAMPLE · SYNTHETIC';

export interface CornerDemoSpec {
  id: string;
  toolId: 'corner';
  title: string;
  kind: 'refusal' | 'solve';
  /** Known ground truth for 'solve' demos, degrees. */
  truthDeg?: number;
  narration: readonly string[];
}

/** Refusal FIRST — the limits teach before the capability (SPEC §15.7). */
export const CORNER_DEMOS: readonly CornerDemoSpec[] = [
  {
    id: 'corner-degenerate-refusal',
    toolId: 'corner',
    title: 'WATCH IT REFUSE',
    kind: 'refusal',
    narration: [
      'Four marks nearly on one line — both “edges” marked along the same jamb.',
      'No second dimension means no vanishing geometry. The solver refuses instead of inventing a number.',
      'POOR GEOMETRY is the correct output here. Re-mark in order: corner, one edge, diagonal, other edge.',
    ],
  },
  {
    id: 'corner-doorway-88-6',
    toolId: 'corner',
    title: 'WATCH IT SOLVE',
    kind: 'solve',
    truthDeg: 88.6,
    narration: [
      'A synthetic doorway built at exactly 88.6°, projected through a known camera — the same construction the test suite trusts.',
      'The four marks land where a careful user puts them: corner, far along each edge, diagonal.',
      'The real solver recovers the vanishing points, back-projects both edge directions, and reads the angle between them.',
      'Monte Carlo re-solves 500 nudged copies of the marks; the spread is the ± on screen.',
      'Truth: 88.6°. Compare it with what the solver reported — that difference is the honest error.',
    ],
  },
];

export interface CornerDemoDeps {
  /** The same runner the live tool uses — worker where available. */
  runner: SolverRunner;
  /** REQUIRED: a demo that cannot label its synthetic provenance cannot play. */
  onSyntheticLabel(text: string): void;
  onNarration(line: string): void;
  onResult(outcome: CornerDemoOutcome): void;
}

export type CornerDemoOutcome =
  | {
      kind: 'solve';
      truthDeg: number;
      quad: [Px, Px, Px, Px];
      k: Intrinsics;
      imageW: number;
      imageH: number;
      point: QuadAngleResult;
      mc: MonteCarloAngleResult;
    }
  | { kind: 'refusal'; quad: [Px, Px, Px, Px]; k: Intrinsics; result: QuadAngleResult };

/** Run a CORNER demo through the REAL solver pipeline. Deterministic. */
export async function runCornerDemo(spec: CornerDemoSpec, deps: CornerDemoDeps): Promise<void> {
  deps.onSyntheticLabel(WORKED_LABEL);
  for (const line of spec.narration) deps.onNarration(line);
  if (spec.kind === 'refusal') {
    const ex = degenerateExample();
    const result = await deps.runner.cornerAngle(ex.quad, ex.k);
    deps.onResult({ kind: 'refusal', quad: ex.quad, k: ex.k, result });
    return;
  }
  const ex = workedExample(spec.truthDeg ?? 88.6);
  const point = await deps.runner.cornerAngle(ex.quad, ex.k);
  const mc = await deps.runner.monteCarlo(ex.quad, ex.k, { sigmaPx: 2, samples: 500, seed: 0x5eed });
  deps.onResult({
    kind: 'solve',
    truthDeg: ex.truthDeg,
    quad: ex.quad,
    k: ex.k,
    imageW: ex.imageW,
    imageH: ex.imageH,
    point,
    mc,
  });
}

/**
 * DemoSpec-shaped registry for the lead to merge (A5's pattern). The
 * `fixtureId`s reference CORNER_DEMOS ids in THIS module — worked examples
 * through the real solver (ADR-012), not tests/fixtures traces; the strict
 * corpus-unification test applies to SCAN, where the trace corpus exists.
 */
export const DEMOS: DemoSpec[] = CORNER_DEMOS.map((d) => ({
  toolId: d.toolId,
  fixtureId: d.id,
  narration: d.narration.map((text, i) => ({ atT: i * 1.5, text })),
}));

/* ------------------------------------------------------------------ */
/* Glossary additions (lead merges into src/guidance/glossary.ts)      */
/* ------------------------------------------------------------------ */

/** 'loupe' already ships in src/guidance/glossary.ts — not duplicated here. */
export const GLOSSARY_ADDITIONS: Readonly<Record<string, GlossaryEntry>> = {
  rack: {
    term: 'rack',
    def: 'A frame pushed out of square while its sides keep their lengths — a rectangle gone parallelogram.',
    whyItMatters: 'Equal diagonals mean square; the rack readout is the diagonal difference a cabinetmaker would tape.',
    alt: ['racked', 'racking'],
  },
  intrinsics: {
    term: 'intrinsics',
    def: 'The camera’s internal numbers — focal length and image center — that map pixels to directions.',
    whyItMatters: 'Every corner angle runs through the intrinsics; calibrating them is what tightens ±3° to under ±1°.',
  },
};
