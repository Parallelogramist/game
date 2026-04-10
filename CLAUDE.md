# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build & Development Commands

- `npm run dev` - Start Vite dev server with hot reload
- `npm run build` - TypeScript check + production build
- `npm run preview` - Preview production build locally

No lint/test commands configured.

## Deployment

- **GitHub Pages**: Auto-deploys on push to `master` via `.github/workflows/deploy.yml` (Node 20)
- **Vite config**: Base path `/`, output to `dist/`

## Architecture Overview

2D roguelike survival game. **Phaser 3** for rendering, **bitECS** for entity management.

### Player Visual Identity

**Player is procedurally-drawn neon spaceship** via `PlayerSpaceship` (`/src/visual/PlayerSpaceship.ts`). No sprite asset — delta/arrow hull drawn with Phaser Graphics. Multi-layer neon glow, engine thrust flames scale with speed, smooth rotation toward movement. Hull color shifts with combo tier (warm/hot/blazing/inferno), danger (red at low HP), speed (warm-white tint). Level-ups trigger flash + scale pulse. Glow layers scale with quality setting.

### ECS Architecture

Entity-Component-System pattern:
- **Components** (`/src/ecs/components/index.ts`) — 19 data schemas: Transform, Velocity, Health, Weapon, Projectile, EnemyAI, EnemyType, Knockback, StatusEffect, tag components
- **Systems** (`/src/ecs/systems/`) — game logic operating on entities with specific components
- **SpriteRef** bridges ECS entities to Phaser sprites

Fixed system execution order per frame (from `GameScene.update()`):
```
updateFrameCache → Slow time → Achievement tracking → Auto-save →
Shield barrier recharge → Dash ability → Gem magnet → Treasure chest spawning →
HP regen → Emergency heal → Magnet spawn timer →
Enemy/miniboss/boss/endless spawning → ComboSystem decay → EventSystem →
Laser beams → Joystick/keyboard/mouse input →
InputSystem → EnemyAISystem → Wraith alpha → MovementSystem → processKnockback →
clampPlayerToScreen → WeaponManager.update → XPGemSystem → HealthPickupSystem →
MagnetPickupSystem → StatusEffectSystem → Enemy Projectiles → Player-Enemy Collision →
SpriteSystem → PlayerSpaceship → GridBackground → Trails → EffectsManager →
DeathRippleManager → VisualQuality → UI
```
Knockback processed inline in GameScene. All weapon damage flows through `WeaponManager.damageEnemy()` — full combat pipeline: crits, execution bonus (<25% HP), shatter bonus (frozen enemies), elemental effects (burn/freeze/poison), life steal, knockback, overkill splash via SpatialHash, hit sparks, damage numbers. `CollisionSystem.ts` exports `CombatStats`/`setCombatStats()`/`resetCollisionSystem()` for combat stat management — no system loop function.

### Scene Flow

```
BootScene (start screen + music)
  ├─→ WeaponSelectScene (pre-run weapon pick, skips if only default discovered)
  │     └─→ GameScene (core gameplay) ─→ UpgradeScene (level-up modal, overlay)
  ├─→ ShopScene (permanent upgrades, returns to BootScene)
  ├─→ AchievementScene (achievements & milestones, returns to BootScene)
  ├─→ CodexScene (discovered weapons/enemies/upgrades, returns to BootScene)
  ├─→ SettingsScene (SFX, visual settings, returns to BootScene)
  ├─→ MusicSettingsScene (BGM settings, returns to BootScene)
  └─→ CreditsScene (attribution, returns to BootScene)
```

10 scenes in `/src/game/scenes/`. `WeaponSelectScene` shows discovered weapons from Codex for starting weapon pick; auto-skips to GameScene with default projectile if only one discovered.

### Weapon System

14 weapons managed by `WeaponManager` (`/src/weapons/WeaponManager.ts`).

**Architecture:**
- `BaseWeapon` abstract class — common functionality (cooldowns, upgrades, scene ref, external multipliers for damage/cooldown/count/piercing)
- Each weapon extends `BaseWeapon`, implements `fire()` and `update()`
- WeaponManager stores active weapons, calls update each frame

**Available Weapons:**
| Weapon | Description |
|--------|-------------|
| ProjectileWeapon | Basic auto-aimed projectiles |
| KatanaWeapon | Crisscrossing blade cuts |
| AuraWeapon | Continuous damage zone around player |
| OrbitingBladesWeapon | Rotating blades that orbit the player |
| FrostNovaWeapon | Freezing AOE explosion |
| MeteorWeapon | Delayed high-damage impact |
| FlamethrowerWeapon | Cone of continuous fire damage |
| ChainLightningWeapon | Bounces between nearby enemies |
| LaserBeamWeapon | Piercing beam toward cursor |
| RicochetWeapon | Bouncing projectiles |
| HomingMissileWeapon | Self-guided explosive projectiles |
| GroundSpikeWeapon | Spikes erupt at enemy positions |
| DroneWeapon | Autonomous helper that orbits and shoots |
| ShurikenWeapon | Spiral pattern projectiles |

**Adding new weapon:**
1. Create class extending `BaseWeapon` in `/src/weapons/`
2. Implement `fire()` for attack logic, `update(deltaTime)` for continuous effects. Include `this.externalBonusPiercing` in piercing calcs.
3. Export from `/src/weapons/index.ts`, add to `WeaponRegistry`
4. Add to upgrades in `src/data/Upgrades.ts` for unlock

**Damage Pipeline:**
All damage through `WeaponManager.damageEnemy()`:
- Crit rolls 80-100% variance (perfect crit at top 1%)
- Execution bonus for enemies <25% HP
- Shatter bonus for frozen enemies
- Elemental status (burn, freeze, poison) from CombatStats
- Life steal (heal % of damage)
- Knockback with combat stat multiplier
- Overkill splash to nearby enemies via SpatialHash
- Hit sparks, damage numbers, hit sound (50ms throttle)

**Weapon Evolutions:**
`/src/data/WeaponEvolutions.ts` — 14 recipes (one per weapon). Weapon at level 5 + required stat upgrade at level 5 → evolves to super form with boosted stats. Multipliers (damage, cooldown, range, count, piercing, size, speed) applied. `getEvolutionForWeapon(weaponId)` for O(1) lookup, `checkEvolutionReady()` to test readiness.

**Weapon Factory:**
`WeaponRegistry` in `/src/weapons/index.ts` maps IDs to factory functions. `createWeapon(weaponId)` instantiates by string ID.

### Enemy Variety System

30 enemy types in `/src/enemies/EnemyTypes.ts`:
- **5 Basic** (Shambler, Zigzag Runner, Dasher, Circler, Tiny Swarm)
- **13 Elite** (Tank, Exploder, Splitter, Shooter, Sniper, Healer, Shielded, Teleporter, Lurker, Warden, Wraith, Rallier, Giant)
- **3 Spawned-only** (Splitter Mini, Ghost, Turret — created by other enemies, not natural spawns)
- **6 Miniboss** (The Glutton, Swarm Mother, The Charger, Necromancer, Twin Alpha, Twin Beta)
- **3 Boss** (The Horde King, Void Wyrm, The Machine)

Twins spawn as linked pair.

**EnemyAI Component:**
```typescript
EnemyAI: { aiType, state, timer, targetX, targetY, shootTimer, specialTimer, phase }
```

**AI Types (EnemyAIType enum):**
- **Regular (0-17):** Chase, Zigzag, Dash, Circle, Swarm, Tank, Exploder, Splitter, Shooter, Sniper, Healer, Shielded, Teleporter, Giant, Lurker, Warden, Wraith, Rallier
- **Spawned-only (18-19):** Ghost, SplitterMini
- **Miniboss (50-55):** Glutton, SwarmMother, Charger, Necromancer, TwinA, TwinB
- **Boss (100-102):** HordeKing, VoidWyrm, TheMachine

**Spawn System:**
- Regular: time-weighted probabilities via `getRandomEnemyType(elapsedTime)`
- Miniboss: fixed intervals (first at 2 min, then every 1.5 min)
- Boss: 10 min with cycling system (different boss each run)
- Endless mode after boss defeat with escalating spawns

**Adding new enemy:**
1. Add definition to `ENEMY_TYPES` in `/src/enemies/EnemyTypes.ts` with stats, visual, spawn config
2. Add AI behavior in `/src/ecs/systems/EnemyAISystem.ts`
3. Add case to main AI update switch

**Boss Cycling:**
Static class property persists across scene reloads. Each run faces different boss in sequence.

### Key Patterns

**Adding entity types:**
1. Define components in `src/ecs/components/index.ts`
2. Create system in `src/ecs/systems/` following existing patterns
3. Call `setXXXScene()` to pass Phaser scene ref
4. Register system call in GameScene update loop

**Adding in-run upgrades:**
Add object to `upgrades` array in `src/data/Upgrades.ts` with `name`, `description`, `maxLevel`, `apply`. Break level gates at 3, 6, 9 (need player level thresholds). Level 10 grants mastery bonuses.

**Adding permanent upgrades (shop):**
1. Add upgrade object to `PERMANENT_UPGRADES` in `src/data/PermanentUpgrades.ts` (categories: offense, defense, movement, resources, utility, elemental, mastery)
2. Add level field to `PermanentUpgradeState` in `src/meta/MetaProgressionManager.ts`
3. Add `getStartingXXX()` method in MetaProgressionManager for stat bonus
4. Apply bonus in GameScene `create()` where meta bonuses applied

**Accessing entity data:**
Use bitECS queries + component arrays directly (e.g., `Transform.x[entity]`, `Health.current[entity]`)

### ECS-Phaser Bridge

Systems creating sprites need Phaser scene ref. Pattern:
1. Module-level var: `let sceneReference: Phaser.Scene | null = null`
2. Setter: `export function setXXXSystemScene(scene: Phaser.Scene)`
3. Call setter in GameScene `create()` before game loop
4. Use `registerSprite(entityId, sprite)` from SpriteSystem to link ECS → Phaser

**Sprite Registry Type:**
Union type `Phaser.GameObjects.Shape | Phaser.GameObjects.Graphics` — supports shape primitives + custom graphics.

### Audio Architecture

**Music** (`/src/audio/MusicManager.ts`): IBXM library for tracker music (.mod/.xm). Singleton via `getMusicManager()`. Playlist modes (sequential/shuffle/off) with SecureStorage persistence.

**Music Player** (`/src/audio/MusicPlayer.ts`): Low-level IBXM wrapper — AudioContext, GainNode, ScriptProcessor for single track.

**Music Catalog** (`/src/data/MusicCatalog.ts`): Metadata for 26 tracker files in `public/music/`.

**Sound Effects** (`/src/audio/SoundManager.ts`): Phaser audio for SFX. Pentatonic scale design. 50ms throttle between hits.

### Effects System

`EffectsManager` (`/src/effects/`) — visual juice with object pooling:
- Particle emitters: death bursts, hit sparks, XP sparkles
- Pooled damage numbers (50 pre-allocated)
- Death effect throttle (16ms) for 100+ enemies

`JuiceManager` (`/src/effects/JuiceManager.ts`) — game feel:
- Weapon wind-up/anticipation animations
- Hit stop (time scale manipulation)
- Screen shake coordination

### Visual System

`/src/visual/` — specialized visual managers:
- **GridBackground**: Animated grid with entity-reactive warping (SpatialHash O(1) lookups)
- **TrailManager**: Motion trails for player + fast enemies (pooled, 500 max)
- **GlowGraphics**: Neon glow with quality levels (Low/Medium/High/Ultra). Single Graphics object per shape.
- **NeonColors**: Cyberpunk color palette + utility functions
- **PlayerSpaceship**: Procedural neon spaceship — glow layers, thrust animation, smooth rotation, combo/danger color shifts
- **ShieldBarrierVisual**: Honeycomb shield effects for shielded enemies
- **MasteryVisuals**: 9 orbital effects for maxed stats (sword, lightning sparks, etc.)
- **MasteryIconEffectsManager**: Golden glow + sparkles for mastered upgrade icons in HUD
- **VisualQualityManager**: Auto-scales quality (high/med/low) by FPS to hold 60fps. Systems read quality to degrade effects.
- **DeathRippleManager**: Ripple waves from enemy deaths; flash overlays on hit enemies, ambient pulse on all. Quality-scaled (high: shape-matched, med: circle-only, low: no overlays). 50 pooled overlays, max 8 concurrent ripples. Tiered: regular→single ripple, miniboss→shockwave+flash, boss→staggered explosions+triple shockwaves+dual ripples+gold sparkles.
- **Gem3DRenderer**: 3D octahedron XP gems via transform matrices + painter's algorithm
- **DepthLayers**: Z-depth constants for render ordering

### Storage System

`SecureStorage` (`/src/storage/`) — drop-in localStorage replacement with async encryption (anti-cheat). `StorageBootstrap.initializeStorage()` must run in `main.ts` before managers — derives keys, pre-loads storage keys. Sync read/write, background encryption.

Used by: SettingsManager, MetaProgressionManager, AchievementManager, CodexManager, MusicManager, GameStateManager, GameScene

### Achievement & Codex Systems

**AchievementManager** (`/src/achievements/`): Singleton — run milestones + persistent achievements with rewards. `recordXXX()` → `checkMilestoneProgress()` → UI callbacks. Run-scoped milestones + persistent lifetime stats via SecureStorage.

**CodexManager** (`/src/codex/`): Singleton — discovered weapons/enemies/upgrades + global stats. `discoverXXX()` returns `boolean` (true if new), tracks usage. Calculates completion %.

### UI Systems

`/src/ui/`:
- **JoystickManager**: Virtual joystick for mobile touch. Scene-scoped. `getDirection()` for normalized vector. `setEnabled()` for pause/gameover/overlay.
- **ToastManager**: Queue-based notifications for achievements/milestones/events. Scene-scoped via WeakMap, `getToastManager(scene)`. Configurable styles/durations.

### Settings System

`SettingsManager` (`/src/settings/`) — SecureStorage persistence:
- SFX enabled/volume, screen shake, FPS counter, status text
- Damage numbers: `'all' | 'crits' | 'perfect_crits' | 'off'`
- UI scale: `0.5–2.0` (default 1.0), used by HudScale
- Music enabled/volume/playback mode
- Singleton via `getSettingsManager()`

### Save/Load System

`GameStateManager` (`/src/save/`) — run recovery after refresh:
- Serializes full state (player, enemies, pickups, weapons, timers)
- Auto-saves during gameplay
- Restore prompt on BootScene if save exists

### Meta-Progression System

`MetaProgressionManager` (`/src/meta/`) — persistent cross-run progression via SecureStorage:
- **Gold**: Earned per run from kills, time, level
- **Permanent upgrades**: Bought in ShopScene, applied at run start
- **Gold formula**: `(kills × 2.5) + (seconds ÷ 10) + (level × 10)` × victory (1.5×), gold upgrade, world level, streak bonuses
- **Upgrade costs**: `baseCost × costScaling^currentLevel`
- **World Level**: Cross-run difficulty. +15% enemy HP, +10% damage, faster elites, higher XP/gold multipliers per level
- **Win Streak**: Bonus gold for consecutive wins, cap 10 (50% bonus)
- **Account Level**: Sum of all permanent upgrade levels

**AscensionManager** (`/src/meta/AscensionManager.ts`): Prestige — account level hits threshold (base 50, +15/ascension) → reset shop for full refund + permanent stat (+10%) and gold (+15%) multipliers per level.

### Utility Systems

`/src/utils/`:
- **SpatialHash**: O(1) spatial queries, 80px grid cells. Singleton `getEnemySpatialHash()`, populated once/frame. Used by WeaponManager, weapons, GridBackground, FrameCache.
- **IconRenderer/IconMap**: Sprites from `public/icons/game-icons.png` atlas. IconMap: semantic key→frame for 60+ icons.
- **SceneTransition**: `fadeIn`, `fadeOut`, `addButtonInteraction` for scene transitions.
- **HudScale**: DPI-aware scaling (`/src/utils/HudScale.ts`). `computeHudScale()` for HUD, `computeMenuLayoutScale()`/`computeMenuFontScale()` for menus. `devicePixelRatio` aware (phones biggest boost, tablets moderate, desktop none). User multiplier 0.5–2.0.

### Combo System

`ComboSystem` (`/src/systems/ComboSystem.ts`) — consecutive kills, module-level state:
- **Decay**: 3s grace, then drains 15 kills/sec
- **Tiers**: none (0-9), warm (10-24), hot (25-49), blazing (50-99), inferno (100+)
- **Thresholds**: 25→XP burst, 50→+50% damage 8s, 100→annihilation (fire once per chain, reset at 0)
- **XP multiplier**: Linear 1.0→1.5 cap
- Save/restore: `getComboState()`/`restoreComboState()`
- Reset: `resetComboSystem()` in GameScene `create()`

### Event System

`EventSystem` (`/src/systems/EventSystem.ts`) — random in-run events, module-level state:
- **5 events**: Elite Surge (2x spawns/XP), Golden Tide (3x gems), Magnetic Storm (magnetize gems), Treasure Rain (chests), Power Surge (damage boost)
- **Timing**: 45-75s random interval, minGameTime gates (45s–120s)
- **Selection**: Weighted random, no immediate repeat
- **Suppression**: During boss warning (phase 2+) via `setSuppressEvents()`
- Save/restore: `getEventState()`/`restoreEventState()`
- Reset: `resetEventSystem()` in GameScene `create()`

### Post-Processing Pipelines

Two WebGL pipelines in `main.ts` (conditional on WebGL):
- **BloomPipeline** (`/src/visual/BloomPipeline.ts`): Bloom glow + vignette, 9-tap box blur
- **DistortionPipeline** (`/src/visual/DistortionPipeline.ts`): Screen distortion

### Mobile Support

`index.html` forces landscape on phones: portrait overlay prompts rotation (`@media (orientation: portrait) and (max-width: 767px)`). `100dvh` + `env(safe-area-inset-*)` for notched devices.

### Game Configuration

- **Game tuning**: Balance constants in `/src/data/GameTuning.ts` (`TUNING`) — spawn curves, boss timing, thresholds. Per-enemy stats in `EnemyTypes.ts`; per-weapon mastery in weapon classes.
- Screen: 1280×720 (`GameConfig.ts`), EXPAND mode
- Max enemies: 100
- XP: `10 × level^1.5` per level
- Damage invincibility: 0.5s
- Miniboss: first 2 min, then every 1.5 min
- Boss: 10 min

**Pause menu nav:** Arrow Up/Down or W/S navigate, Enter/Space select. Handler on show, cleanup on hide+shutdown.

## Tooling

- `tools/build-icon-atlas.cjs` — Build icon spritesheet from SVGs in `tools/icon-sources/` (sharp)
- `tools/download-icons.sh` — Download icon SVGs from game-icons.net

## Development Guidelines

**Parallel code path consistency:** New code paths achieving similar outcomes to existing ones must handle same cleanup, state changes, side effects. Review existing paths first. Bugs arise when new paths miss steps.

**System state reset:** Every system with module-level state needs `reset*System()` called in GameScene `create()`. Stale state carries over between runs otherwise.

**Scene shutdown listener:** Register `this.events.once('shutdown', this.shutdown, this)` in `create()`. Phaser won't auto-call shutdown on restart → listener accumulation + memory leaks.

**Sprite registration pairs:** Always `registerSprite(entityId, sprite)` on create, `unregisterSprite(entityId)` on remove. ECS-Phaser bridge must stay synced.

**Query once per frame:** `updateFrameCache()` once at update start, then `getEnemyIds()`/`getNearestEnemy()`. Per-system queries cause excess allocations.

**Object pooling:** Pre-allocate pools for frequent objects (damage numbers, projectiles, trails). Create/destroy with 100+ enemies causes GC stalls.

**Delta time conversion:** Phaser delta in ms. `delta * 0.001` for seconds.

**Entity removal order:** Destroy sprite + `unregisterSprite()` BEFORE `removeEntity()`. Entity-first orphans sprite.

**Tween cleanup:** `this.tweens.killAll()` in shutdown. Tweens run after scene restart otherwise.

**Encrypted storage:** All persistent data must use `SecureStorage` from `/src/storage/`, not raw `localStorage`.