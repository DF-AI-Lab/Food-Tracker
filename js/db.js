(function() {
  let db;

  // One set of helpers per store: all / get / add / put / remove
  function store(name) {
    const run = (mode, fn) => new Promise((resolve, reject) => {
      const req = fn(db.transaction(name, mode).objectStore(name));
      req.onerror = () => reject(req.error);
      req.onsuccess = () => resolve(req.result);
    });
    return {
      all: () => run("readonly", s => s.getAll()),
      get: (key) => run("readonly", s => s.get(key)),
      add: (value) => run("readwrite", s => s.add(value)),
      put: (value) => run("readwrite", s => s.put(value)),
      remove: (key) => run("readwrite", s => s.delete(key))
    };
  }

  const DB = {
    async open() {
      return new Promise((resolve, reject) => {
        const req = indexedDB.open("food-tracker", 2);
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
          if (!database.objectStoreNames.contains("shop")) {
            database.createObjectStore("shop", { keyPath: "id", autoIncrement: true });
          }
          if (!database.objectStoreNames.contains("ratings")) {
            database.createObjectStore("ratings", { keyPath: "name" });
          }
        };
      });
    },

    // Packs (the fridge): DB.all, DB.get, DB.add, DB.put, DB.remove
    ...store("packs"),

    // Shopping list items and idea ratings ({ name, rating })
    shop: store("shop"),
    ratings: store("ratings")
  };

  window.DB = DB;
})();
