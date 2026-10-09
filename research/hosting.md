# Where is the phone app hosted for free? (issue #42)

## Answer

**GitHub Pages, free, HTTPS by default.** Nothing to buy and nothing to move.

## Why it works

- Repo `DF-AI-Lab/Food-Tracker` is **public** (checked via GitHub API, 9 Oct 2026). Pages on the Free plan serves public repos. Private repos need a paid plan (Pro for a personal account, Team for an org). One thing to know: a private repo's Pages site is still public on the internet unless you pay for Enterprise.
- Pages is not switched on yet (`has_pages: false`). It is a settings toggle (Settings > Pages > deploy from branch, folder `/`). No build step needed.
- URL will be `https://df-ai-lab.github.io/Food-Tracker/`. It is HTTPS with a free certificate. That is enough for PWA install, camera and mic (all need a secure context).
- Limits (from memory, GitHub docs were blocked in this environment, so re-check): about 1 GB site size, about 100 GB/month soft bandwidth. A one-user app is nowhere near either.

## Alternatives (only if GitHub Pages is ever not wanted)

All free tiers, all HTTPS, all fine for static files. Details from memory, not re-verified.

| Host | Free tier | Notes |
|---|---|---|
| Cloudflare Pages | Unlimited bandwidth, generous builds | Works with private repos. Good fallback. |
| Netlify | About 100 GB/month, 300 build credits | Works with private repos. Drag-and-drop deploy. |
| Firebase Hosting | About 10 GB storage, 360 MB/day transfer | Needs a Google project and CLI. Most setup. |

Pick Cloudflare Pages if the repo ever goes private. Otherwise there is no reason to leave GitHub Pages.

## Catch: the code does not match the plan yet

- `docs/BUILD-HANDOVER.md` says phone PWA, IndexedDB, no server, GitHub Pages.
- But the repo today is a **PC app**: `server/server.js` (Node + SQLite) and `js/db.js` calls `fetch('/api/...')`. Pages cannot run a server, so the app will not save anything on a phone as it stands.
- There is also **no `manifest.webmanifest` and no service worker** in the repo yet.
- The handover itself says phone = V2. So hosting is the easy part. V2 work needed: swap `js/db.js` to IndexedDB, add manifest + service worker + icons, make fetches of `/api/info` and `/api/update` optional.
- `index.html` loads Google Fonts from the web. Offline, those fail unless the fonts are cached or self-hosted.

## How updates reach installed phones

- Push to the branch Pages serves. Pages redeploys in about 1 minute.
- The service worker checks `sw.js` for changes each time the app opens (browsers also re-check about every 24 h). If `sw.js` changed byte for byte, the new worker installs in the background.
- It then **waits** until every app tab/window is closed, so the user sees the old version once more, then the new one on the next open.
- Simple fix: bump a `CACHE_VERSION` string in `sw.js` on every release (this makes `sw.js` change), call `skipWaiting()` and `clients.claim()`, and show a small "New version, tap to reload" banner. Do not let GitHub's CDN cache hide `sw.js` (Pages sends about 10 min cache, so allow a few minutes).
- Data is safe across updates: IndexedDB is not touched by a code update. Keep the Export/Import JSON backup, since clearing site data or uninstalling Chrome data wipes IndexedDB.
- Note: `server/updater.js` and `/api/update` are the PC updater. They do not apply to the phone version.

## Risk: repo is public, what is exposed?

Checked all tracked files and full history for `*.db`, `FoodTrackerData`, images:

- **No database files** in git or history. `FoodTrackerData/` lives outside the repo folder, by design.
- Tracked images are only mock-up/print-sheet screenshots in `docs/` and test fixtures in `tests/fixtures/sheets/` (`.pgm.gz` sheet photos). Worth a quick look that none show anything personal (the test "truth.json" and photos are sheet scans, likely just food).
- **No `.gitignore` exists.** Risk: the photo inbox `images/New` and `images/Processed` (used by the `/check-my-food-photos` skill) sit in the repo folder per the handover. A careless `git add .` would publish food photos, receipts or prices. Fix: add a `.gitignore` with `images/`, `FoodTrackerData/`, `*.db`, `*.db-*`.
- Public repo also means issues, docs and the plan are public. Fine unless something personal is written there.
- Nothing is secret in the app itself. On the phone version, the user's food data stays in the phone's IndexedDB and is never uploaded.

## Suggested next steps

1. Add `.gitignore` (images/, FoodTrackerData/, *.db).
2. Turn on Pages for the default branch (or a `gh-pages` branch) once the PWA files exist.
3. In V2, build manifest, service worker (versioned cache + update banner) and IndexedDB, then test on Android Chrome over the Pages HTTPS URL.

## Sources

- GitHub API repo check (visibility: public, has_pages: false).
- Web search 9 Oct 2026: GitHub Pages private repos need a paid plan ([community thread](https://github.com/orgs/community/discussions/22817), [guide](https://smartscope.blog/en/Tips/GitHub/github-pages-private-repository/)). No sign of a 2026 rule change. GitHub docs were unreachable here, so confirm on GitHub's pricing page.
