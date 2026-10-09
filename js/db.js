(function() {
  // Everything is saved by the local server (server/server.js) in a SQLite file
  async function call(method, url, body) {
    const res = await fetch(url, {
      method,
      headers: body === undefined ? {} : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    if (!res.ok) throw new Error(`${method} ${url} failed: ${res.status}`);
    return res.json();
  }

  function withoutId(item) {
    const { id, ...rest } = item;
    return rest;
  }

  // all / get / add / put / remove for one collection (packs or shop)
  function store(name) {
    const base = `/api/${name}`;
    return {
      async all() {
        return call("GET", base);
      },
      async get(id) {
        return call("GET", `${base}/${id}`);
      },
      async add(item) {
        const { id } = await call("POST", base, withoutId(item));
        return id;
      },
      async put(item) {
        const { id } = await call("PUT", `${base}/${item.id}`, withoutId(item));
        return id;
      },
      async remove(id) {
        return call("DELETE", `${base}/${id}`);
      }
    };
  }

  const DB = {
    async open() {
      // Nothing to open: the server holds the database
    },

    // Packs (the fridge): DB.all, DB.get, DB.add, DB.put, DB.remove
    ...store("packs"),

    // Shopping list items
    shop: store("shop"),

    // Meals history: one record per day that was eaten (or a takeaway with a cost)
    meals: store("meals"),

    // Idea ratings, one per food name: { name, rating }
    ratings: {
      async all() {
        return call("GET", "/api/ratings");
      },
      async put(r) {
        return call("PUT", `/api/ratings/${encodeURIComponent(r.name)}`, r);
      }
    }
  };

  window.DB = DB;
})();
