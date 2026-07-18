import { Transform, Velocity, EnemyAI } from '../../components';
import { groundSlamCallback } from './state';
import { telegraphManager } from './common';
import { checkBossPhaseTransition } from './boss-phase';
import { spawnTelegraph, divinerStrikeTelegraph } from './telegraphs';
import {
  planDivinerBarrage,
  divinerStrikeDamage,
  DIVINER_BLAST_RADIUS,
  DIVINER_GAP_ROTATION_SLOTS,
  DIVINER_RING_SLOTS,
  type DivinerStrike,
} from './diviner-barrage';

/**
 * The Diviner (boss) — an all-seeing scrying eye and the first AIMED boss. Unlike
 * every geometry boss (spokes/rings/walls/spirals/checkerboards/wavefronts fired
 * from fixed points), the Diviner reads WHERE THE PLAYER STANDS and cages them: each
 * barrage samples the player's position and telegraphs a strike ON that spot plus a
 * ring enclosing it, leaving one rotating GAP — the eye's blind spot — the player
 * must flee through before the cage detonates. Phase 2+ adds a concentric outer ring
 * (gap aligned) so the whole disc is lethal and the corridor lengthens. Phases
 * tighten the fuse, narrow the gap and raise damage. All damage is telegraphed
 * ground strikes via groundSlamCallback. Mirrors tremor.ts.
 *
 * States: 0 = looming/holding centre (iris spin), 1 = the cage detonates.
 */

const ARENA_CENTRE_X = 640;
const ARENA_CENTRE_Y = 360;
const HOLD_RADIUS = 60;  // within this of centre → ease to a stop
const SPIN_RATE = 0.6;   // rad/s while holding (×1.5 while channelling)

// Barrage plans keyed by entity id. Not persisted: a save-restore mid-barrage
// (state 1) finds no plan and returns to holding. Recycled entity ids are safe —
// plans are (re)written on every state-1 entry.
const pendingStrikesByEntity = new Map<number, DivinerStrike[]>();

export function resetDivinerStrikes(): void {
  pendingStrikesByEntity.clear();
}

export function updateDivinerAI(
  enemyId: number,
  playerX: number,
  playerY: number,
  deltaTime: number,
): void {
  const enemyX = Transform.x[enemyId];
  const enemyY = Transform.y[enemyId];
  const baseSpeed = Velocity.speed[enemyId];
  const state = EnemyAI.state[enemyId];

  const bossPhase = checkBossPhaseTransition(enemyId);

  if (state === 0) {
    // Loom inward and hold near the arena centre; slow iris spin.
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
      const step = Math.floor(EnemyAI.phase[enemyId]);
      const gapStartSlot =
        (((step * DIVINER_GAP_ROTATION_SLOTS) % DIVINER_RING_SLOTS) +
          DIVINER_RING_SLOTS) %
        DIVINER_RING_SLOTS;
      const strikes = planDivinerBarrage(playerX, playerY, gapStartSlot, bossPhase);
      pendingStrikesByEntity.set(enemyId, strikes.slice());
      for (const strike of strikes) {
        spawnTelegraph(
          telegraphManager,
          strike.x,
          strike.y,
          divinerStrikeTelegraph(strike.impactDelay),
        );
      }
      EnemyAI.state[enemyId] = 1;
      EnemyAI.timer[enemyId] = 0;
    }
  } else if (state === 1) {
    // Channel: nearly stationary, iris spinning faster; the cage detonates when the
    // shared fuse elapses.
    Velocity.x[enemyId] *= 0.85;
    Velocity.y[enemyId] *= 0.85;
    Transform.rotation[enemyId] += deltaTime * SPIN_RATE * 1.5;

    const strikes = pendingStrikesByEntity.get(enemyId);
    const elapsed = EnemyAI.timer[enemyId];
    if (strikes && strikes.length > 0) {
      const damage = divinerStrikeDamage(bossPhase);
      for (let strikeIndex = strikes.length - 1; strikeIndex >= 0; strikeIndex--) {
        if (elapsed >= strikes[strikeIndex].impactDelay) {
          const strike = strikes[strikeIndex];
          if (groundSlamCallback) {
            groundSlamCallback(strike.x, strike.y, DIVINER_BLAST_RADIUS, damage);
          }
          strikes.splice(strikeIndex, 1);
        }
      }
    } else {
      // Cage complete (or restored with no plan) — advance the pattern and reload.
      pendingStrikesByEntity.delete(enemyId);
      EnemyAI.phase[enemyId] += 1;
      EnemyAI.state[enemyId] = 0;
      EnemyAI.specialTimer[enemyId] = 3.0 - bossPhase * 0.3; // 2.7 / 2.4 / 2.1
    }
  }
}
