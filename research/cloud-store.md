# Which free cloud store syncs the phones? (issue #41)

Researched 9 Oct 2026. Official vendor pages (firebase.google.com, supabase.com, developers.cloudflare.com)
were blocked from the research sandbox, so figures come from search snippets of vendor docs and third-party
pricing guides. **Re-check the numbers on the vendor pages before building.** Items marked (unverified) conflict between sources.

## Recommendation

**Firebase Firestore (Spark plan, free).** Runner-up: **Cloudflare Workers + D1** (plus our own small offline queue).

Why Firestore wins:
- Offline-first is built in: the web SDK keeps an IndexedDB cache, queues writes while offline, and syncs on reconnect.
- Spark plan needs **no credit card** and, per Google, usage of a product is **shut off** when the free quota runs out (not billed). Surprise bill risk: effectively none unless we upgrade to Blaze.
- Our size is tiny against the quota (see table).
- Plain JS works with no bundler: ESM `import` from the Firebase CDN (gstatic) URL.
- Login is free and simple: Anonymous, Google sign-in, or email link. A household can share one list by sharing a household id plus security rules.

## Our size

One household, a few hundred packs (each ~1 KB), 3-4 phones, a few hundred writes/day, maybe a few thousand reads/day.
Data is well under 1 MB.

## Comparison

| Option | Free limits vs us | Real offline? | Login | Plain JS via CDN | Card / bill risk |
|---|---|---|---|---|---|
| **Firestore (Spark)** | 1 GiB stored, 50k reads/day, 20k writes/day, 20k deletes/day. We use about 1-3% | **Yes, built in** (persistentLocalCache + multi-tab manager, IndexedDB, queued writes, last-write-wins per field/doc) | Anonymous, Google, email link; free | Easy: `import ... from "https://www.gstatic.com/firebasejs/<ver>/firebase-firestore.js"` | No card on Spark. Over quota = that product is switched off for the month, not billed. Only Blaze (card) bills (~$0.09 per 100k writes) |
| **Supabase** | 500 MB DB, 5 GB egress/mo (one source says 500 MB, unverified), 50k MAU, 2 projects | **No.** Realtime and REST need network; we would hand-build the offline queue | Email, magic link, Google; free | Easy: supabase-js ESM from esm.sh/jsdelivr | No card on free. **Project pauses after 7 days of inactivity** and must be restored by hand. That is a real risk for a food app. Also new-project Postgres grants change (30 Oct 2026 for existing) |
| **Cloudflare Workers + D1** | D1: 100k rows written/day, 5M rows read/day, 5 GB. Workers 100k requests/day (unverified here). Indexed insert counts 2 rows | **No.** We build it: local IndexedDB is truth, a queue pushes to a Worker, pull on open | None built in. Roll our own (shared passphrase / Cloudflare Access / simple token) | Server side is a small Worker script (deploy needs wrangler CLI or dashboard paste). Client is plain `fetch` | Free plan has hard daily caps (queries error when hit). Card not needed for free plan (unverified). Very low bill risk |
| **Cloudflare Workers KV** | 1,000 writes/day, 100k reads/day, 1 GB; resets 00:00 UTC | No (same as D1) | None built in | Same as D1 | Hard caps. Okay for a single JSON blob, but 1,000 writes/day is tight and eventually consistent (about 60s) |
| **PocketBase on PocketHost** | Free tier: 1 project, fair-use CPU/storage/bandwidth | **No** (SDK does not queue offline writes) | Email/password, OAuth built in | Easy: PocketBase JS SDK ESM from CDN | Free tier, no card stated. Depends on one small host's goodwill ("10-year endowment"). Fly.io self-host now needs a card (sources conflict) |
| **Turso** | Listings say 100 DBs, 5 GB, 500M rows read, 10M written per month (unverified; one report says 500 MB) | Offline writes exist but are **beta**, conflict resolution not implemented, and the SDKs are not made for browser-CDN use | None (bring your own) | Poor fit: needs a backend or WASM sync SDK | Free plan does not bill overage (must upgrade). Low risk but wrong shape |
| **CRDT libs (Yjs, Automerge)** | Free libraries; need a relay or server to sync phones | Yes (local-first by design) | None | Possible via ESM CDN, but we must supply storage + transport (y-websocket needs a server; y-webrtc needs a signalling server and both phones online) | Depends on the server we pick. Most moving parts of all |
| **Jazz Cloud** | No confirmed free-forever tier (1-month trial, paid after) | Yes | Built in | Needs npm packages | Fails the "free" test |
| **Replicache / PowerSync / Electric / Zero** | Need a Postgres backend | Yes | Varies | Need a bundler | Fails the "no build, cheap" test |

## Notes on Firestore for this app

- Enable offline cache with `initializeFirestore(app, { localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }) })`.
- A PWA installed on Android works offline: reads come from cache, writes queue and flush when back online.
- Known gotcha: a firebase-js-sdk issue (v11) reports that offline writes did not always fire `onSnapshot` with multi-tab persistence. Test on a real phone in airplane mode early. Fallback is single-tab manager.
- Conflicts: last write wins per document. Store one doc per pack (matches our one-record-per-pack model) so two phones editing different packs never clash.
- Maps cleanly onto the current schema: `households/{id}/packs/{packId}` with the same fields as docs/BUILD-HANDOVER.md.
- Security: Firebase web config keys are public by design. Safety comes from Firestore security rules (only signed-in household members read/write). Writing the rules is required, not optional.
- Keep a JSON export (already in the plan) as an escape hatch from vendor lock-in.
- Today the app uses SQLite via a local Node server (`server/server.js`, `js/db.js`). Moving to Firestore means replacing that data layer with a small adapter, so the UI code stays unchanged.

## Why not the others (one line each)

- Supabase: no offline, and free projects pause after a week unused.
- Cloudflare D1: strong free caps and a hard stop, but we write the offline sync and login ourselves. Good fallback if we want zero Google dependency.
- PocketBase: nice, but no offline queue and relies on a small free host.
- Turso / CRDTs / Jazz: wrong shape (no bundler, extra servers, or not free).

## Open checks before building

1. Confirm Spark quotas and "no card" on the Firebase pricing page (blocked here).
2. Confirm Cloudflare Workers/D1 free plan needs no card (unverified).
3. Pick the CDN version of the Firebase SDK (exact version, not "latest").
4. Prove offline write -> reconnect sync on two real phones before migrating all data.

## Sources

- https://costbench.com/software/database-as-service/firestore/free-plan/
- https://www.budgetforge.dev/tools/firebase-pricing-2026
- https://firebase.google.com/docs/reference/js/firestore.persistentlocalcache
- https://github.com/firebase/firebase-js-sdk/issues/8696
- https://www.jetadmin.io/blog/supabase-pricing-2026-guide-to-plans-limits-and-real-world-costs/
- https://costbench.com/software/database-as-service/supabase/free-plan/
- https://developers.cloudflare.com/d1/platform/pricing/
- https://developers.cloudflare.com/kv/platform/pricing
- https://turso.tech/pricing.md
- https://turso.tech/blog/introducing-offline-writes-for-turso
- https://pockethost.io/docs/faq
- https://render.com/articles/platforms-with-a-real-free-tier-for-developers-in-2026.md
- https://jazz.tools/pricing
