(function() {
  let db;

  const DB = {
    async open() {
      return new Promise((resolve, reject) => {
        const req = indexedDB.open("food-tracker", 1);
        req.onerror = () => reject(req.error);
        req.onsuccess = () => {
          db = req.result;
          resolve(db);
        };
        req.onupgradeneeded = (e) => {
          const database = e.target.result;
          if (!database.objectStoreNames.contains("packs")) {
            database.createObjectStore("packs", { keyPath: "id", autoIncrement: true });
          }
        };
      });
    },

    async all() {
      const store = db.transaction("packs", "readonly").objectStore("packs");
      return new Promise((resolve, reject) => {
        const req = store.getAll();
        req.onerror = () => reject(req.error);
        req.onsuccess = () => resolve(req.result);
      });
    },

    async add(pack) {
      const store = db.transaction("packs", "readwrite").objectStore("packs");
      return new Promise((resolve, reject) => {
        const req = store.add(pack);
        req.onerror = () => reject(req.error);
        req.onsuccess = () => resolve(req.result);
      });
    },

    async put(pack) {
      const store = db.transaction("packs", "readwrite").objectStore("packs");
      return new Promise((resolve, reject) => {
        const req = store.put(pack);
        req.onerror = () => reject(req.error);
        req.onsuccess = () => resolve(req.result);
      });
    },

    async get(id) {
      const store = db.transaction("packs", "readonly").objectStore("packs");
      return new Promise((resolve, reject) => {
        const req = store.get(id);
        req.onerror = () => reject(req.error);
        req.onsuccess = () => resolve(req.result);
      });
    },

    async remove(id) {
      const store = db.transaction("packs", "readwrite").objectStore("packs");
      return new Promise((resolve, reject) => {
        const req = store.delete(id);
        req.onerror = () => reject(req.error);
        req.onsuccess = () => resolve(req.result);
      });
    }
  };

  window.DB = DB;
})();
