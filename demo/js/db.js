// V2 step 2: data kept in memory only (lost on refresh). Step 4 swaps this for Firestore with the same shape.
(function() {
  // One counter for every list, so ids are unique across packs, shop, meals and sheets.
  // Ids are strings ("m1", "m2"...), like the Firestore doc ids in step 4.
  let nextId = 1;

  // Copy in and out, so a caller changing an item does not change the stored one
  function copy(x) {
    return x === undefined ? undefined : JSON.parse(JSON.stringify(x));
  }

  // The 🔔 list in memory: this phone's own changes (so the backup reminder can count them)
  const activity = [];
  // When the last backup was made (ms, or null). Memory only: lost on refresh.
  let lastBackupAt = null;

  // all / get / add / put / remove for one collection (packs, shop, meals, sheets)
  function store(list) {
    const items = new Map();
    // Note a change in the 🔔 list, if it is news
    function news(before, after) {
      // logic.js loads first in the page; without it (tests), nothing is noted
      const change = window.FT ? window.FT.activityChange(list, before, after) : null;
      if (change) activity.push({ by: null, verb: change.verb, name: change.name, at: Date.now() });
    }
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
        news(undefined, stored);
        return id;
      },
      async put(item) {
        const before = copy(items.get(item.id));
        items.set(item.id, copy(item));
        news(before, item);
        return item.id;
      },
      async remove(id) {
        items.delete(id);
      }
    };
  }

  const packs = store("packs");

  const DB = {
    // No sign-in in memory mode, so no who-stamps (undo is never blocked)
    uid: null,

    async open() {
      // Nothing to open: data lives in memory for this page visit
    },

    // Memory is always here: always online, nothing waiting
    status() {
      return { online: true, waiting: 0 };
    },

    // Nothing changes in memory mode, so the callback is never called
    onStatus() {},

    // Packs (the fridge): DB.all, DB.get, DB.add, DB.put, DB.remove
    all: packs.all,
    get: packs.get,
    add: packs.add,
    put: packs.put,
    remove: packs.remove,

    // Shopping list items
    shop: store("shop"),

    // Meals history: one record per day that was eaten (or a takeaway with a cost)
    meals: store("meals"),

    // Recipes: { id, name, fresh: [names], other: [{ name, qty }] }
    recipes: store("recipes"),

    // Meal plans: one per meal on a day { id, day, mealId, skip: [names] }
    mealPlans: store("mealPlans"),

    // Ideas & feedback (Settings): { text, type: "idea"|"problem", by, name, version, at }. Not in backups.
    feedback: store("feedback"),

    // Printed fridge sheets: { code, printed, rows }
    sheets: store("sheets"),

    // The 🔔 list: only this phone's changes in memory mode (no one else), so the bell stays empty
    activity: {
      async all() {
        return copy(activity);
      }
    },

    // When the last backup was made (ms, or null)
    lastBackup() {
      return lastBackupAt;
    },

    setLastBackup(ms) {
      lastBackupAt = ms;
    },

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
