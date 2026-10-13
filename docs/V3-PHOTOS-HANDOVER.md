# V3 part 1 (photos → Claude): handover

Updated 2026-10-13. Issue #89.

## Done ✅

- **Test rig** in `tools/photo-test/` (prompt, scoring, answer key for 35 photos).
- **Model + settings picked** by testing. Full results: `docs/V3-PHOTO-TEST-RESULTS.md`.
- **Real API tested** on Darren's PC: 43 photos, **0 wrong dates**, **$0.0008 per photo** (≈12 cents a month).
- Darren has an Anthropic Console account with $5 credit and a test key `food-tracker-test` (on his PC only).

## Final settings (use these in the Worker)

1. Phone shrinks each photo to **1000 px** longest side, JPEG 85, rotation fixed.
2. **One photo per call**, up to 5 at once. Answer tied to the photo by the app's own id.
3. **Haiku 5.5**, thinking on (default), prompt = `tools/photo-test/prompt.txt` with the household's live name list and the current year.
4. **Sonnet 5.5 re-checks** when: no date on a non-veg item, a date already past, or an error.
5. Still blank or still past → amber **CHECK** on the Quick fill list.
6. Reply fields: `name, sub, date, bb, price, packs, kind ("veg"), noDate`. Veg never has a date.
7. Code to copy: `scanOne` / `needsRetry` in `tools/photo-test/run-api.js`, `parseReply` in `tools/photo-test/lib.js`.

## Decided with Darren

- Photos go **straight from the phone**, nothing is saved (except below). Copy/paste Quick fill and the PC skill stay as fallbacks.
- **Worker = Cloudflare**, free plan. API key lives only in Cloudflare (Darren pastes it himself, never in chat). Make a **separate key** for the Worker.
- Worker checks the **Firebase sign-in + household membership**.
- **Cap: 100 photos per week** per household (Darren may change it).
- **Cost log:** the Worker counts calls and cost per model (Cloudflare KV); the app saves a copy in Firestore. Settings shows e.g. "This month: $0.12 · Haiku 140 · Sonnet 6".
- **Photos both models fail on** are kept (Worker storage, no auto-delete) with the date Darren types in, as new test cases.
- **Waiting screen:** a countdown gauge "7/26", then the check list opens by itself. Design: `designs/6b-quick-fill-auto.html` (Drive Handover pack).
- Never guess: unsure → blank + amber.
- Build in `v2-next/` first, then swap into live `v2/` (steps in `docs/V2.5-LOOK-DECISIONS.md`).

## Next steps

1. 🎨 **Mocks of the countdown gauge** ("7/26") for Darren to pick from.
2. ☁️ **Cloudflare Worker**: walk Darren through the account; Worker with Firebase check, household check, weekly cap, Haiku → Sonnet logic, cost log in KV, failed-photo store.
3. **App (`v2-next/`)**: Take photo / Select images → shrink to 1000 px → Worker → gauge → Quick fill list opens.
4. Tests first, cheapest model first (CLAUDE.md).

## Small open bits

- Dunkers (date with no label) came back "best before". Doesn't change the date; prompt could say no bb when no label.
- Photo names drift a little ("Pork ribs" vs "Ribs"). The live name list in the app should settle repeats.
