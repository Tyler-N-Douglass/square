/**
 * Guidance fading — SPEC §7B.3.
 *
 * Prompts fade on a per-tool schedule:
 *   runs 1–2   'full'     every step, one control highlighted at a time
 *   runs 3–5   'reduced'  only steps flagged critical (where people go wrong)
 *   runs 6+    'silent'   no prompts; a persistent "guide me" affordance re-enters
 * Per-tool reset restores run 1. Never re-show a dismissed prompt without an
 * explicit reset — dismissals are remembered here too.
 *
 * Persistence sits behind StorageLike (get/set string). The default is a
 * localStorage wrapper with an in-memory fallback; the IndexedDB-backed
 * implementation swaps in with A8 in Phase 2 without touching the engine.
 */

export interface StorageLike {
  get(key: string): string | null;
  set(key: string, value: string): void;
}

export type FadeLevel = 'full' | 'reduced' | 'silent';

/** The schedule. `runNumber` is 1-based: the run about to happen. */
export function levelForRun(runNumber: number): FadeLevel {
  if (runNumber <= 2) return 'full';
  if (runNumber <= 5) return 'reduced';
  return 'silent';
}

/**
 * What the tour engine needs to remember. FadingStore is the shipped
 * implementation; tests substitute their own.
 */
export interface GuideMemory {
  /** Fade level for the run about to happen (completed runs + 1 through the schedule). */
  level(toolId: string): FadeLevel;
  /** Completed runs recorded for a tool. */
  runCount(toolId: string): number;
  /** Record one completed run of the tool (the tool calls this, not the engine). */
  recordRun(toolId: string): void;
  isStepDismissed(toolId: string, stepId: string): boolean;
  dismissStep(toolId: string, stepId: string): void;
  isGuideDismissed(toolId: string): boolean;
  dismissGuide(toolId: string): void;
  /** Per-tool reset: run count, step dismissals, and guide dismissal all clear. */
  reset(toolId: string): void;
}

const KEY_PREFIX = 'square.guide.';

interface ToolRecord {
  runs: number;
  dismissedSteps: string[];
  guideDismissed: boolean;
}

const EMPTY: ToolRecord = { runs: 0, dismissedSteps: [], guideDismissed: false };

export class FadingStore implements GuideMemory {
  constructor(private readonly storage: StorageLike = defaultStorage()) {}

  private read(toolId: string): ToolRecord {
    const raw = this.storage.get(KEY_PREFIX + toolId);
    if (raw === null) return { ...EMPTY, dismissedSteps: [] };
    try {
      const parsed = JSON.parse(raw) as Partial<ToolRecord>;
      return {
        runs: typeof parsed.runs === 'number' && parsed.runs >= 0 ? parsed.runs : 0,
        dismissedSteps: Array.isArray(parsed.dismissedSteps)
          ? parsed.dismissedSteps.filter((s): s is string => typeof s === 'string')
          : [],
        guideDismissed: parsed.guideDismissed === true,
      };
    } catch {
      return { ...EMPTY, dismissedSteps: [] };
    }
  }

  private write(toolId: string, rec: ToolRecord): void {
    this.storage.set(KEY_PREFIX + toolId, JSON.stringify(rec));
  }

  level(toolId: string): FadeLevel {
    return levelForRun(this.read(toolId).runs + 1);
  }

  runCount(toolId: string): number {
    return this.read(toolId).runs;
  }

  recordRun(toolId: string): void {
    const rec = this.read(toolId);
    rec.runs += 1;
    this.write(toolId, rec);
  }

  isStepDismissed(toolId: string, stepId: string): boolean {
    return this.read(toolId).dismissedSteps.includes(stepId);
  }

  dismissStep(toolId: string, stepId: string): void {
    const rec = this.read(toolId);
    if (!rec.dismissedSteps.includes(stepId)) {
      rec.dismissedSteps.push(stepId);
      this.write(toolId, rec);
    }
  }

  isGuideDismissed(toolId: string): boolean {
    return this.read(toolId).guideDismissed;
  }

  dismissGuide(toolId: string): void {
    const rec = this.read(toolId);
    rec.guideDismissed = true;
    this.write(toolId, rec);
  }

  reset(toolId: string): void {
    this.write(toolId, { ...EMPTY, dismissedSteps: [] });
  }
}

/** In-memory StorageLike — the fallback, and what tests use directly. */
export function memoryStorage(): StorageLike {
  const m = new Map<string, string>();
  return {
    get: (k) => m.get(k) ?? null,
    set: (k, v) => void m.set(k, v),
  };
}

/**
 * localStorage when it exists and works (private-mode Safari throws on write),
 * in-memory otherwise. Guidance state is a convenience, not a measurement —
 * losing it degrades to showing guidance again, which is the safe direction.
 */
export function defaultStorage(): StorageLike {
  try {
    const ls = (globalThis as { localStorage?: Storage }).localStorage;
    if (ls) {
      const probe = KEY_PREFIX + 'probe';
      ls.setItem(probe, '1');
      ls.removeItem(probe);
      return {
        get: (k) => ls.getItem(k),
        set: (k, v) => {
          try {
            ls.setItem(k, v);
          } catch {
            /* quota or revoked access — persistence degrades, guidance re-shows */
          }
        },
      };
    }
  } catch {
    /* fall through to memory */
  }
  return memoryStorage();
}
