/**
 * CORNER marking state machine — pure, DOM-free (tested in
 * tests/unit/corner-state.test.ts). Enforces the angleSolver quad contract by
 * UI flow (SPEC §4.3, ADR-004): the user marks the corner first (P0), then
 * the adjacent corner along one edge (P1), then the diagonal corner (P2),
 * then the adjacent corner along the other edge (P3). Points are labeled,
 * re-editable by drag, and undo removes the most recent point (§7B.9).
 */
import type { Px } from '../../geometry/angleSolver';

export interface MarkStep {
  key: 'P0' | 'P1' | 'P2' | 'P3';
  label: string;
  /** Verb-first prompt, §7B.10 voice. */
  prompt: string;
}

/** The enforced order. P0P1 and P0P3 are the two edge families. */
export const MARK_STEPS: readonly [MarkStep, MarkStep, MarkStep, MarkStep] = [
  { key: 'P0', label: 'CORNER', prompt: 'Mark the corner you are measuring — the exact meeting point.' },
  { key: 'P1', label: 'EDGE 1', prompt: 'Mark the far end of one edge — as far along it as the photo shows.' },
  { key: 'P2', label: 'DIAGONAL', prompt: 'Mark the corner diagonal from the first — across the opening.' },
  { key: 'P3', label: 'EDGE 2', prompt: 'Mark the far end of the other edge.' },
];

export interface MarkPoint extends Px {
  /** True once the point has been drag-refined (loupe credit in sigma). */
  refined: boolean;
}

export class MarkingSession {
  private pts: MarkPoint[] = [];

  constructor(
    readonly imageW: number,
    readonly imageH: number,
  ) {}

  get points(): readonly MarkPoint[] {
    return this.pts;
  }

  get count(): number {
    return this.pts.length;
  }

  get complete(): boolean {
    return this.pts.length === 4;
  }

  /** The step about to be placed, or null when all four are down. */
  get nextStep(): MarkStep | null {
    return this.complete ? null : MARK_STEPS[this.pts.length as 0 | 1 | 2 | 3];
  }

  private clampX(x: number): number {
    return Math.min(Math.max(x, 0), this.imageW);
  }

  private clampY(y: number): number {
    return Math.min(Math.max(y, 0), this.imageH);
  }

  /**
   * Place the next point in order. Returns the index placed, or null when
   * the quad is already complete (placing a fifth point is not a thing —
   * drag an existing point instead).
   */
  place(x: number, y: number): number | null {
    if (this.complete) return null;
    this.pts.push({ x: this.clampX(x), y: this.clampY(y), refined: false });
    return this.pts.length - 1;
  }

  /**
   * Index of the placed point within grabRadius of (x, y), nearest first —
   * the handle for drag-to-refine. Null when nothing is close enough.
   */
  hit(x: number, y: number, grabRadius: number): number | null {
    let best: number | null = null;
    let bestD = grabRadius;
    for (let i = 0; i < this.pts.length; i++) {
      const p = this.pts[i]!;
      const d = Math.hypot(p.x - x, p.y - y);
      if (d <= bestD) {
        bestD = d;
        best = i;
      }
    }
    return best;
  }

  /** Move a placed point (drag refine). Clamped to the image. */
  moveTo(index: number, x: number, y: number): boolean {
    const p = this.pts[index];
    if (!p) return false;
    p.x = this.clampX(x);
    p.y = this.clampY(y);
    p.refined = true;
    return true;
  }

  /** Set a point exactly (snap assist). Does not mark it refined. */
  setPoint(index: number, x: number, y: number): boolean {
    const p = this.pts[index];
    if (!p) return false;
    p.x = this.clampX(x);
    p.y = this.clampY(y);
    return true;
  }

  /** Undo the most recent placement (SPEC §7B.9). */
  undo(): boolean {
    if (this.pts.length === 0) return false;
    this.pts.pop();
    return true;
  }

  reset(): void {
    this.pts = [];
  }

  /** True when every point has been drag-refined under the loupe. */
  get allRefined(): boolean {
    return this.pts.length > 0 && this.pts.every((p) => p.refined);
  }

  /** The solver quad in contract order, or null before completion. */
  quad(): [Px, Px, Px, Px] | null {
    if (!this.complete) return null;
    return this.pts.map((p) => ({ x: p.x, y: p.y })) as [Px, Px, Px, Px];
  }
}
