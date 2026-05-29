# Scroll Runner Polish — Design

**Date:** 2026-05-29
**Status:** Approved (design); implementation = polish parts only this session
**Scope decision:** "Design everything, build polish." This document specifies three
areas. Areas A and B are implemented now. Area C (a new endless-runner game mode) is
designed here but deferred to its own follow-up plan — it is **not** implemented in
this session.

## Context

This is a fixed-camera 2D roguelike arena (Phaser 3 + bitECS). The player is clamped to
the screen (`GameScene.clampPlayerToScreen`); the world camera does not scroll. There is
no existing "scroll runner" feature. "Scroll runner polish" was clarified with the user
to mean three things:

- **A. Zigzag Runner enemy** — motion juice, visual upgrade, dart telegraph.
- **B. Background** — parallax depth layers + warp-grid polish (faking depth/scroll
  behind the fixed camera).
- **C. A new endless-runner mode** — design sketch only, deferred.

### Key code constraints discovered (these drive the design)

1. **Enemy visuals are baked once into a cached texture** (`createCachedEnemyVisual` in
   `src/visual/EnemyVisuals.ts`), then reused as shared sprites across all instances of
   that enemy type. A per-frame, speed-reactive thrust flame redraw is therefore not
   feasible — the texture is static and shared. The "engine thrust scaled to speed" look
   is achieved by **(a)** a baked static thrust glow in the texture, plus **(b)** the
   per-entity motion trail (which is per-frame, pooled, and cheap) carrying the
   speed-reactive feel.
2. **Camera is fixed.** Parallax cannot be driven by camera scroll. It is driven by the
   player's position/velocity: layers offset opposite to player motion, scaled per layer.
3. **Trails:** `TrailManager.addTrailPoint(entityId, x, y, color, size)`. Today the trail
   loop (`GameScene.updateTrails`, ~line 6798) gives every fast enemy the same red
   (`0xff6666`, size 5). Zigzag (base speed 90) already qualifies.
4. **Telegraphs:** `TelegraphManager.spawnLine(x, y, angle, length, duration, color, thickness)`,
   injected into `EnemyAISystem` via `setTelegraphManager`. Existing Dasher hook at the
   dash windup is the template (`EnemyAISystem` ~line 427).
5. **Depth:** `DepthLayers.GRID_BACKGROUND = 0` is the lowest defined layer. Parallax
   layers render at negative depth (behind the grid). Trails are depth 4, entities above.
6. **Zigzag AI** (`updateZigzagAI`, `EnemyAISystem` ~line 354) is currently stateless —
   pure oscillation toward the player. Adding dart bursts requires a small state machine
   using the existing `EnemyAI.state` / `EnemyAI.timer` fields.

## Area A — Zigzag Runner enemy (BUILD NOW)

### A1. Motion juice

- **Banking lean.** The AI sets `Transform.rotation` to face velocity (`EnemyAISystem`
  ~line 391). Add a bank offset derived from the signed `zigzagAmount` (the perpendicular
  oscillation already computed at line 381), magnitude capped at ~`±0.30 rad`. Visual-only;
  does not change the velocity vector. Effect: the chevron visibly tilts into each turn.
- **Orange speed streak.** In `GameScene.updateTrails`, special-case the Zigzag aiType:
  brighter orange (`0xff8833`, matching the enemy's color) and a slightly larger size
  than the generic red. All other fast enemies keep the existing red trail. This trail is
  the speed-reactive "engine wash."
- **Dart bursts.** Add a lunge cycle to `updateZigzagAI` using `EnemyAI.state` /
  `EnemyAI.timer`:
  - `state 0` (cruise): normal zigzag, timer counts down from ~2.5s (randomized via phase
    so a group does not lunge in unison).
  - `state 1` (windup): ~0.35s, fire the telegraph (A3), slightly slow.
  - `state 2` (dart): ~0.40s at ~2× speed straight toward the player's telegraphed point,
    reduced zigzag so the lunge reads clean.
  - return to cruise. Speed multiplier applied on top of the existing `Velocity.speed`
    computation, not a permanent stat change.

### A2. Visual upgrade

Edit `drawZigzag` (`EnemyVisuals.ts` ~line 183), all baked into the cached texture:
- Tail thrust glow: a short cone / layered glow behind the chevron in `0xff8833`,
  quality-scaled like the existing `triangleGlow`.
- Sharper nose, brighter neon core, subtle double outline for definition.
- No per-frame cost (texture is cached); speed-scaling comes from the A1 trail.

### A3. Dart telegraph

At the `state 0 → state 1` transition in `updateZigzagAI`, call
`telegraphManager?.spawnLine(enemyX, enemyY, angleToPlayer, ~140, 0.35, 0xff8833, ~8)`.
Mirrors the Dasher hook. Pure readability — no damage or timing change to the dart itself
beyond what A1 defines.

## Area B — Background (BUILD NOW)

### B1. Parallax depth layers — new `src/visual/ParallaxBackground.ts`

- 2–3 layers of drifting neon dust/star points rendered behind the grid at negative depth.
- Each layer has a depth factor (far = small offset/slow, near = larger offset/fast).
  Offset = `-(playerPos - screenCenter) * layerFactor`, plus a slow constant ambient drift
  so the field feels alive even when the player is still. Points wrap seamlessly at screen
  edges (modulo wrap).
- Quality-aware via `setQuality` (high: 3 layers full density; medium: 2 layers reduced;
  low: disabled). Respects reduced-motion (`getSettingsManager().isReducedMotionEnabled()`).
- Lifecycle mirrors `TrailManager`: constructed in `GameScene.create`, `update(...)` called
  in the loop (early, near the grid update), `resize` on resize, `destroy` on shutdown.
  Module-free (instance-owned state) so no global reset function is required; recreated per
  scene like TrailManager.

### B2. Warp-grid polish — `src/visual/GridBackground.ts` (tune only, no rewrite)

- Add a slow constant grid drift synced in direction to the parallax ambient drift so the
  two layers feel cohesive (small — the grid stays readable).
- Slightly strengthen the entity-reactive warp for fast-moving enemies (within existing
  `MAX_WARP` / `MAX_TOTAL_WARP` ceilings) so darting Zigzags visibly disturb the field.
- Tuning only: adjust existing constants/response; do not restructure the verlet sim.

## Area C — New endless-runner mode (DESIGN ONLY, DEFERRED)

Not built this session. Captured so a later plan can pick it up.

- **Concept:** a separate `RunnerScene` game mode with a forced auto-scroll (the world or a
  hazard wall advances), where the goal is dodge-and-survive rather than the arena's
  stationary survival. Reuses the existing enemy roster, weapon system, and visual managers.
- **Movement:** either constrained lanes or free vertical movement against a horizontal
  scroll. To be decided in the follow-up brainstorm.
- **Integration points:** registered in `src/main.ts` alongside the other 12 scenes;
  entered from `BootScene` as a mode pick; reuses `WeaponManager`, `EnemyTypes`,
  `EffectsManager`, `ParallaxBackground` (built in Area B), `HUDManager`. Scoring feeds the
  existing `BestScoreManager` / leaderboard patterns.
- **Why deferred:** it is a full new scene + mode (large), independent of the polish work,
  and warrants its own spec → plan → implementation cycle.

## Testing / verification

- `npm run build` (tsc + vite) must pass — no test suite configured.
- Manual: run a session, confirm Zigzags bank, trail orange, telegraph+dart read clearly,
  parallax drifts with player motion and wraps without seams, grid drift is subtle, no FPS
  regression at high enemy counts (quality auto-scaler should hold 60fps).
- Reset/lifecycle: start a run, die, restart — confirm no leftover parallax, no trail
  ghosts, no accumulated listeners (follow existing shutdown patterns).

## Out of scope

- Building Area C (the new endless-runner mode).
- Any change to enemy stats/balance (Zigzag damage/HP/spawn unchanged).
- Rewriting the GridBackground verlet simulation.
