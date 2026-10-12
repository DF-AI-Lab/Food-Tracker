# Photo test rig

- 1) Put photos in `tools/photo-test/photos/`
- 2) Make the sizes: `python3 tools/photo-test/prep.py tools/photo-test/photos tools/photo-test/out`
- 3) Answer key: `tools/photo-test/expected.json`
  - `{ "file.jpg": { "name": "Chicken", "sub": "...", "date": "2026-10-14", "bb": true, "price": 4.5 } }`
  - Use `"noDate": true` for items with no date. Leave out `price` if unknown.
- 4) Results go in `tools/photo-test/out/results-<model>-<size>.json`, same keys
- 5) Score: `node tools/photo-test/score.js tools/photo-test/expected.json tools/photo-test/out/results-*.json`

Note: ❌ wrong is the number that must be 0.
