---
name: check-my-food-photos
description: Read Darren's food packet photos from the Food Tracker "images/New" folder, return a JSON list for the Food Tracker app's Quick fill, then move the photos to "images/Processed". Use when Darren says "check my food photos" or runs /check-my-food-photos.
---

# Check my food photos

Turn photos of food packets into a JSON file that Darren drags onto his Food Tracker app.

Darren has ADHD. Keep every message short and well spaced. No walls of text.

## Folders

- Photos to read: `C:\Users\User\OneDrive\Desktop\CLAUDE_HQ\01_PROJECTS\Food-Tracker\images\New`
- Move them here when done: `C:\Users\User\OneDrive\Desktop\CLAUDE_HQ\01_PROJECTS\Food-Tracker\images\Processed`

If you can't open the folder, ask Darren to share or attach it. Don't guess.

Only read image files (jpg, jpeg, png, heic, webp). Ignore everything else.
If `New` is empty, say "No new photos 👍" and stop.

## Steps

1. Look at **every** photo in `New`.
2. Make **one entry per photo**. Never merge photos, even if two look like the same item.
3. If anything is unclear (a blurry date, an unknown item), **ask Darren**. List all the questions at once, numbered and short. Never guess a date.
4. Show the list as a short table: name · date · price. Ask "All good?"
5. Once he says yes:
   - Save the JSON as `food-YYYY-MM-DD-HHMM.json` in the `images` folder (one level above `New`).
   - Give it to him as a **download** too.
6. Move every photo you read from `New` to `Processed`. If a file name is already taken, add `-2`, `-3` and so on.
7. Finish with one line: "Done ✅ X items. Drag the file onto the app."

## Each entry

| Field | Rule | Example |
|---|---|---|
| `name` | Short main name, see below. Always present. | `"Chicken"` |
| `sub` | Full name from the packet, with brand | `"Asda chicken breast fillets"` |
| `date` | `YYYY-MM-DD`. The **use by** date, or the **best before** date if there's no use by. **Ignore "display until".** Day + month only → this year. | `"2026-10-12"` |
| `price` | A number, only if a price is printed on the label. Never guess. | `3.5` |
| `bb` | `true` only when the date is a best before | `true` |
| `packs` | Only when the photo shows **more than one** of the same pack | `3` |
| `noDate` | `true` only when a packet clearly has **no date printed anywhere** (some margarine tubs, ketchup). Leave out `date`. | `true` |

Leave out any field you don't have. Don't write `null` for it.

**Fresh veg and fruit** (loose or bagged: potatoes, carrots, onions, apples…): `name` only, plus `sub` if there's a label. **No date.** The app tracks how old it is.

## Names must match

The app matches foods by `name`, so keep names short and the same every time:

- No brand, no size, no "fillets", "British" or "5% fat". Those go in `sub`.
- Use Darren's usual names when they fit: Chicken, Mince, Sausages, Gammon, Bacon, Salmon, Milk, Eggs, Margarine, Butter, Cheese, Yoghurt, Bread, Potatoes, Carrots, Onions, Broccoli, Peppers, Mushrooms, Leeks, Cabbage, Coleslaw, Cauliflower cheese, Dauphinoise potatoes, Roast potatoes, Sweetcorn cobs.
- Capital first letter, everything else lower case. Plural when that's how you'd say it ("Sausages", "Eggs").

## Output

Reply with only a JSON array in the file, like this:

```json
[
  { "name": "Chicken", "sub": "Asda chicken breast fillets", "date": "2026-10-12", "price": 3.5 },
  { "name": "Milk", "sub": "Cravendale semi skimmed 2L", "date": "2026-10-15", "bb": true },
  { "name": "Mince", "sub": "Tesco beef mince 5%", "date": "2026-10-10", "packs": 3 },
  { "name": "Potatoes" }
]
```
