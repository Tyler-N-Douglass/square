/**
 * The mark — framing square with a plumb bob dropped through the heel
 * (SPEC §7.5). MARK_SVG below is public/icons/app-icon-square.svg re-inlined
 * verbatim — same geometry, same hexes — with the bob wrapped in
 * <g class="mark__bob"> so CSS can drop it. The shipped icon file itself is
 * untouched; tests/dom/components-mark.test.ts diffs this template against
 * it so the two can never drift.
 *
 * API:
 *   loadingMark() → the app mark. The bob drops into place once, 400 ms,
 *                   transform-only CSS animation, then holds.
 *                   prefers-reduced-motion lands on the settled state —
 *                   tokens.css collapses every animation to 0.01ms and the
 *                   keyframes end settled.
 *   ghostBob()    → the bob silhouette alone at 15% opacity, for LEVEL's
 *                   out-of-tolerance state (SPEC §7.5.2): it hangs true
 *                   while the measured line does not, and the gap between
 *                   them is the error, shown rather than described.
 *
 * The ghost renders in currentColor, not orange. The orange rule is
 * absolute: orange marks a value a sensor is producing right now, and the
 * ghost is the gravity reference — static by definition. (The loading mark
 * keeps its orange bob because it is the shipped brand asset, reused as
 * §7.5 requires, not a reading.)
 */

/** Raw mark source. Exported for the drift test and for print/export uses
 *  that need markup rather than a node. Do not edit geometry here — it must
 *  match public/icons/app-icon-square.svg exactly. */
export const MARK_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" role="img" aria-label="SQUARE mark: framing square with plumb bob">
 <rect width="512" height="512" fill="#2E2E2E"/>
 <path d="M60 52 H160 V376 H452 V468 H60 Z" fill="#F1F2F2"/>
 <g fill="#2E2E2E">
   <rect x="120" y="96" width="40" height="14"/><rect x="136" y="140" width="24" height="14"/>
   <rect x="120" y="184" width="40" height="14"/><rect x="136" y="228" width="24" height="14"/>
   <rect x="120" y="272" width="40" height="14"/><rect x="136" y="316" width="24" height="14"/>
   <rect x="216" y="428" width="14" height="40"/><rect x="260" y="444" width="14" height="24"/>
   <rect x="304" y="428" width="14" height="40"/><rect x="348" y="444" width="14" height="24"/>
   <rect x="392" y="428" width="14" height="40"/><rect x="436" y="444" width="14" height="24"/>
 </g>
 <g class="mark__bob">
   <rect x="249" y="278" width="14" height="76" fill="#F15A22"/>
   <path d="M256 340 L300 402 L256 486 L212 402 Z" fill="#F15A22"/>
 </g>
</svg>`;

/** The bob alone, in currentColor. ViewBox tight around stem + bob. */
const GHOST_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="204 270 104 224" aria-hidden="true" focusable="false">
 <rect x="249" y="278" width="14" height="76" fill="currentColor"/>
 <path d="M256 340 L300 402 L256 486 L212 402 Z" fill="currentColor"/>
</svg>`;

export function loadingMark(): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'mark mark--loading';
  wrap.innerHTML = MARK_SVG;
  return wrap;
}

export function ghostBob(): HTMLElement {
  const wrap = document.createElement('span');
  wrap.className = 'ghostbob';
  wrap.setAttribute('aria-hidden', 'true');
  wrap.innerHTML = GHOST_SVG;
  return wrap;
}
