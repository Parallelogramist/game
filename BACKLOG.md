# BACKLOG

Single source of truth for deferred work, known issues, and improvement ideas.
Fleet agents: pick the **topmost unchecked item you can finish in one session**
(Now → Next → Later), build it **test-first**, check it off with the commit hash,
append any follow-ups you discover, commit. The human reprioritizes freely.

## How this system works

- Every item has a stable **ID**, a one-line **value** rationale, and **pointers**
  (files / line hints) so any session can pick it up cold.
- `- [ ]` = open, `- [x]` = done. When you finish, check it off in place with
  `(done — <hash>)` and move it to **## Done** (full write-ups → `BACKLOG-archive.md`).
- New ideas/cuts discovered mid-task get appended immediately (Next or Later), so
  nothing lives only in conversation.
- **Never agent work:** anything under **## Human gates** — pushing, deploys,
  publishing, spend, and anything needing a human playing in a browser.
- ID prefixes: `FEAT-` (new), `TEST-` (coverage), `REFACTOR-`, `BALANCE-`/`POLISH-`
  (tuning/feel), `BUG-`, `CHORE-`.

> **Env note for fleet agents (2026-06-09):** `npm run test`, `npx tsc --noEmit`, and
> `npm run build` all run to completion in recent bg sessions (full suite ~473 green in
> <1s). If a session hits a *total* bash hang (even `echo` never returns), don't burn the
> session retrying — a fresh agent clears it. Never `pkill -f vitest` broadly (other fleet
> agents share this host); kill only your own PID. This checkout has a local, gitignored
> `.claude/settings.json` with `{"worktree":{"bgIsolation":"none"}}` so bg edits land on
> `master` (re-create it if the fleet ever runs from a fresh clone).

---

## Now

(empty — next agent: take the topmost Next item)

## Next

- [ ] **FEAT-MENU-NAV-GAPS — keyboard/gamepad nav for the unwired scenes** · area: ux
  **Value:** every run routes through `PactSelectScene` (both weapon-select exits), yet it
  is pointer-only — gamepad/keyboard players hit a wall pre-run. `AchievementScene` and
  `MusicSettingsScene` have the same gap (every other menu scene already uses the shared
  `MenuNavigator`, `src/input/MenuNavigator.ts`).
  **Plan:** wire `MenuNavigator` into the three scenes, mirroring `WeaponSelectScene`.
  **Test-first:** `MenuNavigator`'s pure nav-order/wrap logic gets its first unit test.
  **Follow-up (from FEAT-COLORBLIND-UI review):** gamepad d-pad left/right can't move
  segmented-pill selection anywhere — `MenuNavigator` is built `columns: 1` so it ignores
  left/right (`src/input/MenuNavigator.ts:77–86`), and scenes' own keydown handlers cover
  keyboard only. Affects SettingsScene playbackMode/damageNumbers/colorblind rows; a
  controller-only player can focus a segmented row but only commit the current index.

## Later

- [ ] **TEST-SHOP-ECONOMY — lock the permanent-upgrade economy math** · area: testing
  **Value:** persistent gold spend + unlock/ascension gating ride on
  `src/data/PermanentUpgrades.ts` (~1,100 lines of data) with no direct test: a typo'd
  `costScaling` silently wrecks the meta-game.
  **Lock:** `calculateUpgradeCost` (`baseCost × costScaling^level`, rounding),
  `calculateAccountLevel`, `getUpgradesByCategory` totality, and data integrity over
  `PERMANENT_UPGRADES` (unique ids, valid categories, finite costs, scaling > 1,
  maxLevel ≥ 1, every entry's stat field exists in `PermanentUpgradeState`).

- [ ] **TEST-CONTENT-DATA-INTEGRITY — Affixes / Stages / Ships table locks** · area: testing
  **Value:** the three content tables the closed pure-data vein never reached; same silent
  balance-bug class (a malformed unlock gate or non-finite multiplier ships invisibly).
  **Lock:** `rollAffix` (`src/data/Affixes.ts:78` — `AFFIX_ROLL_CHANCE` honored,
  chanceMultiplier scaling/clamp, distribution over `AFFIX_META`, none on failed roll);
  `Stages.ts` + `ShipCharacters.ts` integrity (unique ids, finite multipliers, unlock gate
  syntax `hidden:<id>` / `worldLevel:<n>` parses, `getDefaultStage`/`getDefaultShip`
  resolve, `getStageById`/`getShipById` round-trip).

- [ ] **REFACTOR-2 (phase 1) — extract regular-enemy AI handlers** · area: architecture
  **Value:** `EnemyAISystem.ts` is 2,076 lines around one ~29-case switch;
  `src/ecs/systems/enemy-ai/` exists but holds only `state.ts` + `index.ts`. Extraction
  unlocks per-handler tests and shrinks the regression blast radius.
  **Plan (this session):** move the **regular** AI handlers (types 0–17) into one module
  per handler under `enemy-ai/`, keep the switch as a thin dispatcher. Mechanical,
  behavior-identical; `tsc` + `vite build` clean; suite green. File phase 2
  (minibosses 50–55) and phase 3 (bosses 100–102) when this lands.

- [ ] **FEAT-PAUSE-RUN-STATS — live build dashboard on the pause overlay** · area: ux
  **Value:** the results overlay shows DPS/damage rows post-run, but mid-run there is no
  way to inspect a build — "is my Katana or my Drone carrying?" is unanswerable while it
  matters. `WeaponManager.getWeaponRunStats()` already exists (used once, GameScene:4379).
  **Plan:** a stats panel on the pause overlay (`PauseMenuManager`): DPS, crit %,
  kills/min, damage taken, top weapons by damage. **Test-first:** pure stat-derivation
  helpers (per-minute rates, top-N ordering).

- [ ] **BALANCE-EXPLODER-FUSE — telegraphed fuse for the Exploder death explosion**
  · area: readability/balance · **BLOCKED on human sign-off — behavior change**
  **Why parked:** FEAT-TELEGRAPH-COVERAGE (`4f18ac4`) covered every *windup-based* heavy
  hit, but the Exploder explodes instantly on death (`GameScene.handleEnemyDeath` →
  `handleExplosion(x, y, 60, 20)`, same frame) — there is no windup to telegraph. Warning
  the player requires adding a fuse delay (e.g. 0.4s armed state before detonation),
  which changes combat timing and Exploder lethality. Same question applies to VOLATILE
  affix detonations (`drainVolatileExplosions`, radius 95). If approved: fuse state in
  `handleEnemyDeath`, ring spec in `src/ecs/systems/enemy-ai/telegraphs.ts`, test-first.

**Parked — bigger than one fleet session; needs its own plan cycle + human kickoff:**

- [ ] **REFACTOR-1 — split the GameScene god object** · area: architecture
  Now **7,648 lines** (grew from ~6.5k since filed). Extract cohesive managers
  (run/meta-bonus application, pickup + level-up flow, spawn-director glue, HUD payload);
  `resetAllRunSystems()` is the model. Multi-session; each extraction its own commit.
- [ ] **FEAT-RUNNER-MODE — new endless-runner game mode** · area: gameplay
  Designed (Area C of `docs/superpowers/specs/2026-05-29-scroll-runner-polish-design.md`)
  but a full new scene (forced auto-scroll `RunnerScene` reusing enemies/weapons/HUD).
  Needs its own brainstorm → plan cycle.

---

## Human gates

Never agent work. The fleet must not do any of these.

- **Push / deploy:** the repo has `origin` and **a push to `master` auto-deploys GitHub
  Pages** (`.github/workflows/deploy.yml`). Pushing is an explicit human action — agents
  never `git push` or add remotes. Publishing/store submission likewise.
- **Playtest queue** (code complete; needs a human in a browser — agents must not retune
  blind):
  - **POLISH-TUTORIAL-HINTS** — one-time contextual hints (`7036e29`; defs in
    `src/tutorial/TutorialHints.ts`). Check: (a) dash-danger toast lands at a readable
    moment (fires on first damage with dash ready — mid-swarm it may be missed), (b)
    first-miniboss toast + warning banner together aren't noise, (c) touch wording shows
    on actual phones, (d) evolution-progress toast doesn't stack awkwardly over the
    upgrade-modal close. To re-test as a new player: clear `survivor-tutorial-hints`.
  - **POLISH-TELEGRAPH-BOSSES** — new windup telegraphs (`4f18ac4`; specs in
    `src/ecs/systems/enemy-ai/telegraphs.ts`). Check: (a) The Machine's 3-beam laser grid
    (800px lines, 1.5s) isn't visual noise over its bullet spam, (b) Void Wyrm sweep lane
    matches where the sweep actually goes (target stored 1 frame after telegraph), (c)
    Horde King ring legibility against the red arena tint, (d) telegraph pool (32) holds
    up in dense Dasher/Zigzag waves with a boss active.
  - **BALANCE-UPGRADE-RARITY** — rarity-tiered level-up offers (`ea51123`;
    `UPGRADE_LUCK_RARITY_BONUS` in `src/data/UpgradeRarity.ts`, assignments in
    `Upgrades.ts`). Check: (a) luck-bias strength feels right at realistic max luck
    (~0.6 → epic weighs 1.9× a common), (b) epic purple card vs weapon-level-up magenta
    card legibility on the same modal, (c) the rarity tag (`halfH - 44`) doesn't collide
    with the gate-warning text on tall cards.
  - **BALANCE-LUCK-DROPS** — luck → relic-rarity bias strength (`2a094e0`;
    `LUCK_RARITY_WEIGHT_BONUS` in `src/data/Relics.ts`). At realistic max luck (~0.6)
    legendary share ~3×'s — confirm noticeable-but-not-broken.
  - **POLISH-DAILY-SCORE-COL** — leaderboard SCORE column + Boot chip width (`45fdd74`;
    `LeaderboardScene.renderEntries` row 720→800, `BootScene.ts:~795`). Check crowding at
    UI-scale extremes.
  - **POLISH-RUN-HISTORY** — "RECENT" strip placement on end overlays
    (`PauseMenuManager.createRecentRunsStrip`, x=28). Check overlap/contrast.
  - **POLISH-RUNNER** — scroll-runner feel: zigzag dart cadence, telegraph readability,
    parallax drift (`GRID_DRIFT_AMPLITUDE` in `GridBackground.ts`,
    `ParallaxBackground.ts`), FPS at high counts.
  - **BALANCE-1** — range/speed rebaseline side effects (reactivated slow-projectile
    debuff + +5% range relic; `RunModifiers.ts`, `Relics.ts`).
  - **BALANCE-2** — power-curve mismatch (multiplicative player damage vs +15%/level
    enemy HP; Katana/Aura hot, Homing Missiles cold). Holistic pass with real runs.
  - **BALANCE-3** — enemy armor values (`ENEMY_ARMOR` in `EnemyTypes.ts`, applied in
    `WeaponManager.damageEnemy`).
  - **BALANCE-4** — player movement momentum (`PLAYER_ACCEL_BASE` in `InputSystem.ts`,
    currently 30; also Sprint/Battle Flow magnitudes).
  - **BALANCE-5** — top-10 feature tuning (consumable drop rates, affix roll chance,
    Limit Break per-level bonuses, destructible/shrine/bounty cadence, pact
    difficulty-vs-reward, music intensity range, grade thresholds).

---

## Done

(Recent; full per-item write-ups and the complete pre-2026-06-09 changelog live in
**`BACKLOG-archive.md`**.)

- [x] **TEST-SPATIALHASH** — first coverage for the spatial-query foundation
  (done — `a712b46`). 22 tests in `src/utils/SpatialHash.test.ts`: insert/query radius
  correctness (80px cell-boundary straddling, inclusive radius edge), negative-coord
  cell keys (floor-vs-trunc), `queryInto` append-only buffer semantics, `queryIds`/
  `queryPotential`/`queryPotentialForEach` parity, clear/rebuild + `size`/`cellCount`,
  `findNearest` (strict maxRadius bound — exactly-at-radius is excluded, now locked —
  and excludeId), `findNearestN` (ascending-distance order, excludeIds, count
  truncation), and the `getEnemySpatialHash`/`resetEnemySpatialHash` singleton contract.
  Teeth verified by 5 hand mutations (floor→trunc, `<=`→`<` distance check, cell-loop
  bound, sort removal, reset no-op) — all killed.
- [x] **FEAT-TUTORIAL-HINTS** — one-time contextual tutorial hints (done — `7036e29`).
  New `src/tutorial/`: `TutorialHintManager` (one SecureStorage key `survivor-tutorial-hints`,
  JSON array of seen ids, corruption-hardened load, singleton + test reset) and pure
  `TutorialHints` (defs table + dash-hint outcome `show/defer/dismiss` +
  `findBlockedEvolution` mirroring checkEvolutions threshold math; 27 tests). Five hints
  wired: first-level-up (was dead — gated on `!isTutorialSeen()` which coach marks set true
  at run start), dash-danger (first damage with dash ready; defers on cooldown, silently
  dismissed once the player dashes; touch wording variant), evolution-progress (on upgrade
  pick, names the lagging stat), first-miniboss (reward framing beside the warning banner),
  shop (migrated off `tutorialSeen` — a pre-run shop visit used to set it and silently kill
  the first-run coach marks; `tutorialSeen` now belongs to coach marks only). 'move' hint
  skipped — coach marks already teach movement. Wording/timing feel → playtest queue.
- [x] **FEAT-TELEGRAPH-COVERAGE** — telegraphed Giant stomp + all boss heavy AOEs
  (done — `4f18ac4`). Pure spec module `src/ecs/systems/enemy-ai/telegraphs.ts` (duration
  = windup, ring footprint ≥ damage radius; 23 tests) now holds ALL telegraph geometry —
  the four existing inline call sites (Zigzag/Dasher/Charger/Warden) migrated to it. New
  hookups: Giant stomp ring (88/1.0s), Horde King slam ring (160+phase×30/1.0s), Void
  Wyrm sweep lane (dist+80 overshoot/0.8s) + pre-burst ring (90/0.3s), The Machine laser
  grid (3 beams × 800/1.5s). Zero damage/timing change. **Exploder deliberately excluded**
  — explodes instantly on death, no windup exists; telegraphing needs a fuse delay =
  behavior change → parked as BALANCE-EXPLODER-FUSE (Later, human sign-off). Visual feel
  → playtest queue (POLISH-TELEGRAPH-BOSSES).
- [x] **PROPOSE-UPGRADE-RARITY-TIERS** — rarity-tiered level-up offers biased by luck
  (done — `ea51123`). Pure module `src/data/UpgradeRarity.ts` (3 tiers, weight =
  `1 + clampedLuck × bonus` mirroring Relics.ts, weighted-order sampler); required
  `rarity` on `Upgrade` (multishot epic, piercing + shieldBarrier rare, rest + overflow
  common); optional `luck` param on `getRandomCombinedUpgrades` fed from
  `PlayerStats.luck` at both GameScene call sites; blue/purple card styling + rarity
  sticker in UpgradeScene (gold overflow/mastered wins). 27 new seeded-deterministic
  tests. **Interpretation note:** luck-0 is preserved as *unbiased* (true uniform
  shuffle) rather than bit-identical — the old `sort(() => Math.random() - 0.5)` was an
  approximately-uniform random-comparator sort, so per-stat offer rates shift
  microscopically (strictly fairer). Tuning → playtest queue (BALANCE-UPGRADE-RARITY).
- [x] **TEST-UPGRADE-SELECTION** — level-up offer engine regression-locked
  (done — `c864929`). 36 invariant tests in `src/data/Upgrades.selection.test.ts`
  (selection is random → set-membership/exclusion asserts across 30 rolls per case):
  `10 × level^1.5` XP curve, break gates 3/6/9 (`canLevelUpgrade`/`getBlockingGate`/
  `getBlockingUpgrades`), codex-weighted new-weapon offers (10/+15/+1-per-5-capped),
  milestone-only NEW weapons gated on `canAddWeapon`, banish filtering everywhere, no
  duplicate ids, and the `padWithOverflow` never-dead-level fallback (incl. milestone
  pad-only-when-empty). Teeth verified by 6 hand mutations — all killed.
- [x] **FEAT-COLORBLIND-UI** — colorblind mode + high contrast surfaced in SettingsScene
  (done — `389edef`). 4-segment Colorblind row (Off/Protan/Deutan/Tritan) + High Contrast
  toggle in the VISUALS card, full MenuNavigator/keyboard wiring; pure
  `ColorblindModeOptions` helper (order/labels/index clamping) with 7 unit tests. Both
  `colorblindMode` and `highContrast` were persisted + consumed by `ColorblindPipeline`
  but set by no UI. Gamepad segmented-row gap filed under FEAT-MENU-NAV-GAPS.
- [x] **FEAT-HAZARD-PERSIST** — live hazard zones + spawner pacing persist across
  refresh-recovery (done — `d4bb744`). Optional `hazardState` on `GameSaveState` mirrors
  `shrineState`; `getHazardState()`/`restoreHazardState()` in `HazardZoneSystem.ts`
  (corrupt/tampered entries skipped, pool-capped); legacy saves → reset defaults. 11 new
  tests (save round-trip + module persistence). **Refresh-persistence vein now closed.**
- [x] **CHORE-1** — five empty src dirs removed (done — 2026-06-09 groom; untracked, no commit).
- [x] **CHORE-2** — branch chain resolved (done — verified 2026-06-09: `3db4e75` + `a76fcf4`
  are master ancestors; worktree branches gone).
- [x] **CHORE-3** — swept accessibility files kept + wired (done — verified 2026-06-09;
  remaining UI gap re-filed as FEAT-COLORBLIND-UI).
- [x] **CHORE-4** — bg-isolation note folded into the env note (done — 2026-06-09 groom).
- [x] **PROPOSE-PURE-DATA-TESTS** — pure-data coverage vein **closed** (done — `9a17001`
  Pacts final; DirectorSystem `c0ab86d`, RunModifiers `706e823`, WeaponEvolutions
  `5a00de6`, PerformanceGrade `5940c9a`).
- [x] **Dead-stat vein closed** (done — `2a094e0` luck final; `501b5bc` weaponSynergy,
  `457a755` slowResistance, `4d4386e` chainLightningCount). No write-only PlayerStats
  field remains.
- [x] **Corruption-hardening vein closed** (done — `15cdf16` MusicManager final; every
  SecureStorage loader hardened + tested).
- [x] **Refresh-persistence vein closed** — bounty/shrine/chest/event/stat-buff/evolution/
  consumable/affix/director all round-trip (see archive); hazard zones were the last gap
  (`d4bb744`, FEAT-HAZARD-PERSIST above).
