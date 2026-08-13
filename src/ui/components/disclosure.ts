/**
 * MORE OPTIONS disclosure — progressive disclosure (ADR-015). Controls most
 * people never touch collapse behind one flat summary row; the open state is
 * remembered per tool in localStorage so a user who tunes keeps their setup.
 *
 * Built on <details>/<summary> so keyboard and screen-reader semantics come
 * from the platform. The summary click is handled explicitly (and the native
 * toggle intercepted) so open-state persistence is deterministic in every
 * DOM implementation the suite runs under.
 */

const KEY_PREFIX = 'square.moreopts.';

function readOpen(toolId: string): boolean {
  try {
    return localStorage.getItem(`${KEY_PREFIX}${toolId}`) === '1';
  } catch {
    return false; // private mode — default collapsed
  }
}

function writeOpen(toolId: string, open: boolean): void {
  try {
    localStorage.setItem(`${KEY_PREFIX}${toolId}`, open ? '1' : '0');
  } catch {
    /* private mode — session-only state, the safe direction */
  }
}

export interface MoreOptions {
  el: HTMLDetailsElement;
  /** Append the demoted controls here. */
  body: HTMLElement;
}

export function moreOptions(toolId: string, label = 'MORE OPTIONS'): MoreOptions {
  const el = document.createElement('details');
  el.className = 'moreopts';
  const summary = document.createElement('summary');
  summary.className = 'moreopts__summary display';
  summary.textContent = label;
  const body = document.createElement('div');
  body.className = 'moreopts__body';
  el.append(summary, body);
  el.open = readOpen(toolId);

  summary.addEventListener('click', (e) => {
    e.preventDefault(); // one code path for the toggle, every DOM impl alike
    el.open = !el.open;
    writeOpen(toolId, el.open);
  });

  return { el, body };
}
