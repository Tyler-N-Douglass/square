/**
 * Field Manual — task-organized, offline, searchable (SPEC §7B.7). A13
 * territory; Phase 0 carries the honest skeleton with the one entry that
 * must exist before any other: what this app can't do (SPEC §15.7 — teach
 * the limits first).
 */
import type { AppContext } from '../app/router';

const CANT_DO: ReadonlyArray<[string, string]> = [
  ['See wood', 'The magnetometer finds ferrous fasteners — screws and nails — not the stud itself. No fasteners in range, no signal.'],
  ['Work on every wall', 'Plaster over lath scatters fasteners densely and irregularly. Metal-stud walls read hot end to end. Glued panels have nothing to find. The app says so instead of marking studs that are not there.'],
  ['Replace the tape measure', 'LAYOUT’s overlay plans and verifies. The tape still makes the mark.'],
  ['Beat a bad calibration', 'Every accuracy claim is gated on CALIBRATE. Skip it and the app claims less, visibly.'],
  ['Measure through magnets', 'MagSafe rings, wallets, and mounts swamp the field. The app detects the offset and tells you to take the case off — it will not scan around it.'],
];

export function mount(el: HTMLElement, _ctx: AppContext): () => void {
  const wrap = document.createElement('div');
  wrap.className = 'placeholder';

  const h = document.createElement('h1');
  h.className = 'placeholder__name display';
  h.textContent = 'FIELD MANUAL';

  const intro = document.createElement('p');
  intro.className = 'placeholder__body';
  intro.textContent = 'Organized by task, not by feature. Every entry ends with a verification step. First, the limits:';

  const h2 = document.createElement('h2');
  h2.className = 'display';
  h2.textContent = 'WHAT THIS APP CAN’T DO';

  const dl = document.createElement('dl');
  dl.className = 'placeholder__body';
  for (const [term, def] of CANT_DO) {
    const dt = document.createElement('dt');
    dt.style.fontWeight = 'bold';
    dt.textContent = term;
    const dd = document.createElement('dd');
    dd.textContent = def;
    dl.append(dt, dd);
  }

  const note = document.createElement('p');
  note.className = 'placeholder__cap';
  note.textContent = 'Task entries (“Hang a heavy mirror”, “Why won’t my trim fit this corner?”) land with their tools in Phase 2.';

  wrap.append(h, intro, h2, dl, note);
  el.append(wrap);
  return () => { /* nothing to release */ };
}
