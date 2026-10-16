# Photo test rig

- 1) Put photos in `tools/photo-test/photos/`
- 2) Make the sizes: `python3 tools/photo-test/prep.py tools/photo-test/photos tools/photo-test/out`
- 3) Answer key: `tools/photo-test/expected.json`
  - `{ "file.jpg": { "name": "Chicken", "sub": "...", "date": "2026-10-14", "bb": true, "price": 4.5 } }`
  - Use `"noDate": true` for items with no date. Leave out `price` if unknown.
- 4) Results go in `tools/photo-test/out/results-<model>-<size>.json`, same keys
- 5) Score: `node tools/photo-test/score.js tools/photo-test/expected.json tools/photo-test/out/results-*.json`

Note: ❌ wrong is the number that must be 0.

## Real API test (on the PC)

1. `npm install` (once, in the Food-Tracker folder)
2. PowerShell: `$env:ANTHROPIC_API_KEY="your-key"` (same window)
3. Try 2 photos first: put them in a folder and run `node tools/photo-test/run-api.js "C:\path\to\that\folder"`
4. All good? Run the full folder the same way
5. Upload the `results-api-...json` file it saves to Claude to score it
- Settings: 1000 px, Haiku first, Sonnet retry on a blank date. `--no-retry` turns the retry off.

## V4 names test (shopping match)

43 photos (the V3 35 + 8 new), new naming rule (main food + cut, no shop/brand). Prompt: `prompt-v4.txt`. Answer key: `expected-v4.json` (a list of OK names per photo).

Photos live in the Drive folder **Food test photos** (df.ai.lab.hq). `pack-facts.json` holds everything printed on each one (read once by Claude), so answer keys can be rebuilt without the photos.

1. Download the Drive folder into `tools/photo-test/photos`
2. `node tools/photo-test/name-photos.js tools/photo-test/photos` (renames to p01.jpg… and lists any new photos Claude hasn't read yet)
3. `ANTHROPIC_API_KEY="$PHOTO_TEST_API_KEY" ANTHROPIC_BASE_URL=https://api.anthropic.com node tools/photo-test/run-api.js tools/photo-test/photos --prompt prompt-v4.txt --expected tools/photo-test/expected-v4.json` (in the cloud the key is the env var `PHOTO_TEST_API_KEY`)

- Look at **names** and **no brand** on the score line. 🏷 lines show names that didn't match.
- Dates must still be ❌ 0.
