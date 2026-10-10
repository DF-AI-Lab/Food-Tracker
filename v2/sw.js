// Service worker for V2 (step 6): the app opens offline and updates when a new version is published.
// Classic script. Bump VERSION whenever the app files change (js/version.js n must match).

const VERSION = 7;
const CACHE = "ft-v" + VERSION;
const RUNTIME = "ft-runtime";

// Every file the app needs to start offline (all of v2/ except this file and the svg icon)
const PRECACHE = [
  "./",
  "index.html",
  "manifest.webmanifest",
  "css/style.css",
  "js/account.js",
  "js/app.js",
  "js/db-firestore.js",
  "js/db.js",
  "js/firebase-config.js",
  "js/household.js",
  "js/logic.js",
  "js/omr.js",
  "js/pwa.js",
  "js/version.js",
  "js/vendor/qrcode.mjs",
  "icons/apple-touch-icon.png",
  "icons/icon-192.png",
  "icons/icon-512.png",
];

// Read by tests/v2-pwa.test.js
self.FT_SW = { VERSION, PRECACHE };

// Third-party files that never change for a given URL (Firebase SDK, fonts)
const RUNTIME_ORIGINS = [
  "https://www.gstatic.com/firebasejs/",
  "https://fonts.googleapis.com/",
  "https://fonts.gstatic.com/",
];

self.addEventListener("install", e => {
  // Not skipWaiting here: a new version waits until the page asks (see js/pwa.js)
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(PRECACHE.map(u => new Request(u, { cache: "reload" }))))
  );
});

self.addEventListener("message", e => {
  if (e.data && e.data.type === "SKIP_WAITING") self.skipWaiting();
});

self.addEventListener("activate", e => {
  e.waitUntil((async () => {
    for (const key of await caches.keys()) {
      if (key.startsWith("ft-v") && key !== CACHE) await caches.delete(key);
    }
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);

  if (url.origin === self.location.origin) {
    const scope = new URL("./", self.location.href).href;
    if (req.mode === "navigate" && url.href.startsWith(scope)) {
      // Any page in the app opens the cached app shell (the app reads its state from storage)
      e.respondWith(
        caches.match("index.html", { cacheName: CACHE }).then(hit => hit || fetch(req))
      );
      return;
    }
    e.respondWith(
      caches.match(req, { cacheName: CACHE, ignoreSearch: true }).then(hit => hit || fetch(req))
    );
    return;
  }

  if (RUNTIME_ORIGINS.some(o => req.url.startsWith(o))) {
    e.respondWith(caches.open(RUNTIME).then(async c => {
      const hit = await c.match(req);
      if (hit) return hit;
      const res = await fetch(req);
      // Opaque responses (no-cors stylesheets) have status 0 but are fine to keep
      if (res.ok || res.type === "opaque") c.put(req, res.clone());
      return res;
    }));
  }
  // Anything else (Firestore, Google sign-in) goes straight to the network
});
