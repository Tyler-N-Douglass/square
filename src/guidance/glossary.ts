/**
 * Glossary — SPEC §7B.8. Every domain term is tappable wherever it appears:
 * one short definition plus one line on why it matters here. Underline style
 * is dotted 2px --gray, never orange — orange is reserved for live values.
 *
 * Contents: the full §7B.8 list, plus every term the guidance copy
 * (explainers, DEMO narration, Field Manual) uses that a homeowner would not
 * know. The guidance suite asserts the §7B.8 list is complete and that the
 * voice rules hold.
 */

export interface GlossaryEntry {
  term: string;
  /** One short sentence. */
  def: string;
  /** One line on why it matters in this app. */
  whyItMatters: string;
  /** Alternate surface forms to match in prose (inflections, spellings). */
  alt?: string[];
}

export const GLOSSARY: Readonly<Record<string, GlossaryEntry>> = {
  /* ---- The §7B.8 list ---- */
  'on-center': {
    term: 'on center',
    def: 'The spacing between the centers of framing members, not the gap between them.',
    whyItMatters: 'Studs land at 16″ or 24″ on center, so one confirmed stud predicts the rest of the wall.',
  },
  plumb: {
    term: 'plumb',
    def: 'Exactly vertical, the direction a hanging weight defines.',
    whyItMatters: 'Doors, shelves, and frames read wrong against an out-of-plumb wall — measure the wall, not your eye.',
  },
  'spring-angle': {
    term: 'spring angle',
    def: 'The angle crown molding leans off the wall, most often 45/45 or 52/38.',
    whyItMatters: 'Compound miter settings change with it — the wrong spring angle wastes the stick.',
  },
  miter: {
    term: 'miter',
    def: 'A cut angled across the face of the board, set by rotating the saw table.',
    whyItMatters: 'Each piece carries half the corner — the miter number moves your measured angle onto the saw.',
  },
  bevel: {
    term: 'bevel',
    def: 'A cut angled through the thickness of the board, set by tilting the blade.',
    whyItMatters: 'Compound cuts need miter and bevel together; the saw card states both, with tilt direction.',
  },
  kerf: {
    term: 'kerf',
    def: 'The slot of material the blade removes, typically 1/8″ wide.',
    whyItMatters: 'Cut on the waste side of the line, or every piece comes up one kerf short.',
  },
  'witness-mark': {
    term: 'witness mark',
    def: 'A light pencil mark that records a position before you commit to it.',
    whyItMatters: 'Witness marks let a second pass confirm the first before any drilling starts.',
  },
  'king-stud': {
    term: 'king stud',
    def: 'The full-height stud alongside a door or window opening.',
    whyItMatters: 'Openings break the on-center rhythm — expect extra framing at their edges, not a missing stud.',
  },
  header: {
    term: 'header',
    def: 'The horizontal framing member carrying load across a door or window opening.',
    whyItMatters: 'Above an opening you hit solid wood almost anywhere — good for mounting, bad for lattice inference.',
  },
  standoff: {
    term: 'standoff',
    def: 'The distance from sensor to fastener — drywall thickness plus the phone body.',
    whyItMatters: 'Signal falls off steeply with standoff; a thick case measurably weakens every peak.',
  },
  'hard-iron': {
    term: 'hard iron',
    def: 'A fixed magnetic offset that moves with the phone — magnets and steel in the phone or its case.',
    whyItMatters: 'Calibration subtracts it; a large hard-iron offset means a magnetic accessory is attached.',
  },
  'soft-iron': {
    term: 'soft iron',
    def: 'Nearby material that distorts the field by different amounts in different directions.',
    whyItMatters: 'Calibration reshapes that distortion back into a sphere so a peak reads the same at any phone angle.',
  },
  snr: {
    term: 'SNR',
    def: 'Signal-to-noise ratio — peak strength divided by the noise floor.',
    whyItMatters: 'Every confidence state maps from SNR; calibrating and sweeping slower both raise it.',
  },
  prominence: {
    term: 'prominence',
    def: 'How far a peak rises above its immediate surroundings, not above zero.',
    whyItMatters: 'Prominence-based detection ignores slow drift that a bare threshold would call a find.',
  },
  'vanishing-point': {
    term: 'vanishing point',
    def: 'The image point where parallel real-world lines appear to meet.',
    whyItMatters: 'CORNER recovers true 3D directions from vanishing points — two marked parallel edges make one.',
  },
  dihedral: {
    term: 'dihedral',
    def: 'The angle between two flat faces, measured through their shared edge.',
    whyItMatters: 'BEVEL measures a dihedral by resting the phone on each face in turn.',
  },

  /* ---- Terms the guidance copy uses that a homeowner would not know ---- */
  ferrous: {
    term: 'ferrous',
    def: 'Containing iron, and so magnetic — steel screws and nails are; copper, brass, and aluminum are not.',
    whyItMatters: 'SCAN sees only ferrous metal, which is why a copper pipe hides and a steel strap shouts.',
  },
  conduit: {
    term: 'conduit',
    def: 'The metal tube that carries electrical wiring inside a wall.',
    whyItMatters: 'Conduit reads like a strong fastener line, and drilling into it is the failure that matters most.',
  },
  rebar: {
    term: 'rebar',
    def: 'Steel reinforcing bar cast inside concrete.',
    whyItMatters: 'Rebar makes a whole wall read hot — fastener detection stops being reliable near it.',
  },
  'stud-bay': {
    term: 'stud bay',
    def: 'The open cavity between two neighboring studs.',
    whyItMatters: 'A hot bay can hide a run of conduit or duct while the neighboring bay reads clean.',
    alt: ['bay'],
  },
  lattice: {
    term: 'lattice',
    def: 'The repeating on-center grid of stud positions fitted to the fasteners a sweep found.',
    whyItMatters: 'A locked lattice predicts stud centers beyond the span you swept — confirm one before trusting the rest.',
  },
  'noise-floor': {
    term: 'noise floor',
    def: 'The background level of random variation a real peak must rise above.',
    whyItMatters: 'The floor sets the detection threshold; a calm floor lets weaker fasteners surface.',
  },
  'zero-crossing': {
    term: 'zero crossing',
    def: 'The point where the signal changes sign between the two lobes of a fastener signature.',
    whyItMatters: 'The fastener sits at the zero crossing, not under either peak — marking a lobe misses by an inch.',
  },
  'bipolar-signature': {
    term: 'bipolar signature',
    def: 'The paired positive and negative swing a fastener writes as the sensor passes it.',
    whyItMatters: 'The shape separates real fasteners from drift — one-sided bumps get rejected.',
  },
  detrend: {
    term: 'detrend',
    def: 'Remove the slow drift from a signal so only local change remains.',
    whyItMatters: 'Earth’s field dwarfs a screw’s anomaly — detrending clears the baseline so the screw can show.',
    alt: ['detrended', 'detrending'],
  },
  'heading-proxy': {
    term: 'heading proxy',
    def: 'A fallback sensing tier that reads fasteners through compass-heading deflection instead of the raw field.',
    whyItMatters: 'It works, but coarser — confidence is capped below STRONG whenever this tier is active.',
  },
  'monte-carlo': {
    term: 'Monte Carlo',
    def: 'An uncertainty estimate made by re-solving many times with small random nudges to the inputs.',
    whyItMatters: 'The ± on a corner angle is the spread of 500 such re-solves, not a guess.',
  },
  'focal-length': {
    term: 'focal length',
    def: 'The camera constant that maps real-world angles onto image pixels.',
    whyItMatters: 'Angle accuracy runs through it — calibrating the lens replaces an estimate with a measurement.',
  },
  loupe: {
    term: 'loupe',
    def: 'The magnifier that follows your finger while you place a point on the photo.',
    whyItMatters: 'Your fingertip covers the pixels that matter — the loupe shows them offset so the mark lands true.',
  },
  'motion-gate': {
    term: 'motion gate',
    def: 'The check that holds a reading until the phone has been still for 400 ms.',
    whyItMatters: 'A twitching number is not a measurement — the gate keeps motion out of the reading.',
  },
  'reversal-calibration': {
    term: 'reversal calibration',
    def: 'Measure a surface, rotate the phone 180° in place, measure again — the two readings split sensor bias from true tilt.',
    whyItMatters: 'It is the difference between the app claiming ±0.5° and ±0.15°.',
  },
  'gyro-drift': {
    term: 'gyro drift',
    def: 'The slow error that accumulates when orientation rides on the gyro alone.',
    whyItMatters: 'BEVEL’s 3D mode refuses after twenty seconds because drift outgrows the angle being measured.',
  },
  'pilot-hole': {
    term: 'pilot hole',
    def: 'A small hole drilled first to guide and test before the full-size bit.',
    whyItMatters: 'Wood curls from a 1/8″ pilot confirm the stud before the big bit commits you.',
    alt: ['pilot'],
  },
  'toggle-bolt': {
    term: 'toggle bolt',
    def: 'A drywall anchor with spring-open wings that bear against the back of the wallboard.',
    whyItMatters: 'Where no stud is reachable, a rated toggle carries real weight — bare drywall screws do not.',
    alt: ['toggle bolts', 'toggle'],
  },
  saturation: {
    term: 'saturation',
    def: 'The state where the field is stronger than the sensor can represent, so readings clip at the ceiling.',
    whyItMatters: 'Clipped samples carry no shape — peaks and positions computed from them mean nothing.',
    alt: ['saturated'],
  },
};

/** The §7B.8 list, verbatim, as slugs — the completeness contract the suite asserts. */
export const REQUIRED_TERM_SLUGS: readonly string[] = [
  'on-center', 'plumb', 'spring-angle', 'miter', 'bevel', 'kerf', 'witness-mark',
  'king-stud', 'header', 'standoff', 'hard-iron', 'soft-iron', 'snr',
  'prominence', 'vanishing-point', 'dihedral',
];

/** Look an entry up by slug. Returns null for unknown slugs — callers render plain text then. */
export function defineTerm(slug: string): GlossaryEntry | null {
  return GLOSSARY[slug] ?? null;
}

/* ---- Matching prose against the glossary (used by the Field Manual) ---- */

function normalize(s: string): string {
  return s.toLowerCase().replace(/[-‐‑]+/g, ' ').replace(/\s+/g, ' ').trim();
}

const SURFACE_TO_SLUG: ReadonlyMap<string, string> = (() => {
  const m = new Map<string, string>();
  for (const [slug, entry] of Object.entries(GLOSSARY)) {
    m.set(normalize(entry.term), slug);
    for (const a of entry.alt ?? []) m.set(normalize(a), slug);
  }
  return m;
})();

/** Resolve a matched surface form (e.g. "on-center", "toggle bolts") to its entry. */
export function findTerm(surface: string): { slug: string; entry: GlossaryEntry } | null {
  const norm = normalize(surface);
  const direct = SURFACE_TO_SLUG.get(norm);
  if (direct !== undefined) return { slug: direct, entry: GLOSSARY[direct]! };
  if (norm.endsWith('s')) {
    const singular = SURFACE_TO_SLUG.get(norm.slice(0, -1));
    if (singular !== undefined) return { slug: singular, entry: GLOSSARY[singular]! };
  }
  return null;
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * A fresh global regex matching every glossary surface form in running prose.
 * Longest forms first so "king stud" wins over "stud bay"'s alt "bay" etc.;
 * spaces match hyphens too, and a trailing plural "s" is allowed.
 */
export function termRegex(): RegExp {
  const surfaces = new Set<string>();
  for (const entry of Object.values(GLOSSARY)) {
    surfaces.add(entry.term);
    for (const a of entry.alt ?? []) surfaces.add(a);
  }
  const alts = [...surfaces]
    .sort((a, b) => b.length - a.length)
    .map((t) => escapeRe(t).replace(/ /g, '[-\\s‐‑]'));
  return new RegExp(`\\b(?:${alts.join('|')})s?\\b`, 'gi');
}
