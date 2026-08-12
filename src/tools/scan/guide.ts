/**
 * SCAN guided run + DEMO specs + glossary additions — SPEC §7B, §12
 * ("a tool is not done until its guided run is done"), docs/guidance-notes.md.
 *
 * Step ids are STABLE — they key dismissal memory (FadingStore). Steps where
 * people actually go wrong (sweep speed, standoff) carry critical:true and
 * survive fading to 'reduced'.
 *
 * The walkthrough advances on REAL events, never a Next button:
 *   sensor-live  (custom)  — the source started after the user's tap
 *   first sample (sensor)  — the stream is flowing
 *   first-event  (custom)  — the pipeline reported a fastener
 *   marked       (custom)  — the user tapped MARK
 *   saved        (custom)  — SAVE SCAN wrote to the log
 *
 * Per the parallel-work amendment: DEMOS and GLOSSARY_ADDITIONS are exported
 * from here for the lead to merge into src/guidance/demo.ts DEMO_SPECS and
 * glossary.ts at the gate — this file does not edit A13's modules. Every
 * fixtureId below exists in tests/fixtures/ and is asserted by the fixture
 * suite, so the corpus-unification test stays green after the merge.
 */
import type { GuideSpec } from '../../guidance/tour';
import type { DemoSpec } from '../../guidance/demo';
import type { GlossaryEntry } from '../../guidance/glossary';

/* ------------------------------------------------------------------------ */
/* Guided runs                                                               */
/* ------------------------------------------------------------------------ */

/** The live-sensor walkthrough (FIELD / PROXY / replay). */
export const SCAN_GUIDE: GuideSpec = {
  toolId: 'scan',
  steps: [
    {
      id: 'start-sensor',
      text: 'Tap START SCAN — the sensor wakes on your tap.',
      anchor: '#scan-start',
      advanceOn: { event: 'custom', name: 'sensor-live' },
    },
    {
      id: 'hold-flat',
      text: 'Hold the phone flat against the wall, screen to the wall. The SENSOR reticle marks the read point.',
      anchor: '.scan__reticle',
      critical: true, // standoff — where people actually go wrong
      advanceOn: { event: 'sensor', predicate: () => true },
    },
    {
      id: 'sweep-pace',
      text: 'Sweep slowly along the wall — about one hand-width per second. Peaks smear above six inches per second.',
      anchor: '.scan__stateword',
      critical: true, // sweep speed — the other place people go wrong
      advanceOn: { event: 'custom', name: 'first-event' },
    },
    {
      id: 'mark-peak',
      text: 'That’s a screw. Pencil the wall at the reticle, then tap MARK.',
      anchor: '#scan-mark',
      advanceOn: { event: 'custom', name: 'marked' },
    },
    {
      id: 'save-scan',
      text: 'Tap SAVE SCAN — every fastener lands in the log with its confidence.',
      anchor: '#scan-save',
      advanceOn: { event: 'custom', name: 'saved' },
    },
  ],
};

/** The Tier NONE walkthrough — manual mode is the whole experience there. */
export const SCAN_MANUAL_GUIDE: GuideSpec = {
  toolId: 'scan-manual',
  steps: [
    {
      id: 'manual-reference',
      text: 'Enter a reference you trust — a corner, an outlet box, a stud you found.',
      anchor: '#scan-manual-ref',
      advanceOn: 'tap',
    },
    {
      id: 'manual-spacing',
      text: 'Pick the on-center spacing. 16″ is the common interior wall; 24″ shows up in garages and newer framing.',
      anchor: '#scan-manual-oc',
      advanceOn: 'tap',
    },
    {
      id: 'manual-band',
      text: 'Read the tape map. The ± band grows with distance from your reference — trust the near marks more.',
      anchor: '.scan__tapemap',
      critical: true,
      advanceOn: 'tap',
    },
    {
      id: 'manual-verify',
      text: 'Verify before drilling — knock test or a small pilot bit. Predicted lines are arithmetic, not measurement.',
      anchor: '.scan__manual-honesty',
      critical: true,
      advanceOn: 'tap',
    },
  ],
};

/* ------------------------------------------------------------------------ */
/* DEMOs — additions to A13's DEMO_SPECS (lead merges at the gate)           */
/* ------------------------------------------------------------------------ */

/**
 * Three additions beside A13's scan-first-wall / scan-hot-wall /
 * scan-magsafe: two more failure/limit demos (§15.7 — the limits teach
 * first) and the PROXY-tier honesty demo. Fixture ids are corpus files the
 * suite asserts.
 */
export const DEMOS: DemoSpec[] = [
  {
    toolId: 'scan',
    fixtureId: 'sweep-too-fast',
    narration: [
      { atT: 0.2, text: 'This sweep covers two feet in three seconds — more than twice the paced rate.' },
      { atT: 1.4, text: 'Watch the lobes flatten. A fastener’s signature crosses the sensor in a few samples and smears.' },
      { atT: 2.6, text: 'The app warns SWEEPING TOO FAST and reports no positions — a smeared position is a fiction. Slow to the tick and sweep again.' },
    ],
  },
  {
    toolId: 'scan',
    fixtureId: 'plaster-lath-dense',
    narration: [
      { atT: 0.3, text: 'Plaster over lath: fasteners land dense and irregular, not on a stud rhythm.' },
      { atT: 5.0, text: 'Four peaks inside eighteen inches cannot be 16″ framing — the median spacing gives it away.' },
      { atT: 11.0, text: 'The app reports the peaks but refuses the stud story: no pitch, confidence capped at POSSIBLE. Lay out from a known reference instead.' },
    ],
  },
  {
    toolId: 'scan',
    fixtureId: 'tierB-heading-proxy',
    narration: [
      { atT: 0.3, text: 'No raw field on this device — the signal is heading deflection as screws bend the compass.' },
      { atT: 3.0, text: 'The bipolar S-curve survives. The zero crossing between the lobes still marks the fastener.' },
      { atT: 9.0, text: 'Confidence caps at LIKELY on this tier — coarser, more false positives. The badge says so the whole time.' },
    ],
  },
];

/* ------------------------------------------------------------------------ */
/* Glossary additions (lead merges into src/guidance/glossary.ts)            */
/* ------------------------------------------------------------------------ */

export const GLOSSARY_ADDITIONS: Record<string, GlossaryEntry> = {
  'jack-stud': {
    term: 'jack stud',
    def: 'The shortened stud under a header, nailed to the king stud, that carries the header’s load.',
    whyItMatters: 'Near openings the on-center rhythm gives way to doubled framing — expect solid wood where the lattice predicts a gap.',
    alt: ['jack studs'],
  },
  anchor: {
    term: 'anchor',
    def: 'A tap that pins one moment of the sweep to a physical distance along the wall.',
    whyItMatters: 'Two anchors and one tape measurement turn the time chart into inches.',
    alt: ['anchors', 'anchored'],
  },
  phase: {
    term: 'phase',
    def: 'Where the stud rhythm sits along the wall — the offset before the spacing starts repeating.',
    whyItMatters: 'Pitch says how far apart the studs are; phase says where they are.',
    alt: ['phase locked', 'phase-locked'],
  },
};
