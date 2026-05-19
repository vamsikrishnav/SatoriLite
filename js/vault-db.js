// IndexedDB wrapper for recent vaults
const DB_NAME = 'satorilite';
const DB_VERSION = 1;
const STORE_NAME = 'vaults';

let dbPromise = null;

function openDB() {
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);

    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'name' });
      }
    };
  });

  return dbPromise;
}

export async function getRecentVaults() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, 'readonly');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.getAll();

    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const vaults = request.result;
      vaults.sort((a, b) => b.lastOpened - a.lastOpened);
      resolve(vaults);
    };
  });
}

export async function saveVault(name, dirHandle) {
  const db = await openDB();
  const vault = {
    name,
    dirHandle,
    lastOpened: Date.now()
  };

  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.put(vault);

    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
  });
}

export async function removeVault(name) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.delete(name);

    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
  });
}
