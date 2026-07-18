import { Transform, Velocity, EnemyAI, EnemyType } from '../../components';
import { groundSlamCallback } from './state';
import { telegraphManager } from './common';
import { spawnTelegraph, bombardStrikeTelegraph } from './telegraphs';
import {
  planMortarCluster,
  BOMBARD_BLAST_RADIUS,
  type BombardStrike,
} from './bombard-barrage';

/**
 * The Bombard (miniboss) — a hovering siege platform. Kites to hold a long
 * artillery band on the player, then drops a telegraphed mortar cluster (center +
 * a satellite ring) on the player's position; the player must vacate the marked
 * ground. All damage is telegraphed ground strikes via groundSlamCallback.
 *
 * States: 0 = repositioning, 1 = firing a planned salvo.
 */

const PREFERRED_RANGE = 320;
const RANGE_SLACK = 80;
const SALVO_COOLDOWN = 2.6;   // seconds between salvos
const RING_ADVANCE = 0.7;     // satellite ring rotates this much per salvo

// Strike plans keyed by entity id. Not persisted: a save-restore mid-salvo
// (state 1) finds no plan and simply returns to repositioning. Recycled entity
// ids are safe — plans are (re)written on every state-1 entry.
const pendingStrikesByEntity = new Map<number, BombardStrike[]>();

export function resetBombardStrikes(): void {
  pendingStrikesByEntity.clear();
}

export function updateBombardAI(
  enemyId: number,
  playerX: number,
  playerY: number,
  deltaTime: number
): void {
  const enemyX = Transform.x[enemyId];
  const enemyY = Transform.y[enemyId];
  const dx = playerX - enemyX;
  const dy = playerY - enemyY;
  const distance = Math.sqrt(dx * dx + dy * dy) || 1;
  const speed = Velocity.speed[enemyId];
  const state = EnemyAI.state[enemyId];

  Transform.rotation[enemyId] = Math.atan2(dy, dx); // aim the barrel at the player

  if (state === 0) {
    // Reposition: hold the long artillery band with a gentle strafe.
    const strafeDirection = enemyId % 2 === 0 ? 1 : -1;
    const towardX = dx / distance;
    const towardY = dy / distance;
    const tangentX = -towardY * strafeDirection;
    const tangentY = towardX * strafeDirection;

    let radialFactor = 0;
    if (distance < PREFERRED_RANGE - RANGE_SLACK) {
      radialFactor = -1.0; // too close — withdraw
    } else if (distance > PREFERRED_RANGE + RANGE_SLACK) {
      radialFactor = 0.8; // too far — close in
    }

    const moveX = tangentX * 0.5 + towardX * radialFactor;
    const moveY = tangentY * 0.5 + towardY * radialFactor;
    const moveMagnitude = Math.sqrt(moveX * moveX + moveY * moveY) || 1;
    Velocity.x[enemyId] = (moveX / moveMagnitude) * speed;
    Velocity.y[enemyId] = (moveY / moveMagnitude) * speed;

    EnemyAI.specialTimer[enemyId] -= deltaTime;
    if (EnemyAI.specialTimer[enemyId] <= 0) {
      const ringRotation = EnemyAI.phase[enemyId];
      const strikes = planMortarCluster(playerX, playerY, ringRotation);
      pendingStrikesByEntity.set(enemyId, strikes.slice());
      for (const strike of strikes) {
        spawnTelegraph(
          telegraphManager,
          strike.x,
          strike.y,
          bombardStrikeTelegraph(strike.impactDelay)
        );
      }
      EnemyAI.state[enemyId] = 1;
      EnemyAI.timer[enemyId] = 0;
    }
  } else if (state === 1) {
    // Salvo: brace (slow to a near-stop) while shells land as their fuses elapse.
    Velocity.x[enemyId] *= 0.85;
    Velocity.y[enemyId] *= 0.85;

    const strikes = pendingStrikesByEntity.get(enemyId);
    const elapsed = EnemyAI.timer[enemyId];
    if (strikes && strikes.length > 0) {
      const damage = EnemyType.baseDamage[enemyId];
      for (let strikeIndex = strikes.length - 1; strikeIndex >= 0; strikeIndex--) {
        if (elapsed >= strikes[strikeIndex].impactDelay) {
          const strike = strikes[strikeIndex];
          if (groundSlamCallback) {
            groundSlamCallback(strike.x, strike.y, BOMBARD_BLAST_RADIUS, damage);
          }
          strikes.splice(strikeIndex, 1);
        }
      }
    } else {
      // Salvo complete (or restored with no plan) — rotate the ring and reload.
      pendingStrikesByEntity.delete(enemyId);
      EnemyAI.phase[enemyId] += RING_ADVANCE;
      EnemyAI.state[enemyId] = 0;
      EnemyAI.specialTimer[enemyId] = SALVO_COOLDOWN;
    }
  }
}
