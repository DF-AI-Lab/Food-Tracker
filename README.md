# Food Tracker

A phone-first household fridge app: add food fast (taps, typing, voice, photo inbox), see what's going off, plan meals, and print an A4 sheet for the fridge.

**Status:** core V1 working on the PC (plain screens). Pretty look and phone install come next.

## Run it on your PC

1. Download this branch (Code → Download ZIP) and unzip it.
2. Double-click `index.html`. It opens in Chrome.
3. Press F12, then the phone icon, to see it at phone size.

Your food is saved in Chrome on that PC.

## Tests

- `npm test`: logic tests (dates, countdowns, cards, usual buttons)
- `npm run check:screens`: clicks through the real page in Chrome (needs Playwright)

- 🗺️ **Plan and decisions:** [Map: Food Tracker V1 spec](https://github.com/DF-AI-Lab/Food-Tracker/issues/1)
- 📄 **Original brief:** [docs/project-brief.md](docs/project-brief.md)

## V1 at a glance (agreed so far)

- Phone-only web app (PWA), free on GitHub Pages, with the list saved on the phone (IndexedDB) plus Export/Import backup
- 3 tabs: **Fridge** · **Meals** (built last, "Coming soon" until then) · **Add**
- Add food by usual-food buttons, typing (`1211` → 12 Nov), voice, or the photo inbox (photos → Claude chat → JSON → Import)
- Print button on Fridge and Meals for the A4 clipboard sheet
- Built and tested on the PC first, then installed on the phone

## Continue planning

In a new Claude Code session:

```
/anthropic-skills:wayfinder https://github.com/DF-AI-Lab/Food-Tracker/issues/1
```

## Run it on your PC

See [`windows/SETUP.md`](windows/SETUP.md). Install Node.js once, then double-click `windows/install.vbs`.
Your data lives in `FoodTrackerData/food.db`, next to the app folder (not inside it).
