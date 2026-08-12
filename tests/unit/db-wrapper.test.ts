/**
 * The hand-rolled IndexedDB wrapper (src/app/db.ts), exercised over the
 * in-memory backend — which is both the unit-test double and the visible
 * runtime fallback for browsers that refuse IndexedDB (SPEC §4.7, §15.4).
 * Schema, migration, index, and cursor semantics are shared with the real
 * IDB path; these tests pin them.
 */
import { describe, expect, it } from 'vitest';
import {
  compareKeys,
  memoryRegistry,
  openBackend,
  openIdbBackend,
  openMemoryBackend,
  resolveKeyPath,
  type BackendLike,
  type SchemaSpec,
} from '../../src/app/db';

interface Rec {
  id: string;
  kind: string;
  at: number;
  project?: string;
}

const V1: SchemaSpec = {
  name: 'test-db',
  version: 1,
  stores: [
    { name: 'recs', keyPath: 'id', indexes: [{ name: 'at', keyPath: 'at' }] },
    { name: 'kv' },
  ],
};

const rec = (id: string, kind: string, at: number, project?: string): Rec =>
  project === undefined ? { id, kind, at } : { id, kind, at, project };

async function freshV1(): Promise<BackendLike> {
  return openMemoryBackend(V1, memoryRegistry());
}

describe('resolveKeyPath / compareKeys', () => {
  it('walks dot-paths and returns undefined for missing hops', () => {
    expect(resolveKeyPath({ a: { b: { c: 7 } } }, 'a.b.c')).toBe(7);
    expect(resolveKeyPath({ a: {} }, 'a.b.c')).toBeUndefined();
    expect(resolveKeyPath(null, 'a')).toBeUndefined();
    expect(resolveKeyPath({ a: 1 }, 'a.b')).toBeUndefined();
  });

  it('orders numbers before strings, like IDB key order', () => {
    expect(compareKeys(1, 2)).toBeLessThan(0);
    expect(compareKeys('b', 'a')).toBeGreaterThan(0);
    expect(compareKeys(999, 'a')).toBeLessThan(0);
    expect(compareKeys('a', 999)).toBeGreaterThan(0);
    expect(compareKeys('x', 'x')).toBe(0);
  });
});

describe('memory backend CRUD', () => {
  it('put/get/delete round-trips with in-line keys', async () => {
    const b = await freshV1();
    await b.put('recs', rec('m1', 'level', 10));
    expect((await b.get('recs', 'm1')) as Rec).toEqual(rec('m1', 'level', 10));
    await b.delete('recs', 'm1');
    expect(await b.get('recs', 'm1')).toBeUndefined();
  });

  it('put with a keyPath extracts (possibly nested) keys and rejects explicit ones', async () => {
    const nested: SchemaSpec = {
      name: 'nested',
      version: 1,
      stores: [{ name: 's', keyPath: 'a.b' }],
    };
    const b = await openMemoryBackend(nested, memoryRegistry());
    expect(await b.put('s', { a: { b: 'k1' }, v: 1 })).toBe('k1');
    await expect(b.put('s', { a: { b: 'k1' } }, 'explicit')).rejects.toThrow(/keyPath/);
    await expect(b.put('s', { a: {} })).rejects.toThrow(/no usable key/);
  });

  it('out-of-line stores require an explicit key', async () => {
    const b = await freshV1();
    await b.put('kv', 'hello', 'greeting');
    expect(await b.get('kv', 'greeting')).toBe('hello');
    await expect(b.put('kv', 'orphan')).rejects.toThrow(/out-of-line/);
  });

  it('put overwrites the same key (upsert), count and clear behave', async () => {
    const b = await freshV1();
    await b.put('recs', rec('m1', 'level', 10));
    await b.put('recs', rec('m1', 'plumb', 11));
    expect(await b.count('recs')).toBe(1);
    expect(((await b.get('recs', 'm1')) as Rec).kind).toBe('plumb');
    await b.clear('recs');
    expect(await b.count('recs')).toBe(0);
  });

  it('getAll returns primary-key order regardless of insertion order', async () => {
    const b = await freshV1();
    await b.put('recs', rec('m2', 'level', 20));
    await b.put('recs', rec('m1', 'level', 10));
    expect(((await b.getAll('recs')) as Rec[]).map((r) => r.id)).toEqual(['m1', 'm2']);
  });

  it('stored values are isolated from caller mutation (structured-clone semantics)', async () => {
    const b = await freshV1();
    const mine = rec('m1', 'level', 10);
    await b.put('recs', mine);
    mine.kind = 'MUTATED';
    expect(((await b.get('recs', 'm1')) as Rec).kind).toBe('level');
    const out = (await b.get('recs', 'm1')) as Rec;
    out.kind = 'ALSO-MUTATED';
    expect(((await b.get('recs', 'm1')) as Rec).kind).toBe('level');
  });

  it('touching an unknown store throws (NotFoundError semantics)', async () => {
    const b = await freshV1();
    await expect(b.getAll('nope')).rejects.toThrow(/no object store/);
  });
});

describe('memory backend indexes', () => {
  it('getAllByIndex filters by index key and sorts by it', async () => {
    const b = await freshV1();
    await b.put('recs', rec('m1', 'level', 30));
    await b.put('recs', rec('m2', 'angle', 10));
    await b.put('recs', rec('m3', 'level', 20));
    expect(((await b.getAllByIndex('recs', 'at')) as Rec[]).map((r) => r.at)).toEqual([10, 20, 30]);
    expect(((await b.getAllByIndex('recs', 'at', 20)) as Rec[]).map((r) => r.id)).toEqual(['m3']);
  });

  it('records without the index keyPath are absent from the index, like IDB', async () => {
    const v2 = structuredClone(V1);
    v2.stores[0]!.indexes!.push({ name: 'project', keyPath: 'project' });
    v2.version = 2;
    const b = await openMemoryBackend(v2, memoryRegistry());
    await b.put('recs', rec('m1', 'level', 1, 'kitchen'));
    await b.put('recs', rec('m2', 'level', 2)); // no project
    expect(((await b.getAllByIndex('recs', 'project')) as Rec[]).map((r) => r.id)).toEqual(['m1']);
  });

  it('querying an undeclared index throws — a missed migration is loud', async () => {
    const b = await freshV1();
    await expect(b.getAllByIndex('recs', 'project')).rejects.toThrow(/no index 'project'/);
  });
});

describe('memory backend cursor iteration', () => {
  it('iterates in key order, supports desc, and stops early on false', async () => {
    const b = await freshV1();
    await b.put('recs', rec('m3', 'level', 30));
    await b.put('recs', rec('m1', 'level', 10));
    await b.put('recs', rec('m2', 'level', 20));

    const asc: string[] = [];
    await b.iterate('recs', (_v, k) => {
      asc.push(String(k));
    });
    expect(asc).toEqual(['m1', 'm2', 'm3']);

    const desc: string[] = [];
    await b.iterate('recs', (_v, k) => {
      desc.push(String(k));
    }, { direction: 'desc' });
    expect(desc).toEqual(['m3', 'm2', 'm1']);

    const twoOnly: string[] = [];
    await b.iterate('recs', (_v, k) => {
      twoOnly.push(String(k));
      return twoOnly.length < 2;
    });
    expect(twoOnly).toEqual(['m1', 'm2']);
  });

  it('iterates in index order when opts.index is given', async () => {
    const b = await freshV1();
    await b.put('recs', rec('a', 'level', 300));
    await b.put('recs', rec('b', 'level', 100));
    await b.put('recs', rec('c', 'level', 200));
    const byAt: number[] = [];
    await b.iterate('recs', (v) => {
      byAt.push((v as Rec).at);
    }, { index: 'at' });
    expect(byAt).toEqual([100, 200, 300]);
  });
});

describe('migration path (v1 → v2 adds an index) — same versioning semantics as IDB', () => {
  const V2: SchemaSpec = {
    name: 'test-db',
    version: 2,
    stores: [
      {
        name: 'recs',
        keyPath: 'id',
        indexes: [
          { name: 'at', keyPath: 'at' },
          { name: 'kind', keyPath: 'kind' }, // added in v2
        ],
      },
      { name: 'kv' },
    ],
  };

  it('preserves data across the upgrade and makes the new index queryable', async () => {
    const reg = memoryRegistry();
    const b1 = await openMemoryBackend(V1, reg);
    await b1.put('recs', rec('m1', 'level', 10));
    await b1.put('recs', rec('m2', 'angle', 20));
    await expect(b1.getAllByIndex('recs', 'kind')).rejects.toThrow(/no index/); // not yet declared
    b1.close();

    const b2 = await openMemoryBackend(V2, reg);
    expect(await b2.count('recs')).toBe(2); // nothing lost in the upgrade
    expect(((await b2.getAllByIndex('recs', 'kind', 'angle')) as Rec[]).map((r) => r.id)).toEqual(['m2']);
  });

  it('runs the migrate hook exactly on upgrade, with old and new versions', async () => {
    const reg = memoryRegistry();
    const b1 = await openMemoryBackend(V1, reg);
    await b1.put('recs', { id: 'm1', kind: 'level', at: 10, legacy: true });

    const calls: Array<[number, number]> = [];
    const withHook: SchemaSpec = {
      ...V2,
      migrate: async (tx, oldV, newV) => {
        calls.push([oldV, newV]);
        // data migration: rewrite records through the tx surface
        for (const v of await tx.getAll('recs')) {
          const r = v as Rec & { legacy?: boolean };
          delete r.legacy;
          await tx.put('recs', r);
        }
      },
    };
    const b2 = await openMemoryBackend(withHook, reg);
    expect(calls).toEqual([[1, 2]]);
    expect((await b2.get('recs', 'm1')) as Rec).toEqual(rec('m1', 'level', 10));

    // reopening at the same version does not re-run the hook
    await openMemoryBackend(withHook, reg);
    expect(calls).toEqual([[1, 2]]);
  });

  it('refuses to open below the stored version (VersionError semantics)', async () => {
    const reg = memoryRegistry();
    await openMemoryBackend(V2, reg);
    await expect(openMemoryBackend(V1, reg)).rejects.toThrow(/VersionError/);
  });
});

describe('openBackend fallback — degrade visibly, never silently (SPEC §15.4)', () => {
  it('falls back to the memory backend when IndexedDB is missing entirely', async () => {
    // node has no indexedDB global — exactly the fallback environment
    expect((globalThis as { indexedDB?: unknown }).indexedDB).toBeUndefined();
    const b = await openBackend(V1, memoryRegistry());
    expect(b.kind).toBe('memory');
    await b.put('kv', 'still works', 'k');
    expect(await b.get('kv', 'k')).toBe('still works');
  });

  it('falls back when open() throws synchronously (Safari private mode)', async () => {
    const g = globalThis as { indexedDB?: unknown };
    g.indexedDB = {
      open: () => {
        throw new Error('The user denied permission to access the database.');
      },
    };
    try {
      const b = await openBackend(V1, memoryRegistry());
      expect(b.kind).toBe('memory');
    } finally {
      delete g.indexedDB;
    }
  });

  it('openIdbBackend itself rejects rather than faking success', async () => {
    await expect(openIdbBackend(V1)).rejects.toThrow(/not available/);
  });
});
