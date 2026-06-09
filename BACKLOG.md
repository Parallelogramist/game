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

- [ ] **FEAT-HAZARD-PERSIST — persist live hazard zones across refresh-recovery** · area: save
  **Value:** the last known gap in the proven refresh-persistence vein — a mid-run refresh
  silently despawns active burn/ice/void/energy zones and restarts the hazard spawn clock
  (bounties/shrines/chests/events/stat-buffs/director all round-trip; `GameStateManager.ts`
  has zero hazard fields).
  **Plan:** serialize each active zone (`type`, `x`, `y`, remaining time — see the zone
  struct in `src/systems/HazardZoneSystem.ts`) + the spawner timer as an optional
  `hazardState` on `GameSaveState`, mirroring `shrineState` (`5c40cc1`); restore after
  `resetHazardZoneSystem()` via the existing `spawnHazardZone` path; absent on legacy
  saves → reset defaults, no save-version bump.
  **Test-first:** `GameStateManager.hazard.test.ts` round-trip + legacy cases (mirror the
  bounty/shrine/chest siblings). Acceptance: suite green, `tsc` + `vite build` clean.

- [ ] **FEAT-COLORBLIND-UI — surface the shipped-but-unreachable colorblind mode** · area: accessibility
  **Value:** the accessibility pipeline is fully built and *dead to players* — no UI sets it.
  `ColorblindPipeline` is registered (`src/main.ts`, `src/visual/ColorblindPipeline.ts`,
  `GameScene`), `SettingsManager` persists `colorblindMode`
  (off/protanopia/deuteranopia/tritanopia, junk-immune loader already tested) — but
  `grep colorblind src/game/scenes/` returns nothing.
  **Plan:** add a mode-cycling row to `SettingsScene` (mirror the damage-numbers enum row),
  MenuNavigator-aware, label + current value; apply on change via the existing setter.
  **Test-first:** extract the pure cycle-order/label helper and unit-test it; rest is wiring.

- [ ] **TEST-UPGRADE-SELECTION — regression-lock the level-up offer engine** · area: testing
  **Value:** `src/data/Upgrades.ts` selection logic decides every level-up modal of every
  run and has **no test** (the closed pure-data vein covered `apply()` modules, never this
  engine). A regression ships as dead/duplicate/illegal offers with nothing to catch it.
  **Lock:** `getRandomCombinedUpgrades` (`:747` — weapon-milestone every 5th level,
  new-weapon gating on `canAddWeapon`, banished filtering, no duplicate ids),
  `padWithOverflow` (`:724` — the "late-game level-up is never dead" guarantee),
  `canLevelUpgrade`/`getBlockingGate`/`getBlockingUpgrades` (`BREAK_LEVEL_GATES` 3/6/9),
  and `calculateXPForLevel` (`:270` — the `10 × level^1.5` curve).
  **How:** stub `'../weapons'` (documented vitest pattern) + a minimal fake weaponManager;
  mock storage for the codex weighting. ~20–30 cases, mutation-check the teeth.

## Next

- [ ] **PROPOSE-UPGRADE-RARITY-TIERS — rarity-tiered level-up upgrades** · area: progression
  **Value:** deeper build variety + a second consumer for `luck` (today it only biases
  relic rarity, `2a094e0`). The modal (`getRandomCombinedUpgrades`) has no quality tiers —
  every offer is equally weighted.
  **Plan:** per-upgrade rarity (common/rare/epic) with a luck-biased weighted roll +
  distinct card styling in `UpgradeScene` (the gold "LIMIT BREAK" styling is the
  precedent). Assign rarities across the ~40 upgrades in `Upgrades.ts`; reuse the
  `luckBiasedRarityWeights` shape from `src/data/Relics.ts`. Test-first on the pure
  roll/weights module; keep luck-0 byte-identical to today.

- [ ] **FEAT-TELEGRAPH-COVERAGE — telegraph the remaining heavy attacks** · area: readability
  **Value:** fairness — Dasher/Charger/Warden windups are telegraphed (`b032b3b`), but the
  deadliest hits are not: Exploder detonation, Giant slam, and the three bosses' heavy
  AOEs. Pure readability, zero damage/timing change (same contract as the original).
  **Plan:** hook the existing windup states in `src/ecs/systems/EnemyAISystem.ts` via the
  injected `TelegraphManager` (`src/effects/TelegraphManager.ts` — pooled, quality-aware).
  **Test-first:** extract a pure "AI state → telegraph spec (shape/radius/duration)"
  mapping and unit-test it; the manager hookup is mechanical.

- [ ] **FEAT-TUTORIAL-HINTS — first-run contextual hints** · area: onboarding
  **Value:** onboarding is near-absent and the `tutorialSeen` settings flag is dead
  (persisted in `SettingsManager.ts:37` but read nowhere). New players meet break gates,
  dash, evolutions, and pacts cold.
  **Plan:** small `TutorialHintManager` — one-time hints (move, first level-up, first dash,
  evolution-ready, first miniboss) via the existing `ToastManager`, gated by per-hint
  SecureStorage flags; never repeats, dismissible, wire or retire `tutorialSeen`.
  **Test-first:** the pure "which hint fires given (event, seen-set)" logic.

- [ ] **TEST-SPATIALHASH — first coverage for the spatial-query foundation** · area: testing
  **Value:** `src/utils/SpatialHash.ts` underpins weapon targeting, overkill splash,
  GridBackground warping, and FrameCache — pure, zero-dependency, and untested. A subtle
  cell-math bug is invisible mistargeting everywhere.
  **Lock:** insert/query-radius correctness incl. entities straddling 80px cell boundaries,
  numeric key uniqueness for negative coords, `queryPotentialForEach` parity with the
  allocating query, clear/rebuild, and the `getEnemySpatialHash`/`resetEnemySpatialHash`
  singleton contract. ~15 cases.

- [ ] **FEAT-MENU-NAV-GAPS — keyboard/gamepad nav for the unwired scenes** · area: ux
  **Value:** every run routes through `PactSelectScene` (both weapon-select exits), yet it
  is pointer-only — gamepad/keyboard players hit a wall pre-run. `AchievementScene` and
  `MusicSettingsScene` have the same gap (every other menu scene already uses the shared
  `MenuNavigator`, `src/input/MenuNavigator.ts`).
  **Plan:** wire `MenuNavigator` into the three scenes, mirroring `WeaponSelectScene`.
  **Test-first:** `MenuNavigator`'s pure nav-order/wrap logic gets its first unit test.

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
- [x] **Refresh-persistence vein** — bounty/shrine/chest/event/stat-buff/evolution/
  consumable/affix/director all round-trip (see archive). Last known gap re-filed as
  FEAT-HAZARD-PERSIST (Now).
