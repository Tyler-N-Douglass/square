/**
 * Confidence badge — the five honesty states (SPEC §4.1.7, §15.1).
 *
 * API (tiny, stable — A13 and the tools build on this):
 *   confidenceBadge(state)            → <span> badge
 *   confidenceBadge(state, onExplain) → <button> badge, 56px target, opens
 *                                       "what produced this" (SPEC §7B.6)
 *   el.update(state)                  → restyle in place, no re-mount
 *
 * Colors come from tokens.css state classes only: STRONG/LIKELY in type
 * color, POSSIBLE gray, NOISE gray-mid, UNRELIABLE red. The badge never
 * wears orange — orange marks live measured values, and a confidence word
 * is a judgment, not a reading.
 */
import type { Confidence } from '../../types';

export interface ConfidenceBadgeEl extends HTMLElement {
  update(state: Confidence): void;
}

export function confidenceBadge(state: Confidence, onExplain?: () => void): ConfidenceBadgeEl {
  const el = document.createElement(onExplain ? 'button' : 'span');
  if (el instanceof HTMLButtonElement) el.type = 'button';

  const chip = document.createElement('span');
  chip.className = 'conf__chip display';
  el.append(chip);

  const apply = (s: Confidence): void => {
    el.className = `conf conf--${s.toLowerCase()}${onExplain ? ' conf--explain' : ''}`;
    chip.textContent = s;
    el.setAttribute(
      'aria-label',
      onExplain ? `confidence: ${s} — tap to see what produced this` : `confidence: ${s}`,
    );
  };
  apply(state);

  if (onExplain) el.addEventListener('click', onExplain);

  return Object.assign(el, { update: apply }) as ConfidenceBadgeEl;
}
