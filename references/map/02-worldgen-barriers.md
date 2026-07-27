# 02: World Generation, Barriers, Collision, Enemy Navigation

> **Amended 2026-07-27 by operator decision.** Expedition becomes the **default** run
> mode (promoted by `FEAT-EXPEDITION-PROMOTE` after phase 6; it still ships behind
> `?expedition=1` until then), and **Recall to Hangar is a mid-run teleport, not a run
> ending**. Where this document assumes otherwise, `README.md` sections 4.1 and 7 win.


Piece 2 of the expedition-mode feature (Metroid-style explorable world). This document
owns: the world map itself, static geometry, the first solid collision in this game's
history, and how enemies navigate it. Sibling documents: `01-world-space.md` (camera and
world-space Transform, owned elsewhere), discovery/minimap (03), quests/powerups/secrets
content (04).

Spine decisions this document builds on (not relitigated here):

- A sector is one arena viewport (nominal 1280x720 play field). The world is a graph of
  sectors connected by edges.
- World layout is persistent per profile and deterministically seeded. Contents re-roll
  per run. Discovery and secrets accumulate across runs.
- Expedition mode is additive. Classic single-arena mode keeps working unchanged, every
  chunk ships playable.
- Generation and collision math are pure modules (no Phaser import), Vitest-tested.
  Phaser-coupled code is not unit-tested here.

Ground truth verified in this codebase (2026-07-27):

- Zero static collision exists. Contact is circle-vs-circle only (player r=16, enemy
  r=12). Crates (`src/game/scenes/GameScene.ts:3790-3841`) have no collision body.
- `src/utils/SpatialHash.ts` (cell 80, numeric keys, zero-alloc query paths) indexes
  dynamic entities only and is already infinite-domain.
- `src/ecs/systems/MovementSystem.ts:10-22` integrates velocity with no clamp; the player
  screen clamp is `clampPlayerToScreen` at `:27`. Knockback clamps to screen at
  `GameScene.ts:5160-5161`. Enemy projectiles despawn off-screen at
  `GameScene.ts:4342-4345`.
- Enemy AI bounds are module state (`src/ecs/systems/enemy-ai/state.ts:14-21`), injected
  from `GameScene.ts:719`. Per-frame context injection precedent: `telegraphManager` in
  `src/ecs/systems/enemy-ai/common.ts:21-24`.
- Seeded RNG already exists: `mulberry32`, `hashStringToSeed`, `shuffleWithRng` in
  `src/utils/dailySeed.ts` (used deterministically in `src/data/DailyQuests.ts:171`).
- `phase` meta upgrade is a damage-avoidance proc while moving
  (`src/meta/MetaProgressionManager.ts:926-930`, consumed at `GameScene.ts:5370-5374`).
  It is NOT geometry phasing. Dash is a velocity multiplier over a duration
  (`src/game/managers/InputController.ts:148-166`), not a teleport.
- Persistent data must go through `SecureStorage` (`src/storage/`), per repo CLAUDE.md.

---

## 1. World model

### 1.1 Shape: a lattice, not a free graph

Sectors live on an integer 2D lattice. Each sector occupies grid coordinate
`(sx, sy)`; edges connect 4-neighbors only. Reasons over a free-form node graph:

- The sector-to-world affine map is trivial (`worldX = sx * SECTOR_WIDTH + localX`),
  which is exactly the pure conversion module `01-world-space.md` promises.
- The minimap (document 03) renders a lattice for free, matching Metroid convention.
- Edge geometry is a shared border segment, so an edge's aperture is one span of tiles
  that both sectors agree on by construction.
- Streaming and collision lookup become array math instead of graph traversal.

One-way drops and loops still exist: they are edge kinds, not graph exotica.

### 1.2 Interior representation: a tile bitmask per sector

Each sector's static geometry is a 40px tile grid: 32x18 = 576 tiles, one
`Uint8Array(576)` per sector. 40 was chosen because it is small enough for corridors and
pillars to read against a 16px-radius ship, large enough that a circle of radius 16
overlaps at most a 2x2 tile block (cheap resolution, section 5), and it divides the
SpatialHash cell size 80 exactly (one hash cell = 2x2 tiles, keeping any future
cross-indexing aligned).

Tile values are a small enum, not a bitfield soup:

```ts
export const enum TileKind {
  Open = 0,
  Solid = 1,            // permanent wall
  Breakable = 2,        // backed by a barrier entity; becomes Open when broken
  GateClosed = 3,       // door/membrane tiles while closed; Open once opened
  HazardFloor = 4,      // walkable, damaging; never blocks
}
```

### 1.3 Types

All of these live in `src/world/worldTypes.ts` (new, pure).

```ts
export const SECTOR_TILE_COLS = 32;
export const SECTOR_TILE_ROWS = 18;
export const TILE_SIZE = 40;   // SECTOR_WIDTH / SECTOR_TILE_COLS, kept in lockstep
                               // with SECTOR_WIDTH/HEIGHT exported by the
                               // world-space module from 01-world-space.md

export type SectorKey = string;                    // `${sx},${sy}`
export type EdgeDirection = 'north' | 'east' | 'south' | 'west';

export const enum EdgeKind {
  Wall = 0,          // no passage (absent edge)
  Open = 1,          // free seam
  AbilityDoor = 2,   // opens permanently with a permanent power-up
  KeyDoor = 3,       // opens with a quest key item
  Breakable = 4,     // destructible wall plug (secret route)
  OneWay = 5,        // membrane, passable in the stored direction only
}

export interface EdgeDef {
  kind: EdgeKind;
  /** Tile span of the aperture along the shared border, in the border's axis.
   *  Minimum width 3 tiles (120px) so the ship plus knockback jitter fits. */
  apertureStart: number;
  apertureEnd: number;                 // inclusive
  /** AbilityDoor/KeyDoor: id the quests/powerups architect binds content to. */
  requiredId?: string;
  /** OneWay: passable travelling in this direction only. */
  passDirection?: EdgeDirection;
}

export const enum PoiKind {
  AbilityPowerUp = 0,   // mandatory progression slot; generator places these
  QuestGiver = 1,
  Secret = 2,
  Treasure = 3,
  Shrine = 4,
}

export interface PoiSlot {
  id: string;               // stable: `poi:${sx},${sy}:${index}`
  kind: PoiKind;
  tileX: number;            // guaranteed Open with a 3x3 Open neighborhood
  tileY: number;
  /** AbilityPowerUp only: which gate ability this slot must grant. */
  grantsAbilityId?: string;
}

export interface SectorDef {
  sx: number;
  sy: number;
  key: SectorKey;
  /** StageDefinition id from src/data/Stages.ts:34-139. */
  biomeId: string;
  /** 0..1 pacing value, monotone with graph depth plus gate-tier bumps.
   *  Content and spawn systems scale difficulty and reward from it. */
  danger: number;
  /** Row-major TileKind array, SECTOR_TILE_COLS * SECTOR_TILE_ROWS long. */
  tiles: Uint8Array;
  edges: Record<EdgeDirection, EdgeDef>;
  poiSlots: PoiSlot[];
  isStart: boolean;
  isBossArena: boolean;
  /** Player entry clearance per edge: the Open tile just inside each aperture. */
  entryTiles: Partial<Record<EdgeDirection, { tileX: number; tileY: number }>>;
  /** Breakable interior walls (not edge plugs): tile spans + stable ids. */
  breakables: { id: string; tileX: number; tileY: number; tileW: number; tileH: number }[];
}

export interface WorldMap {
  worldGenVersion: number;   // bump when generator output would change for a seed
  seed: number;
  startKey: SectorKey;
  sectors: Map<SectorKey, SectorDef>;
  /** Ability gate order actually used, in unlock sequence. */
  abilityOrder: string[];
}

/** Inputs that shape generation. Stable per profile; mutable profile state
 *  (discovery, broken walls) is deliberately NOT an input. */
export interface WorldGenInputs {
  /** Ability ids in intended unlock order; from the content architect (doc 04). */
  abilityGateOrder: string[];
  /** Stage ids the profile may see; caller pre-filters Stages.ts
   *  unlockRequirement gates (worldLevel:N / hidden:<id>). Start biome is
   *  always stage_deep_void regardless. */
  availableBiomeIds: string[];
  /** Total sector count budget (default 48). */
  sectorBudget?: number;
}
```

*(As built, `FEAT-WORLDGEN-CORE`: `SectorDef` also carries `depth` (tree distance from
start) and `WorldMap` also carries `bossArenaKey`. Both are already computed during
generation and are needed by the invariant suite, `FEAT-WORLDGEN-SPAWN` and
`FEAT-MAPUI-*`; re-deriving tree depth from the `Map` outside the generator would mean a
second traversal that can disagree with the first. The enums ship as plain `export enum`,
not `const enum`, because `tsconfig.json` sets `isolatedModules: true` and every existing
enum in the repo is plain.)*

### 1.4 What is generated when

| Layer | Generated | Persistence |
| --- | --- | --- |
| Topology, edges, gates, biomes, danger, tiles, POI slots, breakable ids | Once per profile, pure function of `(seed, WorldGenInputs, worldGenVersion)` | Not saved. Regenerated on load from the saved seed. |
| Broken breakables, opened doors, collected ability slots | Mutated by play | Profile store (`WorldProfileState`, section 4.7), SecureStorage. |
| Discovery (visited sectors, seen edges) | Mutated by play | Owned by doc 03; keyed by `SectorKey`. |
| Enemies, clutter crates, loot, hazard zone instances | Per visit to a sector, per run | Run save only while the sector is current (section 9). |

Saving the seed instead of the geometry keeps the profile store tiny and makes the
13-file save/restore test convention (`GameStateManager` precedent) apply to a small
state object, not megabytes of tiles. `worldGenVersion` is stored beside the seed; on
mismatch the world regenerates under the new version and profile flags are re-applied by
stable id (`SectorKey`, breakable ids, edge ids), dropping flags whose ids no longer
exist. That is the whole migration story, and it is testable.

---

## 2. Generation algorithm

`generateWorld(seed: number, inputs: WorldGenInputs): WorldMap` in
`src/world/generateWorld.ts`. Pure, deterministic, no retry loops.

### 2.1 RNG discipline

Reuse `mulberry32` and `hashStringToSeed` from `src/utils/dailySeed.ts`. Every phase and
every sector gets its own stream:

```ts
const topologyRng = mulberry32(hashStringToSeed(`world:${seed}:topology:v${WORLDGEN_VERSION}`));
const sectorRng   = mulberry32(hashStringToSeed(`sector:${seed}:${sx},${sy}:v${WORLDGEN_VERSION}`));
```

Independent streams mean a change in one phase's roll count cannot shift another phase's
output, which keeps diffs to the generator reviewable (only the touched phase's output
changes for a given seed).

### 2.2 Approach: constructive lock-and-key on a grown spanning tree

Chosen over the alternatives:

- **Wave Function Collapse**: gives local texture, but reachability and gate ordering
  become post-hoc validate-and-retry problems. Retry loops make "pure function of seed"
  awkward (variable RNG consumption) and worst-case unbounded.
- **BSP subdivision**: solves "split one big space into rooms". Our rooms are fixed-size
  lattice cells; the interesting structure is the connection graph, which BSP does not
  model.
- **Random graph + validate/repair**: same retry objection, and repair passes are where
  soft-lock bugs live.

Constructive generation is O(sectorBudget) and valid by construction, so the test suite
asserts invariants instead of babysitting a repair loop.

**Phase A: grow the tree.** Start sector at (0,0). Maintain a frontier of
(sector, direction) growth candidates; repeatedly pick one weighted by `topologyRng`
(bias toward continuing straight, mild bias against exceeding a bounding box of
roughly `sectorBudget / 6` per axis) and attach a new sector until the budget is spent.
Result: a spanning tree where tree depth = graph distance from start.

**Phase B: add loops.** For each lattice-adjacent sector pair NOT connected in the tree,
connect with probability 0.25 as an `Open` edge if their tree depths differ by <= 2,
else with probability 0.15 as a `OneWay` edge oriented from the deeper sector toward the
shallower one. The one-way rule is the soft-lock proof: one-ways are only ever loop
edges pointing start-ward, so forward progress never requires one and taking one always
lands in territory that was already reachable.

**Phase C: gates (lock-and-key, frontier method).** Maintain the reachable region R,
initially the start sector's tree component with no gates. For each ability id `a_i` in
`inputs.abilityGateOrder`:

1. Pick a tree edge on the boundary of R (an edge from a sector in R to a subtree not
   in R), weighted toward deeper edges, and mark it `AbilityDoor` with
   `requiredId = a_i`.
2. Place an `AbilityPowerUp` POI slot with `grantsAbilityId = a_i` in a sector inside R,
   weighted toward the deepest sectors of R (so the key sits near, but provably before,
   its lock).
3. Expand R through the new gate's subtree.

By construction every ability is obtainable strictly before its gate is needed.
`KeyDoor` edges (quest keys, doc 04) are placed the same way after ability gates, using
quest-key ids the content architect supplies later via slot binding, and `Breakable`
edge plugs are placed only on LOOP edges (never tree edges), so a player who never
shoots a wall can still reach every mandatory POI. The boss arena is the deepest leaf
behind the final gate, flagged `isBossArena`.

*(As built, `FEAT-WORLDGEN-CORE`: the frontier method above is implemented as **nested
subtrees**, which is the same construction stated from the other end. `availableRegion`
starts as every sector; gate `i` picks a tree edge `u -> v` wholly inside it, the key goes
in `availableRegion \ subtree(v)`, and `availableRegion` then becomes `subtree(v)`. Since
`subtree(v_0) ⊃ subtree(v_1) ⊃ ...`, key `i` provably sits between gate `i-1` and gate
`i`. Loop edges with exactly one endpoint in `subtree(v)` are **deleted** (set back to
`Wall`), not re-labelled: a bypass loop would let a player into the locked subtree without
its key, and re-labelling it with the same `requiredId` would break an earlier gate's
ordering. Deletion is the only variant with a one-line proof, and tree edges are never
deleted so the sector graph stays connected. `EdgeKind.KeyDoor` is defined but **never
emitted by v1** — quest key ids come from doc 04's `FEAT-QUEST-CHAINS`, which supplies no
generation input yet; the enum member exists so that chunk adds no type churn. Boss arena
tie-break: deepest sector in the final region, lowest `SectorKey` by string compare,
stepping to the next deepest if that resolves to the start sector.)*

**Phase D: biomes and danger.** `danger = depth / maxDepth`, then +0.08 per gate tier
crossed, clamped to 1. Partition the tree into contiguous regions of 4-8 sectors
(subtree slicing); assign each region a stage id from `inputs.availableBiomeIds` sorted
so low-multiplier stages (`stage_deep_void` 1.0x) sit at low danger and punishing ones
(`stage_molten_vault`, +15%/+20% at `src/data/Stages.ts:125-138`) at high danger. The
start region is always `stage_deep_void`. Stage multipliers
(`enemyHealthMultiplier` etc.) then apply exactly as the classic stage select already
applies them: no new difficulty plumbing.

*(As built, `FEAT-WORLDGEN-CORE`: biomes are assigned by **depth band**
(`REGION_DEPTH_SPAN = 2`, so `regionIndex = floor(depth / 2)` indexes the harshness-sorted
list, clamped to its last entry) rather than by contiguous 4-8 sector subtree slices.
Depth banding is deterministic, needs no region bookkeeping, and makes biome harshness
rise with danger, which is the property the stage multipliers actually depend on.
Harshness is `enemyHealthMultiplier + enemyDamageMultiplier`, ties broken by id;
`stage_deep_void` is always prepended, so depth 0 lands on it even if the caller omits it
from `availableBiomeIds`.)*

**Phase E: interiors.** Per sector, from `sectorRng`, pick a parametric template by
biome and danger: `openField` (start, low danger), `pillarGrid`, `corridorPinch`,
`cavern` (two cellular-automata smoothing passes over seeded noise; Crystal Caves and
Verdant Rot lean here), `arenaRing` (boss). Then run deterministic constraint carving:

1. Stamp every edge aperture (from `EdgeDef`) Open, 3 tiles deep into the sector.
2. Flood-fill from one aperture. For any aperture or POI slot tile not reached, carve a
   corridor to the reached region with A* over the tile grid (deterministic tie-break:
   lower tile index wins). Carving only removes solids, never adds.
3. Stamp 3x3 Open around every POI slot and every `entryTiles` position.
4. Boss arenas additionally enforce `openTileCount >= 0.65 * 576`.
5. Interior `Breakable` pockets and `HazardFloor` strips are stamped last, only on
   tiles whose removal keeps the flood-fill connected (checked constructively:
   hazard never blocks; breakables are placed as pocket walls off the main region).

Every step is carve-only or verified-before-stamp, so interior connectivity cannot
regress after step 2.

*(As built, `FEAT-WORLDGEN-CORE`: step 2's corridor carve is an **L-shape** (walk the
target's row to the nearest reached interior tile by Manhattan distance, lowest tile index
breaking ties, then walk that tile's column), not A*. It gives the same invariant-5
guarantee, is carve-only and bounded by the target count, and leaves no pathfinder to
test. Before any aperture is stamped, the sector's **border ring is set `Solid`** — every
sector is walled and apertures are the only way in, which also gives the seam an opaque
doorway (the OQ-1 seam-pop mitigation from `README.md` section 4.2). Gate tiles therefore
live on the border ring at aperture **depth 0**; depths 1 and 2 are the approach and are
always `Open`. Aperture spans are kept **at least 3 tiles clear of both ends of their
axis**: an aperture reaching a corner would stamp its own approach straight through a
perpendicular aperture's mouth, and the two edge kinds cannot both win that tile. Step 3's
3x3 stamps are clipped to the interior box so they can never overwrite the ring or a gate
tile.)*

### 2.3 Purity boundary

`generateWorld` and everything it calls import nothing from Phaser, `GameScene`, or
save code. The scene consumes `WorldMap`; the profile store consumes ids. That is the
same boundary the 14 barrage planners already use (plan in pure module, execute in
consumer), and it is what makes section 3 possible.

---

## 3. Testability: the invariant suite

`src/world/generateWorld.test.ts` plus `src/world/staticCollision.test.ts`. Run over a
fixed table of seeds (at least 100) in normal CI; every invariant below is a plain
assertion, no snapshots of full maps (snapshot only a compact hash for the determinism
case).

Generator invariants:

1. **Determinism**: `generateWorld(seed, inputs)` called twice deep-equals; a stable
   serialization hash per seed matches a checked-in table (regenerated only on an
   intentional `WORLDGEN_VERSION` bump). *(As built: the double-generation check ships,
   the hash table does not. It pins exactly the same property and would otherwise have to
   be hand-regenerated on every intentional change.)*
2. **Reciprocity**: for every sector pair, A's east edge deep-equals B's west edge
   (kind, aperture span, requiredId, passDirection mirrored). *(As built: **one** frozen
   `EdgeDef` object is shared by both sectors, so reciprocity is an **identity** check
   (`toBe`), not a deep-equal one. `passDirection` is therefore an **absolute** lattice
   direction, identical on both sides, not mirrored per sector. Freezing is what stops a
   later chunk creating a second source of truth: opened doors and broken walls belong to
   `WorldProfileState`, section 4.7.)*
3. **Gate-order solvability (the big one)**: simulate a player. Start at `startKey`
   with no abilities; BFS through `Open` edges, `OneWay` in `passDirection`,
   `AbilityDoor` whose `requiredId` is held, collecting `grantsAbilityId` at each
   reached `AbilityPowerUp` slot; repeat to fixpoint. Assert: all sectors reached, all
   POI slots reached, all abilities collected, and the boss arena is reached last-tier.
   Run the same simulation with `Breakable` edges treated as walls: all
   `AbilityPowerUp` slots and the boss arena must STILL be reachable (secrets are
   optional by construction).
4. **No one-way soft-lock**: replay the simulation; at every step, the start sector is
   reachable from the current reachable set using currently-held abilities.
5. **Interior connectivity**: per sector, flood fill from each aperture reaches every
   other aperture, every POI tile, and every `entryTiles` tile.
6. **Clearance**: no `Solid`/`Breakable`/`GateClosed` tile inside any aperture span,
   any POI 3x3 neighborhood, or any entry tile; boss arenas satisfy the open-area
   floor. *(As built: clearance is about aperture depths **1 and 2** only — depth 0 is
   the mouth on the border ring, and a gate legitimately sits there as `GateClosed`
   (`AbilityDoor`/`KeyDoor`/`OneWay`) or `Breakable`. The check asserts depths 1-2 are
   `Open` and depth 0 is exactly the tile kind its `EdgeKind` implies.)*
7. **Danger and biome**: start sector danger is 0 and biome `stage_deep_void`; danger
   is within [0,1] and non-decreasing along every root-to-leaf tree path; every
   `biomeId` resolves via `getStageById` (`src/data/Stages.ts:141`).
8. **Version stamp**: output `worldGenVersion === WORLDGEN_VERSION`.

Collision resolver invariants (section 5's module):

9. **Push-out**: a circle placed overlapping any solid tile resolves to
   non-overlapping, displacement <= penetration + epsilon. *(As built,
   `FEAT-BARRIER-COLLIDE`: pinned as **a move that would end inside a solid tile ends
   tangent to it**, not as depenetration of an already-embedded motionless circle.
   Axis-separated resolution has no correction to apply when the step along that axis is
   zero, and depenetration is `findNearestFreeCircleSpot`'s job — section 5.3 already
   routes the one real case, wraith unphase, through it.)*
10. **No tunneling**: sweeping a circle at
    `TUNING.player.dashSpeedMultiplier * maxPlayerSpeed` across a 1-tile wall for any
    delta up to 100ms never ends on the far side.
11. **Corner slide**: motion diagonal into a wall preserves the tangential component
    (position advances along the wall).
12. **Spawn snap**: `findNearestFreeCircleSpot` never returns a tile overlapping
    non-Open tiles and always returns a tile flood-connected to the query's region
    when one exists. *(As built, `FEAT-BARRIER-COLLIDE`: implemented as a
    **connectivity-preserving BFS within one sector**, not the spiral 5.2 names — a
    spiral can return a tile on the far side of a wall, which this invariant forbids
    outright. The search may walk through solids only until it first reaches open space,
    which is what lets an embedded mover escape the blob it is stuck in; from an open
    query tile it never leaves the open region. Known gap from a deeply embedded start,
    filed as `CHORE-COLLIDE-EMBEDDED-SNAP`.)*

---

## 4. Barrier taxonomy

Six kinds. Each row answers: blocks player? blocks enemies? blocks projectiles, beams,
auras, summons? Tile representation is section 1.2; entity representation below.

| Barrier | Player | Enemies | Player projectiles | Beams | Auras/splash | Enemy projectiles |
| --- | --- | --- | --- | --- | --- | --- |
| Solid wall | blocks | blocks | stop (exceptions 7.2) | clip | ignore walls | stop |
| Destructible | blocks until broken | blocks until broken | hit and damage it | damage it, clip | damage it (in EnemyTag pipeline) | stop |
| Ability door | blocks until opened | always blocks | stop | clip | ignore | stop |
| Key/quest door | blocks until opened | always blocks | stop | clip | ignore | stop |
| One-way membrane | blocks against `passDirection` only | blocks both ways | pass | pass | ignore | pass |
| Hazard barrier | never (damages on overlap) | never | pass | pass | ignore | pass |

### 4.1 Solid walls

Pure tiles, no entities, no health. The only barrier with zero bookkeeping.

### 4.2 Destructible barriers

Reuse the crate pattern verbatim: `Destructible` + `EnemyTag` + `Health` + `EnemyType`
with no `EnemyAI` (`src/ecs/components/index.ts:127`, spawn at
`GameScene.ts:3790-3841`). Two flavors:

- **Structural** (edge plugs and interior pocket walls from the generator): tiles are
  `Breakable`; on death, `handleDestructibleDestroyed` (`GameScene.ts:3864`) also calls
  `clearBreakableTiles(worldMap, breakableId)` and records the id in
  `WorldProfileState.brokenBreakableIds`. Broken forever, across runs (spine: secrets
  accumulate).
- **Clutter** (crates as today): no tiles, per-run, unchanged behavior.

Auto-target note: crates already share the EnemyTag pipeline and the AI/heal exclusions
handle them (`common.ts:35-37`); structural breakables inherit that. Weapon auto-aim
preferring a wall over a live enemy is prevented the same way crates handle it today
(no change needed; they are targets of opportunity).

### 4.3 Ability-gated doors

Edge gates keyed to permanent power-up ids (doc 04 owns the power-ups; the id string is
the contract). Behavior: when the player is within 60px of the door's aperture and the
profile holds `requiredId`, the door opens with a short animation, its `GateClosed`
tiles become `Open`, and the edge id is recorded in `WorldProfileState.openedEdgeIds`.
Permanent thereafter. Enemies never open doors and never path through closed ones.

### 4.4 Key/quest-locked doors

Mechanically identical to 4.3 with a different id namespace (`quest:*`). Consuming vs
keeping the key is doc 04's decision; this layer only asks "is `requiredId` satisfied".

### 4.5 One-way membranes

A directional tile band on the edge aperture. The resolver blocks a circle whose motion
opposes `passDirection`; motion with it passes freely. Enemies treat membranes as walls
in both directions (the flow field marks them impassable), which keeps pursuit logic
simple and makes membranes a guaranteed escape tool for the player. Projectiles pass
both ways (it is a field, not matter).

### 4.6 Hazard barriers

`HazardFloor` strips reusing `HazardZoneSystem`'s zone kinds as static, non-expiring
placements (spawner today at `src/systems/HazardZoneSystem.ts:425-489` is screen-space
and per-run; static strips are spawned from the sector def on activation instead).
They gate by cost, not by blocking. Player-only damage, exactly like existing hazard
zones.

### 4.7 Persistence

```ts
export interface WorldProfileState {
  version: 1;
  worldSeed: number;
  worldGenVersion: number;
  brokenBreakableIds: string[];
  openedEdgeIds: string[];      // `edge:${sxA},${syA}:${direction}`
  collectedPoiIds: string[];    // AbilityPowerUp slots consumed (doc 04 reads/writes too)
}
```

Stored via `SecureStorage` (repo rule), separate from the run save. The run save
(`GameSaveState`, `src/save/GameStateManager.ts:312`) gains one optional field so legacy
saves load untouched (the codebase's established optional-field pattern, see
`:333-355`):

```ts
expedition?: {
  worldSeed: number;
  currentSectorKey: SectorKey;
  // per-visit volatile state for the CURRENT sector only (section 9)
};
```

`migrateState()` (`GameStateManager.ts:815`, currently unused) becomes live for the
v1 -> v2 bump. Save/restore tests follow the existing 13-file convention: a dedicated
`worldstate` save test asserting seed round-trip, broken/opened id round-trip, and
legacy-save (no `expedition`) load.

---

## 5. Collision design

### 5.1 Representation: uniform tile grid, and why

The candidates:

- **Convex polygons + SAT**: precision the game cannot use (the aesthetic is a neon
  grid; axis-aligned chunky geometry fits it), needs its own broadphase, hardest to
  generate and to test.
- **Signed distance field**: lovely gradients for steering, but f32-per-texel memory,
  and every broken breakable forces a field rebuild. We get the steering benefit
  another way (flow field, section 6) while keeping collision truth cheap to mutate.
- **Phaser Arcade physics**: violates the pure-module rule outright; the game uses no
  Phaser physics bodies anywhere today, and adopting them for this one feature would
  couple the most test-critical math to the untestable layer.
- **Uniform tile grid (chosen)**: O(1) point query by array index, one-byte writes when
  a breakable clears or a door opens, serialization-free (derived from the seed),
  deterministic, and the same structure the generator and the flow field already need.
  Three subsystems, one data structure.

The static grid does NOT go into `SpatialHash`: a dense array indexed by tile coordinate
is strictly better than a hash for static data (no Map lookup, no insertion churn).
The two-layer story is: dynamic entities in `SpatialHash` exactly as today; static
solids in the tile grid. The one overlap is destructible barrier entities, which live
in both (SpatialHash + EnemyTag pipeline so weapons can hit them; tiles so they block).

### 5.2 The resolver

`src/world/staticCollision.ts` (pure):

```ts
export interface CollisionResult {
  x: number; y: number;
  hitX: boolean; hitY: boolean;   // which axis was blocked (for knockback kill + ricochet)
}

export function resolveCircleMove(
  world: WorldMap, prevX: number, prevY: number,
  nextX: number, nextY: number, radius: number,
  moverKind: MoverKind,               // Player | Enemy | none-membrane rules
  out: CollisionResult,               // caller-owned scratch, zero allocation
): void;

export function raycastSolid(world: WorldMap, x1: number, y1: number,
  x2: number, y2: number): number;    // returns t in [0,1], 1 = clear (DDA walk)

export function isSolidAtWorld(world: WorldMap, x: number, y: number,
  moverKind: MoverKind): boolean;

export function findNearestFreeCircleSpot(world: WorldMap, x: number, y: number,
  radius: number, out: { x: number; y: number }): boolean;  // spiral tile search
```

*(As built, `FEAT-BARRIER-COLLIDE`: five deviations from the signatures above. (1)
`MoverKind` has a third member **`Projectile`** alongside `Player` and `Enemy`, because
section 4's barrier table needs a mover that passes membranes both ways: a field, not
matter. (2) `raycastSolid` takes a **required `moverKind` sixth argument**; without it a
beam could not tell an ability door (clips) from a membrane (passes). It is required
rather than defaulted so an unconsidered caller is a `tsc` error. (3) `isSolidAtWorld`
treats membranes as **solid for `Player`/`Enemy`** while the resolver lets them pass with
`passDirection` — a motionless query has no direction of travel, and spawn legality must
not put anything inside a membrane. That asymmetry is deliberate and pinned by a test.
(4) The substep loop caps at **`MAX_SUBSTEPS = 64`**, one sector width of travel; beyond
that a displacement is a teleport (recall to Hangar), which must snap through
`findNearestFreeCircleSpot` rather than sweep — see `CHORE-COLLIDE-TELEPORT-SNAP`.
(5) **Ungenerated sectors are solid for every `MoverKind`**: this doc never states what
happens at the world's edge, and letting a mover leave it is worse than a wall.)*

Algorithm: axis-separated integration with substepping.

1. Split the frame displacement into substeps so no substep moves more than
   `TILE_SIZE / 2` (20px). Normal movement takes 1 substep; dash
   (`TUNING.player.dashSpeedMultiplier`) or a low-FPS spike takes 2-4. This is the
   entire anti-tunneling story, and invariant 10 pins it.
2. Per substep: move X, test the (at most 2x2, since r=16 < 40) overlapped tiles,
   push out along X on overlap and set `hitX`; then the same for Y. Corner contacts
   resolve against the corner-to-center vector.
3. Axis separation is what produces wall sliding for free: the blocked component dies,
   the tangential component survives. With joystick input this is the difference
   between walls feeling like guides and feeling like glue.

Membrane rule: for `GateClosed` tiles belonging to a `OneWay` edge, the tile counts as
solid only when the substep displacement has a negative dot with the membrane's
`passDirection`. Enemies (`moverKind === Enemy`) treat them as always solid.

### 5.3 Integration points

- **Player + enemies**: `movementSystem` (`src/ecs/systems/MovementSystem.ts:10-22`)
  gains an optional collision context parameter; when expedition mode is active the
  scene passes it and the velocity integration at `:17-18` routes through
  `resolveCircleMove`. When absent (classic mode), the code path is byte-identical to
  today. `clampPlayerToScreen` (`:27`) is simply not called in expedition mode (the
  world-space chunk already removes screen clamping; walls replace it).
- **Knockback**: `processKnockback` (`GameScene.ts:5144-5175`) replaces the screen
  clamp at `:5160-5161` with `resolveCircleMove`, and zeroes
  `Knockback.velocityX/Y` on the blocked axis so enemies do not grind into walls for
  the remaining decay frames.
- **Dash**: no special case. Dash is velocity (`InputController.ts:157-166`), so
  substepping covers it. Dash does not cross any barrier.
- **`phase` upgrade**: explicitly no geometry interaction. It is a damage-avoidance
  proc (`MetaProgressionManager.ts:926-930`); wiring it to walls would be a design
  change nobody asked for. Stated here so a fleet agent does not helpfully add it.
- **Wraiths**: state 1 "phased" wraiths (`GameScene.ts:5111`, `enemy-ai/wraith.ts`)
  ignore walls while phased (ghost fantasy, prevents stuck wraiths) and are snapped
  with `findNearestFreeCircleSpot` on unphase.

### 5.4 Frame budget

Per entity per frame: <= 2 substeps x 2 axes x 4 tile reads = 16 byte-array reads plus
arithmetic. At 120 movers (100+ enemies, player, knockback set) that is ~2k array reads,
microseconds on the Deck. Beams: one DDA each, <= 32 steps. Projectiles: one point
sample each. Zero allocations anywhere: `CollisionResult` and the spot-search output are
caller-owned scratch objects reused per frame (repo pooling rule). The flow field
refresh (section 6) is the only sub-millisecond-scale cost and it is amortized.

---

## 6. Enemy navigation

### 6.1 Choice: one flow field per current sector, steering on top

- **Per-enemy A***: O(enemies x path length), bursty, and 100+ chasers share one
  target. Wrong cost shape.
- **Navmesh**: shines with few agents in large open polys and static geometry. We have
  many agents, small dense sectors, and geometry that mutates (breakables, doors).
  Navmesh rebuild-on-break is the classic perf trap.
- **Flow field (chosen)**: one BFS from the player's tile over 576 tiles, output a
  `Uint8Array(576)` of 8-direction codes (plus an `Unreachable` code). Refreshed when
  the player crosses a tile boundary or every 150ms, whichever first. Every enemy then
  steers by one array read. Cost is O(tiles) once, not O(enemies).

Enemies only simulate in the current sector (section 9), so exactly one field exists.

`src/ecs/systems/enemy-ai/navigation/flowField.ts` (pure, tested):

```ts
export function computeFlowField(tiles: Uint8Array, targetTileX: number,
  targetTileY: number, outDirections: Uint8Array): void;
export function sampleFlowDirection(outDirections: Uint8Array,
  worldLocalX: number, worldLocalY: number): number; // 0-7 direction code, 255 unreachable
```

### 6.2 Wiring: the NavigationContext, null in classic mode

`common.ts` gains a second injected context beside `telegraphManager`
(`common.ts:21-24` is the pattern):

```ts
export interface NavigationContext {
  sampleFlowDirection(x: number, y: number): number;   // 255 = unreachable
  hasLineOfSight(x1: number, y1: number, x2: number, y2: number): boolean; // raycastSolid wrapper
  isSolidAt(x: number, y: number): boolean;
}
export let navigationContext: NavigationContext | null = null;
export function setNavigationContext(ctx: NavigationContext | null): void;
```

Chase-family handlers (chase, swarm, tank, giant, zigzag, glutton, charger approach,
etc.) apply one blend rule: if `navigationContext` is null OR
`hasLineOfSight(enemy, player)` is true, steer exactly as today (direct player vector);
otherwise steer along the flow direction. Classic mode passes null, so classic behavior
is bit-identical: this is the additive-mode guarantee, and it means the change to each
handler is three lines at its steering site. `setEnemyAIBounds`
(`state.ts:18-21`, injected from `GameScene.ts:719`) keeps meaning "current sector
bounds" in expedition mode, so bound-relative patterns keep working unmodified.

### 6.3 Anti-stack and anti-tunnel fallback

Layered, cheapest first:

1. Every enemy runs `resolveCircleMove`, so tunneling is impossible by construction
   (invariant 10) and sliding spreads enemies along wall faces instead of piling into
   them.
2. Existing enemy separation via `SpatialHash` continues to space them out.
3. Stuck detection: an enemy whose net displacement over 1.5s is under 8px while its
   flow direction is valid gets a perpendicular (wall-tangent) nudge impulse. Never a
   teleport (breaks fiction, and teleporting into an off-screen pocket is a bug
   factory).
4. Teleporter enemies check `isSolidAt` + `findNearestFreeCircleSpot` on their
   destination; ghosts keep direct steering but still collide; wraiths per 5.3.

### 6.4 The 14 pure pattern modules, audited

The planners (`bastion-barrage`, `bombard-barrage`, `diviner-barrage`,
`eclipse-barrage`, `helix-barrage`, `obelisk-barrage`, `pulsar-barrage`,
`stalker-barrage`, `tessellator-barrage`, `tremor-barrage`, `exploder-fuse`,
`legion-split`, `telegraphs`, plus boss-phase) are pure plan-producers; geometry is
handled entirely in their consumers. **Zero signature changes for v1.** Per module:

- **Mortar/ground-strike planners** (bastion, bombard, tremor, obelisk ground slams):
  strike points may land on solid tiles. Accepted: a shell wasted on a wall reads
  fine visually and weakens the barrage exactly when the player uses cover, which is
  the point of cover. Contract note recorded in each module's doc comment: "impact
  points are unvalidated against geometry; consumers may filter". Optional later
  polish, not v1: an `isImpactLegal` predicate parameter.
- **Projectile-fan planners** (diviner, eclipse, helix, pulsar, stalker, tessellator):
  unchanged; the enemy-projectile updater clips fan projectiles at walls (section 7).
  Density drops near walls, which is cover working as intended.
- **exploder-fuse**: fuse math is position-free; unchanged. Exploder approach uses the
  chase blend.
- **legion-split**: `legionChildSpawnOffsets` can emit offsets inside walls. The
  CONSUMER (the spawn site in the scene) snaps each child with
  `findNearestFreeCircleSpot`. Planner untouched, its tests untouched.
- **telegraphs**: overlays draw over walls; harmless and arguably good (you see the
  threat through the wall).
- **boss-phase**: position-free; unchanged.

Boss beams (`laserBeamCallback`, `state.ts:29`) clip at walls via `raycastSolid`. The
deeper fix for bosses is upstream: boss arenas are generated mostly open (invariant 6's
area floor), so boss patterns keep the space they were tuned for. Do not make bosses
fight geometry; make the generator give bosses room.

---

## 7. Projectile and weapon interaction

### 7.1 One rule, three behaviors, no 29-weapon retune

Every weapon's wall behavior derives from its delivery archetype, applied at shared
infrastructure, never per weapon:

- **Travels** (a thing flying through space): stops at solid tiles. Implemented once in
  the shared projectile update paths: the ECS player-projectile updater and the enemy
  projectile loop (`GameScene.ts:4331-4369` gains an `isSolidAtWorld` sample beside the
  existing bounds check at `:4342`). Covers ProjectileWeapon, Scattergun, Shuriken,
  HomingMissile, Boomerang, Flail head, Grenade in flight, and all enemy fire.
- **Emanates** (fields, areas, strikes from above): ignores walls entirely. Covers
  AuraWeapon, FrostNova, Pulse, Storm, Meteor, GroundSpike, Mine detonations, elite
  auras, and `detonateArea` (`src/weapons/WeaponManager.ts:828`), which means overkill
  splash, crate bursts, and the volatile-explosion chain
  (`GameScene.ts:3848-3861`) are all untouched. Rationale: splash radii (95-260) are
  small, wall-clipped splash punishes the player unpredictably, and per-target LOS
  checks inside `damageEnemy` (`WeaponManager.ts:513`) would put a raycast on the
  hottest damage path for zero fun.
- **Beams** (instant lines): clipped to first solid via `raycastSolid`, one DDA per
  beam per frame. Covers LaserBeam, FocusBeam, SweepBeam, and enemy/boss lasers.

ChainLightning jumps and orbitals (OrbitingBlades) ignore walls (arcs and anime blades;
LOS per jump is cost without payoff). Melee arcs (Katana, Reaper) ignore walls (range is
tiny). Drone follows the player without collision; Sentry and Guardian placement snaps
via `findNearestFreeCircleSpot`.

### 7.2 The exception table

Exactly three per-weapon exceptions, declared in one place
(`src/world/weaponWallBehavior.ts`, a small map keyed by weapon id) so the rule stays
auditable:

| Weapon | Exception | Why |
| --- | --- | --- |
| RicochetWeapon | bounces off walls (reflect velocity on the `hitX`/`hitY` axis) | its identity is bouncing; walls make it strictly more fun, zero retune |
| RailgunWeapon | beam pierces walls and breakables | its identity is over-penetration; gives it a unique niche in expedition mode instead of a nerf |
| GrenadeWeapon | detonates on wall impact instead of despawning | a grenade vanishing on a wall reads as a bug; detonation preserves its damage budget |

Everything else keeps its archetype default, which is why the other 26 weapons need no
tuning pass. Weapon damage numbers, cooldowns, and `damageEnemy` internals are untouched
by this entire feature.

---

## 8. Spawning legality

One shared helper, used by every placement site: `findNearestFreeCircleSpot`
(section 5.2), plus a reachability check via the flow field (a tile whose flow direction
is not `Unreachable` is connected to the player's region).

- **Enemy spawns**: the expedition spawn director generates candidate points on the
  off-camera ring exactly as the classic spawner does, then filters: snap to free spot,
  reject candidates whose tile is flow-`Unreachable` (sealed pockets, behind closed
  doors), reject candidates outside the current sector. Enemies therefore always spawn
  off-camera AND in the player's connected region. If a walled sector leaves too little
  off-camera ring, the director falls back to aperture mouths of the current sector's
  open edges (enemies pour in through doors, which is exactly the Metroid fantasy).
- **Undiscovered sectors never spawn anything.** Entities exist only in the current
  sector (section 9), and the director never targets a sector the discovery system has
  not marked entered.
- **Destructible clutter** (`spawnDestructible`, `GameScene.ts:3790-3841`): keeps its
  random placement + player-distance retry, with the free-spot snap added; the existing
  `return false` retry contract is preserved.
- **Minions, legion children, necromancer revives, teleport destinations**: every
  consumer of `minionSpawnCallback`, `legionChildSpawnOffsets`, `deadEnemyPositions`
  (`state.ts:73-88`), and teleporter target selection snaps through the same helper.
  One helper, grep-able call sites, no per-system variants.
- **Loot**: gems/pickups spawn at death positions, which are always legal (the dead
  enemy stood there), but splash-scattered drops and crate ejecta snap too so nothing
  lands inside a wall.
- **Hazard zones**: the per-run spawner (`HazardZoneSystem.ts:425-489`) swaps its
  screen-margin rectangle for the current sector's open-tile set (pick a random open
  tile, keep the existing player-exclusion push logic).
- **Boss arenas**: the boss spawns at the arena's anchor tile (generator-guaranteed
  open area, invariant 6). On engage, the sector's edge apertures flip to
  `GateClosed` (reusing door mechanics); on victory they revert. Sealing eliminates
  every mid-boss streaming and spawn edge case by construction.

---

## 9. Streaming and memory

### 9.1 Geometry never streams

All sector tile grids stay resident for the whole session: 576 bytes per sector, ~27KB
for a 48-sector world. This buys: minimap can render any discovered sector, collision
queries never fault, and there is no geometry lifecycle to get wrong. The decision to
stream ENTITIES but not GEOMETRY is the core simplification of this section.

### 9.2 Entities live in exactly one sector

- **Live set**: the current sector simulates fully (enemies, AI, hazards, clutter).
  Neighbor sectors are geometry + door state only, no entities. This keeps the
  entity budget identical to today's single arena: same 100+ enemy scale, same pools,
  same `SpatialHash` occupancy, no new peak.
- **Seam transition**: on crossing an open edge: current-sector enemies and clutter
  despawn to pools (not killed: no XP, no death effects, honoring the
  sprite-then-entity removal order from CLAUDE.md), ground loot despawns (contents
  re-roll per visit, per spine), then the new sector activates: static barriers
  materialize from `SectorDef` minus profile-broken/opened ids, hazard strips spawn,
  the spawn director seeds the sector from its `danger` and biome multipliers, and the
  flow field recomputes once.
- **Exemption**: quest-critical drops registered through the persistence exemption API
  (doc 04's contract, section 11) survive transitions.
- **Boss sectors**: transition is locked during the fight (8's sealing), so the
  despawn/refill path never runs mid-boss.

### 9.3 Pooling implications

Transitions are burst churn by design, so they lean on the repo's existing pooling rule:
enemy sprites, projectiles, damage numbers, and trails all come from the existing pools;
sector activation pre-warms to current caps rather than allocating on first spawn.
The transition itself allocates nothing: despawn-to-pool then acquire-from-pool. The
existing `resetEnemySpatialHash` / per-frame rebuild flow (`SpatialHash.ts:259-263`)
needs no change since the hash is rebuilt from live entities each frame anyway.

---

## 10. Chunk list

Eight individually-shippable work orders. Dependencies reference the world-space
chunks from `01-world-space.md` as WS-* (Transform in world space, camera follow,
sector<->world conversion module). Chunks 1 and 2 have no dependency on WS-* at all and
can ship first. Every chunk leaves classic mode untouched and the game green.

### FEAT-WORLDGEN-CORE
World model + deterministic generator + invariant suite. The map exists and is provably
sound before any pixel moves.
- **Files**: new `src/world/worldTypes.ts`, `src/world/generateWorld.ts`,
  `src/world/sectorInterior.ts`, `src/world/generateWorld.test.ts`; reuses
  `src/utils/dailySeed.ts` (`mulberry32`, `hashStringToSeed`).
- **DONE-CRITERIA**: `generateWorld(seed, inputs)` passes invariants 1-8 (section 3)
  over a 100-seed table in `npm run test`; no game code imports it yet; no Phaser
  import anywhere under `src/world/`.
- **Dependencies**: none.
- **Test surface**: the entire invariant suite; this chunk IS mostly tests plus the
  generator they pin.

### FEAT-BARRIER-COLLIDE
Pure collision math: circle-vs-grid resolver, DDA raycast, free-spot search. The physics
exists and is pinned before it touches the scene.
- **Files**: new `src/world/staticCollision.ts`, `src/world/staticCollision.test.ts`.
- **DONE-CRITERIA**: invariants 9-12 green, including the no-tunneling sweep at dash
  speed (`TUNING.player.dashSpeedMultiplier`); zero allocations in resolver hot path
  (out-param API as specced in 5.2).
- **Dependencies**: FEAT-WORLDGEN-CORE (types only).
- **Test surface**: push-out, corner slide, substep no-tunnel, membrane directionality,
  spiral search legality.

### FEAT-BARRIER-PLAYER
The ship is blocked by something for the first time. Wire the resolver into player and
knockback movement in expedition mode.
- **Files**: `src/ecs/systems/MovementSystem.ts:10-30` (optional collision context;
  classic path byte-identical when absent), `src/game/scenes/GameScene.ts:5144-5175`
  (knockback resolve + blocked-axis velocity zero, replacing the clamp at
  `:5160-5161`), expedition scene setup near `GameScene.ts:719`.
- **DONE-CRITERIA**: in an expedition test map the player slides along walls, cannot
  dash through a 1-tile wall, knockback never embeds an enemy in a wall; classic mode
  plays with no resolver calls (verified by a null-context guard); existing suites
  green.
- **Dependencies**: WS-* (world-space Transform + camera), FEAT-BARRIER-COLLIDE.
- **Test surface**: none new beyond COLLIDE (this is wiring; Phaser-coupled).

### FEAT-BARRIER-PROJECTILE
Walls become cover: projectile/beam interaction plus the three-exception table.
- **Files**: `src/game/scenes/GameScene.ts:4331-4369` (enemy projectile solid sample
  beside `:4342`), the ECS player-projectile updater, a shared beam-clip helper using
  `raycastSolid`, new `src/world/weaponWallBehavior.ts` (exception table),
  `src/weapons/RicochetWeapon.ts` (bounce via `hitX`/`hitY`),
  `src/weapons/RailgunWeapon.ts` (pierce flag), `src/weapons/GrenadeWeapon.ts`
  (impact detonation).
- **DONE-CRITERIA**: enemy fire visibly blocked by walls; travel-archetype player
  projectiles stop; beams clip; auras/splash/`detonateArea` behavior unchanged
  (existing weapon logic tests stay green untouched); ricochet bounces, railgun
  pierces, grenade detonates on impact.
- **Dependencies**: FEAT-BARRIER-PLAYER (expedition scene exists with geometry).
- **Test surface**: `weaponWallBehavior` archetype-mapping table (pure), ricochet
  reflection math (pure). Nothing else: the rest is Phaser-coupled.

### FEAT-WORLDGEN-NAV
Enemies cope with walls: flow field + NavigationContext + chase blend + stuck nudge.
- **Files**: new `src/ecs/systems/enemy-ai/navigation/flowField.ts` + test,
  `src/ecs/systems/enemy-ai/common.ts` (NavigationContext beside `telegraphManager`,
  `:21-24` pattern), steering sites in chase-family handlers (`chase.ts`, `swarm.ts`,
  `tank.ts`, `giant.ts`, `zigzag.ts`, `glutton.ts`, `charger.ts`, `exploder.ts`),
  `src/ecs/systems/EnemyAISystem.ts` dispatcher (stuck detection), teleporter/wraith
  legality snaps.
- **DONE-CRITERIA**: enemies route around a U-shaped wall to reach the player in an
  expedition test map; with `navigationContext` null every enemy-ai unit test passes
  unmodified (bit-identical classic behavior); no enemy embeds in or tunnels through
  a wall during a 5-minute soak with a debug embed-assert counter at zero; the 14 pure
  pattern modules keep their exact signatures and their tests untouched.
- **Dependencies**: FEAT-BARRIER-PLAYER (enemies collide), FEAT-WORLDGEN-CORE.
- **Test surface**: `computeFlowField` (reachability codes, direction correctness,
  unreachable marking), `sampleFlowDirection`, stuck-nudge decision function (pure).

### FEAT-BARRIER-GATES
Interactive barriers: destructible walls, ability/key doors, one-way membranes, hazard
strips, with per-profile persistence.
- **Files**: `src/game/scenes/GameScene.ts:3790-3841` + `:3864` (structural breakables
  reuse the `Destructible` pattern, death clears tiles), new `src/world/barrierState.ts`
  (pure open/break state machine + tile mutation + persistence ids),
  `src/save/GameStateManager.ts:312` (optional `expedition` field) + `:815`
  (`migrateState` goes live for v2), new `WorldProfileState` store on `SecureStorage`,
  `src/systems/HazardZoneSystem.ts` (static strip spawn path).
- **DONE-CRITERIA**: an ability door auto-opens with the ability flag held and stays
  open across save/load and across runs; a broken secret wall stays broken across runs;
  a one-way membrane passes the player one direction and blocks the return; legacy
  saves without `expedition` load exactly as before; save round-trip test green.
- **Dependencies**: FEAT-BARRIER-PLAYER; ability/key id strings from doc 04 (stub ids
  acceptable until doc 04 lands: gates ship functional behind debug-granted flags).
- **Test surface**: `barrierState` transitions (pure), `WorldProfileState`
  round-trip + version-mismatch regeneration, save v1 -> v2 migration (the repo's
  13-file save-test convention applies here).

### FEAT-WORLDGEN-SPAWN
Everything spawns legally: snap + reachability filters, sector-scoped director, boss
arena sealing.
- **Files**: `src/game/scenes/GameScene.ts:3790` (clutter snap), enemy spawn director
  near the spawn-phase curve at `GameScene.ts:4792`, `minionSpawnCallback` /
  legion-child / necromancer-revive / teleporter consumer sites,
  `src/systems/HazardZoneSystem.ts:425-489` (open-tile placement).
- **DONE-CRITERIA**: 10-minute soak in a walled sector with a debug assert counter
  shows zero entities on non-Open tiles and zero spawns in flow-`Unreachable` tiles;
  enemies enter through aperture mouths when the off-camera ring is walled off; boss
  engage seals the sector's edges and victory unseals them.
- **Dependencies**: FEAT-WORLDGEN-NAV (flow field provides the reachability filter),
  FEAT-BARRIER-GATES (sealing reuses door mechanics).
- **Test surface**: candidate-filter function (pure: given tiles + flow field + camera
  rect, returns legal spawn points), aperture-fallback selection (pure).

### FEAT-WORLDGEN-STREAM
Sector transitions with flat entity budget: despawn-to-pool, per-visit re-roll,
persistent structures rematerialize.
- **Files**: expedition transition hook in `GameScene` (on the seam-cross event the
  WS-* camera chunk emits), pool pre-warm on sector activation, persistence-exemption
  API for quest drops.
- **DONE-CRITERIA**: crossing seams 50 times in a soak holds entity and sprite counts
  flat (no leak, verified against pool counters); ground gems do not survive exits;
  broken walls and opened doors rematerialize correctly on re-entry; run save/load
  mid-sector restores the current sector's volatile state; classic mode untouched;
  **a non-adjacent jump (Recall to Hangar, no shared edge between departed and arrival
  sector) deactivates and activates with those same counters flat**, and
  `expedition:sector-entered` fires on arrival with `viaEdgeId: null`.
  The transition path must therefore be written against "leave sector A, enter sector B"
  rather than "cross the edge between A and B": see README section 4.1.
- **Dependencies**: WS-* seam handling, FEAT-BARRIER-GATES, FEAT-WORLDGEN-SPAWN.
- **Test surface**: sector activation planner (pure: `SectorDef` + profile flags ->
  list of barrier/hazard/POI instantiations), transition state round-trip in the run
  save.

Suggested landing order: CORE -> COLLIDE -> (WS-* lands) -> PLAYER -> PROJECTILE ->
NAV -> GATES -> SPAWN -> STREAM. CORE and COLLIDE are pure and can land before or in
parallel with the world-space chunks.

---

## 11. Contracts with the other architects

**World-space (doc 01) must provide, and this design consumes:**
- `SECTOR_WIDTH = 1280`, `SECTOR_HEIGHT = 720` and the pure `sectorToWorld` /
  `worldToSector` conversions exported from ONE module; `worldTypes.ts` imports them
  and derives `TILE_SIZE` from them (never a second copy of the constants).
- A seam-cross event (player's sector coordinate changed) that FEAT-WORLDGEN-STREAM
  subscribes to; the camera never requires geometry outside the resident tile grids
  (which is everything, so this is free).
- `setEnemyAIBounds` (`state.ts:18-21`) keeps receiving current-sector-local bounds in
  expedition mode.

**Discovery/minimap (doc 03):**
- Reads `WorldMap` through a read-only accessor; never mutates it. Sector identity is
  `SectorKey` (`"${sx},${sy}"`); edge identity is `edge:${sxA},${syA}:${direction}`
  (the lexicographically smaller sector names the edge). Discovery state is doc 03's
  to own and persist, keyed by those ids.
- Door/breakable render state comes from `barrierState` queries (open/closed/broken),
  never from re-deriving tiles.

**Quests/powerups/secrets (doc 04):**
- Supplies `abilityGateOrder: string[]` as a STABLE generation input; changing it (or
  any generation input) requires a `WORLDGEN_VERSION` bump, which regenerates worlds
  and best-effort remaps profile flags by id.
- Ability-granting power-ups may be placed ONLY in generator-provided `PoiSlot`s of
  kind `AbilityPowerUp` (solvability, invariant 3, depends on this). Other content
  fills the remaining slot kinds freely.
- Gate satisfaction is checked as "profile holds `requiredId`"; key consumption
  semantics are doc 04's, but a consumed key must never re-lock an already-opened edge
  (`openedEdgeIds` is monotone).
- Quest drops that must survive sector transitions register through the streaming
  exemption API (FEAT-WORLDGEN-STREAM); everything unregistered despawns on exit.
