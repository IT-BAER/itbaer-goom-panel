/**
 * Tiny IndexedDB-backed CRUD for user-supplied WAD files.
 * Keyed by SHA-1 (hex). No schema migrations needed at v1.
 */
import type { StoredWad } from '../types';

const DB_NAME = 'itbaer-goom-panel';
const DB_VERSION = 1;
const STORE = 'wads';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'sha' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T> | Promise<T>): Promise<T> {
  const db = await openDb();
  try {
    return await new Promise<T>((resolve, reject) => {
      const t = db.transaction(STORE, mode);
      const store = t.objectStore(STORE);
      const maybeReq = fn(store);
      if (maybeReq instanceof IDBRequest) {
        maybeReq.onsuccess = () => resolve(maybeReq.result as T);
        maybeReq.onerror = () => reject(maybeReq.error);
      } else {
        Promise.resolve(maybeReq).then(resolve, reject);
      }
      t.onabort = () => reject(t.error);
    });
  } finally {
    db.close();
  }
}

export async function listWads(): Promise<StoredWad[]> {
  return tx<StoredWad[]>('readonly', (store) => store.getAll() as IDBRequest<StoredWad[]>);
}

export async function getWad(sha: string): Promise<StoredWad | undefined> {
  return tx<StoredWad | undefined>('readonly', (store) => store.get(sha) as IDBRequest<StoredWad | undefined>);
}

export async function putWad(wad: StoredWad): Promise<void> {
  await tx('readwrite', (store) => store.put(wad));
}

export async function deleteWad(sha: string): Promise<void> {
  await tx('readwrite', (store) => store.delete(sha));
}

export async function clearWads(): Promise<void> {
  await tx('readwrite', (store) => store.clear());
}
