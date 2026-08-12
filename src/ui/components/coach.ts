/**
 * Coach mark — the single-tooltip primitive A13 builds walkthroughs on.
 * Rules (SPEC §7B.5): one at a time, never a queue; anchored to its element;
 * dismissed by tapping anywhere or by keyboard (Escape/Enter/Space); two
 * lines maximum, enforced by CSS clamp; instant appearance, no animation —
 * this design does not bounce; aria-describedby wired onto the anchor;
 * focus-reachable (tabindex 0); never covers the control it points at — it
 * sits below the anchor, or above when the anchor is in the bottom third.
 *
 * API — the whole surface, keep it this small:
 *   coachMark(anchor, text, opts?) → CoachMarkEl, appended to document.body.
 *     opts.onDismiss?()              fires exactly once when it goes away.
 *   el.dismiss()                     programmatic dismissal.
 *   dismissCoachMark()               dismiss whatever is showing, if anything.
 *   activeCoachMark()                current mark or null (tours, tests).
 *
 * Mounting a second mark dismisses the first — module-level singleton,
 * on purpose.
 */
export interface CoachMarkOpts {
  onDismiss?: () => void;
}

export interface CoachMarkEl extends HTMLElement {
  dismiss(): void;
}

let active: CoachMarkEl | null = null;
let seq = 0;

export function activeCoachMark(): CoachMarkEl | null {
  return active;
}

export function dismissCoachMark(): void {
  active?.dismiss();
}

export function coachMark(anchor: HTMLElement, text: string, opts: CoachMarkOpts = {}): CoachMarkEl {
  dismissCoachMark();

  const div = document.createElement('div');
  div.className = 'coach';
  div.id = `coach-${++seq}`;
  div.setAttribute('role', 'status');
  div.tabIndex = 0;
  div.textContent = text;

  const prevDescribed = anchor.getAttribute('aria-describedby');
  anchor.setAttribute('aria-describedby', prevDescribed ? `${prevDescribed} ${div.id}` : div.id);

  document.body.append(div);
  position(div, anchor);

  let done = false;
  const onAnyTap = (): void => dismiss();
  const onKey = (ev: KeyboardEvent): void => {
    if (ev.key === 'Escape' || ev.key === 'Enter' || ev.key === ' ') {
      ev.preventDefault();
      dismiss();
    }
  };
  const onResize = (): void => position(div, anchor);

  // Capture phase: any tap dismisses, and the tapped control still receives
  // its own event — the mark never blocks the interface.
  document.addEventListener('pointerdown', onAnyTap, true);
  div.addEventListener('keydown', onKey);
  window.addEventListener('resize', onResize);

  function dismiss(): void {
    if (done) return;
    done = true;
    document.removeEventListener('pointerdown', onAnyTap, true);
    window.removeEventListener('resize', onResize);
    const ids = (anchor.getAttribute('aria-describedby') ?? '')
      .split(/\s+/)
      .filter((id) => id && id !== div.id);
    if (ids.length) anchor.setAttribute('aria-describedby', ids.join(' '));
    else anchor.removeAttribute('aria-describedby');
    div.remove();
    if (active !== null && active.id === div.id) active = null;
    opts.onDismiss?.();
  }

  const el = Object.assign(div, { dismiss }) as CoachMarkEl;
  active = el;
  return el;
}

function position(el: HTMLElement, anchor: HTMLElement): void {
  const r = anchor.getBoundingClientRect();
  const vh = window.innerHeight || 0;
  el.style.left = `${Math.max(8, r.left)}px`;
  if (vh && r.top > vh * 0.6) {
    // anchor sits low — place the mark above so the bottom-third controls stay clear
    el.style.top = 'auto';
    el.style.bottom = `${vh - r.top + 8}px`;
  } else {
    el.style.bottom = 'auto';
    el.style.top = `${r.bottom + 8}px`;
  }
}
