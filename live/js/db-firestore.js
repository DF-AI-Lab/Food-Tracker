// V2 step 4: the cloud data layer. Same shape as v2/js/db.js, backed by Firestore.
// F (the Firestore API) and db (the database) are passed in, so this file has no imports.

// Lists read live into a mirror; foods is write-only (the memory of each food name)
const LISTS = ["packs", "shop", "meals", "sheets", "ratings", "recipes", "combos", "mealPlans", "feedback"];
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

// Activity doc as an entry: { by, verb, name, at } with at as ms
function toEntry(doc) {
  const data = doc.data({ serverTimestamps: "estimate" });
  const at = data.at && typeof data.at.toMillis === "function" ? data.at.toMillis() : Date.now();
  return { by: data.by, verb: data.verb, name: data.name, at };
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

// Is the phone online? (Node has no navigator.onLine: count that as online)
function isOnline() {
  return typeof navigator === "undefined" ? true : navigator.onLine !== false;
}

export function makeCloudDB(F, db, householdId, uid, opts = {}) {
  const mirrors = new Map(LISTS.map(name => [name, new Map()]));
  const describe = opts.describe || null; // (list, before, after) -> {verb, name} | null
  let activityEntries = [];               // the newest 50 changes, for the 🔔 list
  let localBackupAt = null;               // a backup made on this phone, until its 🔔 entry arrives
  const unsubs = [];
  const callbacks = [];
  const statusCallbacks = [];
  const ownRemoved = new Set(); // ids this DB removed itself (so their removal is not news)
  const pendingBy = new Map(LISTS.map(name => [name, 0])); // docs with unsent writes, per list
  let inflight = 0;     // list writes started but not yet confirmed by the cloud
  let lastStatus = "";
  let timer = null;

  const col = name => F.collection(db, "households", householdId, name);

  // Waiting = list changes the cloud has not confirmed (reloads see pending docs too)
  function waitingCount() {
    let pendingDocs = 0;
    for (const n of pendingBy.values()) pendingDocs += n;
    return Math.max(inflight, pendingDocs);
  }

  function status() {
    return { online: isOnline(), waiting: waitingCount() };
  }

  // Tell the status callbacks, but only when online or waiting really changed
  function emitStatus() {
    const s = status();
    const key = `${s.online}/${s.waiting}`;
    if (key === lastStatus) return;
    lastStatus = key;
    for (const cb of statusCallbacks) cb(s);
  }

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
      // includeMetadataChanges: also hear about writes still waiting to reach the cloud
      const unsub = F.onSnapshot(col(name), { includeMetadataChanges: true }, snap => {
        let news = false;
        if (!first) {
          // docChanges() lists real changes only, so metadata-only snapshots never count as news
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
        let pending = 0;
        for (const doc of snap.docs) {
          mirror.set(doc.id, toItem(doc));
          if (doc.metadata.hasPendingWrites) pending++;
        }
        pendingBy.set(name, pending);
        if (first) {
          first = false;
          resolve();
        } else if (news) {
          notify();
        }
        emitStatus();
      }, e => {
        if (first) reject(e);
        else console.error(e);
      });
      unsubs.push(unsub);
    });
  }

  // Live listener for the 🔔 list: the newest 50 changes (older ones are trimmed)
  function listenActivity() {
    return new Promise((resolve, reject) => {
      let first = true;
      const q = F.query(col("activity"), F.orderBy("at", "desc"), F.limit(50));
      const unsub = F.onSnapshot(q, snap => {
        let news = false;
        if (!first) {
          for (const change of snap.docChanges()) {
            if (change.type === "added" && change.doc.data().by !== uid) news = true;
          }
        }
        activityEntries = snap.docs.map(toEntry);
        if (first) {
          first = false;
          // Keep the collection short: delete what is older than the newest 50
          if (snap.docs.length === 50) {
            failed(trimActivity(snap.docs[snap.docs.length - 1]));
          }
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

  // Delete the activity docs after the newest 50 (the last one kept is lastDoc)
  async function trimActivity(lastDoc) {
    const old = await F.getDocs(F.query(col("activity"), F.orderBy("at", "desc"), F.startAfter(lastDoc), F.limit(100)));
    for (const d of old.docs) failed(F.deleteDoc(d.ref));
  }

  // Count a list write as waiting until the cloud confirms it (or refuses it)
  function counted(p) {
    inflight++;
    emitStatus();
    const done = () => { inflight--; emitStatus(); };
    failed(p);
    p.then(done, done);
  }

  // Write one document now, without waiting for the server (works offline)
  function save(name, id, item) {
    const data = fields(item);
    const before = mirrors.get(name).get(id);
    mirrors.get(name).set(id, { id, ...data, updatedBy: uid, updatedAt: Date.now() });
    // Say what changed, if it is news for the 🔔 list (not counted as waiting)
    const news = describe ? describe(name, before, { id, ...data }) : null;
    if (news) {
      failed(F.addDoc(col("activity"), { by: uid, verb: news.verb, name: news.name, at: F.serverTimestamp() }));
    }
    counted(F.setDoc(F.doc(col(name), id), { ...data, updatedBy: uid, updatedAt: F.serverTimestamp() }));
    return id;
  }

  function remove(name, id) {
    mirrors.get(name).delete(id);
    ownRemoved.add(id);
    counted(F.deleteDoc(F.doc(col(name), id)));
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

  // Browser: follow the phone going online / offline
  const onNet = () => emitStatus();
  if (typeof window !== "undefined" && window.addEventListener) {
    window.addEventListener("online", onNet);
    window.addEventListener("offline", onNet);
  }

  const DB = {
    // Whose phone this is (the Firebase user id)
    uid,

    // Start the live listeners; resolves once every list has its first snapshot
    async open() {
      await Promise.all([...LISTS.map(listen), listenActivity()]);
    },

    // { online, waiting }: for the sync sign on the Today line
    status,

    // Call cb whenever online or waiting changes
    onStatus(cb) {
      statusCallbacks.push(cb);
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

    // Recipes: { id, name, fresh: [names], other: [{ name, qty }] }
    recipes: store("recipes"),

    // Meal combos (pairs): { a, b, source: "hand"|"ai"|"learned", hidden }
    combos: store("combos"),

    // Meal plans: one per meal on a day { id, day, mealId, skip: [names] }
    mealPlans: store("mealPlans"),

    // Ideas & feedback (Settings): { text, type: "idea"|"problem", by, name, version, at }. Not in backups.
    feedback: store("feedback"),

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

    // The 🔔 list: other people's changes, newest first (see FT.activityFeed)
    activity: {
      async all() {
        return copy(activityEntries);
      }
    },

    // When the household last backed up (ms, or null): the newest "backed up" entry in the 🔔 list
    lastBackup() {
      let last = null;
      for (const e of activityEntries) {
        if (e.verb === "backed up" && (last === null || e.at > last)) last = e.at;
      }
      // This phone's own backup counts straight away (the shared entry can arrive a moment later)
      return Math.max(last ?? 0, localBackupAt ?? 0) || null;
    },

    // Note a backup for everyone in the household (as a 🔔 entry: "Alice backed up")
    setLastBackup(ms) {
      localBackupAt = ms;
      failed(F.addDoc(col("activity"), { by: uid, verb: "backed up", name: "", at: F.serverTimestamp() }));
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
      if (typeof window !== "undefined" && window.removeEventListener) {
        window.removeEventListener("online", onNet);
        window.removeEventListener("offline", onNet);
      }
    }
  };

  return DB;
}
