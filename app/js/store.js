// Persistence: IndexedDB on this device, nothing anywhere else. If the
// browser refuses IndexedDB, the app still runs from memory and says so.

const DB_NAME = 'calendont';
const DB_VERSION = 1;

function request(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function openDB() {
  const req = indexedDB.open(DB_NAME, DB_VERSION);
  req.onupgradeneeded = () => {
    const db = req.result;
    db.createObjectStore('events', { keyPath: 'id' });
    db.createObjectStore('calendars', { keyPath: 'id' });
    db.createObjectStore('meta');
  };
  return request(req);
}

class IDBStore {
  persistent = true;

  constructor(db) {
    this.db = db;
  }

  async load() {
    const t = this.db.transaction(['events', 'calendars', 'meta'], 'readonly');
    const [events, calendars, settings, lastBackup] = await Promise.all([
      request(t.objectStore('events').getAll()),
      request(t.objectStore('calendars').getAll()),
      request(t.objectStore('meta').get('settings')),
      request(t.objectStore('meta').get('lastBackup')),
    ]);
    return { events, calendars, settings, lastBackup: lastBackup ?? null };
  }

  /**
   * Applies a batch atomically. Any of: putEvents, deleteEvents (ids),
   * putCalendars, deleteCalendars (ids), settings, lastBackup (null forgets it), clear (wipe first).
   */
  write(change) {
    return new Promise((resolve, reject) => {
      const t = this.db.transaction(['events', 'calendars', 'meta'], 'readwrite');
      const events = t.objectStore('events');
      const calendars = t.objectStore('calendars');
      const meta = t.objectStore('meta');
      if (change.clear) {
        events.clear();
        calendars.clear();
      }
      change.putCalendars?.forEach((c) => calendars.put(c));
      change.deleteCalendars?.forEach((id) => calendars.delete(id));
      change.putEvents?.forEach((e) => events.put(e));
      change.deleteEvents?.forEach((id) => events.delete(id));
      if (change.settings) meta.put(change.settings, 'settings');
      if (change.lastBackup) meta.put(change.lastBackup, 'lastBackup');
      else if (change.lastBackup === null) meta.delete('lastBackup');
      t.oncomplete = () => resolve();
      t.onerror = t.onabort = () => reject(t.error ?? new Error('Saving failed.'));
    });
  }
}

class MemoryStore {
  persistent = false;
  data = { events: new Map(), calendars: new Map(), settings: null, lastBackup: null };

  async load() {
    const { events, calendars, settings, lastBackup } = this.data;
    return { events: [...events.values()], calendars: [...calendars.values()], settings, lastBackup };
  }

  async write(change) {
    const { events, calendars } = this.data;
    if (change.clear) {
      events.clear();
      calendars.clear();
    }
    change.putCalendars?.forEach((c) => calendars.set(c.id, c));
    change.deleteCalendars?.forEach((id) => calendars.delete(id));
    change.putEvents?.forEach((e) => events.set(e.id, e));
    change.deleteEvents?.forEach((id) => events.delete(id));
    if (change.settings) this.data.settings = change.settings;
    if (change.lastBackup !== undefined) this.data.lastBackup = change.lastBackup;
  }
}

export async function openStore() {
  try {
    return new IDBStore(await openDB());
  } catch (err) {
    console.warn('IndexedDB unavailable; changes will not be saved.', err);
    return new MemoryStore();
  }
}

/** Asks the browser not to evict our data under storage pressure. */
export async function requestPersistence() {
  try {
    return (await navigator.storage?.persist?.()) ?? false;
  } catch {
    return false;
  }
}
