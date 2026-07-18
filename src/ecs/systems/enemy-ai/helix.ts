import { Transform, Velocity, EnemyAI } from '../../components';
import { groundSlamCallback } from './state';
import { telegraphManager } from './common';
import { checkBossPhaseTransition } from './boss-phase';
import { spawnTelegraph, helixStrikeTelegraph } from './telegraphs';
import {
  planSpiralBarrage,
  helixStrikeDamage,
  HELIX_BLAST_RADIUS,
  type HelixStrike,
} from './helix-barrage';

/**
 * The Helix (boss) — a spinning energy core. Drifts to the arena centre and
 * holds while spinning, then channels a spiral barrage of telegraphed ground
 * strikes that unfurls outward; the spiral's base angle rotates every barrage so
 * the player must keep orbiting. Phases add a third arm, tighten the cadence, and
 * raise damage. All damage is telegraphed ground strikes via groundSlamCallback.
 *
 * States: 0 = holding centre / spinning, 1 = channelling a planned spiral.
 */

const ARENA_CENTRE_X = 640;
const ARENA_CENTRE_Y = 360;
const HOLD_RADIUS = 60;       // within this of centre → ease to a stop
const SPIN_RATE = 1.2;        // rad/s while holding (doubled while channelling)
const ROTATION_ADVANCE = 0.7; // spiral base angle advances this much per volley

// Spiral plans keyed by entity id. Not persisted: a save-restore mid-barrage
// (state 1) finds no plan and returns to holding. Recycled entity ids are safe —
// plans are (re)written on every state-1 entry.
const pendingStrikesByEntity = new Map<number, HelixStrike[]>();

export function resetHelixStrikes(): void {
  pendingStrikesByEntity.clear();
}

export function updateHelixAI(
  enemyId: number,
  _playerX: number,
  _playerY: number,
  deltaTime: number,
): void {
  const enemyX = Transform.x[enemyId];
  const enemyY = Transform.y[enemyId];
  const baseSpeed = Velocity.speed[enemyId];
  const state = EnemyAI.state[enemyId];

  const helixPhase = checkBossPhaseTransition(enemyId);

  if (state === 0) {
    // Loom inward and hold near the arena centre; slow spin.
    const toCentreX = ARENA_CENTRE_X - enemyX;
    const toCentreY = ARENA_CENTRE_Y - enemyY;
    const distCentre = Math.sqrt(toCentreX * toCentreX + toCentreY * toCentreY);
    if (distCentre > HOLD_RADIUS) {
      Velocity.x[enemyId] = (toCentreX / (distCentre || 1)) * baseSpeed;
      Velocity.y[enemyId] = (toCentreY / (distCentre || 1)) * baseSpeed;
    } else {
      Velocity.x[enemyId] *= 0.8;
      Velocity.y[enemyId] *= 0.8;
    }
    Transform.rotation[enemyId] += deltaTime * SPIN_RATE;

    EnemyAI.specialTimer[enemyId] -= deltaTime;
    if (EnemyAI.specialTimer[enemyId] <= 0) {
      const baseAngle = EnemyAI.phase[enemyId];
      const strikes = planSpiralBarrage(baseAngle, helixPhase);
      pendingStrikesByEntity.set(enemyId, strikes.slice());
      for (const strike of strikes) {
        spawnTelegraph(
          telegraphManager,
          strike.x,
          strike.y,
          helixStrikeTelegraph(strike.impactDelay),
        );
      }
      EnemyAI.state[enemyId] = 1;
      EnemyAI.timer[enemyId] = 0;
    }
  } else if (state === 1) {
    // Channel: nearly stationary, spinning faster; strikes land as their flight
    // time elapses.
    Velocity.x[enemyId] *= 0.85;
    Velocity.y[enemyId] *= 0.85;
    Transform.rotation[enemyId] += deltaTime * SPIN_RATE * 2;

    const strikes = pendingStrikesByEntity.get(enemyId);
    const elapsed = EnemyAI.timer[enemyId];
    if (strikes && strikes.length > 0) {
      const damage = helixStrikeDamage(helixPhase);
      for (let strikeIndex = strikes.length - 1; strikeIndex >= 0; strikeIndex--) {
        if (elapsed >= strikes[strikeIndex].impactDelay) {
          const strike = strikes[strikeIndex];
          if (groundSlamCallback) {
            groundSlamCallback(strike.x, strike.y, HELIX_BLAST_RADIUS, damage);
          }
          strikes.splice(strikeIndex, 1);
        }
      }
    } else {
      // Barrage complete (or restored with no plan) — rotate the spiral and reload.
      pendingStrikesByEntity.delete(enemyId);
      EnemyAI.phase[enemyId] += ROTATION_ADVANCE;
      EnemyAI.state[enemyId] = 0;
      EnemyAI.specialTimer[enemyId] = 3.2 - helixPhase * 0.28; // 2.92 / 2.64 / 2.36
    }
  }
}
