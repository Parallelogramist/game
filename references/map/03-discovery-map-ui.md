# 03: Discovery State, Live Minimap, and the Map Screen

> **Amended 2026-07-27 by operator decision.** Expedition becomes the **default** run
> mode (the flip ran at `02c4b74` on 2026-07-31; the `?expedition=1` dev route is
> retired), and **Recall to Hangar is a mid-run teleport, not a run
> ending**. Where this document assumes otherwise, `README.md` sections 4.1 and 7 win.


Piece 3 of the expedition-mode feature. Owns: the persisted discovery model, the
evolution of the existing tactical radar into a world-aware minimap, and the new
full-screen `MapScene`. Companion documents: `01-world-space.md` (sector/camera),
`02-worldgen-barriers.md` (WorldMap generation, gates), `04-*` (quests, power-ups,
secrets content). Contracts this document requires from those pieces are collected
in section 11 and are the only cross-piece assumptions made here.

Spine constraints honored throughout: sector = one arena viewport (~1280x720),
world layout is per-profile and seed-deterministic, contents re-roll per run,
discovery persists across runs, expedition mode is additive (the existing arena
run is untouched by every chunk), pure logic is Phaser-free and Vitest-tested.

---

## 1. Discovery state model

### 1.1 Persisted shape

New Phaser-free module `src/expedition/DiscoveryTypes.ts`:

```ts
export const DISCOVERY_VERSION = 1;

/** Bitmask flags. Absent id = 0 = unknown. */
export const SectorFlags = {
  DISCOVERED: 1 << 0,   // on the map as an outline (adjacency peek, fragment, scan)
  VISITED: 1 << 1,      // ship has entered it: full interior renders
  CLEARED_ONCE: 1 << 2, // its combat encounter was cleared in at least one run
} as const;
export const SECTOR_VALID_MASK = 0b111;

export const EdgeFlags = {
  KNOWN: 1 << 0,        // drawn on the map with its gate type
  TRAVERSED: 1 << 1,    // the ship has passed through it
} as const;
export const EDGE_VALID_MASK = 0b11;

export const PoiFlags = {
  SEEN: 1 << 0,         // icon appears on the map
  COLLECTED: 1 << 1,    // permanent POIs only: rendered dimmed with a check
} as const;
export const POI_VALID_MASK = 0b11;

export const SecretFlags = {
  HINTED: 1 << 0,       // "?" marker (scan pulse or proximity trigger)
  FOUND: 1 << 1,        // real icon revealed; FOUND implies HINTED
} as const;
export const SECRET_VALID_MASK = 0b11;

export interface DiscoveryState {
  version: number;              // DISCOVERY_VERSION
  worldSeed: string;            // binds the state to one generated world layout
  sectors: Record<string, number>;
  edges: Record<string, number>;
  pois: Record<string, number>;
  secrets: Record<string, number>;
}
```

Bitmask numbers instead of `{ discovered, visited, ... }` objects, deliberately:
they sanitize with a single `& VALID_MASK`, they keep the JSON payload roughly
one fifth the size of boolean-object records, and the flag implications
(`VISITED implies DISCOVERED`) are one line of arithmetic. The CodexManager
object style is right for entries carrying counters and timestamps; discovery
entries carry none.

**What is deliberately NOT persisted:**

- Per-run state. Contents re-roll per run, so "collected this run" for temporary
  power-ups, "cleared this run", and "objective pin viewed" live in a run-scoped
  `RunDiscoveryOverlay` plain object owned by GameScene expedition state and
  thrown away at run end. The map merges it at render time. Only layout
  knowledge and permanent outcomes (permanent POI collected, secret found,
  sector cleared at least once) persist.
- Gate passability. "Can I open this door" is always derived at render time from
  the edge's gate type plus the currently owned permanent power-ups (contract
  11.2 `isGatePassable`). Persisting it would let stale saves lie.
- Timestamps. Codex needs `discoveredAt` for its "recent discoveries" surface;
  the map has no such surface, so per-entry timestamps are dead weight at this
  entry count. If a later chunk wants them, the version field covers migration.

### 1.2 Storage key, versioning, seed binding

- Storage key: `'survivor-expedition-discovery'`, written through
  `SecureStorage.setItem` (`src/storage/SecureStorage.ts:20`), never raw
  localStorage (CLAUDE.md hard rule).
- The key MUST be appended to `ALL_STORAGE_KEYS` in
  `src/storage/StorageBootstrap.ts:24`; `StorageBootstrap.test.ts` enforces the
  registry, same as every other key.
- Load path mirrors `CodexManager.loadState()` (`src/codex/CodexManager.ts:680`):
  parse inside try/catch; on parse failure, wrong `version`, or `worldSeed`
  mismatch with the active profile's world seed, return a fresh empty state
  (empty records = nothing discovered) and `console.warn`. A seed mismatch is
  not corruption: it is a regenerated world, and old discovery must not graft
  onto it.
- Save path mirrors `CodexManager.saveState()` (`:707`): serialize the whole
  state on every mutation; SecureStorage's 100ms debounced write coalesces the
  burst that happens when entering a new sector reveals several neighbors.

### 1.3 Size budget

Only touched ids are stored (absent = 0), so the payload grows with play, not
with world size. Worst case, fully discovered: with worldgen's stated ceiling of
~300 sectors, ~600 edges, ~900 POI slots, ~120 secrets (contract 11.2), and ids
of the form `s:12,-3` / `e:12,-3|13,-3` (~8 to 18 chars), a fully-flagged state
serializes under ~45 KB before encryption. That is comfortably inside
SecureStorage's envelope and far below the several-hundred-KB codex/meta
payloads already stored. Guard anyway: `DiscoveryManager` refuses to bind a
`WorldMapIndex` whose id universe exceeds 5000 total ids (log + clamp), so a
worldgen bug cannot balloon the save.

### 1.4 Reveal rules

Pure function module `src/expedition/discoveryRules.ts` (Phaser-free, tested).
Each rule takes `(state, worldMapIndex, ...)` and returns a `DiscoveryChanges`
delta; `DiscoveryManager` applies deltas and persists. Rules:

1. **On sector entry** (`revealOnSectorEntry(state, index, sectorId)`):
   - sector gains `VISITED | DISCOVERED`;
   - every edge touching the sector gains `KNOWN` (you can see the doors from
     inside);
   - every sector adjacent through those edges gains `DISCOVERED` (adjacency
     peek: the door tells you something is behind it, Metroid's dotted
     next-room outline);
   - every non-secret POI slot in the sector gains `SEEN`.
2. **On edge traversal** (`revealOnEdgeTraversal`): edge gains
   `TRAVERSED | KNOWN`.
3. **Line of sight: none below sector granularity.** The sector is the fog
   unit. A sector is one viewport, so when you are in it you can see all of it;
   sub-sector fog would cost a per-tile mask and buy nothing. Decision, not an
   open question.
4. **On scan pulse** (`revealOnScanPulse(state, index, originSectorId,
   graphRadius)`): every sector within `graphRadius` edge-hops (BFS over the
   sector graph, pure) gains `DISCOVERED`, connecting edges gain `KNOWN`, and
   secrets in the origin sector gain `HINTED`. The scan item/module itself
   belongs to piece 04; it calls `DiscoveryManager.applyScanPulse`.
5. **On map-fragment pickup** (`revealOnMapFragment(state, index, fragmentId)`):
   the fragment's region (contract 11.2: `fragmentRegions[fragmentId]` is a
   sector-id list) gains `DISCOVERED` on every sector and `KNOWN` on every edge
   both of whose endpoints are in the region. Fragments reveal outlines, not
   interiors: `VISITED` still requires entry, preserving the reason to fly there.
6. **On secret found** (`revealOnSecretFound`): secret gains `FOUND | HINTED`.
7. **Monotonicity invariant** (enforced by every rule and by the sanitizer):
   flags are only ever added, `VISITED implies DISCOVERED`, `TRAVERSED implies
   KNOWN`, `COLLECTED implies SEEN`, `FOUND implies HINTED`.

`DiscoveryChanges` (the delta type) is also the feedback contract (section 7):

```ts
export interface DiscoveryChanges {
  sectorsDiscovered: string[];
  sectorsVisited: string[];
  edgesKnown: string[];
  edgesTraversed: string[];
  poisSeen: string[];
  poisCollected: string[];
  secretsHinted: string[];
  secretsFound: string[];
}
```

### As built (`FEAT-SECRET-HIDDEN-SECTORS`, c242028, 2026-07-31)

The adjacency reveal has one exception. `revealOnSectorEntry` skips a neighbour flagged
`SectorDef.hidden` (and the edge into it) while that neighbour is not yet `VISITED`, so a
concealed sector is drawn neither as an outline nor as a door stub from next door. Entering it
clears the exception permanently, since the same call marks it `VISITED` and marks its own
edges `KNOWN`. `WorldIdUniverse` carries `hiddenSectorKeys` (a subset of `sectorKeys`, not a
new id space, so the `MAX_DISCOVERY_IDS` budget is unmoved), and `getCompletionPercent` now
divides by `getKnowableSectorCount()`: total sectors minus the hidden ones not yet entered,
plus secrets. Numerator and denominator therefore rise together on a find, so discovering a
hidden sector can raise the percentage and can never lower it. `MapScene`'s header reads the
same count, so "N / M SECTORS EXPLORED" cannot leak M. Any future reveal path
(`revealOnScanPulse`, map fragments) must carry the same guard: `CHORE-DISCOVERY-HIDDEN-SCAN-GUARD`.

### As built (`FEAT-POWER-DECRYPTOR-SCAN`, e36b7f6, 2026-07-31)

Rule 4 is built. `revealOnScanPulse(state, map, universe, originSectorKey, graphRadius)` shipped
in the same commit as its producer (the Signal Decryptor's on-entry sweep), so it was never an
inert deliverable. One signature note: it takes the `WorldMap` itself, exactly as
`revealOnSectorEntry` does, rather than this section's hypothetical `index`. There is no
`WorldMapIndex` in this codebase and never was, for the reason the module header already gives.

The guard the block above asked for is implemented and pinned by a test. An unvisited hidden
neighbour is neither charted nor given its edge, and the BFS additionally refuses to expand
*through* one, so no sector on the far side of a breakable wall can be charted around it.
`CHORE-DISCOVERY-HIDDEN-SCAN-GUARD` is discharged.

Only the origin sector's secrets gain `HINTED`, per rule 4 as written: a sweep that pointed at
every secret within the radius would delete hint tiers 1 and 2 in one pass. The sweep grants
neither `VISITED` nor `FOUND`, so it charts outlines and never interiors and
`getCompletionPercent()` cannot move.

Rule 5, `revealOnMapFragment`, is still not built: `fragmentRegions` has no producer anywhere in
`src/`, so building it now would be the inert deliverable rule 4 just avoided being.

No `DISCOVERY_VERSION` bump and no new `DiscoveryChanges` field: the sweep reports through
`sectorsDiscovered`, `edgesKnown` and `secretsHinted`, which already existed.

### As built (`FEAT-SECRET-MAP-FRAGMENT`, 1150f3b, 2026-07-31)

Rule 5 is built. `revealOnMapFragment(state, map, universe, grantedSectorKeys)` takes the
`WorldMap` itself, exactly the `revealOnScanPulse` shape above, not a `WorldMapIndex`.

**There is no `fragmentRegions` table and none was added.** A `biomeId` IS a region:
`assignDangerAndBiomes` assigns one per depth band, so a region is contiguous by construction
and already carries a player-facing name (`getStageById(biomeId).name`, which `secretHints`
already prints in riddles). Contract 11.2 is satisfied by the derived grant in
`src/expedition/mapFragments.ts`, not by stored state; a parallel `Record<fragmentId,
sectorId[]>` would be exactly the duplicate state this module's header already refuses.

A grant is capped at `MAP_FRAGMENT_MAX_SECTORS = 8`, and that number is measured rather than
guessed. Against the live seed 20260727 the world's 48 sectors fall into 5 regions of 5, 16, 18,
8 and 1, so an uncapped "reveal the whole region" would chart 37% of the map from one cache.

Edges gain `KNOWN` only when **both** endpoints are in the grant, per rule 5 as written, so a
fragment never draws a door into a room it did not chart.

The hidden-sector guard is carried twice, once in the chooser and again in the rule, so a grant
assembled anywhere else still cannot chart a concealed room. Dropping an unvisited hidden sector
from the grant also drops every edge into it, since an edge needs both endpoints.

No `DISCOVERY_VERSION` bump and no new `DiscoveryChanges` field: the reveal reports through
`sectorsDiscovered` and `edgesKnown`, which already existed. Nothing grants `VISITED`, so the
reason to fly there survives and `getCompletionPercent()` cannot move.

`FEAT-DISCOVERY-SCAN-FRAGMENT` is fully discharged: both its rules now ship with producers, so
neither is an inert deliverable.

---

## 2. Purity split

### 2.1 Phaser-free, unit-tested modules

**`src/expedition/DiscoveryTypes.ts`**: types and flag constants above. No logic,
no tests needed.

**`src/expedition/discoveryRules.ts`**: the reveal rules of 1.4 plus the
sanitizer of section 9. All pure `(state, index, args) -> DiscoveryChanges` or
`(raw, index) -> DiscoveryState`. Vitest surface: monotonicity, adjacency peek,
BFS radius, fragment edge-endpoint rule, sanitizer corruption cases.

**`src/expedition/DiscoveryManager.ts`**: the persistence manager, mirroring
`CodexManager` structure (singleton via `getDiscoveryManager()`, matching
`getCodexManager()`). Phaser-free (its only dependency is SecureStorage, which
is Phaser-free). API:

```ts
export class DiscoveryManager {
  /** Sanitize stored state against this world's id universe; called once per
   *  profile load and after world regeneration. */
  bindWorld(worldSeed: string, index: WorldMapIndex): void;

  getSectorFlags(sectorId: string): number;
  getEdgeFlags(edgeId: string): number;
  getPoiFlags(poiId: string): number;
  getSecretFlags(secretId: string): number;

  markSectorEntered(sectorId: string): DiscoveryChanges;
  markSectorClearedOnce(sectorId: string): DiscoveryChanges;
  markEdgeTraversed(edgeId: string): DiscoveryChanges;
  markPoiCollected(poiId: string): DiscoveryChanges;
  markSecretFound(secretId: string): DiscoveryChanges;
  applyScanPulse(originSectorId: string, graphRadius: number): DiscoveryChanges;
  applyMapFragment(fragmentId: string): DiscoveryChanges;

  getDiscoveredSectorCount(): number;
  getVisitedSectorCount(): number;
  getCompletionPercent(): number;   // visited sectors + found secrets, weighted

  /** Monotonic counter, bumped on every non-empty DiscoveryChanges. Renderers
   *  compare it to decide whether cached geometry is stale. */
  getRevision(): number;

  /** Mirrors CodexManager.onNewDiscovery (CodexManager.ts:216). */
  onDiscovery(callback: (changes: DiscoveryChanges) => void): void;
}
export function getDiscoveryManager(): DiscoveryManager;
```

Vitest surface: persistence round-trip, seed-mismatch reset, version-mismatch
reset, revision bumping only on real change, completion math.

**`src/visual/mapProjection.ts`**: a NEW SIBLING of `minimapProjection.ts`, not
an extension of it. Reasoning: `minimapProjection.ts` is player-centered polar
radar math (world delta in, disc offset out) with 16 tests and two consumers
(`MinimapManager`, `GameScene.updateMinimap`); it is stable and correct. The map
needs a different projection family: sector-grid space to panel space with pan,
zoom, clamping and hit-testing. Folding both into one module couples the threat
radar to map-screen churn for zero shared code (the only shared concept is
"scale", one multiply). The radar keeps importing `minimapProjection`; the map
screen and the minimap underlay import `mapProjection`. API:

```ts
export interface MapViewTransform { originX: number; originY: number; scale: number }
export interface GridBounds { minGX: number; minGY: number; maxGX: number; maxGY: number }

export const MAP_BASE_CELL_WIDTH = 64;    // px at scale 1, aspect 16:9 to match the sector
export const MAP_BASE_CELL_HEIGHT = 36;
export const MAP_ZOOM_LEVELS = [0.5, 1, 2] as const;

/** Panel-space rect of one sector cell. */
export function sectorCellRect(gridX: number, gridY: number, view: MapViewTransform):
  { x: number; y: number; width: number; height: number };

/** Project a world-space point (via its sector + sector-local offset) into panel space. */
export function worldPointToMap(gridX: number, gridY: number,
  localX: number, localY: number, sectorWidth: number, sectorHeight: number,
  view: MapViewTransform): { x: number; y: number };

/** Clamp origin so the discovered bounding box can never fully leave the panel,
 *  and snap scale to the nearest legal zoom level. Non-finite inputs collapse
 *  to a centered default (mirrors projectToRadar's NaN guards). */
export function clampMapView(view: MapViewTransform, discoveredBounds: GridBounds,
  panelWidth: number, panelHeight: number): MapViewTransform;

/** Center the view on a sector at the given zoom (used on open and "center on ship"). */
export function centerViewOn(gridX: number, gridY: number, scale: number,
  panelWidth: number, panelHeight: number): MapViewTransform;

/** Hit-test a panel-space point (touch/click) to a sector grid cell, with slop:
 *  when the exact cell misses, the nearest cell center within slopPx wins. */
export function mapPointToSector(panelX: number, panelY: number,
  view: MapViewTransform, slopPx: number): { gridX: number; gridY: number } | null;

/** Panel-space anchor + orientation for a door/gate icon on the shared wall. */
export function edgeAnchor(aGridX: number, aGridY: number, bGridX: number, bGridY: number,
  view: MapViewTransform): { x: number; y: number; horizontalWall: boolean };

/** D-pad sector cursor: nearest discovered sector in a 90-degree cone from the
 *  current one; null when none. Pure spatial nav for the map cursor. */
export function nextSectorInDirection(currentGridX: number, currentGridY: number,
  direction: 'up' | 'down' | 'left' | 'right',
  discoveredCells: ReadonlyArray<{ gridX: number; gridY: number }>):
  { gridX: number; gridY: number } | null;
```

Vitest surface: rect math, clamping at all four extremes, zoom snapping,
hit-test slop, edge anchors for horizontal and vertical walls, cone selection
including ties and empty sets, NaN guards.

**`src/expedition/gateGlyphs.ts`**: the gate-type to glyph/shape/label table
(section 8). Pure data plus one lookup with a safe fallback. One Vitest test
asserts every gate type in the worldgen union has an entry (the
`ALL_STORAGE_KEYS` enforcement pattern applied to glyphs).

**As built (FEAT-DISCOVERY-STATE-01 + FEAT-DISCOVERY-HOOKS-03).** The pure half
shipped as three modules: `src/expedition/DiscoveryTypes.ts` (the flag bitmasks,
`DiscoveryState`, `DiscoveryChanges`), `src/expedition/discoveryRules.ts`
(`buildIdUniverse`, `emptyDiscoveryState`, `sanitizeDiscoveryState`,
`revealOnSectorEntry`, `revealOnEdgeTraversal`) and
`src/expedition/DiscoveryManager.ts` (persistence through `SecureStorage` under
`'survivor-expedition-discovery'`, plus the `getDiscoveryManager()` singleton).
Four things differ from section 1.4 above and are deliberate:

- **The rules apply and report.** Section 1.4 describes them as pure
  `(state, index, args) -> DiscoveryChanges`; they instead mutate `state` in
  place and return what that mutation actually added. This makes "re-entering a
  known sector changes nothing" provable from the returned delta alone, and
  removes the second code path in which a manager could double-apply or forget
  to apply.
- **State is bound to `(worldSeed, worldGenVersion)`**, the pair
  `WorldProfileStore` already keys on, rather than to a `worldSeed` string. A
  foreign pair is discarded, never migrated: a different generator names sectors
  that no longer exist.
- **Deferred write paths.** `markSectorClearedOnce`, `markPoiCollected` and
  `markSecretFound` are not implemented because no caller exists yet
  (`FEAT-DISCOVERY-WRITE-PATHS`); `revealOnScanPulse` and `revealOnMapFragment`
  are not implemented because the scan item is `04-*` content and no generator
  emits `fragmentRegions` (`FEAT-DISCOVERY-SCAN-FRAGMENT`). Their flags, their
  records and their sanitizer coverage all shipped, so the persisted shape is
  version-stable and only the writers wait.
- **`viaEdgeId` is derived in `ExpeditionModeAdapter.enterSector`** from the
  previous sector when the two are orthogonally adjacent and their shared edge
  is not a Wall. Because that id rides on the `'expedition:sector-entered'`
  payload, which fires exactly once per crossing, `'expedition:edge-traversed'`
  is **not** emitted as a separate event.

**As built (FEAT-MAPUI-PROJECTION-02).** `src/visual/mapProjection.ts` shipped
with `snapZoomLevel`, `sectorCellRect`, `worldPointToMap`, `centerViewOn`,
`clampMapView`, `edgeAnchor` and `gridBoundsOfCells`. Two functions this section
lists were **not** built: `mapPointToSector` and `nextSectorInDirection`. Their
only consumer is the sector cursor and the focused-sector tooltip, which belong
to `FEAT-MAPUI-DOORS-05`, so shipping them here would have meant two exported
functions with no caller. They are re-filed as `FEAT-MAPUI-CURSOR-HITTEST` and
land with the chunk that calls them. `gridBoundsOfCells` is an addition to this
list, not in it: `MapScene` needs the discovered bounding box to clamp against,
and deriving it inline in the scene would put grid math back in the render
layer. `src/expedition/gateGlyphs.ts` keys its table off `EdgeKind` rather than
inventing a union, because `EdgeKind` **is** the closed gate-type union contract
11.2 asked for; the coverage test beside it goes red when a new border kind has
no glyph or reuses a shape. Both missing functions have since shipped with
`FEAT-MAPUI-CURSOR-HITTEST` (45e7cb2), `mapPointToSector` taking a fifth
`candidates` parameter because the containing-cell test cannot know which cells
are known without it, and both resolving ties by lower `gridY` then lower
`gridX` so no result depends on candidate ordering.

### 2.2 Phaser render layer (not unit-tested)

- **`src/visual/SectorMapRenderer.ts`**: given a `Phaser.GameObjects.Graphics`,
  a `MapViewTransform`, a `WorldMapIndex`, a discovery snapshot, the run
  overlay, and a style config (cell colors, glyph scale, quality tier), draws
  sector cells, walls, edges, POI icons and pins. Both `MapScene` and the
  minimap underlay call it, so the two views can never drift stylistically.
- **`MinimapManager` additions** (section 3) and **`MapScene`** (section 4).
- GameScene wiring: entry/traversal hooks, run overlay, feedback (section 7).

---

## 3. Minimap evolution

### 3.1 Principle: the radar stays a radar

`MinimapManager` (`src/visual/MinimapManager.ts`) keeps its identity: a
player-centered threat disc, 56px base radius, mid-right edge, per-frame blips
fed by `GameScene.updateMinimap()` (`src/game/scenes/GameScene.ts:5578`). The
projection (`projectToRadar`, `MINIMAP_WORLD_RANGE = 900`,
`src/visual/minimapProjection.ts:18`) is untouched, as is blip classification,
the 48-cap stride sampling (`GameScene.ts:5597`,
`MINIMAP_MAX_ENEMY_BLIPS` at `:619`) and rim clamping. In the existing arena
mode nothing changes at all.

In expedition mode the disc gains one thing: a **sector underlay** drawn under
the blips, showing the current sector's walls, its door gaps with gate glyphs,
and dim stubs of discovered neighbors. The numbers make this natural: the
radar's 900px world range on a 1280x720 sector means the disc already spans the
whole current sector plus a fringe of each neighbor. The radar becomes "your
room and its exits" without changing what any existing blip means.

### 3.2 The seam between local radar and world map

Decision: there is **no persistent world-map inset widget**. The radar is the
local map; the full world lives only in `MapScene`. Defense: at 720p the HUD
has exactly one free zone (the mid-right slot the radar already occupies, per
the comment at `MinimapManager.ts:55`), a second widget would either shrink the
radar below blip-legibility or collide with the touch buttons, and it would
duplicate `MapScene` at a size where door glyphs cannot render honestly. The
bridge between the two surfaces is behavioral instead: when a
`DiscoveryChanges` delta contains newly discovered sectors, the radar rim shows
a brief expanding ring pulse plus a small `+N` pill above the disc that decays
after 2.5s, prompting the map open (both suppressed under reduced motion; the
pill then shows without animation).

### 3.3 Drawing and caching

New members in `MinimapManager`:

- `sectorUnderlay: Phaser.GameObjects.Graphics` at depth `MINIMAP_DEPTH + 1`;
  `sweep` moves to `+2` and `blips` to `+3` (constructor lines
  `MinimapManager.ts:62-65`). Blips must stay above walls or a boss behind a
  wall line would lose its pop.
- A circular `GeometryMask` built once from an invisible Graphics circle of the
  radar radius, applied to `sectorUnderlay` only, so wall lines never bleed
  past the disc rim.

The critical cost rule: **walls are drawn in sector-local radar-scaled
coordinates once, and per frame the Graphics is only translated.** The underlay
is rebuilt (clear + stroke paths) only when a `rebuildUnderlay()` is triggered
by: current sector changed, `DiscoveryManager.getRevision()` advanced, gate
passability set changed (permanent power-up gained), or quality/reduced-motion
setting changed. Per frame, `update()` does exactly one
`sectorUnderlay.setPosition(centerX - (playerX - sectorOriginX) * scale + drawnOffsetX, ...)`
where `scale = radarRadius / MINIMAP_WORLD_RANGE`. The existing white center
dot (`MinimapManager.ts:114`) already IS the player marker; the world slides
under it, which is exactly the radar's existing mental model.

Underlay content, in draw order: dim fill wash for the visited current sector
(biome tint at 12% alpha), wall segments (1.5px stroke, 60% alpha), door gaps
left open with a gate glyph centered in the gap for gated edges (glyph from
`gateGlyphs.ts`, drawn at 7px, shape-coded), and for each `DISCOVERED` neighbor
a short dashed stub beyond the door (unexplored tinting: dashed + darker, never
hue alone). Undiscovered neighbors draw nothing: the wall just ends, which is
itself the Metroid tell that something is unmapped.

### 3.4 API additions (additive, arena mode passes null)

```ts
export interface MinimapSectorUnderlay {
  sectorOriginX: number;            // world coords of the sector's top-left (contract 11.1)
  wallSegments: ReadonlyArray<{ x1: number; y1: number; x2: number; y2: number }>;
  doors: ReadonlyArray<{ localX: number; localY: number; gateType: string;
                         passable: boolean; discoveredBeyond: boolean }>;
  biomeTint: number;
}
// MinimapManager
setSectorUnderlay(underlay: MinimapSectorUnderlay | null): void;  // null clears (arena mode)
notifyDiscoveryPulse(newSectorCount: number): void;               // rim ping + "+N" pill
```

`GameScene.updateMinimap()` gains three lines in the expedition branch: on
sector change, assemble the underlay from contract 11.1/11.2 data and call
`setSectorUnderlay`; the per-frame call signature is unchanged.

**As built (FEAT-MAPUI-RADAR-UNDERLAY-06, 492b8f0):** the shipped interface is
`MinimapSectorUnderlay { originX, originY, segments, doors, biomeTint }`, which
differs from the sketch above in three named ways. First, the origin needs both
axes, so `sectorOriginX` became the pair `originX` / `originY`. Second,
`segments` are `WallSegment` records from the new
`src/world/sectorWallSegments.ts` and carry the owning `TileKind`, so the radar
can colour a breakable wall the way the flown world does rather than painting
every wall one colour. Third, a door carries `kind: EdgeKind` plus
`horizontalWall` and `discoveredBeyond`, not `gateType: string` plus
`passable`: `isGatePassable` does not exist yet (it needs `FEAT-BARRIER-GATES`)
and `EdgeKind` is the closed union the generator actually emits, so the radar
and the map screen feed the same `drawGateGlyph`. `setSectorUnderlay` and
`notifyDiscoveryPulse` shipped with the signatures above.

**As built (`FEAT-SECRET-AMBIENT-PING`, 9d8f9c5):** the radar gained one more additive method,
`setSecretPing(intensity: number): void`, fed every frame with the ambient hint strength for
the nearest unfound secret (0 = nothing in range, from the pure `secretPingIntensity` in
`minimapProjection.ts`). The manager clamps it, eases the drawn level toward it at 3/sec so
crossing the radius does not pop, and draws a breakable-amber wash plus ring into the existing
pooled blip Graphics beneath the contacts. It adds no field to `MinimapSectorUnderlay` and
does not change the `update()` signature. Arena passes 0 by construction: `activeSecretCaches`
is only ever populated in expedition mode.

**As built (`FEAT-MAPUI-OBJECTIVE-PIN-RADAR` + the radar half of `CHORE-SECRET-LEAD-RADAR`,
05e832e):** one more additive method, `setWaypoints(waypoints: ReadonlyArray<RadarWaypoint>)`,
fed at 1 Hz by `GameScene.syncRadarWaypoints`. Section 3.2 said the radar is the local view and
the map screen is the world view, with no persistent inset widget between them; a waypoint is
the seam that decision left open, and it stays inside the radar's identity because it is a
bearing, not a map. Resolution is the pure `src/expedition/radarWaypoints.ts`, which takes
sector KEYS rather than a `WorldMap` and returns sector CENTRES: the radar never learns an
entity position, so hint tier 3 keeps being the only thing that marks one. Two drops are the
contract: an uncharted destination and a destination in the ship's own sector, which is section
1.4's reveal rule and the hinted badge's `flags === 0` gate restated for a third surface. Marks
draw into the existing pooled blip Graphics after the contacts (four maximum), so the radar
still costs one draw call, and neither `MinimapSectorUnderlay` nor the `update()` signature
changed. Arena and every other no-map mode feed an empty list on the first line of
`syncRadarWaypoints`, and so does the no-live-player branch of `updateMinimap`, which is what
stops a held bearing being drawn against a (0,0) ship.

**As built (`CHORE-VOID-GAP-RADAR-UNDERLAY`, c2ad058, 2026-08-01):** the underlay now draws the
two impassable tile kinds that are area rather than face. `TileKind.VoidGap` and
`TileKind.SecurityGrid` were invisible on the radar, so a gapped cache pocket and a fenced altar
pocket both read as open floor and the radar implied a room was crossable when it was not. The
new pure `sectorWallSegments.sectorImpassableRects` merges each horizontal run of same-kind
impassable tiles into one `ImpassableRect` (row-major, no vertical merge: a pocket ring is one
tile thick on an axis), `SectorOutline` carries them, and `MinimapSectorUnderlay` gained a
**required** `impassable` field on the `hazardSectorKinds` precedent, so a call site that forgets
it is a compile error rather than a radar that silently keeps drawing a gap as floor.

`isOutlineBlocking` was **deliberately not widened** to cover the two kinds, which is the trap the
chore was filed against: it also feeds `blocksAt`, so a wider predicate would stop every wall face
adjacent to a gap or a fence from emitting its outline, and the room silhouette would break around
exactly the pockets this was meant to reveal. A test in `sectorWallSegments.test.ts` now states
that rather than a comment alone.

Draw order in `rebuildUnderlay` is load-bearing: biome wash, then the impassable patches, then the
wall faces, so a wall face touching a patch still draws on top of it. Each patch is filled at
alpha 0.22 in the kind's own STROKE colour and rimmed in the same at the wall alpha, because the
world FILL of a gap is nearly black and of a fence nearly so, which at 2.5 px per tile would read
as nothing on a dark disc; a chasm therefore reads cyan and a fence pink exactly as they do in the
room. No further wiring was needed for a tripped fence: `tryPhaseCloak` already nulls
`minimapUnderlayKey`, so the patch disappears on the next rebuild. Arena is untouched by
construction, since `syncMinimapUnderlay` returns on its first line when `worldMode.worldMap()` is
null.

**As built (`FEAT-LOCKOUT-RADAR-BEARING`, fdab006, 2026-08-01):** `radarWaypoints.ts` carries a
third kind, `'vault'`, fed by a required `vaultSectorKeys` input and drawn in the ability door's
own violet (`WORLD_GEOMETRY_COLORS.gate.stroke`, `0xaa44ff`), because a vault is what opens one
and `poiGlyphs` already draws it that colour on the chart. It ranks **last** in `KIND_ORDER`
(objective 0, lead 1, vault 2), so under `MAX_RADAR_WAYPOINTS` it can only take a slot no
objective and no lead wanted, and `consider`'s existing `bySectorKey` guard already makes a
sector carrying both a lead and a vault read as the lead. `GameScene.syncRadarWaypoints` feeds it
from `findUnclaimedAbilityVaults` on the same 1 Hz timer, and deliberately does not filter to
abilities that have a LOCKED OUT row: a vault is a permanent profile upgrade whatever it opens
today. The two drops and the arena empty-list contract above are unchanged.

### 3.5 Settings, reduced motion, quality

- The existing toggle (`STORAGE_KEY_MINIMAP = 'settings-minimap-enabled'`,
  `SettingsManager.ts:23`, getter/setter at `:275-281`) keeps meaning "the
  whole disc on or off". Untouched.
- One new toggle: `'settings-minimap-underlay-enabled'` (default true), getter
  `isMinimapUnderlayEnabled()`, built with the full recipe: STORAGE_KEY
  constant, DEFAULTS entry, loadBoolean in the constructor, FocusZone union
  member (`SettingsScene.ts:20` area), a `buildToggleRow` call
  (`SettingsScene.ts:351`), navigator item and keydown handler, plus
  registration in `ALL_STORAGE_KEYS`. Off = pure threat radar even in
  expedition mode, for players who find the walls noisy.
- Reduced motion (`isReducedMotionEnabled()`, already consulted at
  `MinimapManager.ts:154`): suppresses the discovery rim pulse and pill fade;
  the sweep suppression already works and is untouched.
- Visual quality: at the low tier the underlay drops the biome fill wash and
  draws walls as single 1px strokes with no glyph outline halo. The underlay
  never adds glow layers at any tier; it is line work.

---

## 4. The map screen: `MapScene`

New scene `src/game/scenes/MapScene.ts`, key `'MapScene'`, appended to the
scene array at `src/main.ts:164`.

### 4.1 Launch, pause, resume contract

Exactly the SettingsScene overlay pattern (`GameScene.ts:6116`):

```ts
// GameScene, on map-open input (expedition mode only):
this.isPaused = true;
this.scene.launch('MapScene', { returnTo: 'GameScene' });
this.scene.pause();
```

`MapScene.create()` calls `this.input.setTopOnly(true)` (the
`RelicDraftScene.ts:77` guard) and registers
`this.events.once('shutdown', this.shutdown, this)` per the CLAUDE.md scene
rule. Close path: `this.scene.resume('GameScene')` then `this.scene.stop()`
(the SettingsScene return pattern, resume at `SettingsScene.ts:1367`);
GameScene clears `isPaused` in its resume handler, mirroring the settings
return flow. From non-run contexts (ShopScene "review the world" entry, a later
chunk), `returnTo` carries the launching key and the same contract holds.

### 4.2 Does the game pause? Yes.

Decision: the world map always pauses gameplay. Defense: this is a survivors
game; at any interesting moment there are 100+ live enemies, and a map you
cannot afford to read is a map that punishes the exploration loop this whole
feature exists to reward. Metroid pauses on its map for the same reason. The
overlay-pause pattern is already battle-tested here (relic draft, settings),
costs nothing to reuse, and in a purely PvE game "pausing to plan a route" is a
feature, not an exploit. A non-pausing picture-in-picture map is strictly worse
on every input device this game supports.

### 4.3 Pan and zoom

State is one `MapViewTransform` plus `zoomIndex` into `MAP_ZOOM_LEVELS`
(0.5 / 1 / 2). On open: `centerViewOn(currentSector, MAP_ZOOM_LEVELS[1], ...)`.
Every input mutates a candidate view, then `clampMapView` (pure, tested) makes
it legal; the render layer never implements clamping itself.

- **Keyboard**: arrows/WASD pan (held-key repeat via per-frame poll of key
  `isDown`, 420 px/s at zoom 1), `=`/`-` zoom in/out stepping `zoomIndex`, `C`
  centers on the ship, `TAB` toggles the legend, `M`/`ESC` close.
- **Gamepad**: left stick pans freely (analog, same speed curve), `RB`/`LB`
  zoom in/out, `Y` centers on ship, `X` toggles legend, `B`/`Start` close,
  D-pad moves the sector cursor (below), `A` activates the focused element.
- **Touch**: one-finger drag pans; pinch zooms continuously between 0.5 and 2
  (pointer1/pointer2 distance ratio, snapping to the nearest discrete level on
  release so keyboard/gamepad and touch agree on final states); tap = sector
  cursor via `mapPointToSector` with 22px slop; on-screen corner buttons for
  close, legend, center-on-ship (each 48px, section 8).
- **Mouse**: wheel zooms (the `CodexScene.ts:1653` wheel pattern, applied to
  scale), drag pans, click focuses a sector.

**MenuNavigator integration**: `MenuNavigator` (`src/input/MenuNavigator.ts:47`)
drives the chrome row only: `[Center on Ship] [Legend] [Close]` as a 3-column
navigable row with `onCancel` = close. The sector grid itself is NOT a
MenuNavigator surface: the navigator models fixed item lists, and a sparse
sector graph under pan/zoom is not one. D-pad input while the chrome row is
unfocused moves a **sector cursor** using the pure
`nextSectorInDirection` helper; `A` on a cursored sector opens its detail
tooltip (name, biome, doors with gate requirements, collected/total POIs).
A `focusZone: 'chrome' | 'grid'` toggle (the `CodexScene.ts` tabs/cards
pattern) arbitrates, switching via `Up` from the top grid row or `Down` from
the chrome row.

### 4.4 Sector cell anatomy

Cell = 64x36 px at zoom 1 (16:9, matching the sector's real aspect so the map
never lies about shape). Rendered by `SectorMapRenderer` from discovery flags:

- **Unknown (0)**: nothing. The void is the invitation.
- **DISCOVERED only**: dark neutral fill `0x141d2c`, dashed 1px border, no
  interior detail. Reads as "known to exist, never entered" without relying on
  hue (dash vs solid carries the distinction).
- **VISITED**: biome tint fill (palette from contract 11.2) at 35% alpha, solid
  border, interior wall stubs for its notable internal barriers (worldgen
  supplies simplified wall segments; the renderer downsamples to at most 6
  strokes per cell so zoom 0.5 stays clean).
- **CLEARED_ONCE**: a small notch tick in the top-right cell corner (shape, not
  color). The run overlay's "cleared this run" state renders the same notch
  filled solid.
- **Doors**: at each shared wall, `edgeAnchor` places the icon: plain seam =
  simple gap; door = small rectangle; gated = the gate type's shape glyph from
  `gateGlyphs.ts`. Gated doors carry a state ring: lock outline when
  `!isGatePassable(...)`, no ring once passable, and a bright "newly passable"
  ring (section 7) after the enabling power-up is gained. Unknown-side doors
  (edge KNOWN, far sector undiscovered) draw the glyph plus a stub of dashed
  corridor fading to nothing: the classic "here is somewhere you have not
  been".
- **POI icons**: icon-atlas glyphs via `createIcon` (`src/utils/IconRenderer`,
  the ToastManager pattern): permanent power-up, temporary cache, quest
  giver, fragment, shop, etc. (icon keys from contract 11.3). `COLLECTED`
  renders at 40% alpha with a check overlay.
- **Secrets**: `HINTED` = "?" badge in the cell corner; `FOUND` = the secret's
  real icon.
- **Objective pins**: from contract 11.3 `getObjectiveMarkers()`; a pin glyph
  with a slow-pulsing ring (static double-ring under reduced motion), plus an
  `UPDATED` micro-badge until first viewed this run (run overlay state).
- **Player marker**: ship silhouette (reuse the `shipHullGeometry.ts` outline
  path at map scale) positioned by `worldPointToMap` within the current cell
  and rotated to the ship's facing (contract 11.1), so the marker shows both
  where and which way you point.

### 4.5 Legend and the "you cannot open this yet" affordance

The legend (TAB / X / corner button) is a side panel listing every glyph
currently relevant: gate shapes with their requirement names, POI icons, secret
badge, cleared notch, explored/unexplored swatches. It is generated from
`gateGlyphs.ts` and the POI icon table at runtime, so it cannot drift from the
map.

The Metroid moment is specified precisely:

1. Every gated door on the map shows its **gate-type shape glyph** even when
   unreachable, so routes can be planned around known walls.
2. Locked state is the **lock ring**, not a color swap.
3. Focusing the sector (cursor, tap, or hover) surfaces the door line in the
   detail tooltip: glyph + requirement name + the power-up's own icon, e.g.
   `[hex] ION SEAL: requires Ion Projector`, with the requirement name pulled
   from the power-up definition (contract 11.3). If the required power-up type
   has never been SEEN in any codex/vault surface, the line reads
   `[hex] ION SEAL: mechanism unknown`, preserving mystery without lying.
4. When the enabling permanent power-up is acquired, every KNOWN edge of that
   gate type flips to the newly-passable ring and the section 7 toast fires.
   The map is now a to-do list, which is the entire Metroid trick.

**As built (FEAT-MAPUI-MAPSCENE-04).** The MVP that shipped is a subset of the
4.4 cell anatomy: unknown sectors draw nothing, discovered ones a dark fill with
a dashed border, visited ones a biome tint at 35% with a solid border, plus the
cleared-once notch, door glyphs on `KNOWN` non-Wall borders, and the ship marker
rotated to its facing. The legend of this section, the focused-sector tooltip,
the sector cursor, lock rings, POI icons, secret badges and objective pins are
all `FEAT-MAPUI-DOORS-05`. Interior wall stubs wait on `sectorWallSegments`,
which contract 11.2 still lists as unbuilt.

**As built (FEAT-BARRIER-DOOR-READOUT).** Rules 1 and 2 of this section are now shipped, rule
3 is shipped in a different place than specified, and rule 4 is not. Rule 1 (shape glyph on
every KNOWN gated border) landed with FEAT-MAPUI-MAPSCENE-04. Rule 2 (the lock ring) is
`drawGateLockRing` in `SectorMapRenderer.ts`: a ring at `glyphSize * 1.8` in the glyph's own
colour, drawn for an `AbilityDoor` or `KeyDoor` whose requirement the profile does not hold,
and **no ring at all** once it does. The predicate reaches the renderer as
`SectorMapDrawInput.holdsAbility`, so the renderer never learns where ownership is stored.
Rule 3's requirement name is delivered **at the door in world**, not in a focused-sector
tooltip: approaching a sealed ability door raises a `SEALED DOOR` toast naming the ability
(or `Mechanism unknown.` for an unsatisfiable edge, which is this section's `mechanism
unknown` wording moved to the world surface). That deviation is deliberate: the tooltip needs
the sector cursor and the two unbuilt `FEAT-MAPUI-CURSOR-HITTEST` projection functions,
whereas the door itself needs no input model at all, and Metroid teaches at the door rather
than on the map. Rule 4's newly-passable flash and its toast are still unbuilt and stay with
FEAT-MAPUI-DOORS-05. A `KeyDoor` always draws sealed because nothing grants quest keys yet.
The radar underlay draws glyphs but no rings, deliberately: a radar glyph is about 6.7 px and
a ring would smear.

Four decisions worth keeping:

1. **Snapshot at launch, not a live read.** `MapScene` receives the world map
   reference, the player's world position and its facing in its scene data. The
   game is paused while the map is open, so nothing it would poll can change,
   and the scene carries no live cross-scene dependency.
2. **`closeExpeditionMap()` runs before the resume.** `GameScene`'s `resume`
   handler calls `showPauseMenuFromSettings()` whenever the scene comes back
   with `isPaused` still true, which is right for the settings return and wrong
   here. `MapScene.close()` therefore clears `mapOverlayActive` and `isPaused`
   through the new public `GameScene.closeExpeditionMap()` **before**
   `this.scene.resume('GameScene')`, so the run comes back live.
3. **LB is armed only after it is seen released.** A freshly constructed
   `GamepadManager` starts with an all-false previous-button snapshot, so the LB
   still held from the press that opened the map reads as `justPressed` on the
   first frame and would instantly zoom out.
4. **`MenuNavigator` is not used.** The MVP has no chrome row to navigate; it
   arrives with the legend in `FEAT-MAPUI-DOORS-05`. The pause-menu `MAP` row and
   the touch map button of section 5 are filed as `FEAT-MAPUI-PAUSE-ROW`, since
   `PauseMenuManager`'s row count is baked into several parallel arrays and that
   surgery is unrelated to the map itself.

**As built (`FEAT-MAPUI-POI-ICONS`, 12e1779, 2026-07-31).** The 4.4 cell anatomy's POI icons,
its FOUND-secret icon and its dimmed-collected rule now ship, plus a legend. Nine points:

1. **Four of the five `PoiKind`s draw.** `PoiKind.QuestGiver` deliberately draws nothing:
   nothing spawns at a quest-anchor slot yet (`FEAT-QUEST-CHAINS` left them inert), so an
   icon would point at empty floor. It lights up with `FEAT-QUEST-BOARD`, which already owns
   that slot. No separate backlog item was filed for it.
2. **Vector glyphs, not the icon atlas this section names.** `src/expedition/poiGlyphs.ts`
   is a `Record<PoiKind, PoiGlyph>` in the `gateGlyphs.ts` shape (`shape`, `label`, `color`)
   with a closed-union coverage test beside it. The map is one `Graphics` cleared on every
   pan, so `createIcon` sprites would mean creating and destroying a GameObject per slot per
   redraw. Colour groups the family and shape names the thing: a vault is the ability door's
   violet, a found secret the breakable wall's amber.
3. **Icons sit at the slot's real tile centre**, through `worldPointToMap`, the player-marker
   precedent. A sector is 32 x 18 tiles inside a 64 x 36 px cell at zoom 1, so the
   generator's `POI_MIN_SEPARATION` of 3 tiles is 6 px there and 12 px at zoom 2. Zoom 2 is
   the reading zoom; glyph radius is `max(2, 3 * scale)`.
4. **The leak guard is the important line.** A `Secret` slot draws only at
   `SecretFlags.FOUND`. HINTED keeps the corner badge `FEAT-SECRET-LORE` shipped, and an
   unfound, unhinted secret draws nothing, which is why `revealOnSectorEntry` skips secret
   slots when it stamps `PoiFlags.SEEN`. Every other kind needs `PoiFlags.SEEN`, which is
   written only on sector entry, so a DISCOVERED-but-unvisited outline stays empty.
5. **`COLLECTED` renders at 40% alpha with a green check**, this section's rule verbatim.
   Only ability vaults ever set it: `rollPoiContents` re-rolls Treasure and Shrine contents
   per run off `runSalt`, so those icons promise "a cache stocks here each run", never "this
   exact chest is still waiting".
6. **An uncleared vault draws a hazard-orange guard ring**, the colour its core reads
   `GUARDED` in. That is `CHORE-VAULT-GUARD-MAP-MARK`'s chart half, discharged here; the
   radar contact kind stays with `FEAT-DISCOVERY-FEEDBACK-07`. "Not `GUARD_CLEARED` implies
   a pack is still standing" is safe because `referentialIntegrity.test.ts` pins every
   `VAULT_GUARD_PACKS` entry non-empty with per-member `count > 0`.
7. **The legend is a static right-hand panel, not the TAB-toggled one specified above.** It
   is generated from `POI_GLYPHS` and `GATE_GLYPHS` at runtime, so it cannot drift from the
   map, and it lists the two state rings as their own rows. A toggle would need a keyboard
   key, a gamepad button and a touch target: three input paths for 196 px the left-hand
   panels already overlay. Filed as `FEAT-MAPUI-LEGEND-TOGGLE`. The rows carry generic
   labels ("Ability door"), not this section's rule 3 requirement names ("requires Ion
   Projector"), which are filed as `FEAT-MAPUI-LEGEND-REQUIREMENTS`.
8. **Still open on `FEAT-MAPUI-DOORS-05`**: the focused-sector cursor and tooltip (with the
   two unbuilt `FEAT-MAPUI-CURSOR-HITTEST` projection functions), objective pins, and rule
   4's newly-passable ring plus its toast.
9. **No storage key, no version bump, no new discovery writer.** Every flag this chunk reads
   already shipped, so an existing profile lights up the moment the build lands. The renderer
   learns state through two predicates (`poiFlagsOf`, `secretFlagsOf`), matching the
   `holdsAbility` precedent: it never learns where the state is stored.

**As built (`FEAT-MAPUI-DOORS-05` cursor and readout, 45e7cb2, 2026-07-31).** The focused
sector now has a cursor and a readout that names what its doors want. Seven points:

1. **The cursor is four corner brackets, never a fill.** `drawSectorCursor` strokes 28% arms
   into each corner of the focused cell in white, the one value neither glyph table uses. A
   fill or a colour swap would either hide the cell's own icons or repeat a meaning some
   glyph already owns, and shape-over-colour is this map's standing rule (section 4.5 rule 2).
   It draws after the sector loop and before the player marker, so no later cell paints over
   it and the ship still wins the top layer.
2. **Three input paths: hover, tap and the D-pad.** WASD and the arrows stay the chart's pan
   (shipped in `FEAT-MAPUI-MAPSCENE-04`), so rebinding them to the cursor would have taken the
   pan away, and no free key pair was worth spending here. `nextSectorInDirection` gives the
   D-pad a 90 degree cone with an inclusive edge, so a pure diagonal is reachable from both of
   its directions and no charted sector is stranded. The left stick keeps panning. The
   keyboard gap is filed as `FEAT-MAPUI-CURSOR-KEYBOARD`.
3. **The readout is a fixed-height bottom bar, not the floating tooltip this section names.**
   104 px, three `Text` objects created once in `create()` and re-set on focus change rather
   than rebuilt, since a mouse dragged across the chart would otherwise churn GameObjects
   every frame. Fixed height is what lets `panelHeight()` reserve its space: `centerViewOn`
   and `clampMapView` both read that, so the chart centres and clamps **above** the bar and
   can never be scrolled underneath it. A tooltip that follows the cursor would have needed
   its own collision rules against the objectives, leads and legend panels. Portrait wrapping
   is filed as `POLISH-MAP-DETAIL-BAR-PORTRAIT`.
4. **Rule 3's requirement naming, with one deliberate deviation.** An ability door reads
   `requires Blink Drive`, flips to `open to you` once the profile holds it, and a key door
   reads `finish <quest>`. `mechanism unknown` fires when the requirement does not resolve to
   a definition, **not** when a codex surface has never SEEN the ability as this section's
   wording asks. The shipped in-world door toast (`GameScene.reportSealedDoor`) already names
   the ability the moment the ship touches the door, so withholding the same name on the map
   would be an inconsistency rather than mystery. The two branches are deliberately the same
   ones that toast takes, so the map and the door can never disagree about a route.
5. **The leak guard carries over unchanged.** `src/expedition/sectorDetail.ts` is pure and
   Phaser-free, learns state through the same predicates the renderer uses, and obeys the same
   FOUND-only secret rule: an unfound secret contributes nothing and a POI contributes nothing
   until it is SEEN. A readout that named what the chart refuses to draw would be the same
   spoiler by another route. A hinted sector says only "A lead points here", which is the
   sector-level fact the amber corner badge already shows, and adds no position.
6. **This section's rule 4 was already discharged**: the newly-passable ring
   (`drawNewRouteRing`) and its `NEW ROUTES ONLINE` toast shipped with
   `FEAT-DISCOVERY-FEEDBACK-07` (05b2c48). With the cursor and readout landed,
   `FEAT-MAPUI-DOORS-05`'s only remaining criterion is **objective pins**, which stay blocked:
   none of the five shipped quest triggers names a sector to pin to
   (`FEAT-QUEST-TRIGGERS-REST`).
7. **No storage key, no version bump, no new discovery writer.** The cursor is scene state and
   the readout is a projection over discovery flags that already ship, so every existing
   profile lights this up the moment the build lands.

**As built (`FEAT-MAPUI-LOCKOUT-PANEL`, c2ad058, 2026-08-01).** Rule 4's "the map is now a to-do
list, which is the entire Metroid trick" is now delivered **world-wide** rather than only per
door. Every prior piece of it answered for one place: a lock ring on one border, a requirement
clause in one focused sector's readout, a `SEALED DOOR` toast at one door. The question the player
actually asks, what am I missing and what does it open, had no surface at all. A **LOCKED OUT**
panel now sits under LEADS in the left column, listing every traversal ability and quest key the
profile still lacks with the number of KNOWN sealed doors and charted reward sites each would open
and the Chebyshev sector distance to the nearest of them, sorted by what opens the most
(`MAGNO-TETHER · 4 DOORS · 2 SITES · NEAREST 3 SECTORS OUT`). It caps at 4 rows plus `+N MORE`,
the same cap and reason as LEADS, and is absent entirely for a profile locked out of nothing.

The panel is **text and adds no legend row**, which is why it does not touch
`FEAT-MAPUI-LEGEND-REQUIREMENTS`: the legend is already 16 rows at `36 + rows.length * 20 + 8` px
and clamped against `HEADER_HEIGHT`, so one row per distinct per-world requirement could overflow
it on a short viewport. Answering the same question in prose costs no new glyph vocabulary.

The rows come from the new pure `src/expedition/lockouts.ts`, predicate-driven exactly like
`sectorDetail`, so it obeys the same three leak rules and those are correctness rather than taste:
an uncharted sector contributes nothing, an unseen shrine contributes nothing, and an **un-hinted
cache contributes nothing**, because a count carrying a nearest-distance is a position by another
route. A gapped cache is counted at `SecretFlags.HINTED`, the weaker fact the LEADS panel and the
corner badge already admit, never at SEEN (a Secret's id lives in `state.secrets`, not
`state.pois`). Borders are deduped in a `countedEdges` set mirroring
`SectorMapRenderer.drawnEdges`, since every border is reachable from both of the sectors that
share it and an interior door would otherwise count twice.

Two omissions are deliberate. **A false wall gets no row**: it wants a weapon rather than an
ability, so it names nothing the player can go and earn (filed as `CHORE-LOCKOUT-BREAKABLE-ROW`
against the five ships that start on an emanating weapon). **An edge with `requiredId ===
undefined` gets no row**: `SectorMapRenderer.isGatedEdgeSealed` draws it permanently sealed
because nothing can ever satisfy it, and a to-do list should not carry a line that can never be
ticked.

**As built (`FEAT-LOCKOUT-RADAR-BEARING`, fdab006, 2026-08-01).** The panel above named the
problem and never the errand. Every row's last clause is now its **source**, a
`LockoutSource` union on `LockoutRow`, replacing the `NEAREST N SECTORS OUT` clause:
`MAGNO-TETHER · 4 DOORS · 2 SITES · VAULT 3 SECTORS OUT`. Four states, plus two fallbacks:

- `VAULT n SECTORS OUT` (or `VAULT IN THIS SECTOR`), the nearest unclaimed ability vault that
  grants it. It is always reachable **without** the ability it grants, because
  `placeAbilityGates` hosts a vault outside its own gate's subtree by construction, so the row
  can never point at a door the player cannot open.
- `ACTIVE STEP n/m`, the quest that grants the key is accepted and running.
- `BOARD n SECTORS OUT`, the quest is on offer and this is the nearest board the profile has
  seen.
- `ALL OBJECTIVE SLOTS FULL`, the quest is on offer but all three active slots are taken.
- `VAULT NOT CHARTED` / `NO BOARD CHARTED`, the fallbacks when nothing charted starts it.

**The SEEN rule behind them is the same leak rule as the three above, not a new one.** A source
is named only at `PoiFlags.SEEN`, which is written on sector ENTRY and is the exact flag
`SectorMapRenderer` gates a POI icon on, so the panel can never name a place the chart refuses
to draw. Both new scans (`findUnclaimedAbilityVaults`, exported because the radar calls it
directly, and the module-private `nearestSeenQuestBoard`) require it. `NEAREST N SECTORS OUT`
was replaced rather than dropped: two distances on one line read as noise and the source
distance is the actionable one, so `nearestDistance` survives only as the sort tiebreak, below a
new rank that puts an actionable row above an `unfound` one at the same opening count. The
quest state is a caller-supplied `questStateOf` predicate, required rather than optional on the
`MinimapSectorUnderlay.impassable` precedent, because `src/expedition/` never imports
`src/meta/`, where the quest store lives.

### As built (FEAT-SECRET-WALL-MAP-TELL + FEAT-SECRET-GAP-MAP-TELL, d5d012d, 2026-08-01)

The lead badge this section's "secret badge" line names now carries one bit beyond "a lead
points here": a filled amber disc is a lead the ship can walk into, a hollow amber ring is one
whose every open lead is sealed against the profile right now. The rule is
`findSealedLeadSectors` (`src/expedition/secretHints.ts`), pure and fed the same `SecretLead[]`
the LEADS panel draws from, so the two cannot disagree; the shape is `drawLeadBadge`
(`SectorMapRenderer.ts`) and the legend carries one `Lead here` and one `Lead sealed` row,
generated from the same helper the chart calls.

Three decisions worth keeping. (1) **Every, not any.** A sector holding one sealed cache and one
walk-in reads unsealed, because the trip is still worth making. (2) **A void gap is a seal only
while the Magno-Tether is unowned**, which is the same branch `sectorDetail.leadSealSuffix`
takes for its `across a void gap open to you` clause. (3) **A sigil ring is not a seal**: it
costs nothing the player might lack, and `SecretLead.sigils` already hands over the wake order.
Which seal it is stays with the readout and the LEADS panel rather than becoming a third badge
state, per this section's own "two find-shapes sharing one legend row" framing.

---

## 5. Key and binding plan

- **Keyboard: `M`** opens the map. Verified free: no `keydown-M` handler and no
  `addKey('M')` exists anywhere in `src/`. `M` is the genre-wide map key;
  the also-free E/R/T/F/G/H are reserved for future gameplay verbs near WASD.
  Registered in `InputController.setupInput()`
  (`src/game/managers/InputController.ts:359`) following the exact Q-ultimate
  pattern (`:405-408`): store handler, emit `'input-map-requested'`, remove in
  the cleanup block (`:316-322`). GameScene listens and opens only when
  expedition mode is active and no other overlay owns the pause; in arena runs
  the event is ignored, keeping the mode additive.
- **Gamepad: `LB`** (`GAMEPAD_BUTTON_LB = 4`, `src/input/GamepadManager.ts:16`).
  Taken in gameplay already: RB dash, Y ultimate, Start pause, Select auto-buy;
  LB is the free shoulder, reachable without leaving the left stick, and
  shoulder-for-map matches its `LB = zoom-out` role inside the scene (the same
  finger that opened the map operates it). D-pad stays reserved for future
  gameplay quick-slots.
- **Pause interplay**: the map is a sibling overlay to the pause menu, never a
  child. `Start` with no overlay open = pause menu (unchanged); `M`/`LB` with
  no overlay open = map. While the map is open, `B`, `M`, `ESC` and `Start`
  all close it back to live gameplay (a paused player who wants the pause menu
  presses `Start` twice; collapsing map-to-pause-menu chains keeps the scene
  stack one level deep, which every existing overlay assumes). The pause menu
  gains a `MAP` row in expedition runs (`PauseMenuManager.ts`) for
  discoverability on touch, where no free physical button exists; the touch
  HUD also gets a small map button beside the existing action cluster,
  visible in expedition mode only.
- The game pauses while the map is open (defended in 4.2).

---

## 6. Live minimap update budget

Baseline today: `updateMinimap` (`GameScene.ts:5578-5636`) builds up to ~60
entries and `MinimapManager.update` clears one Graphics and fills ~60 circles
per frame. The feature must not change this class of cost while 100+ enemies
are live.

Per-frame budget for everything this document adds, on the Deck at 100+
enemies: **at most 0.3 ms, and zero Graphics path rebuilds on a frame without a
discovery, sector, or gate-set change.** Concretely:

- **Every frame (cheap, unconditional)**: blip redraw exactly as today; one
  `setPosition` on the sector underlay (a translate, no draw); one integer
  compare of `DiscoveryManager.getRevision()` against the cached value; one
  string compare of the current sector id.
- **Only on change (rare)**: underlay rebuild (a few dozen strokes) when the
  revision, sector id, passability set, or relevant settings changed; the
  rim-pulse tween on discovery (one tweened Graphics ring, pooled and reused,
  skipped under reduced motion).
- **Never per frame**: sanitization (bind time only), persistence (SecureStorage
  already debounces writes 100ms), BFS/scan math (event-driven), any
  `DiscoveryChanges` allocation on frames without events (rules return a shared
  empty-changes constant when nothing changed, honoring the frame-cache and
  pooling guidance in `CLAUDE.md`).
- **Entry hooks**: sector entry/edge traversal detection belongs to piece 01's
  sector tracker (contract 11.1 events); this piece only consumes its events,
  so no per-frame position-to-sector math is added here.
- **MapScene**: runs only while gameplay is paused, so it never competes with
  combat. Even so it is event-driven: the sector layer redraws on pan, zoom,
  cursor move or revision change, and idles otherwise (no per-frame redraw; the
  only per-frame work is the MenuBackground tick it inherits from the menu
  chrome pattern).

---

## 7. Feedback moments

All toasts go through the existing `ToastManager`
(`src/ui/ToastManager.ts:48 showToast`, queued, HUD-scaled), matching the
hidden-unlock discovery toast wiring at `GameScene.ts:761-766`. Sounds go
through SoundManager at the call site, per the `ToastConfig.playSound`
deprecation note (`src/achievements/AchievementTypes.ts:286`).

1. **Sector first entry**: NOT a toast (toast-per-room is spam at expedition
   pace). Instead a sector-name banner: small top-center text
   (`makeDisplayText`, `OverlayDepths.HUD_OVERLAY`, fade in/out 1.6s, instant
   text under reduced motion) naming sector and biome, plus the radar
   discovery pulse of 3.2 when the entry also revealed neighbors.
2. **Discovery milestones**: `showMilestoneToast` (`ToastManager.ts:58`) at
   25/50/75/100% map completion, fed by
   `DiscoveryManager.getCompletionPercent()`.
3. **Secret found**: `showToast({ title: 'SECRET FOUND', description: <secret
   name>, icon: <its icon>, color: gold })` immediately, and the map remembers
   `secretsFound` deltas in the run overlay so the next map open plays a
   one-time icon bloom on that cell (skipped under reduced motion).
4. **Map fragment pickup**: `showToast({ title: 'MAP DATA ACQUIRED',
   description: <region name> })`; on the next map open the newly revealed
   outlines cascade in over 400ms in BFS order from the region's entry sector
   (instant under reduced motion). The cascade is presentation only; state is
   already committed.
5. **Objective updated**: piece 04 owns quest toasts; this piece renders the
   pin `UPDATED` badge until viewed (run overlay), so the map never nags twice.
6. **Gate now openable**: on a permanent power-up gain event (contract 11.3),
   compute `newlyPassableKnownEdges = KNOWN edges whose gate type just became
   passable`; when non-empty, `showToast({ title: 'NEW ROUTES ONLINE',
   description: '<n> sealed gates respond to <power-up name>', icon: <power-up
   icon> })` and mark those edges in the run overlay for the newly-passable
   ring until first viewed on the map. This is the loudest moment by design:
   it converts a power-up into an itinerary.

### As built (`FEAT-DISCOVERY-FEEDBACK-07` partial, 05b2c48, 2026-07-31)

Moments 1, 2 and 6 are built. Moment 6 is the whole reason this chunk was worth a session:
`newlyPassableEdges(state, map, universe, gainedId)` shipped in `discoveryRules.ts` (the
signature this section's test-surface line names, taking the `WorldMap` itself as every other
rule here does, since there is no `WorldMapIndex` and never was). It filters to **KNOWN** edges,
which is the correctness invariant: a door the profile has never seen is not an itinerary, it is
a spoiler.

Both permanent-gain sites feed it: `claimAbilityVault` for a traversal ability and the
quest-completion loop for a `grantsKeyId` quest key. The toast reads
`NEW ROUTES ONLINE` / `<n> sealed gate(s) respond(s) to <name>` and is skipped entirely at zero,
so an early claim never promises routes the chart has not drawn.

The run overlay lives on `DiscoveryManager` as a plain `Set<string>` that `saveState` never
touches and `bindWorld` clears, rather than in a new module: it is run state with a per-world
lifetime, and `bindWorld` is already the per-world reset every GameScene create runs.
`MapScene.create` snapshots it and calls `clearNewlyPassableEdges()` immediately, which is what
"until first viewed on the map" means in practice: the rings survive every pan and zoom of that
open and appear on no later one. The ring is `drawNewRouteRing`, the cleared-green at 2.4x the
glyph size, outside the lock ring's 1.8x. The two can never land on one door, since a door keyed
to what was just gained is by definition no longer sealed, and both gain sites add to the owned
set before announcing. It carries a legend row of its own, so the vocabulary stays generated.

Moment 2 is `showMilestoneToast` at 25/50/75/100, driven off `getCompletionPercent()` through
the discovery callback whenever `sectorsVisited` or `secretsFound` is non-empty (exactly the two
numerators; a hidden sector joins the denominator on the same frame it joins the numerator). The
already-reached floor is seeded from the live percent at bind time, so a threshold crossed on an
earlier run never re-toasts and **no storage key was needed to remember it**.

Moment 1 is built with one deliberate deviation: the banner sits **above the bounty line, not
top-centre**. `updateBounties` had already recorded why a centred top line does not fit in
portrait (bars left, world and timer centre, kills and gold right share that band), and
re-deriving that the hard way was not worth the screen. It names biome, sector key and depth,
fades in and out over ~1.6s, and is an instant static line under reduced motion. No animation in
this chunk needs a reduced-motion branch except that one, because the ring and the toasts are
static by construction. Toast queueing is untouched: every line goes through `ToastManager`,
which already shows one at a time.

Moment 5 is built (`FEAT-DISCOVERY-OBJECTIVE-PIN-BADGE`, b75822d). The overlay is a second
`Set<string>` on `DiscoveryManager`, `updatedObjectiveQuestIds`, written by the four sites that
change where an active objective points (a completed step, an activated chain successor, a fresh
run's seeding, a board accept) and read by `MapScene.create`, which snapshots it and clears it on
the spot **before** the pins are built. A completed quest and a set-aside are deliberately not
written: neither leaves a pin or a panel row for the badge to name. The chart draws
`drawObjectiveUpdatedBadge` on the pin, a static disc in the cleared green on its right shoulder
(clear of the CLEARED_ONCE notch and the hint badge), and the OBJECTIVES panel appends
`· UPDATED` to the objective's heading row. The panel half is required rather than cosmetic: a
tagless distinct step, a hazard step with no charted hive and an uncharted destination all
produce no pin, so the chart alone would leave most updates unannounced.

Still open here: moment 3's secret-icon bloom and moment 4's fragment cascade, which are motion
only (both toasts already ship) and need a per-open delta the map does not keep
(`FEAT-DISCOVERY-MAPOPEN-ANIMATIONS`). No `DISCOVERY_VERSION` bump, no new `DiscoveryChanges`
field, no storage key: neither overlay is persisted at all.

---

## 8. Accessibility and readability

- **Gate types are never color alone.** `gateGlyphs.ts` assigns each gate type
  a distinct SHAPE glyph (triangle, hexagon, diamond, square, chevron...),
  a color, and a text label; shape + label carry the meaning, color is
  reinforcement. A Vitest test walks the worldgen gate-type union and fails on
  any type missing a glyph entry or sharing a shape with another type.
- **Colorblind and contrast**: map colors are chosen from the existing
  `MenuStyle` palette and verified under `ColorblindPipeline`
  (`settings-colorblind-mode`, `SettingsManager.ts:27` union). Explored vs
  unexplored is fill + border style (solid vs dashed), cleared is a notch,
  locked is a ring: every state survives grayscale. The existing high-contrast
  setting swaps the map to the high-contrast MenuStyle variants.
- **Text scale**: all MapScene text via `makeDisplayText` sized through
  `computeHudScale(width, height, getSettingsManager().getUiScale())`
  (`src/utils/HudScale.ts:39`); minimum rendered size 12px at 720p, legend and
  tooltip body 14px, sector banner 16px. Phone check: at 375px-wide viewports
  the HUD scale already shrinks toasts, and the map chrome uses the same
  factor; the sector detail tooltip becomes a bottom sheet below 500px width
  so it never occludes the cursored cell.
- **Touch targets**: chrome buttons 48px square minimum; sector taps use
  `mapPointToSector` slop (22px) so zoom 0.5 cells (32x18 px) remain tappable;
  pinch and drag have no minimum-size dependency.
- **Reduced motion** (`settings-reduced-motion`): no sweep (already handled at
  `MinimapManager.ts:154`), no rim pulse animation, no reveal cascade, no icon
  bloom, static objective rings, instant banner text. Every moment still
  happens, only the motion is removed.
- **Quality tiers**: the map screen is pause-time and can afford its look, but
  the minimap underlay obeys the quality setting as in 3.5 (no fill wash, 1px
  strokes at low).

---

## 9. Anti-cheat and integrity

Discovery is a persisted reward surface (completion %, milestone toasts, and a
likely future vault stat), so it gets the full CodexManager treatment:

- **Sanitizer** `sanitizeDiscoveryState(raw: unknown, worldSeed: string,
  index: WorldMapIndex): DiscoveryState` in `discoveryRules.ts`, run on every
  load and on `bindWorld`. It rebuilds each record by iterating the KNOWN id
  universe from `WorldMapIndex` (the `getAllWeaponIds()` pattern of
  `sanitizeWeapons`, `CodexManager.ts:176-196`): junk keys are dropped by
  construction, each stored value must be a finite number and is coerced with
  `Math.trunc(value) & VALID_MASK`, and flag implications are enforced by
  arithmetic (`if (flags & VISITED) flags |= DISCOVERED`, likewise
  TRAVERSED/KNOWN, COLLECTED/SEEN, FOUND/HINTED). A truthy tamper cannot fake
  a flag because only integer bits inside the mask survive.
- **Failure modes**: unparseable JSON, non-object root, `version !==
  DISCOVERY_VERSION`, or `worldSeed` mismatch all yield the fresh empty state
  with a `console.warn`, exactly the `loadState` fallback shape at
  `CodexManager.ts:680-692`. Discovery is regenerable by play; silently
  starting clean is strictly better than propagating garbage.
- **Authority boundary, stated once and honored everywhere**: `DiscoveryState`
  is a lens, never an authority. Traversal legality comes from worldgen's gate
  state plus owned power-ups; rewards come from quest/power-up systems. A
  tampered all-revealed map shows pictures of rooms; it opens nothing, grants
  nothing, and `getCompletionPercent()` is recomputed from sanitized flags on
  every read, never cached into storage.
- **Tests** (the `CodexManager.corruption.test.ts` pattern):
  `discoveryRules.corruption.test.ts` covers junk root, junk records, string
  and float and negative and out-of-mask values, unknown ids, implication
  repair, seed mismatch reset, version mismatch reset, and oversize id-universe
  clamping.

---

## 10. Chunk list

Each chunk leaves the game shippable; arena mode is untouched by all of them.
DONE-CRITERIA are observable outcomes only.

### FEAT-DISCOVERY-STATE-01: discovery model and manager
Value: the persistent memory that makes expedition Metroid instead of roguelike
amnesia, landable before any UI exists.
Files: new `src/expedition/DiscoveryTypes.ts`, `src/expedition/discoveryRules.ts`,
`src/expedition/DiscoveryManager.ts`, tests beside them;
`src/storage/StorageBootstrap.ts:24` (add `'survivor-expedition-discovery'`).
Depends on: contract 11.2 `WorldMapIndex` TYPE only (land against the agreed
interface; a fixture index in tests stands in until 02's generator ships).
DONE-CRITERIA: manager round-trips state through SecureStorage; all reveal
rules and sanitizer cases pass in Vitest; `StorageBootstrap.test.ts` green;
`npm run build` green; zero imports from any Phaser module in the three new
files.
Test surface: discoveryRules (reveal rules, monotonicity, BFS, sanitizer
corruption suite), DiscoveryManager (round-trip, seed/version reset, revision).

### FEAT-MAPUI-PROJECTION-02: map projection math
Value: every later renderer becomes dumb and safe because clamping, hit-testing
and cursor nav are pure and tested first.
Files: new `src/visual/mapProjection.ts` + `src/visual/mapProjection.test.ts`;
new `src/expedition/gateGlyphs.ts` + glyph coverage test.
Depends on: contract 11.2 gate-type union (type-level only).
DONE-CRITERIA: all mapProjection functions of 2.1 exist with tests covering
clamp extremes, zoom snapping, hit slop, edge anchors, cone nav ties, NaN
guards; glyph test fails when a gate type lacks an entry or shares a shape;
`minimapProjection.ts` untouched (its 16 tests unchanged and green).
Test surface: mapProjection, gateGlyphs.

### FEAT-DISCOVERY-HOOKS-03: expedition wiring in GameScene
Value: playing expedition now actually writes the map memory, before any pixel
renders it.
Files: `src/game/scenes/GameScene.ts` (expedition update path near `:5011`;
subscribe in `create()` near the codex/unlock wiring at `:761-790`); new
run-overlay object in GameScene expedition state.
Depends on: FEAT-DISCOVERY-STATE-01; contract 11.1 sector-entry/edge-traversal
events; contract 11.2 live `WorldMapIndex`; contract 11.3 collect/secret/
fragment/scan call sites (04 calls the manager directly, this chunk only wires
GameScene-owned events).
DONE-CRITERIA: entering sectors in an expedition run then reloading the profile
shows persisted flags via `getDiscoveryManager()` in the console; arena runs
write nothing; revision advances only on real change; existing suites green.
Test surface: none new (pure logic already covered by 01; this is wiring).

### FEAT-MAPUI-MAPSCENE-04: the map screen MVP
Value: the first visible payoff, a pannable, zoomable filling-in world map.
Files: new `src/game/scenes/MapScene.ts`; new `src/visual/SectorMapRenderer.ts`;
`src/main.ts:164` (register scene); `src/game/managers/InputController.ts`
(`:359` setupInput M-key emit, cleanup at `:316`); GameScene map-open listener
+ launch/pause wiring (pattern of `:6116`); `PauseMenuManager.ts` MAP row.
Depends on: 01, 02, 03 above; contract 11.1 facing angle.
DONE-CRITERIA: in an expedition run, M and LB open the map with gameplay
paused; visited/discovered/unknown cells render distinctly; pan, zoom, center,
close work on keyboard, gamepad, mouse; B/ESC/M/Start all close back to live
gameplay with `isPaused` cleared; arena runs ignore the binding; scene passes
the shutdown-listener and tween-cleanup rules.
Test surface: none new (all math already in mapProjection).

### FEAT-MAPUI-DOORS-05: doors, POIs, secrets, pins, legend, locked-door affordance
Value: the map stops being a floor plan and becomes a plan: every closed door
advertises what it wants.
Files: `src/visual/SectorMapRenderer.ts`; `src/game/scenes/MapScene.ts`
(tooltip, legend panel, chrome MenuNavigator, sector cursor);
`src/expedition/gateGlyphs.ts` (extend if 02 added types).
Depends on: FEAT-MAPUI-MAPSCENE-04; contract 11.2 gate types + passability;
contract 11.3 POI icon keys, objective markers, requirement names.
DONE-CRITERIA: gated doors show shape glyph + lock ring; focused sector tooltip
names the requirement (or `mechanism unknown`); legend lists every glyph in
play; objective pins render with UPDATED badge cleared on view; POI collected
state dims with a check; glyph coverage test still green.
Test surface: gateGlyphs coverage only (rendering is Phaser-coupled).

### FEAT-MAPUI-RADAR-UNDERLAY-06: world-aware minimap
Value: moment-to-moment orientation, walls and exits under the threat blips,
with the radar's threat identity intact.
Files: `src/visual/MinimapManager.ts` (underlay Graphics + mask, depth
reshuffle at `:62-65`, `setSectorUnderlay`, `notifyDiscoveryPulse`, rebuild
gating); `src/game/scenes/GameScene.ts` `updateMinimap` expedition branch
(`:5578`); `src/settings/SettingsManager.ts` + `SettingsScene.ts` +
`StorageBootstrap.ts` (the `'settings-minimap-underlay-enabled'` recipe of 3.5).
Depends on: FEAT-DISCOVERY-HOOKS-03; contract 11.1 sector origin; contract 11.2
wall segments + door list.
DONE-CRITERIA: in expedition runs the disc shows current-sector walls, door
glyphs and dashed neighbor stubs sliding under the fixed center dot; blips,
48-cap sampling and rim clamping behave exactly as before (arena mode pixel-
identical); underlay rebuilds only on sector/revision/passability/settings
change (assert via a rebuild counter in a dev log); both minimap toggles work
independently; reduced motion suppresses the pulse; existing minimapProjection
tests untouched and green.
Test surface: none new (translation caching is Phaser-coupled; the math it
uses is already tested).

### FEAT-DISCOVERY-FEEDBACK-07: the joy layer
Value: discovery becomes felt, not just stored: banners, pulses, toasts, and
the power-up-to-itinerary moment.
Files: `src/game/scenes/GameScene.ts` (onDiscovery subscription, sector banner,
toast calls beside the unlock-toast wiring at `:761-766`);
`src/game/scenes/MapScene.ts` (reveal cascade, secret bloom, newly-passable
rings); `src/expedition/DiscoveryManager.ts` if completion weighting tuning is
needed.
Depends on: 03, 04, 06; contract 11.3 permanent power-up gain event + fragment
and secret call sites.
DONE-CRITERIA: first entry shows the sector banner; fragment pickup toasts and
cascades on next map open; secret found toasts immediately and blooms on next
map open; gaining a gate-matching permanent power-up toasts `NEW ROUTES ONLINE`
with the correct count and rings those doors until viewed; milestone toasts at
25/50/75/100; all animations replaced by instant states under reduced motion;
toast queueing (one at a time) preserved.
Test surface: newly-passable edge-count computation if extracted pure
(`discoveryRules.newlyPassableEdges(state, index, gateType)`), otherwise none.

### FEAT-MAPUI-TOUCH-A11Y-08: touch and accessibility pass
Value: the map earns phones and every accessibility setting the game already
promises.
Files: `src/game/scenes/MapScene.ts` (pinch, drag inertia clamp, corner
buttons, bottom-sheet tooltip, high-contrast palette hookup, text-scale audit);
`src/visual/SectorMapRenderer.ts` (high-contrast + colorblind-verified colors,
quality tiers).
Depends on: 04, 05, 06.
DONE-CRITERIA: on a touch device (or emulated pointers) drag pans, pinch zooms
and snaps to a discrete level, taps focus cells at min zoom via slop, all
chrome buttons are at least 48px; below 500px width the tooltip presents as a
bottom sheet; high-contrast and all three colorblind modes leave every state
distinguishable (shape/dash/ring audit against section 8); no text renders
under 12px at 720p.
Test surface: none new (pointer handling is Phaser-coupled; slop math already
tested in mapProjection).

Chunk order 01 and 02 are parallel-safe; 03 needs 01; 04 needs 01+02+03; 05, 06
follow 04 and 03 respectively and are parallel-safe against each other; 07
needs 03+04+06; 08 closes.

---

## 11. Contracts required from the other pieces

### 11.1 From `01-world-space.md` (world space and camera)

- `SECTOR_WIDTH` / `SECTOR_HEIGHT` constants (the ~1280x720 viewport sector).
- `getCurrentSectorId(): string` and `sectorWorldOrigin(sectorId): { x, y }`
  (world coords of the sector's top-left), both pure and cheap.
- Events on the GameScene emitter: `'expedition-sector-entered'`
  (`{ sectorId, viaEdgeId | null }`) and `'expedition-edge-traversed'`
  (`{ edgeId }`). This piece never does position-to-sector math itself.
- Player facing angle in radians accessible per frame for the map marker.

### 11.2 From `02-worldgen-barriers.md` (worldgen and barriers)

- `WorldMapIndex`, synchronously available after generation, with STABLE string
  ids across runs of the same seed: `sectors: Record<id, { gridX, gridY, biome,
  name, poiSlotIds, secretIds }>`, `edges: Record<id, { aSectorId, bSectorId,
  gateType }>`, `fragmentRegions: Record<fragmentId, sectorId[]>`, plus
  `worldSeed: string`. Integer `gridX/gridY` on a plane (the map renders the
  graph via grid coordinates). Stated ceilings: ~300 sectors, ~600 edges, ~900
  POI slots, ~120 secrets (the 1.3 size budget and the 5000-id clamp assume
  them).
- `gateType` values drawn from a closed exported union (drives the gateGlyphs
  coverage test).
- `isGatePassable(gateType, ownedPermanentPowerUpIds): boolean`, pure.
- `sectorWallSegments(sectorId)`: simplified sector-local wall segments (px)
  for interior barriers and the outer wall with door gaps, suitable for both
  the minimap underlay and the map cell downsample.
- Biome palette: `biome -> tint` lookup.

**As built: `WorldMapIndex` was never built.** The shipped `WorldMap` in
`src/world/worldTypes.ts` is itself the id universe: `sectors: Map<SectorKey,
SectorDef>` for the sector keys, the canonical `edgeIdFor(sx, sy, direction)`
ids for the borders (the lexicographically smaller sector names the edge, so
both sides produce one string), and `poiSlots` with `PoiKind.Secret` marking the
secret slots. `buildIdUniverse(map)` in `src/expedition/discoveryRules.ts`
derives the four id sets the sanitizer needs from it, skipping `EdgeKind.Wall`
borders. A second parallel index record would be duplicate state, so this
contract is satisfied rather than outstanding. Still unbuilt from the list
above: `isGatePassable`, `sectorWallSegments` and the biome tint lookup, which
are `FEAT-MAPUI-MAPSCENE-04` / `FEAT-MAPUI-DOORS-05` business.

**As built (FEAT-MAPUI-RADAR-UNDERLAY-06, 492b8f0): `sectorWallSegments` is now
built**, in `src/world/sectorWallSegments.ts`. It takes a `SectorDef` rather
than a `sectorId`, for the same reason the note above gives: there is no
`WorldMapIndex`, and `SectorDef` is the id universe. It returns merged
collinear wall runs plus one door anchor per non-Wall border, both in
sector-local px, and out-of-bounds counts as blocking so the one-tile border
ring yields its inner face alone. The biome tint lookup is satisfied for both
map surfaces by `biomeTintFor` in `src/visual/SectorMapRenderer.ts`, which is
derived from `STAGES` rather than a new table. That leaves `isGatePassable` as
the only item from this list still unbuilt.

### 11.3 From `04-*` (quests, power-ups, secrets)

- POI definitions expose `iconKey` (icon-atlas key) and `permanent: boolean`.
- Calls INTO this piece at the moment of effect:
  `getDiscoveryManager().markPoiCollected(poiId)` (permanent collections),
  `.markSecretFound(secretId)`, `.applyMapFragment(fragmentId)`,
  `.applyScanPulse(sectorId, radius)`.
- `getObjectiveMarkers(): Array<{ sectorId, iconKey, label }>` for pins, stable
  within a frame.
- A permanent power-up gain event carrying `{ powerUpId, displayName, iconKey,
  unlocksGateTypes: string[] }` (drives `NEW ROUTES ONLINE` and the
  newly-passable rings).
- Requirement display names per gate type (or per power-up) for the door
  tooltip and legend.

This piece promises back: `DiscoveryManager` as the single write path for all
discovery flags, `DiscoveryChanges` deltas via `onDiscovery` for any system
that wants to react, and read-only flag getters for quest logic that keys off
"has the player found X" (quests must treat them as a lens too, per section 9).
