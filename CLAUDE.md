# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Backlog & Task Tracking

`BACKLOG.md` (repo root) is the single source of truth for deferred work, known
issues, and improvement ideas. **At the start of a session, read it** and propose
which items to tackle. When you finish work, move the item to its Changelog with
the commit hash; when you discover new follow-ups or cuts, append them immediately
so nothing lives only in conversation. The human drives prioritization.

## Build & Development Commands

- `npm run dev` - Start Vite dev server with hot reload
- `npm run build` - TypeScript check + production build
- `npm run preview` - Preview production build locally
- `npm run test` - Run the Vitest unit suite once (`test:watch` for watch mode)

No lint command configured. Tests use **Vitest** (`vitest.config.ts`, Node env). Coverage
is thin — pure logic only (e.g. ECS save/load serialization); Phaser-coupled code is
exercised by mocking its module boundary, not a live scene. Add a failing test first for
new logic where it can run without a real Phaser scene.

## Deployment

- **GitHub Pages**: Auto-deploys on push to `master` via `.github/workflows/deploy.yml` (Node 20)
- **Vite config**: Base path `/`, output to `dist/`

## Architecture Overview

2D roguelike survival game. **Phaser 3** for rendering, **bitECS** for entity management.

### Player Visual Identity

**Player is procedurally-drawn neon spaceship** via `PlayerSpaceship` (`/src/visual/PlayerSpaceship.ts`). No sprite asset — delta/arrow hull drawn with Phaser Graphics. Multi-layer neon glow, engine thrust flames scale with speed, smooth rotation toward movement. Hull color shifts with combo tier (warm/hot/blazing/inferno), danger (red at low HP), speed (warm-white tint). Level-ups trigger flash + scale pulse. Glow layers scale with quality setting.

### ECS Architecture

Entity-Component-System pattern:
- **Components** (`/src/ecs/components/index.ts`) — data schemas: Transform, Velocity, Health, Weapon, Projectile, EnemyAI, EnemyType, Knockback, StatusEffect, `EnemyAffix` (elite affix), `Consumable`/`ConsumablePickupTag` (floor power-ups), `Destructible` (crates), tag components
- **Systems** (`/src/ecs/systems/`) — game logic operating on entities with specific components
- **SpriteRef** bridges ECS entities to Phaser sprites

Fixed system execution order per frame (from `GameScene.update()`):
```
updateFrameCache → Slow time → Achievement tracking → Auto-save →
Shield barrier recharge → Dash ability → Gem magnet → Treasure chest spawning →
HP regen → Emergency heal → Magnet spawn timer →
Enemy/miniboss/boss/endless spawning → ComboSystem decay →
updateBossArena → updateHazardZones → updateHazardSpawner → EventSystem →
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
BootScene (start screen + music + daily challenge + ship picker)
  ├─→ WeaponSelectScene (pre-run weapon pick, skips if only default discovered)
  │     └─→ PactSelectScene (optional pre-run curses for bigger rewards)
  │           └─→ GameScene (core gameplay) ─→ UpgradeScene (level-up modal, overlay)
  ├─→ ShopScene (permanent upgrades, returns to BootScene)
  ├─→ AchievementScene (achievements & milestones, returns to BootScene)
  ├─→ CodexScene (discovered weapons/enemies/upgrades, returns to BootScene)
  ├─→ LeaderboardScene (daily challenge leaderboard, returns to BootScene)
  ├─→ SettingsScene (SFX, visual settings, returns to BootScene)
  ├─→ MusicSettingsScene (BGM settings, returns to BootScene)
  └─→ CreditsScene (attribution, returns to BootScene)
```

12 scenes in `/src/game/scenes/`, registered in `src/main.ts`. `WeaponSelectScene` shows discovered weapons from Codex for starting weapon pick; auto-skips to GameScene with default projectile if only one discovered. Both weapon-select exits route through `PactSelectScene` (player may pick 0–3 pacts, then it starts GameScene with `pactIds`). Daily-challenge / save-restore paths bypass the pact picker.

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

**Elite Affix System** (`src/data/Affixes.ts` + `EnemyAffix` component): natural
regular spawns (xp < 30, excluding spawned-only minions) have ~12% chance to roll one
affix — SWIFT / VOLATILE (explodes on death) / VAMPIRIC (heals on hitting player) /
TITAN (tanky) / BLESSED (guaranteed consumable drop). Rolled in `GameScene.createEnemy`
(scales HP/XP/speed/armor); vampiric in `checkPlayerEnemyCollision`; volatile/blessed in
`handleEnemyDeath` (volatile detonations are drained iteratively via `volatileQueue` to
avoid recursion). Marked by `EliteAffixVisualManager` (`/src/visual/`) — pooled ring +
floating mini HP bar + label (the only non-boss enemies with a health bar). Reset: the
manager is recreated per scene; no module reset needed.

**Attack Telegraphs** (`/src/effects/TelegraphManager.ts`): pooled, quality-aware windup
indicators (swept lines for dash/charge, rings for AOE slams) drawn before dangerous
enemy attacks. Injected into `EnemyAISystem` via `setTelegraphManager`; hooked at the
Dasher dash-start, Charger charge-prep, and Warden ground-slam windups. Pure readability
(no damage/timing change). `DepthLayers.ATTACK_TELEGRAPH`.

**Environmental Destructibles** (`Destructible` component): crates spawn on the field
(GameScene `spawnDestructible`, capped at 6). They reuse the EnemyTag pipeline so weapons
auto-target + destroy them, but have **no EnemyAI** (stationary) and deal no contact
damage. Special-cased early in `handleEnemyDeath` (loot + AOE, no kill/combo/XP), skipped
in `checkPlayerEnemyCollision`, in `DeathRippleManager` (bare Graphics, not a Container),
in Healer/Tank/Rallier auras (`EnemyAISystem.isDestructible`), and excluded from save
serialization. On destruction they burst (`WeaponManager.detonateArea`) + drop loot.

**Floor Consumables** (`/src/ecs/systems/ConsumablePickupSystem.ts` + `Consumable`):
rare pooled walk-to pickups mirroring HealthPickup/MagnetPickup — BOMB (screen AOE via
`WeaponManager.detonateArea`), FREEZE (freeze all on-screen), VACUUM (magnetize gems +
health), GOLD (instant gold cache). Dropped on enemy death + bosses + destructibles +
blessed elites + bounty rewards + the Fortune shrine. GameScene owns activation via
`setConsumableCollectCallback`; reset via `resetConsumablePickupSystem`.

**Field Shrines & Bounties** (GameScene-owned, reset in `resetInRunFeatureState`, called
on BOTH fresh + restore paths): walk-in shrines (`SHRINE_DEFS`: Cleanse/Power/Fortune/
Sacrifice — Sacrifice mutates ECS `Health.current`, not just PlayerStats) and rotating
bounties (`BountyKind`: kills / elites / flawless) with a HUD banner and consumable+gold
rewards. Both mirror the treasure-chest pattern (Phaser graphics + proximity polling).
These are **distinct** from the random "Shrine of Sacrifice" EventSystem event.

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
- Regular: `DirectorSystem` (`/src/systems/DirectorSystem.ts`) — credit-budget director (Risk of Rain 2 inspired). Credits accrue per second; each enemy has a spawn cost. Strategy randomized per run (`swarm` / `elite` / `balanced` / `chaos`) for variance. Module-level state — call `resetDirectorSystem()` in GameScene `create()`. Falls back to `getRandomEnemyType(elapsedTime)` weights scaled by strategy's basic/elite multipliers.
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

**Limit Break / Overflow upgrades** (`src/data/LimitBreakUpgrades.ts`): repeatable,
gate-free upgrades (`isOverflow: true`, `maxLevel` 999) folded into the run upgrade pool
by `createUpgrades()`. `getRandomCombinedUpgrades` filters them out of normal selection and
only surfaces them via `padWithOverflow` when the normal pool can't fill the modal (so a
late-game level-up is never dead). Styled gold "LIMIT BREAK" in UpgradeScene. Auto-buy
scores them modestly so they don't starve weapon level-ups.

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

**Music** (`/src/audio/MusicManager.ts`): IBXM library for tracker music (.mod/.xm). Singleton via `getMusicManager()`. Owns AudioContext + ScriptProcessor + GainNode directly. Playlist modes (sequential/shuffle/off) with SecureStorage persistence. IBXM itself is loaded as a non-module global from `public/lib/IBXM.js` via a `<script>` tag in `index.html` (before the main module), so `MusicManager` consumes it through ambient `declare class` declarations.

**Music Catalog** (`/src/data/MusicCatalog.ts`): Metadata for 26 tracker files in `public/music/`.

**Sound Effects** (`/src/audio/SoundManager.ts`): Phaser audio for SFX. Pentatonic scale design. 50ms throttle between hits.

**Dynamic Music Intensity** (`/src/audio/MusicIntensityDriver.ts`): per-frame driver reads combo/enemy-density/player-danger/boss-active and ramps `MusicManager.setIntensity()` — a multiplier *layered on top of* the user volume (effective gain = volume × intensity), never persisted. `resetMusicIntensityDriver()` (in `resetAllRunSystems` + shutdown) restores intensity to 1.0 so menus play at the user's volume.

### Effects System

`EffectsManager` (`/src/effects/`) — visual juice with object pooling:
- Particle emitters: death bursts, hit sparks, XP sparkles
- Pooled damage numbers (50 pre-allocated)
- Death effect throttle (16ms) for 100+ enemies

`JuiceManager` (`/src/effects/JuiceManager.ts`) — game feel:
- Weapon wind-up/anticipation animations
- Hit stop (time scale manipulation)
- Screen shake coordination

`ImpactCallouts` (`/src/effects/ImpactCallouts.ts`) — punchy "BAM!/POW!/CRIT!" starburst + text manager. Pooled, rate-limited (`hit` kind throttled). Kinds: `hit`, `crit`, `perfect`, `kill`, `comboTier`, `levelUp`, `bossSpawn`, `evolution`, `eventStart`. Hooked via `WeaponManager.damageEnemy`, `ComboSystem`, `GameScene`.

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
- **OffScreenIndicatorManager**: Edge arrows pointing to off-screen bosses/minibosses/pickups
- **LightingSystem**: Dynamic lighting overlay for entities
- **EnemyVisuals**: Centralized per-enemy procedural draw routines (25 enemy types)
- **ProjectileAtlasRenderer**: Pre-renders projectile shapes into texture atlases via `generateProjectileAtlases(scene)`. Projectiles become Image sprites using shared frames so hundreds batch into a single draw call (mirrors `Gem3DRenderer` pattern). `destroyProjectileAtlases(scene)` on shutdown.
- **StatusEffectVisualManager**: Pooled burn/freeze/poison overlays on enemies. Queries `[EnemyTag, StatusEffect, Transform]`, packs draw state per entity to skip redundant redraws. Quality-aware.

### Storage System

`SecureStorage` (`/src/storage/`) — drop-in localStorage replacement with async encryption (anti-cheat). `StorageBootstrap.initializeStorage()` must run in `main.ts` before managers — derives keys, pre-loads storage keys. Sync read/write, background encryption.

Used by: SettingsManager, MetaProgressionManager, AchievementManager, CodexManager, MusicManager, GameStateManager, GameScene

### Achievement & Codex Systems

**AchievementManager** (`/src/achievements/`): Singleton — run milestones + persistent achievements with rewards. Definitions live in `AchievementDefinitions.ts` (persistent) and `MilestoneDefinitions.ts` (run-scoped). `recordXXX()` → `checkMilestoneProgress()` → UI callbacks. Persistent lifetime stats via SecureStorage.

**CodexManager** (`/src/codex/`): Singleton — discovered weapons/enemies/upgrades + global stats. `discoverXXX()` returns `boolean` (true if new), tracks usage. Calculates completion %.

### UI Systems

`/src/ui/`:
- **JoystickManager**: Virtual joystick for mobile touch. Scene-scoped. `getDirection()` for normalized vector. `setEnabled()` for pause/gameover/overlay.
- **TouchActionButtons**: Mobile touch action buttons (dash, etc.). Scene-scoped, mirrors JoystickManager lifecycle.
- **ToastManager**: Queue-based notifications for achievements/milestones/events. Scene-scoped via WeakMap, `getToastManager(scene)`. Configurable styles/durations.
- **TooltipManager**: Hover/long-press tooltips for menu items.

`/src/input/`:
- **GamepadManager**: Standard gamepad support — left stick → movement, face buttons → menu nav.
- **MenuNavigator**: Shared keyboard/gamepad navigation logic for menu-style scenes (Shop, Codex, Settings, etc.).

`/src/game/managers/`:
- **HUDManager**: Owns HUD layer (HP bar, XP bar, timer, combo, weapon icons). Lifecycle tied to GameScene.
- **InputController**: Per-frame input aggregation — keyboard, mouse, joystick, gamepad — into a unified movement/action vector consumed by `InputSystem`.
- **PauseMenuManager**: Pause menu state and navigation handler (Arrow/W-S nav, Enter/Space select). Handler attached on show, cleaned on hide + scene shutdown.

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

**RelicManager** (`/src/meta/RelicManager.ts`) + `src/data/Relics.ts`: Per-run passive items, max 6 equipped. Dropped by chests/minibosses/events. Rarity weights (common/rare/epic/legendary). `apply(stats)` mutates `PlayerStats` on pickup. Not persisted — resets each run via `reset()` in GameScene `create()`.

**HiddenUnlockManager** (`/src/meta/HiddenUnlocks.ts`): Secret-condition unlocks for weapons, ships, cosmetics, stages. `evaluatePostRun(context, lifetimeStats)` checks predicates after each run; fires toast callback on new unlock. Progress-tracking variant surfaces "closest to unlock" post-run panel. Persisted via SecureStorage.

**DailyChallengeManager** (`/src/meta/DailyChallengeManager.ts`): Date-seeded daily runs with local leaderboard. UTC-date → deterministic seed (FNV-1a + mulberry32) → picks 3 modifiers + starting weapon + ship + difficulty. Weekly challenge (Monday) uses 4 modifiers. Leaderboard rolls over at UTC midnight.

**Ships / Characters** (`src/data/ShipCharacters.ts`): Playable ship definitions — starting weapon, stat multipliers (HP/speed/damage/cooldown/XP/gold), neon color palette (`cyan` / `red` / `green` / `gold` / `purple` / `white` / `pink`) applied to `PlayerSpaceship`. Unlocked via account level or `HiddenUnlockManager`.

**Stages / Biomes** (`src/data/Stages.ts`): Selectable biomes — grid colors, ambient overlay, enemy HP/damage multipliers, XP/gold multipliers. Default always available; others gated by `hidden:<id>` or `worldLevel:<n>`.

**Run Modifiers** (`src/data/RunModifiers.ts`): Pool of per-run modifiers (`offense` / `defense` / `resources` / `chaos`). Each run selects 1-2; each `apply(stats: PlayerStats)` mutates `PlayerStats` at run start. Surfaced briefly during run intro.

**Pacts** (`src/data/Pacts.ts` + `PactSelectScene`): player-chosen pre-run curses (up to `MAX_PACTS`=3) — harder run for bigger rewards. Each `apply(stats)` works purely through existing `PlayerStats` fields (`curseMultiplier` scales enemy HP/damage/XP; `goldMultiplier`/`xpMultiplier` scale rewards; maxHealth/healingBoost/iframeDuration tune fragility) — no spawn-director/enemy-stat surgery. Applied on fresh runs only (restore keeps the baked-in PlayerStats). **Note:** `PlayerStats.goldMultiplier` is read by `MetaProgressionManager.calculateRunGold(..., runGoldMultiplier)` (also carries ship/stage gold bonuses).

**Performance Grade + Best Score** (`src/utils/PerformanceGrade.ts` + `src/meta/BestScoreManager.ts`): the game-over results overlay (`PauseMenuManager.gameOver`) shows an S–F grade (baseline-scaled by world level, +1 tier on victory) and a per-run best score persisted by world level via SecureStorage (key `survivor-best-scores`, registered in `StorageBootstrap.ALL_STORAGE_KEYS`).

**Weapon Synergies** (`src/data/WeaponSynergies.ts`): Passive bonuses when a specific weapon pair is equipped (damage and cooldown multipliers applied to both weapons). Build-crafting layer beyond raw DPS.

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

### Hazard Zone System

`HazardZoneSystem` (`/src/systems/HazardZoneSystem.ts`) — module-level state, no class. Temporary battlefield zones with 4 types: `burn` (DoT), `ice` (slows enemies, returns slow multiplier per frame via `applyIceHazardSlow()` during enemy movement), `void` (pulls enemies inward), `energy` (player damage boost while inside). Spawned via `spawnHazardZone()`. Per-frame `updateHazardZones()` returns `HazardUpdateResult` consumed by `GameScene`. `updateHazardSpawner()` runs the auto-spawn pacing. Quality-aware (`setHazardZoneQuality`), stage-aware (`setHazardZoneStage`), world-level-aware (`setHazardZoneWorldLevel`). Reset: `resetHazardZoneSystem()` in GameScene `create()`.

### Boss Arena System

`BossArenaSystem` (`/src/systems/BossArenaSystem.ts`) — module-level state. On boss spawn, fades in a tinted overlay with a sine-wave alpha pulse (per-boss themes: red Horde King, purple Void Wyrm, blue The Machine). On boss death, white cleansing flash + fade-out. `activateBossArena(bossId)` / `deactivateBossArena()` / `updateBossArena()`. Reset: `resetBossArenaSystem()` in GameScene `create()`.

### Event System

`EventSystem` (`/src/systems/EventSystem.ts`) — random in-run events, module-level state:
- **5 events**: Elite Surge (2x spawns/XP), Golden Tide (3x gems), Magnetic Storm (magnetize gems), Treasure Rain (chests), Power Surge (damage boost)
- **Timing**: 45-75s random interval, minGameTime gates (45s–120s)
- **Selection**: Weighted random, no immediate repeat
- **Suppression**: During boss warning (phase 2+) via `setSuppressEvents()`
- Save/restore: `getEventState()`/`restoreEventState()`
- Reset: `resetEventSystem()` in GameScene `create()`

### Post-Processing Pipelines

WebGL pipelines in `main.ts` (conditional on WebGL):
- **BloomPipeline** (`/src/visual/BloomPipeline.ts`): Bloom glow + vignette, 9-tap box blur
- **DistortionPipeline** (`/src/visual/DistortionPipeline.ts`): Screen distortion

### Mobile Support

`index.html` forces landscape on phones: portrait overlay prompts rotation (`@media (orientation: portrait) and (max-width: 767px)`). `100dvh` + `env(safe-area-inset-*)` for notched devices.

### Game Configuration

- **Game tuning**: Balance constants in `/src/data/GameTuning.ts` (`TUNING`) — spawn curves, boss timing, thresholds. Per-enemy stats in `EnemyTypes.ts`; per-weapon mastery in weapon classes.
- Screen: 1280×720 (`GameConfig.ts`), EXPAND mode
- Max enemies: 2000 (`TUNING.spawn.maxEnemies`)
- XP: `10 × level^1.5` per level
- Damage invincibility: 0.3s base (extended via TitanCore permanent upgrade)
- Miniboss: first 2 min, then every 1.5 min
- Boss: 10 min

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