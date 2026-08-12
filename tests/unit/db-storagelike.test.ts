/**
 * The guidance StorageLike adapter (SPEC §7B.3, guidance-notes.md): a
 * synchronous write-through cache over the async kv store, warmed once at
 * startup. FadingStore swaps onto it without the engine changing — the exact
 * seam docs/guidance-notes.md promised for Phase 2.
 */
import { afterEach, describe, expect, it } from 'vitest';
import {
  openMemoryBackend,
  memoryRegistry,
  warmedGuidanceStorage,
  SQUARE_SCHEMA,
  STORE_KV,
  __resetDbForTests,
} from '../../src/app/db';
import { FadingStore } from '../../src/guidance/fading';

function backend() {
  return openMemoryBackend(SQUARE_SCHEMA, memoryRegistry());
}

afterEach(() => {
  __resetDbForTests();
  delete (globalThis as { localStorage?: unknown }).localStorage;
});

describe('warmedGuidanceStorage', () => {
  it('serves synchronous reads from the warmed cache', async () => {
    const bp = backend();
    const b = await bp;
    await b.put(STORE_KV, '{"runs":3}', 'square.guide.scan');
    const s = warmedGuidanceStorage(bp);
    expect(s.get('square.guide.scan')).toBeNull(); // pre-warm: cache empty, honestly
    await s.warmed;
    expect(s.get('square.guide.scan')).toBe('{"runs":3}');
    expect(s.get('missing')).toBeNull();
  });

  it('writes through: cache synchronously, kv store asynchronously', async () => {
    const bp = backend();
    const s = warmedGuidanceStorage(bp);
    await s.warmed;
    s.set('square.guide.log', '{"runs":1}');
    expect(s.get('square.guide.log')).toBe('{"runs":1}'); // sync read-your-write
    await new Promise((r) => setTimeout(r, 0));
    expect(await (await bp).get(STORE_KV, 'square.guide.log')).toBe('{"runs":1}'); // durable
  });

  it('adopts Phase 1 localStorage guidance state on warm-up (kv wins when both exist)', async () => {
    const m = new Map<string, string>([
      ['square.guide.level', '{"runs":5}'],
      ['square.guide.scan', '{"runs":9}'],
      ['unrelated.key', 'ignored'],
    ]);
    (globalThis as { localStorage?: unknown }).localStorage = {
      getItem: (k: string) => m.get(k) ?? null,
      setItem: (k: string, v: string) => void m.set(k, v),
      removeItem: (k: string) => void m.delete(k),
      key: (i: number) => [...m.keys()][i] ?? null,
      get length() {
        return m.size;
      },
    };
    const bp = backend();
    await (await bp).put(STORE_KV, '{"runs":2}', 'square.guide.scan'); // kv already has scan
    const s = warmedGuidanceStorage(bp);
    await s.warmed;
    expect(s.get('square.guide.level')).toBe('{"runs":5}'); // adopted
    expect(s.get('square.guide.scan')).toBe('{"runs":2}'); // kv precedence
    expect(s.get('unrelated.key')).toBeNull(); // only guide keys adopted
    await new Promise((r) => setTimeout(r, 0));
    expect(await (await bp).get(STORE_KV, 'square.guide.level')).toBe('{"runs":5}'); // copied into kv
  });

  it('drives FadingStore end to end — run counts and dismissals persist to kv', async () => {
    const bp = backend();
    const s = warmedGuidanceStorage(bp);
    await s.warmed;
    const memory = new FadingStore(s);
    expect(memory.level('log')).toBe('full');
    memory.recordRun('log');
    memory.recordRun('log');
    memory.dismissStep('log', 'export');
    expect(memory.level('log')).toBe('reduced'); // 2 completed runs → run 3 is reduced
    expect(memory.isStepDismissed('log', 'export')).toBe(true);
    await new Promise((r) => setTimeout(r, 0));

    // a fresh adapter over the same backend sees the same state — persistence, not cache luck
    const s2 = warmedGuidanceStorage(bp);
    await s2.warmed;
    const memory2 = new FadingStore(s2);
    expect(memory2.runCount('log')).toBe(2);
    expect(memory2.isStepDismissed('log', 'export')).toBe(true);
  });
});
