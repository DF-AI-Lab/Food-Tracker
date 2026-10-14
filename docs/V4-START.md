# V4 — start here (handover, 2026-10-14)

**V3 is finished:** live **v3.15** (n 30), demo **d.v3.15** (n 47). Darren: "leave this as v3".

## V3 in one list (all live)
- Photo Quick fill: photos go straight to Claude via the Cloudflare Worker (`worker/`, `wrangler.toml` at the repo root); list grows, CHECK tags, date fixes, NO DATE tag
- Shopping list tick-off after adding; Added today (collapsed, tap = fridge menu)
- Fridge / Freezer / Cupboard (Misc shown as Other)
- Meals asking card closed until tapped (+ Add, Save as meal)
- Home button with Darren's icon; top bar pinned; bell always shows; fits 320–412px
- Settings: photo cost this month + photos this week
- Eat first opens up; fridge menu shows date · kind · price

## How we work (Darren)
- Mock first for anything that changes the look; tests first; Haiku builds, Sonnet if Haiku fails (CLAUDE.md)
- Build in `v2-next/` (demo) first unless Darren says "straight to live"; swap steps in `docs/V2.5-LOOK-DECISIONS.md`
- Versions: V4 starts at **v4.11** live / **d.v4.11** demo, +.01 each change; `n` keeps counting (live 31+, demo 48+)
- Short, spaced-out replies (ADHD)

## V4 candidates (see `docs/IDEAS.md`, Darren picks)
- Monthly report (bought / used / wasted, better than last month?) in the app + emailed to darrenfawcett1980; geek section (Claude accuracy + cost)
- Improvements section (errors, Claude misreads)
- Notifications; more than one meal a day; admin + kids' version
