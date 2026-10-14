/**
 * Хранилище. Сейчас IndexedDB на устройстве; если оно недоступно, данные живут в памяти страницы.
 * Интерфейс одинаков для обоих вариантов, поэтому потом можно подключить SQLite (Capacitor)
 * или сервер, не трогая остальной код.
 *
 * Данные:
 *   settings: { base, reserve, periodStart, periodEnd, currency, demo? }   (суммы в копейках)
 *   expense:  { id, date, amount, note, category, source, createdAt }
 *             source: 'manual' сейчас, позже 'bank' для импорта из банка
 */

const DB_NAME = 'expense-budget';
const DB_VERSION = 1;

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      db.createObjectStore('meta');
      const store = db.createObjectStore('expenses', { keyPath: 'id' });
      store.createIndex('date', 'date');
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

const wrap = (req) =>
  new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });

const finished = (tx) =>
  new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });

function idbStorage(db) {
  return {
    persistent: true,

    async load() {
      const tx = db.transaction(['meta', 'expenses'], 'readonly');
      const settings = await wrap(tx.objectStore('meta').get('settings'));
      const expenses = await wrap(tx.objectStore('expenses').getAll());
      return { settings: settings ?? null, expenses };
    },

    async saveSettings(settings) {
      const tx = db.transaction('meta', 'readwrite');
      if (settings) tx.objectStore('meta').put(settings, 'settings');
      else tx.objectStore('meta').delete('settings');
      await finished(tx);
    },

    async putExpense(expense) {
      const tx = db.transaction('expenses', 'readwrite');
      tx.objectStore('expenses').put(expense);
      await finished(tx);
    },

    async removeExpense(id) {
      const tx = db.transaction('expenses', 'readwrite');
      tx.objectStore('expenses').delete(id);
      await finished(tx);
    },

    async replaceAll({ settings, expenses }) {
      const tx = db.transaction(['meta', 'expenses'], 'readwrite');
      const store = tx.objectStore('expenses');
      store.clear();
      for (const e of expenses) store.put(e);
      if (settings) tx.objectStore('meta').put(settings, 'settings');
      else tx.objectStore('meta').delete('settings');
      await finished(tx);
    },
  };
}

function memoryStorage() {
  let settings = null;
  const expenses = new Map();
  return {
    persistent: false,
    async load() {
      return { settings, expenses: [...expenses.values()] };
    },
    async saveSettings(s) {
      settings = s;
    },
    async putExpense(e) {
      expenses.set(e.id, e);
    },
    async removeExpense(id) {
      expenses.delete(id);
    },
    async replaceAll(data) {
      settings = data.settings;
      expenses.clear();
      for (const e of data.expenses) expenses.set(e.id, e);
    },
  };
}

export async function createStorage() {
  try {
    if (!('indexedDB' in globalThis)) throw new Error('no indexedDB');
    const db = await openDB();
    try {
      await navigator.storage?.persist?.();
    } catch {
      /* необязательно */
    }
    return idbStorage(db);
  } catch {
    return memoryStorage();
  }
}
