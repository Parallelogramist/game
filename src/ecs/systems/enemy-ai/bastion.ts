import { Transform, Velocity, EnemyAI } from '../../components';
import { groundSlamCallback } from './state';
import { telegraphManager } from './common';
import { checkBossPhaseTransition } from './boss-phase';
import { spawnTelegraph, bastionMortarTelegraph } from './telegraphs';
import {
  planScatterBarrage,
  planRollingBarrage,
  mortarDamageForPhase,
  MORTAR_BLAST_RADIUS,
  type MortarStrike,
} from './bastion-barrage';

/**
 * The Bastion (boss) — siege artillery. Holds the player at mortar range
 * (retreating when closed on — the one boss the player must chase), lobbing
 * telegraphed mortar barrages at the player's position; phase 2+ mixes in a
 * rolling barrage that marches a line of strikes through the player, and
 * later phases add shells and tighten fuses.
 *
 * States: 0 = siege repositioning, 1 = firing a planned barrage.
 */

const PREFERRED_RANGE = 380;
const RANGE_SLACK = 60;

// Strike plans keyed by entity id. Not persisted: a save-restore that lands
// mid-barrage (state 1) finds no plan and simply returns to repositioning.
// Recycled entity ids are safe — plans are (re)written on every state-1 entry.
const pendingStrikesByEntity = new Map<number, MortarStrike[]>();

export function resetBastionStrikes(): void {
  pendingStrikesByEntity.clear();
}

export function updateBastionAI(
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

  const bastionPhase = checkBossPhaseTransition(enemyId);

  if (state === 0) {
    // Siege repositioning: keep the player in the mortar range band. The
    // spawn-time random EnemyAI.phase doubles as this boss's strafe direction.
    const strafeDirection = EnemyAI.phase[enemyId] > Math.PI ? 1 : -1;
    const towardX = dx / (distance || 1);
    const towardY = dy / (distance || 1);
    const tangentX = -towardY * strafeDirection;
    const tangentY = towardX * strafeDirection;

    let radialFactor = 0;
    if (distance < PREFERRED_RANGE - RANGE_SLACK) {
      radialFactor = -1.15; // withdraw — artillery hates melee
    } else if (distance > PREFERRED_RANGE + RANGE_SLACK) {
      radialFactor = 0.9;
    }

    const moveX = tangentX * 0.5 + towardX * radialFactor;
    const moveY = tangentY * 0.5 + towardY * radialFactor;
    const moveMagnitude = Math.sqrt(moveX * moveX + moveY * moveY) || 1;
    Velocity.x[enemyId] = (moveX / moveMagnitude) * baseSpeed;
    Velocity.y[enemyId] = (moveY / moveMagnitude) * baseSpeed;

    EnemyAI.specialTimer[enemyId] -= deltaTime;
    if (EnemyAI.specialTimer[enemyId] <= 0) {
      const rollBarrage = bastionPhase >= 2 && Math.random() < 0.45;
      const strikes = rollBarrage
        ? planRollingBarrage(enemyX, enemyY, playerX, playerY, bastionPhase)
        : planScatterBarrage(playerX, playerY, bastionPhase);
      pendingStrikesByEntity.set(enemyId, strikes.slice());
      for (const strike of strikes) {
        spawnTelegraph(telegraphManager, strike.x, strike.y, bastionMortarTelegraph(strike.impactDelay));
      }
      EnemyAI.state[enemyId] = 1;
      EnemyAI.timer[enemyId] = 0;
    }
  } else if (state === 1) {
    // Firing: dug in, shells land as their flight time elapses.
    Velocity.x[enemyId] *= 0.85;
    Velocity.y[enemyId] *= 0.85;
    // Recoil judder while the battery fires
    Transform.x[enemyId] += (Math.random() - 0.5) * 3;

    const strikes = pendingStrikesByEntity.get(enemyId);
    const elapsed = EnemyAI.timer[enemyId];
    if (strikes && strikes.length > 0) {
      const damage = mortarDamageForPhase(bastionPhase);
      for (let strikeIndex = strikes.length - 1; strikeIndex >= 0; strikeIndex--) {
        if (elapsed >= strikes[strikeIndex].impactDelay) {
          const strike = strikes[strikeIndex];
          if (groundSlamCallback) {
            groundSlamCallback(strike.x, strike.y, MORTAR_BLAST_RADIUS, damage);
          }
          strikes.splice(strikeIndex, 1);
        }
      }
    } else {
      // All shells down (or restored mid-barrage with no plan) — reload.
      pendingStrikesByEntity.delete(enemyId);
      EnemyAI.state[enemyId] = 0;
      EnemyAI.specialTimer[enemyId] = 4.2 - bastionPhase * 0.5;
    }
  }

  Transform.rotation[enemyId] = Math.atan2(dy, dx);
}
