/**
 * Bottom bar — every primary control lives in the bottom third, reachable
 * one-handed (SPEC §7.7). Fixed to the bottom edge, safe-area-inset padded,
 * 56px targets — 72px with wider spacing under [data-glove="on"], both via
 * the --tap token so glove mode is one attribute flip.
 *
 * API:
 *   bottomBar(...controls) → <div role="group">; append it to the tool root.
 *                            Controls keep their own classes and handlers;
 *                            each gains .bottombar__ctl for target sizing.
 *
 * The bar is last in DOM order, so keyboard traversal reaches the content
 * first and the controls last — same order a thumb reads the screen.
 */
export function bottomBar(...controls: HTMLElement[]): HTMLElement {
  const bar = document.createElement('div');
  bar.className = 'bottombar';
  bar.setAttribute('role', 'group');
  bar.setAttribute('aria-label', 'Tool controls');
  for (const c of controls) {
    c.classList.add('bottombar__ctl');
    bar.append(c);
  }
  return bar;
}
