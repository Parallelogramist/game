# 01: World-Space Core, Camera, and Coordinate Migration

> **Amended 2026-07-27 by operator decision.** Expedition becomes the **default** run
> mode (promoted by `FEAT-EXPEDITION-PROMOTE` after phase 6; it still ships behind
> `?expedition=1` until then), and **Recall to Hangar is a mid-run teleport, not a run
> ending**. Where this document assumes otherwise, `README.md` sections 4.1 and 7 win.


Piece 1 of the Metroid-style explorable-world feature. This document designs everything
required for the play field to stop being the screen: the coordinate model, the moving
camera, the migration of every screen-space call site, world-relative spawning and
culling, the world-aware grid background, the arena/expedition mode seam, and
save/restore for a moving world. Sibling documents (worldgen/barriers, discovery-map UI,
content/quests) build on the contracts in section 12.

Spine decisions honored, not relitigated: sector = one tuned arena viewport; layout is
profile-persistent and seeded while run contents re-roll; expedition is an additive mode
and the arena game stays shippable after every chunk; generation/geometry logic is pure
and unit-tested, Phaser-coupled code is not.

Verified baseline (all line numbers checked against the current tree):

- Camera is static. Every `this.cameras.main` use in `src/game/scenes/GameScene.ts` is
  flash/shake/fade/post-pipeline/centerX-centerY (lines 929, 930, 3313, 3620, 3630,
  3704, 3710, 3870, 5506, 6498, 6504, 8062, 8094, 8145, 8184, 10101, 10118, 10767,
  10770, 10771, 10968). Nothing scrolls, nothing zooms.
- `Transform`/`Velocity` are plain f32 (`src/ecs/components/index.ts:4-15`);
  `movementSystem` integrates without clamping (`src/ecs/systems/MovementSystem.ts:10-22`).
- `src/utils/SpatialHash.ts` (cell 80) has no domain bounds. Already world-safe.
- Mouse aim already uses `pointer.worldX/worldY`
  (`src/game/managers/InputController.ts:140-141,212-213,388-389`). Already camera-safe.
- `src/visual/OffScreenIndicatorManager.ts:90-119` already reads
  `camera.worldView`. Already camera-safe.
- `src/visual/minimapProjection.ts` projects world deltas (entity minus player).
  Already camera-safe; `MinimapManager` graphics are `setScrollFactor(0)` (lines 61-65).
- Zero static/solid collision exists today. Barriers arrive in the worldgen piece.

---

## 1. Coordinate model

### 1.1 Spaces and where each is legal

| Space | Definition | Legal users |
|---|---|---|
| **World** | The one true simulation space. `Transform.x/y`, all ECS positions, all gameplay math, SpatialHash keys, weapon targeting, hazard zone centers, grid force inputs. Origin: top-left of sector `(0,0)`. +x right, +y down. | Everything that simulates. In arena mode world == screen by construction (camera pinned at scroll 0,0), which is why nothing breaks today. |
| **Sector** | Integer grid cell `(col, row)` over world space. Sector `(c, r)` spans world rect `[c*1280, (c+1)*1280) x [r*720, (r+1)*720)`. Purely logical: generation, pacing, discovery, locks. Nothing simulates in sector-local coordinates. | Worldgen layout, discovery map, sector-entered events, sector locks. |
| **Screen (camera viewport)** | Pixels relative to the canvas. | UI/HUD only (`setScrollFactor(0)` objects), post-FX pipeline inputs, camera flash/shake/fade. Never gameplay. |

Sector size is fixed at **1280 x 720 world units** regardless of device orientation or
`Phaser.Scale.EXPAND` growth. Rationale: the entire spawn/pacing/difficulty tuning
(spawn ring offsets 30/50, hazard margins, `MINIMAP_WORLD_RANGE 900`, boss arena
choreography such as `the-machine` center-seeking) was tuned on the 1280x720 landscape
field (`src/GameConfig.ts:31-32`). Making the sector a world constant, not a viewport
mirror, keeps that tuning stable while the viewport varies. In portrait the camera
simply sees a 720-wide slice of the sector; the arena mode is untouched because arena
never consults sector math.

There is **no floating origin and no wrap**. f32 holds integers exactly to 2^24;
capping world extents at `WORLD_EXTENT_LIMIT = 262144` (2^18 px, 204 x 364 sectors)
preserves 1/32 px sub-pixel precision everywhere. The worldgen piece must respect this
cap (section 12).

### 1.2 Pure modules

New directory `src/world/` for Phaser-free world logic (mirrors the existing pure
pattern of `src/visual/minimapProjection.ts`). Unit-tested with Vitest.

**`src/world/worldSpace.ts`**

```ts
export const SECTOR_WIDTH = 1280;
export const SECTOR_HEIGHT = 720;
export const WORLD_EXTENT_LIMIT = 262144;

export interface SectorCoord { col: number; row: number }
export interface WorldPoint { x: number; y: number }
/** Half-open axis-aligned rect in world units: [minX, maxX) x [minY, maxY). */
export interface WorldRect { minX: number; minY: number; maxX: number; maxY: number }

export function sectorOfWorldPoint(worldX: number, worldY: number): SectorCoord;
export function sectorOriginWorld(sector: SectorCoord): WorldPoint;
export function sectorCenterWorld(sector: SectorCoord): WorldPoint;
export function sectorRectWorld(sector: SectorCoord): WorldRect;
export function sectorsEqual(a: SectorCoord, b: SectorCoord): boolean;
/** Canonical string key, e.g. "3,-1". Save files and Maps key on this. */
export function sectorKey(sector: SectorCoord): string;
export function parseSectorKey(key: string): SectorCoord | null;

export function rectWidth(rect: WorldRect): number;
export function rectHeight(rect: WorldRect): number;
export function rectCenter(rect: WorldRect): WorldPoint;
export function rectContains(rect: WorldRect, x: number, y: number): boolean;
/** Inflate by margin on every side (negative shrinks). */
export function inflateRect(rect: WorldRect, margin: number): WorldRect;
export function clampPointToRect(
  x: number, y: number, rect: WorldRect, padding: number
): WorldPoint;
/** The arena/screen rect: (0, 0, width, height). */
export function rectFromScreen(width: number, height: number): WorldRect;
```

**`src/world/spawnRing.ts`** (section 4 semantics)

```ts
import { WorldRect, WorldPoint } from './worldSpace';

export interface EdgeSpawnConfig {
  /** Distance outside the view edge (30 for regulars, 50 for minibosses today). */
  spawnOffset: number;
  /** Inset from the corners along the chosen edge (0 regulars, 100 minibosses today). */
  edgeInset: number;
}

/**
 * Picks a point just outside a view rect, uniformly over four edges, reproducing
 * the exact distribution of the legacy screen-edge switch statements.
 * `random` returns [0, 1); callers pass Math.random, tests pass a seeded stub.
 */
export function pickEdgeSpawnPoint(
  view: WorldRect, config: EdgeSpawnConfig, random: () => number
): WorldPoint;

export function isBeyondLeash(
  x: number, y: number, centerX: number, centerY: number, leashRadius: number
): boolean;

/** Where a leashed regular re-enters: a fresh edge point on the current view ring. */
export function repositionOntoSpawnRing(
  view: WorldRect, spawnOffset: number, random: () => number
): WorldPoint;
```

**`src/world/latticeScroll.ts`** (section 6 support)

```ts
/** floor(scroll / cellSize) * cellSize, correct for negative scroll. */
export function snappedOrigin(scroll: number, cellSize: number): number;

/**
 * Shifts a row-major per-node scalar field by whole cells in place.
 * Vacated cells take fillValue (default 0). Handles shifts >= grid size.
 */
export function scrollLatticeField(
  field: Float32Array, cols: number, rows: number,
  shiftCols: number, shiftRows: number, fillValue?: number
): void;
```

### 1.3 Conversions

- World -> sector: `sectorOfWorldPoint` (floor division; negative-safe).
- Sector -> world: `sectorOriginWorld` / `sectorCenterWorld` / `sectorRectWorld`.
- World -> screen: `screenX = worldX - cameras.main.scrollX` (only inside
  Phaser-coupled code that feeds screen-space consumers; the sole gameplay-adjacent
  consumers are the DistortionPipeline and LightingSystem, section 3).
- Screen -> world: already handled by Phaser (`pointer.worldX/worldY`). No new code.

Nothing else may convert. A gameplay module importing `cameras` to do its own
world/screen math is a design violation; it must consume a `WorldRect` parameter.

---

## 2. Camera

### 2.1 Follow strategy

Expedition mode uses Phaser's built-in follow on the player container
(`this.playerSpaceship.getContainer()`, already registered as the player sprite at
`GameScene.ts:7040-7042`):

```ts
const EXPEDITION_CAMERA = {
  lerp: 0.12,            // per-frame smoothing toward target
  deadzoneWidth: 160,    // no scroll while player stays inside this box
  deadzoneHeight: 120,
};
camera.startFollow(playerVisual, true /* roundPixels */, lerp, lerp);
camera.setDeadzone(deadzoneWidth, deadzoneHeight);
camera.centerOn(playerX, playerY);   // kill the first-frame swoop
```

These numbers are starting points owned by `ExpeditionModeAdapter` (section 7); the
observable requirement is: no visible jitter at maximum dash speed, and the player
never leaves the middle third of the screen during sustained straight-line flight.
Follow math is Phaser-coupled and deliberately not unit-tested (repo convention).

Order-of-update note: `spriteSystem` writes the container position during `update`
(`GameScene.ts:4974`); Phaser evaluates camera follow in the camera `preRender` step,
which runs after all scene updates, so the camera always sees the current frame's
player position. `roundPixels: true` is already set in `GAME_CONFIG`.

### 2.2 Bounds: continuous world, per-sector only under lock

- **Default (exploring):** `camera.setBounds(worldBounds)` where `worldBounds` is the
  generated layout's bounding rect (from the worldgen piece; until it exists, the dev
  flight rect). The world is one continuous plane; sectors are logical partitions, so
  the camera scrolls smoothly across sector edges. **Sector transition is a scroll,
  never a hard cut.** The adapter detects `sectorOfWorldPoint(player)` changes each
  frame and emits `scene.events.emit('expedition:sector-entered', key, coord)` for the
  discovery piece.
- **Sector lock (boss rooms, sealed events):** `lockToSector(sector)` narrows both the
  camera bounds and the gameplay field rect (section 7 API) to `sectorRectWorld(sector)`.
  The camera hard-stops at room edges exactly like a Metroid boss room, and because the
  locked room is precisely one arena-sized viewport, every existing boss behavior
  (`the-machine` center-seeking, minion spawn clamps, boss hazard placement) recovers
  its original tuned geometry. `releaseSectorLock()` restores world bounds.

### 2.3 Surviving FX

- **flash / fadeOut / resetFX** (GameScene 3313, 3630, 3704, 5506, 6498, 6504, 8062,
  8094, 8145, 10101): Phaser camera effects render in camera space. Unaffected by
  scroll. No change.
- **shake** (3620, 3710, 3870, 8184 via `shakeCamera`): implemented as camera matrix
  offset. Unaffected. No change.
- **Post-pipelines** (929-930, 10767-10771, 10968): full-frame passes; Bloom and
  Colorblind are position-free. **DistortionPipeline is the exception**: `addDistortion`
  takes screen-space coordinates and today receives world coordinates (identical under
  a static camera, e.g. `GameScene.ts:3316`). Fix: a GameScene helper
  `addWorldDistortion(worldX, worldY, radius, strength, durationMs)` that subtracts
  `cameras.main.scrollX/scrollY` and forwards; every `addDistortion` call site routes
  through it (grep `addDistortion(` in GameScene and managers when porting).
- **Vignettes / overlays**: the danger vignette (1519, 2632), death darken (6487),
  boss warning (7345, 7370), intro (7713-7792), coach marks (7930-7978), impact flash
  (`src/effects/EffectsManager.ts:337`) and the boss arena overlay
  (`src/systems/BossArenaSystem.ts:108`) are already `setScrollFactor(0)`. They ride
  the camera for free.
- **`cameras.main.centerX/centerY`** (10118-10119): viewport-relative in Phaser 3
  (screen space), and the "WEAPON EVOLVED!" text is already `setScrollFactor(0)`
  (10133). Correct as-is.

### 2.4 Zoom policy

**Zoom is locked at 1 in both modes.** The grid lattice, post-FX tuning, culling
margins and HUD layout all assume unzoomed pixels, and the sector/viewport identity
(spine decision 1) depends on it. The discovery map renders in its own scene/overlay
with its own camera (that piece's design); it must never touch `cameras.main.zoom`.

---

## 3. Migration table

Legend for "when": chunk IDs from section 10. "Stays screen-space (UI)" means the
object is pinned to the camera and is correct in both modes.

### Gameplay clamps and bounds

| Site | Today | New behavior | When |
|---|---|---|---|
| `src/ecs/systems/MovementSystem.ts:27` `clampPlayerToScreen` | Clamps to `(padding .. gameWidth-padding)` | Add `clampPlayerToRect(world, playerId, rect: WorldRect, padding = 16)`; `clampPlayerToScreen` becomes a delegating wrapper (kept so RunnerScene and tests compile). | W2 |
| `GameScene.ts:4946` (caller) | Passes `scale.width/height` | Passes `this.worldMode.fieldRect()`. Arena adapter returns `(0,0,scale.width,scale.height)`: byte-identical. Expedition: world bounds rect (barriers later refine inside it, section 12). | W2 seam, W4 semantics |
| `GameScene.ts:5160-5161` knockback clamp | Clamps enemies to `[0,W]x[0,H]` | Clamp to `fieldRect` via `clampPointToRect(x, y, rect, 0)`. Arena identical. | W2 |
| `GameScene.ts:719` and `10793` `setEnemyAIBounds(scale.width, scale.height)` | Rect implied as `(0,0,w,h)` | New `setEnemyAIFieldRect(rect: WorldRect)` in `src/ecs/systems/enemy-ai/state.ts`; `setEnemyAIBounds(w,h)` kept as wrapper for rect `(0,0,w,h)`. Callers pass `fieldRect`. Refresh on lock/release and resize. | W2 |
| `src/ecs/systems/enemy-ai/state.ts:15-21` `gameBoundsWidth/Height` | Two globals defaulting 1280/720 | Replaced by a `fieldRect` global (min/max). Consumers rewritten: `charger.ts:79` margin-30 test against min/max; `teleporter.ts:63-64` clamp 20 inside min/max; `the-machine.ts:40-41` seeks `rectCenter(fieldRect)`, `:91-92` minion clamp 80 inside min/max. Arena values identical. Note: `the-machine` is a boss and bosses only run sector-locked in expedition (section 12), so its "center" is always a sector center. | W2 |

### Spawning (details in section 4)

| Site | Today | New behavior | When |
|---|---|---|---|
| `GameScene.ts:7047-7089` `spawnEnemy` edge switch | Random screen edge, offset 30 | `pickEdgeSpawnPoint(viewRect, {spawnOffset: 30, edgeInset: 0}, Math.random)` + spawnability filter. Arena viewRect == screen: identical distribution. | W5 |
| `GameScene.ts:7235-7252` `spawnMiniboss` edge switch | Random screen edge, offset 50, inset 100 | `pickEdgeSpawnPoint(viewRect, {spawnOffset: 50, edgeInset: 100}, Math.random)`. | W5 |
| `GameScene.ts:8554-8555` `spawnBoss` at `(W/2, -100)` | Screen top center | Arena unchanged. Expedition: bosses spawn only under sector lock at `(lockedRect center x, lockedRect.minY - 100)`. | W6 |
| `GameScene.ts:8607-8654` `spawnBossHazard` | Random within screen margins 100 | Positions within `fieldRect` (locked sector) with the same 100 margins; `void_wyrm` branch (8626-8634) is already player-relative, only add a `fieldRect` clamp. | W6 |
| `GameScene.ts:3790-3798` `spawnDestructible` | Random interior, padding 70 | Random interior of `viewRect`, padding 70, same player-distance rejection. | W5 |
| `GameScene.ts:3985-3996` `spawnShrine` | Random interior, padding 90 | Random interior of `viewRect`, padding 90, same retry loop. (The content piece may later pin shrines to world POIs; this keeps the drop-in behavior.) | W5 |
| `GameScene.ts:4226-4227` `completeBounty` fallback position | `scale/2` when no player | `rectCenter(viewRect)`. | W5 |
| `GameScene.ts:1418` player spawn `(scale/2)` | Screen center | Arena unchanged. Expedition: `sectorCenterWorld(startSector)` from the layout. | W4 |
| `src/systems/HazardZoneSystem.ts:425-489` `updateHazardSpawner(..., screenWidth, screenHeight)` | Spawns inside screen margins, clamps to screen | Signature becomes `updateHazardSpawner(deltaSeconds, gameTime, playerX, playerY, view: WorldRect)`; all margin/clamp math against `view`. Caller `GameScene.ts:4856` passes `viewRect`. Arena identical. | W2 |

### Culling and lifetime (details in section 5)

| Site | Today | New behavior | When |
|---|---|---|---|
| `src/ecs/systems/SpriteSystem.ts:27-58` | `spriteSystem(world, screenWidth, screenHeight)`, cull `[-50 .. W+50]` | `spriteSystem(world, view: WorldRect)`, cull `inflateRect(view, 50)`. Caller `GameScene.ts:4974` passes `viewRect`. | W2 |
| `src/ecs/systems/XPGemSystem.ts:385-390, 39, 417-427` | `xpGemSystem(world, dt, screenWidth, screenHeight)`, cull margin 100 | `xpGemSystem(world, dt, view: WorldRect)`, cull `inflateRect(view, 100)`. Caller `GameScene.ts:4953`. | W2 |
| `GameScene.ts:4323-4346` enemy projectile despawn | Outside `[-20 .. W+20]` | Outside `inflateRect(viewRect, 20)`; the 4 s lifetime cap (4316) is unchanged. | W2 |

### Visual systems

| Site | Today | New behavior | When |
|---|---|---|---|
| `src/visual/GridBackground.ts:127-143` (window size), `149-166` (resize), `186-203` (rest positions), `631-669` (render) | Screen-window lattice at world==screen | View-aware windowing via `setViewScroll(scrollX, scrollY)`; section 6. Arena: method never called, rendering path byte-identical. | W4 |
| `GameScene.ts:3319-3320` grid forces (and every `applyExplosiveForce`/`applyDirectedForce` caller) | Pass world coords (== screen) | Unchanged call sites; GridBackground converts world -> lattice-local internally once view-aware. | W4 |
| `GameScene.ts:10606-10638` gravity point feed | Enemy/player world coords | Unchanged; same internal conversion. | W4 |
| `src/visual/ParallaxBackground.ts:38-53` | `setScrollFactor(0)` layers driven by player position (`GameScene.ts:4987-4988`) | No change. Input stays the player's world position in both modes (passing camera center would alter arena visuals, where the camera never moves but the player does). | none |
| `src/visual/LightingSystem.ts:38-39, 83` + light feed `GameScene.ts:10652-10668` | Screen-sized light map drawn at world coords (== screen) | Pin `lightGraphics` with `setScrollFactor(0)`; convert each light `x - scrollX, y - scrollY` at draw time inside `LightingSystem.update()` (scene camera is available; arena scroll is 0,0 so identical). | W4 |
| `GameScene.ts:3316` + all `addDistortion` call sites | World coords into a screen-space pipeline | Route through `addWorldDistortion` helper (section 2.3). | W4 |
| `src/visual/MinimapManager.ts` | Player-centered world-delta radar, pinned (61-65) | No change. `MINIMAP_WORLD_RANGE 900` still means 900 world px. The discovery piece extends the minimap separately. | none |
| `src/visual/OffScreenIndicatorManager.ts:90-119` | `camera.worldView` based | No change. Becomes genuinely useful once the camera moves. | none |
| `src/visual/DepthLayers.ts` | Depth registry (`OverlayDepths.MINIMAP` 1895) | No change; depths are camera-independent. | none |

### UI surfaces (all "stays screen-space (UI)")

Everything below must be `setScrollFactor(0)`. Already pinned: MinimapManager (61-65),
OffScreenIndicatorManager (64), JoystickManager (170-187), TouchActionButtons (77-194),
PracticeDock (220), TooltipManager (169), MasteryIconEffectsManager (67, 89),
SceneTransition (42, 59), EffectsManager impact flash (337), and the GameScene inline
overlays listed in section 2.3. **Not pinned yet** (harmless today because the camera
never scrolls; mandatory before it does):

| Site | Today | New behavior | When |
|---|---|---|---|
| `src/game/managers/HUDManager.ts` (78 `scene.add.*` sites; only 712, 733, 1896, 1902 pinned) | Positioned in screen coords, unpinned | Pin every HUD element (HP/XP bars, timers, kill counter, boss health bars, upgrade icons, pace delta, etc.). Route creation through a small `pinToCamera(gameObject)` helper to make the invariant greppable. | W3 |
| `src/ui/ToastManager.ts` (9 add sites, none pinned) | Same | Pin all. | W3 |
| `src/game/managers/PauseMenuManager.ts` (only 1758 pinned) | Same | Pin all. | W3 |
| Any straggler found by the W3 sweep (grep `scene.add.`/`this.add.` across `src/ui/`, `src/game/managers/`, GameScene UI blocks; verify against depth >= HUD band) | | Pin. | W3 |

Full-screen scene overlays that run as **separate scenes** (UpgradeScene,
RelicDraftScene, MarketScene, PauseMenu's containing scene UI, SettingsScene, all 21
scenes registered in `src/main.ts:164`) each have their own default camera at scroll
(0,0) and are unaffected. No change.

### Input and misc

| Site | Today | New behavior | When |
|---|---|---|---|
| `src/game/managers/InputController.ts:117-141, 211-213, 388-389` | `worldX/worldY` | No change; already camera-correct. | none |
| `GameScene.ts:2112` `restoreGameState` | Rebuilds at screen coords | Mode-aware restore, section 8. | W7 |
| `GameScene.ts:4572` auto-save cadence | ~10 s timer | No change to cadence; payload changes in section 8. | W7 |
| `GameScene.ts:10788` `handleResize` | Re-sizes grid, HUD, AI bounds | Additionally: re-apply camera deadzone and re-derive `viewRect` consumers; in expedition, camera bounds are world-derived and need no resize work. | W4 |
| `src/systems/BossArenaSystem.ts:96-108` overlay | Screen-sized, pinned | No change (UI). | none |
| `src/utils/SpatialHash.ts` | Unbounded hash | No change. | none |
| `src/ecs/systems/CollisionSystem.ts` and weapon targeting | Distance math on world coords | No change. | none |

---

## 4. Spawning in world space

**Principle: the spawn ring is camera-relative, never sector-relative.** Enemies spawn
just outside what the player can see, exactly as far away as they do today, so the
existing director pacing (`pickEnemyFromDirector`, spawn intervals, credit budget) is
untouched: same distances to close, same time-to-contact, same on-screen density. The
view rect is the same size as the arena screen (zoom locked at 1), so "edge of view"
in expedition is geometrically identical to "edge of screen" in arena.

- `spawnEnemy` / `spawnMiniboss` call `pickEdgeSpawnPoint(viewRect, config, Math.random)`
  with their existing offsets (30 / 50) and insets (0 / 100). The pure function
  reproduces the legacy four-way switch distribution exactly (unit test pins this
  against the arena rect).
- **Off-sector / out-of-world prevention:** after picking a point, the spawner asks
  `this.worldMode.isSpawnableWorldPoint(x, y)`. Arena adapter: always true. Expedition
  adapter: true when inside `worldBounds` and permitted by the worldgen layout hook
  (section 12; until barriers land, bounds-only). On false, retry up to 4 times with
  fresh edges, then skip the slot (mirrors the existing "director saved credits" skip
  at `GameScene.ts:7056-7059`, so a skipped slot is already a supported outcome).
- **Sector locks:** while locked, the spawn ring still surrounds the camera, but the
  camera is bounded inside the sector, and `isSpawnableWorldPoint` rejects points
  outside the locked sector, so spawns squeeze to the room like the arena does today
  when the boss seals the fight.
- Interior placements (destructibles, shrines, hazards, bounty fallback) move from
  screen interior to `viewRect` interior with identical paddings, so their perceived
  frequency-near-the-player is unchanged.
- Boss entrances stay choreographed: only under sector lock, at the locked rect's top
  center (section 3), so the entrance cinematics (`showBossEntrance`, warning overlay,
  arena tint) play over the same relative geometry as today.

---

## 5. Culling and lifetime

Viewport culling becomes camera-view culling with the **same margins** (`CULL_MARGIN`
50 for sprites, 100 for gems, 20 for enemy projectiles): the visible area does not get
bigger (zoom is 1), so per-frame visible-entity counts and render cost match the arena
baseline exactly. The rect just moves.

New in expedition, the **leash**: the player can now fly away from enemies, which the
arena never allowed. Without a rule, live enemies accumulate behind the player and the
director's pressure evaporates while the entity count climbs.

- `LEASH_RADIUS = 1600` world px from camera center (comfortably beyond the 900 px
  radar range and the ~735 px view half-diagonal, so nothing visible or radar-tracked
  pops). Constant lives in `src/world/spawnRing.ts`.
- Each frame (reusing the existing frame cache, `getFrameCacheEnemyIds`), regular
  enemies beyond the leash are **repositioned** onto the current spawn ring via
  `repositionOntoSpawnRing` (Vampire-Survivors-style), preserving both the entity
  budget and the pressure. No despawn, no director refund logic, no XP loss.
- Exempt from the leash: bosses, minibosses, the nemesis (`NemesisTag`), destructibles,
  and anything under sector lock (locked rooms are small; the leash cannot trigger).
- XP gems, pickups, consumables: never repositioned. Off-view gems already cost nothing
  (`XPGemSystem` culling) and the existing `MAX_GEMS = 300` cap plus batch merge
  bounds memory. A gem left three sectors back is simply a reason to fly back
  (Metroid instinct), and `magnetizeAllGems` (vacuum consumable) still collects it.
- Hazard zones expire on their own duration timers; enemy projectiles keep the 4 s
  lifetime plus view-rect despawn. No change needed.

Entity caps stay exactly as tuned today (director credits, `MAX_GEMS`, pool sizes),
because the effective simulation neighborhood is still one camera view plus a 1600 px
halo, the same order of magnitude as the arena.

---

## 6. GridBackground in world space

Constraint: the spring lattice (`src/visual/GridBackground.ts`) is sized to the screen
plus one cell (127-143), simulates hundreds of point masses, and its whole look
(gravity wells under entities, explosion ripples, chromatic aberration, perspective
projection around screen center, quality tiers, dirty-flag sleep) is tuned and must not
regress. Simulating a world-sized lattice is out of the question.

Design: **the lattice stays a screen-sized window, and the window slides over the
world**, snapping in whole cells so grid lines appear world-anchored.

New API on `GridBackground` (Phaser-coupled, untested; the index math is pure and
tested via `latticeScroll.ts`):

```ts
/** Expedition only. Called once per frame before update() with camera scroll. */
setViewScroll(scrollX: number, scrollY: number): void;
```

Behavior:

1. `originX = snappedOrigin(scrollX, CELL_SIZE)`, likewise Y. The lattice's world
   anchor is always a whole-cell multiple, so rendered lines coincide with the world's
   fixed 40 px grid: to the player the grid is part of the world, not a screen filter.
2. When the snapped origin changes by `(dc, dr)` cells, shift the per-node displacement
   state by `(-dc, -dr)` via `scrollLatticeField` so in-flight ripples and warps stay
   pinned to their world positions: applied to the displacement deltas
   (`posX[i] - restX[i]`, same for Y/Z) and velocities (`velX/velY/velZ`), then
   positions are rebuilt as `rest + delta`. Vacated border cells enter at rest.
   Border pinning (`inverseMass = 0`, lines 197-200) is reapplied by index, so the
   immovable ring stays at the window edge exactly as today.
3. The graphics object gains a sub-cell offset `-(scrollX - originX), -(scrollY - originY)`
   folded into the existing ambient-drift graphics transform (the drift offset already
   moves the whole canvas, lines 71-74), with the graphics pinned via
   `setScrollFactor(0)` in expedition. Net effect: pixel-exact world anchoring with
   zero per-node cost between snaps.
4. All world-coordinate inputs (`setGravityPoints` at `GameScene.ts:10638`,
   `applyExplosiveForce`, `applyDirectedForce`) are converted internally by subtracting
   `(originX, originY)`. Call sites do not change.
5. **Arena mode: `setViewScroll` is never called and `setScrollFactor` is never
   touched.** Origin stays (0,0), offset stays drift-only, no field shifts: the render
   path is byte-identical to today, including the `resize()` path (149-166) and every
   quality tier (perspective projection still uses the window center, 123-134, which
   is still the screen center).

Parallax (`ParallaxBackground`) needs nothing: it is already `setScrollFactor(0)` and
driven by player world position, which keeps working when the world grows (section 3).

---

## 7. Mode flag and coexistence

### 7.1 The flag

`GameScene.init(data)` (line ~700) gains `runMode?: 'arena' | 'expedition'`, default
`'arena'`. Every existing entry point (menus, daily, practice, gauntlet, restore
without the field) yields arena. Until the operator promotes the mode, expedition is
reachable only through a dev route (`?expedition=1` URL param checked in a dev-only
branch, no menu surface, no SettingsScene entry), so shipping any chunk never exposes
an unfinished mode.

### 7.2 `WorldModeAdapter`: the single seam

`src/game/world/WorldModeAdapter.ts` (interface), `ArenaModeAdapter.ts`,
`ExpeditionModeAdapter.ts`. Phaser-coupled by design (they own the camera); everything
clever inside them delegates to the pure `src/world/` modules.

```ts
import { SectorCoord, WorldRect } from '../../world/worldSpace';

export type RunModeKind = 'arena' | 'expedition';

export interface WorldModeAdapter {
  readonly kind: RunModeKind;

  /** After the player entity + visual exist (create() and restoreGameState()). */
  setupCamera(playerVisual: Phaser.GameObjects.Container): void;

  /** World rect the camera sees this frame. Arena: (0,0,scale.width,scale.height). */
  viewRect(): WorldRect;

  /** Legal playfield for clamps and AI bounds. Arena: same as viewRect. */
  fieldRect(): WorldRect;

  /** Player start position for a fresh run. Arena: screen center. */
  playerStartPoint(): { x: number; y: number };

  /** Spawn filter. Arena: always true. */
  isSpawnableWorldPoint(x: number, y: number): boolean;

  /** Boss/sealed rooms. Arena: no-ops. */
  lockToSector(sector: SectorCoord): void;
  releaseSectorLock(): void;

  /** Per-frame, called once from GameScene.update() before spawners run:
   *  sector-change detection + event emit, grid setViewScroll, leash pass,
   *  AI field rect refresh when lock state changed. Arena: no-op. */
  update(deltaSeconds: number): void;
}
```

GameScene keeps a `private worldMode: WorldModeAdapter`, constructed in `init()`.
The migration replaces screen-literal expressions with `worldMode.viewRect()` /
`worldMode.fieldRect()` calls at exactly the call sites in section 3, and nothing else.
`viewRect()`/`fieldRect()` return a reused mutable rect (no per-frame allocation),
matching the repo's pooling discipline.

### 7.3 The byte-identical guarantee for arena

- `ArenaModeAdapter` methods return exactly the expressions the code uses today:
  `viewRect = fieldRect = (0, 0, this.scene.scale.width, this.scene.scale.height)`;
  `setupCamera`, `lockToSector`, `update` are empty; `playerStartPoint` is
  `(scale.width/2, scale.height/2)`.
- Every refactor in W2 is parameter-threading: the rect parameter receives the same
  numbers the removed literals produced, verified by unit tests on the pure functions
  (`pickEdgeSpawnPoint` over `rectFromScreen(1280, 720)` reproduces the legacy edge
  switch; `clampPlayerToRect` over the screen rect equals the old clamp formula for a
  grid of probe points).
- W3 (UI pinning) is a visual no-op while the camera is static, which is precisely why
  it must land while the camera is still static.
- The camera is only ever touched by `ExpeditionModeAdapter.setupCamera`; no arena code
  path can acquire scroll.
- `RunnerScene` (which reuses `setEnemyAIBounds` etc., see `RunnerScene.ts:7`) keeps
  compiling and behaving via the retained wrapper functions.

---

## 8. Save/restore

Current machinery: `src/save/GameStateManager.ts`, `SAVE_VERSION = 1` (line 43),
`GameSaveState` (line 312), validator rejects `version > SAVE_VERSION` (line 519),
writer stamps the version (line 706), `migrateState()` is a documented stub (line 815).
Auto-save ~10 s (`GameScene.ts:4570-4575`) plus beforeunload/visibilitychange; restore
at `GameScene.ts:2112`. Entity transforms are already serialized as absolute
coordinates, which simply become world coordinates: no per-entity format change.

### 8.1 Schema change (version 2)

```ts
// GameSaveState additions (both optional):
runMode?: 'arena' | 'expedition';
expedition?: {
  /** Integrity check against the profile's persistent world (worldgen piece owns
   *  generation; layout itself is re-derived from the seed, never serialized here). */
  worldSeed: number;
  currentSectorKey: string;
  cameraScrollX: number;
  cameraScrollY: number;
  /** Present while a sector lock is active (sectorKey). */
  sectorLockKey?: string;
  // Sibling pieces append namespaced optional sub-blocks here
  // (e.g. questState?, barrierRuntime?); adding optional fields does not
  // require another version bump.
};
```

### 8.2 Version strategy

- `SAVE_VERSION` becomes 2 (the ceiling the validator accepts).
- **Arena runs keep writing version 1 with today's exact payload** (no `runMode`
  field). Hard requirement so a client rollback never orphans an arena save, and
  provable: serialize an arena run before and after the chunk, payloads differ only in
  `timestamp`.
- Expedition runs write version 2 with `runMode: 'expedition'` and the `expedition`
  block.
- `migrateState()` gets its first real body: v1 input returns unchanged (v1 is the
  arena dialect of v2; the restore site reads `state.runMode ?? 'arena'`). The stub's
  documented pattern (line 816-818) is followed literally.
- Rollback behavior: an old client reading a v2 expedition save rejects it at the
  existing validator line 519 and starts fresh. One mid-run expedition save lost on a
  rollback, zero corruption, arena saves unaffected.

### 8.3 What a mid-run refresh must restore for a moving world

In `restoreGameState` (2112), ordered:

1. Read `runMode ?? 'arena'`, construct the matching adapter **before** any rect
   consumer runs (`setEnemyAIFieldRect` replaces the current implicit screen bounds).
2. Expedition: hand `expedition.worldSeed` to the worldgen module to re-derive the
   layout; on seed mismatch with the profile (corrupt/foreign save) fall back to a
   fresh run, mirroring the existing `load()` failure path (`GameScene.ts:731-734`).
3. Restore entities (existing path; transforms are world coords).
4. `worldMode.setupCamera(playerVisual)` then set `scrollX/scrollY` exactly from the
   save (not just `centerOn(player)`: deadzone drift means the saved camera is not
   necessarily player-centered, and an off-by-a-deadzone snap on refresh is visible).
5. Re-engage `sectorLockKey` if present (camera bounds + field rect + boss arena
   overlay re-activation is already handled by the existing boss-restore path).
6. Grid: `setViewScroll` once before the first render so frame 1 is anchored.

Orientation flips already round-trip through this exact machinery
(`main.ts:178-194` -> `handleOrientationFlip` -> save/restore), so expedition
inherits orientation-flip support from W7 with no extra code.

Discovery accumulation, permanent power-ups and the profile-persistent world layout are
**not** part of `GameSaveState` (a run save): they persist at profile level through
`SecureStorage` under keys owned by the discovery and worldgen pieces (section 12).

---

## 9. Risk register

| # | Risk | Guard |
|---|---|---|
| R1 | Arena behavior drifts during the W2 threading refactor (the live game breaks subtly). | Every W2 change is parameter-threading with the arena rect equal to the removed literals; unit tests pin pure replacements to legacy formulas (section 7.3); W2's done-criteria include a full arena run (spawn cadence, boss fight, knockback at edges) and the arena save-payload diff check (section 8.2). |
| R2 | An unpinned HUD/overlay object silently rides the world the first time the camera scrolls (UI flies off-screen). | W3 lands the pin sweep while the camera is still static (zero visual risk), routed through one greppable `pinToCamera` helper; W4's done-criteria include a dev-only display-list audit in expedition (warn on any object at HUD depth bands with `scrollFactor != 0`). |
| R3 | f32 precision decay far from origin (jittery movement, broken sub-pixel rendering). | `WORLD_EXTENT_LIMIT = 262144` enforced as a worldgen contract (section 12); at that extent f32 retains 1/32 px. No floating origin needed, so no machinery to break. |
| R4 | Lattice field scrolling bugs (ripples smearing, index corruption at window edges) regress the game's signature visual. | The index math is isolated in pure `scrollLatticeField` with tests (positive/negative shifts, shifts >= grid size, border refill); GridBackground itself only rebuilds `pos = rest + delta`. Arena path provably untouched (method never called). |
| R5 | Spawn ring places enemies out-of-world or, once barriers exist, inside sealed space. | All spawns route through `isSpawnableWorldPoint` (single choke point, section 4); retry-then-skip semantics reuse an already-supported skip path. Worldgen implements the hook against its layout (section 12). |
| R6 | Expedition saves poison older clients after a rollback. | Arena saves stay v1 byte-identical; v2 is rejected wholesale by the existing validator (line 519) and falls to a fresh run. No partial reads possible. |
| R7 | Mid-run refresh flashes the wrong world region or snaps the camera. | Restore order in section 8.3: adapter first, exact scroll restore (not centerOn), grid anchored before first render. Done-criteria for W7 include refresh-during-flight and refresh-during-boss-lock. |
| R8 | Camera jitter or one-frame player/camera disagreement. | Phaser follow evaluates in preRender after `spriteSystem` writes the container; `roundPixels` already on; deadzone absorbs micro-corrections. Verified by W4's max-speed flight criterion. |
| R9 | Resize/orientation flip mid-expedition breaks viewRect consumers or the deadzone. | `handleResize` (10788) re-applies deadzone; viewRect always derives from live camera scroll + scale; orientation flip reuses the W7 save/restore round trip (section 8.3). |
| R10 | Per-frame cost creep (leash scan, rect plumbing, grid shifting). | Leash reuses the existing frame cache (one pass, squared distances); rect getters return pooled rects; field shifts occur only on whole-cell snaps (a few per second at max speed) and are `Float32Array` copies over ~600 nodes. FPS counter (existing setting) comparison is a W4 done-criterion. |
| R11 | Open-world (unlocked) behavior of arena-tuned AI: `the-machine` seeks a "center", teleporter clamps to bounds. | Contract: bosses spawn only under sector lock in expedition (section 12), so center-seeking AI always has a room. Non-boss consumers (charger, teleporter) degrade safely to the world rect (clamps become slack, behavior stays sane) and are exercised in W5 playtesting. |
| R12 | The 11k-line GameScene grows another tangle of `if (expedition)` branches. | The adapter interface is the single seam; section 3 is the closed list of touch points; review criterion for every chunk: no `runMode` string comparison outside `init()`, the adapter constructor and the save writer. |

---

## 10. Chunk list

Dependency order: W1 -> W2 -> W3 -> W4 -> W5 -> W6, W7 (W6 and W7 are independent of
each other). Every chunk leaves the arena game shippable and unchanged; W4 onward also
leaves the dev-route expedition playable at its current depth.

### FEAT-WORLD-SPACE-1: pure world-space kernel
**Value:** the tested mathematical vocabulary (sectors, rects, spawn ring, lattice
scroll) every other world chunk imports; zero game-code risk.
**Files (as shipped):** new `src/world/worldSpace.ts`, `src/world/spawnRing.ts` +
`*.test.ts` beside them, and `src/game/scenes/GameScene.ts` (the three edge-spawn switches
in `spawnEnemy` / `spawnMiniboss` / `spawnNemesis` now call `pickEdgeSpawnPoint` over
`rectFromScreen(scale.width, scale.height)`, arena-identical). Wiring the call sites here
rather than deferring them to W2 is deliberate: it lands the kernel with a real consumer
instead of as an unimported module. `src/world/latticeScroll.ts` moved to W4, its only
consumer.
**DONE-CRITERIA:**
- All APIs from sections 1.2 exist with the documented signatures; `npm run test` green.
- Tests cover: negative sector coords, points exactly on sector boundaries,
  `sectorKey`/`parseSectorKey` round-trip and malformed-key rejection,
  `pickEdgeSpawnPoint` reproducing the legacy edge distribution over
  `rectFromScreen(1280, 720)` with a seeded random stub (matches the switch at
  `GameScene.ts:7138-7159` before this chunk landed) and leash predicates.
  `scrollLatticeField` moved to W4 with the module.
- `npm run build` green; the only importer is `GameScene`'s spawn path, and `src/world/`
  imports neither Phaser nor anything from `src/systems/` or `src/game/`.
**Dependencies:** none. **Test surface:** everything in the chunk (all pure).

### FEAT-WORLD-SPACE-2: rect-parameterized gameplay seams (arena-identical)
**Value:** removes the screen==world assumption from every gameplay system while the
game provably keeps playing exactly as before; the load-bearing refactor happens while
it is still cheap to verify.
**Files:** `src/ecs/systems/MovementSystem.ts:27` (+`clampPlayerToRect`),
`src/ecs/systems/enemy-ai/state.ts:15-21` (+`setEnemyAIFieldRect`),
`src/ecs/systems/enemy-ai/charger.ts:79`, `teleporter.ts:63-64`,
`the-machine.ts:40-41,91-92`, `src/ecs/systems/SpriteSystem.ts:27-33`,
`src/ecs/systems/XPGemSystem.ts:385-427`, `src/systems/HazardZoneSystem.ts:425-489`,
`src/game/scenes/GameScene.ts` call sites 719, 4323-4346, 4856, 4946, 4953, 4974,
5160-5161, 10793. Introduces `WorldModeAdapter` + `ArenaModeAdapter` +
`this.worldMode` (arena-only so far) in `src/game/world/` and `GameScene.init`.
**DONE-CRITERIA:**
- Grep proof: no remaining `scale.width`/`scale.height` reads at any section-3
  "gameplay" row (UI rows exempt); the listed systems accept `WorldRect`.
- Unit tests: `clampPlayerToRect` over the screen rect equals the legacy formula for
  boundary probe points; enemy-ai field rect wrapper defaults to `(0,0,1280,720)`.
- A full arena run (regular spawns, miniboss, boss + hazards, knockback at all four
  edges, gem magnet/vacuum) plays with no observable difference; existing suites green.
- `RunnerScene` compiles and plays unchanged via the retained wrappers.
**Dependencies:** W1. **Test surface:** `clampPlayerToRect`, enemy-ai rect state
module (pure), rect helpers; Phaser call-site threading is verified by play, not tests.

### FEAT-WORLD-SPACE-3: pin every UI surface to the camera
**Value:** makes the entire HUD/overlay layer camera-proof while the camera is still
static, converting the riskiest visual failure mode of a moving camera into a no-op.
**Files:** `src/game/managers/HUDManager.ts` (78 creation sites),
`src/ui/ToastManager.ts`, `src/game/managers/PauseMenuManager.ts`, plus a sweep of
`src/ui/*`, `src/game/managers/*`, GameScene inline UI (most already pinned, section 3
UI table); new `pinToCamera` helper in `src/visual/` or `src/ui/OverlayKit.ts`.
**DONE-CRITERIA:**
- Grep proof: every UI-band creation site routes through `pinToCamera` or carries an
  explicit `setScrollFactor(0)`.
- Arena screenshot comparison of the full HUD (HP/XP, boss bar, toasts, pause menu,
  minimap, touch controls) shows no pixel movement vs. main.
- Existing suites green.
**Dependencies:** none (may land in parallel with W2). **Test surface:** none (all
Phaser-coupled; the arena no-op property is the safety net).

### FEAT-WORLD-SPACE-4: expedition camera + world-anchored visuals (dev route)
**Value:** the first flyable world: camera follows the ship across a multi-sector
plane with the signature grid, lighting and post-FX intact; proves the whole
coordinate model end to end behind a dev-only entrance.
**Files:** new `src/game/world/ExpeditionModeAdapter.ts` (follow/deadzone/bounds,
sector-entered events, `update()` loop); `GameScene.init` dev route + `runMode`
data field; `GameScene.ts:1418` (start point via adapter), 10788 (deadzone on
resize); `src/visual/GridBackground.ts` (`setViewScroll`, internal world->lattice
conversion, pinned graphics in expedition); `src/visual/LightingSystem.ts:38-83`
(pin + scroll conversion); GameScene `addWorldDistortion` helper + rerouted
`addDistortion` call sites (3316 et al.).
**DONE-CRITERIA:**
- Dev route (`?expedition=1`) starts an expedition run on a temporary bounded flight
  rect (e.g. 5x5 sectors) with the player at the start-sector center; normal menus
  and every arena entry are bit-for-bit unchanged.
- Flying at max speed in all directions: camera follows with deadzone, no jitter,
  player stays in the middle third; camera stops at world bounds.
- Grid lines are world-anchored (a line does not slide relative to a stationary
  destructible while flying past), ripples from kills stay where the kill happened,
  chromatic/perspective/quality tiers verified at all three settings.
- `expedition:sector-entered` fires exactly once per boundary crossing (logged).
- Distortion shockwaves and lighting glows track their world sources while scrolling.
- FPS counter shows no regression vs. an arena run with comparable entity load.
- Arena run unchanged (spot check); suites green.
**Dependencies:** W1, W2, W3. **Test surface:** `latticeScroll` already tested in W1;
adapter and GridBackground wiring are Phaser-coupled (play-verified).

### FEAT-WORLD-SPACE-5: camera-relative spawning + leash
**Value:** combat in the moving world with arena-identical pacing: pressure follows
the camera, nothing accumulates behind the player, nothing spawns out of bounds.
**Files:** `GameScene.ts:7047-7089` (spawnEnemy), 7235-7252 (spawnMiniboss),
3790-3798 (spawnDestructible), 3985-3996 (spawnShrine), 4226-4227 (bounty fallback),
all through `pickEdgeSpawnPoint` / `viewRect` / `isSpawnableWorldPoint`; leash pass in
`ExpeditionModeAdapter.update()` using `src/world/spawnRing.ts` and the frame cache.
**DONE-CRITERIA:**
- Arena: spawn behavior statistically unchanged (edge distribution test from W1 keeps
  pinning the pure function; a timed arena run shows the familiar cadence).
- Expedition: enemies stream from the view edges while flying; stopping in any sector
  reproduces arena-like pressure; flying away then returning shows no enemy pileup
  behind (leash repositions regulars; a marked miniboss is still where it was).
- No spawn ever lands outside world bounds (assert-log during a long dev flight).
- Suites green.
**Dependencies:** W2, W4. **Test surface:** `pickEdgeSpawnPoint`,
`repositionOntoSpawnRing`, `isBeyondLeash` (already from W1; extended cases here).

### FEAT-WORLD-SPACE-6: sector lock (boss rooms in the world)
**Value:** Metroid boss rooms: a fight seals to one arena-sized sector where every
existing boss behavior and hazard pattern recovers its original tuned geometry.
**Files:** `ExpeditionModeAdapter.lockToSector/releaseSectorLock` (camera bounds +
field rect + AI field rect refresh); `GameScene.ts:8547-8601` (spawnBoss under lock),
8607-8654 (boss hazards against `fieldRect`); lock/release call points wired to boss
activation/death (8598 `activateBossArena` neighborhood and the existing
boss-death cleanup path).
**DONE-CRITERIA:**
- Expedition dev route: triggering a boss locks camera and player to the sector, the
  boss enters top-center with the existing entrance choreography, `the-machine`
  seeks the room center, hazards land inside the room, arena overlay tints the view;
  killing the boss releases bounds and the world is flyable again.
- Arena boss fight unchanged.
- Refresh-during-lock (pre-W7: verify lock state survives within a session across
  pause/resume; full refresh persistence lands in W7).
**Dependencies:** W4, W5 (and section 12 contract: content piece decides where bosses
live). **Test surface:** none new (lock geometry is `sectorRectWorld`, tested in W1).

### FEAT-WORLD-SPACE-7: save v2 + restore for a moving world
**Value:** a mid-flight refresh, tab kill or orientation flip returns the player to the
exact same place, camera and all; expedition becomes as crash-proof as the arena.
**Files:** `src/save/GameStateManager.ts:43` (SAVE_VERSION 2), `:312`
(`GameSaveState` additions), `:519` (validator ceiling), `:706` (mode-aware writer),
`:815` (`migrateState` first real body); `GameScene.ts:2010-2106` (writer payload),
2112-2200 (mode-aware restore order per section 8.3).
**DONE-CRITERIA:**
- Arena save payload byte-identical to pre-chunk except `timestamp` (serialized diff
  in a unit test with mocked ECS world, alongside the existing save/load tests).
- v1 saves load and restore exactly as before (existing tests keep passing;
  `migrateState` covered by tests: v1 passthrough, v2 arena-default, version 3
  rejected).
- Expedition: refresh during free flight restores position, camera scroll (including
  deadzone offset), sector, grid anchoring with no visible snap; refresh during a
  sector lock restores the locked fight; orientation flip mid-expedition round-trips.
- Rollback simulation: a v2 expedition payload fed to the v1 validator logic is
  rejected cleanly (unit test against the validation function).
**Dependencies:** W4 (W6 for the lock-restore criterion). **Test surface:**
`migrateState`, validator ceiling, writer payload shape, arena byte-identity (all in
the existing pure save test harness).

---

## 11. Explicit non-goals of this piece

- No barriers, doors, gates or solid collision (worldgen/barriers piece; this piece
  provides the `fieldRect` clamp seam and `isSpawnableWorldPoint` choke point they
  plug into).
- No world generation, layout, biomes or secrets (worldgen piece; this piece consumes
  `worldBounds` and a start sector).
- No discovery persistence, fog, map overlay or minimap extensions (discovery piece;
  this piece emits `expedition:sector-entered` and keeps the radar working).
- No quests, POIs, permanent power-ups or mode promotion UI (content piece / operator
  decision; this piece keeps the dev route hidden).

---

## 12. Contracts the sibling architects must honor

**Worldgen/barriers:**
- Import `SECTOR_WIDTH/HEIGHT`, `SectorCoord`, `sectorKey` from
  `src/world/worldSpace.ts`; never define parallel constants.
- The generated layout's bounding rect must fit inside
  `[-WORLD_EXTENT_LIMIT, WORLD_EXTENT_LIMIT]` on both axes (f32 precision budget, R3).
- Provide, as pure functions over the layout: `worldBounds(): WorldRect`,
  `startSector(): SectorCoord`, and the spawnability predicate that
  `ExpeditionModeAdapter.isSpawnableWorldPoint` delegates to.
- Barrier collision plugs into exactly two seams: the player clamp call site
  (`GameScene.ts:4946` replacement, W2) and the spawnability predicate. Do not add new
  clamp sites.
- The layout is re-derived from the profile seed on every load; never serialize
  geometry into `GameSaveState`. Run-scoped barrier state (opened gates) goes in an
  optional namespaced sub-block of `expedition` (section 8.1), profile-scoped
  permanence in its own `SecureStorage` key.

**Discovery-map UI:**
- Subscribe to `scene.events.on('expedition:sector-entered', (key, coord) => ...)`;
  it fires exactly once per boundary crossing, including the start sector on run
  start and restore.
- Sector identity is the `sectorKey` string; treat it as opaque and canonical.
- Discovery accumulation is profile-level `SecureStorage`, never `GameSaveState`.
- The in-run minimap stays the player-centered radar (`minimapProjection.ts`,
  `MINIMAP_WORLD_RANGE` 900 world px, unchanged semantics under the moving camera);
  any full map view runs in its own scene or pinned overlay and must not touch
  `cameras.main` (zoom stays 1, section 2.4).

**Content/quests:**
- All entity placement goes through the section-4 seams: edge pressure via the spawn
  ring, fixed placements via world coordinates derived from
  `sectorOriginWorld`/`sectorCenterWorld`, always validated by
  `isSpawnableWorldPoint`. No direct screen-derived positions.
- Boss and sealed encounters must use `lockToSector`/`releaseSectorLock`; bosses are
  never spawned unlocked (R11: arena-tuned boss AI assumes a room).
- Quest/run state persists in an optional namespaced sub-block of
  `expedition` (section 8.1); adding optional fields there needs no version bump.
  Permanent power-ups are profile-level, outside `GameSaveState`.
- Temporary power-ups that follow the existing pickup pipeline
  (`ConsumablePickupSystem`, `HealthPickupSystem`) inherit world-space behavior for
  free and need no camera awareness.
