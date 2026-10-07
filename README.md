# Food Tracker

A phone-first household fridge app: add food fast (taps, typing, voice, photo inbox), see what's going off, plan meals, and print an A4 sheet for the fridge.

**Status:** planning. Nothing is built yet.

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
