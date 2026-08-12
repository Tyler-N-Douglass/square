/**
 * LAYOUT tool view-model — SPEC §4.4. Owned by A4 (Craft Math, Phase 2).
 *
 * Pure logic between the form and the DOM: it calls the Phase 1 solvers
 * (src/geometry/layout.ts — consume-only) and turns their exact rationals
 * into display rows at the user's precision, carrying the rounding direction
 * for every cell (SPEC §5: round only at display time, and say which way the
 * number moved). Solver refusals pass through as stated reasons with the
 * shortfall — never clamped numbers (SPEC §15.3).
 *
 * Also here: the photo-scale math with its displayed uncertainty (SPEC
 * §4.4.2) and the stud-datum alignment against SCAN's logged studs (§4.4.3).
 */
import type { Confidence } from '../../types';
import type { SavedEntry } from '../../app/logStore';
import {
  equalCenters,
  equalGaps,
  fixedMargins,
  fixedPitchCentered,
  type LayoutMark,
} from '../../geometry/layout';
import {
  type FractionDenom,
  type Rational,
  type RoundingDirection,
  formatFtIn,
  formatMm,
  toNumber,
} from '../../geometry/units';

export type LayoutMode = 'equal-centers' | 'fixed-margins' | 'equal-gaps' | 'fixed-pitch';

export const MODE_LABELS: Readonly<Record<LayoutMode, string>> = {
  'equal-centers': 'Equal centers, wall to wall',
  'fixed-margins': 'Fixed margin + pitch',
  'equal-gaps': 'Equal gaps (needs item width)',
  'fixed-pitch': 'Fixed pitch, centered',
};

export interface LayoutFormInput {
  span: Rational;
  count: number;
  mode: LayoutMode;
  /** equal-gaps only. */
  itemWidth?: Rational;
  /** fixed-margins only. */
  margin?: Rational;
  /** fixed-margins and fixed-pitch. */
  pitch?: Rational;
}

export interface LayoutSummaryItem {
  label: string;
  value: Rational;
}

export type LayoutComputation =
  | { ok: true; mode: LayoutMode; marks: LayoutMark[]; summary: LayoutSummaryItem[] }
  | { ok: false; reason: string };

export function computeLayout(input: LayoutFormInput): LayoutComputation {
  switch (input.mode) {
    case 'equal-centers': {
      const r = equalCenters(input.span, input.count);
      if (!r.ok) return r;
      return { ok: true, mode: input.mode, marks: r.marks, summary: [{ label: 'Pitch', value: r.pitch }] };
    }
    case 'fixed-margins': {
      if (input.margin === undefined || input.pitch === undefined) {
        return { ok: false, reason: 'Fixed margins needs a margin and a pitch.' };
      }
      const r = fixedMargins(input.span, input.count, input.margin, input.pitch);
      if (!r.ok) return r;
      return {
        ok: true,
        mode: input.mode,
        marks: r.marks,
        summary: [
          { label: 'Pitch', value: input.pitch },
          { label: 'Leftover past last mark', value: r.leftover },
        ],
      };
    }
    case 'equal-gaps': {
      if (input.itemWidth === undefined) {
        return { ok: false, reason: 'Equal gaps needs the item width — the gap is what remains.' };
      }
      const r = equalGaps(input.span, input.count, input.itemWidth);
      if (!r.ok) return r;
      return { ok: true, mode: input.mode, marks: r.marks, summary: [{ label: 'Gap', value: r.gap }] };
    }
    case 'fixed-pitch': {
      if (input.pitch === undefined) {
        return { ok: false, reason: 'Fixed pitch needs the pitch — 96 mm for standard cabinet pulls.' };
      }
      const r = fixedPitchCentered(input.span, input.count, input.pitch);
      if (!r.ok) return r;
      return {
        ok: true,
        mode: input.mode,
        marks: r.marks,
        summary: [
          { label: 'Pitch', value: input.pitch },
          { label: 'Margin at each end', value: r.margin },
        ],
      };
    }
  }
}

/* ------------------------------------------------------------------------ */
/* Table view-model — both columns, rounding directions, optional mm         */
/* ------------------------------------------------------------------------ */

export interface TableCellVM {
  text: string;
  rounding: RoundingDirection;
}

export interface TableRowVM {
  /** 1-based mark number, as read off a ladder. */
  mark: number;
  cumulative: TableCellVM;
  incremental: TableCellVM;
  cumulativeMm: TableCellVM;
}

export function layoutTableRows(marks: LayoutMark[], denom: FractionDenom): TableRowVM[] {
  return marks.map((m) => {
    const cum = formatFtIn(m.cumulativeFromDatum, denom);
    const inc = formatFtIn(m.incrementalFromPrevious, denom);
    const mm = formatMm(m.cumulativeFromDatum);
    return {
      mark: m.index + 1,
      cumulative: { text: cum.text, rounding: cum.rounding },
      incremental: { text: inc.text, rounding: inc.rounding },
      cumulativeMm: { text: mm.text, rounding: mm.rounding },
    };
  });
}

/** Screen-reader / marker text for a rounding direction. */
export function roundingMarker(r: RoundingDirection): { char: string; label: string } {
  if (r === 'up') return { char: '▴', label: 'rounded up at this precision' };
  if (r === 'down') return { char: '▾', label: 'rounded down at this precision' };
  return { char: '', label: 'exact at this precision' };
}

/* ------------------------------------------------------------------------ */
/* Photo scale — SPEC §4.4.2                                                 */
/* ------------------------------------------------------------------------ */

/** Stated marking error per tapped point, px. The displayed ± derives from it. */
export const MARK_ERROR_PX = 2;

export interface PhotoScale {
  /** Inches per pixel on the wall plane. */
  inPerPx: number;
  refPx: number;
  refIn: Rational;
}

export type PhotoScaleResult = { ok: true; scale: PhotoScale } | { ok: false; reason: string };

export function photoScaleFrom(refPxDistance: number, refReal: Rational): PhotoScaleResult {
  const refIn = toNumber(refReal);
  if (!(refPxDistance > 0) || !Number.isFinite(refPxDistance)) {
    return { ok: false, reason: 'Tap two reference points first — the scale comes from them.' };
  }
  if (refPxDistance < 20) {
    return {
      ok: false,
      reason: `Reference points are ${refPxDistance.toFixed(0)} px apart — too close to set a scale. Tap two points farther apart.`,
    };
  }
  if (!(refIn > 0)) {
    return { ok: false, reason: 'Reference distance must be greater than zero.' };
  }
  return { ok: true, scale: { inPerPx: refIn / refPxDistance, refPx: refPxDistance, refIn: refReal } };
}

export interface ScaledLength {
  inches: number;
  /**
   * Propagated from a ±MARK_ERROR_PX marking error on each tapped point:
   * a point pair carries σ_pair = √2·σ_px, on both the reference pair and
   * the measured pair, so
   *   σ_L = √2·σ_px · s · √(1 + (p/d)²)
   * with s = in/px, p = measured pixel span, d = reference pixel span.
   * Uncertainty grows with the span-to-reference ratio p/d — displayed,
   * basis 'nominal' (SPEC §4.4.2).
   */
  plusMinusIn: number;
}

export function scaledLength(scale: PhotoScale, pxDistance: number): ScaledLength {
  const sigmaPair = Math.SQRT2 * MARK_ERROR_PX;
  const ratio = pxDistance / scale.refPx;
  return {
    inches: pxDistance * scale.inPerPx,
    plusMinusIn: sigmaPair * scale.inPerPx * Math.sqrt(1 + ratio * ratio),
  };
}

/* ------------------------------------------------------------------------ */
/* Stud datum from SCAN — SPEC §4.4.3                                        */
/* ------------------------------------------------------------------------ */

export interface StudRef {
  id: string;
  /** Stud center distance from the scan datum, inches. */
  centerIn: number;
  confidence: Confidence;
  ageMs: number;
}

/** Logged stud measurements usable as a datum: kind 'stud', unit in/mm. */
export function studsFromLog(entries: readonly SavedEntry[], nowMs = Date.now()): StudRef[] {
  const out: StudRef[] = [];
  for (const e of entries) {
    const m = e.measurement;
    if (m.kind !== 'stud' || typeof m.value !== 'number' || !Number.isFinite(m.value)) continue;
    const unit = m.unit.trim().toLowerCase();
    let centerIn: number | null = null;
    if (unit === 'in' || unit === '"' || unit === '″' || unit === 'inches') centerIn = m.value;
    else if (unit === 'mm') centerIn = m.value / 25.4;
    if (centerIn === null) continue;
    out.push({
      id: m.id,
      centerIn,
      confidence: m.confidence,
      ageMs: Math.max(0, nowMs - m.provenance.capturedAt),
    });
  }
  return out.sort((a, b) => a.centerIn - b.centerIn);
}

/** A mark snaps to a stud center within this half-window (stated in the UI). */
export const STUD_SNAP_TOL_IN = 2;

export interface StudAlignment {
  markIndex: number;
  targetIn: number;
  /** Stud center the mark moved to, or null on a miss. */
  snappedIn: number | null;
  /** snapped − target, inches (signed), or null on a miss. */
  deltaIn: number | null;
  miss: boolean;
}

export function alignMarksToStuds(
  marks: LayoutMark[],
  studCentersIn: number[],
  tolIn = STUD_SNAP_TOL_IN,
): StudAlignment[] {
  return marks.map((m) => {
    const target = toNumber(m.cumulativeFromDatum);
    let best: number | null = null;
    for (const c of studCentersIn) {
      if (best === null || Math.abs(c - target) < Math.abs(best - target)) best = c;
    }
    if (best !== null && Math.abs(best - target) <= tolIn) {
      return { markIndex: m.index, targetIn: target, snappedIn: best, deltaIn: best - target, miss: false };
    }
    return { markIndex: m.index, targetIn: target, snappedIn: null, deltaIn: null, miss: true };
  });
}

/** The §4.4.3 note for marks that land between studs. */
export const TOGGLE_BOLT_NOTE =
  'No stud within 2″ of this mark — use a toggle bolt or a heavy-duty hollow-wall anchor, or shift the layout to put the mark on a stud.';

/* ------------------------------------------------------------------------ */
/* Story pole print limit — SPEC §4.4.2                                      */
/* ------------------------------------------------------------------------ */

/** Longest span the print stylesheet renders at true scale (one Letter/A4
 *  page, portrait, with margins). Stated in the UI next to the button. */
export const PRINT_TRUE_SCALE_MAX_IN = 10;
