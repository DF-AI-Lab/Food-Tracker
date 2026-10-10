// V2 step 4: the cloud data layer. Same shape as v2/js/db.js, backed by Firestore.
// F (the Firestore API) and db (the database) are passed in, so this file has no imports.

// Lists read live into a mirror; foods is write-only (the memory of each food name)
const LISTS = ["packs", "shop", "meals", "sheets", "ratings"];
const DEBOUNCE_MS = 100;

// Copy in and out, so a caller changing an item does not change the stored one
function copy(x) {
  return x === undefined ? undefined : JSON.parse(JSON.stringify(x));
}

// Plain data only (no undefined, no id): what gets written to Firestore
function fields(item) {
  const data = copy(item) || {};
  delete data.id;
  return data;
}

// Firestore document as an item, with updatedAt as a number (ms)
function toItem(doc) {
  const data = doc.data({ serverTimestamps: "estimate" });
  if (data.updatedAt && typeof data.updatedAt.toMillis === "function") {
    data.updatedAt = data.updatedAt.toMillis();
  }
  return { id: doc.id, ...data };
}

// Report a failed write (writes are not awaited, so this is the only place it shows)
function failed(p) {
  p.catch(e => {
    console.error(e);
    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("ft-db-error", { detail: e }));
    }
  });
}

export function makeCloudDB(F, db, householdId, uid) {
  const mirrors = new Map(LISTS.map(name => [name, new Map()]));
  const unsubs = [];
  const callbacks = [];
  const ownRemoved = new Set(); // ids this DB removed itself (so their removal is not news)
  let timer = null;

  const col = name => F.collection(db, "households", householdId, name);

  // Call every onChange callback once per burst of other-phone changes
  function notify() {
    if (timer) return;
    timer = setTimeout(() => {
      timer = null;
      for (const cb of callbacks) cb();
    }, DEBOUNCE_MS);
  }

  // Start a live listener on one list; resolves on its first snapshot
  function listen(name) {
    const mirror = mirrors.get(name);
    return new Promise((resolve, reject) => {
      let first = true;
      const unsub = F.onSnapshot(col(name), snap => {
        let news = false;
        if (!first) {
          for (const change of snap.docChanges()) {
            if (change.type === "removed") {
              if (ownRemoved.has(change.doc.id)) ownRemoved.delete(change.doc.id);
              else news = true;
            } else if (change.doc.data().updatedBy !== uid) {
              news = true;
            }
          }
        }
        mirror.clear();
        for (const doc of snap.docs) mirror.set(doc.id, toItem(doc));
        if (first) {
          first = false;
          resolve();
        } else if (news) {
          notify();
        }
      }, e => {
        if (first) reject(e);
        else console.error(e);
      });
      unsubs.push(unsub);
    });
  }

  // Write one document now, without waiting for the server (works offline)
  function save(name, id, item) {
    const data = fields(item);
    mirrors.get(name).set(id, { id, ...data, updatedBy: uid, updatedAt: Date.now() });
    failed(F.setDoc(F.doc(col(name), id), { ...data, updatedBy: uid, updatedAt: F.serverTimestamp() }));
    return id;
  }

  function remove(name, id) {
    mirrors.get(name).delete(id);
    ownRemoved.add(id);
    failed(F.deleteDoc(F.doc(col(name), id)));
  }

  // all / get / add / put / remove for one list
  function store(name) {
    const mirror = mirrors.get(name);
    return {
      async all() {
        return [...mirror.values()].map(copy);
      },
      async get(id) {
        return copy(mirror.get(id));
      },
      async add(item) {
        const id = F.doc(col(name)).id;
        save(name, id, item);
        return id;
      },
      async put(item) {
        return save(name, item.id, item);
      },
      async remove(id) {
        remove(name, id);
      }
    };
  }

  const packs = store("packs");

  const DB = {
    // Start the live listeners; resolves once every list has its first snapshot
    async open() {
      await Promise.all(LISTS.map(listen));
    },

    // Packs (the fridge): DB.all, DB.get, DB.add, DB.put, DB.remove
    all: packs.all,
    get: packs.get,
    async add(item) {
      const id = await packs.add(item);
      // Remember the food name, so the usual buttons can offer it (one entry per name)
      const name = String(item.name || "").trim();
      if (!name) return id;
      failed(F.setDoc(F.doc(col("foods"), encodeURIComponent(name.toLowerCase())), {
        name,
        kind: item.kind ?? null,
        noDate: !!item.noDate,
        timesAdded: F.increment(1),
        updatedAt: F.serverTimestamp(),
      }, { merge: true }));
      return id;
    },
    put: packs.put,
    remove: packs.remove,

    // Shopping list items
    shop: store("shop"),

    // Meals history: one record per day that was eaten (or a takeaway with a cost)
    meals: store("meals"),

    // Printed fridge sheets: { code, printed, rows }
    sheets: store("sheets"),

    // Idea ratings, one per food name: { name, rating }. Doc id is the encoded name.
    ratings: {
      async all() {
        return [...mirrors.get("ratings").values()].map(copy);
      },
      async put(r) {
        return save("ratings", encodeURIComponent(r.name), r);
      }
    },

    // Call cb when another phone changed the data
    onChange(cb) {
      callbacks.push(cb);
      return () => {
        const i = callbacks.indexOf(cb);
        if (i >= 0) callbacks.splice(i, 1);
      };
    },

    // Stop all the live listeners
    close() {
      for (const unsub of unsubs.splice(0)) unsub();
      clearTimeout(timer);
      timer = null;
    }
  };

  return DB;
}
