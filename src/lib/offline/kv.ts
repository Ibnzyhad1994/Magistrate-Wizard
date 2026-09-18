/**
 * Minimal async key/value store over IndexedDB, for the offline slices
 * that outgrew `localStorage`.
 *
 * Why not keep using device-storage: `saveDeviceJson` re-serialises the
 * whole multi-profile object on every write, synchronously, on the main
 * thread. That was tolerable while the only queued thing was a hearing.
 * It is not once a sitting's board rows are cached — a JSON.stringify of
 * a few hundred kilobytes inside a cell-tap handler is a visible stall on
 * a mid-range Android. IndexedDB is async, is not capped at the ~5 MB
 * `localStorage` budget, and lets each slice be written on its own.
 *
 * Deliberately tiny: no schema migrations, no indexes, one object store
 * of opaque JSON values. Anything richer belongs in Postgres, not here.
 */

const DB_NAME = "magistrate-wizard-offline";
const DB_VERSION = 1;
const STORE = "kv";

export type KvAdapter = {
  get: <T>(key: string) => Promise<T | null>;
  set: (key: string, value: unknown) => Promise<void>;
  remove: (key: string) => Promise<void>;
  /** Every key currently held, used to find per-profile slices. */
  keys: () => Promise<string[]>;
};

type IdbFactory = {
  open: (name: string, version?: number) => IDBOpenDBRequest;
};

const promisify = <T>(request: IDBRequest<T>): Promise<T> =>
  new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });

const openDatabase = (factory: IdbFactory): Promise<IDBDatabase> =>
  new Promise((resolve, reject) => {
    const request = factory.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    // Firefox in permanent private browsing resolves neither callback.
    request.onblocked = () => reject(new Error("IndexedDB open was blocked"));
  });

/**
 * Resolves to `null` — never throws — when IndexedDB is unavailable or
 * refuses to open: some Android WebView configurations, Firefox private
 * browsing, and blocked site data all land here. Callers fall back to the
 * previous `localStorage` path rather than losing the feature.
 *
 * `factory` is injectable so a plain Node test can drive this without
 * pulling in a fake-IndexedDB dependency, which the test scripts (plain
 * Node, no extra deps) deliberately avoid.
 */
export const openKv = async (
  factory: IdbFactory | undefined = typeof indexedDB === "undefined" ? undefined : indexedDB,
): Promise<KvAdapter | null> => {
  if (!factory) return null;
  let db: IDBDatabase;
  try {
    db = await openDatabase(factory);
  } catch {
    return null;
  }

  const tx = <T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>) =>
    new Promise<T>((resolve, reject) => {
      let request: IDBRequest<T>;
      try {
        request = run(db.transaction(STORE, mode).objectStore(STORE));
      } catch (error) {
        reject(error instanceof Error ? error : new Error(String(error)));
        return;
      }
      promisify(request).then(resolve, reject);
    });

  return {
    get: <T>(key: string) =>
      tx<T | undefined>("readonly", (store) => store.get(key) as IDBRequest<T | undefined>).then(
        (value) => value ?? null,
      ),
    set: (key, value) =>
      tx("readwrite", (store) => store.put(value, key) as IDBRequest<IDBValidKey>).then(
        () => undefined,
      ),
    remove: (key) =>
      tx("readwrite", (store) => store.delete(key) as IDBRequest<undefined>).then(() => undefined),
    keys: () =>
      tx<IDBValidKey[]>("readonly", (store) => store.getAllKeys()).then((all) =>
        all.map((key) => String(key)),
      ),
  };
};
