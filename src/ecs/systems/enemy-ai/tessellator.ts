import { Transform, Velocity, EnemyAI } from '../../components';
import { groundSlamCallback } from './state';
import { telegraphManager } from './common';
import { checkBossPhaseTransition } from './boss-phase';
import { spawnTelegraph, tessellatorStrikeTelegraph } from './telegraphs';
import {
  planCheckerBarrage,
  tessellatorStrikeDamage,
  TESSELLATOR_BLAST_RADIUS,
  type SweepAxis,
  type TessellatorStrike,
} from './tessellator-barrage';

/**
 * The Tessellator (boss) — a crystalline lattice core. Drifts to the arena
 * centre and holds while spinning, then channels a checkerboard "tiling"
 * barrage: one parity of an 8×5 tile grid blasts, forcing the player onto the
 * other parity's safe tiles. The parity flips every barrage, and the sweep axis
 * rotates, so the tile under the player becomes lethal and it must hop. Phases
 * add a rolling sweep, tighten cadence, and raise damage. All damage is
 * telegraphed ground strikes via groundSlamCallback.
 *
 * States: 0 = looming/holding centre, 1 = channelling a planned barrage.
 */

const ARENA_CENTRE_X = 640;
const ARENA_CENTRE_Y = 360;
const HOLD_RADIUS = 60;  // within this of centre → ease to a stop
const SPIN_RATE = 0.8;   // rad/s while holding (doubled while channelling)

// Sweep axis rotates each barrage (indexed by the barrage step).
const SWEEP_AXES: SweepAxis[] = ['left', 'down', 'right', 'up'];

// Barrage plans keyed by entity id. Not persisted: a save-restore mid-barrage
// (state 1) finds no plan and returns to holding. Recycled entity ids are safe —
// plans are (re)written on every state-1 entry.
const pendingStrikesByEntity = new Map<number, TessellatorStrike[]>();

export function resetTessellatorStrikes(): void {
  pendingStrikesByEntity.clear();
}

export function updateTessellatorAI(
  enemyId: number,
  _playerX: number,
  _playerY: number,
  deltaTime: number,
): void {
  const enemyX = Transform.x[enemyId];
  const enemyY = Transform.y[enemyId];
  const baseSpeed = Velocity.speed[enemyId];
  const state = EnemyAI.state[enemyId];

  const bossPhase = checkBossPhaseTransition(enemyId);

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
      const step = Math.floor(EnemyAI.phase[enemyId]);
      const parity: 0 | 1 = (step % 2) as 0 | 1;
      const axis = SWEEP_AXES[((step % SWEEP_AXES.length) + SWEEP_AXES.length) % SWEEP_AXES.length];
      const strikes = planCheckerBarrage(parity, axis, bossPhase);
      pendingStrikesByEntity.set(enemyId, strikes.slice());
      for (const strike of strikes) {
        spawnTelegraph(
          telegraphManager,
          strike.x,
          strike.y,
          tessellatorStrikeTelegraph(strike.impactDelay),
        );
      }
      EnemyAI.state[enemyId] = 1;
      EnemyAI.timer[enemyId] = 0;
    }
  } else if (state === 1) {
    // Channel: nearly stationary, spinning faster; strikes land as their fuse
    // time elapses.
    Velocity.x[enemyId] *= 0.85;
    Velocity.y[enemyId] *= 0.85;
    Transform.rotation[enemyId] += deltaTime * SPIN_RATE * 2;

    const strikes = pendingStrikesByEntity.get(enemyId);
    const elapsed = EnemyAI.timer[enemyId];
    if (strikes && strikes.length > 0) {
      const damage = tessellatorStrikeDamage(bossPhase);
      for (let strikeIndex = strikes.length - 1; strikeIndex >= 0; strikeIndex--) {
        if (elapsed >= strikes[strikeIndex].impactDelay) {
          const strike = strikes[strikeIndex];
          if (groundSlamCallback) {
            groundSlamCallback(strike.x, strike.y, TESSELLATOR_BLAST_RADIUS, damage);
          }
          strikes.splice(strikeIndex, 1);
        }
      }
    } else {
      // Barrage complete (or restored with no plan) — advance the pattern and
      // reload.
      pendingStrikesByEntity.delete(enemyId);
      EnemyAI.phase[enemyId] += 1;
      EnemyAI.state[enemyId] = 0;
      EnemyAI.specialTimer[enemyId] = 3.2 - bossPhase * 0.3; // 2.9 / 2.6 / 2.3
    }
  }
}
