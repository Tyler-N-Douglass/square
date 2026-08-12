/**
 * LAYOUT guided run + DEMO — SPEC §7B, ADR-012. Owned by A4 (Phase 2).
 *
 * The guide walks span → count → mode → read-the-table. Tap-advance is
 * correct for a form tool (§7B.1: tapping IS the advance for informational
 * steps); the chaining-warning step is `critical` because measuring
 * mark-to-mark is where layout actually goes wrong.
 *
 * The DEMO, per ADR-012, is a worked example through the REAL solvers: every
 * number in the narration is computed by the same equalGaps/equalCenters
 * calls the tool runs, formatted through units.ts, at build time of the
 * demo — so the walkthrough can never drift from solver behavior. The
 * refusal demo runs the real refusal path and quotes its stated reason.
 *
 * Merge note (Phase 2 amendment): demo specs and GLOSSARY_ADDITIONS are
 * exported from here for the lead to merge; src/guidance/demo.ts and
 * glossary.ts are not edited by A4.
 */
import type { GuideSpec } from '../../guidance/tour';
import type { GlossaryEntry } from '../../guidance/glossary';
import { LAYOUT_TAPE_WARNING, equalGaps } from '../../geometry/layout';
import { formatFtIn, formatInches, parseLength } from '../../geometry/units';
import { layoutTableRows } from './solver';

export const LAYOUT_GUIDE: GuideSpec = {
  toolId: 'layout',
  steps: [
    {
      id: 'span',
      text: `Enter the span wall to wall. Type it the way you say it — 8' 6", 40-1/2", or 2600mm.`,
      anchor: '#layout-span',
      advanceOn: 'tap',
    },
    {
      id: 'count',
      text: 'Enter how many marks you need.',
      anchor: '#layout-count',
      advanceOn: 'tap',
    },
    {
      id: 'mode',
      text: 'Pick the mode. Equal centers spaces a row wall to wall; equal gaps needs the item width.',
      anchor: '#layout-mode',
      advanceOn: 'tap',
    },
    {
      id: 'read-table',
      text: 'Read the cumulative column to place marks; the incremental column only checks the spacing.',
      anchor: '#layout-table',
      advanceOn: 'tap',
    },
    {
      id: 'no-chain',
      text: 'Measure every mark from the same end — chaining stacks each error into the next.',
      anchor: '#layout-table',
      critical: true,
      advanceOn: 'tap',
    },
    {
      id: 'practice',
      text: 'Every number here is math on what you typed — the PRACTICE badge stays until a sensor or photo is attached.',
      anchor: '#layout-practice',
      advanceOn: 'tap',
    },
  ],
};

/* ------------------------------------------------------------------------ */
/* DEMO — worked example through the real solvers (ADR-012)                  */
/* ------------------------------------------------------------------------ */

export const WORKED_EXAMPLE_LABEL = 'WORKED EXAMPLE — real solver output';

export interface LayoutDemoStep {
  text: string;
}

export interface LayoutDemoSpec {
  toolId: 'layout';
  title: string;
  label: typeof WORKED_EXAMPLE_LABEL;
  steps: LayoutDemoStep[];
}

/**
 * The gallery-wall walkthrough, numbers straight from the solver: five 18″
 * frames on a 10′ wall in equal-gaps mode. Recomputed on every call — the
 * narration cannot drift from the math because it IS the math's output.
 */
export function buildGalleryDemo(): LayoutDemoSpec {
  const span = parseLength(`10'`);
  const width = parseLength('18"');
  if (!span || !width) throw new Error('LAYOUT demo inputs failed to parse'); // unreachable
  const result = equalGaps(span.inches, 5, width.inches);
  if (!result.ok) throw new Error('LAYOUT demo solver refused valid inputs'); // unreachable

  const gapText = formatInches(result.gap, 16).text;
  const rows = layoutTableRows(result.marks, 16);
  const centers = rows.map((r) => r.cumulative.text).join(', ');
  const firstIncrement = rows[1]?.incremental.text ?? '';

  return {
    toolId: 'layout',
    title: 'Gallery wall: five frames on a 10′ wall',
    label: WORKED_EXAMPLE_LABEL,
    steps: [
      {
        text: `Five 18″ frames on a ${formatFtIn(span.inches, 16).text} wall, equal-gaps mode — the clear space between frames and at both ends comes out identical.`,
      },
      {
        text: `The solver returns gap = ${gapText}: (span − 5 × 18″) ÷ 6 openings, computed in exact fractions with no float drift.`,
      },
      {
        text: `Frame centers land at ${centers} from the left wall — that is the cumulative column, the one you measure.`,
      },
      {
        text: `Each center steps ${firstIncrement} past the previous — the incremental column. Check spacing with it; never measure with it.`,
      },
      {
        text: `${LAYOUT_TAPE_WARNING} Chained marks stack each pencil-width error into the next one.`,
      },
      {
        text: 'Set the row height so frame centers sit at 57″ — the gallery-standard eye height — then transfer the table to the level line.',
      },
    ],
  };
}

/**
 * The refusal demo: six 24″ frames cannot fit a 10′ wall, and the solver says
 * exactly what is short instead of clamping. The step quotes the real
 * refusal string.
 */
export function buildRefusalDemo(): LayoutDemoSpec {
  const span = parseLength(`10'`);
  const width = parseLength('24"');
  if (!span || !width) throw new Error('LAYOUT demo inputs failed to parse'); // unreachable
  const result = equalGaps(span.inches, 6, width.inches);
  if (result.ok) throw new Error('LAYOUT refusal demo unexpectedly fit'); // unreachable

  return {
    toolId: 'layout',
    title: 'Refusal: six 24″ frames on a 10′ wall',
    label: WORKED_EXAMPLE_LABEL,
    steps: [
      { text: 'Ask for six 24″ frames across the same 10′ wall — 144″ of frame over 120″ of wall.' },
      { text: `The solver refuses with the shortfall stated: “${result.reason}”` },
      { text: 'No clamped numbers, no truncated row — a layout that does not fit is an answer, not an error to paper over.' },
    ],
  };
}

export const LAYOUT_DEMOS: Readonly<Record<string, LayoutDemoSpec>> = {
  'layout-gallery-wall': buildGalleryDemo(),
  'layout-doesnt-fit': buildRefusalDemo(),
};

/* ------------------------------------------------------------------------ */
/* Glossary additions — for the lead to merge into src/guidance/glossary.ts  */
/* ------------------------------------------------------------------------ */

export const GLOSSARY_ADDITIONS: Readonly<Record<string, GlossaryEntry>> = {
  datum: {
    term: 'datum',
    def: 'The fixed reference point or edge every measurement counts from.',
    whyItMatters: 'Measuring every mark from one datum keeps errors independent; chaining marks stacks them.',
  },
  'story-pole': {
    term: 'story pole',
    def: 'A stick or strip carrying the layout marks at full scale, made once and held up instead of re-measuring.',
    whyItMatters: 'Transferring marks from a pole beats re-reading a tape on a ladder — print one for short spans.',
    alt: ['story pole', 'story-pole'],
  },
  'center-to-center': {
    term: 'center to center',
    def: 'The distance between the centers of two features, written CTC on hardware.',
    whyItMatters: 'Cabinet pulls are sold by CTC — 96, 128, or 160 mm — and the holes must match it exactly.',
    alt: ['ctc', 'center-to-center'],
  },
  rational: {
    term: 'exact fractions',
    def: 'Arithmetic on whole-number numerators and denominators, with no floating-point rounding.',
    whyItMatters: 'A hundred marks computed in exact fractions land exactly where multiplication says; floats drift.',
    alt: ['exact fraction', 'exact fractions'],
  },
};
