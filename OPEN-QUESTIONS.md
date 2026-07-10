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
plus the docs commits noting this line.
