// Install and updates for V2 (step 6). Classic script, loaded at the end of <body>.
//   - Registers sw.js (offline app, new versions). Skipped in test modes (?local=1 or ?emu=1)
//     unless ?sw=1 is also given.
//   - Shows "New version, tap to refresh" when a new worker is waiting.
//   - Shows "📲 Install app" when Chrome offers to install the app.
(function () {
  const params = new URLSearchParams(location.search);
  const newVersionBtn = document.getElementById("newVersion");
  const installBtn = document.getElementById("installBtn");
  const CHECK_EVERY_MS = 30 * 60 * 1000;

  // ---- Install prompt ----
  let deferredPrompt = null;

  window.addEventListener("beforeinstallprompt", e => {
    e.preventDefault(); // we show our own button instead of Chrome's mini-bar
    deferredPrompt = e;
    installBtn.hidden = false;
  });

  installBtn.addEventListener("click", async () => {
    const e = deferredPrompt;
    installBtn.hidden = true;
    if (!e) return;
    try {
      await e.prompt();
    } catch (err) {
      // Chrome refused to show the prompt; nothing else to do
    }
    deferredPrompt = null; // an event can only be used once
  });

  window.addEventListener("appinstalled", () => {
    deferredPrompt = null;
    installBtn.hidden = true;
  });

  // ---- Service worker ----
  if (!("serviceWorker" in navigator)) return;
  const testMode = params.get("local") === "1" || params.get("emu") === "1";
  if (testMode && params.get("sw") !== "1") return;

  const hadController = !!navigator.serviceWorker.controller;
  let reloading = false;

  // The new version is live: reload once so the page runs the new files.
  // Only when the page was already controlled, so the very first install does not reload.
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (!hadController || reloading) return;
    reloading = true;
    location.reload();
  });

  let registration = null;

  // Tap: the waiting worker takes over, then controllerchange reloads the page
  newVersionBtn.addEventListener("click", () => {
    if (registration && registration.waiting) {
      registration.waiting.postMessage({ type: "SKIP_WAITING" });
    }
  });

  function showNewVersion() {
    newVersionBtn.hidden = false;
  }

  navigator.serviceWorker.register("./sw.js", { scope: "./" }).then(reg => {
    registration = reg;
    // A worker that finished installing before this page was opened
    if (reg.waiting && hadController) showNewVersion();

    reg.addEventListener("updatefound", () => {
      const worker = reg.installing;
      if (!worker) return;
      worker.addEventListener("statechange", () => {
        // "installed" with a controller means an update is waiting (not the first install)
        if (worker.state === "installed" && navigator.serviceWorker.controller) showNewVersion();
      });
    });

    // Look for a new version when the phone's page comes back, and every 30 minutes
    const check = () => { reg.update().catch(() => {}); };
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") check();
    });
    setInterval(check, CHECK_EVERY_MS);
  }).catch(() => { /* offline or blocked: the app still works without the worker */ });
})();
