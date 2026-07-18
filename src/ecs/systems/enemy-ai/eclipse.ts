import { Transform, Velocity, EnemyAI } from '../../components';
import { groundSlamCallback } from './state';
import { telegraphManager } from './common';
import { checkBossPhaseTransition } from './boss-phase';
import { spawnTelegraph, eclipseStrikeTelegraph } from './telegraphs';
import {
  planEclipseChannel,
  eclipseChannelEnd,
  eclipseStrikeDamage,
  ECLIPSE_BLAST_RADIUS,
  ECLIPSE_ANCHORS,
  type EclipseStrike,
} from './eclipse-barrage';

/**
 * The Eclipse (boss) — an umbral occultation core and the first CHASE-THE-SAFE-ZONE
 * boss. It drifts to the arena centre and holds while spinning, then channels a
 * repeating full-floor pulse: every tile of a 6×4 grid blasts EXCEPT the tiles under
 * a single bright "umbra" disc that drifts across the arena. The un-telegraphed hole
 * in each pulse is the only safe ground, and it moves pulse to pulse, so the player
 * must continuously follow the drifting umbra. The first pulse's umbra is centred on
 * the player (a fair start); it then drifts toward a cycling quadrant anchor. Phases
 * shorten the interval, shrink the umbra, add pulses and raise damage. All damage is
 * telegraphed ground strikes via groundSlamCallback. Mirrors tremor.ts / diviner.ts.
 *
 * States: 0 = looming/holding centre, 1 = channelling the pulse train.
 */

const ARENA_CENTRE_X = 640;
const ARENA_CENTRE_Y = 360;
const ARENA_W = 1280;
const ARENA_H = 720;
const START_MARGIN = 140; // keep the umbra's first centre off the very edge
const HOLD_RADIUS = 60;   // within this of centre → ease to a stop
const SPIN_RATE = 0.55;   // rad/s while holding (×1.5 while channelling)

interface PendingEclipseStrike extends EclipseStrike {
  telegraphed: boolean;
}

// Barrage plans keyed by entity id. Not persisted: a save-restore mid-channel
// (state 1) finds no plan and returns to holding. Recycled entity ids are safe —
// plans are (re)written on every state-1 entry.
const pendingStrikesByEntity = new Map<number, PendingEclipseStrike[]>();

export function resetEclipseStrikes(): void {
  pendingStrikesByEntity.clear();
}

function clampRange(value: number, lo: number, hi: number): number {
  return value < lo ? lo : value > hi ? hi : value;
}

export function updateEclipseAI(
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
      // Seed the umbra on the player (a fair start), drift toward a cycled anchor.
      const step = Math.floor(EnemyAI.phase[enemyId]);
      const count = ECLIPSE_ANCHORS.length;
      const anchor = ECLIPSE_ANCHORS[((step % count) + count) % count];
      const startX = clampRange(playerX, START_MARGIN, ARENA_W - START_MARGIN);
      const startY = clampRange(playerY, START_MARGIN, ARENA_H - START_MARGIN);
      const end = eclipseChannelEnd(startX, startY, anchor.x, anchor.y);
      const strikes = planEclipseChannel(startX, startY, end.x, end.y, bossPhase);
      pendingStrikesByEntity.set(
        enemyId,
        strikes.map((strike) => ({ ...strike, telegraphed: false })),
      );
      EnemyAI.state[enemyId] = 1;
      EnemyAI.timer[enemyId] = 0;
    }
  } else if (state === 1) {
    // Channel: nearly stationary, spinning faster; each pulse's telegraphs spawn when
    // due and its strikes land a fuse later.
    Velocity.x[enemyId] *= 0.85;
    Velocity.y[enemyId] *= 0.85;
    Transform.rotation[enemyId] += deltaTime * SPIN_RATE * 1.5;

    const strikes = pendingStrikesByEntity.get(enemyId);
    const elapsed = EnemyAI.timer[enemyId];
    if (strikes && strikes.length > 0) {
      const damage = eclipseStrikeDamage(bossPhase);
      for (let strikeIndex = strikes.length - 1; strikeIndex >= 0; strikeIndex--) {
        const strike = strikes[strikeIndex];
        if (!strike.telegraphed && elapsed >= strike.telegraphDelay) {
          spawnTelegraph(
            telegraphManager,
            strike.x,
            strike.y,
            eclipseStrikeTelegraph(strike.impactDelay - strike.telegraphDelay),
          );
          strike.telegraphed = true;
        }
        if (elapsed >= strike.impactDelay) {
          if (groundSlamCallback) {
            groundSlamCallback(strike.x, strike.y, ECLIPSE_BLAST_RADIUS, damage);
          }
          strikes.splice(strikeIndex, 1);
        }
      }
    } else {
      // Channel complete (or restored with no plan) — advance the pattern and reload.
      pendingStrikesByEntity.delete(enemyId);
      EnemyAI.phase[enemyId] += 1;
      EnemyAI.state[enemyId] = 0;
      EnemyAI.specialTimer[enemyId] = 3.0 - bossPhase * 0.3; // 2.7 / 2.4 / 2.1
    }
  }
}
