# V3 photo test results (2026-10-12)

35 real packet photos · Haiku · prompt in `tools/photo-test/prompt.txt` · answer key in `tools/photo-test/expected.json`

## Winner: 1000 px

| Size | Runs | ✅ Right | ⚪ Blank | ❌ Wrong |
|---|---|---|---|---|
| 1500 px | 2 | 66 | 2 | **2** (bacon read 24 Oct, not 21, both times) |
| **1000 px** | **3** | **103** | **2** | **0** |
| 768 px | 1 | 33 | 1 | **1** (Dunkers year read 2026, not 2027) |

- Bigger is not always better: the bacon misread happened at 1500 px every time, never at 1000 px.
- Original photos cost the same as 1500 px (Claude shrinks anything bigger itself).
- Every trap passed at 1000 px: "100CT"/"160CT" squashed dates, "I 23"/"J 2"/"J 16" veg codes, "Display until", eggs showing display + best before, upside-down packs.

## Prompt fixes found (now in prompt v2)

- **Names:** the name list made Haiku force matches ("Sausage rolls" → "Sausages"). Now it only matches the exact same food. Names right went from 26/35 to 30/35; the rest are fair variations ("Pork ribs" vs "Ribs").
- **Dates with no label** (Dunkers) are now read.
- **Veg** returns `"kind": "veg"` and never a date. Veg with a printed use by / best before (salad bowl) is a normal item.

## Cost (Haiku 5.5, 1000 px)

- About **$0.0002 per photo** (≈1,000 image + 600 prompt tokens in, ≈80 out).
- 150 photos a month ≈ **$0.03**. Sonnet retries on blank dates add about $0.02. Well under $1/month.

## Double read (two Haiku reads, compare)

- Tried at 1000 px: the two reads agreed on 34/35. The one disagreement was a blank, not a wrong date.
- It can't catch a misread that repeats every time (like the 1500 px bacon). **Not worth doubling the cost for now.**

## Caveats

- Run on the Pro plan through helper agents, not the real API. One small real-API check (about 5p) is still to do once the key is set up.
- One run per size is noisy; 1000 px had 3 runs.

## Recommended setup

1. Phone shrinks to **1000 px** longest side, JPEG ~85, rotation fixed.
2. One Haiku call per photo (thinking off), prompt v2.
3. Blank date → retry that photo on Sonnet.
4. Still blank → amber "check date" on the list.

---

# Real API results (2026-10-13, on Darren's PC)

43 full-size photos · `tools/photo-test/run-api.js` · 1000 px · one photo per call

| Run | Settings | ❌ Wrong dates (of 31 checkable) |
|---|---|---|
| 1 | Haiku, thinking off | **3**: chicken "100CT" read 1 Oct, upside-down scotch eggs read 17 Feb, small chicken read 1 Jan |
| 2 | + thinking on, + past date → Sonnet | **0**, but one chicken came back "no date" without a re-check |
| 3 | + "no date" on non-veg → Sonnet | **0 wrong, 0 silent blanks** ✅ |

- All 3 run-1 misreads were dates in the past. Fresh shopping is rarely out of date, so a past date now goes to Sonnet.
- Thinking on fixed the upside-down scotch eggs by itself.
- Sonnet was used on 4 of 43 photos (9%). One unknown juice drink is still blank and shows CHECK, which is the safe outcome.

## Real cost (run 3)

- Haiku: 43 calls, $0.0151 · Sonnet: 4 calls, $0.0205 · **Total $0.0356 = $0.0008 per photo**
- 150 photos a month ≈ **$0.12**. Well under $1.

## Final settings for the app

1. Phone shrinks to 1000 px, JPEG 85, rotation fixed.
2. Haiku 5.5, thinking on (default), prompt v2, one photo per call.
3. Sonnet 5.5 re-checks when: no date on a non-veg item, a date already past, or an error.
4. Still blank or still past → amber CHECK on the list.
