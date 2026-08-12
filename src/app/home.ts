/**
 * Home — the tool grid. Seven flat tiles + Field Manual. Draplin: big blocks
 * of flat color, type does the lifting, no decoration.
 */
import type { AppContext, ToolModule } from './router';
import { TOOL_ROUTES } from './router';
import { ReplayMagSource } from '../sensors/replay';
import { rafWriter } from './store';

export function mount(el: HTMLElement, ctx: AppContext): () => void {
  const wrap = document.createElement('div');
  wrap.className = 'home';

  const tag = document.createElement('p');
  tag.className = 'home__tag display';
  tag.textContent = 'IS IT SQUARE?';
  wrap.append(tag);

  // First run — §7B.2, lean form (ADR-013): prove it on a real wall via the
  // SCAN guided run. Skip always works and is remembered; no lockout.
  let firstRunDone = true;
  try { firstRunDone = localStorage.getItem('square.firstrun.done') === '1'; } catch { /* private mode */ }
  if (!firstRunDone) {
    const markDone = (): void => { try { localStorage.setItem('square.firstrun.done', '1'); } catch { /* ignore */ } };
    const panel = document.createElement('section');
    panel.className = 'firstrun';
    const head = document.createElement('h2');
    head.className = 'display firstrun__head';
    head.textContent = 'FIRST RUN: PROVE IT';
    const line = document.createElement('p');
    line.className = 'firstrun__line';
    line.textContent = 'Ninety seconds to one real detection on your own wall. The guided run drives SCAN with live sensor data — permissions, the case-magnet check, calibration, first sweep.';
    const go = document.createElement('a');
    go.href = '#/scan';
    go.className = 'btn btn--live firstrun__go';
    go.textContent = 'START ON A WALL';
    go.addEventListener('click', markDone);
    const skip = document.createElement('a');
    skip.href = '#/';
    skip.className = 'firstrun__skip';
    skip.textContent = 'Skip setup';
    skip.addEventListener('click', (e) => { e.preventDefault(); markDone(); panel.remove(); });
    panel.append(head, line, go, skip);
    wrap.append(panel);
  }

  const grid = document.createElement('nav');
  grid.className = 'toolgrid';
  grid.setAttribute('aria-label', 'Tools');
  for (const t of TOOL_ROUTES) {
    const a = document.createElement('a');
    a.className = `tile tile--${t.id}`;
    a.href = `#/${t.id}`;
    const h = document.createElement('span');
    h.className = 'tile__name display';
    h.textContent = t.title;
    const p = document.createElement('span');
    p.className = 'tile__line';
    p.textContent = t.line;
    a.append(h, p);
    grid.append(a);
  }
  const manual = document.createElement('a');
  manual.className = 'tile tile--manual';
  manual.href = '#/manual';
  manual.innerHTML = '';
  const mh = document.createElement('span');
  mh.className = 'tile__name display';
  mh.textContent = 'FIELD MANUAL';
  const mp = document.createElement('span');
  mp.className = 'tile__line';
  mp.textContent = 'By task, offline, starts with what this app can’t do.';
  manual.append(mh, mp);
  grid.append(manual);
  wrap.append(grid);

  // Replay-driven dummy readout — Gate 0 criterion. When launched with
  // ?replay=<id>, the trace plays through the real source and the live |B|
  // renders as a measured value with its tier badge. No fake numbers: this
  // block exists only when a real trace is driving it.
  let stopReplay: (() => void) | null = null;
  if (ctx.replayTrace) {
    const t = ctx.replayTrace;
    const panel = document.createElement('section');
    panel.className = 'replaypanel';
    const label = document.createElement('div');
    label.className = 'replaypanel__label';
    label.textContent = `REPLAY · ${t.id}${t.synthetic ? ' · SYNTHETIC' : ''}`;
    // Raw signal trace, not a qualified measurement (H-03): unit comes from
    // the trace itself, styling is not .measured, and the caption says where
    // qualification happens. SCAN attaches noise floor and confidence.
    const unit = t.units.mag === 'deg' ? '°' : 'µT';
    const value = document.createElement('div');
    value.className = 'derived hud replaypanel__value';
    value.setAttribute('aria-live', 'off');
    value.textContent = '—';
    const sub = document.createElement('div');
    sub.className = 'replaypanel__sub';
    sub.textContent = `${t.device.magTier} tier · ${t.hz} Hz · raw signal — open SCAN to qualify it · ${t.note}`;
    panel.append(label, value, sub);
    wrap.append(panel);

    const src = new ReplayMagSource(t, { speed: 1, loop: true });
    const write = rafWriter<string>((s) => { value.textContent = s; });
    const unsub = src.subscribe((s) => write(`${s.mag.toFixed(2)} ${unit}`));
    void src.start();
    stopReplay = () => { unsub(); src.stop(); };
  }

  el.append(wrap);
  return () => { stopReplay?.(); };
}

// Satisfies the ToolModule shape for the router's loader map.
const _check: ToolModule = { mount };
void _check;
