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
block and the first real body of `migrateState()`** (`GameStateManager.ts:815`).
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

The stranding guarantee doc 04 relies on is unchanged: recall is always *available*
outside a lock, so physical stranding is impossible and a soft-lock reduces to a
progression block, which the vault ordering rule prevents.

### 4.2 Still open, for playtest (not blockers)

- **OQ-1 seam pop.** The camera free-scrolls and can show parts of two sectors, but
  entities are live in one sector only. A player looking across a seam may see enemies
  appear at the boundary. Mitigations, in order of preference if it reads badly:
  activate the neighbor sector's entities on approach, tighten the camera deadzone near
  seams, or make seams visually opaque (doorways, not open field). Decide from play,
  not from theory. **Now that expedition is the default mode, this is a ship blocker for
  `FEAT-EXPEDITION-PROMOTE` rather than a nice-to-have.**
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
- **World re-roll as a season.** A profile-level "new expedition" that regenerates the
  world with a new seed, banks the previous completion percentage as a record, and
  keeps traversal abilities. Turns the persistent world into a repeatable chase.
- **Seed sharing.** The world is a pure function of a seed, so a shareable world code
  costs almost nothing and pairs with the existing daily-challenge and leaderboard
  systems.
- **Completion percentage as a first-class metric.** Sectors visited, secrets found,
  quests closed. It is the natural companion to the existing best-score and
  deepest-endless-cycle chase metrics, and it is what a Metroid map trains players to
  care about.
- **Boss rooms as gates, not just fights.** A sector lock that also holds a traversal
  ability behind it makes bosses structural rather than optional.
- **Escort and delivery quests that use the geography.** Once navigation and streaming
  are proven, the quest triggers already specced (deliver, escort, reach) become
  cheap content.
- **Ambient world state.** Sectors that change between runs (a wall collapsed, a new
  hazard bloom) using the existing event system, so a persistent world does not read
  as a static one.
- **Map annotation.** Player-placed pins on the map screen, the single most requested
  feature of every Metroid-style map ever shipped.

## 7. Human and operator gates

These are decisions or checks a fleet agent must not make alone. They belong in
`BACKLOG.md` under `## Human gates`.

Both gates that blocked this plan are now **answered** (operator, 2026-07-27):

- **GATE-EXPEDITION-PROMOTE: answered, expedition becomes the default run mode.** It
  still ships behind `?expedition=1` for phases 0 to 6; `FEAT-EXPEDITION-PROMOTE` flips
  the default once the mode has earned it. Arena survives as the skirmish entry and as
  the substrate for the daily challenge, practice and boss-rotation modes.
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
