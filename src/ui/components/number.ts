/**
 * Number provenance components — THE core honesty layer (SPEC §5, §15.1,
 * §15.5). Three factories, and no other way to put a number on screen:
 *
 *   measuredEl(m, opts?)   live sensor value. Orange, HUD face, tabular
 *                          numerals. Unit ALWAYS rendered. ± (from
 *                          m.uncertainty) or its confidence badge ALWAYS
 *                          rendered adjacent. el.update(m) is rAF-coalesced
 *                          through store.rafWriter — call it on every sensor
 *                          tick; the DOM writes once per frame, into the
 *                          same nodes.
 *   derivedEl(value, unit, plusMinus, basis, opts?)
 *                          computed from measured values, propagated ±
 *                          always. Type color, never orange.
 *   enteredEl(value, unit) typed by the user. Dotted underline (tokens.css
 *                          .entered), never orange, no ± — the user's own
 *                          number is not a claim the app is making.
 *
 * There is deliberately no export that renders a bare number: a value
 * without a unit throws, a derived value without a finite ± throws, and a
 * measured value that cannot state a ± states its confidence instead.
 * UNRELIABLE and NOISE always show their badge, even alongside a ± — a
 * tidy ± on an unreliable reading would overstate it. That is the product
 * (SPEC §15).
 */
import type { Measurement, UncertaintyBasis } from '../../types';
import { rafWriter } from '../../app/store';
import { confidenceBadge, type ConfidenceBadgeEl } from './confidence';

export interface NumberOpts {
  /** Decimal places for the value. Default 1 (SPEC §5: angles at 1 dp). */
  decimals?: number;
  /** Force a leading + on non-negative values (anomaly readouts: `+3.42 µT`). */
  signed?: boolean;
  /** 'primary' = the arm's-length readout, ≥64px floor (SPEC §7.7). */
  size?: 'primary' | 'inline';
}

export interface MeasuredOpts extends NumberOpts {
  /** 'always' renders the confidence badge next to the ± instead of only
   *  when the ± is unavailable or the state is UNRELIABLE/NOISE. */
  showConfidence?: 'auto' | 'always';
  /** Makes the ± tappable — one sentence on what the uncertainty is derived
   *  from (SPEC §7B.6). */
  onExplainUncertainty?: () => void;
  /** Makes the confidence badge tappable — what produced this number. */
  onExplainConfidence?: () => void;
}

export interface MeasuredNumberEl extends HTMLElement {
  update(m: Measurement): void;
}

/* ---------- formatting ---------- */

/** Units that glue to the value with no space. */
const TIGHT_UNITS = new Set(['°', '%', '′', '″', "'", '"']);

function unitLabel(unit: string): string {
  return TIGHT_UNITS.has(unit) ? unit : ` ${unit}`;
}

function fmtValue(v: number, decimals: number, signed: boolean): string {
  if (!Number.isFinite(v)) return '—';
  const s = v.toFixed(decimals);
  return signed && v >= 0 ? `+${s}` : s;
}

/** ± formatting: enough digits to mean something, no false precision. */
function fmtPm(pm: number): string {
  if (pm >= 10) return pm.toFixed(0);
  if (pm >= 1) return pm.toFixed(1);
  return pm.toFixed(2);
}

function requireUnit(unit: string): void {
  if (!unit || !unit.trim()) {
    throw new Error('SQUARE: a number without a unit has no render path (SPEC §15.1)');
  }
}

function sizeClass(size: NumberOpts['size']): string {
  return size === 'primary' ? ' num--primary' : '';
}

/* ---------- measured ---------- */

export function measuredEl(m: Measurement, opts: MeasuredOpts = {}): MeasuredNumberEl {
  requireUnit(m.unit);
  const decimals = opts.decimals ?? 1;

  const root = document.createElement('span');
  root.className = `num num--measured${sizeClass(opts.size)}`;

  const reading = document.createElement('span');
  reading.className = 'measured hud num__reading';
  reading.setAttribute('aria-live', 'off'); // ticks are not announced; state words go through announce()
  const value = document.createElement('span');
  value.className = 'num__value';
  const unit = document.createElement('span');
  unit.className = 'num__unit';
  reading.append(value, unit);

  const qual = document.createElement('span');
  qual.className = 'num__qual';
  root.append(reading, qual);

  let pmEl: HTMLElement | null = null;
  let badge: ConfidenceBadgeEl | null = null;

  const render = (mm: Measurement): void => {
    value.textContent = fmtValue(mm.value, decimals, opts.signed === true);
    unit.textContent = unitLabel(mm.unit);

    const pm = mm.uncertainty.plusMinus;
    const hasPm = Number.isFinite(pm) && mm.uncertainty.basis !== 'unknown';

    if (hasPm) {
      if (!pmEl) {
        const explain = opts.onExplainUncertainty;
        pmEl = document.createElement(explain ? 'button' : 'span');
        if (pmEl instanceof HTMLButtonElement && explain) {
          pmEl.type = 'button';
          pmEl.addEventListener('click', explain);
        }
        pmEl.className = `num__pm hud${explain ? ' num__pm--explain' : ''}`;
        qual.prepend(pmEl);
      }
      const pmText = `±${fmtPm(pm)}${unitLabel(mm.unit)}`;
      pmEl.textContent = pmText;
      pmEl.setAttribute('data-basis', mm.uncertainty.basis);
      pmEl.setAttribute(
        'aria-label',
        opts.onExplainUncertainty
          ? `plus or minus ${fmtPm(pm)}${unitLabel(mm.unit)} — tap to see where the uncertainty comes from`
          : `plus or minus ${fmtPm(pm)}${unitLabel(mm.unit)}`,
      );
    } else if (pmEl) {
      pmEl.remove();
      pmEl = null;
    }

    const needBadge =
      !hasPm ||
      opts.showConfidence === 'always' ||
      mm.confidence === 'UNRELIABLE' ||
      mm.confidence === 'NOISE';
    if (needBadge) {
      if (!badge) {
        badge = confidenceBadge(mm.confidence, opts.onExplainConfidence);
        qual.append(badge);
      } else {
        badge.update(mm.confidence);
      }
    } else if (badge) {
      badge.remove();
      badge = null;
    }
  };

  render(m); // first paint is synchronous — no blank frame
  const write = rafWriter<Measurement>(render);

  return Object.assign(root, {
    update: (mm: Measurement): void => {
      requireUnit(mm.unit);
      write(mm);
    },
  }) as MeasuredNumberEl;
}

/* ---------- recorded ---------- */

/**
 * A SAVED measurement — LOG entries, history views. Same mandatory unit and
 * ±/confidence as measuredEl, but it does NOT wear orange: the orange rule
 * (SPEC §7.1) marks a value a sensor is producing right now, and a recorded
 * reading is history, not a live signal (ADR-013). Static — no update().
 */
export function recordedEl(m: Measurement, opts: MeasuredOpts = {}): HTMLElement {
  const live = measuredEl(m, opts);
  live.classList.add('num--recorded');
  const reading = live.querySelector('.num__reading');
  if (reading) {
    reading.classList.remove('measured');
    reading.classList.add('derived');
  }
  return live;
}

/* ---------- derived ---------- */

export function derivedEl(
  value: number,
  unit: string,
  plusMinus: number,
  basis: UncertaintyBasis,
  opts: NumberOpts = {},
): HTMLElement {
  requireUnit(unit);
  if (!Number.isFinite(plusMinus)) {
    throw new Error('SQUARE: derived values carry a propagated ± (SPEC §5)');
  }
  const decimals = opts.decimals ?? 1;

  const root = document.createElement('span');
  root.className = `num num--derived${sizeClass(opts.size)}`;

  const reading = document.createElement('span');
  reading.className = 'derived hud num__reading';
  const v = document.createElement('span');
  v.className = 'num__value';
  v.textContent = fmtValue(value, decimals, opts.signed === true);
  const u = document.createElement('span');
  u.className = 'num__unit';
  u.textContent = unitLabel(unit);
  reading.append(v, u);

  const qual = document.createElement('span');
  qual.className = 'num__qual';
  const pm = document.createElement('span');
  pm.className = 'num__pm hud';
  pm.textContent = `±${fmtPm(plusMinus)}${unitLabel(unit)}`;
  pm.setAttribute('data-basis', basis);
  pm.setAttribute('aria-label', `plus or minus ${fmtPm(plusMinus)}${unitLabel(unit)}`);
  qual.append(pm);

  root.append(reading, qual);
  return root;
}

/* ---------- entered ---------- */

export function enteredEl(value: number | string, unit: string): HTMLElement {
  requireUnit(unit);

  const root = document.createElement('span');
  root.className = 'num num--entered';

  const reading = document.createElement('span');
  reading.className = 'entered hud num__reading';
  const v = document.createElement('span');
  v.className = 'num__value';
  v.textContent = typeof value === 'number' ? (Number.isFinite(value) ? String(value) : '—') : value;
  const u = document.createElement('span');
  u.className = 'num__unit';
  u.textContent = unitLabel(unit);
  reading.append(v, u);

  root.append(reading);
  return root;
}
