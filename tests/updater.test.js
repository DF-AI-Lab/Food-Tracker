// Tests for server/updater.js (auto-update from GitHub) — run with: npm test
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { checkForUpdate, RESTART_CODE } = require("../server/updater.js");

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "ft-upd-"));
const git = (cwd, ...args) => execFileSync("git", args, { cwd, encoding: "utf8" }).trim();

// A fake git: answers from a script of replies, and records each call
function fakeRun(replies) {
  const calls = [];
  const run = async (cmd, args) => {
    calls.push([cmd, ...args].join(" "));
    const key = args[0];
    const r = replies[key];
    if (r instanceof Error) throw r;
    if (typeof r === "function") return r();
    return r ?? "";
  };
  return { run, calls };
}

function gitFolder() {
  const dir = tmp();
  fs.mkdirSync(path.join(dir, ".git"));
  return dir;
}

test("RESTART_CODE is a fixed exit code the Windows script can loop on", () => {
  assert.equal(RESTART_CODE, 3);
});

test("does nothing when the app folder is not a git copy (ZIP download)", async () => {
  const { run, calls } = fakeRun({});
  const r = await checkForUpdate({ cwd: tmp(), run });
  assert.deepEqual(r, { updated: false, restart: false });
  assert.equal(calls.length, 0);
});

test("no new commits: not updated", async () => {
  const { run, calls } = fakeRun({ "rev-parse": "aaa", pull: "Already up to date." });
  const r = await checkForUpdate({ cwd: gitFolder(), run });
  assert.deepEqual(r, { updated: false, restart: false });
  assert.ok(calls.some(c => c.startsWith("git pull --ff-only")));
});

test("new app files only: updated, no restart needed", async () => {
  let n = 0;
  const { run } = fakeRun({ "rev-parse": () => (n++ === 0 ? "aaa" : "bbb"), pull: "ok", diff: "js/app.js\ncss/style.css" });
  const r = await checkForUpdate({ cwd: gitFolder(), run });
  assert.deepEqual(r, { updated: true, restart: false });
});

test("new server files: updated and asks for a restart", async () => {
  let n = 0;
  const { run } = fakeRun({ "rev-parse": () => (n++ === 0 ? "aaa" : "bbb"), pull: "ok", diff: "index.html\nserver/server.js" });
  const r = await checkForUpdate({ cwd: gitFolder(), run });
  assert.deepEqual(r, { updated: true, restart: true });
});

test("offline or git error: no crash, not updated", async () => {
  const { run } = fakeRun({ "rev-parse": "aaa", pull: new Error("could not resolve host") });
  const r = await checkForUpdate({ cwd: gitFolder(), run });
  assert.deepEqual(r, { updated: false, restart: false });
});

test("real git: pulls a new commit from the remote into the app folder", async () => {
  const origin = tmp();
  git(origin, "init", "-q", "--bare", "-b", "main");
  const work = tmp();
  git(work, "clone", "-q", origin, ".");
  git(work, "config", "user.email", "t@t"); git(work, "config", "user.name", "t");
  fs.writeFileSync(path.join(work, "index.html"), "v1");
  git(work, "add", "."); git(work, "commit", "-qm", "v1"); git(work, "push", "-q", "origin", "HEAD:main");

  const app = tmp();
  git(app, "clone", "-q", origin, ".");
  assert.equal(fs.readFileSync(path.join(app, "index.html"), "utf8"), "v1");

  fs.writeFileSync(path.join(work, "index.html"), "v2");
  git(work, "commit", "-qam", "v2"); git(work, "push", "-q", "origin", "HEAD:main");

  const r = await checkForUpdate({ cwd: app });
  assert.deepEqual(r, { updated: true, restart: false });
  assert.equal(fs.readFileSync(path.join(app, "index.html"), "utf8"), "v2");

  const again = await checkForUpdate({ cwd: app });
  assert.deepEqual(again, { updated: false, restart: false });
});

// ---------- restart when server files change on disk ----------
const { serverStamp } = require("../server/updater.js");

test("serverStamp changes when a server file or package.json changes", () => {
  const dir = tmp();
  fs.mkdirSync(path.join(dir, "server"));
  fs.writeFileSync(path.join(dir, "server", "server.js"), "a");
  fs.writeFileSync(path.join(dir, "package.json"), "{}");
  const t0 = new Date("2026-01-01T00:00:00Z");
  fs.utimesSync(path.join(dir, "server", "server.js"), t0, t0);
  fs.utimesSync(path.join(dir, "package.json"), t0, t0);
  const a = serverStamp(dir);
  assert.equal(serverStamp(dir), a);
  const t1 = new Date("2026-01-02T00:00:00Z");
  fs.utimesSync(path.join(dir, "server", "server.js"), t1, t1);
  assert.notEqual(serverStamp(dir), a);
  // app files don't count
  const b = serverStamp(dir);
  fs.mkdirSync(path.join(dir, "js"));
  fs.writeFileSync(path.join(dir, "js", "app.js"), "x");
  assert.equal(serverStamp(dir), b);
});
