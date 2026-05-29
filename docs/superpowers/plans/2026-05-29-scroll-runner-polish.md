# Scroll Runner Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Polish the Zigzag Runner enemy (motion juice, baked thrust glow, dart telegraph) and the background (new parallax depth layers + warp-grid tuning) in the fixed-camera arena.

**Architecture:** Enemy visuals are baked once into a cached texture, so speed-reactive feel comes from the per-frame motion trail, not texture redraws. The camera is fixed, so parallax is driven by player position offset, not camera scroll. All new state is instance-owned (no module-level globals) and follows the existing TrailManager/GridBackground lifecycle (created in `GameScene.create`, updated in the loop, destroyed on shutdown). Spec: `docs/superpowers/specs/2026-05-29-scroll-runner-polish-design.md`.

**Tech Stack:** Phaser 3, bitECS, TypeScript (strict). No unit-test runner is configured — the per-task verification gate is `npm run build` (tsc + vite) passing, plus the manual playtest checklist in Task 7.

> **TDD note:** This repo has no test harness ("No lint/test commands configured" in CLAUDE.md). Standard failing-test-first TDD does not apply. Each task instead: make the change → `npm run build` must pass clean → commit. Behavioral correctness is verified manually in Task 7.

> **Parallel-path warning (from CLAUDE.md):** `GameScene` has TWO setup paths — a fresh run (`create`, ~line 503/564) and a save-restore (~line 1132/1212). Any new manager constructed in one MUST be constructed in the other. Tasks below call this out explicitly.

---

## File Structure

- `src/visual/EnemyVisuals.ts` (modify) — `drawZigzag` gains baked thrust glow + sharper core. Task 1.
- `src/game/scenes/GameScene.ts` (modify) — Zigzag orange trail (Task 2); ParallaxBackground wiring (Task 5); grid drift tuning hook (Task 6).
- `src/ecs/systems/EnemyAISystem.ts` (modify) — `updateZigzagAI` gains banking lean + dart-burst state machine + telegraph. Task 3.
- `src/visual/ParallaxBackground.ts` (create) — new drifting depth-layer background. Task 4.
- `src/visual/GridBackground.ts` (modify) — ambient drift + stronger fast-enemy warp. Task 6.

---

## Task 1: Zigzag baked thrust glow + sharper core

**Files:**
- Modify: `src/visual/EnemyVisuals.ts` (`drawZigzag`, ~line 183)

- [ ] **Step 1: Confirm the cached-texture bounds won't clip the new glow**

Read `createCachedEnemyVisual` (`src/visual/EnemyVisuals.ts` ~line 915) and find how the
texture size / padding is derived from `s`. The new glow stays within the existing chevron
footprint (max extent `s * 1.1` at the nose, `s * 0.65` at the tail), so no bounds change
should be needed. If the cache uses tight bounds and clips, bump its padding constant.
Note what you found in the commit message.

- [ ] **Step 2: Rewrite `drawZigzag` with thrust glow + brighter core + double outline**

Replace the body of `drawZigzag` (`src/visual/EnemyVisuals.ts:183`) with:

```ts
/** Zigzag Runner — swept-back chevron/arrow with engine thrust glow, looks fast */
function drawZigzag(g: Phaser.GameObjects.Graphics, s: number, neon: NeonColorPair, quality: VisualQuality): void {
  triangleGlow(g, s, neon, quality);

  // Baked engine thrust glow behind the tail. Static (texture is cached + shared across
  // instances); the speed-reactive wash is the motion trail added in GameScene.updateTrails.
  if (quality !== 'low') {
    const thrustColor = 0xff8833;
    g.fillStyle(thrustColor, 0.20);
    g.fillTriangle(-s * 0.38, s * 0.5, s * 0.38, s * 0.5, 0, s * 0.95);
    g.fillStyle(thrustColor, 0.42);
    g.fillTriangle(-s * 0.2, s * 0.45, s * 0.2, s * 0.45, 0, s * 0.8);
  }

  // Chevron core
  g.fillStyle(neon.core, 1);
  g.beginPath();
  g.moveTo(0, -s * 1.1);        // sharp nose
  g.lineTo(s * 0.85, s * 0.65); // right wingtip
  g.lineTo(s * 0.15, s * 0.15); // right notch
  g.lineTo(0, s * 0.45);        // tail center
  g.lineTo(-s * 0.15, s * 0.15);
  g.lineTo(-s * 0.85, s * 0.65);
  g.closePath();
  g.fillPath();

  // Double outline: crisp white edge + faint neon halo for definition
  g.lineStyle(2.5, 0xffffff, 0.9);
  g.strokePath();
  if (quality !== 'low') {
    g.lineStyle(1, neon.glow, 0.5);
    g.strokePath();
  }
}
```

- [ ] **Step 3: Build**

Run: `npm run build`
Expected: PASS (tsc + vite, no errors).

- [ ] **Step 4: Commit**

```bash
git add src/visual/EnemyVisuals.ts
git commit -m "Add baked thrust glow + sharper core to Zigzag Runner visual"
```

---

## Task 2: Zigzag orange motion trail

**Files:**
- Modify: `src/game/scenes/GameScene.ts` (`updateTrails`, ~line 6798)

- [ ] **Step 1: Confirm imports**

Verify `GameScene.ts` already imports `EnemyAI` (it does, ~line 13) and `EnemyAIType`.
If `EnemyAIType` is not imported, add it to the existing import from
`'../../ecs/systems/EnemyAISystem'` (or wherever the enum is exported — check with
`grep -n "export enum EnemyAIType" src/ecs/systems/EnemyAISystem.ts`).

- [ ] **Step 2: Special-case the Zigzag trail color/size**

In `updateTrails`, replace the enemy trail block (`src/game/scenes/GameScene.ts` ~lines
6818-6824) so Zigzag enemies get a brighter orange, slightly larger streak while every
other fast enemy keeps the current red:

```ts
      if (speedSq > 6400 && !hasNoTrailFlag) {
        const ex = Transform.x[enemyId];
        const ey = Transform.y[enemyId];

        // Zigzag Runner gets a brighter orange engine wash; other fast enemies stay red.
        if (EnemyAI.aiType[enemyId] === EnemyAIType.Zigzag) {
          this.trailManager.addTrailPoint(enemyId, ex, ey, 0xff8833, 7);
        } else {
          this.trailManager.addTrailPoint(enemyId, ex, ey, 0xff6666, 5);
        }
      }
```

- [ ] **Step 3: Build**

Run: `npm run build`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/game/scenes/GameScene.ts
git commit -m "Give Zigzag Runner a distinct orange motion trail"
```

---

## Task 3: Zigzag banking lean + dart-burst state machine + telegraph

**Files:**
- Modify: `src/ecs/systems/EnemyAISystem.ts` (`updateZigzagAI`, ~line 354)

State machine uses the existing `EnemyAI.state` (ui8) and `EnemyAI.timer` (f32) fields,
both already initialized from enemy data (`GameScene.ts:1563-1564`). `telegraphManager` is
the module-level injected manager already used by the Dasher (`EnemyAISystem.ts:427`).

- [ ] **Step 1: Replace `updateZigzagAI` with lean + dart cycle**

Replace the whole `updateZigzagAI` function (`src/ecs/systems/EnemyAISystem.ts:354-393`)
with:

```ts
function updateZigzagAI(
  enemyId: number,
  playerX: number,
  playerY: number,
  deltaTime: number
): void {
  const enemyX = Transform.x[enemyId];
  const enemyY = Transform.y[enemyId];
  const dx = playerX - enemyX;
  const dy = playerY - enemyY;
  const distance = Math.sqrt(dx * dx + dy * dy);
  if (distance <= 1) return;

  const baseSpeed = Velocity.speed[enemyId];
  const phase = EnemyAI.phase[enemyId];
  EnemyAI.phase[enemyId] += deltaTime * (5 + Math.sin(phase * 0.7) * 2);

  // Dart-burst state machine: 0 = cruise, 1 = windup (telegraph), 2 = dart.
  // Phase seeds the cruise interval so a group doesn't lunge in unison.
  EnemyAI.timer[enemyId] -= deltaTime;
  const state = EnemyAI.state[enemyId];
  if (state === 0 && EnemyAI.timer[enemyId] <= 0) {
    // Begin windup; telegraph the lunge lane toward the player.
    EnemyAI.state[enemyId] = 1;
    EnemyAI.timer[enemyId] = 0.35;
    telegraphManager?.spawnLine(enemyX, enemyY, Math.atan2(dy, dx), 140, 0.35, 0xff8833, 8);
  } else if (state === 1 && EnemyAI.timer[enemyId] <= 0) {
    EnemyAI.state[enemyId] = 2;
    EnemyAI.timer[enemyId] = 0.4;
  } else if (state === 2 && EnemyAI.timer[enemyId] <= 0) {
    EnemyAI.state[enemyId] = 0;
    EnemyAI.timer[enemyId] = 2.0 + Math.abs(Math.sin(phase)) * 1.5; // ~2.0-3.5s cruise
  }
  const currentState = EnemyAI.state[enemyId];

  // Perpendicular for the side-to-side oscillation.
  const perpX = -dy / distance;
  const perpY = dx / distance;

  // Windup slows slightly; dart reduces zigzag and doubles speed for a clean lunge.
  let speed = baseSpeed;
  let zigScale = 1.0;
  if (currentState === 1) { speed = baseSpeed * 0.7; }
  else if (currentState === 2) { speed = baseSpeed * 2.0; zigScale = 0.25; }

  const rawZigzag = (Math.sin(phase) * 0.5 + Math.sin(phase * 2.3) * 0.35) * zigScale;
  const amplitudeScale = 0.4 + Math.min(distance / 300, 1.0) * 0.6;
  const zigzagAmount = rawZigzag * amplitudeScale;

  const moveX = (dx / distance) + perpX * zigzagAmount;
  const moveY = (dy / distance) + perpY * zigzagAmount;
  const moveMag = Math.sqrt(moveX * moveX + moveY * moveY);

  Velocity.x[enemyId] = (moveX / moveMag) * speed;
  Velocity.y[enemyId] = (moveY / moveMag) * speed;

  // Banking lean: tilt the sprite into the turn (visual only; doesn't alter velocity).
  // +PI_HALF so the triangle tip leads; bank from the signed oscillation, capped ±0.3 rad.
  const bank = Math.max(-0.3, Math.min(0.3, zigzagAmount * 0.5));
  Transform.rotation[enemyId] = Math.atan2(Velocity.y[enemyId], Velocity.x[enemyId]) + PI_HALF + bank;
}
```

- [ ] **Step 2: Build**

Run: `npm run build`
Expected: PASS. (`telegraphManager`, `Transform`, `Velocity`, `EnemyAI`, `PI_HALF` are all
already in scope in this file.)

- [ ] **Step 3: Commit**

```bash
git add src/ecs/systems/EnemyAISystem.ts
git commit -m "Add banking lean + dart-burst telegraph to Zigzag Runner AI"
```

---

## Task 4: ParallaxBackground class (new file)

**Files:**
- Create: `src/visual/ParallaxBackground.ts`

Drifting neon dust layers behind the grid. Fixed camera → parallax from player offset.
Instance-owned state (recreated per scene like TrailManager) — no module reset function.

- [ ] **Step 1: Create the file**

Create `src/visual/ParallaxBackground.ts`:

```ts
import Phaser from 'phaser';
import { VisualQuality } from './GlowGraphics';
import { getSettingsManager } from '../settings/SettingsManager';

interface ParallaxLayer {
  graphics: Phaser.GameObjects.Graphics;
  factor: number;       // how strongly this layer reacts to player offset (far=small)
  driftX: number;       // ambient drift velocity px/s
  driftY: number;
  color: number;
  size: number;
  pointsX: Float32Array; // rest positions (screen space, pre-wrap)
  pointsY: Float32Array;
  count: number;
}

/**
 * Parallax depth layers rendered BEHIND the warp grid (negative depth). The camera is
 * fixed, so the parallax offset is driven by the player's distance from screen centre,
 * scaled per layer, plus a slow ambient drift so the field feels alive when idle.
 * Quality-aware and reduced-motion-aware. Mirrors TrailManager's lifecycle: constructed
 * per scene, updated each frame, destroyed on shutdown — no module-level state.
 */
export class ParallaxBackground {
  private layers: ParallaxLayer[] = [];
  private readonly width: number;
  private readonly height: number;
  private elapsed: number = 0;
  private enabled: boolean = true;

  // Per-layer config: factor (parallax strength), point count at high quality, color, size.
  private static readonly LAYER_DEFS = [
    { factor: 0.02, count: 60, color: 0x113355, size: 1.5, driftX: 4,  driftY: 2 },
    { factor: 0.05, count: 40, color: 0x1f5577, size: 2.0, driftX: 8,  driftY: -3 },
    { factor: 0.10, count: 28, color: 0x2a88aa, size: 2.8, driftX: 14, driftY: 5 },
  ];

  constructor(scene: Phaser.Scene) {
    this.width = scene.scale.width;
    this.height = scene.scale.height;

    // Deterministic point scatter (no Math.random reliance for repeatability across resets).
    let seed = 1337;
    const rand = () => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed / 0x7fffffff;
    };

    for (let i = 0; i < ParallaxBackground.LAYER_DEFS.length; i++) {
      const def = ParallaxBackground.LAYER_DEFS[i];
      const graphics = scene.add.graphics();
      graphics.setDepth(-3 + i); // -3, -2, -1 → all behind GRID_BACKGROUND (0)
      graphics.setScrollFactor(0);
      const pointsX = new Float32Array(def.count);
      const pointsY = new Float32Array(def.count);
      for (let p = 0; p < def.count; p++) {
        pointsX[p] = rand() * this.width;
        pointsY[p] = rand() * this.height;
      }
      this.layers.push({
        graphics, factor: def.factor, driftX: def.driftX, driftY: def.driftY,
        color: def.color, size: def.size, pointsX, pointsY, count: def.count,
      });
    }
  }

  setQuality(quality: VisualQuality): void {
    // high: all 3 layers; medium: nearest 2; low: disabled.
    const activeLayers = quality === 'high' ? 3 : quality === 'medium' ? 2 : 0;
    for (let i = 0; i < this.layers.length; i++) {
      const visible = i >= this.layers.length - activeLayers; // keep nearest layers
      this.layers[i].graphics.setVisible(visible && this.enabled);
    }
  }

  update(deltaSeconds: number, playerX: number, playerY: number): void {
    if (!this.enabled || getSettingsManager().isReducedMotionEnabled()) {
      for (const layer of this.layers) layer.graphics.setVisible(false);
      return;
    }
    this.elapsed += deltaSeconds;

    const offsetCx = playerX - this.width / 2;
    const offsetCy = playerY - this.height / 2;

    for (const layer of this.layers) {
      const g = layer.graphics;
      if (!g.visible) continue;
      g.clear();
      g.fillStyle(layer.color, 0.55);

      // Parallax offset (opposite player motion) + slow ambient drift, wrapped to screen.
      const px = -offsetCx * layer.factor + layer.driftX * this.elapsed;
      const py = -offsetCy * layer.factor + layer.driftY * this.elapsed;
      for (let p = 0; p < layer.count; p++) {
        const x = mod(layer.pointsX[p] + px, this.width);
        const y = mod(layer.pointsY[p] + py, this.height);
        g.fillCircle(x, y, layer.size);
      }
    }
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (!enabled) for (const layer of this.layers) layer.graphics.setVisible(false);
  }

  reset(): void {
    this.elapsed = 0;
  }

  destroy(): void {
    for (const layer of this.layers) layer.graphics.destroy();
    this.layers = [];
  }
}

function mod(value: number, m: number): number {
  return ((value % m) + m) % m;
}
```

- [ ] **Step 2: Verify the SettingsManager API name**

Run: `grep -n "isReducedMotionEnabled" src/settings/SettingsManager.ts`
Expected: a method definition exists. If the method is named differently, update the two
call sites in this file to match. (`TrailManager.ts:118` calls
`getSettingsManager().isReducedMotionEnabled()`, so this name is correct.)

- [ ] **Step 3: Build**

Run: `npm run build`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/visual/ParallaxBackground.ts
git commit -m "Add ParallaxBackground depth layers (player-offset parallax, fixed camera)"
```

---

## Task 5: Wire ParallaxBackground into GameScene

**Files:**
- Modify: `src/game/scenes/GameScene.ts` (import, field, both setup paths, update loop, quality, resize, shutdown)

> CRITICAL — parallel paths: GridBackground is constructed at BOTH ~line 503 (fresh) and
> ~line 1132 (restore). The parallax manager MUST be constructed in both, immediately after
> each `new GridBackground(this)`.

- [ ] **Step 1: Import + field**

Add the import near the other visual imports (`GameScene.ts` ~line 44):

```ts
import { ParallaxBackground } from '../../visual/ParallaxBackground';
```

Add the field near `private gridBackground!: GridBackground;` (~line 270):

```ts
  private parallaxBackground!: ParallaxBackground;
```

- [ ] **Step 2: Construct in BOTH setup paths**

Immediately after `this.gridBackground = new GridBackground(this);` at ~line 503 (fresh
path) AND at ~line 1132 (restore path), add:

```ts
    this.parallaxBackground = new ParallaxBackground(this);
```

- [ ] **Step 3: Update each frame (just before grid update)**

In `update`, immediately before the existing `this.updateGridBackground(deltaSeconds);`
call (~line 2564), add:

```ts
    if (this.parallaxBackground && this.playerId !== -1) {
      this.parallaxBackground.update(deltaSeconds, Transform.x[this.playerId], Transform.y[this.playerId]);
    }
```

- [ ] **Step 4: Propagate quality**

Find the block that calls `this.trailManager.setQuality(newQuality);` (~line 6974) and add
right after it:

```ts
      if (this.parallaxBackground) this.parallaxBackground.setQuality(newQuality);
```

Also set initial quality once after construction. In each setup path, after the
`new ParallaxBackground(this)` line from Step 2, the manager defaults to all layers
visible; the first quality-scaler tick will correct it. No extra call required, but if the
scene caches a current quality value (search for the variable used at ~line 6974, e.g.
`this.currentQuality`), call `this.parallaxBackground.setQuality(thatValue)` after
construction in both paths for an immediate-correct first frame.

- [ ] **Step 5: Resize**

Find the resize handler that calls `this.trailManager.resize(...)` (~line 7049). The
parallax field is sized once at construction from `scene.scale`; on resize, recreate it to
pick up new dimensions. Add inside that handler:

```ts
    if (this.parallaxBackground) {
      this.parallaxBackground.destroy();
      this.parallaxBackground = new ParallaxBackground(this);
    }
```

- [ ] **Step 6: Shutdown**

Find the shutdown block that calls `this.trailManager.destroy()` (~line 7172) and add:

```ts
    if (this.parallaxBackground) {
      this.parallaxBackground.destroy();
    }
```

- [ ] **Step 7: Build**

Run: `npm run build`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/game/scenes/GameScene.ts
git commit -m "Wire ParallaxBackground into GameScene (both paths, update, quality, resize, shutdown)"
```

---

## Task 6: Warp-grid polish (ambient drift + stronger fast-enemy warp)

**Files:**
- Modify: `src/visual/GridBackground.ts`
- Modify (if a new public setter is added): `src/game/scenes/GameScene.ts`

Keep this tuning-only — do not restructure the verlet sim.

- [ ] **Step 1: Strengthen the fast-enemy reactive warp**

In `GameScene.updateGridBackground` the per-enemy `weight` is computed (~line 6974). Add a
fast-mover bump so darting Zigzags disturb the field more, staying under the existing
`MAX_WARP`/`MAX_TOTAL_WARP` ceilings (the grid clamps internally). After the existing
`if (aiType >= 100)` / `else if (aiType >= 50)` block, add:

```ts
      // Fast movers (e.g. darting Zigzags) disturb the field a touch more.
      const evx = Velocity.x[enemyId];
      const evy = Velocity.y[enemyId];
      if (evx * evx + evy * evy > 14400) { // speed > 120
        weight *= 1.3;
      }
```

Confirm `Velocity` is imported in `GameScene.ts` (it is — used throughout).

- [ ] **Step 2: Add a subtle ambient grid drift**

In `GridBackground.update` (`src/visual/GridBackground.ts:470`), add a slow constant drift
to the rest positions' rendered offset so the grid breathes in sync with the parallax
ambient drift. Locate where each point's screen position is computed for drawing and apply
a small global offset `(driftX, driftY)` accumulated from delta. Add fields near the other
private state (~line 66):

```ts
  private driftPhase: number = 0;
  private readonly GRID_DRIFT_AMPLITUDE = 6; // px, subtle
```

At the top of `update(deltaSeconds)`, advance the phase:

```ts
    this.driftPhase += deltaSeconds * 0.15;
```

Then where line screen X/Y are computed for rendering, add the drift offset (a gentle
circular sway, not a runaway translation, so the grid never walks off):

```ts
    const driftOffsetX = Math.cos(this.driftPhase) * this.GRID_DRIFT_AMPLITUDE;
    const driftOffsetY = Math.sin(this.driftPhase * 0.8) * this.GRID_DRIFT_AMPLITUDE;
```

Apply `driftOffsetX/Y` to the rendered point coordinates (the `lineScreenX/lineScreenY`
arrays or the equivalent draw coords — read the draw section ~lines 470-700 and add the
offset at the point where rest position maps to screen position). Keep it additive and
small; the warp sim is unaffected because this is a render-time offset only.

- [ ] **Step 3: Reset the drift on run reset**

In `GridBackground.reset()` (`src/visual/GridBackground.ts:852`), add:

```ts
    this.driftPhase = 0;
```

- [ ] **Step 4: Build**

Run: `npm run build`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/visual/GridBackground.ts src/game/scenes/GameScene.ts
git commit -m "Polish warp grid: ambient drift + stronger fast-enemy warp"
```

---

## Task 7: Final build + manual verification

**Files:** none (verification only)

- [ ] **Step 1: Clean build**

Run: `npm run build`
Expected: PASS with no TypeScript errors.

- [ ] **Step 2: Manual playtest checklist**

Run `npm run dev`, start a run, and confirm:
- Zigzag Runner visibly **banks** (tilts) into its turns.
- Zigzag leaves a **brighter orange** trail; other fast enemies still leave red.
- Before a lunge a short **orange telegraph line** appears, then the Zigzag **darts** fast
  toward the player, then resumes cruising. Cycle repeats (~2-3.5s).
- Zigzag has a visible **engine thrust glow** at its tail.
- Background shows **drifting parallax dust** behind the grid that shifts opposite to player
  movement and wraps seamlessly (no hard seams/pop).
- Grid has a subtle **ambient sway**; fast Zigzags disturb it more than before.
- Settings → reduced motion: parallax disappears. Quality auto-drop (low): parallax off,
  thrust glow simplified, trails off — no errors, no ghost artifacts.
- Die → restart run: no leftover parallax points, no frozen trails, no console errors.
  Refresh mid-run → restore: parallax present (restore path wired).
- FPS holds ~60 with many enemies on screen (quality scaler engages if needed).

- [ ] **Step 3: Final commit (if any tuning tweaks were made during playtest)**

```bash
git add -A
git commit -m "Tune scroll-runner polish after playtest"
```

---

## Notes for the executor

- **Approximate line numbers** drift as you edit. Always re-grep for the anchor text shown
  in each task rather than trusting the line number.
- **No magic numbers for enum compares** — use `EnemyAIType.Zigzag`, not its integer value.
- **Texture cache (Task 1):** if the thrust glow is clipped, the fix is in
  `createCachedEnemyVisual`'s bounds/padding, not in `drawZigzag`.
- **Area C (new endless-runner mode) is NOT in this plan** — it is design-only in the spec
  and gets its own future plan.
