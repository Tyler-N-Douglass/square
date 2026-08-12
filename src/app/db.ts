/**
 * db.ts — hand-rolled IndexedDB wrapper (A8, SPEC §4.7). Zero dependencies.
 *
 * Architecture: everything above the storage primitive talks to `BackendLike`,
 * a minimal structural interface covering exactly what SQUARE uses — get /
 * put / delete / clear / getAll / index queries / count / cursor iteration
 * over named stores, opened against a versioned `SchemaSpec` with a migration
 * hook. Two implementations:
 *
 *   - `openIdbBackend`     the real IndexedDB, promise-wrapped by hand;
 *   - `openMemoryBackend`  an in-memory Map backend implementing the same
 *                          versioning + index semantics.
 *
 * The memory backend is BOTH the unit-test double AND the runtime fallback:
 * Safari private mode (and any browser with IDB disabled) throws on open, so
 * `openBackend` catches and degrades to memory. That degradation is VISIBLE
 * (SPEC §15.4): the backend reports `kind: 'memory'` and the LOG tool shows
 * "Storage is session-only in this browser mode — export before closing."
 *
 * Schema/migration/query logic is shared and pure enough to test entirely
 * against the memory backend — querying an index a schema version never
 * declared throws on both backends, so a missed migration is loud, not
 * silently empty.
 */
import type { StorageLike } from '../guidance/fading';

/* ------------------------------------------------------------------ */
/* Schema                                                              */
/* ------------------------------------------------------------------ */

export type Key = string | number;

export interface IndexSpec {
  name: string;
  /** Dot-path into the stored value, e.g. 'measurement.provenance.capturedAt'. */
  keyPath: string;
}

export interface StoreSpec {
  name: string;
  /** Dot-path key extracted from the value. Omitted = out-of-line keys (put needs an explicit key). */
  keyPath?: string;
  indexes?: IndexSpec[];
}

/**
 * The migration hook's view of the upgrade transaction — identical over both
 * backends. IDB constraint: touch only these methods inside `migrate`; any
 * `await` of non-IDB work lets the versionchange transaction commit early.
 */
export interface MigrationTx {
  getAll(store: string): Promise<unknown[]>;
  put(store: string, value: unknown, key?: Key): Promise<void>;
  delete(store: string, key: Key): Promise<void>;
}

export interface SchemaSpec {
  name: string;
  version: number;
  stores: StoreSpec[];
  /** Data migration, run once per upgrade after stores/indexes are created. */
  migrate?(tx: MigrationTx, oldVersion: number, newVersion: number): void | Promise<void>;
}

export interface IterateOpts {
  /** Iterate in this index's key order instead of primary-key order. */
  index?: string;
  direction?: 'asc' | 'desc';
}

/** The minimal structural surface every consumer codes against. */
export interface BackendLike {
  readonly kind: 'idb' | 'memory';
  get(store: string, key: Key): Promise<unknown>;
  /** Resolves once the write is durable. Returns the key written. */
  put(store: string, value: unknown, key?: Key): Promise<Key>;
  delete(store: string, key: Key): Promise<void>;
  clear(store: string): Promise<void>;
  getAll(store: string): Promise<unknown[]>;
  /** All records whose index key equals `value`; all (index order) when omitted. */
  getAllByIndex(store: string, index: string, value?: Key): Promise<unknown[]>;
  count(store: string): Promise<number>;
  /** Cursor: cb returns false to stop early. */
  iterate(store: string, cb: (value: unknown, key: Key) => boolean | void, opts?: IterateOpts): Promise<void>;
  close(): void;
}

/* ------------------------------------------------------------------ */
/* Shared pure helpers                                                 */
/* ------------------------------------------------------------------ */

/** Walk a dot-path ('measurement.id') into a value; undefined when any hop is missing. */
export function resolveKeyPath(value: unknown, keyPath: string): unknown {
  let cur: unknown = value;
  for (const part of keyPath.split('.')) {
    if (cur === null || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[part];
  }
  return cur;
}

/** IDB key ordering, restricted to the key types SQUARE uses: number < string. */
export function compareKeys(a: Key, b: Key): number {
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  if (typeof a === 'string' && typeof b === 'string') return a < b ? -1 : a > b ? 1 : 0;
  return typeof a === 'number' ? -1 : 1;
}

function validKey(k: unknown): k is Key {
  return (typeof k === 'number' && Number.isFinite(k)) || typeof k === 'string';
}

/* ------------------------------------------------------------------ */
/* Memory backend — test double AND runtime fallback                   */
/* ------------------------------------------------------------------ */

interface MemStore {
  keyPath?: string;
  /** Declared indexes: name → keyPath. Querying an undeclared one throws. */
  indexes: Map<string, string>;
  records: Map<Key, unknown>;
}

interface MemDb {
  version: number;
  stores: Map<string, MemStore>;
}

export type MemoryRegistry = Map<string, MemDb>;

/** Fresh isolated registry — tests use this; the runtime uses the module default. */
export function memoryRegistry(): MemoryRegistry {
  return new Map();
}

const defaultRegistry: MemoryRegistry = memoryRegistry();

/** Values are structured-clone isolated like real IDB; Blobs are immutable and stored as-is. */
function cloneValue(v: unknown): unknown {
  if (typeof Blob !== 'undefined' && v instanceof Blob) return v;
  try {
    return structuredClone(v);
  } catch {
    return v;
  }
}

function memStoreOf(db: MemDb, name: string): MemStore {
  const s = db.stores.get(name);
  if (s === undefined) throw new Error(`SQUARE db: no object store '${name}' (NotFoundError)`);
  return s;
}

function memPut(db: MemDb, store: string, value: unknown, key?: Key): Key {
  const s = memStoreOf(db, store);
  let k: Key;
  if (s.keyPath !== undefined) {
    if (key !== undefined) throw new Error(`SQUARE db: '${store}' has a keyPath — do not pass an explicit key (DataError)`);
    const resolved = resolveKeyPath(value, s.keyPath);
    if (!validKey(resolved)) throw new Error(`SQUARE db: value has no usable key at '${s.keyPath}' (DataError)`);
    k = resolved;
  } else {
    if (key === undefined) throw new Error(`SQUARE db: '${store}' uses out-of-line keys — pass a key (DataError)`);
    k = key;
  }
  s.records.set(k, cloneValue(value));
  return k;
}

function memMigrationTx(db: MemDb): MigrationTx {
  return {
    getAll: (store) => Promise.resolve([...memStoreOf(db, store).records.values()].map(cloneValue)),
    put: (store, value, key) => {
      memPut(db, store, value, key);
      return Promise.resolve();
    },
    delete: (store, key) => {
      memStoreOf(db, store).records.delete(key);
      return Promise.resolve();
    },
  };
}

function applyMemSchema(db: MemDb, schema: SchemaSpec): void {
  for (const spec of schema.stores) {
    let s = db.stores.get(spec.name);
    if (!s) {
      s = { indexes: new Map(), records: new Map() };
      if (spec.keyPath !== undefined) s.keyPath = spec.keyPath;
      db.stores.set(spec.name, s);
    }
    for (const idx of spec.indexes ?? []) {
      if (!s.indexes.has(idx.name)) s.indexes.set(idx.name, idx.keyPath);
    }
  }
}

/**
 * Open the memory backend with real versioning semantics: upgrades apply the
 * schema diff and run the migration hook; opening below the stored version
 * throws (VersionError), same as IDB.
 */
export async function openMemoryBackend(
  schema: SchemaSpec,
  registry: MemoryRegistry = defaultRegistry,
): Promise<BackendLike> {
  let db = registry.get(schema.name);
  if (!db) {
    db = { version: 0, stores: new Map() };
    registry.set(schema.name, db);
  }
  if (schema.version < db.version) {
    throw new Error(
      `SQUARE db: requested version ${schema.version} is below stored version ${db.version} (VersionError)`,
    );
  }
  if (schema.version > db.version) {
    const oldVersion = db.version;
    applyMemSchema(db, schema);
    if (schema.migrate) await schema.migrate(memMigrationTx(db), oldVersion, schema.version);
    db.version = schema.version;
  }
  return memBackend(db);
}

function sortedEntries(s: MemStore): Array<[Key, unknown]> {
  return [...s.records.entries()].sort((a, b) => compareKeys(a[0], b[0]));
}

/** [indexKey, primaryKey, value] triples for declared-index iteration, index order. */
function indexEntries(s: MemStore, store: string, index: string): Array<[Key, Key, unknown]> {
  const keyPath = s.indexes.get(index);
  if (keyPath === undefined) {
    throw new Error(`SQUARE db: no index '${index}' on '${store}' — declare it in the schema (NotFoundError)`);
  }
  const out: Array<[Key, Key, unknown]> = [];
  for (const [pk, v] of s.records.entries()) {
    const ik = resolveKeyPath(v, keyPath);
    if (validKey(ik)) out.push([ik, pk, v]); // records without the index key are absent from the index, like IDB
  }
  out.sort((a, b) => compareKeys(a[0], b[0]) || compareKeys(a[1], b[1]));
  return out;
}

/* Methods are async so failures are rejections, matching the IDB path. */
function memBackend(db: MemDb): BackendLike {
  return {
    kind: 'memory',
    get: async (store, key) => cloneValue(memStoreOf(db, store).records.get(key)),
    put: async (store, value, key) => memPut(db, store, value, key),
    delete: async (store, key) => {
      memStoreOf(db, store).records.delete(key);
    },
    clear: async (store) => {
      memStoreOf(db, store).records.clear();
    },
    getAll: async (store) => sortedEntries(memStoreOf(db, store)).map(([, v]) => cloneValue(v)),
    getAllByIndex: async (store, index, value) => {
      const rows = indexEntries(memStoreOf(db, store), store, index);
      const hit = value === undefined ? rows : rows.filter(([ik]) => typeof ik === typeof value && compareKeys(ik, value) === 0);
      return hit.map(([, , v]) => cloneValue(v));
    },
    count: async (store) => memStoreOf(db, store).records.size,
    iterate: async (store, cb, opts = {}) => {
      const s = memStoreOf(db, store);
      let rows: Array<[Key, unknown]>;
      if (opts.index !== undefined) {
        rows = indexEntries(s, store, opts.index).map(([, pk, v]) => [pk, v] as [Key, unknown]);
      } else {
        rows = sortedEntries(s);
      }
      if (opts.direction === 'desc') rows.reverse();
      for (const [k, v] of rows) {
        if (cb(cloneValue(v), k) === false) break;
      }
    },
    close: () => {
      /* memory backends hold no handles */
    },
  };
}

/* ------------------------------------------------------------------ */
/* IndexedDB backend                                                   */
/* ------------------------------------------------------------------ */

function req<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error ?? new Error('SQUARE db: request failed'));
  });
}

function applyIdbSchema(db: IDBDatabase, tx: IDBTransaction, schema: SchemaSpec): void {
  for (const spec of schema.stores) {
    const store = db.objectStoreNames.contains(spec.name)
      ? tx.objectStore(spec.name)
      : db.createObjectStore(spec.name, spec.keyPath !== undefined ? { keyPath: spec.keyPath } : undefined);
    for (const idx of spec.indexes ?? []) {
      if (!store.indexNames.contains(idx.name)) store.createIndex(idx.name, idx.keyPath);
    }
  }
}

function idbMigrationTx(tx: IDBTransaction): MigrationTx {
  return {
    getAll: (store) => req(tx.objectStore(store).getAll()),
    put: async (store, value, key) => {
      await req(key === undefined ? tx.objectStore(store).put(value) : tx.objectStore(store).put(value, key));
    },
    delete: (store, key) => req(tx.objectStore(store).delete(key)),
  };
}

export function openIdbBackend(schema: SchemaSpec): Promise<BackendLike> {
  return new Promise((resolve, reject) => {
    const factory = (globalThis as { indexedDB?: IDBFactory }).indexedDB;
    if (!factory) {
      reject(new Error('SQUARE db: IndexedDB is not available'));
      return;
    }
    let migrationFailure: unknown = null;
    let open: IDBOpenDBRequest;
    try {
      open = factory.open(schema.name, schema.version);
    } catch (e) {
      reject(e); // Safari private mode throws synchronously here
      return;
    }
    open.onupgradeneeded = (ev) => {
      const db = open.result;
      const tx = open.transaction;
      if (!tx) return;
      try {
        applyIdbSchema(db, tx, schema);
        const migrate = schema.migrate;
        if (migrate) {
          const p = migrate(idbMigrationTx(tx), ev.oldVersion, schema.version);
          if (p instanceof Promise) {
            p.catch((e: unknown) => {
              migrationFailure = e;
              try {
                tx.abort();
              } catch {
                /* already done */
              }
            });
          }
        }
      } catch (e) {
        migrationFailure = e;
        try {
          tx.abort();
        } catch {
          /* already done */
        }
      }
    };
    open.onsuccess = () => resolve(idbBackend(open.result));
    open.onerror = () => reject(migrationFailure ?? open.error ?? new Error('SQUARE db: open failed'));
  });
}

/** Read-only one-shot: resolve on request success. */
function read<T>(db: IDBDatabase, store: string, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return req(fn(db.transaction(store, 'readonly').objectStore(store)));
}

/** Write one-shot: resolve on transaction completion — the write is durable. */
function write<T>(db: IDBDatabase, store: string, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readwrite');
    const r = fn(tx.objectStore(store));
    let out: T;
    r.onsuccess = () => {
      out = r.result;
    };
    tx.oncomplete = () => resolve(out);
    tx.onerror = () => reject(tx.error ?? new Error('SQUARE db: write failed'));
    tx.onabort = () => reject(tx.error ?? new Error('SQUARE db: write aborted'));
  });
}

function idbBackend(db: IDBDatabase): BackendLike {
  return {
    kind: 'idb',
    get: (store, key) => read(db, store, (s) => s.get(key)),
    put: (store, value, key) =>
      write(db, store, (s) => (key === undefined ? s.put(value) : s.put(value, key))) as Promise<Key>,
    delete: async (store, key) => {
      await write(db, store, (s) => s.delete(key));
    },
    clear: async (store) => {
      await write(db, store, (s) => s.clear());
    },
    getAll: (store) => read(db, store, (s) => s.getAll()),
    getAllByIndex: (store, index, value) =>
      read(db, store, (s) => (value === undefined ? s.index(index).getAll() : s.index(index).getAll(value))),
    count: (store) => read(db, store, (s) => s.count()),
    iterate: (store, cb, opts = {}) =>
      new Promise((resolve, reject) => {
        const src = db.transaction(store, 'readonly').objectStore(store);
        const target = opts.index !== undefined ? src.index(opts.index) : src;
        const r = target.openCursor(null, opts.direction === 'desc' ? 'prev' : 'next');
        r.onsuccess = () => {
          const cur = r.result;
          if (!cur) {
            resolve();
            return;
          }
          if (cb(cur.value, cur.primaryKey as Key) === false) {
            resolve();
            return;
          }
          cur.continue();
        };
        r.onerror = () => reject(r.error ?? new Error('SQUARE db: cursor failed'));
      }),
    close: () => db.close(),
  };
}

/* ------------------------------------------------------------------ */
/* openBackend — real IDB with visible in-memory fallback              */
/* ------------------------------------------------------------------ */

/**
 * Try real IndexedDB; degrade to the session-only memory backend when the
 * browser refuses (Safari private mode throws on open). The caller can see
 * which one it got via `backend.kind` — LOG surfaces the memory case as a
 * one-line notice (SPEC §15.4: degrade visibly, never silently).
 */
export async function openBackend(schema: SchemaSpec, registry?: MemoryRegistry): Promise<BackendLike> {
  try {
    return await openIdbBackend(schema);
  } catch {
    return openMemoryBackend(schema, registry);
  }
}

/* ------------------------------------------------------------------ */
/* SQUARE's schema                                                     */
/* ------------------------------------------------------------------ */

export const DB_NAME = 'square';
export const STORE_MEASUREMENTS = 'measurements';
export const STORE_MEDIA = 'media';
export const STORE_KV = 'kv';

/**
 * v1 — first IndexedDB schema (the Phase 1 stub lived in localStorage under
 * 'square.log.v0'; logStore migrates that on first open, outside this hook).
 *   measurements  SavedEntry keyed by measurement.id, indexed by capture
 *                 time, kind, and project (entries without a project are
 *                 simply absent from that index).
 *   media         photo Blobs keyed by photo id (out-of-line).
 *   kv            guidance state + misc strings (out-of-line).
 */
export const SQUARE_SCHEMA: SchemaSpec = {
  name: DB_NAME,
  version: 1,
  stores: [
    {
      name: STORE_MEASUREMENTS,
      keyPath: 'measurement.id',
      indexes: [
        { name: 'capturedAt', keyPath: 'measurement.provenance.capturedAt' },
        { name: 'kind', keyPath: 'measurement.kind' },
        { name: 'project', keyPath: 'project' },
      ],
    },
    { name: STORE_MEDIA },
    { name: STORE_KV },
  ],
};

let shared: Promise<BackendLike> | null = null;

/** The app-wide backend, opened once. logStore and the guidance adapter share it. */
export function squareBackend(): Promise<BackendLike> {
  if (!shared) shared = openBackend(SQUARE_SCHEMA);
  return shared;
}

/** Test hook: drop the shared handle and all in-memory fallback state. */
export function __resetDbForTests(): void {
  if (shared) {
    void shared.then((b) => b.close()).catch(() => undefined);
  }
  shared = null;
  defaultRegistry.clear();
}

/* ------------------------------------------------------------------ */
/* StorageLike adapter for guidance (SPEC §7B.3)                       */
/* ------------------------------------------------------------------ */

/**
 * Synchronous StorageLike over the async kv store: a write-through cache
 * warmed once at startup. Reads are served from the cache; writes hit the
 * cache synchronously and the kv store asynchronously (fire-and-forget — a
 * lost guidance write re-shows guidance, the safe direction).
 *
 * Wiring (lead, main.ts):
 *   const guideStorage = warmedGuidanceStorage();
 *   await guideStorage.warmed;              // before the first tool mounts
 *   // pass to every FadingStore: new FadingStore(guideStorage)
 *
 * Warm-up also copies any existing localStorage 'square.guide.*' state into
 * kv (continuity from the Phase 1 localStorage-backed default). localStorage
 * is left in place as a belt-and-braces copy; kv wins once warmed.
 */
export interface WarmStorage extends StorageLike {
  /** Resolves when the cache holds everything the kv store had. */
  readonly warmed: Promise<void>;
}

const GUIDE_PREFIX = 'square.guide.';

export function warmedGuidanceStorage(backendP: Promise<BackendLike> = squareBackend()): WarmStorage {
  const cache = new Map<string, string>();
  const warmed = (async () => {
    const backend = await backendP;
    await backend.iterate(STORE_KV, (value, key) => {
      if (typeof key === 'string' && typeof value === 'string') cache.set(key, value);
    });
    // Continuity: adopt Phase 1 guidance state from localStorage, once.
    try {
      const ls = (globalThis as { localStorage?: Storage }).localStorage;
      if (ls) {
        for (let i = 0; i < ls.length; i++) {
          const k = ls.key(i);
          if (k !== null && k.startsWith(GUIDE_PREFIX) && !cache.has(k)) {
            const v = ls.getItem(k);
            if (v !== null) {
              cache.set(k, v);
              void backend.put(STORE_KV, v, k).catch(() => undefined);
            }
          }
        }
      }
    } catch {
      /* localStorage unavailable — nothing to adopt */
    }
  })();
  return {
    warmed,
    get: (key) => cache.get(key) ?? null,
    set: (key, value) => {
      cache.set(key, value);
      void backendP.then((b) => b.put(STORE_KV, value, key)).catch(() => undefined);
    },
  };
}
