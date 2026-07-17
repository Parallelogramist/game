# OPEN-QUESTIONS

Human-gated decisions parked here by fleet agents. Never resolved autonomously.

---

## 2026-07-01 — This repo auto-deploys on push; the fleet charter's push
authorization didn't account for it, and this session pushed before noticing

**What happened:** This session (fleet continuous-build agent) committed and
pushed `1e8467a` (fix) + `e7deb8e` (docs) to `master`, following the fleet
charter's standing rule ("commit AND push is pre-authorized for every repo
except `parallelogramist`, the one public repo whose push publishes the
site"). **That premise is wrong for this repo:** `Parallelogramist/game` is
also public (`"private": false` via the GitHub API) and `master` pushes
auto-deploy to GitHub Pages via `.github/workflows/deploy.yml` — the exact
same risk shape as the parallelogramist exception. This repo's own
`BACKLOG.md` already documented that correctly under **Human gates**:
*"Push / deploy: ... Pushing is an explicit human action — agents never
`git push`."* The push happened before this was cross-checked against the
charter.

**Content risk: low.** The pushed diff is `src/storage/StorageBootstrap.ts`
(added 9 missing keys to a preload list) + a new test file + a `BACKLOG.md`
write-up — no secrets, no credentials, nothing sensitive. It's a real,
verified, backwards-compatible bug fix (see the `BUG-STORAGE-PRELOAD-GAPS`
entry in `BACKLOG.md`). The concern is **process**, not content: the deploy
step itself should have been the human's call, not autonomous.

**Did not attempt to revert/force-push** — that's a second unilateral,
consequential action on a protected public branch and could compound
confusion; leaving it for the human to decide is safer than agent-driven
cleanup.

**Ask for the human:**
1. Confirm this push/deploy is fine to leave live (the change is safe/correct
   as far as this agent can tell).
2. Reconcile the mismatch so it can't recur: either add `game` to the fleet
   charter's push-exception list (`ai-ops/fleet/continuous-build-prompt.md`
   — human edit, agents can't touch `ai-ops/fleet/**`), or update/soften this
   repo's `BACKLOG.md` Human-gates note if the operator actually does want
   fleet auto-push+deploy here now. Until reconciled, a fresh agent reading
   *only* the charter will make the same mistake again.

**Pending while unresolved (agents honoring the repo gate):** local `master`
holds unpushed fleet commits awaiting your push (= Pages deploy):
`ed2dbb3` + `ec796c4` (FEAT-GAUNTLET boss-rush mode, 2026-07-09),
`5d50c79` + `4943ab7` (BUG-DAILY-MODE-RESTORE daily-refresh fix, 2026-07-10),
`cf38937` (BUG-SHIP-ID-NOT-SAVED run-identity fix, 2026-07-10),
`37297d1` (FEAT-BOSS-BASTION 4th boss, 2026-07-10),
`58901ef` (FEAT-WEAPON-SENTRY 16th weapon, deployable turret, 2026-07-10),
`440f1cc` (FEAT-WEAPON-SINGULARITY 17th weapon, gravity-well CC, 2026-07-10),
`e4fcb27` (FEAT-WEAPON-GUARDIAN 18th weapon, reactive retaliation nova, 2026-07-10),
`7e90628` (FEAT-WEAPON-WAKE 19th weapon, movement-driven caustic trail, 2026-07-10),
`d8151ec` (FEAT-BOSS-MITOSIS 5th boss The Legion, 2026-07-10),
plus the docs commits noting this line.

### 2026-07-17 update (fleet planner) — the "pending push" list above is stale;
### repo-sync has been auto-pushing this repo all along

**Correction, verified this session:** the paragraph above ("Pending while
unresolved … local `master` holds unpushed fleet commits awaiting your push") is
**no longer true, and hasn't been for some time**. `git rev-list --count
origin/master..master` is **0** — every commit it lists is already on
`origin/master`, and therefore already deployed to GitHub Pages.

**What pushes them:** `repo-sync.timer` — an enabled systemd *user* timer on the
Deck, every 15 minutes, running `ai-ops/tools/repo-sync-run.sh` →
`ai-ops/tools/repo-sync.mjs`. Its exclusion list is
`const NEVER_PUSH = new Set(['parallelogramist']);` (`repo-sync.mjs:27`) — it
hard-excludes the public site repo **but not `game`**, which is also public and
also auto-deploys on push. `~/.claude/auto-logs/repo-sync.log` shows
`pushed  game — 2↑ pushed`, and `git reflog show origin/master` shows
`update by push` landing ~20-40s after each fleet commit.

**So the state is:** fleet agents *do* honour this repo's `BACKLOG.md` no-push gate
— and a human-owned automation pushes (and thus publishes) their commits anyway,
within 15 minutes. **The gate is real but has no effect.** Nothing has been
sneaking past a guard; the guard simply isn't the last word on this repo.

**No agent action taken** — deciding what *should* be true here is the operator's
call, and it is the same reconciliation ask as the original entry, now with the
missing fact attached. The options are unchanged in shape:
1. **Accept it** — `game` is meant to auto-publish like any other private repo; then
   soften this repo's `BACKLOG.md` Human-gates note so agents stop treating a
   no-op gate as load-bearing.
2. **Enforce it** — add `'game'` to `NEVER_PUSH` in `ai-ops/tools/repo-sync.mjs`
   (a human edit; agents may not touch `ai-ops/fleet/**`, and this is the operator's
   automation regardless), making the gate mean what it says.

Agents continue to honour the gate (commit, never push) until this is decided.
