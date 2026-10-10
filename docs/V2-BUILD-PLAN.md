# Food Tracker V2: build plan (phone app, cloud sync)

Decisions live on the map: [Map: V2 phone app — 2+ phones in sync](https://github.com/DF-AI-Lab/Food-Tracker/issues/40).
This file turns them into build steps. Read the map's ticket comments for the detail behind each line.

## In one glance

- **V2 = a separate phone app.** V1 (the PC app: Node server + SQLite) stays exactly as it is. No data moved.
- 2 people · 2 Samsung Android phones + the PC browser · every device equal.
- **Works offline, then syncs.** Cloud holds the data, the PC can be off.
- **£0:** Firestore free (Spark) plan · GitHub Pages hosting · Google Drive for photos.
- Plain HTML/CSS/JS, **no build step**. Firebase loaded from its CDN (ES modules).

## How we build (from `CLAUDE.md`)

- Tests first, then Haiku builds, Sonnet if Haiku fails. Short progress updates.
- **Get it working first**, plain screens, then pretty.
- **Test early:** each step ends with a small try-out on a real phone where it can.

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

- [ ] Phone: take a photo → Share → Google Drive → `Food Tracker/New`.
- [ ] PC: Google Drive for desktop syncs it; the skill sees it.
- [ ] Skill writes **one item** to `inbox` using the PC key file. See it in the Firebase console.
  - Script: `node tools/inbox-push.js <key-file> tryout tools/tryout-item.json` → `households/tryout/inbox`. Delete `tryout` after.
- Photos go to Drive account **`df.ai.lab.hq@gmail.com`** (owner on the Firebase project), folder `Food Tracker/New`.

### 2. V2 skeleton on GitHub Pages

- [ ] `v2/` copy of the app, opens from the Pages link on a phone (no data yet).
- [ ] Turn on GitHub Pages for the repo.

### 3. Sign-in and household

- [ ] Google sign-in, stays logged in.
- [ ] First person creates the household. **Invite code / QR** → second phone scans → signs in → joins.
- [ ] Settings → **Members** list with ❌ to remove.
- [ ] Load Darren's **V1 photo JSON** (already read from 29 photos) into the real household's `inbox` with `tools/inbox-push.js`. Don't re-read those photos.
- [ ] Security rules: members only. Test that a non-member sees nothing.

### 4. Data layer: Firestore instead of the server

- [ ] `v2/js/db.js` on Firestore with **offline persistence on**.
- [ ] Same `DB` shape as V1, so screens keep working.
- [ ] Add `updatedBy` / `updatedAt` on every save. Keep `foods` up to date on each Add.
- [ ] Load only what each screen needs (keep reads low).

### 5. Sync rules and sync sign

- [ ] ✅ / ⏳ / 📴 on the Today line.
- [ ] Undo check against `updatedBy` / `updatedAt`.
- [ ] Try it: both phones offline, both change things, back online → matches the rules above.

### 6. Install and updates

- [ ] `manifest.json` + icons + service worker → Chrome shows **"Install app"**.
- [ ] Our own **📲 Install** button as a fallback.
- [ ] New version → *"New version, tap to refresh"*.

### 🎨 Look (after the gears work)

The user finds the current look too childish ("looks like a 5 year old did it"). Fix it here, once steps 0–6 work.

- [ ] Ask the user for screenshots of apps whose look they like.
- [ ] Make **2–3 clickable style mock-ups** (open on the phone). User picks one. No tests, no Haiku for mock-ups.
- [ ] Restyle V2 to the picked style (mostly `css/`), then carry on with step 7.

### 7. 📥 Inbox (photos → confirm)

- [ ] Add tab shows *"📷 N waiting to confirm"* → Quick fill → confirm. Confirmed = gone for everyone.
- [ ] Skill moves photos to `Processed`; deleted after 30 days.

### 8. Fridge sheet

- [ ] **Print** from the PC browser (same A4 sheet as V1).
- [ ] **📷 Scan** with the phone camera in the app, no AI. Skips packs already changed.

### 9. Backups

- [ ] Settings → **⬇️ Backup** (file) and **⬆️ Restore**.
- [ ] PC: weekly automatic backup into Google Drive (uses the PC key file).
- [ ] Warning *"No backup for 7+ days"*.

### 10. Live on both phones

- [ ] Install on both Samsungs, join the household, use it for a week.
- [ ] Note anything to tune → [💡 V3 ideas](https://github.com/DF-AI-Lab/Food-Tracker/issues/39).

## Not in V2

- Moving V1 data across · changing the V1 PC app · iPhones · app stores.
- Fully automatic photos (serverless + Claude API), prices/receipts, recipes: [💡 V3 ideas](https://github.com/DF-AI-Lab/Food-Tracker/issues/39).
