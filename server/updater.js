// Auto-update for Food Tracker: pulls new commits from GitHub into the app folder.
// Only works when the app folder is a git copy (see windows/setup-updates.vbs).
// Uses Node built-ins only.
const fs = require("node:fs");
const path = require("node:path");
const { execFile } = require("node:child_process");

// Exit code that tells windows/start-server.vbs "restart me" (it loops on this code)
const RESTART_CODE = 3;

// Default way to run git: returns a Promise of trimmed stdout
function defaultRun(cwd) {
  return (cmd, args) =>
    new Promise((resolve, reject) => {
      execFile(cmd, args, { cwd, timeout: 60000, windowsHide: true }, (err, stdout) => {
        if (err) return reject(err);
        resolve(String(stdout).trim());
      });
    });
}

// Pull the latest commits. Returns { updated, restart }.
// Never throws: offline or git errors just mean "no update this time".
async function checkForUpdate({ cwd, run } = {}) {
  const none = { updated: false, restart: false };
  try {
    if (!fs.existsSync(path.join(cwd, ".git"))) return none; // ZIP copy, nothing to pull
    const runGit = run || defaultRun(cwd);

    const before = await runGit("git", ["rev-parse", "HEAD"]);
    await runGit("git", ["pull", "--ff-only", "--quiet"]);
    const after = await runGit("git", ["rev-parse", "HEAD"]);
    if (before === after) return none;

    const diff = await runGit("git", ["diff", "--name-only", before, after]);
    const files = diff.split(/\r?\n/).map(f => f.trim()).filter(Boolean);
    const restart = files.some(f => f.startsWith("server/") || f === "package.json");
    console.log("Food Tracker updated");
    return { updated: true, restart };
  } catch (err) {
    console.warn("Food Tracker update check skipped:", (err && err.message) || err);
    return none;
  }
}

// Check once ~10s after start, then every everyMs. Returns a stop() function.
function startAutoUpdate({ cwd, everyMs = 5 * 60 * 1000, onRestart } = {}) {
  let busy = false;
  const check = async () => {
    if (busy) return; // don't run two pulls at once
    busy = true;
    try {
      const result = await checkForUpdate({ cwd });
      if (result.restart && onRestart) onRestart();
    } finally {
      busy = false;
    }
  };

  const first = setTimeout(check, 10000);
  const timer = setInterval(check, everyMs);
  first.unref();
  timer.unref();

  return function stop() {
    clearTimeout(first);
    clearInterval(timer);
  };
}

// Newest modified time (whole ms) of the server's .js files and package.json.
// Changes when the server code changes on disk. Missing files are ignored.
function serverStamp(appDir) {
  const files = [path.join(appDir, "package.json")];
  try {
    for (const name of fs.readdirSync(path.join(appDir, "server"))) {
      if (name.endsWith(".js")) files.push(path.join(appDir, "server", name));
    }
  } catch (err) {
    // no server folder: only package.json counts
  }
  let newest = 0;
  for (const file of files) {
    try {
      newest = Math.max(newest, Math.floor(fs.statSync(file).mtimeMs));
    } catch (err) {
      // missing file: ignore
    }
  }
  return String(newest);
}

module.exports = { RESTART_CODE, checkForUpdate, startAutoUpdate, serverStamp };
