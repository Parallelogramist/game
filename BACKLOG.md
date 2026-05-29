# BACKLOG

Single source of truth for deferred work, known issues, and improvement ideas.
**You (the human) drive prioritization** — pick items from "Open" when you want them.
**Claude reads this first** at the start of a session, proposes which to tackle, and
keeps it current.

## How this system works

- Every item has an **ID** (stable handle), **status**, **area**, a short **why**,
  and **pointers** (files / line hints) so any session can pick it up cold.
- **Statuses:** `OPEN` · `IN PROGRESS` · `NEEDS PLAYTEST` (code done, feel/balance
  unverified) · `BLOCKED` · `DONE` · `WONTFIX`.
- When work finishes, move the item to **## Changelog** with its commit hash.
- New ideas/cuts discovered mid-task get appended to **## Open** immediately, so
  nothing lives only in someone's head.
- Keep entries terse. Link code as `path:line`.

ID prefixes: `REFACTOR-` (structure), `BALANCE-` (tuning/feel), `FEAT-` (new),
`BUG-`, `CHORE-` (housekeeping).

---

## Open

### REFACTOR-1 — Split the GameScene god object · OPEN · area: architecture
`src/game/scenes/GameScene.ts` is ~6.5k lines. `create()` ≈ 590 lines,
`update()` ≈ 450, `handleEnemyDeath` ≈ 260.
**Why deferred:** large, high regression risk, no test framework to catch breakage.
Best done in a focused session with careful review.
**Suggested cut lines:** extract cohesive managers — run/meta-bonus application
out of `create()`; pickup + level-up/upgrade flow; spawn-director glue; HUD payload
assembly. `resetAllRunSystems()` (already extracted) is the model to follow.
**Acceptance:** behavior identical, `npm run build` clean, each extraction its own commit.

### REFACTOR-2 — Finish the enemy-AI extraction · OPEN · area: architecture
`src/ecs/systems/enemy-ai/` exists but only has `state.ts` + `index.ts`; the
~29-case AI `switch` still lives in `EnemyAISystem.ts` (~2k lines).
**Why deferred:** big mechanical move, regression risk without tests.
**Plan:** move each AI handler (one per `EnemyAIType`) into its own module under
`enemy-ai/`, keep the switch as a thin dispatcher. More self-contained than REFACTOR-1.

### CHORE-1 — Remove 5 empty directories · OPEN · area: housekeeping
`src/types`, `src/ui/components`, `src/data/enemies`, `src/data/upgrades`,
`src/data/weapons` are empty.
**Note:** git doesn't track empty dirs, so they don't exist in worktrees and there's
nothing to commit. Run `rmdir` in the main checkout locally; purely cosmetic.

### CHORE-2 — Resolve the branch chain · OPEN · area: housekeeping
`worktree-wire-dead-stats` (commit `3db4e75`) is **not merged to master**. All
subsequent work (perf batch, fixes, stat wiring) branches on top of it. Decide
merge order / squash strategy before pushing to remote.

### CHORE-3 — Foreign files swept into the top-10 branch · OPEN · area: housekeeping
A concurrent session running the same "top 10 features" prompt wrote accessibility
files into the `worktree-top10-features` working dir; commit `a76fcf4`'s `git add -A`
swept them in: `src/visual/ColorblindPipeline.ts`, `src/settings/SettingsManager.ts`
(+74), `src/settings/index.ts`, `FEATURE_PLAN.md` (the other plan, vs our
`FEATURES_PLAN.md`). They are unrelated to the 10 features here and build clean, but
were left in place (not deleted) to avoid destroying the other effort's work. Decide
at merge time: keep, drop, or hand back to the accessibility branch.

### FEAT-PERSIST — New field systems not saved on refresh · OPEN · area: save
Refresh-recovery (`GameStateManager`) does not persist: elite **affixes** (affixed
enemies restore as normal-but-tanky), floor **consumables** lying on the ground, and
the temporary **Power shrine** damage buff (its revert `delayedCall` dies on reload).
All non-crash, refresh-only. Mirror the magnet-pickup serialize/restore pattern (or
make consumables explicitly transient like destructibles) when worth it.

### FEAT-VICTORY-GRADE — Show grade on the victory screen · OPEN · area: ui
The death/game-over overlay shows the S–F performance grade + best score; the
separate `PauseMenuManager.showVictory` celebratory screen does not (the score IS
recorded). Add `performanceGrade`/`runScore`/`bestScore`/`isNewBest` to `VictoryData`
and render the badge there for parity.

---

## Needs playtest (code complete, feel/balance unverified)

### BALANCE-1 — Range/speed rebaseline side effects · NEEDS PLAYTEST · area: balance
Re-baselining range/speed to 1.0 (prior session) reactivated a dormant
RunModifiers slow-projectile debuff and a +5% range relic. Verify they feel right
in play. Pointers: `src/data/RunModifiers.ts`, `src/data/Relics.ts`.

### BALANCE-2 — Power-curve mismatch · NEEDS PLAYTEST · area: balance
Player damage is multiplicative; enemy HP is only +15%/level additive (maxed
account ≈ 5–10× dmg vs ≈ 1.3× HP). Katana/Aura feel overtuned; Homing Missiles
undertuned. Needs a holistic tuning pass with real runs — do **not** retune blind.

### BALANCE-3 — Enemy armor values · NEEDS PLAYTEST · area: balance · (new, this session)
Flat armor added to tanky enemies via `ENEMY_ARMOR` table in
`src/enemies/EnemyTypes.ts`. Verify it matters early/mid but isn't brutal early or
trivial late; tune per-type values + Armor Piercing shop scaling. Applied in
`WeaponManager.damageEnemy` (`src/weapons/WeaponManager.ts`).

### BALANCE-4 — Player movement momentum · NEEDS PLAYTEST · area: feel · (new, this session)
Acceleration/momentum now applies to player movement (was instant). Single knob:
`PLAYER_ACCEL_BASE` in `src/ecs/systems/InputSystem.ts` (currently 30). Confirm
default doesn't feel floaty for dodging; raise toward instant or lower for weight.
Also sanity-check Sprint / Battle Flow magnitudes
(`updatePlayerEffectiveMoveSpeed` in GameScene; `PLAYER_COMBAT_RADIUS`).

### BALANCE-5 — Top-10 feature tuning · NEEDS PLAYTEST · area: balance · (new, this session)
All 10 new features are code-complete + build-clean but balance is unverified. Tune:
consumable drop rates + BOMB/FREEZE strength (`spawnRandomConsumable`/`activateConsumable`);
affix roll chance + per-affix scaling (`src/data/Affixes.ts`); Limit Break per-level
bonuses (`LimitBreakUpgrades.ts`); destructible/shrine/bounty cadence + rewards
(`GameScene`); pact difficulty-vs-reward (`src/data/Pacts.ts`); music intensity range
(`MusicIntensityDriver.ts`); grade thresholds (`PerformanceGrade.ts`).

---

## Changelog

(most recent first; see `git log` for full detail)

- `e60d28e` Fix review findings across the 10 new features (gold-mult dead write,
  shrine HP no-op, ripple crash on crates, restore-path resets, victory world-level,
  auto-buy overflow scoring, minion affixes, volatile recursion, aura/heal on crates).
- `562da73` FEAT pre-run Pacts mutator picker (PactSelectScene + `src/data/Pacts.ts`).
- `2d0824c` FEAT post-run performance grade + per-run best score (`PerformanceGrade`,
  `BestScoreManager`) on the results overlay.
- `468a883` FEAT dynamic music intensity (`MusicIntensityDriver` + `MusicManager.setIntensity`).
- `e7a67a7` FEAT in-run bounties (rotating objectives + HUD banner + reward).
- `ecf82bc` FEAT walk-in field shrines (Cleanse/Power/Fortune/Sacrifice).
- `fcc1921` FEAT environmental destructibles (crates, `Destructible` component).
- `b032b3b` FEAT attack telegraphs (`TelegraphManager`; dash/charge/slam windups).
- `a76fcf4` FEAT elite affixes + floating elite HP bars (`src/data/Affixes.ts`,
  `EliteAffixVisualManager`). NOTE: this commit also swept in unrelated accessibility
  files via `git add -A` — see CHORE-3.
- `522d188` FEAT Limit Break overflow upgrades (`src/data/LimitBreakUpgrades.ts`).
- `2ebc173` FEAT floor consumables — bomb/freeze/vacuum/gold (`ConsumablePickupSystem`,
  `WeaponManager.detonateArea`).
- `4365943` Wire armor penetration + 3 movement stats (C9 armor, C10 accel/sprint/combat).
- `d768284` Wire explosionDamage + duration stats into weapon scaling (C7, C8).
- `0bcbbdc` Fix pause-menu pill corners bleeding past rounded border.
- `0c7381b` Fix auto-upgrade: load persisted enable flag on fresh runs.
- `43c43e0` Perf/correctness batch: pool HUD payload, cache meta, split aura draw, etc.
- `3db4e75` Wire dead weapon stats + perf/correctness cleanup (prior session, unmerged).
