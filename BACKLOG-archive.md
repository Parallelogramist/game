# BACKLOG archive

Completed history moved out of `BACKLOG.md` (groomed 2026-06-09). Newest first.
Active work lives in `BACKLOG.md` — this file is append-only history.

---

## Resolved Open items (closed at the 2026-06-09 groom)

- **CHORE-1 — Remove 5 empty directories · DONE 2026-06-09.** `src/types`,
  `src/ui/components`, `src/data/enemies`, `src/data/upgrades`, `src/data/weapons`
  rmdir'd in the main checkout (untracked by git, nothing to commit).
- **CHORE-2 — Resolve the branch chain · DONE (verified 2026-06-09).** `3db4e75`
  (worktree-wire-dead-stats) and `a76fcf4` (worktree-top10-features) are both
  ancestors of `master`; the worktree branches no longer exist. Nothing left to merge.
- **CHORE-3 — Foreign files swept into the top-10 branch · DONE (verified 2026-06-09).**
  The accessibility files swept in by `a76fcf4` were kept and have since been wired:
  `ColorblindPipeline` is registered in `main.ts`/`GameScene`, `SettingsManager`
  persists `colorblindMode`. Remaining gap (no Settings UI) filed as FEAT-COLORBLIND-UI.
- **CHORE-4 — Local `.claude/settings.json` disables bg worktree-isolation.** Purely
  informational; folded into the env note at the top of `BACKLOG.md`.

## Closed proposal veins (full notes)

### PROPOSE-PURE-DATA-TESTS — regression-lock the untested pure data modules · DONE · area: testing
The "add missing coverage for a pure, marquee, multi-consumer module" vein (PerformanceGrade
`5940c9a`, DirectorSystem round-trip `9a70746`, WeaponEvolutions `5a00de6`,
**RunModifiers `706e823`**) covered each pure module whose `apply`/selection math silently
mutates `PlayerStats` or drives spawns, where a typo'd field, wrong sign, or unreachable id
ships as a quiet balance/dead-feature bug with nothing to catch it. **VEIN CLOSED
(2026-06-07) — every candidate is now covered; no pure, browser-free `apply`/selection data
module remains untested.** A future need here would be a *new* data module, not this vein.
- ✅ **`src/data/Pacts.ts`** — **DONE `9a17001`** (29 cases). 5 `apply` fns (pre-run curses),
  Phaser-free. Locked data integrity (unique ids, non-empty id/name/description/reward, finite
  color); `MAX_PACTS` is a positive integer AND reachable (pool ≥ MAX_PACTS, since
  PactSelectScene caps distinct picks at MAX_PACTS); `getPactById` round-trip; each `apply`'s
  exact factor/delta vs the real `createDefaultPlayerStats` baseline with a `changedKeys`
  no-stray-write guard + coverage lock; a direction lock (gold reward always rises, no reward
  regresses, curse pacts raise `curseMultiplier`, fragility pacts drop their knob — catches a
  flipped sign independent of the factor spec); a stacking lock (additive curses sum,
  multiplicative rewards compound — pacts are the one selection that stacks, up to MAX_PACTS);
  and finite/health invariants. Teeth verified by mutation.
- ✅ **`src/systems/DirectorSystem.ts`** — **DONE `c0ab86d`** (22 cases). Only the save
  round-trip was tested (`9a70746`); now the credit-accrual rate, the per-enemy spawn-cost
  formula (component weights + category multipliers + sqrt/floor + id-keyed cache), the
  per-strategy biasing, and the affordability/no-candidate/save branches of
  `pickEnemyFromDirector` are locked, plus a real-data integrity check (every `ENEMY_TYPES`
  cost a finite int ≥ 1, tiers cost-ordered). Strategy pinned + `Math.random` mocked per
  branch for determinism; teeth verified by mutation.
- ✅ **`src/data/RunModifiers.ts`** — **DONE `706e823`** (48 cases). 15 (not 17) `apply` fns,
  Phaser-free; biggest surface, highest payoff. Locked data integrity + `selectRunModifiers`
  invariants + each `apply`'s exact factor/delta vs the real `createDefaultPlayerStats`
  baseline, with a `changedKeys` no-stray-write guard and a coverage lock so a new modifier
  without a spec fails the suite.

Pattern is proven and low-risk: import the module (stub `'../weapons'` only if it transitively
pulls `Upgrades.ts`), assert data integrity + `apply`/selection behaviour against `PlayerStats`.
One module per session, test-first, ~15-25 cases each.

> **Dead-stat vein — FULLY CLOSED (2026-06-06).** A full grep of every PlayerStats field
> written by a data file (`Relics`/`Upgrades`/`LimitBreakUpgrades`/`PermanentUpgrades`/
> `Pacts`/`RunModifiers`/`ShipCharacters`) against reads in any system/weapon/collision
> path found exactly **four** write-only no-ops, now **all shipped**: `weaponSynergy`
> (`501b5bc`), `slowResistance` (`457a755`), `chainLightningCount` (`4d4386e`), and the
> last one **`luck` (`2a094e0`)** — wired to bias relic-drop rarity via the existing rarity
> system (not the upgrade modal, which has no tiers — see PROPOSE-UPGRADE-RARITY-TIERS above
> for that net-new option). Every other field — including the heuristic's low-read
> `attackSpeedMultiplier`/`gemValueMultiplier`/`iframeDuration`/`rangeMultiplier`/
> `projectileSpeedMultiplier` — was verified genuinely consumed. **No write-only PlayerStats
> field remains;** a new dead stat would only appear with a *new* upgrade/relic.

> **The corruption-hardening vein is CLOSED (2026-06-06).** Every SecureStorage
> loader in the codebase is now hardened + tested: BestScore `0b81956`,
> Combo-restore `2a283e0`, Ascension `bb7e00f`, MetaProg `1232d43`, Achievement
> `6de57f7`, Codex `38599e4`, Settings `b0377f7`, and the final one **MusicManager
> `15cdf16`** (which turned out crash-class, not the "low-impact BGM prefs" this
> note had assumed — a non-finite stored volume throws on the Web Audio gain node,
> per-frame via the intensity driver). No un-hardened persistence loader remains;
> a future tamper-resilience need would be a *new* surface, not this vein.


---

## Changelog

(most recent first; see `git log` for full detail)

- `caaba4e` FEAT-CARDS-1 — **card collection + scanner lottery meta-progression**,
  the Sky Force Reloaded-inspired meta loop from the 2026-07-03 session. Durable
  design source of truth: `docs/superpowers/specs/2026-07-03-card-collection-meta-design.md`
  (read it before touching cards — it carries the frozen public API contract).
  **Data:** `src/data/Cards.ts` — 24 cards (10 common / 8 rare / 4 epic / 2
  legendary, rarity weights 60/30/9/1), small permanent passives (spec magnitude
  bands: cards are seasoning, the shop is the meal), `rollCardRarity` /
  `pickUndiscoveredCard` (nearest-rarity fallback, null only on complete archive) /
  `aggregateCardBonuses` (identity defaults). **Persistence:**
  `src/meta/CardCollectionManager.ts` singleton — `survivor-meta-cards` via
  SecureStorage (registered in `StorageBootstrap.ALL_STORAGE_KEYS`,
  corruption-hardened rebuild from known ids), pending-reveal queue, scanner
  `scan()` with epic-or-better **pity every 8th** sub-epic roll (SCAN_COST=500,
  gold spent by the caller via MetaProgressionManager). ~55 unit tests across
  both modules. **In-run:** GameScene applies aggregated bonuses at run start
  alongside the shop tracks (damage/attack-speed/gold/xp/magnet/move-speed mults,
  maxHealth/crit/armor/luck/reroll/banish adds, startAtLevel); data caches roll in
  `handleEnemyDeath` (boss 100% / miniboss 20% / elite 2%, once per run — the
  guard syncs with the persisted pending reveal AND is saved in the run save,
  because showVictory() consumes the reveal while a post-victory endless run
  continues; a reload there must not re-arm the drop). `ultChargeRateMult` got a
  real application point: new `setUltimateChargeRateMultiplier` hook in
  UltimateSystem (reset- and save-restore-aware, 4 tests) so Surge Array (+10%
  ult charge rate) isn't a dead epic. **Reveal:** end-screen "NEW CARD
  DISCOVERED" panel on BOTH death and victory overlays (PauseMenuManager),
  stagger-integrated, rarity glow pulse timed to the panel's LAST staggered
  element. **Archive:** new CardsScene — 6×4 grid ('?' slots with 40%-blended
  rarity hairlines, discovered mini-MenuCards), scanner panel (gold readout,
  pity countdown, DECRYPT, defensive refund if the archive completes mid-roll,
  ARCHIVE COMPLETE end state), reveal flip + glow with reduced-motion fallback,
  full MenuNavigator nav, shutdown-clean tweens, layout centered per-axis in the
  live EXPAND viewport (sibling-scene pattern). Fifth CARDS deck entry in
  BootScene; registered in main.ts. Built by a 4-implementer + 2-verifier agent
  workflow; all 5 verifier code findings fixed pre-commit (inert ultChargeRateMult,
  hardcoded 1280×720 CardsScene layout, glow-pulse timing, endless-reload cache
  guard, orphaned JSDoc). Known deviations + the reveal-deflation design nuance
  → FEAT-CARDS-2; feel/balance checklist → playtest queue (POLISH-CARDS).

- `9a17001` PROPOSE-PURE-DATA-TESTS (Pacts) — **regression-lock `Pacts.ts`**, the **final**
  candidate in the "add coverage for a pure, marquee, multi-consumer module" vein (after
  DirectorSystem `c0ab86d` / RunModifiers `706e823` / WeaponEvolutions `5a00de6` /
  PerformanceGrade `5940c9a`) — **vein now CLOSED**. The 5 pre-run pacts (player-chosen
  curses) each `apply` a curse + reward to `PlayerStats` at run start and had **no test file**,
  so a typo'd field, flipped sign, or wrong factor would ship as a quiet balance bug — a curse
  that helps the player or a reward that shrinks, with nothing to catch it. New `Pacts.test.ts`
  (29 cases): **data integrity** (unique ids, non-empty id/name/description(downside)/
  reward(upside), finite numeric color, `apply` is a fn); **`MAX_PACTS`** is a positive integer
  AND reachable (pool ≥ MAX_PACTS distinct pacts — PactSelectScene caps distinct picks at
  MAX_PACTS, so a smaller pool would make the cap unreachable); **`getPactById`** by-reference
  round-trip + undefined on unknown/empty; **per-pact `apply` lock** (table-driven) — every
  documented field hits its exact factor/delta computed from the real `createDefaultPlayerStats`
  baseline, with a `changedKeys` guard failing on any undocumented write and a coverage lock
  failing if a pact lacks a spec, plus `apply` returns undefined (mutates in place);
  **direction lock** — gold reward always rises, no reward (gold/xp) ever regresses, curse pacts
  raise `curseMultiplier`, fragility pacts drop their documented knob (catches a flipped sign
  independent of the factor spec); **stacking lock** — pacts are the one selection that
  explicitly stacks (up to `MAX_PACTS`, unlike RunModifiers' one-per-category): additive curses
  sum, multiplicative rewards compound, and a full MAX_PACTS stack stays finite + health-valid;
  **invariants** — no pact yields a non-finite stat or leaves `currentHealth > maxHealth` /
  `maxHealth <= 0`. Stubs the `'../weapons'` boundary (documented vitest pattern) so the real
  `Upgrades.ts` baseline loads in Node. Teeth verified by mutation (curse sign flip, iframe
  factor flip, stray `armor` write → 6 failures) then reverted. Pure test addition, no
  production change. Full suite **473 green** (+29), `tsc --noEmit` exit 0. Self-discovered.
  **PROPOSE-PURE-DATA-TESTS is now fully closed — no untested pure data module remains.**
- `c0ab86d` PROPOSE-PURE-DATA-TESTS (DirectorSystem) — **regression-lock the credit/cost/
  selection math of `DirectorSystem.ts`**, the credit-budget spawn director that paces every
  run (same "add coverage for a pure, marquee, multi-consumer module" vein as RunModifiers
  `706e823` / WeaponEvolutions `5a00de6` / PerformanceGrade `5940c9a`). Only its save
  round-trip was covered (`9a70746`); the accrual rate, the spawn-cost formula, the
  per-strategy biasing, and the branch logic that actually decides what spawns were all
  untested — a typo'd coefficient or sign would ship as a silent, invisible balance bug. New
  `DirectorSystem.test.ts` (22 cases): **`getEnemyCost`** — exact component weights
  (health, 1.5× damage, sqrt(xp)), category multipliers (Elite ×2 / Miniboss ×8 / Boss ×30),
  the sqrt/`Math.max(1,…)` floor, finite-integer post-condition, and the id-keyed cost cache
  + its clear on reset; **credit accrual** via `updateDirector`/`getDirectorState` — exact
  `rate(gameTime,worldLevel) × delta`, +15%/level world scaling (and <1× below level 1),
  time-rising rate, the backward-time / no-negative-credits clamp, disabled-director no-op;
  **strategy selection** — forced set/return, the RNG→4-strategy mapping, reset re-roll;
  **`pickEnemyFromDirector`** — disabled fallback delegation, save→null, exact-cost
  deduction, unaffordable→cheapest balance-floor, no-candidate→basic (no deduction); plus
  direct state get/restore/reset round-trips and a real-data integrity lock (every
  `ENEMY_TYPES` cost a finite int ≥ 1; tiers stay cost-ordered). Strategy pinned and
  `Math.random` mocked per branch so the suite is deterministic against the real RNG. Teeth
  verified by mutation (damage coefficient, Elite multiplier, credit timeScale) → 5 failures,
  then reverted. Pure test addition, no production change. Full suite **444 green** (+22),
  `tsc --noEmit` exit 0. Self-discovered. **PROPOSE-PURE-DATA-TESTS now has one candidate
  left (`Pacts.ts`).**
- `706e823` PROPOSE-PURE-DATA-TESTS (RunModifiers) — **regression-lock the untested
  `RunModifiers.ts`**, the biggest-surface candidate in the "add coverage for a pure,
  marquee, multi-consumer module" vein (after PerformanceGrade `5940c9a`, DirectorSystem
  round-trip `9a70746`, WeaponEvolutions `5a00de6`). The module's 15 per-run modifiers each
  mutate `PlayerStats` at run start via `apply`, plus `selectRunModifiers` / `getModifierById`
  — all uncovered, so a typo'd field, wrong sign, or wrong factor shipped as a silent balance
  bug. New `RunModifiers.test.ts` (48 cases): **data integrity** (unique ids, non-empty
  id/name/description, valid category, `apply` is a fn, all four categories present);
  **`getModifierById`** exact by-reference round-trip + undefined on unknown/empty id;
  **`selectRunModifiers`** invariants that are total over any shuffle (so non-flaky against the
  real `Math.random`): two distinct-category picks by default, count 0/1/negative bounds, caps
  at one-per-category when count exceeds variety, source pool unmutated; **per-modifier `apply`
  lock** (table-driven, one case each) — every documented field hits its exact factor/delta
  computed from the real `createDefaultPlayerStats` baseline, with a `changedKeys` guard that
  fails on any undocumented write and a coverage lock that fails if a modifier lacks a spec;
  **cross-modifier invariants** — no `apply` yields a non-finite stat or leaves
  `currentHealth > maxHealth` / `maxHealth <= 0`. Stubs the `'../weapons'` boundary (documented
  vitest pattern) so the real `Upgrades.ts` baseline loads in Node. Teeth verified by mutation
  (wrong factor + stray write both caught) then reverted. Pure test addition — no production
  change. Full suite **422 green** (+48), `tsc --noEmit` exit 0.
- `5a00de6` PROPOSE-EVOLUTION-TEST — **add the missing direct unit coverage + a
  data-integrity lock for the weapon-evolution system.** `WeaponEvolutions.ts` (14
  recipes, one per weapon — `getEvolutionForWeapon` / `checkEvolutionReady`) is a
  marquee, pure, multi-consumer module (`WeaponManager.checkEvolutions`, the GameScene
  HUD evolution hint + evolve trigger, `UpgradeScene`) yet had **no test file** — a
  tuning tweak or a typo'd `requiredStatId` could silently ship a weapon that can
  **never evolve**, with nothing to catch it (same "add missing coverage for a pure
  marquee module" vein as PROPOSE-PERFGRADE-TEST `5940c9a` / FEAT-DIRECTOR-PERSIST
  `9a70746`). New `WeaponEvolutions.test.ts` (20 cases): `getEvolutionForWeapon`
  lookup/unknown; `checkEvolutionReady` gating (both gates met, exceeded, unknown
  weapon, weapon-level short, stat absent / below-level, empty stats, match-by-id among
  unrelated upgrades); `evolutionLevelReduction` (lowers only the weapon gate **not**
  the stat gate, floors the effective requirement at 1, default-0 no-op); and the
  durable part — **every recipe is achievable**: exactly one evolution per registry
  weapon (no missing / no orphan), unique weaponIds, every `requiredStatId` resolves to
  a real `createUpgrades()` upgrade reachable to its `requiredStatLevel`,
  requiredWeaponLevel >= 1, non-empty name/desc, >= 1 finite positive multiplier per
  recipe. Integrity cases cross-check the **real** `Upgrades.ts` list (which imports
  WeaponManager for a type → the test stubs `'../weapons'`, the documented vitest
  boundary mock). One-word production change: `export weaponEvolutionDefinitions` so the
  integrity loop can iterate it — no behaviour change. All 14 recipes confirmed
  achievable. Full suite **374 green** (+20), `tsc --noEmit` exit 0, `vite build` clean.
  Self-discovered.
- `2a094e0` PROPOSE-DEADSTAT-LUCK — **wire the dead `luck` stat to bias relic-drop rarity** —
  the **last** write-only PlayerStats field, closing the dead-stat vein. `luck` (`PlayerStats`,
  "chance for better quality upgrades") was written but **never read**: the `luckLevel` shop
  upgrade (+10%/level, maxLevel 5) and the Lucky Charm relic (+10%) both fed it for zero effect,
  so the shop's "+X% rare upgrade chance" text was a lie (same vein as `501b5bc`/`457a755`/
  `4d4386e`). **Design call:** the in-run upgrade modal has no rarity tiers to bias (wiring there
  would be a net-new feature — filed as PROPOSE-UPGRADE-RARITY-TIERS), but the **relic** system
  already has rarity tiers + a weighted roll, so `luck` now biases *that*: the faithful, smallest
  "better quality loot" slice. New pure `luckBiasedRarityWeights(luck)` (`Relics.ts`) scales each
  rarity's base drop weight by `1 + clamp(luck,0,1) * LUCK_RARITY_WEIGHT_BONUS[rarity]` (common 0 /
  rare .5 / epic 1.5 / legendary 3 — higher tiers grow faster; common's absolute weight is
  unchanged so its *share* only shrinks as the good tiers grow). `pickRandomRelic` takes an
  optional `luck` (default 0); `RelicManager.rollAndEquipRandomRelic` passes `stats.luck`, which
  covers **all four** GameScene drop paths through the single roll chokepoint (the direct
  `equipRelic` path has no roll, correctly unaffected). **At luck 0 the weights are byte-identical
  to the old behaviour** — regression-safe for runs without luck; luck clamped `[0,1]`, non-finite/
  undefined (incl. legacy saves missing the field → default param / `Number.isFinite` guard) → 0;
  read live each roll, never accumulated → no double-application on save-restore. Updated the now-
  accurate `PlayerStats.luck` comment. **Test-first: the module's first coverage** —
  `Relics.test.ts` (12 cases): luck-0 regression lock, common-never-boosted, monotonic per-rarity
  boost factor, strictly-rising legendary share, `[0,1]` clamp, non-finite→0, + `pickRandomRelic`
  default-param lock, exclude-id respect across the whole roll range, all-excluded→null, and a
  deterministic common→legendary selection shift at a fixed roll (proves luck biases the real pick
  path). Full suite **354 green** (+12), `tsc --noEmit` exit 0, `vite build` clean. Self-discovered.
  **Closes the dead-stat vein — no write-only PlayerStats field remains.** Drop-rate *feel* unverified
  in bg → see BALANCE-LUCK-DROPS.
- `4d4386e` PROPOSE-DEADSTAT-CHAINCOUNT — **wire the dead `chainLightningCount` stat into
  Chain Lightning's jump count** so the Chain Catalyst relic (+2) and the `chainCountLevel`
  meta upgrade finally add jumps. The stat (`PlayerStats`, "Extra chain targets") was written
  but **never read** — `ChainLightningWeapon.recalculateStats` derived its count purely from
  `base + floor(level/2) + externalBonusCount` (the generic projectile-count bonus) and ignored
  the dedicated stat, so both advertised sources were no-ops (same vein as `501b5bc` synergy /
  `457a755` slowResistance). Now folded in as a fourth additive term that feeds **both** the
  regular chain (`attack`) and the Lightning Conductor mastery web (`attackLightningConductor`,
  which reads `stats.count`). Wired with the established per-frame-sync pattern: a change-guarded
  `WeaponManager.setChainLightningBonusCount` (mirrors `setSynergyBonus`) pushes the stat to the
  chain weapon, re-applied on `addWeapon` so a chain weapon picked up *after* the relic still
  gets the bonus; GameScene's `syncStatsToPlayer` feeds `playerStats.chainLightningCount`. Stored
  separately from the generic count bonus so the two stack. Round-trips on save-restore via the
  baked playerStats (read-and-set each frame, never accumulated → no double-application). **At
  chainLightningCount 0 the jump count is byte-identical to the old formula** — regression-safe
  for runs without the relic/upgrade; the bonus clamps to a finite non-negative integer (a
  corrupt/negative stat is inert, never below the level+generic baseline). Math kept in a pure
  browser-free module (`ChainJumpCount.ts`, mirrors `SlowResistance`/`WeaponSynergies`);
  `BaseWeapon.refreshStats` widened private→protected so the subclass setter can re-trigger a
  refresh. **Test-first:** `ChainJumpCount.test.ts` (7 cases) — chain-bonus-0 regression lock,
  additive stacking, level-flooring, fractional-bonus floor, negative clamp, non-finite inertness.
  Full suite **342 green** (+7), `tsc --noEmit` exit 0, `vite build` clean. Self-discovered.
- `457a755` BUG-SLOWRESIST-DEADSTAT — **wire the dead `slowResistance` stat into the
  Warden slow aura** — the player's only slow source. `slowResistance` (`PlayerStats`) was
  written but **never read**: the only thing that slows the *player* is the Warden enemy's
  aura (`getWardenSlowMultiplier()`, `EnemyAISystem.ts:322` — `*= 0.85` per nearby Warden),
  applied to player `Velocity` in `GameScene` (`:3288`), and that site multiplied by the raw
  slow with no resistance term. So both advertised sources were no-ops: the `slowResistLevel`
  ("Steadfast", +15%/level, a maxed late-game gold sink) permanent upgrade and the
  `relic_frost_ward` ("Frost Ward", +20% slow resist) relic — a player who bought Steadfast or
  picked up Frost Ward got **zero** slow resistance. Same dead-stat vein as `501b5bc`
  (synergy) / `3db4e75`/`d768284`/`4365943` (weapon stats). Now the Warden-slow site routes
  `wardenSlow` through a new pure `resolveSlowAfterResistance(rawSlow, slowResistance)` that
  scales back **only the slow penalty** (the deviation of the multiplier from 1.0): a 0.85
  slow at 0.4 resistance → keeps 60% of the 0.15 penalty → 0.91; resistance 1.0 → full
  immunity (1.0). **At resistance 0 the output is byte-identical to the old `wardenSlow`** —
  pure regression-safe wiring. Resistance clamped `[0,1]` (stacked relic+upgrade can exceed
  1 → caps at immune, never inverts into a speed boost); non-finite resistance (incl. legacy
  saves missing the field → `undefined`) → 0; the `wardenSlow < 1.0` fast-path and a new
  `resistedSlow < 1.0` guard skip the function call / no-op multiply when not slowed / fully
  immune. Shop + relic descriptions ("Resist slow effects" / "X% slow resistance" /
  "+20% slow resist") are now **accurate** — no text change needed (unlike synergy). Round-trips
  on save-restore via the baked `playerStats.slowResistance` (read each frame, never
  accumulated → no double-application). Math kept in a pure browser-free module
  (`src/systems/SlowResistance.ts`, mirrors `TimedStatBuffs`/`computeSynergyMultipliers`) so it
  is unit-testable without a live Phaser scene. **Test-first: the module's first coverage** —
  `SlowResistance.test.ts` (10 cases): resistance-0 regression lock (byte-identical), full
  immunity at 1.0, partial penalty-scaling, >1 clamp, negative clamp, non-finite resistance →
  0, non-slow (raw≥1.0) pass-through, non-finite raw → 1.0, stacked-Warden compounding, output
  bounded `[0,1]`. Full suite **335 green** (+10), `tsc --noEmit` exit 0, `vite build` clean.
  Self-discovered via the dead-stat hunt (see vein note). The hunt is now **exhausted**: of
  every PlayerStats field written by a data file, only `chainLightningCount` and `luck` remain
  write-only (filed as PROPOSE-DEADSTAT-* below); all other low-read fields
  (`attackSpeedMultiplier`/`gemValueMultiplier`/`iframeDuration`/`rangeMultiplier`/
  `projectileSpeedMultiplier`) were verified genuinely consumed.
- `501b5bc` BUG-SYNERGY-DEADSTAT — **wire the dead `weaponSynergy` stat so the "Synergy"
  meta upgrade and "Synergy Chain" legendary relic actually do something.** `weaponSynergy`
  (`PlayerStats`) was written but **never read** — `recalculateSynergies` (`WeaponManager.ts`)
  built its per-weapon damage/cooldown multipliers purely from the raw `WEAPON_SYNERGIES` table
  and ignored the stat. So both its sources were no-ops: the `weaponSynergyLevel` meta upgrade
  (+3%/level, a maxed late-game gold sink) and the legendary `relic_synergy_chain` (+20% weapon
  synergy bonus) — a player spending gold or picking up the legendary got **zero** effect. Same
  class as the "wire dead weapon stats" vein (`3db4e75`/`d768284`/`4365943`). Now `weaponSynergy`
  amplifies the **bonus portion** of every active synergy: a +30% damage synergy → +36% at a 0.2
  bonus, a 15%-faster cooldown → 18% faster; only the deviation from 1.0 is scaled so a no-op
  dimension (multiplier exactly 1.0) stays 1.0, and per-weapon bonuses stack multiplicatively
  (matches existing behaviour). **At bonus 0 the output is byte-identical to the old code** — pure
  regression-safe wiring. Math extracted into a pure exported `computeSynergyMultipliers(ids, bonus)`
  (`WeaponSynergies.ts`, mirrors `computeRunScore`/`computeRunGold`) so it's testable without a live
  Phaser scene. New `WeaponManager.setSynergyBonus()` stores the stat + recalculates only on change;
  GameScene's per-frame `syncStatsToPlayer` feeds it `playerStats.weaponSynergy`, so the meta starting
  bonus applies at run start and a mid-run Synergy Chain pickup re-applies synergies immediately (all
  three relic-grant paths call `syncStatsToPlayer` right after). Round-trips on save-restore via the
  baked `playerStats.weaponSynergy` (relic restore only repopulates the list, never re-applies), so no
  double-application. Non-finite/negative bonuses clamp to 0 (synergies can't invert below base).
  Updated the now-accurate shop effect text (`+X% weapon synergy bonus`, was the misleading
  `+X% damage per weapon`) + the `PlayerStats` field comment. **Test-first: the module's first
  coverage** — `WeaponSynergies.test.ts` (15 cases): getSynergy order-independence + getActiveSynergies
  characterization, then computeSynergyMultipliers — empty/no-pair maps, raw-multiplier baseline
  (bonus 0 = no-op regression lock), damage/cooldown/combined amplification, multi-synergy stacking,
  negative + non-finite clamping. Full suite **325 green** (+15), `tsc --noEmit` exit 0, `vite build`
  clean. Self-discovered.
- `15cdf16` BUG-MUSIC-CORRUPT — **harden `MusicManager`'s SecureStorage loaders against
  corrupt/tampered storage** — the **last** un-hardened loader, closing the corruption vein.
  Two real holes (`src/audio/MusicManager.ts`): (1) `loadVolume` returned `parseFloat(stored)`
  with no finite/range check — the exact BUG-SETTINGS-CORRUPT (`b0377f7`) class: `parseFloat('1e999')`
  is `Infinity`, `parseFloat('loud')` is `NaN`, negatives pass — loading straight into `this.volume`.
  This is **crash-class, not the "BGM prefs only / low-impact" the Proposed-auto vein note assumed:**
  a non-finite volume reaches `gainNode.gain.value = volume * intensity` (`loadTrack:287`/`setVolume:480`/
  `setIntensity:494`), and a non-finite Web Audio `AudioParam` value **throws a TypeError** — and
  `setIntensity` runs **every frame** via `MusicIntensityDriver`, so a NaN/Infinity volume is a per-frame
  exception storm; `getVolume()` also feeds NaN to the MusicSettings slider. Fixed by gating on
  `Number.isFinite` (→ `0.4` default) then clamping `[0,1]`, mirroring `setVolume`. (2) `loadEnabledTracks`
  did `new Set(JSON.parse(stored))` with no shape check — a JSON **string** payload (`"hello"`) is
  iterable and did **not** throw, becoming a `Set` of single chars (garbage ids → empty playlist,
  re-persisted on the next toggle); non-string/unknown array members leaked the same way. Fixed by
  rebuilding from **known catalog ids only** (module-level `CATALOG_IDS` set): keep string members present
  in `MUSIC_CATALOG`, drop non-string junk + stale ids; an **empty array is preserved** as the valid
  "all disabled" state (`disableAllTracks` writes `[]`), a non-array payload falls back to all-enabled.
  `loadPlaybackMode` was already whitelisted (junk-immune) — a characterization test locks it.
  Byte-identical on the real path (valid volumes clamp-noop, valid id arrays are all catalog ids), so
  pure hardening, no behaviour change. **Test-first: the module's first coverage** —
  `MusicManager.test.ts` (15 cases): volume Infinity/NaN/out-of-range/valid-round-trip, the char-Set
  regression, junk-id drop, empty-array preservation, mode whitelist, defaults + setter round-trips.
  Full suite **310 green** (+15), `tsc --noEmit` + `vite build` clean. Self-discovered. **Closes the
  corruption-hardening vein — every SecureStorage loader in the codebase is now hardened.**
- `b0377f7` BUG-SETTINGS-CORRUPT — **harden `SettingsManager`'s numeric loaders against
  out-of-range/Infinity storage.** The setters clamp every numeric setting (sfxVolume `[0,1]`,
  uiScale `[0.5,2.0]` in 0.1 steps, screenShakeIntensity `[0,1]` in 0.01 steps), but the **load
  path did not** — `loadNumber` (`src/settings/SettingsManager.ts`) only rejected NaN (`parseFloat`
  + `!isNaN`) with no range check. Since `parseFloat('1e999')` is `Infinity` and `!isNaN(Infinity)`
  is `true`, a corrupt/tampered value (Infinity, a huge finite, or a negative) loaded straight past
  the setters' clamps. SecureStorage is the anti-cheat layer, so an out-of-range payload is the
  threat model (same vein as `38599e4`/`6de57f7`/`bb7e00f`). **Worst case is screenShakeIntensity:**
  `GameScene.shakeCamera` (`:5429`) does `cameras.main.shake(d, intensity * shakeScale)` with no
  clamp, so an Infinity/huge stored intensity drives an Infinity camera-shake offset → NaN camera
  scroll → the render breaks for the rest of the run, unrecoverable — a crash-class bug, not the
  "UX prefs only" the vein note had assumed. uiScale feeds `HudScale` (every HUD/menu layout;
  partly self-defended by HudScale's own final clamp) and sfxVolume feeds the audio gain on 26
  `SoundManager` call sites — fixing at the load source is the vein principle, not relying on each
  scattered consumer to re-clamp. Fix replaces `loadNumber` with `loadBoundedNumber(key, default,
  min, max, roundFactor)`: rejects non-finite (`Number.isFinite` gate) + unparseable → default,
  rounds finite values to the setter's step, then clamps to `[min,max]`; bounds + round factor per
  call mirror each setter exactly, so the loaded value is always one the setter could itself have
  produced. Byte-identical on the real path (saved values are already clamped + rounded → re-applying
  is a no-op), so pure hardening, no behaviour change for valid data. Booleans (`=== 'true'`) and the
  damage-numbers / colorblind enum loaders (whitelist) were already junk-immune. **Test-first: the
  module's first coverage** — `SettingsManager.test.ts` (19 cases): Infinity/huge/negative/non-numeric
  tamper for all three numeric settings, off-step rounding, the camera-can't-blow-up invariant,
  boolean + enum junk-immunity characterization, the legacy shake-toggle migration, and a valid-value
  round-trip locking the real path unchanged. Full suite **295 green** (+19), `tsc --noEmit` + `vite
  build` clean. Self-discovered. **Closes all high-value hardening; only `MusicManager` (BGM prefs,
  genuinely low-impact) remains un-hardened — see the Proposed-auto vein note.**
- `38599e4` BUG-CODEX-CORRUPT — **harden `CodexManager` against corrupt/tampered codex storage.**
  `loadState` (`src/codex/CodexManager.ts`) spread `...parsed.weapons` / `...parsed.enemies` /
  `...parsed.upgrades` / `...parsed.statistics` straight over the seeded defaults. SecureStorage is
  the anti-cheat layer, so a corrupt/tampered/non-object `survivor-codex` payload is the threat model
  (siblings BUG-ACHIEVE-CORRUPT `6de57f7`, BUG-METAPROG-CORRUPT `1232d43`, BUG-ASCENSION-CORRUPT
  `bb7e00f`). Three holes: (1) injected weapon/enemy ids were retained, inflating
  `getTotalWeaponCount`/`getTotalEnemyCount` → skewing `getCompletionPercent` (the codex %); (2)
  `discovered` was never coerced, so a truthy non-boolean (`"yes"`/`1`) faked a discovery — and weapon
  discovery **gates the starting-weapon picks in `WeaponSelectScene`**, so this is unlock-poisoning, not
  just display; (3) non-numeric/Infinity/negative entry + statistics fields leaked NaN/garbage into the
  CodexScene stats panel. **Also fixes a latent real-path bug:** `JSON.stringify(Infinity) === "null"`,
  so `fastestVictorySeconds` (default Infinity) round-tripped to `null` after the first saved run;
  `CodexScene.ts:655` renders `fastestVictorySeconds < Infinity ? formatTime : '--:--'` and
  `null < Infinity` is true → it showed a garbage fastest-victory time instead of `--:--`, and
  fastest-victory tracking silently broke (same class as `6de57f7`). Fix mirrors the vein: an
  `asStoredRecord` guard degrades non-objects to `{}`, a `boundedStoredNumber(value, fallback, spec)`
  helper coerces each field through a finite, non-negative check (per-field floor via a
  compiler-enforced `Record<keyof CodexStatistics,…>` spec table; an `allowInfinity` carve-out for the
  fastest-victory sentinel), and `loadState` **rebuilds weapons/enemies/statistics from the known
  ids/fields only** — dropping junk keys and forcing `discovered` to a real boolean. Dynamic upgrade ids
  (no fixed known set) keep every entry whose value is a real object (id from the authoritative map key),
  dropping scalar/array junk. Byte-identical on the real path (valid ints floor-noop, fractional
  damage/seconds preserved, Infinity restored), so pure hardening, no balance change. **Test-first: the
  module's first coverage** — `CodexManager.corruption.test.ts` (21 cases): valid round-trip +
  completion-% characterization, non-object/malformed-payload fallbacks, junk-id drop (stable totals),
  the strict-boolean discovery guard, per-field numeric coercion, the Infinity sentinel, the
  null→Infinity real-path regression (save+reload through the real save path), and dynamic upgrade-id
  handling. Full suite **276 green** (+21), `tsc` + `vite build` clean. Self-discovered.
- `6de57f7` BUG-ACHIEVE-CORRUPT — **harden `AchievementManager` against corrupt/tampered
  achievement storage.** `loadPersistentState` (`src/achievements/AchievementManager.ts`) spread
  `...parsed.lifetimeStats` / `...parsed.achievements` straight over defaults, so a corrupt/tampered
  `survivor-achievements` payload leaked junk into gameplay (SecureStorage is the anti-cheat layer →
  a non-object/non-numeric payload is the threat model; siblings BUG-METAPROG-CORRUPT `1232d43`,
  BUG-ASCENSION-CORRUPT `bb7e00f`). The damage is amplified by `recordRunEnd`'s
  `stats.totalKills += ...` accumulation: a single NaN/string lifetime stat poisons the **persisted**
  total forever (NaN, or string-concat like `"abc100"`), then every `currentValue >= targetValue`
  check goes false → the achievement is **permanently bricked**; the same lifetime totals feed
  `HiddenUnlocks` predicates (a NaN dead-locks an unlock; an inflated `1e999` spuriously unlocks
  ships/cosmetics/stages — `totalRunsCompleted >= 1`, `totalKills >= 10_000`, `highestWorldLevel >= 5`,
  …) and render as `"NaN"` in the Achievement/Leaderboard UI. A second hole: `isUnlocked` was never
  coerced, so a truthy non-boolean tamper (`"yes"`) faked an unlock — inflating completion % +
  re-delivering rewards — and the wholesale spread retained unknown junk ids. Fix: a
  `boundedStoredNumber` helper coerces each field through a finite, non-negative check (per-field floor
  for integer counters via a compiler-enforced `Record<keyof LifetimeStats,…>` spec table; an
  `allowInfinity` carve-out for `fastestVictorySeconds`' "none yet" sentinel), and both loaders
  **rebuild from the known fields/ids only** — dropping junk keys and forcing `isUnlocked`/
  `rewardClaimed` to real booleans. Byte-identical on the real path (valid ints floor-noop, fractional
  damage/seconds preserved, Infinity preserved), so pure hardening, no balance change. **Also fixes a
  latent real-path bug:** `JSON.stringify(Infinity) === "null"`, so after any saved run
  `fastestVictorySeconds` round-tripped to `null`, making `survivalTimeSeconds < null` (→ `< 0`) false
  forever and silently disabling all future fastest-victory tracking — the sanitizer restores the
  Infinity default. **Test-first: the module's first coverage** — `AchievementManager.corruption.test.ts`
  (24 cases): per-field numeric coercion, the Infinity sentinel, junk-key drop, the boolean-unlock guard,
  the un-brick regression (tampered string `totalKills` + 100 kills → unlocks `lifetime_kills_100`),
  top-level payload guards, + characterization locking the valid round-trip and the null→Infinity fix.
  Full suite **255 green** (+24), `tsc` + `vite build` clean. Self-discovered.
- `1232d43` BUG-METAPROG-CORRUPT — **harden `MetaProgressionManager`'s three JSON loaders against
  corrupt/tampered storage.** `loadStreakState`, `loadUpgradeState`, and `loadAchievementBonuses`
  (`src/meta/MetaProgressionManager.ts`) each hand-rolled the `Math.max(0, Math.min(value, cap))`
  clamp that leaks NaN — `Math.min("abc", cap)` is NaN, `Math.max(0, NaN)` stays NaN (the exact
  BUG-ASCENSION-CORRUPT `bb7e00f` / BUG-COMBO-RESTORE-CORRUPT `2a283e0` class). Streak used
  `parsed.currentStreak ?? 0` (`?? 0` only catches null/undefined, so a non-numeric field slips
  through); upgrades + achievement bonuses spread `{...defaults, ...parsed}` then clamped, so a
  non-numeric field became a NaN level/bonus. SecureStorage is the anti-cheat layer, so a
  non-object/non-numeric payload is the threat model — this manager (gold, all permanent upgrades,
  world level, streak, achievement stat bonuses) is the most central one and was the last scoring/meta
  module without load-time hardening. Impact of a NaN: a NaN streak → `getStreakGoldMultiplier` NaN →
  `calculateRunGold` streakMultiplier NaN → `Math.floor(gold × NaN)` = NaN run gold → corrupt
  *persisted* balance + `×NaN` in the pause/shop UI; a NaN upgrade level → `level()` returns it (`?? 0`
  misses NaN too) → `getAccountLevel` NaN (breaks unlock + ascension-threshold gating) and every
  `getStartingXXX()` NaN → NaN PlayerStats at run start; a NaN achievement bonus → NaN PlayerStats via
  GameScene's run-start apply (`:823`). A **second, distinct** hole: `calculateAccountLevel` sums
  `Object.values(upgradeState)`, and the old wholesale spread kept *unknown* keys — a tampered
  array/extra-key payload (e.g. `{"__hack":999999}`) inflated the account level and spuriously
  unlocked everything / met the ascension threshold. Fix: a `boundedStoredNumber(value, min, max,
  fallback, floorToInt)` helper coerces each field through a finite check (non-number/NaN/Infinity →
  fallback) then floors (counts) + clamps; an `asStoredRecord` guard degrades non-objects to `{}`; and
  both object loaders now **rebuild from the known ids/fields only**, dropping junk keys. Byte-identical
  on the real path (saved keys are exactly the current upgrade ids; valid int levels floor-noop +
  clamp the same; percent bonuses left unfloored), so pure hardening, no balance change — the shared
  `MetaProgressionManager.gold.test.ts` still passes unchanged. **Test-first: the module's first
  corruption coverage** — `MetaProgressionManager.corruption.test.ts` (26 cases): per-loader
  non-numeric/object/Infinity/negative/over-cap/fractional/non-object-payload tamper locks, the
  junk-key account-level-inflation regression, + characterization that valid streak/levels/bonuses
  round-trip unchanged and a missing newer upgrade id still defaults to 0. Full suite **231 green**
  (+26), `tsc` + `vite build` clean. Self-discovered.
- `bb7e00f` BUG-ASCENSION-CORRUPT — **harden `AscensionManager` against corrupt/tampered ascension
  state.** `loadState` (`src/meta/AscensionManager.ts`) parsed `survivor-meta-ascension` with
  `Math.max(0, Math.min(parsed.level ?? 0, 50))`. `?? 0` only catches null/undefined, so a
  non-numeric tampered value (a string/object) slipped through and `Math.min("abc", 50)` is NaN →
  `Math.max(0, NaN)` is NaN → the loaded `level` became NaN (`1e999`, which JSON.parse reads back as
  Infinity, also leaked through as a max-grant). SecureStorage is the anti-cheat layer, so a
  non-numeric/overflow payload is exactly the threat model (siblings: BUG-BESTSCORE-CORRUPT `0b81956`,
  BUG-COMBO-RESTORE-CORRUPT `2a283e0`). A NaN ascension level poisons the whole prestige system:
  `getStatMultiplier()`/`getGoldMultiplier()` return NaN — the gold multiplier feeds
  `MetaProgressionManager.calculateRunGold` (`ascensionMultiplier`, `:1184`) → NaN run gold → corrupt
  persisted balance, and both render as "NaN" in the shop/boot/pause UI; `getAscensionThreshold()`
  returns NaN, so `canAscend()` (`accountLevel >= NaN`) is false **forever** → re-ascension permanently
  bricked. (GameScene's run-start stat apply happens to guard with `if (mult > 1)`, but the gold path,
  threshold/canAscend, and the UI displays are all unguarded — so the fix is at the load source, not
  per-consumer.) Fix: a `toBoundedCount` helper coerces each counter through a finite check (rejecting
  non-numbers and Infinity → 0), floors it, and clamps to `[0, MAX_ASCENSION_LEVEL]` (the magic 50,
  now named). Byte-identical on the real path (saved levels are always finite ints in range), so pure
  hardening, no balance change. **Test-first: the module's first coverage** — `AscensionManager.test.ts`
  (24 cases): tamper locks (non-numeric string/object → 0, `1e999`/`-1e999` → 0, fractional floored,
  negative/over-cap clamped, null-field/null/array/primitive/non-JSON → defaults) + characterization of
  the multiplier/threshold/canAscend/bonus-tier/performAscension contract. Full suite **205 green**
  (+24), `tsc` + `vite build` clean. Self-discovered.
- `2a283e0` BUG-COMBO-RESTORE-CORRUPT — **harden `restoreComboState` against corrupt/tampered save
  state.** `restoreComboState` (`src/systems/ComboSystem.ts`) assigned `comboCount`/`comboDecayTimer`/
  `highestCombo` straight from the save snapshot with no validation. `comboState` is an *optional* save
  field, so `GameStateManager.isStructurallyValidSaveState` deliberately skips it ("newer optional fields
  are guarded at their own use sites") — but this use site did no guarding. Since the save is persisted via
  SecureStorage (a tamper/corruption surface — the reason the store is encrypted), a garbage snapshot set
  `comboCount` to NaN/undefined/string → `getComboXPMultiplier()` returns NaN, poisoning live XP gain
  mid-run, and set `highestCombo` to a NaN/inflated value that flows into `PerformanceGrade.computeRunScore`
  (`highestCombo × 5`) → the persisted best score, the daily-challenge leaderboard rank, and achievement /
  hidden-unlock records. Fix coerces every field through `toFiniteNonNegative` (mirrors
  `BestScoreManager.isValidStoredScore` from BUG-BESTSCORE-CORRUPT): combo + highest floored to finite
  non-negative ints, decay timer clamped to the combo's grace delay (a tampered "infinite grace" can't
  freeze a combo), `highestCombo >= comboCount` invariant held. Valid saves unchanged. New
  `ComboSystem.test.ts` (16 cases): 10 corruption/tamper + 6 characterization locking the
  tier/threshold/XP-multiplier contract. Full suite **181 green**, build clean. Self-discovered.
- `5940c9a` PROPOSE-PERFGRADE-TEST — **add the missing direct unit coverage for PerformanceGrade.**
  `computeRunScore` + `computePerformanceGrade` (`src/utils/PerformanceGrade.ts`) are the canonical
  run-scoring + grade contract shared by four consumers — `BestScoreManager` (persisted best),
  `DailyChallengeManager` (leaderboard rank), `RunHistoryManager` (recorded run summaries), and the
  S–F results badge (`GameScene` victory + game-over paths) — yet had **no direct test file** (only
  exercised indirectly), so a tuning tweak to a weight or threshold could silently shift leaderboard
  ordering or grade cutoffs. New `PerformanceGrade.test.ts` (34 cases, pure/browser-free, no Phaser
  or storage mock): `computeRunScore` — all-zero=0, each term's documented weight (kills×10/survival×3/
  level×50/damage÷100/combo×5), victory +5000 exactly, `Math.round` half-up rounding, determinism, full
  composite; `computePerformanceGrade` — every grade cutoff + just-below boundary at world level 1,
  world-level baseline scaling (same score grades lower at higher WL; S at WL5 needs 5× the score),
  `worldLevel<=0` clamp to baseline 4000, victory +1-tier bump (F→D, A→S) capped at S (no overflow),
  palette color per grade, defensive numeric edges (negative→F, NaN→F no-throw, Infinity→S). No
  production code changed — pure regression lock (precedent: `9a70746`). `npm run test` **165/165 green**
  (+34), `tsc && vite build` clean.
- `0b81956` BUG-BESTSCORE-CORRUPT — **harden BestScoreManager against corrupt/tampered
  best-score storage.** `load()` parsed `survivor-best-scores` with no shape check
  (`cache = JSON.parse(stored) as BestScoreMap`), so a corrupt/tampered/truncated payload
  broke the post-run results screen: a `"null"` payload made `load()` return null, then
  `recordScore`'s `map[key] = score` (run via `showVictory`/`gameOver` at **every** run end —
  `GameScene:4061`/`:4335`) threw a TypeError so the overlay never rendered; an array/primitive
  payload got indexed by world-level keys, and non-numeric/NaN entries surfaced a garbage/NaN
  "best". SecureStorage is the anti-cheat layer, so a non-object payload is exactly the threat
  model — this was the lone scoring-persistence module without the FEAT-SAVE-VALIDATE
  (`4dccd79`) / RunHistoryManager hardening. Fix: `load()` validates the parsed value is a plain
  object and keeps only finite non-negative numeric entries; `recordScore` sanitizes its score
  to a finite non-negative integer. Also dropped the stale module cache for **read-through**
  reads (single source of truth, mirroring RunHistoryManager) — removes a secondary foot-gun
  where a falsy-parsed cache silently re-parsed every call, and self-heals the stored payload on
  the next write. Byte-identical on the real path (`computeRunScore` always yields a finite
  non-negative int), so pure hardening, no balance change. **Test-first: the module's first
  coverage** — `BestScoreManager.test.ts` (15 cases): record/read-back, strictly-greater
  overwrite, per-world-level isolation, persistence, + corruption locks (null/array/primitive/
  non-JSON payloads, dropped invalid entries, NaN/Infinity sanitization). `npm run test`
  **131/131 green** (+15), `tsc && vite build` clean.
- `2b82b20` BUG-STREAKER-NOTASTREAK — **make the Streak Flame hidden unlock require a real
  5-win streak instead of 5 total victories.** The `unlock_streaker` condition (hint: "Win 5
  runs in a row") gated on `run.wasVictory && lifetime.totalVictories % 5 === 0 &&
  totalVictories >= 5` — total lifetime wins, not consecutive. It unlocked the Streak Flame
  cosmetic on the 5th win *ever* regardless of losses between them, contradicting its own hint;
  and because `evaluatePostRun` fires each condition at most once (dedupe), the `% 5` modulo was
  dead logic (could only match at the first multiple reached). Fix threads the actual
  consecutive-win count into the unlock-eval context as `run.winStreak` (sourced from
  `MetaProgressionManager.getCurrentStreak()` — `LifetimeStats` has no streak field, so it must
  be passed explicitly) and gates on `winStreak >= 5`. Both run-end call sites fixed for correct
  ordering: `showVictory()` now evaluates unlocks *after* `incrementStreak()` so it sees the
  streak the win produced (was off-by-one — saw 4 on the 5th consecutive win); `gameOver()`
  passes `getCurrentStreak()` (0 after `breakStreak()` on a loss, intact for a won-then-died
  endless run, `wasVictory` double-guards the loss). **Test-first: the module's first coverage**
  — `HiddenUnlocks.test.ts` (14 cases): streaker at streak 5 / not 4 / not on loss / not from
  scattered lifetime wins (old-bug regression lock), evaluatePostRun unlock + dedupe + callback,
  sibling predicate guards, getTopProgress sort / boolean-only exclusion / zero-progress skip.
  `npm run test` **116/116 green** (+14), `tsc && vite build` clean.
- `d0b2a5b` BUG-NEWCOMER-DOUBLEBURN — **count each run once for the newcomer gold bonus +
  make the run-gold formula pure.** `MetaProgressionManager.calculateRunGold` mutated
  `runsCompleted` (++ and save) as a side effect — a "calculate" method advancing state.
  It is called once in `showVictory()` (boss kill) and once in `gameOver()` (death); for a
  **win that continues into endless mode and then dies, BOTH fire for the same run**, so the
  run counted twice and burned the first-runs newcomer gold taper (3.0×→1.5× over the first
  five runs, 1.25× through run nine) twice as fast — quietly cutting a new player's early
  gold. Also a latent landmine: any future gold *preview* would double-count. Fix splits the
  concern: extracted pure exported `computeRunGold(params)` (all meta multipliers passed in
  explicitly) + `newcomerMultiplierForRuns(runs)`, mirroring `PerformanceGrade.computeRunScore`;
  the flooring sequence + per-multiplier conditionals are preserved exactly so awarded gold is
  byte-for-byte unchanged on every path. `calculateRunGold` is now a pure read; new
  `recordRunCompleted()` owns the counter advance, called once per run by GameScene **after**
  the result render — unconditional in `showVictory()` (fires ≤once/run), guarded by `!hasWon`
  in `gameOver()` (a won-then-died endless run was already counted). After-render placement
  also fixes a pre-existing display bug: the victory screen's "Newcomer Bonus N×" line read the
  post-increment tier while the gold used the pre-increment tier. **Test-first: 14 cases**
  (`MetaProgressionManager.gold.test.ts`) — base formula, 50-gold floor, victory ×1.5, each
  multiplier, full stack with per-step flooring, taper tiers, + regression locks (calculate
  doesn't advance the counter; recordRunCompleted advances by exactly one). `npm run test`
  **102/102 green** (+14), `tsc && vite build` clean.
- `45fdd74` FEAT-DAILY-SCORE — **rank the daily-challenge leaderboard by composite run
  score + record daily victories.** Two self-discovered correctness bugs in
  `DailyChallengeManager`: (1) `recordDailyRun` was only called from `gameOver()` (the
  death path), so a **won** daily run — which flows through `showVictory()` — never posted
  to the leaderboard at all; added the record call to the victory path (guarded by daily
  mode). (2) "Best" used an ad-hoc `kills > survival > level` comparison, diverging from
  the unified `computeRunScore` (PerformanceGrade) used by the grade / BestScoreManager /
  run history — so a clearly better run (victory, high combo/damage, one fewer kill) could
  lose. `DailyLeaderboardEntry` now carries `score`; `isRunBetter` ranks by it (kills/
  survival/level only break exact ties). Both GameScene run-end paths pass `runScore`.
  Legacy entries (pre-`score`) are backfilled on load via `computeRunScore` (combo/damage
  unknown → 0) so old/new rank fairly; `loadLeaderboard` also drops non-object junk.
  Display: LeaderboardScene gains a SCORE column (row widened 720→800), BootScene best-chip
  leads with the score. **Test-first: 11 cases** (`DailyChallengeManager.test.ts`) — score
  ranking, fewer-kills-higher-score wins, tie-breaks, legacy normalization, corrupt payload,
  recents ordering, deterministic generation. `npm run test` **88/88 green** (+11), `tsc`
  + `vite build` clean. Display placement (new column / longer chip) not visually verified
  in bg → see POLISH note below if it crowds at UI-scale extremes.
- `9a70746` FEAT-DIRECTOR-PERSIST — **add the missing director-state round-trip test.**
  `DirectorSystem`'s credit-budget state (`creditBalance`/`creditsEarned`/`currentStrategy`/
  `lastGameTime`) was already serialized end-to-end — `GameStateManager` carries
  `directorState?` as a pass-through (`:319`/`:547`/`:611`), `GameScene` saves (`:1200`) +
  restores (`:1352`) it — but it was the lone refresh-persist feature without a
  `GameStateManager.<feature>.test.ts` guarding it (siblings: bounty/shrine/chest/event/
  statbuff/evolution/consumable). New `GameStateManager.director.test.ts` (3 cases) mirrors
  the siblings: a mid-run round-trip (rolled strategy not reset, accrued credits preserved),
  faithful round-trip of all four strategy values, and a legacy absent→undefined backward-compat
  case. No production code changed — pure regression lock on already-shipped wiring.
  `npm run test` **77/77 green** (+3), `tsc && vite build` clean.
- `4dccd79` FEAT-SAVE-VALIDATE — **reject structurally corrupt saves on load.**
  `readValidSaveState` only checked `version`, so a version-valid but structurally
  broken save (a quota-truncated write, NaN coordinates, a missing entity array) passed
  straight into the GameScene restore path and crashed it — the player couldn't even
  start a run. New pure, exported `isStructurallyValidSaveState(parsed)` validates the
  always-written fields the restore path dereferences unguarded: core/timer/world-scale
  numbers (finite), `playerStats` + its vitals (`level`/`maxHealth`/`currentHealth`), the
  iterated collections (`entities`/`weapons`/`upgrades`/`twinLinks`/`minibossSpawnTimes`/
  `banishedUpgradeIds` must be arrays), and each entity's transform coords (finite).
  Anything broken → `null` → clean fresh start instead of a crashing restore; `hasSave()`/
  `getSaveInfo()` go false too, so BootScene never offers a broken restore. Newer optional
  fields (directorState/eventState/relicIds/…) stay optional — guarded at their use sites —
  so legacy saves keep loading (no over-rejection). **Test-first: 19 cases**
  (`GameStateManager.validate.test.ts`) — pure validator shape checks incl. a complete
  save accepted, version/number/array/playerStats/transform corruption rejected, plus
  manager-level `load()`/`hasSave()` rejection of truncated + version-valid-but-corrupt
  payloads. `npm run test` **74/74 green**, `tsc --noEmit` exit 0, `npm run build` clean.
- `899a4c7` + `606be11` FEAT-RUN-HISTORY — persistent **recent-run history** + a "RECENT"
  trend strip on the end screens. The game tracked aggregate lifetime stats
  (AchievementManager) and a daily-only leaderboard, but nothing remembered individual
  recent runs. New pure `RunHistoryManager` (`src/meta/RunHistoryManager.ts`) persists a
  capped (`MAX_RUN_HISTORY`=10) newest-first list of run summaries (timestamp / duration /
  kills / level / score / grade / victory / worldLevel) via SecureStorage, mirroring
  `BestScoreManager`. Read-through (no cache → store is the single source of truth);
  `load()` validates each entry (`isRunSummary`) and tolerates corrupt / non-array /
  partial payloads (→ `[]`). Key `survivor-run-history` registered in `StorageBootstrap`.
  Both `GameScene` run-end paths (victory + game over) record next to `recordScore`,
  reading the prior runs first so the overlay shows the runs *leading up to* this one.
  `PauseMenuManager.createRecentRunsStrip` (shared by both overlays) draws a compact
  left-margin strip — grade letter, duration, score per row, grade-tinted, ✓ for prior
  wins; no-op on empty history. **Fully test-first: 12 manager tests** (ordering, cap,
  limit clamp, persistence, corrupt-JSON / non-array / malformed-entry resilience).
  `npm run test` **55/55 green**, `tsc --noEmit` exit 0, `npm run build` clean. Visual
  placement unverified in bg → POLISH-RUN-HISTORY (Needs playtest).
- `b209617` FIX BUG-EVENT-BUFF-REVERT (Elite Surge / Golden Tide part) — the last two timed
  events now survive refresh-recovery, closing the whole bug class. Both applied a raw
  `xpMultiplier *= 2` (Elite Surge) / `gemValueMultiplier *= 3` (Golden Tide) reverted by a Phaser
  `delayedCall` — a timer that dies on reload while the save bakes the already-multiplied stat, so a
  mid-event refresh left the boon **permanent** (same class as `d7ab577` Power Surge / `eb16e16`
  power-shrine). Fix **generalised** the damage-only `TimedDamageBuffs` system into a stat-keyed
  `TimedStatBuffs` (`src/systems/TimedStatBuffs.ts`): each buff now carries a `stat`
  (`damageMultiplier` | `xpMultiplier` | `gemValueMultiplier`), `expireTimedStatBuffs` groups the
  revert divisor per stat, and `normalizeTimedStatBuffs` defaults a missing `stat` →
  `damageMultiplier` for legacy saves. `EventSystem.getEventDamageBuff` → `getEventStatBuff` now
  maps power_surge/elite_surge/golden_tide → `{stat, magnitude, durationSeconds}` (new
  `ELITE_SURGE_XP_MULT`/`GOLDEN_TIDE_GEM_MULT` consts). `GameScene.handleRunEvent` routes all three
  boons through the gameTime-keyed list (deleting the dead delayedCalls); Elite Surge keeps only its
  transient `spawnInterval *= 0.5` kick (no revert needed — the spawn loop recomputes spawnInterval
  from the phase curve each spawn tick, so it self-corrects; the old `1.0 - gameTime*0.01` revert
  formula was already overwritten anyway). Save key stays `timedDamageBuffs` for back-compat; entries
  now serialise `stat`. Backward-compatible (no save-version bump). Unit tests: `TimedStatBuffs.test.ts`
  (per-stat expiry + legacy normalize), `EventSystem.test.ts` (getEventStatBuff for all 3 + nulls),
  `GameStateManager.statbuff.test.ts` (stat-keyed + legacy round-trip). **`npm run test` 43/43 green,
  `tsc --noEmit` exit 0, `npm run build` clean.**
- `d7ab577` FIX BUG-EVENT-BUFF-REVERT (power_surge part) — make the **Power Surge** event's 2×
  damage boost survive refresh-recovery. It applied `damageMultiplier *= 2` reverted by a Phaser
  `delayedCall` — a timer that dies on reload while the save bakes the doubled multiplier, so a
  mid-event refresh left **permanent** double damage (same class as the `eb16e16` power-shrine fix).
  Now routed through the gameTime-keyed `timedDamageBuffs` list: new pure `getEventDamageBuff(event)`
  maps power_surge → `{magnitude: 2, durationSeconds: event.duration}` (duration sourced from the
  event def via new `POWER_SURGE_DAMAGE_MULT`); `handleRunEvent` applies it via the existing
  `applyTimedDamageBuff`, so it serializes, restores, and reverts at the correct absolute `gameTime`.
  With `b94d020`, both the HUD indicator and the stat revert now survive reload. Unit tests for the
  mapping (`EventSystem.test.ts`). `tsc` + `npm run build` + 38-test suite green. Elite Surge /
  Golden Tide have the same latent bug → filed BUG-EVENT-BUFF-REVERT (Open).
- `b94d020` FEAT-PERSIST-ACTIVE-EVENT — persist the **live in-run event** (Elite Surge / Golden
  Tide / Power Surge) across refresh-recovery. EventSystem save/restore only round-tripped the
  event-trigger timer, so a mid-event refresh dropped the remainder of the active boon and let the
  trigger timer resume early. `getEventState()` now also emits the live event as
  `{id, remainingTime}`; `restoreEventState()` re-derives the full `RunEvent` def from `EVENT_POOL`
  by id (unknown id / non-positive time → cleared), mirroring how restored affixes/evolutions
  re-derive from their defs. `GameStateManager.eventState` type widened for the optional
  `activeEvent` (pure pass-through). Backward-compatible (absent → none restored, no version bump).
  Unit tests: EventSystem round-trip/legacy/null/unknown-id/non-positive/tick-down/reset, plus a
  GameStateManager save→load round-trip. (Was uncommitted WIP from a bash-dead session; verified +
  committed this session — `npm run test` green.)
- `d2a425a` FEAT-PERSIST-EVOLUTION + FEAT-PERSIST-CHEST — persist **weapon evolutions** and
  **on-field treasure chests** across refresh-recovery (same vein as the FEAT-PERSIST-* chain).
  *Evolutions:* `SerializedWeapon` saved only `{id, level}`, so restore re-created + leveled
  weapons but never re-applied `evolve()` — an evolved super-form (permanent dmg/cooldown/count
  multipliers + evolved name) reverted to base form and came back `isEvolved=false`, so the next
  level-up spuriously re-fired the EVOLVED modal. Now serialize `evolved?: boolean`; restore
  re-derives the recipe by id via `getEvolutionForWeapon()` and calls `evolve()` after the
  levelUp loop (order-independent — `evolve()` mutates `baseStats`, not level). Multipliers
  re-derived from recipe, not serialized (mirrors affix-restore `ecc372a`). *Chests:* on-field
  XP/relic caches were GameScene-owned graphics cleared by `resetInRunFeatureState`, so a refresh
  despawned uncollected chests (lost XP burst + 35%/100% relic) and restarted the spawn clock.
  Now tracked in `activeChests`, serialized `{x, y, isSpecial}` (live drifting position), re-added
  via new shared `addTreasureChest()` helper (extracted from `spawnTreasureChest` so fresh +
  restore build identical chests); restore deferred past playerStats (reads `chestDroneDelay`),
  coords sanitized; collect/despawn unified into one idempotent `cleanup()`. Both
  backward-compatible (absent = not evolved / no chests; no save-version bump). Unit tests:
  evolution round-trip + legacy (`GameStateManager.evolution.test.ts`), chest round-trip + empty
  + legacy (`GameStateManager.chest.test.ts`). Verified **`npm run test` green (21 passed)** and
  `tsc --noEmit` clean — vitest ran to completion this session (see env note). Also gitignore
  `*.log`.
- `5c40cc1` FEAT-PERSIST-SHRINES — persist on-field **walk-in shrines**
  (Cleanse/Power/Fortune/Sacrifice) + their spawn timer across refresh-recovery. Sibling gap to
  FEAT-PERSIST-BOUNTY (`869a146`): shrines are GameScene-owned and cleared by
  `resetInRunFeatureState` on the restore path, so a mid-run refresh despawned placed altars and
  restarted the 38s spawn clock. Serialized as optional `shrineState` (`{ type, x, y }[]` +
  `spawnTimer`) on `GameSaveState`, mirroring the `bountyState`/`comboState` round-trip;
  `restoreGameState` re-draws each altar after `resetInRunFeatureState` via a new shared
  `addShrine()` helper extracted from `spawnShrine` (so fresh + restore draw identical shrines).
  Restored types validated against `SHRINE_DEFS`; absent on legacy saves → reset defaults win
  (backward-compatible, no save-version bump). Unit tests: 3 round-trip cases
  (`GameStateManager.shrine.test.ts`). Verified `tsc --noEmit` clean; Vitest round-trip **unrun**
  in the sandboxed bg shell (see env note) — confirm with `npm run test` on a normal shell.
- `869a146` FEAT-PERSIST-BOUNTY — persist the **in-run bounty** (objective kind/target/
  progress/time-left + inter-bounty cooldown + flawless-broken flag) across refresh-recovery.
  Bounty state was GameScene-owned and cleared by `resetInRunFeatureState` on the restore
  path, so a refresh mid-bounty wiped progress and restarted the cooldown. Now serialized as
  optional `bountyState` on `GameSaveState`, mirroring the `comboState`/`eventState`/
  `timedDamageBuffs` round-trip: `saveGameState` emits it; `restoreGameState` re-applies it
  after `resetInRunFeatureState` (guarded → legacy saves keep reset defaults; no save-version
  bump). `bountyText` HUD label re-creates lazily. Unit tests: 3 round-trip cases
  (`GameStateManager.bounty.test.ts`). Verified `tsc --noEmit` clean; **Vitest round-trip
  still unrun** (sandboxed bg shell can't run it — see the env note under FEAT-PERSIST-SHRINES;
  confirm with `npm run test` on a normal shell).
- `eb16e16` FEAT-PERSIST-POWERBUFF — persist the **Power-shrine damage buff** across
  refresh-recovery. The buff's revert was a Phaser `delayedCall` that dies on reload,
  while the save serialized the already-doubled `damageMultiplier` → reload mid-buff left
  the player permanently double-damage. Replaced the one-shot timer with gameTime-driven
  timed buffs: each records magnitude + an absolute `gameTime` expiry, reverted per frame
  by new pure helper `expireTimedDamageBuffs` (`src/systems/TimedDamageBuffs.ts`).
  Serialized as `timedDamageBuffs` in `GameSaveState`; since `gameTime` restores verbatim,
  the list round-trips and reverts at the right moment (no re-schedule, no re-apply).
  Stacking handled; buff now pauses with the game. Backward-compatible (`?? []`, no
  version bump). Unit tests: pure expiry helper + GameStateManager round-trip.
- `f481aff` FEAT-PERSIST-CONSUMABLES — persist floor **consumables** (BOMB/FREEZE/
  VACUUM/GOLD) across refresh-recovery. New `'consumable'` EntityTag +
  `consumablePickupQuery` + `serializeConsumable` in `GameStateManager` (round-trips
  `kind`/`value`/`magnetized`); `restoreConsumable` in GameScene re-spawns via
  `spawnConsumablePickup`. Mirrors the magnet-pickup serialize/restore pattern;
  magnetized flag re-arms on proximity (not restored, matching siblings).
  Backward-compatible (absent `consumableData` = none restored; no save-version bump).
  Also introduces the repo's first **Vitest** harness (`vitest.config.ts`, 3 round-trip
  tests in `src/save/GameStateManager.consumable.test.ts`, storage module mocked).
- `ecc372a` FEAT-PERSIST (affix part) — persist elite **affixes** across refresh.
  `restoreEnemy` now re-attaches the `EnemyAffix` component (was lost → affixed enemies
  came back as normal-but-tanky: no ring/HP-bar, no volatile/vampiric/blessed behaviour,
  missed elite-kill bounties). Serialize `affixType` in `SerializedEnemyData`; restore
  re-applies the affix's flat armor (only stat re-derived from base type, not serialized).
  Backward-compatible (absent/0 = no affix; no save-version bump). Remaining FEAT-PERSIST
  parts split into FEAT-PERSIST-CONSUMABLES + FEAT-PERSIST-POWERBUFF.
- `dc6d2a3` FEAT-VICTORY-GRADE — show S–F performance grade badge + run/best
  score on the victory screen (parity with the game-over overlay). `VictoryData`
  extended; `GameScene.showVictory` now captures the `recordScore` result + grade.
- `15e2797` Fix game-over best-panel overflow (combo int at source + renderer hardening) + gate run start on intro overlay dismissal.
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

- [x] **REFACTOR-2 (phase 1) — extract regular-enemy AI handlers** (done — `ee33c19`)
  Moved all 20 regular AI handlers (types 0–17) out of `EnemyAISystem.ts` (2,098 → 1,038
  lines) into one module per handler under `src/ecs/systems/enemy-ai/` (splitter.ts holds
  splitter + splitterMini). New `enemy-ai/common.ts` carries the cross-boundary
  scaffolding: PI constants, mutable `telegraphManager` + setter (re-exported so
  GameScene's import is unchanged), `aiWorld`/`setAIWorld`/`isDestructible`. Dispatcher
  switch, LOD throttling, elite auras, and miniboss/boss handlers untouched (phases 2–3
  filed). Every moved body verified byte-identical against the pre-move git blob by an
  independent transcription diff; public API surface unchanged (barrel re-exports).
  Suite could not run in the remote sandbox — verification was typecheck fingerprint +
  the transcription diff. Follow-up phases must import `telegraphManager` as a live
  binding, never copy it to a local.
