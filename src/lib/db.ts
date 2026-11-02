// Tiny IndexedDB wrapper. Four stores:
//   kv     – cached server data (so the app opens with no signal)
//   outbox – things waiting to be sent to the server
//   blobs  – photos/videos/recordings waiting to upload (and demo-mode files)
//   local  – phone-only data (phone-only journal, demo-mode tables)

const DB_NAME = 'i4k-ride';
const VERSION = 1;
export type StoreName = 'kv' | 'outbox' | 'blobs' | 'local';

let dbp: Promise<IDBDatabase> | null = null;

function open(): Promise<IDBDatabase> {
  if (dbp) return dbp;
  dbp = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const s of ['kv', 'outbox', 'blobs', 'local']) if (!db.objectStoreNames.contains(s)) db.createObjectStore(s);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbp;
}

function tx<T>(store: StoreName, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return open().then(db => new Promise<T>((resolve, reject) => {
    const t = db.transaction(store, mode);
    const r = fn(t.objectStore(store));
    t.oncomplete = () => resolve(r.result);
    t.onerror = () => reject(t.error || r.error);
    t.onabort = () => reject(t.error || new Error('IndexedDB transaction aborted'));
  }));
}

export const idb = {
  get<T>(store: StoreName, key: string): Promise<T | undefined> {
    return tx(store, 'readonly', s => s.get(key) as IDBRequest<T | undefined>);
  },
  set(store: StoreName, key: string, value: unknown): Promise<IDBValidKey> {
    return tx(store, 'readwrite', s => s.put(value, key));
  },
  del(store: StoreName, key: string): Promise<undefined> {
    return tx(store, 'readwrite', s => s.delete(key) as IDBRequest<undefined>);
  },
  keys(store: StoreName): Promise<IDBValidKey[]> {
    return tx(store, 'readonly', s => s.getAllKeys());
  },
  all<T>(store: StoreName): Promise<T[]> {
    return tx(store, 'readonly', s => s.getAll() as IDBRequest<T[]>);
  },
  clear(store: StoreName): Promise<undefined> {
    return tx(store, 'readwrite', s => s.clear() as IDBRequest<undefined>);
  },
};

/** Store a file. Some older iPhones refuse Blobs in IndexedDB, so fall back to raw bytes. */
export async function putBlob(key: string, blob: Blob): Promise<void> {
  try {
    await idb.set('blobs', key, blob);
  } catch {
    const buf = await blob.arrayBuffer();
    await idb.set('blobs', key, { buf, type: blob.type });
  }
}

export async function getBlob(key: string): Promise<Blob | undefined> {
  const v = await idb.get<Blob | { buf: ArrayBuffer; type: string }>('blobs', key);
  if (!v) return undefined;
  if (v instanceof Blob) return v;
  return new Blob([v.buf], { type: v.type });
}

// Small synchronous settings live in localStorage.
export const prefs = {
  get<T>(key: string, fallback: T): T {
    try {
      const v = localStorage.getItem('i4k:' + key);
      return v === null ? fallback : (JSON.parse(v) as T);
    } catch {
      return fallback;
    }
  },
  set(key: string, value: unknown) {
    try { localStorage.setItem('i4k:' + key, JSON.stringify(value)); } catch { /* storage full or blocked */ }
  },
  del(key: string) {
    try { localStorage.removeItem('i4k:' + key); } catch { /* ignore */ }
  },
};
