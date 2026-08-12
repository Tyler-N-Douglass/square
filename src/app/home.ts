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
    const value = document.createElement('div');
    value.className = 'measured hud replaypanel__value';
    value.setAttribute('aria-live', 'off');
    value.textContent = '—';
    const sub = document.createElement('div');
    sub.className = 'replaypanel__sub';
    sub.textContent = `${t.device.magTier} tier · ${t.hz} Hz · ${t.note}`;
    panel.append(label, value, sub);
    wrap.append(panel);

    const src = new ReplayMagSource(t, { speed: 1, loop: true });
    const write = rafWriter<string>((s) => { value.textContent = s; });
    const unsub = src.subscribe((s) => write(`${s.mag.toFixed(2)} µT`));
    void src.start();
    stopReplay = () => { unsub(); src.stop(); };
  }

  el.append(wrap);
  return () => { stopReplay?.(); };
}

// Satisfies the ToolModule shape for the router's loader map.
const _check: ToolModule = { mount };
void _check;
