/**
 * Fading schedule — SPEC §7B.3.
 * Runs 1–2 full, 3–5 reduced, 6+ silent; per-tool reset; persistence behind
 * StorageLike with a working in-memory fallback when localStorage is absent.
 */
import { describe, expect, it } from 'vitest';
import {
  FadingStore,
  defaultStorage,
  levelForRun,
  memoryStorage,
  type FadeLevel,
} from '../../src/guidance/fading';

describe('the schedule (§7B.3)', () => {
  const table: Array<[number, FadeLevel]> = [
    [1, 'full'],
    [2, 'full'],
    [3, 'reduced'],
    [4, 'reduced'],
    [5, 'reduced'],
    [6, 'silent'],
    [7, 'silent'],
    [100, 'silent'],
  ];
  for (const [run, level] of table) {
    it(`run ${run} → ${level}`, () => {
      expect(levelForRun(run)).toBe(level);
    });
  }
});

describe('FadingStore', () => {
  it('walks the schedule as runs are recorded', () => {
    const store = new FadingStore(memoryStorage());
    expect(store.level('scan')).toBe('full'); // about to do run 1
    store.recordRun('scan');
    expect(store.level('scan')).toBe('full'); // run 2
    store.recordRun('scan');
    expect(store.level('scan')).toBe('reduced'); // run 3
    store.recordRun('scan');
    store.recordRun('scan');
    store.recordRun('scan');
    expect(store.runCount('scan')).toBe(5);
    expect(store.level('scan')).toBe('silent'); // run 6
  });

  it('tracks tools independently', () => {
    const store = new FadingStore(memoryStorage());
    for (let i = 0; i < 6; i++) store.recordRun('scan');
    expect(store.level('scan')).toBe('silent');
    expect(store.level('level')).toBe('full');
  });

  it('per-tool reset restores run 1 and clears dismissals', () => {
    const store = new FadingStore(memoryStorage());
    for (let i = 0; i < 9; i++) store.recordRun('scan');
    store.dismissStep('scan', 'sweep');
    store.dismissGuide('scan');
    store.recordRun('bevel');

    store.reset('scan');
    expect(store.level('scan')).toBe('full');
    expect(store.runCount('scan')).toBe(0);
    expect(store.isStepDismissed('scan', 'sweep')).toBe(false);
    expect(store.isGuideDismissed('scan')).toBe(false);
    expect(store.runCount('bevel')).toBe(1); // reset is per-tool
  });

  it('persists through the injected StorageLike across instances', () => {
    const storage = memoryStorage();
    const a = new FadingStore(storage);
    a.recordRun('corner');
    a.recordRun('corner');
    a.dismissStep('corner', 'loupe');

    const b = new FadingStore(storage);
    expect(b.runCount('corner')).toBe(2);
    expect(b.level('corner')).toBe('reduced');
    expect(b.isStepDismissed('corner', 'loupe')).toBe(true);
  });

  it('survives corrupted storage by starting over (guidance re-shows — the safe direction)', () => {
    const storage = memoryStorage();
    storage.set('square.guide.scan', '{not json');
    const store = new FadingStore(storage);
    expect(store.level('scan')).toBe('full');
    store.recordRun('scan');
    expect(store.runCount('scan')).toBe(1);
  });
});

describe('defaultStorage', () => {
  it('falls back to working in-memory storage when localStorage is absent (node)', () => {
    const storage = defaultStorage();
    expect(storage.get('square.guide.x')).toBeNull();
    storage.set('square.guide.x', 'v');
    expect(storage.get('square.guide.x')).toBe('v');
  });
});
