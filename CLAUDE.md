# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build & Development Commands

- `npm run dev` - Start Vite development server with hot reload
- `npm run build` - TypeScript check and production build
- `npm run preview` - Preview production build locally

No lint or test commands are currently configured.

## Architecture Overview

This is a 2D roguelike survival game built with **Phaser 3** for rendering and **bitECS** for entity management.

### ECS Architecture

The game uses an Entity-Component-System pattern where:
- **Components** (`/src/ecs/components/index.ts`) define data schemas (Transform, Velocity, Health, Weapon, EnemyAI, etc.)
- **Systems** (`/src/ecs/systems/`) contain game logic that operates on entities with specific components
- **SpriteRef** component bridges ECS entities to Phaser sprites for rendering

Systems execute in this fixed order each frame:
```
InputSystem → EnemyAISystem → MovementSystem → Knockback → WeaponManager.update →
XPGemSystem → HealthPickupSystem → MagnetPickupSystem → StatusEffectSystem →
Enemy Projectiles → Player-Enemy Collision → SpriteSystem
```
Note: Knockback and collision are processed inline in GameScene rather than as separate systems.

### Scene Flow

```
BootScene (start screen + music)
  ├─→ GameScene (core gameplay) ─→ UpgradeScene (level-up modal, overlay)
  ├─→ ShopScene (permanent upgrades, returns to BootScene)
  ├─→ SettingsScene (SFX, visual settings, returns to BootScene)
  ├─→ MusicSettingsScene (BGM settings, returns to BootScene)
  └─→ CreditsScene (attribution, returns to BootScene)
```

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

The game features 13 regular enemies, 5 minibosses, and 3 bosses defined in `/src/enemies/EnemyTypes.ts`.

**EnemyAI Component:**
```typescript
EnemyAI: { aiType, state, timer, targetX, targetY, shootTimer, specialTimer, phase }
```

**AI Types (EnemyAIType enum):**
- **Basic (0-12):** Chaser, Shooter, Charger, Tank, Exploder, Splitter, Healer, Teleporter, Shielded, Ranged, Swarm, Flanker, Ambusher
- **Miniboss (50-54):** Glutton, SwarmMother, Charger, Necromancer, Twin
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
Add an object to the `upgrades` array in `src/data/Upgrades.ts` with `name`, `description`, `maxLevel`, and `apply` function.

**Adding permanent upgrades (shop):**
1. Add a new upgrade object to `PERMANENT_UPGRADES` in `src/data/PermanentUpgrades.ts`
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

**Sound Effects** (`/src/audio/SoundManager.ts`): Standard Phaser audio for SFX (hit, pickup, level-up sounds).

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
- **GridBackground**: Animated grid with entity-reactive warping effect
- **TrailManager**: Motion trails behind player and fast enemies (pooled trail points)
- **GlowGraphics**: Neon glow rendering with quality levels (Low/Medium/High/Ultra)
- **NeonColors**: Consistent color palette for the cyberpunk aesthetic
- **PlayerPlasmaCore**: Player visual with squash/stretch, fins, and breathing animations
- **ShieldBarrierVisual**: Shield effects for shielded enemies
- **MasteryVisuals/MasteryIconEffectsManager**: Visual flair for mastered upgrades

### Settings System

`SettingsManager` (`/src/settings/`) persists user preferences via localStorage:
- SFX enabled/volume, screen shake, FPS counter
- Damage numbers mode: `'all' | 'crits' | 'perfect_crits' | 'off'`
- Singleton via `getSettingsManager()`

### Save/Load System

`GameStateManager` (`/src/save/`) enables run recovery after page refresh:
- Serializes full game state (player, enemies, pickups, weapons, timers)
- Auto-saves periodically during gameplay
- Prompts to restore on BootScene if save exists

### Meta-Progression System

`MetaProgressionManager` (`/src/meta/`) handles persistent cross-run progression using localStorage:
- **Gold currency**: Earned after each run based on kills, time survived, and player level
- **Permanent upgrades**: Purchased in ShopScene, applied at run start in GameScene
- Gold formula: `(kills × 2) + (seconds ÷ 10) + (level × 10)`, with 1.5× multiplier on victory
- Upgrade costs scale exponentially: `baseCost × costScaling^currentLevel`

### Game Configuration

- Screen: 1280×720 (defined in `GameConfig.ts`)
- Max enemies: 100 concurrent
- XP formula: `10 × level^1.5` for next level
- Damage invincibility: 0.5 seconds
- Miniboss spawn: First at 2 min, then every 1.5 min
- Boss spawn: 10 minutes

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
