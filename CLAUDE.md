# Build & Coding Workflow

When building or modifying code:

1. **Write the tests first**
   - Define the expected behaviour before writing the implementation.
   - Use the tests to verify the build rather than relying only on visual inspection.
2. **Use Haiku for the implementation/build first**
   - Haiku should be the default model for coding/build tasks where practical.
   - Keep token usage and cost as low as reasonably possible.
3. **If Haiku fails**
   - First assess whether the failure can be fixed simply.
   - If Haiku cannot complete the task successfully, retry the build using Sonnet.
4. **If Sonnet also fails**
   - I can take over and complete the work myself.
   - Do not repeatedly retry the same failed approach and waste tokens.
5. **Testing**
   - After building, run the relevant tests.
   - If tests fail, diagnose the failure and fix it using the same escalation path where practical.
6. **Keep me informed while working**
   - Where possible, show short progress updates directly in the chat so I can see what is happening.
   - Keep updates brief and useful, for example:
     - `Haiku building...`
     - `Build complete — now testing...`
     - `Tests failed — Haiku attempting a fix...`
     - `Haiku failed — switching to Sonnet...`
     - `Tests passing — build complete.`

## Main principle

Use the cheapest/simplest approach that reliably gets the job done.

Do not use a more capable model unnecessarily. Keep token usage down, but do not sacrifice correctness just to save tokens.

## Keeping every chat's work (branches)

New chats start from the repo's **default branch**, so work left on a chat's own branch gets lost to the next chat.

- **When I say I'm starting a new chat** (or "wrapping up", "done for now"):
  1. Run the tests. If they fail, tell me and stop.
  2. Commit and push everything.
  3. Open a pull request from this chat's branch into the **default branch** and merge it.
  4. **Don't delete branches** (Darren, 2026-10-25): GitHub deletes old merged branches by itself. Don't try to delete them, list them or ask about them.
  5. Tell me in one line that it's merged, with the PR link.
- **At the start of every chat:** check for other `claude/*` branches with commits not yet on the default branch. If there are any, tell me which and ask before merging them in.
  - **Skip these old ones, never ask about them** (old V1 work from 7–8 Oct, replaced by V2; Darren said leave them, 2026-10-11/12): `claude/adoring-mccarthy-22jl0l`, `claude/festive-hopper-xdzo11`, `claude/nice-thompson-lxinyj`, `claude/stoic-faraday-8q4w4a`.
  - **Also skip these, never ask** (Darren, 2026-10-13): `claude/festive-johnson-vp52uf`, `claude/quirky-hypatia-xx7jyn`, `claude/trusting-dirac-xu88h2`.
  - **And these, never ask** (old V2 work from 11 Oct, replaced; Darren 2026-10-16): `claude/compassionate-ramanujan-r2gukp`, `claude/intelligent-hamilton-romoyo`, `claude/kind-cannon-h6gu82`.
  - **And this one, never ask** (Darren 2026-10-25): `claude/ecstatic-goodall-o1kmfe`.
  - **Only ask about a branch with work from the last 2 days.** Anything older is stale: skip it silently (Darren 2026-10-16).
- **Merge without asking once tests pass** (Darren, 2026-10-11): after each finished build or fix, run the tests; if they pass, commit, push, open a PR into the **default branch** and merge it straight away. Then tell me in one line it's merged, with the PR link. If tests fail, don't merge: tell me.
- Never leave work only on a chat branch at the end of a session without asking me first.

## Things for me to copy

- Whenever I need to copy something (a name, a value, a command, a setting), put it on its own in a code block so I get the copy button. Don't make me select text by hand (Darren, 2026-10-16).

## Photo test API key

- The Claude API key for the photo tests is the environment variable `PHOTO_TEST_API_KEY` (not `ANTHROPIC_API_KEY`, and not a network secret). Run with `ANTHROPIC_API_KEY="$PHOTO_TEST_API_KEY" ANTHROPIC_BASE_URL=https://api.anthropic.com`. If it's empty, tell me the env var is missing (Darren, 2026-10-16).

## App links (Darren, 2026-10-17)

- **Live (real, family):** `https://df-ai-lab.github.io/Food-Tracker/live/` (folder `live/`, version v4.xx, real household `householdId`).
- **Demo (testing):** `https://df-ai-lab.github.io/Food-Tracker/demo/` (folder `demo/`, d.v4.xx, own test household `v4DemoHouseholdId`, red DEMO band + red-outlined icon).
- These links never change: no more new folders or reinstalls. Changes land in place; bump `js/version.js` n + label and `sw.js` VERSION on each change.
- Build and test in `demo/` first unless Darren says "straight to live"; then copy the change into `live/`.
- `v2/` and `v2-next/` are the old V3 apps, kept but no longer worked on.
