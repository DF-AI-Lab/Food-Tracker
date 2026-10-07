# Food Tracker — V1 build handover

Read this first. Everything here was decided with the user; the details live on the
[map](https://github.com/DF-AI-Lab/Food-Tracker/issues/1) and its closed tickets.

- **Mock-up (the look and behaviour to copy):** https://claude.ai/artifact/QjhHjFcx2eDxFss6eoeo9E
  (copy: `docs/mockups/fridge-mock.html`)
- **User:** short, well-spaced replies (ADHD). Show short progress updates. Rule: **get it working first**.

## What it is

A phone-only Android **PWA**, hosted free on **GitHub Pages**, data saved **on the phone** (IndexedDB).
No server. Built and tested on the PC in Chrome (phone-size view) first.

## Tech

- Plain **HTML + CSS + JavaScript**. No framework, no build step.
- **IndexedDB** for packs. **Export / Import JSON** for backup.
- **PWA:** manifest + service worker (install + offline).
- **Tests first** (plain Node) for the logic, then build, per `CLAUDE.md`.

## Data: one record per pack

```json
{ "id": 1, "name": "Sausages", "kind": "main", "date": "2026-10-08", "dateType": "use_by",
  "status": "in_fridge", "added": "2026-10-05", "left": null, "frozen": null }
```

- `kind`: `main` | `side` | `misc`. Mains and misc **need** a date; sides may have none (veg).
- `dateType`: `use_by` (default) | `best_before` | `null` (no date).
- `status`: `in_fridge` | `used` | `thrown_away` | `frozen`. `left` = date used/binned. `frozen` = date it went in.

## First build (core V1)

**Top:** `📅 Today · Wed 7 Oct` ··· `🌙 ☀️` · Tabs: **🥶 Fridge · 🍽️ Meals · ➕ Add**

**Fridge tab** — row: **🥶 Fridge · 🧊 Freezer · ♻️ Used · 🛒 Shop**

- Two fixed columns, each scrolls on its own:
  - **🍖 Mains · count** — top ⅔ mains; bottom ⅓ **🧂 Misc**, only packs under 7 days, plus "+ N more, all OK".
  - **🥔 Sides · count** — top ⅔ dated sides; bottom ⅓ **🥕 Veg & misc – no date**, oldest first, "8 days old", amber ⚠️ at 7 days.
- Same-name packs share a card, **max 2 dates**, soonest first; a 3rd pack starts a new card.
- Countdown when 5 days or fewer: "3 days left", "1 day left", "Today!"; past: "1 day out", "2 days out".
- Colours: **green** >3 days · **amber** 3 → 0 days · **red + darker red outline** when out.
- Tap a pack → **✅ Used · 🗑️ Thrown away · 🧊 Freeze · Cancel**.
- **🧊 Freezer:** oldest first, "in 20 Sep · 2 weeks", amber border at 3 months+, **Defrost** → back to fridge, use by tomorrow.
- **♻️ Used:** used / wasted counts this month + list.

**Add tab** — sub-tabs **🥶 Add to fridge · 🛒 Shopping list**

- Main / Side / Misc · ⭐ usual buttons · type box · 🎤 (coming soon)
- Date on one line: **DDMM** (`1211` → 12 Nov, this year, never rolls to next year; `081026` works) **or** **days** box (`3` → today + 3) · Use by / Best before toggle.
- Date box shows the real date + colour; past = "out of date, check?".
- No date only for sides · Packs − 1 + · 🧊 Straight to freezer · **Add** → "✓ added" + ↩ Undo.

**Show "Coming soon":** 🍽️ Meals tab, 🛒 Shopping list, 🎤 voice, 🖨️ print, photo inbox import.

## Look

- **Forest** palette: `#051F20 #0B2B26 #163832 #235347 #8EB69B #DAF1DE`.
- **Floating tiles:** rounded (~14–18px), soft shadows, no hard borders, thin top highlight, roomy gaps.
- 🌙 Dark is the default; ☀️ Light is a mid sage (not pale mint). Copy the tokens from the mock-up.

## Later (not in the first build)

Voice, photo inbox, meal planner, printable A4 sheet, shopping list (+ ideas, ratings, auto-add),
prices / "£ wasted", sharing across phones. All noted on the map.
