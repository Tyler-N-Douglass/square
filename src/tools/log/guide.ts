/**
 * LOG guided run — SPEC §7B.3, §12 (a tool is not done until its guide
 * ships with it). LOG is a review surface: nothing here waits on a sensor,
 * so every step is tap-advance, which is the tooltip flow — not a Next
 * button (§7B.1). Step ids are stable; they key dismissal memory.
 *
 * No DEMO fixture: LOG replays nothing — there is no sensor pipeline to
 * watch, so a DemoSpec would be theater. Stated here on purpose.
 *
 * Parallel-work amendment: GLOSSARY_ADDITIONS is exported for the lead to
 * merge into src/guidance/glossary.ts — A8 does not edit A13's files.
 */
import type { GuideSpec } from '../../guidance/tour';
import type { GlossaryEntry } from '../../guidance/glossary';

export const LOG_GUIDE: GuideSpec = {
  toolId: 'log',
  steps: [
    {
      id: 'entries',
      text: 'Read any entry — the ± and confidence it was saved with stay attached forever.',
      anchor: '.log__list',
      advanceOn: 'tap',
    },
    {
      id: 'provenance',
      text: 'Tap an entry to open it — it shows the calibration state at the moment of capture.',
      anchor: '.log__list',
      critical: true,
      advanceOn: 'tap',
    },
    {
      id: 'views',
      text: 'Switch views here — by time, by project, or by kind.',
      anchor: '.log__views',
      advanceOn: 'tap',
    },
    {
      id: 'export',
      text: 'Export JSON for a full copy — CSV drops photos and provenance.',
      anchor: '.log__export-json',
      critical: true,
      advanceOn: 'tap',
    },
    {
      id: 'local-only',
      text: 'No cloud. Ever. Export is the only way data leaves this phone.',
      anchor: '.log__data',
      advanceOn: 'tap',
    },
    {
      id: 'delete-all',
      text: 'Delete-all wipes measurements and photos — calibration stays in CALIBRATE.',
      anchor: '.log__deleteall',
      advanceOn: 'tap',
    },
  ],
};

/** New domain terms LOG's copy uses — for the lead to merge into GLOSSARY. */
export const GLOSSARY_ADDITIONS: Readonly<Record<string, GlossaryEntry>> = {
  provenance: {
    term: 'provenance',
    def: 'The record of how a number was produced: sensor tier, calibration state, and sample count at capture.',
    whyItMatters: 'A reading without its provenance cannot be trusted later — the log keeps both together.',
  },
  'job-sheet': {
    term: 'job sheet',
    def: 'A printable page of logged measurements for one job, with units, ±, and notes.',
    whyItMatters: 'Paper survives dust, gloves, and a dead battery — print before the ladder, not after.',
    alt: ['job sheets'],
  },
};
