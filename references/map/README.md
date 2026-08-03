# The Expedition Map: architecture index and build roadmap

Scoped 2026-07-27. This directory is the design authority for turning the survivors
arena into an explorable Metroid-style world: the ship flies across a map of sectors
with barriers, quests, temporary and permanent power-ups, secrets, a discovery map and
live minimap updates.

Four architecture documents, one per subsystem, plus this index which owns the parts
no single document can own: the canonical cross-document contracts, the build order,
and the long-term plan.

| Doc | Owns | Chunks |
| --- | --- | --- |
| [`01-world-space.md`](01-world-space.md) | Coordinate model, camera, mode seam, save v2 | 7 |
| [`02-worldgen-barriers.md`](02-worldgen-barriers.md) | World generation, barriers, collision, enemy navigation, streaming | 8 |
| [`03-discovery-map-ui.md`](03-discovery-map-ui.md) | Discovery state, minimap underlay, map screen | 8 |
| [`04-content-quests-powerups-secrets.md`](04-content-quests-powerups-secrets.md) | POIs, traversal abilities, quests, secrets, economy | 9 |

Total: 34 individually-shippable work orders (32 from the four docs, plus
`FEAT-EXPEDITION-RECALL` and `FEAT-EXPEDITION-PROMOTE`, which exist because of the
operator decisions in section 4 and belong to no single doc). Every one leaves the game
playable and the suite green. The work orders are filed in `BACKLOG.md` under
**EPIC-EXPEDITION**; this file holds the reasoning, the doc pointers and the order.

---

## 1. The spine (decided, not up for re-litigation)

1. **A sector is one current arena viewport** (1280x720 world units). Today's spawn
   pacing, boss choreography and hazard geometry are tuned for exactly that rectangle,
   so a sector-sized room recovers all of it for free. Sectors are a logical partition
   of one continuous world plane, not a camera cage: the camera free-scrolls and only
   locks to a sector for boss rooms.
2. **The world layout is persistent per profile and deterministically seeded.**
   Contents (enemies, loot rolls, hazards) re-roll per run; layout, discovery and
   secrets do not. This is the difference between Metroid and roguelike amnesia, and
   it is what makes a permanent traversal ability feel like it opened *your* map.
3. **Expedition becomes the default run mode** (operator decision, 2026-07-27), but it
   is *built* additively: the existing single-arena run stays byte-identical while all
   32 chunks land, and the promotion is its own final work order
   (`FEAT-EXPEDITION-PROMOTE`). This is what lets the epic land one chunk at a time
   without ever shipping a broken game, and it is why the mode seam is one object
   (`WorldModeAdapter`) rather than a fork of `GameScene`. Arena mode is not deleted by
   the promotion: it stays as the skirmish entry and remains the substrate for the daily
   challenge, practice and the boss-rotation modes that are tuned for a fixed room.
4. **Pure first.** Generation, collision, projection, discovery rules and quest state
   are Phaser-free modules under `src/world/` and `src/expedition/`, unit-tested with
   Vitest. Phaser-coupled wiring is verified by play, not by tests, matching this
   repo's existing split.
5. **Nothing is generated that cannot be solved.** Gate placement is constructive
   (lock-and-key on a grown spanning tree), so solvability is an invariant of the
   algorithm rather than something a validator hopes for.

## 2. Why this shape and not the obvious alternatives

- **Not a tilemap-per-level.** The game has no tilemap and no static collision at all
  today. A 40px tile bitmask per sector (`Uint8Array(576)`) serves generation,
  collision and navigation from one structure, and 48 sectors of it is roughly 27KB
  resident, so geometry never needs streaming.
- **Not a fresh world per run.** A re-rolled world makes permanent traversal abilities
  meaningless: you cannot remember a door you can now open if the door moved.
- **Not a replacement for the arena.** The arena mode is the shipped, tuned game.
  Replacing it in one move would put every existing system (29 weapons, 14 enemy
  barrage patterns, boss arenas, 13 save/restore test suites) at risk simultaneously.

## 3. Canonical contracts (this section wins over any single doc)

The four documents were written in parallel and each proposed its own names for the
shared vocabulary. These are the canonical forms. A fleet agent implementing any chunk
follows this section when its doc disagrees.

### 3.1 Identity

- **Sector identity is `sectorKey`**, type `SectorKey = string`, format `"${sx},${sy}"`,
  produced only by `sectorKey()` in `src/world/worldSpace.ts`. Treat it as opaque.
  Doc 03's `sectorId` is the same value under an older name.
- **Edge identity is `edge:${sx},${sy}:${direction}`**, where the lexicographically
  smaller sector names the edge (doc 02's form).
- **`sectorTag` and `routeTag` (doc 04) are semantic labels, never identity.** They are
  stable vocabulary for quest and riddle referential integrity ("the frozen approach"),
  and they must not be used to look a sector up.
- POI, secret, quest, ability and barrier ids are plain string ids in their data files,
  following the existing `src/data/` convention.

### 3.2 Events (emitted on the GameScene emitter, colon-namespaced)

```
'expedition:sector-entered'   { sectorKey, coord, viaEdgeId: string | null }
'expedition:edge-traversed'   { edgeId }
'expedition:gate-opened'      { edgeId, barrierTypeId }
'expedition:ability-earned'   { powerUpId, displayName, iconKey, unlocksGateTypes }
```

`expedition:sector-entered` fires exactly once per boundary crossing, including the
start sector on run start and on restore. No consumer does position-to-sector math
itself.

### 3.3 Module homes and import direction

- `src/world/` : pure world math, generation, collision, barrier state, POI rolling.
  **Never imports Phaser, and never imports from `src/systems/` or `src/game/`.**
  Doc 04's `src/systems/expedition/PoiRoll.ts` moves here as `src/world/poiRoll.ts`,
  because the generator consumes it and `src/world/` must not depend on `src/systems/`.
- `src/expedition/` : pure run and profile state (discovery rules, discovery manager).
- `src/game/world/` : Phaser-coupled mode adapters (`WorldModeAdapter`,
  `ArenaModeAdapter`, `ExpeditionModeAdapter`).
- `src/visual/mapProjection.ts` : new sibling of `minimapProjection.ts`, which stays
  untouched with its 16 tests green.

### 3.4 The two rectangles

- `viewRect` : what the camera shows. Drives spawning and culling.
- `fieldRect` : what the player and enemy AI are bounded by. In arena mode both are the
  screen rect. In expedition mode `fieldRect` is the current sector (or the locked
  sector during a boss fight) and `setEnemyAIBounds` keeps receiving sector-local
  bounds. (As built from `FEAT-WORLD-SPACE-4`: while exploring, `fieldRect` is the world
  bounds rect, and it narrows to a single sector only under a sector lock
  (`FEAT-WORLD-SPACE-6`). Clamping the player to the current sector while exploring would
  contradict spine decision 1 and make a sector transition a cut rather than a scroll.)

### 3.5 Save ownership

**`FEAT-WORLD-SPACE-7` is the single owner of `SAVE_VERSION` 2, the `expedition`
block and the first real body of `migrateState()`** (`GameStateManager.ts:898`).
Every other chunk that needs run state adds an *optional namespaced sub-block* inside
`expedition` and bumps nothing. If `FEAT-BARRIER-GATES` lands before W7, it implements
the schema exactly as specified in doc 01 section 8.1 rather than inventing one.

Persisted keys (all must be added to `src/storage/StorageBootstrap.ts:24`
`ALL_STORAGE_KEYS`, which a test enforces):

```
survivor-world-profile           broken walls, opened gates (doc 02)
survivor-expedition-discovery    fog and discovery flags (doc 03)
survivor-traversal-abilities     permanent abilities owned (doc 04)
survivor-expedition-quests       quest chain progress (doc 04)
survivor-secrets-found           logical secret ledger (doc 04)
```

### 3.6 Ability gating

Doc 04 owns `TRAVERSAL_ABILITIES` and its **order**. Doc 02 consumes that order as a
stable generation input and places vault *i* reachable using only abilities before it.
Changing the order (or any generation input) bumps `WORLDGEN_VERSION`, which
regenerates worlds and best-effort remaps profile flags by id. Ability-granting
power-ups may be placed only in generator-provided `AbilityPowerUp` slots: solvability
depends on it.

### 3.7 Two write paths that must not become two sources of truth

- **Secrets**: `DiscoveryManager.markSecretFound(secretId)` (doc 03) is the only write
  path for the spatial found-flag. `SecretLedger` (doc 04) owns the logical
  consequences (counts, `HiddenUnlocks` conditions) and calls into the manager rather
  than keeping a parallel flag.
- **Entity cleanup behind the player**: doc 01's leash (`FEAT-WORLD-SPACE-5`) and doc
  02's despawn-to-pool on seam crossing (`FEAT-WORLDGEN-STREAM`) both prevent pileup.
  Canonical split: the **seam crossing** is authoritative and handles sector exit; the
  **leash** only handles within-sector drift when no seam was crossed. `STREAM` must
  disable the leash for entities it has already reclaimed, so a single enemy is never
  processed by both.

## 4. Decisions taken and questions still open

### 4.1 Recall to Hangar is a mid-run teleport (operator decision, 2026-07-27)

Recall does **not** end the expedition. It teleports the ship to the hangar sector and
the run continues, so a player can push out, bank nothing, come home, refit and push out
again inside one life. Three consequences the implementing chunks must honor:

- **A recall is a non-adjacent sector jump.** `FEAT-WORLDGEN-STREAM` was specced around
  adjacent seam crossings; it must also handle "deactivate sector A, activate sector Z"
  with no shared edge, or a recall leaks the departed sector's entities.
  `expedition:sector-entered` fires on arrival with `viaEdgeId: null`.
- **Recall is blocked during a sector lock.** `FEAT-WORLD-SPACE-6` seals the camera and
  field rect to a boss room; teleporting out of a sealed fight would strand the lock and
  leave the boss alive in an inactive sector. Blocked, not merely discouraged: this is a
  correctness constraint, not a balance taste.
- **It needs a friction knob, and the knob is not "free".** Doc 04 originally assumed a
  zero-cost recall, which was safe only because it also assumed the run ended. A free,
  instant, mid-run teleport is a get-out-of-jail button that deletes the danger of
  travelling home wounded. The recommended default is a short channel that breaks on
  damage, so recall is a decision made in a lull rather than a panic button. The exact
  friction (channel time, cooldown, gold cost, or none) is a tuning value owned by
  `FEAT-EXPEDITION-RECALL` and validated by a human in a browser.
  **Shipped at `183b2dc`** as `TUNING.player.recallChannelSeconds = 3`, a channel
  broken by any hit that actually lands and by a boss seal closing; the browser verdict is
  `POLISH-EXPEDITION-RECALL`. The first bullet's streaming obligation was found to be moot:
  this repo bounds its live set with the leash, not with sector activation, so a recall has
  no sector to deactivate.
  **The return leg shipped at `0748a6e`** as `FEAT-EXPEDITION-SORTIE`: at the hangar with a recall
  behind it, the same footer button, `R` and gamepad `X` read `SORTIE` and fly the ship back to
  the point the recall departed from, through the same channel with the same break rules. One
  return per recall, spent on arrival and persisted across a refresh. The sentence's remaining
  word is `refit`, filed as `FEAT-EXPEDITION-HANGAR-REFIT` and parked on the `FEAT-ECON-WARDS`
  balance call.
  **The leg carried across deaths at `049b50f`** as `FEAT-EXPEDITION-FIELD-ANCHOR`: the world
  profile remembers the last room a ship stood in (`fieldAnchorSectorKey`, never the hangar and
  never the boss arena), and a FRESH expedition seeds its single SORTIE from it, so the return
  leg is now "back to where the last run ended" as well as "back to where this run recalled
  from". Same channel, same break rules, same one-use consumption, and no `MapScene` change: the
  footer already reads SORTIE when the ship stands at the hangar with an anchor available. The
  playtest half is `POLISH-SORTIE-CARRYOVER`.
  **The destination became a choice at `2ff8352`** as `FEAT-SORTIE-CHOOSE-DESTINATION`: standing
  at the hangar with a sortie in hand, the footer button reads `SORTIE 3,2` for whichever room the
  chart is focused on, and the jump lands there instead of at the anchor. The anchor stays the
  PERMIT: `beginExpeditionJump` refuses a sortie on a null anchor before it reads any destination,
  so one recall still buys exactly one return and the channel, the break rules and the boss-lock
  refusal are untouched. A room is offered only when `plotSectorCourse` returns `plotted`, which is
  what keeps the ability-gate ordering intact, and the check runs in BOTH `MapScene` (so the button
  is honest) and `GameScene` (so the public method is safe without trusting its caller): do not
  collapse them. The boss arena is refused for the same reason the field anchor refuses to record
  it. The browse-mode half is `FEAT-SORTIE-BROWSE-DESTINATION` and the playtest verdict is
  `POLISH-SORTIE-CHOOSE-DESTINATION`.
  **The choice moved to the menu at `5a45877`** as `FEAT-SORTIE-BROWSE-DESTINATION`: the
  between-runs survey (`MapScene` with `returnTo: 'BootScene'`) aims the fresh run's seeded
  sortie, its footer button reading `LAUNCH · 3,2` for whichever room the chart is focused on.
  The pick rides to the run as a world-stamped `PlannedSortie` in `src/expedition/pendingLaunch.ts`
  beside the launch flag itself, and `GameScene.bindExpeditionDiscovery` drains it on EVERY
  expedition bind while using it only on a fresh one, so a cancelled save-loss confirmation
  cannot leave a pick armed for a later run. The field anchor is still the PERMIT: no anchor, no
  sortie, whatever was planned. `GameScene` re-plots the course from `map.startKey` rather than
  from the player, because a fresh expedition starts at the hangar and that is the position the
  survey measured its own course from, so the honest-button check and the safe-seeding check
  judge the identical trip. It redirects the jump and does not auto-spend it
  (`FEAT-SORTIE-AUTO-JUMP`); the playtest verdict is `POLISH-SORTIE-BROWSE-DESTINATION`.

The stranding guarantee doc 04 relies on is unchanged: recall is always *available*
outside a lock, so physical stranding is impossible and a soft-lock reduces to a
progression block, which the vault ordering rule prevents.

### 4.3 The chart plots a course, and only through what it draws (2026-08-03)

**Shipped as `FEAT-MAPUI-COURSE-PLOT` (`3b9d049`).** Focusing a room on the chart plots the route
the ship can fly to it: `src/expedition/sectorRoute.ts` walks the sector graph breadth-first and
`MapScene` draws it plus a hop count. Three decisions the next chunk must not re-derive:

- **The graph is the CHART, not the world.** A sector is a node only when its discovery flags are
  non-zero and an edge is crossable only when it carries `EdgeFlags.KNOWN`, which are exactly the
  two rules `SectorMapRenderer` and `sectorDetail` already obey. A course therefore cannot cross a
  border the chart refuses to draw, and section 3's leak rules hold with no extra guard.
- **"Blocked by what" is a second relaxed pass, and one-ways stay hard in it.** When no passable
  route exists the walk runs again with `AbilityDoor` and `KeyDoor` treated as open, and the shut
  doors along that route are named. `EdgeKind.OneWay` is NOT relaxed: a membrane is not something
  a profile can go and earn, so relaxing it would report a course blocked by nothing.
- **Passability is the held-id predicates, never the tile state.** `applyOwnedAbilityGates` and
  `applyEarnedQuestKeys` rewrite only `TileKind.GateClosed` mouth tiles and never `edge.kind`
  (section 3.5's replay rule), so `edge.kind` plus `edge.requiredId` plus the two ownership
  predicates is the one test the lock ring, the readout's door line and the course all share.
- **The panel measures with the same plotter (`FEAT-LOCKOUT-COURSE`, `fd55c37`).** The LOCKED OUT
  panel's `vault` / `questBoard` / `wardenArena` sources carry a `LockoutTravel` projected from
  `plotSectorCourse`, not a Chebyshev distance, so the panel's trip, the chart's plotted line and
  the readout's door line are one answer. It is also what picks WHICH vault and WHICH board a row
  names: flyable over gated over unroutable, then fewer hops. `LockoutRow.nearestDistance` stays
  Chebyshev on purpose: it is a sort tiebreak, never rendered.

- **The chart is reachable outside a run (`FEAT-MAPUI-MENU-SURVEY`, `4d4d618`).** `MapSceneData.returnTo`
  is now read: `'BootScene'` is the between-runs survey opened from the GAME MODES submenu, where
  there is no run to pause, no recall to fire and no ship flying. Browse substitutes the hangar
  (`map.startKey`) for the ship position, so every hop count and every plotted course measures the
  trip the next run actually makes; it passes the run-scoped inputs (nests, lairs, spent hives,
  this expedition's blooms and shifts) empty because they exist only once a run has stocked them,
  and passes the warden whenever the world is unconquered because it does not. It adds no glyph, no
  legend row and no panel: it is the same screen, opened earlier.
- **And the survey launches what it planned (`FEAT-SURVEY-LAUNCH-FROM-CHART`, `e53a7e0`).**
  Browse mode's footer carries a `LAUNCH` button, on `L` and gamepad `X`, in the slot `RECALL`
  holds during a run. It starts nothing itself: it sets the one-shot
  `src/expedition/pendingLaunch.ts` flag and closes, and `BootScene` consumes it at the end of
  `create()` and calls the same `startGameWithConfirmation` the hero card calls, so there is one
  launch flow and one save-loss confirmation, not two. The flag is module-level rather than a
  `BootLaunchData` field because Phaser retains a scene's last `settings.data` and
  `flyExpeditionWorld` ends in `scene.restart()`, so a retained field would auto-start a run on a
  later world change. The browser verdict is `POLISH-MAP-SURVEY` question (g).
- **And the tile says what is left to survey (`FEAT-SURVEY-TILE-BADGE`, `0742427`).** The
  SURVEY tile wears the live world's charted percent. It is read, never computed: the deck is built
  in `BootScene.create()` and `summariseCurrentExpedition` is one 33 ms `generateWorld`, so
  `ExpeditionSeasonState.liveProgress` caches the number, stamped with `(seed, worldGenVersion)`.
  Two producers write it and no others may: `bindCurrentExpeditionWorld` (which every between-runs
  path reaches a bound world through) and `GameScene.buildExpeditionDebrief` at run end. Any stamp
  mismatch reads as no snapshot and the badge is simply absent, which is why a traded or
  returned-to world shows nothing until its first run end rather than showing the last world's
  percent.
- **And the panel names the fight, not just the flight (`CHORE-LOCKOUT-VAULT-GUARD-TELL`,
  `13d9466`).** A LOCKED OUT row's vault clause reads `GUARDED VAULT 3 HOPS` or
  `UNSEALED VAULT 3 HOPS`, and a guarded vault sinks below a fightless source at an equal opening
  count. The settled fact behind both, which is easy to get backwards: `PoiFlags.GUARD_CLEARED`
  is written by `AbilityVaultManager.unsealVault` when the last guard dies, NOT at the claim,
  which is a separate `PoiFlags.COLLECTED` write. An unclaimed vault whose guard is cleared is
  therefore a real state (the player won the fight and died before touching the core), which is
  what makes the word worth printing at all.

The in-run half (a next-hop bearing on the radar disc) is deliberately not built and is
`FEAT-COURSE-RADAR-BEARING`, held on `BALANCE-MARK-RADAR-RANK`. The browser verdicts are
`POLISH-MAP-COURSE` for the chart and `POLISH-LOCKOUT-COURSE` for the panel.

### 4.4 The cell's corner budget is settled, and the fourth corner is the destination lane (2026-08-03)

**Shipped as `FEAT-SORTIE-CHART-TELL` + `FEAT-SORTIE-PLAN-DEFAULT-TELL` (`2e7488c`), then extended by `FEAT-STIR-CHART-CELL` (`7f39fb1`).** Six filed
items were queued behind one decision nobody had made: where a new per-sector mark goes and what
it costs. It is made here so no later chunk re-derives it.

- **The four corners have owners, and `SectorMapRenderer` is where they are enforced.** Top-left
  is the lead badge, top-right the `CLEARED_ONCE` notch, the top EDGE is the objective pin with
  its `UPDATED` badge on the pin's own shoulder, and bottom-left is the player's sector mark with
  the note dot on its upper right. **Bottom-right was the last free corner and is now the
  destination lane.** The cell interior is not available: POI glyphs sit at their real tile
  positions and can land anywhere inside it.
- **The lane holds at most ONE badge per cell**, and its occupants are ordered: the sortie landing
  room first (an action one press away), then a room this expedition's ambient stir changed, then a
  room holding an unopened security-grid band (`FEAT-GRID-BAND-CHART-CELL`), then a found region
  vault (`FEAT-VAULT-CHART-TELL`). Actionable beats informational, and a fact the focused-sector
  readout already carries loses to one it does not. **Occupants 1 and 2 are built**
  (`FEAT-STIR-CHART-CELL`, `7f39fb1`), so the next lane item is occupant 3. The stir badge is a
  doubled ripple in the hazard orange the ground it names is painted in, and it is the occupant
  that carries a gate the sortie badge does not: it draws only on a `VISITED` cell, because a
  stir is an interior fact and `sectorDetail`'s own bloom and shift rows take the same gate for the
  same reason. One badge covers both a bloom and a shift: the lane allows one mark per cell, so a
  room that took both is not two.
- **The real budget is the legend, not the cell.** Each occupant costs one legend row, and the
  panel is already 23 rows / 504 px against roughly 460 px between its clamp and the detail bar on
  a 720-high canvas: the sortie row is the last one that fits. **That budget was spent and then
  reopened: `FEAT-MAPUI-LEGEND-TOGGLE` (`2c776d9`) made the panel reflow into columns and fold
  away, so section 4.5 now owns the row budget and the lane's queued occupants are unblocked.**
- **`FEAT-COURSE-STICKY` is not a lane occupant.** A pinned course is a line between cells plus a
  store field, not a corner badge, so this section does not gate it: its only dep is the
  `markedSectorIds`-shaped write it needs.
- **The badge draws inside the per-sector loop, never after it.** That is what makes it inherit
  the three rules the loop already enforces: an uncharted cell draws nothing (so an anchor cannot
  leak a position), an off-screen cell is culled, and a cell still fading in under the map-open
  cascade draws only its outline.

### 4.5 The legend's row budget is settled: it reflows into columns and folds away (2026-08-03)

**Shipped as `FEAT-MAPUI-LEGEND-TOGGLE` (`2c776d9`).** Section 4.4 named this panel as the real
budget behind the cell's destination lane, so the budget is settled here.

- **The panel is top-anchored at `HEADER_HEIGHT + 12`, not bottom-anchored to the detail bar.**
  That is what lets the header strip hold still when the rows vanish. At 16:9 the old clamp
  already resolved to the same y, so nothing moved there; on a tall canvas the panel now sits
  under the header instead of above the readout.
- **Rows reflow into 196 px columns; they are never dropped.** The legend is generated from the
  glyph tables precisely so it cannot drift from the renderer, so a row that does not fit takes a
  new column: `rowsPerColumn` from the band, `columns = ceil(rows / rowsPerColumn)` clamped to
  `floor((width - 48) / 196)`, then `perColumn = ceil(rows / columns)` so the columns are
  balanced rather than one full and one stub.
- **This is what unblocks the destination lane.** Before it the panel was 24 rows / 524 px inside
  a 460 px band and was painting its last three rows over the detail bar. At 720p it is now two
  columns, 392 px wide and 284 px tall, with room for 16 further rows before a third column, and
  a 1280-wide canvas admits six columns. A lane occupant's legend row is no longer scarce, so
  `FEAT-STIR-CHART-CELL`, `FEAT-GRID-BAND-CHART-CELL` and `FEAT-VAULT-CHART-TELL` are unblocked.
- **Three input paths, and the third one is the panel itself.** `TAB` (captured, and listed in
  `MAP_KEY_CAPTURES` so the note overlay's clear/re-arm cycle keeps it), gamepad `SELECT`, and a
  click or tap anywhere on the header strip. **Not gamepad `X`**, which doc 03 section 4.3
  specifies but which shipped as RECALL/LAUNCH long before this chunk.
- **The legend rectangle swallows sector focus, hover included.** `focusFromPointer` runs on
  pointer move as well as down, so without the guard the toggle would double as a cursor move to
  whichever cell hides under the panel.
- **The fold persists** in `settings-map-legend-collapsed` (`SettingsManager`), default expanded
  so a new player meets the vocabulary. It gets no SettingsScene row: the control lives on the
  thing it controls.

### 4.2 Still open, for playtest (not blockers)

- **OQ-1 seam pop.** The camera free-scrolls and can show parts of two sectors, but
  entities are live in one sector only. A player looking across a seam may see enemies
  appear at the boundary. Mitigations, in order of preference if it reads badly:
  activate the neighbor sector's entities on approach, tighten the camera deadzone near
  seams, or make seams visually opaque (doorways, not open field). Decide from play,
  not from theory. **The flip has run (02c4b74), so this check now lives in
  POLISH-EXPEDITION-DEFAULT (backlog playtest queue) with revert as the escape hatch.**
  Note the current build bounds the live set with the leash, not per-sector streaming,
  so the classic "entities appear at the seam" shape may present as leash pop instead.
- **OQ-3 map pause.** Doc 03 pauses gameplay while the map screen is open. Correct for
  a survivors game, but worth confirming it does not become a stall tactic once quests
  send players across the map, and worth re-checking once recall lives on that screen.

## 5. Build order

Phases are dependency bands, not schedules. Within a phase, chunks are parallel-safe
unless a dependency is named.

**Phase 0: pure foundations (zero risk to the live game).** Nothing here is imported
by game code yet. All of it is tests plus the pure modules they pin.
`FEAT-WORLD-SPACE-1`, `FEAT-WORLDGEN-CORE`, `FEAT-BARRIER-COLLIDE`,
`FEAT-MAPUI-PROJECTION-02`, `FEAT-DISCOVERY-STATE-01`, `FEAT-POI-CATALOG`,
`FEAT-POWER-TRAVERSAL`, `FEAT-POWER-FIELDBOOSTS`.

**Phase 1: arena-identical plumbing.** The screen-equals-world assumption is removed
while the game provably plays exactly as before.
`FEAT-WORLD-SPACE-2`, `FEAT-WORLD-SPACE-3`.

**Phase 2: the first flyable world (dev route).** A camera that follows, a world that
scrolls, spawns that stream from the view edges.
`FEAT-WORLD-SPACE-4`, `FEAT-WORLD-SPACE-5`.

**Phase 3: walls matter.** The ship gets blocked for the first time in this game's
history, and everything that shoots or chases learns about cover.
`FEAT-BARRIER-PLAYER`, `FEAT-BARRIER-PROJECTILE`, `FEAT-WORLDGEN-NAV`,
`FEAT-WORLD-SPACE-6`, `FEAT-WORLD-SPACE-7`.

**Phase 4: the map fills in.** Discovery is written, then shown.
`FEAT-DISCOVERY-HOOKS-03`, `FEAT-BARRIER-GATES`, `FEAT-WORLDGEN-SPAWN`,
`FEAT-WORLDGEN-STREAM`, `FEAT-MAPUI-MAPSCENE-04`, `FEAT-MAPUI-DOORS-05`,
`FEAT-MAPUI-RADAR-UNDERLAY-06`, `FEAT-EXPEDITION-RECALL`.

**Phase 5: the Metroid loop closes.** Abilities are earned in the world and visibly
open doors that were closed.
`FEAT-POWER-VAULTS`, `FEAT-DISCOVERY-FEEDBACK-07`.

**Phase 6: content and guard rails.** The world gets things to do and a balance
harness that stops later authoring from drifting it.
`FEAT-QUEST-CHAINS`, `FEAT-QUEST-BOARD`, `FEAT-SECRET-CACHE`, `FEAT-SECRET-LORE`,
`FEAT-ECON-WARDS`, `FEAT-MAPUI-TOUCH-A11Y-08`.

**Phase 7: promotion.** Expedition becomes the default run mode and the arena becomes
the skirmish entry.
`FEAT-EXPEDITION-PROMOTE`.

The first genuinely playable expedition is the end of Phase 3. The first *fun* one, in
the sense that exploring pays, is the end of Phase 5. **Promotion must not happen before
the end of Phase 6**: making an unfinished mode the default would ship a worse game than
the one that exists today, and the whole point of the additive build is that this
decision stays cheap until the mode has earned it.

**As built (2026-07-31): the operator overrode the phase ordering and ordered the flip
early** ("finish it already"). `FEAT-EXPEDITION-PROMOTE` ran (02c4b74) after the density,
spawn-legality/boss-sealing and map-access chunks landed in the same session; the phase-6
content ships post-promote as the refined plan in `BACKLOG.md` ("The post-promote content
plan"). The readiness playtest this section reserved for a human is not waived — it is
**POLISH-EXPEDITION-DEFAULT** in the backlog's playtest queue, and the one-object mode
seam keeps a revert a one-commit change.

## 6. Long-term improvements (after the 32 chunks)

Deliberately not filed as work orders yet: each needs the v1 loop in front of a player
first.

- **Retune the arena as a deliberate skirmish mode.** Promotion (section 5, Phase 7)
  leaves the arena as a short-session entry rather than the main event. Once it is not
  carrying the whole game, it can be tuned for what it is actually good at: a fast,
  dense, no-travel power fantasy, and the natural home for the daily challenge.
- **Biome mechanics, not just tints.** Stages currently vary by multipliers and
  palette. Sector-scale mechanics (a biome where walls move, one where the grid is
  dark beyond the ship's light radius, one with low-gravity drift) reuse the barrier
  and hazard rails already built.
  **First slice shipped as `FEAT-BIOME-REGION-STAGE` (`8c5ebb2`, 2026-08-02):**
  a sector's `biomeId` now drives the room's hazard bias and its grid palette plus ambient
  overlay, applied on `expedition:sector-entered` and skipped when the region does not change.
  The deferral above was read as discharged by the same argument the seasons bullet records:
  the stated precondition (the v1 loop in front of a player) was met when expedition became the
  live default at `02c4b74`. The spine region keeps the stage the player picked in the funnel,
  so the home region is still theirs.
  **Second slice shipped as `FEAT-BIOME-REGION-PACKS` (`65b250a`, 2026-08-02):**
  the region also picks the pack. `STAGE_SPAWN_BIASES` in `src/systems/DirectorSystem.ts`
  multiplies the director's weighted roll per enemy id, set by `setDirectorStage` at the same
  three sites the hazard bias uses, so the Ion Field shoots at you and the Crystal Caves send
  armour. `stage_deep_void` is deliberately unbiased, so the default stage is unchanged.
  **Third slice shipped as `FEAT-REGION-SIGNATURE-BANNER` (`10a396f`, 2026-08-02):**
  the region states its own rule. The sector banner gains a second line on a region change
  only, built by the pure `src/systems/regionSignature.ts` from the same `STAGE_SPAWN_BIASES`
  the director rolls against, so the banner cannot promise a pack the director does not send:
  the two most-boosted types and the most-suppressed one. The banner's region name moved from
  `sector.biomeId` to `this.activeStageId` in the same change, because a spine sector is
  stamped `stage_deep_void` while running the funnel pick and was therefore announcing the
  wrong region. `stage_deep_void` prints no second line, so a Deep Void expedition is
  unchanged. **Fourth slice shipped as `FEAT-REGION-SIGNATURE-HAZARDS` (`94b183c`, 2026-08-02):**
  the signature names the ground too. `STAGE_HAZARD_BIASES` moved out of the Phaser-importing
  `HazardZoneSystem` into the pure `src/systems/stageHazardBias.ts`, which both the spawner and
  the describer now read, so the banner's third clause (`BLOOMS ICE`) comes from the table the
  hazards actually roll against. One hazard is named and only when it is boosted, so
  `stage_deep_void` still prints no second line.
  **Fifth slice shipped as `FEAT-BIOME-REGION-DARK` (`daf82d7`, 2026-08-02):**
  the first slice that changes what a region does to the player rather than what it sends.
  `StageDefinition.ambientDarknessBoost` feeds the pure `resolveStageAmbientDarkness`, which
  `applyStageVisuals` pushes into `LightingSystem.setAmbientDarkness` at the same sites the
  hazard and pack biases use, and Crystal Caves (the third region of every world, at depths
  4-5) resolves to 0.63 against the shipped 0.35 baseline: outside the ship's light pool the
  world falls to about a third of its brightness. This is the answer to
  `POLISH-BIOME-REGION-SHIFT` (b), whether a region wants more than a tint. The `low`
  visual-quality path disables lighting entirely, so it gets a flat black plate under gameplay
  instead: the atmosphere, never a harder game. Six of the seven stages carry no boost and are
  byte-identical.
  **Sixth slice shipped as `FEAT-BIOME-REGION-DRIFT` (`fe560f0`, 2026-08-03):**
  low-gravity drift, the second of the three named sector-scale mechanics. `StageDefinition.driftFactor`
  feeds the pure `resolveStageDriftFactor`, which `applyStageVisuals` holds on the scene and
  `GameScene` multiplies into the `accelerationMultiplier` it already passes `inputSystem`, at the
  same site the hazard bias, the pack bias and the darkness use. The Ion Field (region index 3 of
  every world, at depths 6-7) resolves to 0.45, so inside it the ship reaches 95% of top speed in
  0.222 s against the shipped 0.100 s and coasts up to 29.6 px on a fast build against a 40 px
  tile; top speed itself never moves and enemies are untouched. **The deferral above was wrong on
  its stated reason and is corrected here rather than left standing:** drift needed no new movement
  machinery, because `src/ecs/systems/InputSystem.ts` has run an exponential velocity-approach model
  (`PLAYER_ACCEL_BASE`, "the single knob for player movement feel") since before this plan existed,
  and already took the caller's `accelerationMultiplier`. Six of the seven stages author no factor
  and are byte-identical. **Moving walls shipped as the seventh slice, below.** The stage
  multipliers are filed as
  `FEAT-BIOME-REGION-MULTIPLIERS`, and the banner clause as `FEAT-REGION-DRIFT-SIGNATURE-CLAUSE`.

  **Seventh slice shipped as `FEAT-BIOME-REGION-SHIFT` (`3bae4c7`, 2026-08-03):**
  moving walls, the last of the three named sector-scale mechanics. `StageDefinition.wallShiftSeconds`
  feeds the pure `resolveStageWallShiftSeconds`, which `applyStageVisuals` holds on the scene at the
  same site the hazard bias, the pack bias, the darkness and the drift use, and `GameScene.updateRegionWallShift`
  spends it as a per-room clock: every 15 s the ship stands in an Inferno room, `applyLiveWallShift`
  opens one 2-tile seam of rock and drops one 2-tile run of rubble, capped at four shifts per room
  per run and reset on every arrival so a room the ship only crosses never moves. **The deferral
  above was wrong on its stated reason and is corrected here rather than left standing:** it needed
  no new navigation or collision machinery, because collision reads tiles live through `tileKindAt`
  (`sealSector`'s own comment says so), `notifyGeometryChanged` already rebuilds the geometry layer
  and the flow field on the spot for four shipped mid-run tile writers, and `FEAT-STIR-COLLAPSE`
  already put the exactness proof in place. The write IS the ambient shift's pair of runs under the
  ambient shift's own `shiftHoldsUp`, so a live shift can never seal a route, close a doorway or
  strand a POI, and a 5x5 tile hull clearance around the ship keeps rock off the hull. Six of the
  seven stages author no interval and are byte-identical; nothing persists and no version constant
  moved. The banner clause is filed as `FEAT-REGION-SHIFT-SIGNATURE-CLAUSE`, behind the same
  line-budget gate the drift and dark clauses wait on.
- **World re-roll as a season.** A profile-level "new expedition" that regenerates the
  world with a new seed, banks the previous completion percentage as a record, and keeps
  traversal abilities. Turns the persistent world into a repeatable chase. **Shipped as
  `FEAT-EXPEDITION-SEASONS` (`fd406d3`, 2026-08-01):** the seed lives per profile
  in `src/expedition/ExpeditionSeasonStore.ts`, `src/expedition/expeditionWorld.ts` is the
  one place a world is built, and the CHART tile on the main menu banks and re-rolls
  behind a confirmation. Its deferral above was read as discharged because the stated
  precondition (the v1 loop in front of a player) was met when expedition became the live
  default at `02c4b74`. The other bullets in this section stay deferred. What a new world
  should re-lock for a profile that already owns every ability and key is an open operator
  call, filed as `BALANCE-SEASON-GATE-CARRYOVER`.
  **Extended by `FEAT-SEASON-WORLD-CHOICE` (`c2ec2b5`, 2026-08-01):** the re-roll offers three
  candidate worlds instead of one, previewed on the four facts that actually vary across seeds
  (secret slots, treasure/shrine slots, deepest sector depth, deepest region). The first
  candidate is `rollNextExpeditionSeed` itself, so the deterministic chain above is what a
  player who always takes the first option still flies.
  **Extended by `FEAT-SEASON-RETURN-TO-WORLD` (`429788e`, 2026-08-01):** banking a world no
  longer erases it. `DiscoveryManager` and `WorldProfileStore` were single-slot and discarded
  any payload whose `(worldSeed, worldGenVersion)` did not match the world being bound; both
  now read and write through `src/expedition/worldArchive.ts`, one storage key holding up to
  20 worlds under that same pair, and the CHART dialog can fly one of the three most recently
  banked worlds back exactly as it was left. A payload written before the archive shipped is
  filed under its own key rather than discarded, so no profile loses the world it is flying.
  **Extended by `FEAT-SEASON-RETURN-FULL-LIST` (`370e7bd`, 2026-08-01):** the return list pages
  three worlds at a time and `MORE` wraps through all 20, so every world the archive remembers
  is flyable rather than only the three most recent, and the archive keeps
  `MAX_BANKED_SEASONS + 1` worlds so a listed row can never arrive at a chart that was already
  evicted.
- **Seed sharing.** The world is a pure function of a seed, so a shareable world code
  costs almost nothing and pairs with the existing daily-challenge and leaderboard
  systems.
  **Built by `FEAT-SEASON-SEED-SHARE` + `FEAT-SEASON-CHOICE-SEED-ENTRY` (`afd403c`, 2026-08-01):**
  `src/expedition/seedCode.ts` is the code (`PPW1-` plus base36 of the seed), the CHART dialog's
  CODE button copies this world's, and PASTE decodes one and flies it through the same
  `switchExpeditionWorld` commit CHART A NEW WORLD makes, so the adopted world banks the old one
  with its chart and a seed already in the history is a RETURN rather than a new ordinal.
  `FEAT-SEASON-CODE-KEYBOARD-ENTRY` (`c4ca973`, 2026-08-01) added the TYPE choice and a typed field
  over the canvas that decodes through that same `decodeSeedCode`, so a code is enterable without a
  clipboard: one read off another screen, a screenshot or paper is flyable.
- **Completion percentage as a first-class metric.** Sectors visited, secrets found,
  quests closed. It is the natural companion to the existing best-score and
  deepest-endless-cycle chase metrics, and it is what a Metroid map trains players to
  care about.

  **Built by `FEAT-EXPEDITION-COMPLETION-RECORD` (`6e069a9`, 2026-08-02):** the chase half.
  `src/expedition/completionRecord.ts` holds the profile's lifetime best completion and the world
  that set it under `survivor-expedition-completion-best`, folded at both run-end paths and shown
  as a `Best Chart` row on the game-over grid plus a `BEST 61% (W2)` clause on the CHART and
  RETURN dialogs, in the same `bestX` plus `isNewBest` shape score, endless cycle and gauntlet
  wave already ship. Its deferral above was read as discharged because the stated precondition
  (the v1 loop in front of a player) was met when expedition became the live default at
  `02c4b74`, the same argument the seasons and biome bullets in this section record. **The
  metric's own definition is unchanged**: it still counts sectors visited plus secrets found, not
  quests closed, because the two-axis number is already printed in 20 banked rows and a third axis
  re-scores history the player has been shown. That half is `FEAT-COMPLETION-QUEST-AXIS`.
  **The win screen shows it too (`FEAT-VICTORY-COMPLETION-ROW`, `e5caeb1`):** the victory grid
  carries one expedition row, `Charted` beside `Best Chart`, so the run end most likely to set
  the record is the one that announces it. It deliberately carries NO `World` cell: the victory
  kicker already prints `W<n> CONQUERED · <p>% CHARTED`, and the pinned button row leaves the
  panel room for exactly one extra 34-unit row. Do not re-derive either constraint.
- **Boss rooms as gates, not just fights.** A sector lock that also holds a traversal
  ability behind it makes bosses structural rather than optional.

  **Built by `FEAT-WORLDGEN-WARDEN-SEAL` (`0f632ea`, 2026-08-02):** conquering a world opens a
  region of it. `WARDEN_SEAL_KEY_ID` is a reserved KeyDoor id no quest grants, appended (never
  inserted) to `generateExpeditionWorld`'s `questKeyOrder`, and `getHeldWorldKeyIds` hands it to
  the profile once `isWorldConquered` is true, so `placeQuestKeyDoors` seals the region and
  `applyEarnedQuestKeys` opens it with no new mechanism. Measured over 101 seeds: the four
  shipped quest doors are byte-identical and exactly one warden door places, which is why no
  `WORLDGEN_VERSION` bump was needed. **The other half of this bullet is deliberately NOT built:**
  a traversal ability behind the seal would put an ability outside the ordering guarantee
  `placeAbilityGates` exists to hold (vault i reachable using only abilities before it), and the
  candidate rule already refuses any region holding an ability slot or an ability door, which is
  the same rule that keeps the boss arena itself always reachable. Do not re-derive this: moving
  an ability behind the Warden is a solvability change, not a placement tweak.
- **Escort and delivery quests that use the geography.** Once navigation and streaming
  are proven, the quest triggers already specced (deliver, escort, reach) become
  cheap content.
- **Ambient world state.** Sectors that change between runs (a wall collapsed, a new
  hazard bloom) using the existing event system, so a persistent world does not read
  as a static one.
  **First slice shipped as `FEAT-WORLD-AMBIENT-STIR` (`7291ff6`, 2026-08-02):** the hazard-bloom
  half. `src/world/ambientStir.ts` picks three rooms per expedition from (world seed, generator
  version, expedition ordinal) and paints four extra 3x1 `TileKind.HazardFloor` runs into each,
  applied as the fifth pass of `ExpeditionModeAdapter`'s replay block in the `applyBrokenBarriers`
  mould. The ordinal is a new optional `expeditionCount` on `WorldProfileState`, so no storage key
  and no version constant moved, and `WORLDGEN_VERSION` did not move because a bloom is an overlay
  rather than generation. It needed no reachability proof: `TileKind.HazardFloor` is non-blocking
  at every consumer and the painter writes only over `TileKind.Open`, so no route can close. The
  "a wall collapsed" half does block and therefore needs a `sealHoldsUp`-shaped proof; it is filed
  as `FEAT-STIR-COLLAPSE`.
  **Second slice shipped as `FEAT-STIR-COLLAPSE` (`2462679`, 2026-08-02):** the wall half, both
  directions. Three further rooms per expedition open two 2-tile seams of rock into floor and then
  drop three 2-tile runs of rubble across floor, in that order, so a pinch that was a room's only
  route can legally take rubble once the seam has opened an alternate. Rubble is `TileKind.Solid`
  and never `TileKind.Breakable`, because a breakable needs a rect id and ids have to agree with
  `brokenBreakableIds`, a per-profile memory that outlives the expedition ordinal. Each run is
  written, then proved: the room's reachable area, flooded from a doorway, must move by exactly the
  tiles the run wrote, every doorway must still be reached and no POI slot that was reachable may
  have stopped being. That is `sealHoldsUp`'s exactness argument (`src/world/sectorInterior.ts`)
  applied to an overlay, and it is what the deferral above was waiting on. A run that fails the
  proof is reverted and the attempt is spent. No version constant and no storage key moved.
- **Map annotation.** Player-placed pins on the map screen, the single most requested
  feature of every Metroid-style map ever shipped.
  **Built by `FEAT-MAPUI-SECTOR-MARKS` (`4fd97c3`, 2026-08-01):** `P` or gamepad **A** on
  the focused sector cycles none → come back here → danger → unsolved → none;
  `src/expedition/sectorMarks.ts` is the vocabulary and the persisted-id codec,
  `WorldProfileStore.markedSectorIds` is the memory (per world, archive-backed, so a banked world
  keeps its marks and `RETURN` brings them back), and a mark is a fourth radar waypoint kind so a
  mark is a bearing rather than only a glyph.
  **Extended by `FEAT-MARK-NOTES` (`f6662c3`, 2026-08-01):** a mark carries words as well as a
  shape. `N` on the focused sector opens a 60-character field over the chart
  (`src/ui/CodeEntryOverlay.ts`, the shipped DOM-field idiom), `WorldProfileStore.sectorNotes` is
  the memory, the sector readout quotes it back in the player's own case, and a dot on the mark
  says which sectors carry one. A note on an unmarked sector places the `return` mark as its
  carrier, and clearing a mark clears its note.

## 7. Human and operator gates

These are decisions or checks a fleet agent must not make alone. They belong in
`BACKLOG.md` under `## Human gates`.

Both gates that blocked this plan are now **answered** (operator, 2026-07-27):

- **GATE-EXPEDITION-PROMOTE: answered, and the flip has RUN (02c4b74, 2026-07-31, by
  operator directive).** The `?expedition=1` route is retired; arena survives as the
  SKIRMISH menu card and as the substrate for the daily challenge, practice and
  boss-rotation modes. The readiness verification moved to POLISH-EXPEDITION-DEFAULT.
- **GATE-EXPEDITION-RECALL: answered, recall is a mid-run teleport, not a run ending.**
  Consequences and the one remaining tuning knob are in section 4.1.

Still human-only:

- **The promotion itself is a judgement call about quality, not a code change.** A fleet
  agent can implement `FEAT-EXPEDITION-PROMOTE`, but only a human flying the world can
  say the default is ready to change. OQ-1 (seam pop) is a ship blocker for it.
- **POLISH gates**: every chunk that changes something visible files a `POLISH-*` item
  under `## Human gates` when it lands, per the existing repo convention. The ones
  most likely to need a human in a browser: seam pop (OQ-1), map screen readability on
  a phone, minimap underlay legibility under combat load, and whether exploration gold
  feels worth the detour.
