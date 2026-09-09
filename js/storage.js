// IndexedDB-backed local match library. Works fully offline; this is the
// "recent matches on this device" list, separate from file export/import.

const DB_NAME = 'cricket-scoring';
const DB_VERSION = 1;
const MATCH_STORE = 'matches';
const HANDLE_STORE = 'fileHandles';

let dbPromise = null;

function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(MATCH_STORE)) {
        db.createObjectStore(MATCH_STORE, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(HANDLE_STORE)) {
        db.createObjectStore(HANDLE_STORE, { keyPath: 'matchId' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function tx(storeName, mode) {
  return openDb().then((db) => db.transaction(storeName, mode).objectStore(storeName));
}

export async function saveMatch(match) {
  match.updatedAt = new Date().toISOString();
  const store = await tx(MATCH_STORE, 'readwrite');
  return new Promise((resolve, reject) => {
    const req = store.put(match);
    req.onsuccess = () => resolve(match);
    req.onerror = () => reject(req.error);
  });
}

export async function loadMatch(id) {
  const store = await tx(MATCH_STORE, 'readonly');
  return new Promise((resolve, reject) => {
    const req = store.get(id);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
}

export async function deleteMatch(id) {
  const store = await tx(MATCH_STORE, 'readwrite');
  return new Promise((resolve, reject) => {
    const req = store.delete(id);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

export async function listMatches() {
  const store = await tx(MATCH_STORE, 'readonly');
  return new Promise((resolve, reject) => {
    const req = store.getAll();
    req.onsuccess = () => resolve((req.result || []).sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || '')));
    req.onerror = () => reject(req.error);
  });
}

// --- File System Access API handle persistence (Chrome/Edge on PC) ---
// Lets a match remember which OneDrive-synced file it was last saved to,
// so re-saving is a single click instead of re-picking the file each time.

export async function saveFileHandle(matchId, handle) {
  const store = await tx(HANDLE_STORE, 'readwrite');
  return new Promise((resolve, reject) => {
    const req = store.put({ matchId, handle });
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

export async function getFileHandle(matchId) {
  const store = await tx(HANDLE_STORE, 'readonly');
  return new Promise((resolve, reject) => {
    const req = store.get(matchId);
    req.onsuccess = () => resolve(req.result ? req.result.handle : null);
    req.onerror = () => reject(req.error);
  });
}
