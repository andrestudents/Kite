// T023 — the device-local KV seam (data-model §2.3): demo vault JSON + the
// persona marker live in IndexedDB. ONE tiny promise wrapper; tests use the
// in-memory twin. Nothing secret is ever stored here in PLAINTEXT — the vault
// JSON is ciphertext by construction (FR-011).
export interface KvStore {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  remove(key: string): Promise<void>;
}

export function makeIdbKv(dbName: string, storeName: string): KvStore {
  let dbPromise: Promise<IDBDatabase> | null = null;

  function open(): Promise<IDBDatabase> {
    if (!dbPromise) {
      dbPromise = new Promise((resolve, reject) => {
        const req = indexedDB.open(dbName, 1);
        req.onupgradeneeded = () => {
          if (req.result.objectStoreNames.contains(storeName) === false) {
            req.result.createObjectStore(storeName);
          }
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error ?? new Error("indexedDB unavailable"));
      });
    }
    return dbPromise;
  }

  function tx<T>(
    mode: IDBTransactionMode,
    run: (store: IDBObjectStore) => IDBRequest<T>,
  ): Promise<T> {
    return open().then(
      (db) =>
        new Promise<T>((resolve, reject) => {
          const transaction = db.transaction(storeName, mode);
          const request = run(transaction.objectStore(storeName));
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error ?? new Error("indexedDB request failed"));
        }),
    );
  }

  return {
    get: (key) => tx("readonly", (s) => s.get(key) as IDBRequest<string | null>),
    set: (key, value) =>
      tx("readwrite", (s) => s.put(value, key) as IDBRequest<unknown>).then(() => undefined),
    remove: (key) =>
      tx("readwrite", (s) => s.delete(key) as IDBRequest<unknown>).then(() => undefined),
  };
}

/** The test twin — same surface, no browser. */
export function makeMemoryKv(): KvStore {
  const map = new Map<string, string>();
  return {
    get: async (key) => map.get(key) ?? null,
    set: async (key, value) => {
      map.set(key, value);
    },
    remove: async (key) => {
      map.delete(key);
    },
  };
}
