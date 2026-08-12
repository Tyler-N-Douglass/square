/**
 * Just-in-time explainer card renderer — SPEC §7B.6 shape: why this is
 * happening / what to do / what happens if you ignore it. One card at a
 * time per host container; dismissible; routes to CALIBRATE when the card
 * names a calibration that would help. Shared by A3b's two tools.
 */
import type { Explainer } from '../../guidance/explainers';
import { injectStylesOnce } from './styles';

const CSS = `
.explaincard { border: 3px solid var(--rule-strong, #58595B); background: var(--surface, #fff); padding: 16px; margin: 8px 0; }
.explaincard h3 { font-family: var(--font-display, inherit); text-transform: uppercase; letter-spacing: 0.06em; margin: 0 0 8px; }
.explaincard dt { font-weight: 700; margin-top: 8px; }
.explaincard dd { margin: 2px 0 0; font-family: var(--font-prose, inherit); line-height: 1.45; }
.explaincard__row { display: flex; gap: 8px; margin-top: 12px; flex-wrap: wrap; }
`;

export function showExplainerCard(host: HTMLElement, ex: Explainer): HTMLElement {
  injectStylesOnce('a3b-explaincard', CSS);
  host.querySelector('.explaincard')?.remove();

  const card = document.createElement('section');
  card.className = 'explaincard';
  card.setAttribute('role', 'note');

  const h = document.createElement('h3');
  h.textContent = ex.title;

  const dl = document.createElement('dl');
  const part = (label: string, text: string): void => {
    const dt = document.createElement('dt');
    dt.textContent = label;
    const dd = document.createElement('dd');
    dd.textContent = text;
    dl.append(dt, dd);
  };
  part('Why this is happening', ex.why);
  part('What to do', ex.whatToDo);
  part('If you ignore it', ex.ifIgnored);

  const row = document.createElement('div');
  row.className = 'explaincard__row';
  if (ex.calibrationRoute) {
    const go = document.createElement('a');
    go.className = 'btn';
    go.href = '#/calibrate';
    go.textContent = 'OPEN CALIBRATE';
    row.append(go);
  }
  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'btn btn--ghost';
  close.textContent = 'CLOSE';
  close.addEventListener('click', () => card.remove());
  row.append(close);

  card.append(h, dl, row);
  host.append(card);
  return card;
}
