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
