// V2 step 2: data kept in memory only (lost on refresh). Step 4 swaps this for Firestore with the same shape.
(function() {
  // One counter for every list, so ids are unique across packs, shop, meals and sheets.
  // Ids are strings ("m1", "m2"...), like the Firestore doc ids in step 4.
  let nextId = 1;

  // Copy in and out, so a caller changing an item does not change the stored one
  function copy(x) {
    return x === undefined ? undefined : JSON.parse(JSON.stringify(x));
  }

  // all / get / add / put / remove for one collection (packs, shop, meals, sheets)
  function store() {
    const items = new Map();
    return {
      async all() {
        return [...items.values()].map(copy);
      },
      async get(id) {
        return copy(items.get(id));
      },
      async add(item) {
        const id = "m" + nextId++;
        const stored = copy(item);
        stored.id = id;
        items.set(id, stored);
        return id;
      },
      async put(item) {
        items.set(item.id, copy(item));
        return item.id;
      },
      async remove(id) {
        items.delete(id);
      }
    };
  }

  const packs = store();

  const DB = {
    async open() {
      // Nothing to open: data lives in memory for this page visit
    },

    // Packs (the fridge): DB.all, DB.get, DB.add, DB.put, DB.remove
    all: packs.all,
    get: packs.get,
    add: packs.add,
    put: packs.put,
    remove: packs.remove,

    // Shopping list items
    shop: store(),

    // Meals history: one record per day that was eaten (or a takeaway with a cost)
    meals: store(),

    // Printed fridge sheets: { code, printed, rows }
    sheets: store(),

    // Idea ratings, one per food name: { name, rating }
    ratings: (function() {
      const byName = new Map();
      return {
        async all() {
          return [...byName.values()].map(copy);
        },
        async put(r) {
          byName.set(r.name, copy(r));
          return r.name;
        }
      };
    })()
  };

  window.DB = DB;
})();
