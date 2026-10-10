# Food Tracker V2: build plan (phone app, cloud sync)

Decisions live on the map: [Map: V2 phone app — 2+ phones in sync](https://github.com/DF-AI-Lab/Food-Tracker/issues/40).
This file turns them into build steps. Read the map's ticket comments for the detail behind each line.

## In one glance

- **V2 = a separate phone app.** V1 (the PC app: Node server + SQLite) stays exactly as it is, and stays in daily use until switch-over.
- **Test first, then move:** test in a throwaway `tryout` household; at switch-over, copy **all V1 data** into the real household.
- 2 people · 2 Samsung Android phones + the PC browser · every device equal.
- **Works offline, then syncs.** Cloud holds the data, the PC can be off.
- **£0 to run:** Firestore free (Spark) plan · GitHub Pages hosting · Cloudflare Worker free tier. Claude API for packet photos: **under $1/month**.
- Plain HTML/CSS/JS, **no build step**. Firebase loaded from its CDN (ES modules).

## How we build (from `CLAUDE.md`)

- Tests first, then Haiku builds, Sonnet if Haiku fails. Short progress updates.
- **Get it working first**, plain screens, then pretty.
- **Test early:** each step ends with a small try-out on a real phone where it can.
- **Merging:** Darren said (2026-10-10) to merge into the default branch whenever it's needed for him to test, without asking. Tests must pass first. **Bump `n` in `v2/js/version.js` AND `VERSION` in `v2/sw.js` on every merge** (a test checks they match; a new number is what makes phones show *New version, tap to refresh*) (shown at the bottom of the app and in ⚙️ Settings).

## Where V2 lives

- Folder **`v2/`** in this repo, served by GitHub Pages at `https://df-ai-lab.github.io/Food-Tracker/v2/`.
- V2 gets **its own copies** of `index.html`, `css/`, `js/app.js`, `js/logic.js`, `js/omr.js`. V1 files are never edited for V2.
- `v2/js/db.js` is replaced by a Firestore version with the **same shape** (`all / get / add / put / remove` per list),
  so most of `app.js` works unchanged.

## Cloud database (Firestore)

Everything sits under one household:

```
households/{householdId}         { name, members: [uid…], invite: { code, expires } }
  ├─ packs/{id}      every pack (see below)
  ├─ shop/{id}       shopping list items (as V1)
  ├─ meals/{id}      one per day eaten / takeaway + cost (as V1)
  ├─ sheets/{id}     printed sheets: { code, printed, rows } for the 📷 scan (as V1)
  ├─ ratings/{name}  { name, rating } (as V1)
  ├─ foods/{name}    memory per food: { kind, noDate, timesAdded }  (new: saves reads)
  └─ inbox/{id}      photo items waiting to confirm: { name, sub, date, price, bb, packs, photo } (new)
```

**Pack** (all V1 fields, plus who/when):

```json
{ "name": "Chicken", "sub": "Asda", "kind": "main", "date": "2026-10-14", "dateType": "use_by",
  "status": "in_fridge", "added": "2026-10-10", "left": null, "frozen": null,
  "price": 3.5, "plannedFor": null, "partUsed": false,
  "updatedBy": "<uid>", "updatedAt": "<server time>" }
```

- **`sub`** is shown in V2 (Chicken · *Asda* / *Butchers*).
- **`price`** is optional: `null` when unknown, can be filled in later.
- Old packs are **kept forever**. Screens load only what they need (in fridge, in freezer, this month's used).
- **Security rules:** only `members` of a household can read or write it.
- Free limits (re-check on Firebase's page): 50k reads/day, 20k writes/day, 1 GB. Over the limit = paused till ~8am UK, never billed.

## Sync rules

- **Last tap wins.** No clash pop-ups.
- Same food added on both phones = **2 packs**.
- **Undo** only your own last tap. If another phone changed it since: *"Changed on another phone, can't undo"*.
- Sync sign on the Today line: **✅ synced · ⏳ N waiting · 📴 offline**.
- ⭐ Usual buttons: **one shared order** (from `foods`).
- Sheet scan skips packs already changed on a phone: *"already done"*.

## Order from here (agreed 2026-10-10)

Done: 0 → 6. Then: **quick job: move 🔄 into ⚙️ Settings** as *🔄 Check for updates* next to the version ("✓ Up to date · vN" or the 🆕 note; frees space in the top bar) → **7a ✏️ Edit** → **8 🖨️ Print sheet + scan** → **9 💾 Backups** → **7 📷 Photos → Claude** → **10 📱 Go live** (copy all V1 data in = full working V2) → **🎨 Look** last (new chat, Darren's artifact ideas).
After V2: use it for real for a while, keep adding ideas to [💡 V3 ideas](https://github.com/DF-AI-Lab/Food-Tracker/issues/39), then V3.

## Build steps (in order)

Each step: tests first → build → try it → tick it off.

### 0. Prep (no app code)

- [x] Add a **`.gitignore`**: `images/`, `FoodTrackerData/`, `*.db`, the PC key file. The repo is public.
- [x] **You:** create a Firebase project (free Spark plan, no card), turn on **Firestore** and **Google sign-in**. Checklist given at the time.
- [x] Re-check on Firebase's own pages: free limits, and that photo **Storage** needs a card (why we use Drive).
  - ✅ Storage: console says *"To use Storage, upgrade your project's pricing plan"* (checked 2026-10-10).
  - ✅ Free limits (Usage and billing, 2026-10-10): 50K reads/day · 20K writes/day · 20K deletes/day · 1 GB stored · 10 GB bandwidth/month.
- Project ID: **`food-tracker-92b1c`** · Spark plan · Firestore Standard, `europe-west2`, production mode · Google sign-in on · authorised domain `df-ai-lab.github.io` added.

### 1. Photo try-out (new territory, so first)

- [x] Phone: take a photo → Share → Google Drive → `Food Tracker/New`.
- [x] PC: Google Drive for desktop syncs it; the skill sees it.
- [x] Skill writes **one item** to `inbox` using the PC key file. See it in the Firebase console.
  - ✅ 2026-10-10: PC sent Chicken to `households/tryout/inbox`. Key + script live in `C:\Users\User\FoodTrackerKey\` (outside OneDrive/Drive; the PC app folder isn't a git clone, so files were downloaded from GitHub raw).
  - Wiring the photo skill to call the script: step 7.
  - Script: `node tools/inbox-push.js <key-file> tryout tools/tryout-item.json` → `households/tryout/inbox`. Delete `tryout` after.
- Photos go to Drive account **`df.ai.lab.hq@gmail.com`** (owner on the Firebase project), folder `Food Tracker/New`.

### 2. V2 skeleton on GitHub Pages

- [x] `v2/` copy of the app, opens from the Pages link on a phone (no data yet).
  - ✅ Built: `v2/` copies + in-memory `v2/js/db.js` (lost on refresh). Tests: `tests/v2-skeleton.test.js`, `npm run check:v2`. ✅ Opened on Darren's phone 2026-10-10.
- [x] Turn on GitHub Pages for the repo. (Source: branch `claude/beautiful-maxwell-bhmu21`, `/ (root)`.)

### 3. Sign-in and household

- [x] Google sign-in, stays logged in.
- [x] First person creates the household. **Invite code / QR** → second phone scans → signs in → joins.
- [x] Settings → **Members** list with ❌ to remove.
- [x] Security rules: members only. Test that a non-member sees nothing.
  - `firestore.rules` published 2026-10-10. Tests: `npm run check:rules` (emulator), `npm run check:account` (screens, emulator).
  - ✅ Tried on 2 phones 2026-10-10: main account made the household, `df.ai.lab.hq` joined by QR.

### 4. Data layer: Firestore instead of the server

- [x] `v2/js/db.js` on Firestore with **offline persistence on**. (`v2/js/db-firestore.js`; `db.js` stays for `?local=1`.)
- [x] Same `DB` shape as V1, so screens keep working.
- [x] Add `updatedBy` / `updatedAt` on every save. Keep `foods` up to date on each Add.
- [x] Load only what each screen needs (keep reads low).
  - Decision 2026-10-10: load **all** packs for now (usual buttons + meal ideas use the whole history). ~10k reads/day after a year vs 50k free. `foods` is kept up to date so this can be slimmed later.
  - Tests: `npm run check:rules` (incl. `db-firestore.check.js`), `npm run check:sync` (2 browsers, live + offline). ✅ Tried on both phones 2026-10-10: live sync, one offline, and both offline then back: all matched.

### 5. Sync rules and sync sign

- [x] ✅ / ⏳ / 📴 on the Today line (under the date).
- [x] Undo check against `updatedBy` / `updatedAt`. Tests: `tests/v2-sync-rules.test.js`, step-5 parts of `check:rules` and `check:sync`.
- [x] Try it: both phones offline, both change things, back online → matches the rules above.
  - ✅ 2026-10-10 on both phones: sync sign, offline waiting count, both offline then back. A stale-cache bug on phone 2 (Used didn't work) was fixed by clearing its cache; the version number (v6) now shows which code each phone runs. Step 6 removes the stale-cache problem.

### 6. Install and updates

- [x] `manifest.webmanifest` + icons + service worker (`v2/sw.js`) → Chrome shows **"Install app"**. Opens offline.
- [x] Our own **📲 Install** button as a fallback (`v2/js/pwa.js`).
- [x] New version → *"New version, tap to refresh"*. Tests: `tests/v2-pwa.test.js`, `npm run check:pwa`. ✅ 2026-10-10: installed on both phones (v7), opens offline. The "new version" note gets its first real try on the next merge.

### 🎨 Look (after the gears work)

The user found the V1 look too childish ("looks like a 5 year old did it"). Fix it here, once steps 0–6 work.
**Update 2026-10-10:** on the phone, Darren said V2 "looks stunning". Ask before restyling; this step may shrink to small tweaks.

- [ ] Ask the user for screenshots of apps whose look they like.
- [ ] Make **2–3 clickable style mock-ups** (open on the phone). User picks one. No tests, no Haiku for mock-ups.
- [ ] Restyle V2 to the picked style (mostly `css/`), then carry on with step 7.

### 7a. ✏️ Edit a pack (added 2026-10-10)

- [ ] Tap a pack → **✏️ Edit** → change **name** (fix spelling), **sub** (e.g. *Asda*), **kind / category**, **date**, date type, **price**. Save syncs to both phones.
- [ ] Undo works on an edit, like other taps.

### 7. 📷 Photos → Claude (packets), in the app (changed 2026-10-10)

Replaces the old "Drive → PC skill → inbox" route. No PC, no Drive.

- [ ] In the app: **📷 take photos of packets** → tap **📖 Read** → Claude (Sonnet-class) reads name, sub, use-by / best-before, packs → **Quick fill to confirm** → added.
- [ ] A small free **Cloudflare Worker** holds the Claude API key (never in the app or the repo). Only signed-in household members can use it.
- [ ] **Budget: under $1/month** (Darren, 2026-10-10). Check the real cost per photo first; cap usage in the Worker.
- [ ] **Packets only in V2.** Receipts (names + prices, no dates) are V3: needs solving how to match them to packets first.

### 8. Fridge sheet

- [ ] **Print** from the PC browser. **New layout (Darren, 2026-10-10):**
  - Remove the **meals** and the **added** sections, so as many items + dates as possible fit.
  - Near the bottom: a strip of the **next 7 days** after printing, e.g. *Mon 12 · Tue 13 · … · Sun 18*.
- [ ] **📷 Scan** with the phone camera in the app, no AI. Skips packs already changed.

### 9. Backups

- [ ] Settings → **⬇️ Backup** (file) and **⬆️ Restore**.
- [ ] PC: weekly automatic backup into Google Drive (uses the PC key file).
- [ ] Warning *"No backup for 7+ days"*.

### 10. Live on both phones

- [ ] **Copy all V1 data** (`FoodTrackerData/food.db`) into the real household: one-off PC script, tests first. Back up `food.db` first. Wipe `tryout`.
- [ ] The 29 photos already read in V1 are covered by this copy. Don't re-read them or load their JSON (doubles).

- [ ] Install on both Samsungs, join the household, use it for a week.
- [ ] Note anything to tune → [💡 V3 ideas](https://github.com/DF-AI-Lab/Food-Tracker/issues/39).

## Not in V2

- Changing the V1 PC app · iPhones · app stores.
- Receipts, prices from receipts, recipes: [💡 V3 ideas](https://github.com/DF-AI-Lab/Food-Tracker/issues/39).
