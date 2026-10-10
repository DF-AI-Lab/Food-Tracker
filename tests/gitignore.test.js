// V2 step 0: the repo is public, so private data and the PC key file must never be committed.
const test = require('node:test');
const assert = require('node:assert');
const { execFileSync } = require('node:child_process');
const path = require('node:path');

const root = path.join(__dirname, '..');

function ignored(p) {
  try {
    execFileSync('git', ['check-ignore', '-q', '--no-index', p], { cwd: root });
    return true;
  } catch {
    return false;
  }
}

test('private files are ignored', () => {
  for (const p of [
    'images/photo.jpg',
    'FoodTrackerData/food.db',
    'food.db',
    'server/data/food.db',
    'firebase-key.json',
    'food-tracker-1a2b3-firebase-adminsdk-xyz12-abc123.json',
  ]) {
    assert.ok(ignored(p), `${p} should be ignored`);
  }
});

test('app files are not ignored', () => {
  for (const p of ['index.html', 'js/app.js', 'package.json', 'v2/index.html', 'tests/fixtures/x.json']) {
    assert.ok(!ignored(p), `${p} should not be ignored`);
  }
});
