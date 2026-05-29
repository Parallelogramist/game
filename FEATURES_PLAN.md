# Top 10 Features — Implementation Plan

Session goal: implement 10 genuinely-missing, high-impact features to completion,
then review + update CLAUDE.md/BACKLOG. Reroll/Skip/Banish and Evolution-tooltip
UI already existed (verified) — dropped; replaced with Bounties + Destructibles.

Build order chosen so shared infra (consumables) lands first.

## 1. Floor Consumables (F2) — `ConsumablePickupSystem`
- New: `src/ecs/systems/ConsumablePickupSystem.ts` (mirror HealthPickupSystem).
- Component: `Consumable {kind:ui8, magnetized:ui8}` + `ConsumablePickupTag` in components/index.ts.
- Kinds: BOMB(1)=AOE nuke via SpatialHash + damageEnemy; FREEZE(2)=applyFreeze all; VACUUM(3)=magnetizeAllGems; GOLD(4)=metaManager.addGold.
- Drop roll in `handleEnemyDeath`; setters + system call + reset in GameScene.
- Reused by Blessed affix, destructibles, bounties, shrine rewards.

## 2. Limit Break / Overflow (F3)
- New: `src/data/LimitBreakUpgrades.ts` — 5 repeatable overflow upgrades (dmg/HP/speed/xp/pickup), maxLevel huge, ~50% of normal per level.
- `getRandomCombinedUpgrades` pads result from overflow pool when short of `count`.
- UpgradeScene: gold "LIMIT BREAK" styling. GameScene: apply path + reset.

## 3. Elite Affixes + elite HP bars (F4)
- Component `EnemyAffix {affixType:ui8,state:ui8,timer:f32,vampHeal:f32}`.
- Roll on spawn (~12% non-boss). Vampiric/Volatile/Frostbound/Swift/Blessed.
- Scale HP/XP/gold; tint+label via EnemyVisuals; behaviors in EnemyAISystem.
- Floating mini HP bar for affixed/elite enemies (new lightweight pooled bars).
- Volatile→explosion on death; Blessed→guaranteed consumable drop.

## 4. Attack Telegraphs (F6)
- New: `src/effects/TelegraphManager.ts` (pooled graphics: ring/line/decal/rect).
- DepthLayers.ATTACK_TELEGRAPH. Hook boss/elite windup states in EnemyAISystem via injected manager. Quality-aware.

## 5. Environmental Destructibles (F8)
- Barrel/crate entities spawn on field; explode on weapon damage → AOE + drop consumable/gem. Mirror treasure-chest spawn/collision in GameScene. New `DestructibleSystem`.

## 6. Field Shrines (F7)
- New: `ShrineSystem` + `ShrineTypes` + renderer. Walk-in altars: Sacrifice(HP→run buff), Gamble(gold→relic), Power(temp dmg), Cleanse(heal). Distinct from existing random "Shrine of Sacrifice" EVENT.

## 7. In-run Bounties (F1)
- New: `BountySystem` — rotating objective (kill N in T / no-damage streak / kill elite) with HUD tracker + reward (consumable/gold/XP burst). Hook kill + damage events.

## 8. Pre-run Pacts (F9)
- New: `src/data/Pacts.ts` + `PactSelectScene`. Player picks harder mutators → stacking gold/XP reward mult (capped). Difficulty via setEnemyDifficultyMultiplier + director credit mult.

## 9. Post-run Results Screen (F5)
- New: `ResultsScene` + `BestScoreManager` + `PerformanceGrade`. Stats, build, S–F grade, per-run best (SecureStorage), unlocks. Wired from GameScene game-over.

## 10. Dynamic Music Intensity (F10)
- MusicManager: additive `setIntensityGain`/`updateIntensity`. New `MusicIntensityDriver` reads combo/enemies/HP/boss → gain envelope + boss-track switch.

## Conventions to honor
- Every module-level-state system gets `resetXSystem()` called in GameScene.create().
- `registerSprite`/`unregisterSprite` pairs; destroy sprite before removeEntity.
- SecureStorage for persistence. Object pooling for frequent objects.
- `npm run build` clean after each feature; commit per feature.
