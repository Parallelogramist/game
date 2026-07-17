import { Transform, Velocity, EnemyAI } from '../../components';
import { groundSlamCallback } from './state';
import { telegraphManager } from './common';
import { checkBossPhaseTransition } from './boss-phase';
import { spawnTelegraph, pulsarStrikeTelegraph } from './telegraphs';
import {
  planSpokeBarrage,
  planCollapseBarrage,
  pulsarStrikeDamage,
  PULSAR_BLAST_RADIUS,
  type PulsarStrike,
} from './pulsar-barrage';

/**
 * The Pulsar (boss) — a collapsed star. Drifts to hold a mid-range band on the
 * player while continuously spinning, then channels rotating radial spoke
 * barrages of telegraphed ground strikes outward from itself; phase 2+ mixes in
 * a converging-ring "collapse" barrage (a shrinking safe zone with a rotating
 * escape lane). All damage is telegraphed ground strikes via groundSlamCallback.
 *
 * States: 0 = drifting/spinning, 1 = channeling a planned barrage.
 */

const PREFERRED_RANGE = 250;
const RANGE_SLACK = 70;
const SPIN_RATE = 1.6; // rad/s while drifting (doubled while channeling)
const ROTATION_ADVANCE = 0.5; // spoke pattern rotates this much per volley

// Strike plans keyed by entity id. Not persisted: a save-restore mid-barrage
// (state 1) finds no plan and simply returns to drifting. Recycled entity ids
// are safe — plans are (re)written on every state-1 entry.
const pendingStrikesByEntity = new Map<number, PulsarStrike[]>();

export function resetPulsarStrikes(): void {
  pendingStrikesByEntity.clear();
}

export function updatePulsarAI(
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

  const pulsarPhase = checkBossPhaseTransition(enemyId);

  if (state === 0) {
    // Drift: hold the mortar-range band on the player, with a gentle strafe.
    const strafeDirection = enemyId % 2 === 0 ? 1 : -1;
    const towardX = dx / (distance || 1);
    const towardY = dy / (distance || 1);
    const tangentX = -towardY * strafeDirection;
    const tangentY = towardX * strafeDirection;

    let radialFactor = 0;
    if (distance < PREFERRED_RANGE - RANGE_SLACK) {
      radialFactor = -1.0; // withdraw
    } else if (distance > PREFERRED_RANGE + RANGE_SLACK) {
      radialFactor = 0.8;
    }

    const moveX = tangentX * 0.5 + towardX * radialFactor;
    const moveY = tangentY * 0.5 + towardY * radialFactor;
    const moveMagnitude = Math.sqrt(moveX * moveX + moveY * moveY) || 1;
    Velocity.x[enemyId] = (moveX / moveMagnitude) * baseSpeed;
    Velocity.y[enemyId] = (moveY / moveMagnitude) * baseSpeed;

    Transform.rotation[enemyId] += deltaTime * SPIN_RATE;

    EnemyAI.specialTimer[enemyId] -= deltaTime;
    if (EnemyAI.specialTimer[enemyId] <= 0) {
      const rotationAngle = EnemyAI.phase[enemyId];
      const useCollapse = pulsarPhase >= 2 && Math.random() < 0.4;
      const strikes = useCollapse
        ? planCollapseBarrage(playerX, playerY, pulsarPhase, rotationAngle)
        : planSpokeBarrage(enemyX, enemyY, rotationAngle, pulsarPhase);
      pendingStrikesByEntity.set(enemyId, strikes.slice());
      for (const strike of strikes) {
        spawnTelegraph(
          telegraphManager,
          strike.x,
          strike.y,
          pulsarStrikeTelegraph(strike.impactDelay)
        );
      }
      EnemyAI.state[enemyId] = 1;
      EnemyAI.timer[enemyId] = 0;
    }
  } else if (state === 1) {
    // Channel: nearly stationary, spinning faster; strikes land as their
    // flight time elapses.
    Velocity.x[enemyId] *= 0.85;
    Velocity.y[enemyId] *= 0.85;
    Transform.rotation[enemyId] += deltaTime * SPIN_RATE * 2;

    const strikes = pendingStrikesByEntity.get(enemyId);
    const elapsed = EnemyAI.timer[enemyId];
    if (strikes && strikes.length > 0) {
      const damage = pulsarStrikeDamage(pulsarPhase);
      for (let strikeIndex = strikes.length - 1; strikeIndex >= 0; strikeIndex--) {
        if (elapsed >= strikes[strikeIndex].impactDelay) {
          const strike = strikes[strikeIndex];
          if (groundSlamCallback) {
            groundSlamCallback(strike.x, strike.y, PULSAR_BLAST_RADIUS, damage);
          }
          strikes.splice(strikeIndex, 1);
        }
      }
    } else {
      // Barrage complete (or restored with no plan) — rotate the pattern and
      // reload.
      pendingStrikesByEntity.delete(enemyId);
      EnemyAI.phase[enemyId] += ROTATION_ADVANCE;
      EnemyAI.state[enemyId] = 0;
      EnemyAI.specialTimer[enemyId] = 3.4 - pulsarPhase * 0.35; // 3.05 / 2.70 / 2.35
    }
  }
}
