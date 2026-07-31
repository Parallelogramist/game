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

**As built (`FEAT-POI-CATALOG`, 302052a).** The chunk shipped wired rather than as a data
contract alone: `src/data/PoiCatalog.ts` (the content table plus the depth-band weight
scales), pure `src/world/poiRoll.ts` (`rollPoiContents`), and a `GameScene` consumer
(`stockSectorPois`) that stocks a sector the first time this run's ship enters it. Where it
departs from the model above:

- **Slots carry a `PoiKind` from the generator** (`sectorInterior.placePoiSlots` assigns
  `Treasure` / `Shrine` / `Secret` / `QuestGiver` / `AbilityPowerUp`), so the table's
  generic-slot model does not hold. Each catalog entry instead names the `slotKind` it may
  fill, and a slot kind the catalog does not cover simply stays unspawned.
- **Live kinds:** `poi_treasure_chest`, `poi_crate_field`, `poi_field_boost_cache` and
  `poi_black_market` (once per world per run, weight 0 in the shallow band) on `Treasure`
  slots; four shrine archetypes on `Shrine` slots. `poi_ambush_nest` and `poi_nemesis_lair`
  are not built and are filed as `FEAT-POI-AMBUSH-NEST`. `Secret` and `QuestGiver` slots stay
  inert for `FEAT-SECRET-CACHE` and `FEAT-QUEST-CHAINS`, which own their persistent state.
- **One catalog entry per shrine archetype** (`poi_shrine_cleanse` / `_power` / `_fortune` /
  `_sacrifice`) instead of one `poi_shrine` carrying a `shrineType` string: `GameScene`'s
  switch then maps each id to a `ShrineType` literal the compiler checks, so a typo is a red
  build rather than an altar that silently never spawns.
- **POI chests disable both the 30s despawn and the chest drone**, unlike the timer chests
  they otherwise reuse verbatim. This is a world-sized map, not a screen: the despawn would
  delete a placed reward the player is still flying toward, and the drone would drag every
  cache in the world at the player through walls.
- **No icon field**, so the catalog is deliberately absent from
  `referentialIntegrity.test.ts`: nothing renders a POI icon and no spawn fires a toast, so an
  icon key would be data with no consumer.
- **Determinism key is `poi:<worldSeed>:<runSalt>:<slotId>`**, seeded per slot rather than per
  sector so a half-stocked sector rolls identical contents for its remaining slots after a
  refresh. The run's salt, its spawned-slot set and the once-per-run flag persist as the
  optional `poiState` save block; neither `SAVE_VERSION` nor `WORLDGEN_VERSION` moved.

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

*(As built, `FEAT-POWER-TRAVERSAL`: the shipped `synergyUpgradeId` values are the real
`PERMANENT_UPGRADES` ids `dashLevel`, `sprintLevel`, `phaseLevel`, `slowResistLevel` and
`luckLevel`. This table's `slowResist` and `luckBonus` were informal shorthand, and
`ability_breach_charges` ships with no synergy id at all, matching its "none" row. The
shipped catalog also carries a `description` and `guardTier: 'elite' | 'boss'` per
ability, the latter recording the "guarded by the hardest placed encounter" note on row 6
as data. The per-level synergy magnitudes above stay this doc's spec for
`FEAT-POWER-VAULTS` to implement: they do not ship as data, because nothing consumes them
yet and a number in a catalog that no code reads is a second source of truth waiting to
drift.)*

**As built (FEAT-POWER-ABILITY-EFFECTS, blink half, c2dc1bb):** row 1 is implemented and rows
2 to 6 are not; `FEAT-POWER-ABILITY-EFFECTS-REST` carries the rest and
`IMPLEMENTED_TRAVERSAL_ABILITY_IDS` in `src/data/TraversalAbilities.ts` is the single record of
which descriptions the claim toast is allowed to print. Three deviations from row 1's cell.
(1) The blink does not get its own button or its own cooldown: it **replaces** the dash on the
existing dash input and reuses `InputController`'s dash cooldown timer, because it is the same
verb, because sharing the timer forbids blink-then-dash double mobility, and because that timer
is already in the run save, so a mid-run reload restores the blink cooldown with no new save
field. (2) The synergy is `-1 s` per `dashLevel` off a **6 s blink base**, not off the dash's
own `8 - dashLevel` curve: applying the same reduction twice to one press would double-dip, and
the blink must work at `dashLevel 0` because a traversal ability may never depend on a gold
purchase (section 2's own first defence of the split). (3) The blink's landing point is
`resolveCircleMove` at the player radius, so it stops at geometry instead of passing through it;
the "energy membrane turns off once blinked through from either side" anti-soft-lock rule stays
unbuilt with `barrier_flicker_screen` itself, and a blink that resolves under 24 px of travel is
refused without spending the cooldown.

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

**As built (FEAT-POWER-VAULTS, a2361d0):** the walk-in claim, permanence at the moment of
pickup and the toast all shipped as specified, in `GameScene.claimAbilityVault`
(`claimTraversalAbility` + `DiscoveryManager.markPoiCollected`, then burst, shake, level-up
sting and toast, all before the graphics are destroyed). Two things differ from the text above.
**The placed guard encounter did not ship**: a vault core is exposed and claimable from the
moment you reach it, and its cost is the flight out to a depth-3+ sector through whatever the
director is spawning. The guard is carried in full by `FEAT-POWER-VAULT-GUARD`, which also owns
the "mid-run reload restores a cleared guard" criterion and the `vaultGuardCleared` save field
it needs. **The toast prints a fixed description**, "Doors keyed to it now open as you
approach.", rather than `definition.description`: those descriptions name active systems (a
blink with i-frames, a deployable charge, a tether) that no code grants yet, and the only
implemented effect of owning an ability is that its doors open, so printing them would promise
a capability the player does not receive. `FEAT-POWER-ABILITY-EFFECTS` carries that.

### As built (FEAT-POWER-VAULT-GUARD, 7d33979, 2026-07-31)

The guard shipped as specified. Entering a sector that hosts an unclaimed vault stands a placed
pack up in a ring around the core (`GameScene.spawnVaultGuards`, off `VAULT_GUARD_PACKS`), and
while any member lives the core is inert: it draws in hazard orange at 55% alpha, the walk-in
claim is refused, and a core inside 170px says so once per sector visit. Killing the last guard
repaints the core in its own violet, writes the cleared flag and hands the shipped
`claimAbilityVault` walk-in back unchanged.

**The `vaultGuardCleared` save field named above did not ship, and was not forgotten.** The bit
lives in the discovery store instead, as `PoiFlags.GUARD_CLEARED`, written through
`DiscoveryManager.markVaultGuardCleared`. Three reasons. First, `GameSaveState` is the run save,
so a cleared guard would die with the run and the same pack would be re-fought after every
death, which is not what "earned" means on a profile that flies one fixed seed forever. Second,
the discovery store is already keyed on `(worldSeed, worldGenVersion)` and already owns exactly
this class of per-world fact: `SecretFlags.FOUND` is what keeps a claimed cache claimed across
deaths and reloads. Third, it satisfies the carried "a mid-run reload restores a cleared guard"
criterion and more, with zero save-state surface and no `SAVE_VERSION` bump. Widening
`POI_VALID_MASK` to `0b111` needs no `DISCOVERY_VERSION` bump either: a wider mask only admits a
bit that every value written before the commit already has unset.

**No member of a pack may be boss-tier.** `handleEnemyDeath` runs the victory path on any death
with `xpValue >= 1000`, so a boss standing in a side room would end the run the moment its vault
was cleared. The decryptor vault's `'boss'` guardTier is therefore a miniboss-tier anchor (the
Stalker, xpValue 300) plus a heavier escort, never an xpValue-1000 spawn.
`referentialIntegrity.test.ts` pins both halves: every pack member resolves in `ENEMY_TYPES`, and
none of them reaches the victory-path floor.

**Guards are never written to the run save.** `serializeEntities` skips any enemy carrying
`VaultGuardTag`, on the `Destructible` precedent immediately above it: an entity the world can
rebuild is not saved. Persisting a guard would put the saved pack and the freshly-spawned pack in
the same room after a refresh. Whether the fight was won is persisted, in the discovery store, so
a refresh mid-fight rebuilds the pack while a cleared vault stays cleared.

**Room-reset is the rule.** Leaving the sector despawns the pack silently (no rewards, no kill
credit, so an unbeaten guard never routes through `handleEnemyDeath`), and re-entry rebuilds it
at full strength. The despawn is not optional: the leash re-places any enemy below xpValue 30
onto the view ring, so an abandoned pack would follow the ship across the whole world.

Three surfaces were deliberately left alone. The radar still writes a plain `'pickup'` blip for
a guarded core, because a second contact kind belongs to `FEAT-DISCOVERY-FEEDBACK-07` and the
`FEAT-BARRIER-DOOR-READOUT` precedent already declined to encode a lock state into a glyph that
small. `MapScene` is untouched, because vaults are not drawn on the sector chart at all yet and
that glyph is `FEAT-MAPUI-DOORS-05`. `claimAbilityVault` itself is untouched: its only reachable
caller now runs for an unguarded vault, so a second guard check inside it would be dead code.

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

*(As built, `FEAT-QUEST-CHAINS`, 5362cdb: five quests in two chains shipped end to end, with
seven deviations from this section. Each is listed with its reason, and each is either filed
as a follow-up or owned by a named later chunk.*

*Four trigger kinds shipped, not eight: `kill`, `reachDepth`, `openGate`, `claimAbility`.
`findSecret` needs `FEAT-SECRET-CACHE` for found-state, `escortDrone` and `deliverItem` need
entities nothing spawns, and `surviveInSector` needs a dwell timer that chunk had no business
inventing. A union member with no producer is an inert deliverable, so the other four are
absent from `QuestTrigger` rather than declared and dead. Filed as `FEAT-QUEST-TRIGGERS-REST`.*

*The location trigger is `reachDepth`, an absolute sector depth folded with max, not
`reachSector` keyed by `sectorTag`. No `sectorTag` or `routeTag` vocabulary is exported by
`src/world/`: README section 3.1 reserves the names and doc 02 shipped none, so a tagged
trigger would have needed a new generation input. `SectorDef.depth` is the existing semantic
"how far out" measure and is already what `POI_DEPTH_BANDS` reads. Folding with max is also
what makes a re-entered sector idempotent with no visited-set to persist.*

*Quest status is `active` | `complete`, not the four-value union. `available` and `claimed`
only mean something once a board can accept and claim a quest, which is `FEAT-QUEST-BOARD`.*

*No `giverPoiTag` shipped, so `QuestGiver` POI slots stay inert and quests auto-activate.
Walk-in accept is the board's job by name.*

*No `completionRelicRoll` shipped. Its odds sit on the table `FEAT-ECON-WARDS` is about to
lock, and econ rule 1 says exploration grants more rolls and never better odds, so authoring
a roll now would author it against a table that is about to move. Filed as
`FEAT-QUEST-COMPLETION-RELIC`.*

*The run-scope clear moved. This section's death rule is unchanged in effect, but the clear
runs at the START of the next expedition (`beginExpeditionQuestRun`) rather than at the
run-end settle sites: a run can end through death, victory, the END RUN dialog or a closed
tab, and a reset that only some of those paths reach would leak one run's counter into the
next. The consequence is filed as `CHORE-QUEST-RUNEND-SETTLE`: a run-end surface that ever
displays quest progress would show the dying run's un-cleared counters. Nothing reads them
today.*

*No `GameSaveState` field and no `SAVE_VERSION` bump. `ExpeditionQuestManager` writes every
state change straight to `survivor-expedition-quests`, so step progress already survives a
refresh and a save field would be new persistence carrying no fact. The one run-scoped value
in the scene is the kill baseline, seeded from the already-restored `killCount` in
`resetInRunFeatureState()`.)*

**As built (`FEAT-WORLDGEN-QUESTDOORS`, 52e0802, 2026-07-31).** Finishing a quest chain now
unlocks a sealed region of the map, which is the payoff this section's chains were pointing
at. This doc names no quest-door mechanism, so the shape is recorded here rather than
corrected anywhere above.

*Keys are granted by chain heads, not by chain completion. `ExpeditionQuestDefinition` gained
an optional `grantsKeyId`, set on `quest_survey_01` and `quest_gatecrash_01` only. Hanging the
key off the head means both keys are earnable in the first hours; hanging them off the tails
would have put one behind `quest_gatecrash_02`'s 1000 persistent kills. Two keys ship because
the catalog has two chains: `EXPEDITION_QUEST_KEY_ORDER` is derived from the catalog, so
`FEAT-QUEST-CATALOG-DEPTH` adds sealed regions for free.*

*Placement is on optional bridge regions, not on the nested subtrees the ability gates use.
`BACKLOG.md`'s chunk asked for "the same nested-subtree method after the ability gates", but
nesting a quest door inside `finalRegion` would put it on the critical path to the boss and
make a quest mandatory to finish the run. `placeQuestKeyDoors` instead converts only a bridge
edge whose far side excludes the start sector, the boss arena, every ability-granting slot and
every ability door, counting every non-`Wall` edge as a connection so a region reachable around
the door is rejected rather than half-locked. The critical path stays passable with abilities
alone, which is what keeps section 2's solvability constraint intact.*

*No `WORLDGEN_VERSION` bump. The pass consumes no RNG (a deterministic scan plus an explicit
sort) and only converts an existing `Open` edge, reusing the per-edge-id seeded `makeEdge`, so
a seed's sector set, ability order, boss arena, POI slots and breakables are unchanged. Bumping
the version would have regenerated every world and discarded the discovery state
`FEAT-SECRET-CACHE` had just started filling. Held keys are derived from completed quest state
on every read, so nothing new is persisted either.*

### Surfacing

- HUD: the current step shares the bounty ticker line (`GameScene.ts:228` region);
  the bounty owns the line while active, the quest step fills idle time. One line,
  never two.
- Map screen: `ExpeditionQuestManager.getActiveQuestMarkers(): { sectorTag, icon,
  label }[]` consumed by doc 03's marker layer.
- Board: the hangar sector renders available quests (walk-in interaction, shrine
  pattern), plus quest-giver POIs placed by `giverPoiTag`.

*(As built: `FEAT-QUEST-VIEW`, 5a0295d. Bullet 1 shipped as specified. The ticker takes over the
idle branch of `updateBounties()`, re-reads the quest store on a 1 s timer and cycles every 5 s
across up to 3 active quests, rendering `OBJECTIVE · <description> <progress>/<target>`. It keeps
the bounty line's own colour, because `setColor` on a per-frame path forces a full text re-render
while the `OBJECTIVE ·` / `BOUNTY ·` prefixes distinguish the two modes for free. A `worldMap()`
null check keeps the line empty for arena, daily, gauntlet and practice runs without a mode flag.*

*Bullet 2 shipped as a text panel on the map screen (`MapScene.renderObjectivesPanel()`, active
quests top-left with chain position and step progress), NOT as `getActiveQuestMarkers()`. None of
the four triggers `FEAT-QUEST-CHAINS` could produce a signal for (`kill`, `reachDepth`, `openGate`,
`claimAbility`) names a sector, so a `sectorTag` marker feed has nothing to key on, and doc 03's
marker layer is `FEAT-MAPUI-DOORS-05`, which has not shipped: the feed would have had neither a key
nor a consumer. It is filed against `FEAT-QUEST-BOARD` behind both deps.*

*Bullet 3 did not ship. With quests auto-activating up to `ACTIVE_EXPEDITION_QUEST_LIMIT = 3` and
the catalog holding exactly two chain heads, an accept UI has nothing to accept and a claim UI
nothing to claim, since completion already pays automatically. It needs more chain heads than the
cap first (`FEAT-QUEST-CATALOG-DEPTH`), so `QuestGiver` POI slots stay inert.*

*The read model both surfaces render from is the pure `buildQuestStepViews(states, defs)` in
`src/systems/QuestProgress.ts`, not a manager method: the manager only supplies the stored states
through `getActiveQuestStepViews()`. One projection means the HUD and the map can never disagree,
and it is where the display rules live (a completed quest, a state the catalog no longer resolves
and a step index past the end are all absent rather than drawn blank, and progress is clamped to
the target so an overshot persistent counter never displays as 412/400).*

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

### As built (`FEAT-QUEST-SECRET-CHAIN`, 6e72c65, 2026-07-31)

`findSecret` shipped, with three deliberate departures from the data shape above.

1. **`secretKind?: SecretTier`, not `secretId?`.** A secret's id is generated per world
   (`poi:12,-3:0`), so a static catalog can never name one and a `secretId` trigger would be
   unauthorable. The authorable axis is which kind of find, and `SecretTier`
   (`'cache' | 'hiddenSector'`, `src/world/secretRewards.ts`) is the split the reward table
   already uses. Omitting it matches either kind, exactly as `claimAbility`'s optional
   `abilityId` does.
2. **The "auto-complete an already-found secret" anti-chore rule does not apply** to what
   shipped: no step names a specific secret, every step counts finds, and a count step is
   satisfied by playing rather than by re-finding anything.
3. **Persistent counters start at activation.** A profile that had already found 40 caches
   starts `quest_secret_02.s1` at 0, identical to the shipped persistent kill steps. Seeding
   from `LifetimeStats.secretsFoundTotal` would make that counter a second source of truth for
   quest progress.

The producers are `GameScene.claimSecretCache` and `GameScene.announceHiddenSector`, each a
single last-statement `recordExpeditionQuest` call behind the existing `worldMap()` guard, so
arena, daily, gauntlet and practice runs stay out. The chain (`quest_secret_01` ->
`quest_secret_02`) grants no quest key: a third key would seal a third region on every seed,
which is `FEAT-QUESTDOOR-CATALOG-DEPTH`.

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
  (`src/achievements/AchievementTypes.ts:224`) carries `secretsFoundTotal` and
  `hiddenSectorsFoundTotal` (both shipped) and still wants `loreFragmentsFound`, which
  `FEAT-SECRET-LORE` owns. New `HiddenUnlocks` conditions (`src/meta/HiddenUnlocks.ts:82+`,
  key `hiddenUnlocksV1`) predicate on them, with `getProgress()` so they surface
  in the vault ACHIEVEMENTS tab, and stages keep gating with the existing
  `hidden:<conditionId>` mechanism. Secrets get no unlock system, no toast system
  and no vault tab of their own. Finding one fires an immediate lightweight toast
  (UI only) and everything durable happens in `evaluatePostRun()` as today.

### As built (`FEAT-SECRET-CACHE`, 756f346, 2026-07-31)

- **Taxonomy row 1 shipped as proximity-reveal, not false walls.** A cache sits on the open,
  reachable floor a `PoiKind.Secret` slot already occupies and fades in on a quadratic ramp
  inside a 300px sense radius, claimed by walking within 44px. Binding secret slots into
  `sector.breakables` is a generator change plus a `WORLDGEN_VERSION` bump, which discards
  every existing profile's discovery state, so the false-wall half is filed separately as
  `FEAT-SECRET-FALSE-WALLS`.
- **`recordSecretFound` / `isSecretFound` landed as `DiscoveryManager.markSecretFound` /
  `getSecretFlags`**, against the flag store this doc's first bullet names. No new contract
  was added: `SecretFlags.FOUND | HINTED` are written together (`repairSecret` already treats
  FOUND without HINTED as corrupt) and the found flag doubles as the cache's spawn gate, so
  there is no spawned-ids list to disagree with it.
- **`SecretLedger` and the `survivor-secrets-found` key were not built.** Logical completion
  is for puzzles and fragments, neither of which exists yet, and the only fact that does exist
  today is a count, which `LifetimeStats.secretsFoundTotal` persists and sanitizes already.
  Building the ledger now would be a second store holding one integer.
- **`loreFragmentsFound` waits for `FEAT-SECRET-LORE`**, which owns the fragment that would
  increment it.
- **Completion percent now weights secrets.** `DiscoveryManager.getCompletionPercent()` scores
  `(visited sectors + found secrets) / (sector count + secret count)`, which is what its own
  reserved comment described.

### As built (`FEAT-SECRET-AMBIENT-PING`, 9d8f9c5, 2026-07-31)

- **Hint tier 1 shipped non-directional and sector-scoped.** `SECRET_PING_RADIUS` is 640px,
  one 1280x720 viewport half-width, so "within one screen" is measured from the ship and the
  hint leads the cache's own 300px reveal ramp by a full screen. The shimmer is a disc wash
  plus a ring on the radar, never a blip: it says a cache is in this room and never where,
  which leaves tier 3 (the decryptor scan, which marks position in-sector) something to be.
- **The set it reads is `GameScene.activeSecretCaches`**, the sector's unfound caches, so
  "fires nothing once found" is structural rather than a check: a claim splices the cache out
  of the list in the same frame. A neighbouring sector's cache does not ping, filed as
  `CHORE-SECRET-PING-CROSS-SECTOR`.
- **Reduced motion holds the shimmer steady instead of hiding it**, matching the discovery
  pill: the information stays, the breathing goes. `settings-minimap-enabled` gates it for
  free, since `MinimapManager.update` returns on its first line when the radar is off.

### As built (`FEAT-SECRET-HIDDEN-SECTORS`, c242028, 2026-07-31)

- **Taxonomy row 2 shipped without a `WORLDGEN_VERSION` bump.** Sealing consumes no RNG and
  only converts an existing `Open` edge through the per-canonical-edge-id `makeEdge`, and
  `sectorInterior` branches on `edge.kind` in exactly one place (`apertureMouthTile`, the
  depth-0 mouth tile), so POI ids, breakables, entry tiles, danger and biome are unchanged and
  every existing profile keeps its discovery state. Concealment is a generation input
  (`hiddenSectorCount`, default 0), the `questKeyOrder` shape, so the invariant suite's worlds
  are untouched.
- **A hidden sector is a dead-end leaf, deepest-first.** Not the start, not the boss arena, no
  ability host, exactly one non-Wall edge which must still be `Open`, and never behind another
  hidden sector. A leaf lies on no path between two other sectors, so gate-order solvability
  with breakables treated as walls holds by construction rather than by a validator. Measured
  over the 100 invariant seeds: 8-18 candidates per world, 0 seeds short of 3.
- **The wall is the hint, the map is not.** The breakable mouth is visible in the room and on
  the radar exactly like every other breakable, but the map suppresses both the sector outline
  AND the door glyph until the sector is entered, so the chart never points at blank space.
  A cache inside a hidden room needs nothing extra: `stockSectorPois` runs on entry, so the
  `FEAT-SECRET-AMBIENT-PING` shimmer cannot leak through the wall either.
- **Not built, deliberately: a lifetime counter.** Hidden sectors do NOT feed
  `secretsFoundTotal`; conflating them with caches would move `FEAT-SECRET-CACHE`'s shipped
  unlock thresholds. Filed as `FEAT-SECRET-HIDDEN-LIFETIME`.

### As built (`FEAT-SECRET-REWARD-VARIETY`, b970287, 2026-07-31)

- **One table, both secret kinds.** `src/world/secretRewards.ts` holds five payouts and is
  rolled by `GameScene` for a walked-into cache (`tier: 'cache'`, at spawn, where the sector
  depth is in hand) and for a hidden sector's first entry (`tier: 'hiddenSector'`, gated by
  `changes.sectorsVisited`, which is already permanent per world). Taxonomy row 2 therefore
  pays a reward as well as a chart entry.
- **Deterministic per world, not per run.** The key is
  `secretReward:<worldSeed>:<tier>:<secretId>` with no run salt, because a found secret never
  respawns: a per-run salt would make the payout unrepeatable rather than varied.
- **Econ-neutral by construction, which is why it did not wait for `FEAT-ECON-WARDS`.** No
  entry pays gold, chest entries are the arena relic table at the arena rate (section 6 rule 1,
  depth pays in chest COUNT), and field boosts come from the already-capped `FIELD_BOOSTS`.
  The table adds zero to the expedition gold budget that chunk will enforce, so it is a choke
  point that chunk can assert against rather than a debt it inherits.
- **The floor still gives nothing away.** `drawSecretCache` is unchanged, so every cache looks
  identical on approach and the `FEAT-SECRET-AMBIENT-PING` shimmer keeps saying "a cache is in
  this room" and nothing more. The reward is named in the find toast, at the touch.
- **Not built, deliberately: the gold row and both fragment rows.** Filed as
  `FEAT-SECRET-REWARD-GOLD` (blocked on the same parked balance decision) and
  `FEAT-SECRET-REWARD-FRAGMENTS` (`revealOnMapFragment` and lore fragments do not exist, so
  either would have paid nothing).

### As built (`FEAT-SECRET-HIDDEN-LIFETIME`, cf08619, 2026-07-31)

- **Hidden sectors got their own counter, not a share of `secretsFoundTotal`**, which answers
  the open question the `FEAT-SECRET-HIDDEN-SECTORS` block's last bullet left. The field is
  `LifetimeStats.hiddenSectorsFoundTotal`, so the two cache thresholds (5 and 25) are untouched
  and neither counter can earn the other's unlock.
- **The increment rides the permanence gate that already exists.** `announceHiddenSector` fires
  once per sector per world behind the `changes.sectorsVisited` delta, so the tally needs no
  store of its own, no dedupe list and no run-end pass: it lands at the break-in and survives a
  reload and a re-entry.
- **Two conditions and two paints, in the units the counter actually has.**
  `unlock_wall_breaker` at 3 is one world swept clean (`EXPEDITION_HIDDEN_SECTOR_COUNT`) and
  `unlock_void_mason` at 15 is five, behind `cosmetic_breaker_plate` (rank 16) and
  `cosmetic_voidmason_hull` (rank 17), with no existing paint rank renumbered.
- **Nothing new to render.** This section's own "secrets get no unlock system, no toast system
  and no vault tab of their own" rule holds: both conditions carry `getProgress`, so the vault
  ACHIEVEMENTS rows, the post-run closest-to-unlock panel and the paint picker's locked cards
  surface them from `getProgress` and `hintText` with zero UI work.
- **No version bump anywhere.** `ACHIEVEMENT_VERSION`, `SAVE_VERSION`, `WORLDGEN_VERSION` and
  `DISCOVERY_VERSION` are all unchanged, because `sanitizeLifetimeStats` rebuilds from
  `createDefaultLifetimeStats()`, so every existing profile keeps its state and reads the new
  field back as 0.

### As built (`FEAT-SECRET-LORE`, 885d3bb, 2026-07-31)

- **Hint tier 2 shipped as a lead chain, not a scavenger list.** Every find (cache or hidden
  sector) names ONE further unfound secret, so the hunt is a chain rather than a checklist.
  The pointer is `SecretFlags.HINTED`, which this section's persistence bullet already
  specified and which had no writer until now: `revealOnSecretHinted` sets it without FOUND,
  which is why `repairSecret`'s FOUND-implies-HINTED rule needed no change.
- **The riddle is generated, the prose is authored, and the two cannot contradict.**
  `LORE_FRAGMENTS` (`src/data/LoreFragments.ts`) carries flavour that names no place; the
  location clause is read off the sector by `describeSecretLocation` (shape from the non-Wall
  edge count, bearing from the hangar, graph depth, biome name). That discharges this doc's
  "names a location tag that exists in the profile's generated world (integrity assert)"
  without a tag vocabulary, which doc 02 does not export.
- **Section 8's `Secrets.ts` row shipped as `LoreFragments.ts`.** The other
  `SecretDefinition` fields already have owners: placement is the generator's, reward class is
  `secretRewards.ts`'s, and found-state is the discovery store's, so what was left is the
  fragments and the file is named for them.
- **A lead never names a secret in an unvisited hidden sector**, which keeps
  `FEAT-SECRET-HIDDEN-SECTORS`' payoff intact. `CHORE-DISCOVERY-HIDDEN-SCAN-GUARD` asks the
  future scan pulse for the same guard; `chooseHintTarget` is the reference implementation.
- **Two surfaces read it, both already existing.** The map screen stacks a LEADS panel under
  the OBJECTIVES panel `FEAT-QUEST-VIEW` shipped, nearest lead first, and `SectorMapRenderer`
  badges a hinted sector in the breakable amber. An undiscovered sector still draws nothing,
  so a lead stays a riddle until the region is charted.
- **No new state anywhere.** No storage key, no `ALL_STORAGE_KEYS` entry, no save field, and no
  `SAVE_VERSION` / `WORLDGEN_VERSION` / `DISCOVERY_VERSION` / `ACHIEVEMENT_VERSION` bump. The
  completion percent is untouched: `getFoundSecretCount` counts FOUND only.
- **Not built, deliberately.** Hint tier 3 (the decryptor ping) needs the ability's active and
  is `FEAT-SECRET-DECRYPTOR-PING`; the profile-wide fragment collection and
  `LifetimeStats.loreFragmentsFound` are `FEAT-SECRET-LORE-CODEX`, because a lifetime integer
  with no reader is a second source of truth waiting to disagree.

### As built (`FEAT-SECRET-SEQUENCE-PUZZLES`, 0da9243, 2026-07-31)

- **Taxonomy row 3 shipped as a ring around an existing cache slot**, not as a standalone
  puzzle object. About 30% of cache slots seal behind 3 sigil pylons (4 past depth 5), so
  found-state is `markSecretFound` on the slot id the cache already occupies: no `SecretLedger`,
  no `survivor-secrets-found` key, no save field and no version bump were needed, and the
  completion percent, the lead chain, the `findSecret` quest trigger and
  `LifetimeStats.secretsFoundTotal` all keep working untouched. **The row's `GameScene.ts:4017`
  shrine-pattern pointer is stale**: the walk-in shape it names now lives in `claimSecretCache` /
  `updateSecretCaches`, and the puzzle reuses those rather than the shrine spawner.
- **The hint half is the tier-2 lead, not a second grammar.** `SecretLead.sigils` carries
  `describePuzzleSequence`, so the fragment that names the place also names the order ("Sigils
  wake in order: hexagon, then triangle, then diamond"). The order is read off the ring itself,
  so it cannot name a sigil the room lacks: the same integrity rule `describeSecretLocation`
  follows, asserted over 5 generated worlds in `secretPuzzles.test.ts`. A lead is never a lock,
  though: 3 or 4 pylons stay brute-forceable, so it saves the trial rather than holding the key.
- **The hidden-sector-edge half is filed, not built** (`FEAT-SECRET-PUZZLE-DOOR`). A sector edge
  is not in `universe.secretIds`, so solving one has no found-state to write, and a hidden
  sector's breakable wall is already its gate: a second gate needs a generator change and the
  `WORLDGEN_VERSION` bump `FEAT-SECRET-HIDDEN-SECTORS` deliberately avoided.
- **The new `puzzle` reward tier** leans the `hiddenSector` way without matching it: half that
  tier's lean on the twin-chest jackpot (2x rather than 3x) and the same push off the repair
  bay. An earned find should not pay the table a walked-over find pays, but it is not a whole
  room the chart never drew either. Econ rule 1 is untouched: no entry pays gold, so the tier
  only re-weights the existing table.

### As built (`FEAT-SECRET-LORE-CODEX`, 173c7f3, 2026-07-31)

- **The collection half of the taxonomy's lore row landed as a Codex tab.** That row names
  "codex/vault UI shell" as the thing lore fragments reuse, and this chunk reused it literally: a
  `CODEX_CATEGORIES` row, `CodexState.lore`, `displayLore` / `createLoreCard` in the shipped tab
  machinery. The "secrets get no vault tab of their own" rule in the persistence section is about
  not building a parallel unlock/toast system, and this chunk built neither: the two new unlocks
  (`unlock_lore_keeper` at 5 fragments, `unlock_lore_complete` at all 13) go through
  `HiddenUnlocks` with `getProgress` like every other cosmetic, and no new toast fires, because
  the lead toast already carries the fragment's title and text on that exact frame.
- **`LifetimeStats.loreFragmentsFound` is now built**, closing the field this section has listed
  as wanted since `FEAT-SECRET-CACHE`. It is assigned from the codex's discovered count rather
  than incremented, and monotonically, so the codex stays the one source of truth and a debug
  codex reset cannot walk the lifetime stat backwards.
- **`SecretLedger` and `survivor-secrets-found` stay unbuilt.** The "logical completion" this
  section reserves them for is exactly what shipped, and it shipped inside the existing
  `survivor-codex` key rather than as a second store, for the reason `FEAT-SECRET-CACHE` already
  recorded. No `CODEX_VERSION` or `ACHIEVEMENT_VERSION` bump was needed: both loaders rebuild
  missing sub-trees and fields from their known id lists.
- **The fixed world seed is a design constraint on this section, not a detail.** Measured
  2026-07-31: the live expedition world (`EXPEDITION_WORLD_SEED = 20260727`) holds 26
  `PoiKind.Secret` slots across its 48 sectors, and every profile flies that one seed. An
  independent per-secret hash therefore cannot fill a fragment catalog at all (26 independent
  draws over 13 rows land on about 11 distinct, and the gap widens as the catalog grows), which
  makes the collection uncompletable rather than merely uneven. `loreFragmentFor` now deals
  `(hash(seed) + rank) % length` by the secret's rank in the world's sorted secret ids, so each
  of the 13 fragments gets exactly two ranks on the live world and clearing it completes the
  codex. That rank deal is what makes a fragment collection completable at all, and it is also
  what caps the catalog at 13 until a world can be re-rolled
  (`FEAT-SECRET-LORE-CATALOG-DEPTH`).

### As built (`FEAT-POWER-DECRYPTOR-SCAN`, e36b7f6, 2026-07-31)

- **Hint tier 3 shipped.** The `FEAT-SECRET-HIDDEN-SECTORS` note above lists it as "not built,
  deliberately", waiting on the ability's active as `FEAT-SECRET-DECRYPTOR-PING`. That is now
  discharged: owning `ability_signal_decryptor` sweeps the sector graph on every sector entry,
  charting sectors two to four edge-hops out as outlines with their connecting edges, and
  pointing at any unfound cache in the room just entered.
- **It fires on sector entry, not on a button, and that is a decision rather than a shortcut.**
  Every existing action (dash, ultimate, map) is wired through three input paths:
  `InputController` keyboard, `InputController` gamepad, and a `HUDManager` touch button with a
  joystick exclusion check. A keyboard-only active would hand the ability to one third of the
  players; all three plus a cooldown readout is a HUD-layout change larger than the feature
  itself. Sector entry is the trigger every other discovery write already uses and the pure rule
  is idempotent, so a re-entry that reveals nothing costs nothing. The pressable version is
  filed as `POLISH-DECRYPTOR-ACTIVE-BUTTON`.
- **The radar blip is the "marks position in-sector" half tier 1 reserved for tier 3.** The
  `FEAT-SECRET-AMBIENT-PING` note above says the shimmer "says a cache is in this room and never
  where"; with the decryptor owned, `updateMinimap` writes a `'secret'` blip at each unfound
  cache's real position, in the breakable amber the shimmer already uses. The shimmer is
  untouched and still works for a profile without the ability: proximity intensity and position
  are different information and both are wanted.
- **`luckLevel` is the synergy hook** the taxonomy row promised ("ping range scales"): two hops
  base, one extra per two purchased levels, capped at four, so that upgrade's maxLevel of 5 tops
  the sweep out. The numbers are a designed guess, not a measurement against the live 48-sector
  graph, which is `BALANCE-DECRYPTOR-SCAN-RADIUS`.
- **`ability_signal_decryptor` joined `IMPLEMENTED_TRAVERSAL_ABILITY_IDS` as the third entry**,
  so its claim toast now prints its real description instead of the generic line. Both clauses of
  that description are true: the door half already worked, because `tryOpenAbilityDoor` is
  generic over `door.requiredId` and opens any `EdgeKind.AbilityDoor` gated on an owned id.
- **The scan grants each newly hinted secret's lore fragment, and that is an invariant, not a
  bonus.** `MapScene.renderLeadsPanel` prints `lead.fragment.title` and `lead.fragment.text` for
  every HINTED-and-not-FOUND secret, so a scan that hinted without granting would spoil a
  fragment's full text in the LEADS panel while the Codex LORE tab still showed it as `???`. The
  sweep therefore calls `discoverLoreFragment` and refreshes `setLoreFragmentsFound` exactly as
  `grantSecretLead` does. The toast deliberately does not claim a fragment was logged, since an
  already-recovered fragment would make that false.

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

*(As built, `FEAT-POWER-TRAVERSAL`, on the `src/data/TraversalAbilities.ts` row: the
shipped exports are `TRAVERSAL_ABILITIES`, the derived `TRAVERSAL_ABILITY_GATE_ORDER`
(which is doc 02's `WorldGenInputs.abilityGateOrder`), `getTraversalAbility` and
`traversalAbilityIndex`, plus the `TraversalAbilityId` and `BarrierTypeId` unions and the
`TraversalAbilityDefinition` interface. The row's "ordered by index" is array position and
nothing else: there is no `vaultIndex` field, because a stored index that can disagree
with the array would be a second source of truth, so `traversalAbilityIndex()` is the
accessor. `BarrierTypeId` is declared in this file rather than imported from doc 02: doc
02 shipped gating as `EdgeKind.AbilityDoor` plus `EdgeDef.requiredId` and exports no
`barrier_*` taxonomy, so the union has to live somewhere for `barrierTypeId` to be a
checked reference instead of a magic string. `FEAT-BARRIER-GATES` may relocate it.)*

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

*(As built, `8161ba7`: shipped as specified, with two shape deviations. Ownership
persists as a **JSON array of ability ids** rather than a positional bitmask, because
README section 3.6 expects a `WORLDGEN_VERSION` bump to remap profile flags by id and a
mask would silently reassign a player's abilities the first time the catalog is
reordered. And the manager is **module-level functions, not a class singleton**, despite
the `...Manager.ts` filename above: `PracticeBestTimes` and `ShipRecords` are the idiom
for id-keyed profile state of this size, and a class would add construction-order
coupling to `initializeStorage()` for six booleans. Having no module state also means
there is no `reset*` function for `GameScene` `create()` to forget. The read path is
read-through with sanitize-on-read, so a tampered payload degrades to owning nothing, and
writes ride `SecureStorage`'s practice-session block deliberately: a sandbox run must
never bank a real ability.)*

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
