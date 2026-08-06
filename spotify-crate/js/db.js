// IndexedDB wrapper. One record per playlist, tracks stored inline: a playlist
// is the unit of change (snapshot_id), so it is also the unit of write.

const DB_NAME = 'spotify-crate';
const DB_VERSION = 1;

let dbPromise = null;

function openDB() {
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);

    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('playlists')) {
        db.createObjectStore('playlists', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('meta')) {
        db.createObjectStore('meta');
      }
    };

    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });

  return dbPromise;
}

function tx(store, mode, fn) {
  return openDB().then((db) => new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const req = fn(t.objectStore(store));
    t.oncomplete = () => resolve(req ? req.result : undefined);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  }));
}

export const db = {
  getAllPlaylists() {
    return tx('playlists', 'readonly', (s) => s.getAll());
  },

  getPlaylist(id) {
    return tx('playlists', 'readonly', (s) => s.get(id));
  },

  putPlaylist(playlist) {
    return tx('playlists', 'readwrite', (s) => s.put(playlist));
  },

  deletePlaylist(id) {
    return tx('playlists', 'readwrite', (s) => s.delete(id));
  },

  clearPlaylists() {
    return tx('playlists', 'readwrite', (s) => s.clear());
  },

  getMeta(key) {
    return tx('meta', 'readonly', (s) => s.get(key));
  },

  setMeta(key, value) {
    return tx('meta', 'readwrite', (s) => s.put(value, key));
  },
};
