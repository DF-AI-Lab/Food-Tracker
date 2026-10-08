(function() {
  // Packs are saved by the local server (server/server.js) in a SQLite file
  async function call(method, url, body) {
    const res = await fetch(url, {
      method,
      headers: body === undefined ? {} : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    if (!res.ok) throw new Error(`${method} ${url} failed: ${res.status}`);
    return res.json();
  }

  function withoutId(pack) {
    const { id, ...rest } = pack;
    return rest;
  }

  const DB = {
    async open() {
      // Nothing to open: the server holds the database
    },

    async all() {
      return call("GET", "/api/packs");
    },

    async add(pack) {
      const { id } = await call("POST", "/api/packs", withoutId(pack));
      return id;
    },

    async put(pack) {
      const { id } = await call("PUT", `/api/packs/${pack.id}`, withoutId(pack));
      return id;
    },

    async get(id) {
      return call("GET", `/api/packs/${id}`);
    },

    async remove(id) {
      return call("DELETE", `/api/packs/${id}`);
    }
  };

  window.DB = DB;
})();
