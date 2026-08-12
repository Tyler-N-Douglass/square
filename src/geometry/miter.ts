/**
 * Simple + compound miter solver — SPEC §4.5.2. Frozen contract (ADR-004):
 * tests/unit/miter-canonical.test.ts calls exactly this.
 *
 * MANDATORY: derive from rotation matrices (build the wall planes at corner
 * angle C, the crown plane at spring angle S, the bisecting cut plane, express
 * the cut plane in the saw's frame), do NOT transcribe the spec's candidate
 * formulas — the candidate bevel form fails the flat-splice canonical
 * (ADR-009). Document the derivation in docs/PHYSICS.md.
 *
 * Conventions: cornerDeg C = the wall corner angle (90 = square inside
 * corner, 180 = flat splice). springDeg S = crown spring angle measured from
 * the wall. Cut laid flat on the saw table. miterDeg = table rotation from
 * square, bevelDeg = blade tilt from vertical; both reported as positive
 * magnitudes with direction handled by the saw card.
 */

export interface CompoundCut { miterDeg: number; bevelDeg: number; }

export function compoundMiter(_cornerDeg: number, _springDeg: number): CompoundCut {
  throw new Error('NOT IMPLEMENTED — A4 (Craft Math) owns this. See kit/SPEC.md §4.5.2 and ADR-009.');
}

/** Simple miter: two pieces meeting at corner angle C, split evenly. */
export function simpleMiter(_cornerDeg: number): number {
  throw new Error('NOT IMPLEMENTED — A4 (Craft Math) owns this.');
}
