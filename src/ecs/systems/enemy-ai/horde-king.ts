import { Transform, Velocity, EnemyAI } from '../../components';
import { minionSpawnCallback, groundSlamCallback } from './state';
import { PI_TWO, telegraphManager } from './common';
import { checkBossPhaseTransition } from './boss-phase';
import { spawnTelegraph, hordeKingSlamTelegraph } from './telegraphs';

/**
 * The Horde King (boss) — approaches the player, alternating between summoning
 * enemy rings and a telegraphed ground slam; 3 HP phases scale speed, summon
 * cadence, and slam size.
 */

/**
 * The Horde King - Summons enemy waves, ground slam attack, 3 phases.
 * States: 0 = approaching, 1 = summoning, 2 = ground slam windup, 3 = ground slam
 * Phase changes at 66% and 33% health
 */
export function updateHordeKingAI(
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
  const baseSpeed = Velocity.speed[enemyId];
  const state = EnemyAI.state[enemyId];

  // Determine phase (and fire transition callback on boundary crossings)
  const phase = checkBossPhaseTransition(enemyId);

  // Phase modifies behavior intensity
  const phaseSpeedMult = 1 + (3 - phase) * 0.2; // Faster in later phases
  const phaseSummonCooldown = 6 - (3 - phase) * 1.5; // More frequent summons

  if (state === 0) {
    // Approaching player
    if (distance > 100) {
      Velocity.x[enemyId] = (dx / distance) * baseSpeed * phaseSpeedMult;
      Velocity.y[enemyId] = (dy / distance) * baseSpeed * phaseSpeedMult;
    } else {
      Velocity.x[enemyId] *= 0.9;
      Velocity.y[enemyId] *= 0.9;
    }

    // Check for summon or slam
    EnemyAI.specialTimer[enemyId] -= deltaTime;
    if (EnemyAI.specialTimer[enemyId] <= 0) {
      // Alternate between summoning and ground slam
      if (Math.random() < 0.5) {
        EnemyAI.state[enemyId] = 1; // Summon
      } else {
        EnemyAI.state[enemyId] = 2; // Ground slam windup
        // Telegraph the phase-scaled slam footprint during the 1.0s windup.
        spawnTelegraph(telegraphManager, enemyX, enemyY, hordeKingSlamTelegraph(phase));
      }
      EnemyAI.timer[enemyId] = 0;
    }
  } else if (state === 1) {
    // Summoning enemies
    Velocity.x[enemyId] *= 0.95;
    Velocity.y[enemyId] *= 0.95;

    const timer = EnemyAI.timer[enemyId];
    if (timer > 0.5 && timer < 0.6 && minionSpawnCallback) {
      // Spawn enemies in a ring around the boss
      const summonCount = 2 + phase; // More enemies in later phases
      for (let i = 0; i < summonCount; i++) {
        const angle = (i / summonCount) * PI_TWO;
        const spawnX = enemyX + Math.cos(angle) * 80;
        const spawnY = enemyY + Math.sin(angle) * 80;
        minionSpawnCallback(spawnX, spawnY, 'basic');
      }
    }

    if (timer > 1.0) {
      EnemyAI.state[enemyId] = 0;
      EnemyAI.specialTimer[enemyId] = phaseSummonCooldown;
    }
  } else if (state === 2) {
    // Ground slam windup - stop and telegraph
    Velocity.x[enemyId] = 0;
    Velocity.y[enemyId] = 0;

    // Visual telegraph: shake
    Transform.x[enemyId] += (Math.random() - 0.5) * 6;

    const timer = EnemyAI.timer[enemyId];
    if (timer > 1.0) {
      EnemyAI.state[enemyId] = 3;
      EnemyAI.timer[enemyId] = 0;
    }
  } else if (state === 3) {
    // Ground slam execute
    const timer = EnemyAI.timer[enemyId];
    if (timer < 0.1 && groundSlamCallback) {
      // Execute slam
      const slamRadius = 150 + phase * 30; // Bigger in later phases
      const slamDamage = 30 + phase * 10;
      groundSlamCallback(enemyX, enemyY, slamRadius, slamDamage);
    }

    if (timer > 0.5) {
      EnemyAI.state[enemyId] = 0;
      EnemyAI.specialTimer[enemyId] = phaseSummonCooldown;
    }
  }

  Transform.rotation[enemyId] = Math.atan2(dy, dx);
}
