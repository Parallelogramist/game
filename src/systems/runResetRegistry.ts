import { resetInputSystem } from '../ecs/systems/InputSystem';
import { resetSpriteSystem } from '../ecs/systems/SpriteSystem';
import { resetEnemyAISystem, resetBossCallbacks } from '../ecs/systems/enemy-ai/state';
import { resetDecoySystem } from '../ecs/systems/enemy-ai/decoy';
import { resetXPGemSystem } from '../ecs/systems/XPGemSystem';
import { resetHealthPickupSystem } from '../ecs/systems/HealthPickupSystem';
import { resetMagnetPickupSystem } from '../ecs/systems/MagnetPickupSystem';
import { resetConsumablePickupSystem } from '../ecs/systems/ConsumablePickupSystem';
import { resetWeaponSystem } from '../ecs/systems/WeaponSystem';
import { resetCollisionSystem } from '../ecs/systems/CollisionSystem';
import { resetStatusEffectSystem } from '../ecs/systems/StatusEffectSystem';
import { resetFrameCache } from '../ecs/FrameCache';
import { resetEnemySpatialHash } from '../utils/SpatialHash';
import { resetComboSystem } from './ComboSystem';
import { resetUltimateSystem } from './UltimateSystem';
import { resetEventSystem } from './EventSystem';
import {
  resetBossPhaseTracking,
  resetBastionStrikes,
  resetPulsarStrikes,
  resetBombardStrikes,
  resetStalkerStrikes,
  resetObeliskStrikes,
  resetHelixStrikes,
  resetTessellatorStrikes,
  resetTremorStrikes,
  resetDivinerStrikes,
  resetEclipseStrikes,
  resetLegionSystem,
} from '../ecs/systems/EnemyAISystem';
import { resetBossArenaSystem } from './BossArenaSystem';
import { resetHazardZoneSystem } from './HazardZoneSystem';
import { resetMusicIntensityDriver } from '../audio/MusicIntensityDriver';
import { resetJuiceManager } from '../effects/JuiceManager';

/**
 * Every zero-argument, run-scoped module reset, in the order GameScene has always
 * called them. `runResetRegistry.test.ts` fails the build when a `reset*` export in
 * src/systems or src/ecs is missing from RUN_RESETS, so a newly added run-scoped
 * system cannot silently bleed its state into the next run (the failure mode the
 * "System state reset" rule in CLAUDE.md warns about).
 *
 * Resets that need an argument (the scene, the run's director strategy) are not here:
 * GameScene calls those in the tail of resetAllRunSystems().
 */
const RUN_RESETS: ReadonlyArray<() => void> = [
  resetInputSystem,
  resetSpriteSystem,
  resetEnemyAISystem,
  resetDecoySystem,
  resetBossCallbacks,
  resetXPGemSystem,
  resetHealthPickupSystem,
  resetMagnetPickupSystem,
  resetConsumablePickupSystem,
  resetWeaponSystem,
  resetCollisionSystem,
  resetStatusEffectSystem,
  resetFrameCache,
  resetEnemySpatialHash,
  resetComboSystem,
  resetUltimateSystem,
  resetEventSystem,
  resetBossPhaseTracking,
  resetBastionStrikes,
  resetPulsarStrikes,
  resetBombardStrikes,
  resetStalkerStrikes,
  resetObeliskStrikes,
  resetHelixStrikes,
  resetTessellatorStrikes,
  resetTremorStrikes,
  resetDivinerStrikes,
  resetEclipseStrikes,
  resetLegionSystem,
  resetBossArenaSystem,
  resetHazardZoneSystem,
  resetMusicIntensityDriver,
  resetJuiceManager,
];

export function runAllRunResets(): void {
  for (const runReset of RUN_RESETS) {
    runReset();
  }
}
