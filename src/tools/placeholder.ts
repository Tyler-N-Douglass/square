/**
 * Phase 0 placeholder — an honest "not built yet" screen that already tells
 * the truth about capability. Replaced tool-by-tool in Phase 2. Never fakes
 * a reading: there is no number on this screen because nothing is measured.
 */
import type { AppContext } from '../app/router';

export function placeholderMount(name: string, what: string, cannot: string) {
  return (el: HTMLElement, ctx: AppContext): (() => void) => {
    const wrap = document.createElement('div');
    wrap.className = 'placeholder';

    const h = document.createElement('h1');
    h.className = 'placeholder__name display';
    h.textContent = name;

    const body = document.createElement('p');
    body.className = 'placeholder__body';
    body.textContent = what;

    const limits = document.createElement('p');
    limits.className = 'placeholder__body';
    limits.textContent = cannot;

    const cap = document.createElement('div');
    cap.className = 'placeholder__cap';
    const tierLine = ctx.capability.magTier === 'FIELD'
      ? 'This device exposes the raw magnetic field (FIELD tier).'
      : ctx.capability.magTier === 'PROXY'
        ? 'This device exposes heading only (PROXY tier) — coarser readings, capped confidence.'
        : 'This device exposes no magnetometer (NONE tier) — sensing tools degrade honestly to manual math.';
    cap.textContent = `Build state: this tool is scaffolded, not yet operational. Nothing here will show a number it did not measure. ${tierLine}`;

    wrap.append(h, body, limits, cap);
    el.append(wrap);
    return () => { /* nothing to release */ };
  };
}
