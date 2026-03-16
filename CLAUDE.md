# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build & Development Commands

- `npm run dev` - Start Vite development server with hot reload
- `npm run build` - TypeScript check and production build
- `npm run preview` - Preview production build locally

No lint or test commands are currently configured.

## Deployment

- **GitHub Pages**: Auto-deploys on push to `main` via `.github/workflows/deploy.yml` (Node 20)
- **Vite config**: Base path `/game/`, output to `dist/`

## Architecture Overview

This is a 2D roguelike survival game built with **Phaser 3** for rendering and **bitECS** for entity management.

### ECS Architecture

The game uses an Entity-Component-System pattern where:
- **Components** (`/src/ecs/components/index.ts`) define data schemas — 19 components total including Transform, Velocity, Health, Weapon, EnemyAI, EnemyType, Knockback, StatusEffect, and tag components
- **Systems** (`/src/ecs/systems/`) contain game logic that operates on entities with specific components
- **SpriteRef** component bridges ECS entities to Phaser sprites for rendering

Systems execute in this fixed order each frame (from `GameScene.update()`):
```
updateFrameCache → Timer/spawn updates → Laser beams → Joystick input →
InputSystem → EnemyAISystem → MovementSystem → processKnockback → clampPlayerToScreen →
WeaponManager.update → XPGemSystem → HealthPickupSystem → MagnetPickupSystem →
StatusEffectSystem → Enemy Projectiles → Player-Enemy Collision → SpriteSystem →
PlayerPlasmaCore → GridBackground → Trails → EffectsManager → VisualQuality → UI
```
Note: Knockback, collision, and visual updates are processed inline in GameScene rather than as separate system files.

### Scene Flow

```
BootScene (start screen + music)
  ├─→ GameScene (core gameplay) ─→ UpgradeScene (level-up modal, overlay)
  ├─→ ShopScene (permanent upgrades, returns to BootScene)
  ├─→ SettingsScene (SFX, visual settings, returns to BootScene)
  ├─→ MusicSettingsScene (BGM settings, returns to BootScene)
  ├─→ AchievementScene (achievement viewer, returns to BootScene)
  ├─→ CodexScene (encyclopedia/bestiary, returns to BootScene)
  └─→ CreditsScene (attribution, returns to BootScene)
```

All 9 scenes live in `/src/game/scenes/`.

### Weapon System

The game features 14 unique weapons managed by `WeaponManager` (`/src/weapons/WeaponManager.ts`).

**Architecture:**
- `BaseWeapon` abstract class provides common functionality (cooldowns, upgrades, scene reference)
- Each weapon extends `BaseWeapon` and implements `fire()` and `update()` methods
- WeaponManager stores active weapons and calls their update methods each frame

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

**Adding a new weapon:**
1. Create a new class extending `BaseWeapon` in `/src/weapons/`
2. Implement `fire()` for attack logic and `update(deltaTime)` for continuous effects
3. Export from `/src/weapons/index.ts` and add to `WeaponRegistry`
4. Add to the upgrades system in `src/data/Upgrades.ts` to make it unlockable

**Weapon Factory:**
`WeaponRegistry` in `/src/weapons/index.ts` maps weapon IDs to factory functions. Use `createWeapon(weaponId)` to instantiate weapons by string ID.

### Enemy Variety System

The game features 26 enemy type definitions in `/src/enemies/EnemyTypes.ts`:
- **9 Basic** (Shambler, Zigzag Runner, Dasher, Circler, Tiny Swarm, Exploder, Splitter Mini, Ghost, Turret)
- **8 Elite** (Tank, Splitter, Shooter, Sniper, Healer, Shielded, Teleporter, Giant)
- **6 Miniboss** (The Glutton, Swarm Mother, The Charger, Necromancer, Twin Alpha, Twin Beta)
- **3 Boss** (The Horde King, Void Wyrm, The Machine)

Note: Ghost and Turret are spawned-only types (created by minibosses/bosses, not natural spawns). Twins spawn as a linked pair.

**EnemyAI Component:**
```typescript
EnemyAI: { aiType, state, timer, targetX, targetY, shootTimer, specialTimer, phase }
```

**AI Types (EnemyAIType enum):**
- **Regular (0-13):** Chase, Zigzag, Dash, Circle, Swarm, Tank, Exploder, Splitter, Shooter, Sniper, Healer, Shielded, Teleporter, Giant
- **Miniboss (50-55):** Glutton, SwarmMother, Charger, Necromancer, TwinA, TwinB
- **Boss (100-102):** HordeKing, VoidWyrm, TheMachine

**Spawn System:**
- Regular enemies spawn based on time-weighted probabilities via `getRandomEnemyType(elapsedTime)`
- Minibosses spawn at fixed intervals (first at 2 min, then every 1.5 min)
- Bosses spawn at 10 minutes with cycling system (different boss each run)

**Adding a new enemy type:**
1. Add definition to `ENEMY_TYPES` in `/src/enemies/EnemyTypes.ts` with stats, visual, and spawn config
2. Add AI behavior function in `/src/ecs/systems/EnemyAISystem.ts`
3. Add case to the switch statement in the main AI update loop

**Boss Cycling:**
Bosses cycle via a static class property that persists across scene reloads. Each run faces a different boss in sequence.

### Key Patterns

**Adding new entity types:**
1. Define components in `src/ecs/components/index.ts`
2. Create a system in `src/ecs/systems/` following existing patterns
3. Call `setXXXScene()` to pass the Phaser scene reference to the system
4. Register the system call in GameScene's update loop

**Adding in-run upgrades:**
Add an object to the `upgrades` array in `src/data/Upgrades.ts` with `name`, `description`, `maxLevel`, and `apply` function. Upgrades have break level gates at levels 3, 6, and 9 (require player level thresholds), and level 10 grants mastery bonuses.

**Adding permanent upgrades (shop):**
1. Add a new upgrade object to `PERMANENT_UPGRADES` in `src/data/PermanentUpgrades.ts` (categories: offense, defense, movement, resources, utility, elemental, mastery)
2. Add corresponding level field to `PermanentUpgradeState` interface in `src/meta/MetaProgressionManager.ts`
3. Add a `getStartingXXX()` method in MetaProgressionManager to calculate the stat bonus
4. Apply the bonus in GameScene's `create()` method where meta bonuses are applied

**Accessing entity data:**
Use bitECS queries and component arrays directly (e.g., `Transform.x[entity]`, `Health.current[entity]`)

### ECS-Phaser Bridge

Systems that create sprites need a Phaser scene reference. The pattern is:
1. Module-level variable: `let sceneReference: Phaser.Scene | null = null`
2. Setter function: `export function setXXXSystemScene(scene: Phaser.Scene)`
3. Call setter in GameScene's `create()` before the game loop starts
4. Use `registerSprite(entityId, sprite)` from SpriteSystem to link ECS entities to Phaser sprites

**Sprite Registry Type:**
The sprite registry uses union type `Phaser.GameObjects.Shape | Phaser.GameObjects.Graphics` to support both shape primitives and custom graphics.

### Audio Architecture

**Music** (`/src/audio/MusicManager.ts`): Uses IBXM library for tracker music (.mod/.xm files). Singleton pattern via `getMusicManager()`. Supports playlist modes (sequential/shuffle/off) with localStorage persistence.

**Music Player** (`/src/audio/MusicPlayer.ts`): Low-level IBXM wrapper that handles AudioContext, GainNode, and ScriptProcessor for single track playback.

**Music Catalog** (`/src/data/MusicCatalog.ts`): Track metadata for the 25 tracker music files in `public/music/`.

**Sound Effects** (`/src/audio/SoundManager.ts`): Standard Phaser audio for SFX (hit, pickup, level-up sounds). Uses pentatonic scale for harmonious design. Sound throttling (50ms minimum between hits).

### Effects System

`EffectsManager` (`/src/effects/`) handles visual juice with object pooling:
- Particle emitters for death bursts, hit sparks, XP sparkles
- Pooled floating damage numbers (50 pre-allocated)
- Throttling on death effects (16ms cooldown) for performance with 100+ enemies

`JuiceManager` (`/src/effects/JuiceManager.ts`) provides game feel effects:
- Weapon wind-up/anticipation animations
- Hit stop (time scale manipulation)
- Screen shake coordination

### Visual System

`/src/visual/` contains specialized visual effects managers:
- **GridBackground**: Animated grid with entity-reactive warping effect (uses SpatialHash for O(1) lookups)
- **TrailManager**: Motion trails behind player and fast enemies (pooled trail points, 500 max)
- **GlowGraphics**: Neon glow rendering with quality levels (Low/Medium/High/Ultra). Single Graphics object per shape for performance.
- **NeonColors**: Consistent color palette for the cyberpunk aesthetic, with utility functions for color manipulation
- **PlayerPlasmaCore**: Player visual — 100 glowing particles in dual-ring formation with breathing, scatter, and speed-based glow effects
- **ShieldBarrierVisual**: Honeycomb pattern shield effects for shielded enemies
- **MasteryVisuals**: 9 unique orbital visual effects for maxed stats (orbiting sword, lightning sparks, etc.)
- **MasteryIconEffectsManager**: Golden glow and sparkle particles for mastered upgrade icons in HUD
- **DeathRippleManager**: Expanding ripple waves from enemy death locations with quality scaling
- **Gem3DRenderer**: 3D octahedron rendering for XP gems using transformation matrices and painter's algorithm

### UI Systems

`/src/ui/` provides user interface components:
- **JoystickManager**: Virtual joystick for mobile/touch input. Dynamic spawn at touch point, outputs normalized direction vector.
- **ToastManager**: Queue-based notification system for achievements, milestones, and events. Configurable styles and durations.

### Achievements System

`/src/achievements/` tracks and unlocks 30+ achievements:
- **AchievementManager**: Singleton that tracks progress, checks conditions, and unlocks achievements. Persistent via SecureStorage.
- **AchievementDefinitions**: All achievement definitions with conditions and rewards
- **MilestoneDefinitions**: Stat-based milestones (kills, time survived, etc.)
- **AchievementScene**: UI scene accessible from BootScene for viewing unlocked achievements

### Codex System

`/src/codex/` provides an in-game encyclopedia:
- **CodexManager**: Tracks discovered weapons, enemies, and upgrades. Records playtime, kills, damage, victories, and world level progression. Persistent via SecureStorage.
- **CodexScene**: UI scene accessible from BootScene for browsing codex entries

### Storage System

`/src/storage/` provides encrypted persistence (anti-cheat):
- **SecureStorage**: Encrypted localStorage wrapper — all persistent game data flows through this
- **StorageBootstrap**: Initialization and migration logic
- **StorageEncryption**: Encryption/decryption utilities

Used by: SettingsManager, MetaProgressionManager, AchievementManager, CodexManager

### Settings System

`SettingsManager` (`/src/settings/`) persists user preferences via SecureStorage:
- SFX enabled/volume, screen shake, FPS counter, status text
- Damage numbers mode: `'all' | 'crits' | 'perfect_crits' | 'off'`
- Music enabled/volume/playback mode
- Singleton via `getSettingsManager()`

### Save/Load System

`GameStateManager` (`/src/save/`) enables run recovery after page refresh:
- Serializes full game state (player, enemies, pickups, weapons, timers)
- Auto-saves periodically during gameplay
- Prompts to restore on BootScene if save exists

### Meta-Progression System

`MetaProgressionManager` (`/src/meta/`) handles persistent cross-run progression using SecureStorage:
- **Gold currency**: Earned after each run based on kills, time survived, and player level
- **Permanent upgrades**: Purchased in ShopScene, applied at run start in GameScene
- **Gold formula**: `(kills × 2.5) + (seconds ÷ 10) + (level × 10)`, multiplied by victory (1.5×), gold upgrade, world level, and streak bonuses
- **Upgrade costs**: Scale exponentially — `baseCost × costScaling^currentLevel`
- **World Level**: Cross-run difficulty scaling. Each level adds +15% enemy HP, +10% enemy damage, reduces elite spawn time, and increases XP/gold multipliers
- **Win Streak**: Bonus gold for consecutive victories, capped at 10 streaks (50% bonus)
- **Account Level**: Sum of all permanent upgrade levels

### Utility Systems

`/src/utils/` provides shared utilities:
- **SpatialHash**: O(1) spatial queries via grid bucketing. Used by GridBackground and collision checks to avoid O(n²) comparisons.
- **IconRenderer/IconMap**: Icon sprite creation from the `public/icons/game-icons.png` atlas. IconMap provides semantic key-to-frame mappings for 60+ icons.

### Game Configuration

- Screen: 1280×720 (defined in `GameConfig.ts`), scales with FIT mode (min 640×360)
- Max enemies: 100 concurrent
- XP formula: `10 × level^1.5` for next level
- Damage invincibility: 0.5 seconds
- Miniboss spawn: First at 2 min, then every 1.5 min
- Boss spawn: 10 minutes

## Tooling

- `tools/build-icon-atlas.cjs` — Builds icon sprite sheet from SVG sources in `tools/icon-sources/` (uses sharp)
- `tools/download-icons.sh` — Downloads icon SVGs from game-icons.net

## Development Guidelines

**Parallel code path consistency:** When adding a new code path that achieves a similar outcome to existing paths (e.g., a new way to end a run, spawn an enemy, or award currency), always review what the existing paths do and ensure the new path handles the same cleanup, state changes, and side effects. Bugs often arise when new paths miss steps that existing ones perform.

**System state reset:** Every system with module-level state needs a `reset*System()` function called in GameScene's `create()`. Without this, stale state carries over between runs.

**Scene shutdown listener:** Register `this.events.once('shutdown', this.shutdown, this)` in `create()`. Phaser doesn't auto-call shutdown on restart, causing event listener accumulation and memory leaks.

**Sprite registration pairs:** Always call `registerSprite(entityId, sprite)` when creating and `unregisterSprite(entityId)` when removing. This ECS-Phaser bridge must stay in sync.

**Query once per frame:** Call `updateFrameCache()` once at update start, then use `getEnemyIds()` and `getNearestEnemy()`. Independent queries in each system cause excessive allocations.

**Object pooling:** Pre-allocate pools for frequent objects (damage numbers, projectiles, trails). Creating/destroying with 100+ enemies causes GC stalls.

**Delta time conversion:** Phaser passes delta in milliseconds. Convert with `delta * 0.001` for physics/timers expecting seconds.

**Entity removal order:** Destroy sprite and `unregisterSprite()` BEFORE `removeEntity()`. Removing entity first orphans the sprite.

**Tween cleanup:** Call `this.tweens.killAll()` in shutdown to stop tweens from running after scene restart.

**Encrypted storage:** All persistent data (settings, meta-progression, achievements, codex) must use `SecureStorage` from `/src/storage/`, not raw `localStorage`.
