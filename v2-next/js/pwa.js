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

  // ---- Check for updates (Settings → 🔄 Check for updates) ----
  // Resolves "none" (no service worker, or no new version) or "new" (shows #newVersion).
  // Defined before any early return below so it always exists.
  window.FT_checkUpdate = async () => {
    const reg = "serviceWorker" in navigator ? await navigator.serviceWorker.getRegistration() : null;
    if (!reg) return "none";
    await reg.update();
    // A new worker is being installed: wait up to 10s for it to finish
    const worker = reg.installing;
    if (worker && worker.state !== "installed" && worker.state !== "redundant") {
      await new Promise(done => {
        const timer = setTimeout(done, 10000);
        worker.addEventListener("statechange", () => {
          if (worker.state === "installed" || worker.state === "redundant") {
            clearTimeout(timer);
            done();
          }
        });
      });
    }
    if (reg.waiting) {
      document.getElementById("newVersion").hidden = false;
      return "new";
    }
    return "none";
  };

  // ---- Install prompt ----
  // ✕ on the banner hides it for good on this phone (a flag in localStorage).
  // The prompt is still kept, so Settings → Install app works.
  const INSTALL_KEY = location.pathname.includes("v2-next") ? "next.installHidden" : "installHidden";
  const installWrap = document.getElementById("installWrap");
  const installHide = document.getElementById("installHide");
  let deferredPrompt = null;

  const bannerHidden = () => {
    try { return localStorage.getItem(INSTALL_KEY) === "1"; } catch (e) { return false; }
  };
  const showInstall = on => {
    installWrap.hidden = !on;
    installBtn.hidden = !on;
  };

  window.addEventListener("beforeinstallprompt", e => {
    e.preventDefault(); // we show our own button instead of Chrome's mini-bar
    deferredPrompt = e;
    if (!bannerHidden()) showInstall(true);
  });

  installBtn.addEventListener("click", async () => {
    const e = deferredPrompt;
    showInstall(false);
    if (!e) return;
    try {
      await e.prompt();
    } catch (err) {
      // Chrome refused to show the prompt; nothing else to do
    }
    deferredPrompt = null; // an event can only be used once
  });

  installHide.addEventListener("click", () => {
    try { localStorage.setItem(INSTALL_KEY, "1"); } catch (e) { /* not kept: back after a restart */ }
    showInstall(false);
  });

  // Settings → Install app: "installed" when already an app, "prompted" when Chrome's prompt was shown,
  // "none" when there is no prompt (the caller then shows the browser-menu note)
  window.FT_install = async () => {
    if (window.matchMedia("(display-mode: standalone)").matches || navigator.standalone) return "installed";
    const e = deferredPrompt;
    if (!e) return "none";
    deferredPrompt = null; // an event can only be used once
    try {
      await e.prompt();
    } catch (err) {
      return "none";
    }
    showInstall(false);
    return "prompted";
  };

  window.addEventListener("appinstalled", () => {
    deferredPrompt = null;
    showInstall(false);
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
