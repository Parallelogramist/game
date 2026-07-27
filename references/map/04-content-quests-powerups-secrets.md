# 04: World Content: Quests, Power-Ups, Secrets, Reward Economy

> **Amended 2026-07-27 by operator decision.** Expedition becomes the **default** run
> mode (promoted by `FEAT-EXPEDITION-PROMOTE` after phase 6; it still ships behind
> `?expedition=1` until then), and **Recall to Hangar is a mid-run teleport, not a run
> ending**. Where this document assumes otherwise, `README.md` sections 4.1 and 7 win.


Piece 4 of the expedition-mode map feature. Owns everything that occupies the world:
POI contents, the permanent traversal ability set (the Metroid spine), temporary
field pickups, multi-step quests, secrets, and the reward economy that keeps all of
it from wrecking the existing arena balance.

Sibling docs own the substrate: `01-world-space.md` (sectors, camera, expedition
mode flag, ship movement), `02-worldgen-barriers.md` (sector graph generation,
barrier taxonomy, gated doors, solvability), `03-discovery-map-ui.md` (per-sector
and per-POI discovery persistence, minimap, map screen). Contracts this doc places
on them are collected in the final section.

Spine decisions honored throughout: sector = one arena viewport; world layout
persistent per profile and seeded; contents re-roll per run; discovery and secrets
persist across runs; expedition mode is additive and every chunk ships alone; pure
logic in Phaser-free Vitest-tested modules.

---

## 1. POI taxonomy

A sector exposes POI slots (count and positions owned by worldgen, doc 02). Each
slot is filled from the catalog below. Two placement classes:

- **Rolled**: filled per run by a seeded weighted roll (`rollPoiContents`, pure).
  Contents re-roll every run.
- **Placed**: pinned by the generator or by data (ability vaults, quest anchors,
  secrets). Position is stable per profile; whether they still appear depends on
  their once-ever state.

| Kind id | Placement | Rarity weight (rolled) | Per-run or once-ever | Reuse vs new |
|---|---|---|---|---|
| `poi_treasure_chest` | rolled | 30 | per-run | **Reuse**: chest spawn/open flow at `src/scenes/GameScene.ts:5713` (15% special with 3x rewards, 30s despawn timer disabled for POI chests, drops XP gems and sometimes a relic). New code: none beyond a spawn call at sector entry. |
| `poi_crate_field` | rolled | 25 | per-run | **Reuse**: destructible crates `GameScene.ts:3790-3841` (cap 30 stays global across loaded sectors). New: cluster placement only. |
| `poi_shrine` | rolled | 18 | per-run | **Reuse**: `SHRINE_DEFS` `GameScene.ts:230` (cleanse/power/fortune/sacrifice) and walk-in activation `GameScene.ts:4017`, save restore `GameScene.ts:2241`. New: none. |
| `poi_ambush_nest` | rolled | 15 | per-run | **Reuse**: enemy spawn pipeline and the EVENT_POOL machinery pattern (`src/systems/EventSystem.ts:33-88`) for a scripted wave; reward is a guaranteed chest (reuse above). New: nest trigger volume. |
| `poi_field_boost_cache` | rolled | 10 | per-run | **New data + reuse pipeline**: spawns 1-2 field boost consumables (section 3) through `ConsumablePickupSystem` spawn (`src/ecs/systems/ConsumablePickupSystem.ts:112`). |
| `poi_black_market` | rolled | 2, max 1 per world per run | per-run | **Reuse**: the FEAT-MARKET Black Market shrine, the game's only in-run gold sink. Placing it deep in the world is the exploration payoff for banked gold. New: none. |
| `poi_nemesis_lair` | rolled | conditional (only if `NemesisManager` holds a killer), 5 | per-run | **Reuse**: `src/meta/NemesisManager.ts` spawn, but anchored to a lair sector instead of the 120s timer when in expedition mode. Killing it there pays a guaranteed special chest. |
| `poi_ability_vault` | placed | n/a | **once-ever** per profile | **New** (section 2): guarded claim of one permanent traversal ability. After claim, the slot renders as an inert landmark (it is the map's memory of the moment). |
| `poi_quest_anchor` | placed | n/a | mixed (quest-defined) | **New** (section 4): quest giver or quest objective marker; existence driven by `ExpeditionQuests.ts` data, not by rolls. |
| `poi_secret` | placed | n/a | **once-ever** discovery; cache contents re-roll | **New + reuse** (section 5): false-wall caches, lore fragments, puzzle nodes. Found-state persists; a re-visited found cache re-rolls minor contents (gems only, no relics). |

Rules:

- Rolled weights are data in `src/data/PoiCatalog.ts` (section 8), rolled with the
  run seed so a save/reload mid-run reproduces the same contents.
- Deeper rings (graph distance from the hangar, provided by doc 02) shift weights
  toward chest/market/boost and away from crates. The shift table is data, not code.
- Placed kinds always win a slot conflict; rolled kinds fill what remains.

---

## 2. The traversal power-up set (the Metroid spine)

### Relationship to existing `dashLevel` / `phaseLevel` / `sprintLevel`: a separate axis, with synergy hooks

`src/data/PermanentUpgrades.ts` already sells `dashLevel` (:457, cooldown dash),
`phaseLevel` (:469, % chance to phase through attacks) and `sprintLevel` (:431)
for gold. Traversal abilities are **not** those upgrades and are **not** purchased.
They are boolean, profile-level ship systems earned only at ability vaults in the
world. Defense of the split:

1. **Solvability must be deterministic.** Worldgen (doc 02) must know exactly which
   keys the player can possibly hold at each graph depth. If `dashLevel >= 1` (a
   gold purchase available from shop level 30) were a barrier key, any gold-rich
   profile would trivialize gate ordering and the generator could never assume a
   key's absence. Booleans earned at generator-placed vaults keep the reachability
   proof exact.
2. **Economy isolation.** Shop upgrades are priced against the gold curve
   (`computeRunGold`, `src/meta/MetaProgressionManager.ts:132`). Making world
   progression purchasable would couple map pacing to gold farming and force a
   repricing of a 100+ entry shop. Not worth relitigating a working economy.
3. **They mean different things.** `dashLevel` is a combat stat curve. Blink Drive
   is a key that also feels good. Overloading one id to be both breaks saves,
   descriptions and the shop UI's assumptions.

Synergy hooks (so the axes interlock instead of ignoring each other): each ability
names an optional `synergyUpgradeId` into `PERMANENT_UPGRADES`. Owning shop levels
improves the earned ability (numbers below). This gives shop investment new value
in expedition mode without gating anything on it.

### The set (fixed acquisition order, index = vault depth)

Abilities are inert outside expedition mode (checked against doc 01's mode flag),
so none of them shifts arena balance. None grants damage, HP, XP or gold stats:
this is a hard type-level rule (section 6).

| # | Ability id | Opens barrier (doc 02 taxonomy id) | Earned at | Moment-to-moment change | Synergy | Anti-soft-lock rule |
|---|---|---|---|---|---|---|
| 1 | `ability_blink_drive` | `barrier_flicker_screen` (energy membrane) | Vault in ring 1, guaranteed on the first expedition's guaranteed path | Active short-range blink on a cooldown with brief i-frames; the expedition dodge verb | `dashLevel`: -1s blink cooldown per level | A flicker screen turns off permanently once blinked through from either side |
| 2 | `ability_breach_charges` | `barrier_cracked_wall` (rubble seam) | Ring 1-2 vault | Deployable charge; reuses the `ConsumableKind.BOMB` blast/visual path (`ConsumablePickupSystem.ts:13`) with a placement delay; also the false-wall prospecting tool (section 5) | none | A breached wall stays open forever (persisted via doc 03 discovery state) |
| 3 | `ability_magno_tether` | `barrier_void_gap` (impassable gap with anchor pylons) | Ring 2 vault | Aim at pylon, reel across; introduces aimed traversal | `sprintLevel`: +10% reel speed per level | Every void gap has pylons on both rims; crossing is always reversible |
| 4 | `ability_phase_cloak` | `barrier_security_grid` (laser fence) | Ring 2-3 vault | Hold to become intangible for 1.5s on a long cooldown; walks through grids and through enemy bodies | `phaseLevel`: +0.25s cloak duration per level | Grids have an inside kill-switch: passing through lets you disable it permanently from behind |
| 5 | `ability_thermal_ward` | `barrier_hazard_field` (heat/cryo sector membrane) | Ring 3 vault | Passive: hazard sectors stop draining hull; unlocks whole biome rings | `slowResist`: hazard slow reduced further | Hazard membranes never close behind the player; leaving a hazard sector is always free |
| 6 | `ability_signal_decryptor` | `barrier_ciphered_door` (endgame locks) | Ring 3-4 vault, guarded by the hardest placed encounter | Passive: ciphered doors open on touch; active ping surfaces nearby secret hints (section 5) | `luckBonus`: ping range scales | Ciphered doors stay open once opened; the decryptor vault itself sits behind barriers 1-4 only |

### Ordering / solvability constraint the worldgen must honor

Acquisition order is fixed by index. Doc 02's generator MUST place vault *i* so it
is reachable from the hangar crossing only barriers openable with abilities of
index < *i* (and un-gated seams). Formal check, run at generation time and in
doc 02's property tests: BFS from the hangar with an accumulating ability set;
every vault, every quest anchor and every non-secret sector must be visited before
the frontier empties. My contract input to that check is
`TRAVERSAL_ABILITIES[i].barrierTypeId` plus the index order (section 8).

Global stranding rule (contract on docs 01/03): **Recall to Hangar** is always
available from the map screen in expedition mode, outside a boss sector lock. Opened
gates persist per profile. Therefore physical stranding is impossible by construction,
and "soft-lock" reduces to progression-block, which the vault ordering rule prevents.

**Amended 2026-07-27:** recall is a **mid-run teleport** (the run continues at the
hangar), not the run ending this section originally assumed, and it is therefore **not
free**. A zero-cost instant teleport out of trouble deletes the risk of travelling home
wounded, which is most of what makes a deep push a decision. The recommended friction is
a short channel that breaks on damage, so recall is chosen in a lull rather than mashed
in a panic; the exact knob belongs to `FEAT-EXPEDITION-RECALL`. The stranding guarantee
above is unaffected: availability, not price, is what makes stranding impossible.

### Claim flow

A vault spawns a placed guard encounter (elite pack reusing existing elite spawn
paths; the decryptor vault reuses a boss-tier spawn). Clearing it exposes the
ability core; walk-in claim (shrine pattern, `GameScene.ts:4017`) fires
`TraversalAbilityManager.claim(abilityId)`, a toast through the achievement
callback pattern (`src/achievements/AchievementManager.ts:640`), and persists
immediately. **Claim is permanent at the moment of pickup.** Death seconds later
keeps it (section 7 defends this).

---

## 3. Temporary power-ups in the world

No parallel buff system. Two existing rails carry everything:

- **Instant effects** ride `ConsumableKind` (`ConsumablePickupSystem.ts:13`):
  BOMB/FREEZE/VACUUM/GOLD already spawn (:112), magnetize/collect per frame
  (:145) and apply through `setConsumableCollectCallback` (:44).
- **Timed effects** ride `TimedStatBuffs` (`src/systems/TimedStatBuffs.ts:23`),
  keyed to absolute run `gameTime`, so refresh-recovery already works.

### New pickups (field boosts)

Field boosts are new `ConsumableKind` enum members whose collect callback pushes a
`TimedStatBuff`. That is the whole trick: spawn, magnetize, collect, visual, and
save handling are all inherited.

| Kind | Buff | Magnitude | Duration | Found in |
|---|---|---|---|---|
| `OVERDRIVE_CELL` | `damageMultiplier` | 1.5 | 20s | boost caches, ambush nest clears |
| `SCHOLAR_LENS` | `xpMultiplier` | 2.0 | 15s | boost caches |
| `PROSPECTOR_BEACON` | `gemValueMultiplier` | 2.0 | 15s | boost caches, deep rings |
| `AFTERBURNER_CANISTER` | `moveSpeed` (existing base stat) | 1.4 | 12s | boost caches; the traversal-feel pickup |

Engine deltas, kept deliberately small:

- Extend `TimedStatField` (`TimedStatBuffs.ts:21`) with `'moveSpeed'` — the existing
  `PlayerStats.moveSpeed` base stat, NOT a new `moveSpeedMultiplier` field. `PlayerStats`
  needs no new field and GameScene needs no new mapping: `applyTimedStatBuff`'s generic
  `playerStats[stat] *= magnitude` already covers it, and
  `updatePlayerEffectiveMoveSpeed` recomputes `Velocity.speed` from that base every frame.
  `normalizeTimedStatBuffs` (:76) already defaults a missing `stat` to `damageMultiplier`
  for legacy saves; new entries always carry their `stat`, so no migration is needed.
- Magnitudes and durations are data in `src/data/FieldBoosts.ts` (section 8), not
  literals in the collect callback.

### Stacking and duration rules

- **Same boost while active: refresh, never stack.** Pure helper
  `applyFieldBoost(activeBuffs, boostDef, gameTime)` in `TimedStatBuffs.ts`: if a
  buff with the same stat and magnitude source is active, set its `expiresAt` to
  `gameTime + duration` and do not multiply again. Unit-tested.
- Different stats stack freely (they always have: shrine power + event surge).
- v1 catalog defines exactly one boost per stat, so per-stat magnitude is capped
  by data. A data test enforces magnitude <= 2.0 and duration <= 30s (section 6).

### Save/restore

Field boost buffs serialize inside the existing `timedStatBuffs` list in
`GameSaveState` (`src/save/GameStateManager.ts:312`); expiry keyed to `gameTime`
survives reload by construction. Uncollected boost pickups on the floor persist
the same way arena consumables already do (there is a dedicated
`src/save/GameStateManager.consumable.test.ts`).
No new save test was written: a field boost adds no new serialization path — it is one more
entry in the same `timedStatBuffs` list already pinned by
`src/save/GameStateManager.statbuff.test.ts`.

---

## 4. Quest system (multi-step, cross-run)

The gap: `DailyQuestManager` measures single-day run aggregates, in-run bounties
rotate one objective, and nothing spans runs with steps. Expedition quests fill
exactly that gap and nothing else. Dailies and bounties stay untouched.

### Data shape (pure, in `src/data/ExpeditionQuests.ts`)

```ts
export type QuestTrigger =
  | { kind: 'kill'; enemyCategory?: EnemyCategory; enemyId?: string }
  | { kind: 'reachSector'; sectorTag: string }          // tags from doc 02's generator
  | { kind: 'findSecret'; secretId?: string }           // any secret when omitted
  | { kind: 'openGate'; barrierTypeId?: string }
  | { kind: 'surviveInSector'; sectorTag: string; seconds: number }
  | { kind: 'escortDrone'; routeTag: string }           // fail-and-retry, never fail-forever
  | { kind: 'deliverItem'; itemId: string; destinationTag: string }
  | { kind: 'claimAbility'; abilityId: string };

export interface ExpeditionQuestStep {
  readonly id: string;                 // 'q_survey_ring2.s1'
  readonly description: string;
  readonly trigger: QuestTrigger;
  readonly target: number;             // count toward completion
  readonly scope: 'run' | 'persistent'; // does an unfinished step's counter survive death?
  readonly goldReward: number;         // paid per step, banked at once (front-loaded)
}

export interface ExpeditionQuestDefinition {
  readonly id: string;                 // 'quest_survey_ring2'
  readonly name: string;
  readonly icon: string;               // ICON_MAP key (integrity-tested)
  readonly giverPoiTag?: string;       // hangar board when omitted
  readonly steps: readonly ExpeditionQuestStep[];
  readonly completionGoldReward: number;
  readonly completionRelicRoll?: boolean;  // one roll on the STANDARD relic table
  readonly nextQuestId?: string;       // chain link, integrity-tested
}
```

### State machine (pure, in `src/systems/QuestProgress.ts`)

Instance state: `{ questId, stepIndex, stepProgress, status }` with
`status: 'available' | 'active' | 'complete' | 'claimed'`. One pure entry point:

```ts
recordQuestEvent(states, defs, event, context) -> { states, stepCompletions, questCompletions }
```

where `event` is a narrow union (`kill`, `sectorEntered`, `secretFound`,
`gateOpened`, `abilityClaimed`, `escortResolved`, `itemDelivered`, `runEnded`).
Fully unit-tested: every trigger kind, step advance, chain hand-off, and the death
settle below. No Phaser import anywhere in it.

### Manager and hooks (no duplicated tracking)

`src/meta/ExpeditionQuestManager.ts`, a singleton in the `DailyQuestManager` mold,
storage key `survivor-expedition-quests` (added to `ALL_STORAGE_KEYS`,
`src/storage/StorageBootstrap.ts:24`; the bootstrap test enforces it). It records
nothing itself. It is fed by pipes that already exist:

- Kill counts: the same run-stat increments `AchievementManager` already maintains
  (`RunStats`, `src/achievements/AchievementTypes.ts:33`); the watcher reads them
  once per second exactly like `createDailyQuestWatcher()`
  (`src/meta/DailyQuestManager.ts:204`). No second kill counter.
- `sectorEntered` / `gateOpened`: doc 01/02 contract events, the same ones doc 03
  consumes for discovery. One emission, two consumers.
- `secretFound` / `abilityClaimed`: emitted by section 5 / section 2 code.
- Run end and death: `settleExpeditionQuests()` called from the same two GameScene
  run-end sites `settleDailyQuests()` already uses.

### Death rule (the headline)

**Completed steps are checkpoints and never regress.** On death:

- `scope: 'run'` steps in progress reset their counter to 0 (the feat was "in one
  expedition"; letting it dribble across deaths makes the description a lie).
- `scope: 'persistent'` steps keep their counter (cumulative surveys, total gate
  openings).
- An in-progress escort resolves as failed for this run and is simply available
  again next run. No quest can ever become unclaimable through death.

### Surfacing

- HUD: the current step shares the bounty ticker line (`GameScene.ts:228` region);
  the bounty owns the line while active, the quest step fills idle time. One line,
  never two.
- Map screen: `ExpeditionQuestManager.getActiveQuestMarkers(): { sectorTag, icon,
  label }[]` consumed by doc 03's marker layer.
- Board: the hangar sector renders available quests (walk-in interaction, shrine
  pattern), plus quest-giver POIs placed by `giverPoiTag`.

### Anti-chore rules (enforced by data tests, section 6)

- At most 3 active quests; a fourth accept is refused by the manager.
- Every step must be completable within one expedition (no `scope: 'run'` step
  with a target beyond what a single run plausibly yields; the data test bounds
  kill targets and survive timers).
- No step ever requires re-finding an already-found secret (`findSecret` triggers
  check the persistent found-set and auto-complete if already satisfied).
- Step rewards are paid at step completion, mid-run, through
  `MetaProgressionManager.addGold` (`src/meta/MetaProgressionManager.ts:275`), the
  same way daily quests already pay mid-run. Nothing is held hostage to the end
  of a chain.
- Chains are at most 3 quests long, and `nextQuestId` cycles are a red test.

---

## 5. Secrets

### Taxonomy

| Kind | How it works | Reuses |
|---|---|---|
| False walls | A `barrier_false_wall` (doc 02 taxonomy) that looks like terrain; bump or Breach Charge reveals a cache alcove | barrier system (02), chest rewards (:5713) |
| Hidden sectors | Whole sectors flagged hidden by the generator, absent from the map until entered (rendering owned by doc 03) | discovery store (03) |
| Sequence puzzles | 2-4 switch nodes (shrine walk-in pattern, `GameScene.ts:4017`) activated in an order hinted by a lore fragment | shrine activation, EventSystem-style state |
| Environmental riddles | A lore fragment's text deterministically names a real generated landmark ("under the twin pylons in the frozen ring"); acting there opens a cache | worldgen tags (02) |
| Lore fragments | Collectible text entries; the hint carrier and the codex payoff | codex/vault UI shell |

### Hinting before finding

Three tiers, cheapest first:

1. **Ambient**: within one screen of an unfound secret, a faint minimap shimmer
   ping (doc 03 contract; respects the existing `settings-minimap-enabled` key).
2. **Lore**: fragments found elsewhere name the location in riddle form.
3. **Scanner**: `ability_signal_decryptor`'s active ping marks unfound secrets in
   the current sector on the map. Late-game cleanup tool so 100% is a goal, not
   a pixel-hunt chore.

### Persistence and HiddenUnlocks integration (no duplication)

- **Spatial found-state** (which POI, which wall) lives in doc 03's per-POI
  discovery store. Contract: `recordSecretFound(secretId)` / `isSecretFound(secretId)`.
- **Logical completion** (puzzle solved, fragment collected) lives in
  `survivor-secrets-found` (new key in `ALL_STORAGE_KEYS`), owned by a small pure
  `SecretLedger` module.
- **Consequences flow through the systems that already exist.** `LifetimeStats`
  (`src/achievements/AchievementTypes.ts:224`) gains `secretsFoundTotal` and
  `loreFragmentsFound`. New `HiddenUnlocks` conditions (`src/meta/HiddenUnlocks.ts:82+`,
  key `hiddenUnlocksV1`) predicate on them, with `getProgress()` so they surface
  in the vault ACHIEVEMENTS tab, and stages keep gating with the existing
  `hidden:<conditionId>` mechanism. Secrets get no unlock system, no toast system
  and no vault tab of their own. Finding one fires an immediate lightweight toast
  (UI only) and everything durable happens in `evaluatePostRun()` as today.

---

## 6. Reward economy

Anchors: `computeRunGold` (`MetaProgressionManager.ts:132`, kills x 2.5 + time/10 +
level x 10, floor 50, then victory/world-level/streak/ascension multipliers), relic
rarity weights 60/30/9/1 with luck bias and pity (`src/data/Relics.ts:54`,
`RelicManager`), world level scaling +15% HP / +10% damage / +15% gold per level.

Pricing principles:

1. **Exploration grants more rolls, never better odds.** Expedition chests use the
   arena relic table and the arena special-chest rate (15%, 3x) unchanged. The
   knob for depth reward is chest COUNT per ring, not table quality.
2. **Expedition bonus gold is budgeted against the arena baseline.** Pure function
   `computeExpeditionGoldBudget(expectedArenaRunGold)` in
   `src/data/GameTuning.ts` returns the per-run cap for POI + quest-step gold:
   40% of what `computeRunGold` would pay for an equal-length arena run at the
   same world level. Worldgen density and quest rewards must fit under it. The
   player still earns base run gold from kills/time/level as always, so an
   expedition run pays at most 1.4x an arena run: better, not broken.
3. **Traversal abilities carry zero combat stats.** `TraversalAbilityDefinition`
   has no numeric stat fields by type, and abilities are inert outside expedition
   mode. The permanent power a player extracts from the map is reach, not DPS.
4. **World level scaling applies to expedition sectors untouched**, with ring
   depth adding threat through doc 02's density tables. Reward-per-minute stays
   roughly flat across rings; depth pays in keys, secrets and quest steps.
5. **Field boosts are capped by data**: magnitude <= 2.0, duration <= 30s, one
   boost per stat in the catalog.
6. **Quest gold sits in the daily-quest band** (`src/data/DailyQuests.ts` pays
   250-400): steps 100-300, chain completion 500-1000. Comparable to clearing the
   daily board, never a multiple of it.

What the balance test asserts (`src/data/expeditionEconomy.test.ts`, pure):

- For a max-density generated world at representative params, the sum of maximum
  rollable POI gold plus all placed quest-step gold reachable in one run is <=
  `computeExpeditionGoldBudget(...)` for those params.
- The expedition chest relic table deep-equals the arena table (drift is a red
  build).
- Every `FieldBoosts` entry respects the magnitude/duration caps.
- Every quest step and completion reward is inside its band; `settleOnly`-style
  abuse (paying twice for one feat) is impossible because step rewards pay once
  by state machine construction (unit test in `QuestProgress`).
- `TRAVERSAL_ABILITIES` contains no key from the PlayerStats stat set (guard
  against a future author "just adding +10% damage" to an ability).

---

## 7. Failure and re-entry

**Kept on death** (profile-level):

- All discovery: map, entered sectors, found secrets, opened gates and breached
  walls (doc 03 store).
- Every traversal ability claimed, even seconds before dying.
- Completed quest steps and `persistent`-scope counters.
- Run gold, exactly as today: death still pays `computeRunGold` on the run so far.

**Reset per run**: weapons/cards/relic draft per existing run rules, field boosts,
floor pickups, rolled POI contents, `run`-scope quest counters, escort attempts.

Why this split, defended once because it is the feel decision of the piece:

A survivors run is a power fantasy that ends in a death by design; the existing
meta already converts every death into gold, streaks and world level. The map has
to convert death into the same currency of forward motion or expedition mode will
feel like the mode where dying robs you. So: **knowledge and keys persist, power
resets.** Every death strictly grows the reachable world (more map, more open
gates, maybe a new ability), which makes the next run's first minute concretely
different: new frontier, new shortest path, a quest step already half done. The
rejected alternative, extract-to-keep (lose unclaimed abilities on death,
Hades/DRG style), punishes exploration precisely at its riskiest moment and trains
players to turtle home instead of pushing one more sector. That is the wrong
lesson for a game whose core loop is "push your luck against the swarm". Contents
re-rolling per run keeps re-entry from being a checklist replay: the world's shape
is familiar, its stuffing is fresh.

---

## 8. Data files and shapes

New files, all following existing conventions (readonly def arrays, string ids
with a kind prefix like `relic_steady_eye`, `icon` keys resolved by `ICON_MAP`):

| File | Exports | Id prefix |
|---|---|---|
| `src/data/PoiCatalog.ts` | `POI_KINDS: readonly PoiKindDefinition[]` (id, icon, placement class, base weight, ring weight shifts, reuse target) | `poi_` |
| `src/data/TraversalAbilities.ts` | `TRAVERSAL_ABILITIES: readonly TraversalAbilityDefinition[]` (id, name, icon, `barrierTypeId`, `synergyUpgradeId?`, vault guard tier, ordered by index) | `ability_` |
| `src/data/FieldBoosts.ts` | `FIELD_BOOSTS: readonly FieldBoostDefinition[]` (id, `consumableKind`, `stat`, magnitude, durationSeconds, icon) | `boost_` |
| `src/data/ExpeditionQuests.ts` | `EXPEDITION_QUESTS: readonly ExpeditionQuestDefinition[]` (section 4 shape) | `quest_` / steps `q_*.sN` |
| `src/data/Secrets.ts` | `SECRET_DEFS: readonly SecretDefinition[]` (id, kind, `hintLoreId?`, `hiddenUnlockConditionId?`, reward class) | `secret_` / `lore_` |

Referential integrity (`src/data/referentialIntegrity.test.ts`): push all five
catalogs into `collectIconRefs()` (the pattern at its line 40 block), and add
cross-reference asserts in the same file: `synergyUpgradeId` resolves in
`PERMANENT_UPGRADES`; `barrierTypeId` resolves in doc 02's barrier taxonomy
export; `nextQuestId` resolves and is acyclic; quest `sectorTag`/`routeTag`
values appear in doc 02's exported tag vocabulary; `hiddenUnlockConditionId`
resolves in `HIDDEN_UNLOCK_CONDITIONS`; `FieldBoosts.consumableKind` values are
distinct members of `ConsumableKind`.

New storage keys (each added to `ALL_STORAGE_KEYS`, `StorageBootstrap.ts:24`, or
the bootstrap scan test goes red): `survivor-traversal-abilities`,
`survivor-expedition-quests`, `survivor-secrets-found`.

Mid-run save: `GameSaveState` (`GameStateManager.ts:312`) gains
`expeditionQuestRunProgress` (run-scope counters) and `vaultGuardCleared` flags;
field boosts ride the existing `timedStatBuffs` list. Ship each with a
`src/save/GameStateManager.<topic>.test.ts` in the established style (13 exist).
`migrateState()` (`GameStateManager.ts:815`) stays the vehicle if v2 is ever
needed; these additions are optional fields on v1, absent-tolerant like
`SerializedTimedStatBuff.stat`.

---

## 9. Content authoring plan (fleet-agent workflow)

Adding one more quest, secret or boost later touches data only:

1. **Quest**: append an `ExpeditionQuestDefinition` to `ExpeditionQuests.ts`
   using existing `QuestTrigger` kinds. Run `referentialIntegrity.test.ts` and
   the quest data test (bands, chore rules, acyclic chains). Green = shippable.
   No engine code: the state machine dispatches on `trigger.kind`, and every kind
   already has an event pipe.
2. **Secret**: append a `SecretDefinition` choosing an existing kind; optionally
   add a `HiddenUnlocks` condition (existing authoring pattern at
   `HiddenUnlocks.ts:82+`) and reference it. Worldgen picks placement from the
   catalog automatically.
3. **Field boost**: append to `FieldBoosts.ts` reusing an existing
   `TimedStatField`. A new stat field is an engine change and is flagged as such.
4. **POI kind or trigger kind**: engine change, out of authoring scope, gets its
   own work order.

The data tests are the authoring contract: an agent that only edits `src/data/`
and keeps the suite green cannot break saves, solvability inputs, or the economy
caps.

---

## 10. Chunk list (individually shippable work orders)

Existing IDs `FEAT-QUEST-LIVE` and `FEAT-DAILY-QUESTS` are taken; none below
collide. Dependencies on sibling docs are named; chunks 1, 2, 4, 5 ship value
with zero dependency on the other architects.

### FEAT-POI-CATALOG
- **Value**: one data contract for what fills sectors, so worldgen and content
  land independently; expedition sectors get chests/shrines/crates by pure reuse.
- **Files**: new `src/data/PoiCatalog.ts`; new pure
  `src/systems/expedition/PoiRoll.ts` (`rollPoiContents(seed, slots, ring)`);
  `src/data/referentialIntegrity.test.ts` (extend `collectIconRefs`, ~line 40).
- **Done when**: catalog + deterministic roll exist (same seed, same contents);
  weights and ring shifts are data; integrity test covers the catalog; suite green.
- **Deps**: none. Doc 02 consumes it.
- **Tests**: `PoiRoll` determinism + weight distribution; integrity extension.

### FEAT-POWER-TRAVERSAL
- **Value**: the permanent ability axis exists and persists, unblocking every
  gated barrier in doc 02.
- **Files**: new `src/data/TraversalAbilities.ts`; new
  `src/meta/TraversalAbilityManager.ts` (pure core + SecureStorage wrapper);
  `src/storage/StorageBootstrap.ts:24` (`survivor-traversal-abilities`);
  integrity test (synergy ids, barrier ids).
- **Done when**: `claim()` is idempotent and ordered, ownership survives reload,
  bootstrap scan test green, defs expose `barrierTypeId` + index for doc 02.
- **Deps**: none.
- **Tests**: manager pure core (claim/has/order); integrity extension.

### FEAT-POWER-VAULTS
- **Value**: abilities are EARNED in the world: the Metroid moment.
- **Files**: `GameScene.ts` expedition spawn path (chest pattern :5713, shrine
  walk-in :4017, achievement toast callback `AchievementManager.ts:640`);
  `GameStateManager.ts:312` `vaultGuardCleared`; new
  `src/save/GameStateManager.vault.test.ts`.
- **Done when**: vault guard clears, walk-in claim fires toast and persists,
  death after claim keeps the ability, mid-run reload restores a cleared guard.
- **Deps**: FEAT-POWER-TRAVERSAL; doc 02 placed slots; doc 01 mode flag.
- **Tests**: save/restore test only (spawn flow is Phaser-coupled).

### FEAT-POWER-FIELDBOOSTS
- **Value**: temporary pickups make sectors worth entering; shippable standalone
  because boost caches can also drop from arena special chests.
- **Files** (as shipped): `src/ecs/systems/ConsumablePickupSystem.ts` (four enum members,
  colors, glyphs, `getConsumableKindColor`); `src/systems/TimedStatBuffs.ts` (`'moveSpeed'`
  in `TimedStatField`, pure `applyFieldBoost`); new `src/data/FieldBoosts.ts`; GameScene
  (`FIELD_BOOST_DROP_CHANCE` pre-roll in `spawnRandomConsumable`, `spawnFieldBoostPickup`,
  `collectFieldBoost` off `activateConsumable`'s `default:` arm).
- **Done when**: each boost picks up, applies, refreshes on duplicate pickup
  instead of stacking, expires on the `gameTime` clock, and survives reload.
- **Deps**: none.
- **Tests**: `applyFieldBoost` refresh/stack rules only, appended to
  `src/systems/TimedStatBuffs.test.ts`. Save/restore and data-cap tests were judged
  unnecessary — see section 3.

### FEAT-QUEST-CHAINS
- **Value**: multi-step objectives that span runs: the missing quest layer.
- **Files**: new `src/data/ExpeditionQuests.ts`, `src/systems/QuestProgress.ts`,
  `src/meta/ExpeditionQuestManager.ts`; `StorageBootstrap.ts:24`
  (`survivor-expedition-quests`); GameScene run-end sites (beside
  `settleDailyQuests()`); watcher beside `DailyQuestManager.ts:204`;
  `GameStateManager.ts:312` run-progress block; new
  `src/save/GameStateManager.expeditionquest.test.ts`.
- **Done when**: a two-step quest progresses across two separate runs; death
  resets only `run`-scope counters and never a completed step; step gold pays
  mid-run via `MetaProgressionManager.addGold` (:275); toasts fire.
- **Deps**: doc 01/02 `sectorEntered`/`gateOpened` events for those trigger
  kinds (kill/survive/ability triggers work without them, so the chunk ships on
  kill-quests alone).
- **Tests**: `QuestProgress` state machine (every trigger kind, death settle,
  chain hand-off, no-double-pay); quest data rules test; save/restore.

### FEAT-QUEST-BOARD
- **Value**: quests become visible and acceptable: HUD line, map markers,
  hangar board.
- **Files**: GameScene bounty ticker share (:228 region); hangar board
  interaction (shrine walk-in pattern); marker feed
  `getActiveQuestMarkers()` for doc 03.
- **Done when**: active step shows on HUD only when the bounty line is idle;
  markers appear on the map screen; accept/claim round-trips through the board.
- **Deps**: FEAT-QUEST-CHAINS; doc 03 marker layer.
- **Tests**: none new (UI wiring); marker feed shape covered in manager tests.

### FEAT-SECRET-CACHE
- **Value**: the world lies to you, pleasantly: false walls and hidden caches
  with persistent found-state.
- **Files**: new `src/data/Secrets.ts`; new pure `src/meta/SecretLedger.ts`;
  `StorageBootstrap.ts:24` (`survivor-secrets-found`);
  `src/achievements/AchievementTypes.ts:224` (`secretsFoundTotal`,
  `loreFragmentsFound`); `src/meta/HiddenUnlocks.ts:82+` (2-3 new conditions
  with `getProgress()`); reveal hook on doc 02's false-wall barrier event;
  integrity test extension.
- **Done when**: breaching a false wall reveals a cache once ever; found-state
  survives reload and re-generation; a `HiddenUnlocks` condition on
  `secretsFoundTotal` progresses in the vault tab and can gate a stage via the
  existing `hidden:<conditionId>` mechanism.
- **Deps**: doc 02 false-wall barrier + doc 03 `recordSecretFound` store;
  FEAT-POWER-TRAVERSAL for Breach Charges reveals (bump-reveal works without).
- **Tests**: `SecretLedger` pure logic; integrity extension; HiddenUnlocks
  condition predicates.

### FEAT-SECRET-LORE
- **Value**: secrets are hinted, not stumbled into: fragments, riddles,
  sequence puzzles, decryptor ping.
- **Files**: `Secrets.ts` (lore + puzzle defs); fragment pickup (consumable
  pipeline); puzzle switch nodes (shrine walk-in pattern); codex/vault listing;
  minimap shimmer + decryptor ping via doc 03 contract.
- **Done when**: a collected fragment persists and its riddle names a location
  tag that exists in the profile's generated world (integrity assert); a
  sequence puzzle solves once ever; ping marks unfound secrets in-sector.
- **Deps**: FEAT-SECRET-CACHE; doc 03 ping contract; decryptor ping needs
  FEAT-POWER-TRAVERSAL.
- **Tests**: puzzle sequence pure logic; riddle tag integrity.

### FEAT-ECON-WARDS
- **Value**: locks the economy so later content authoring cannot drift balance.
- **Files**: `src/data/GameTuning.ts` (`computeExpeditionGoldBudget`, caps);
  new `src/data/expeditionEconomy.test.ts` (all section 6 asserts).
- **Done when**: every section 6 assert passes against the shipped catalogs;
  a deliberate violation (test fixture) goes red.
- **Deps**: FEAT-POI-CATALOG, FEAT-POWER-FIELDBOOSTS, FEAT-QUEST-CHAINS (it
  audits their data; ship it immediately after the third of those lands).
- **Tests**: the chunk IS tests plus one pure function.

---

## Contracts on the sibling architects

**Doc 01 (world-space)**: an expedition-mode flag readable by pure code (abilities
inert outside it); ship movement hooks for Blink Drive and Magno-Tether actives;
a `sectorEntered(sectorTag)` event; Recall to Hangar always available from the
map screen outside a sector lock, as a mid-run teleport that routes through the
streaming activation path (README section 4.1).

**Doc 02 (worldgen/barriers)**: barrier taxonomy exports exactly the six ids in
section 2's table plus `barrier_false_wall`, keyed by string id; the generator
consumes `TRAVERSAL_ABILITIES` index order and places vault *i* reachable with
abilities < *i* (accumulating-BFS solvability check in its tests); POI slots per
sector with placed-beats-rolled resolution against `PoiCatalog`; a stable
exported tag vocabulary (`sectorTag`, `routeTag`) for quest and riddle
referential integrity; `gateOpened(barrierTypeId)` events; hidden-sector flag.

**Doc 03 (discovery/map/UI)**: per-POI discovery store exposing
`recordSecretFound(secretId)` / `isSecretFound(secretId)` and persistence of
opened barriers; a marker layer accepting `{ sectorTag, icon, label, kind }` for
quests, vaults and hints; minimap shimmer ping and decryptor ping surfaces;
map-screen Recall to Hangar affordance.
