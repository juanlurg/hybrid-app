/**
 * Minimal promise wrapper over IndexedDB, behind an interface the tests
 * can satisfy with a Map. Four stores, keyed by string:
 *
 *   snapshot      — one record, the serialized AthleteContext
 *   queue         — QueueOp by opKey
 *   localSessions — LocalSessionState by localSessionId
 *   meta          — deviceId, lastFlushAt, …
 */

export const OFFLINE_DB_NAME = "bloques-offline";
export const OFFLINE_DB_VERSION = 1;

export const STORE_NAMES = [
  "snapshot",
  "queue",
  "localSessions",
  "meta",
] as const;

export type StoreName = (typeof STORE_NAMES)[number];

export interface OfflineStore {
  get<T>(store: StoreName, key: string): Promise<T | undefined>;
  getAll<T>(store: StoreName): Promise<Array<{ key: string; value: T }>>;
  put(store: StoreName, key: string, value: unknown): Promise<void>;
  delete(store: StoreName, key: string): Promise<void>;
  clear(store: StoreName): Promise<void>;
}

/* ── IndexedDB adapter (browser) ─────────────────────────────── */

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(OFFLINE_DB_NAME, OFFLINE_DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const name of STORE_NAMES) {
        if (!db.objectStoreNames.contains(name)) db.createObjectStore(name);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function tx<T>(
  db: IDBDatabase,
  store: StoreName,
  mode: IDBTransactionMode,
  run: (s: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const req = run(db.transaction(store, mode).objectStore(store));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

let dbPromise: Promise<IDBDatabase> | null = null;

/** The real store. Reuses one connection for the tab's lifetime. */
export function openOfflineStore(): OfflineStore {
  const db = () => (dbPromise ??= openDb());
  return {
    async get<T>(store: StoreName, key: string) {
      return tx<T | undefined>(await db(), store, "readonly", (s) =>
        s.get(key),
      );
    },
    async getAll<T>(store: StoreName) {
      const d = await db();
      const [keys, values] = await Promise.all([
        tx<IDBValidKey[]>(d, store, "readonly", (s) => s.getAllKeys()),
        tx<T[]>(d, store, "readonly", (s) => s.getAll()),
      ]);
      return keys.map((key, i) => ({ key: String(key), value: values[i] }));
    },
    async put(store, key, value) {
      await tx(await db(), store, "readwrite", (s) => s.put(value, key));
    },
    async delete(store, key) {
      await tx(await db(), store, "readwrite", (s) => s.delete(key));
    },
    async clear(store) {
      await tx(await db(), store, "readwrite", (s) => s.clear());
    },
  };
}

/** Everything gone — logout, or a snapshot for another user. */
export async function wipeOfflineData(store: OfflineStore): Promise<void> {
  for (const name of STORE_NAMES) await store.clear(name);
}

/* ── in-memory adapter (tests, SSR guards) ───────────────────── */

export function memoryStore(): OfflineStore {
  const data = new Map<StoreName, Map<string, unknown>>(
    STORE_NAMES.map((n) => [n, new Map()]),
  );
  return {
    async get<T>(store: StoreName, key: string) {
      return data.get(store)!.get(key) as T | undefined;
    },
    async getAll<T>(store: StoreName) {
      return [...data.get(store)!.entries()].map(([key, value]) => ({
        key,
        value: value as T,
      }));
    },
    async put(store, key, value) {
      data.get(store)!.set(key, value);
    },
    async delete(store, key) {
      data.get(store)!.delete(key);
    },
    async clear(store) {
      data.get(store)!.clear();
    },
  };
}
