import { Transform, Velocity, EnemyAI } from '../../components';
import {
  gameBoundsWidth, gameBoundsHeight,
  projectileSpawnCallback, minionSpawnCallback, laserBeamCallback,
} from './state';
import { PI_HALF, PI_TWO, telegraphManager } from './common';
import { checkBossPhaseTransition } from './boss-phase';
import { spawnTelegraph, theMachineLaserTelegraphs } from './telegraphs';

/**
 * The Machine (boss) — holds screen center firing projectile spreads, spawning
 * turrets, and charging a telegraphed laser grid (main beam + cross beams);
 * later HP phases shorten special cooldowns.
 */

/**
 * The Machine - Mechanical boss that spawns turrets and fires laser grids.
 * States: 0 = moving/shooting, 1 = spawning turret, 2 = charging laser, 3 = firing laser
 */
export function updateTheMachineAI(
  enemyId: number,
  playerX: number,
  playerY: number,
  deltaTime: number
): void {
  const enemyX = Transform.x[enemyId];
  const enemyY = Transform.y[enemyId];
  const dx = playerX - enemyX;
  const dy = playerY - enemyY;
  const baseSpeed = Velocity.speed[enemyId];
  const state = EnemyAI.state[enemyId];

  // Detect HP phase transitions. Phase 3 shortens special cooldowns and widens
  // the laser fan for a more desperate final-stand feel.
  const machinePhase = checkBossPhaseTransition(enemyId);
  const specialCooldownForPhase = machinePhase === 3 ? 3.0 : machinePhase === 2 ? 4.0 : 5.0;

  if (state === 0) {
    // Move toward center-ish position, fire constantly
    const targetX = gameBoundsWidth / 2;
    const targetY = gameBoundsHeight / 2;
    const toDx = targetX - enemyX;
    const toDy = targetY - enemyY;
    const toDist = Math.sqrt(toDx * toDx + toDy * toDy);

    if (toDist > 100) {
      Velocity.x[enemyId] = (toDx / toDist) * baseSpeed;
      Velocity.y[enemyId] = (toDy / toDist) * baseSpeed;
    } else {
      Velocity.x[enemyId] *= 0.95;
      Velocity.y[enemyId] *= 0.95;
    }

    // Constant shooting at player
    EnemyAI.shootTimer[enemyId] -= deltaTime;
    if (EnemyAI.shootTimer[enemyId] <= 0 && projectileSpawnCallback) {
      const angle = Math.atan2(dy, dx);
      projectileSpawnCallback(enemyX, enemyY, angle, 250, 15);
      // Also fire at angles
      projectileSpawnCallback(enemyX, enemyY, angle - 0.3, 250, 12);
      projectileSpawnCallback(enemyX, enemyY, angle + 0.3, 250, 12);
      EnemyAI.shootTimer[enemyId] = 0.8;
    }

    // Check for special attacks
    EnemyAI.specialTimer[enemyId] -= deltaTime;
    if (EnemyAI.specialTimer[enemyId] <= 0) {
      if (Math.random() < 0.5) {
        EnemyAI.state[enemyId] = 1; // Spawn turret
      } else {
        EnemyAI.state[enemyId] = 2; // Charge laser
        // Telegraph the laser grid (main + cross beams) for the 1.5s charge.
        // The actual target is stored one frame into state 2; the boss is
        // stationary while charging so the beam origins hold.
        for (const beamSpec of theMachineLaserTelegraphs(enemyX, enemyY, playerX, playerY)) {
          spawnTelegraph(telegraphManager, enemyX, enemyY, beamSpec);
        }
      }
      EnemyAI.timer[enemyId] = 0;
    }
  } else if (state === 1) {
    // Spawning turret
    Velocity.x[enemyId] *= 0.95;
    Velocity.y[enemyId] *= 0.95;

    const timer = EnemyAI.timer[enemyId];
    if (timer > 0.5 && timer < 0.6 && minionSpawnCallback) {
      // Spawn turret at random position
      const spawnAngle = Math.random() * PI_TWO;
      const spawnDist = 150 + Math.random() * 100;
      const spawnX = Math.min(gameBoundsWidth - 80, Math.max(80, enemyX + Math.cos(spawnAngle) * spawnDist));
      const spawnY = Math.min(gameBoundsHeight - 80, Math.max(80, enemyY + Math.sin(spawnAngle) * spawnDist));
      minionSpawnCallback(spawnX, spawnY, 'turret');
    }

    if (timer > 1.0) {
      EnemyAI.state[enemyId] = 0;
      EnemyAI.specialTimer[enemyId] = specialCooldownForPhase;
    }
  } else if (state === 2) {
    // Charging laser
    Velocity.x[enemyId] = 0;
    Velocity.y[enemyId] = 0;

    // Telegraph: shake
    Transform.x[enemyId] += (Math.random() - 0.5) * 4;

    // Store laser target
    if (EnemyAI.timer[enemyId] < 0.1) {
      EnemyAI.targetX[enemyId] = playerX;
      EnemyAI.targetY[enemyId] = playerY;
    }

    if (EnemyAI.timer[enemyId] > 1.5) {
      EnemyAI.state[enemyId] = 3;
      EnemyAI.timer[enemyId] = 0;
    }
  } else if (state === 3) {
    // Firing laser
    const timer = EnemyAI.timer[enemyId];

    if (timer < 0.5 && laserBeamCallback) {
      // Fire laser in multiple directions
      const laserAngle = Math.atan2(EnemyAI.targetY[enemyId] - enemyY, EnemyAI.targetX[enemyId] - enemyX);
      const laserLength = 800;

      // Main laser toward target
      laserBeamCallback(
        enemyX,
        enemyY,
        enemyX + Math.cos(laserAngle) * laserLength,
        enemyY + Math.sin(laserAngle) * laserLength,
        25
      );

      // Cross lasers
      if (timer > 0.2) {
        laserBeamCallback(
          enemyX,
          enemyY,
          enemyX + Math.cos(laserAngle + PI_HALF) * laserLength,
          enemyY + Math.sin(laserAngle + PI_HALF) * laserLength,
          20
        );
        laserBeamCallback(
          enemyX,
          enemyY,
          enemyX + Math.cos(laserAngle - PI_HALF) * laserLength,
          enemyY + Math.sin(laserAngle - PI_HALF) * laserLength,
          20
        );
      }
    }

    if (timer > 0.8) {
      EnemyAI.state[enemyId] = 0;
      EnemyAI.specialTimer[enemyId] = 6.0;
    }
  }

  Transform.rotation[enemyId] = Math.atan2(dy, dx);
}
