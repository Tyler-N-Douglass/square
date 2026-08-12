/**
 * Guided-run engine — SPEC §7B.1 layer 3, §7B.3, §7B.5.
 *
 * Drives the real tool with live sensor data, one instruction at a time,
 * advancing on actual events — a sensor sample matching a predicate, a
 * tool-fired custom event, or the user's tap — never on a Next button.
 *
 * The engine is UI-free: rendering and sensor wiring are injected through
 * GuideDeps, so it unit-tests without a DOM and binds to A7's coach-mark
 * components in Phase 2. Invariants it enforces:
 *   - one step visible at a time (previous teardown before next render);
 *   - dismiss and skip always work, and are remembered via GuideMemory —
 *     a dismissed prompt never re-shows without an explicit reset (§7B.3);
 *   - fading filters steps by level: full / reduced (critical only) / silent.
 */
import type { FadeLevel, GuideMemory } from './fading';

export type AdvanceOn =
  | 'tap'
  | { event: 'sensor'; predicate: (sample: unknown) => boolean }
  | { event: 'custom'; name: string };

export interface GuideStep {
  id: string;
  /** Two lines maximum, verb first, one idea (§7B.5). */
  text: string;
  /** CSS selector for the control this step anchors to; omitted = free-floating. */
  anchor?: string;
  /** Steps that survive fading to 'reduced' — where people actually go wrong. */
  critical?: boolean;
  advanceOn: AdvanceOn;
}

export interface GuideSpec {
  toolId: string;
  steps: GuideStep[];
}

export interface GuideDeps {
  /**
   * Show one step (coach mark / tooltip). Call onDismiss when the user taps
   * it away. Return the teardown that removes it — the engine calls that
   * before rendering the next step, so two are never visible at once.
   */
  render(step: GuideStep, onDismiss: () => void): () => void;
  /**
   * Wire a predicate to the live sensor stream; call cb once when a sample
   * satisfies it. Return the unsubscribe.
   */
  sensorHook(predicate: (sample: unknown) => boolean, cb: () => void): () => void;
}

export type GuideOutcome = 'completed' | 'skipped' | 'stopped';

export interface GuideOptions {
  /**
   * Explicit fade level. Omitted, the level comes from memory (or 'full'
   * without memory). The "guide me" re-entry passes 'full' here — an explicit
   * request overrides a remembered guide-level dismissal, though individually
   * dismissed steps stay hidden until a per-tool reset.
   */
  level?: FadeLevel;
  /** Remembers dismissals and provides the fade level. Optional: engine runs storage-free. */
  memory?: GuideMemory;
  onEnd?(outcome: GuideOutcome): void;
}

export interface GuideHandle {
  /** Tools fire named events here ("anchor-set", "photo-taken") to advance custom steps. */
  fireCustom(name: string): void;
  /** End the whole guide now; remembered — it will not re-show without reset. */
  skip(): void;
  /** Tear down without recording anything (route change, tool unmount). */
  stop(): void;
  readonly active: boolean;
  readonly step: GuideStep | null;
}

/** Fading filter — exported for tests and for tools that preview their guides. */
export function stepsForLevel(steps: GuideStep[], level: FadeLevel): GuideStep[] {
  if (level === 'silent') return [];
  if (level === 'reduced') return steps.filter((s) => s.critical === true);
  return [...steps];
}

export function runGuide(spec: GuideSpec, deps: GuideDeps, opts: GuideOptions = {}): GuideHandle {
  const memory = opts.memory;
  const explicitLevel = opts.level;
  const level = explicitLevel ?? memory?.level(spec.toolId) ?? 'full';

  let queue: GuideStep[];
  if (explicitLevel === undefined && memory?.isGuideDismissed(spec.toolId)) {
    queue = []; // dismissed guides stay silent unless explicitly re-requested
  } else {
    queue = stepsForLevel(spec.steps, level).filter(
      (s) => !memory?.isStepDismissed(spec.toolId, s.id),
    );
  }

  let active = true;
  let current: GuideStep | null = null;
  let currentAdvance: (() => void) | null = null;
  let teardownRender: (() => void) | null = null;
  let teardownHook: (() => void) | null = null;

  const clear = (): void => {
    const hook = teardownHook;
    const render = teardownRender;
    teardownHook = null;
    teardownRender = null;
    current = null;
    currentAdvance = null;
    hook?.();
    render?.();
  };

  const end = (outcome: GuideOutcome): void => {
    if (!active) return;
    active = false;
    clear();
    opts.onEnd?.(outcome);
  };

  const show = (i: number): void => {
    if (!active) return;
    if (i >= queue.length) {
      end('completed');
      return;
    }
    const step = queue[i]!;
    current = step;
    let advanced = false;

    const advance = (): void => {
      if (advanced || !active) return;
      advanced = true;
      clear();
      show(i + 1);
    };
    currentAdvance = advance;

    const on = step.advanceOn;
    if (on === 'tap') {
      // Tapping IS the advance for informational steps — normal flow, not a
      // remembered dismissal.
      teardownRender = deps.render(step, advance);
    } else {
      // Event-advanced steps: the event advances; a tap dismisses the prompt,
      // which advances past it AND is remembered (§7B.3 — never re-show a
      // dismissed prompt without an explicit reset).
      const dismiss = (): void => {
        if (advanced || !active) return;
        memory?.dismissStep(spec.toolId, step.id);
        advance();
      };
      if (on.event === 'sensor') {
        teardownHook = deps.sensorHook(on.predicate, advance);
      }
      teardownRender = deps.render(step, dismiss);
    }
  };

  const handle: GuideHandle = {
    fireCustom(name: string): void {
      if (!active || current === null) return;
      const on = current.advanceOn;
      if (typeof on === 'object' && on.event === 'custom' && on.name === name) {
        currentAdvance?.();
      }
    },
    skip(): void {
      if (!active) return;
      memory?.dismissGuide(spec.toolId);
      end('skipped');
    },
    stop(): void {
      end('stopped');
    },
    get active(): boolean {
      return active;
    },
    get step(): GuideStep | null {
      return current;
    },
  };

  show(0);
  return handle;
}
