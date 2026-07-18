import { Transform, Velocity, EnemyAI, EnemyType } from '../../components';
import { groundSlamCallback } from './state';
import { telegraphManager } from './common';
import { spawnTelegraph, stalkerStrikeTelegraph } from './telegraphs';
import {
  planStalkerVolley,
  STALKER_BLAST_RADIUS,
  STALKER_MOVING_THRESHOLD,
  type StalkerStrike,
} from './stalker-barrage';

/**
 * The Stalker (miniboss) — a lean predatory dart. It stalks the player at a medium
 * band, then hurls a PREDICTIVE volley: a line of telegraphed ground strikes that
 * races ahead along the player's current heading, so straight-line flight runs into
 * the barrage and the safe move is a perpendicular juke. During the volley it keeps
 * pressing toward the prey (a menacing drift, not a charge). All damage is telegraphed
 * ground strikes via groundSlamCallback — no core combat change. It is the first enemy
 * that strikes where the player is GOING, not where they ARE.
 *
 * States: 0 = stalking, 1 = firing a planned predictive volley.
 */

const PREFERRED_RANGE = 240;  // medium band — closes more than the Bombard's 320
const RANGE_SLACK = 60;
const VOLLEY_COOLDOWN = 2.0;  // seconds between volleys (relentless — faster than Bombard)

// Strike plans keyed by entity id. Not persisted: a save-restore mid-volley (state 1)
// finds no plan and simply returns to stalking. Recycled entity ids are safe — plans
// are (re)written on every state-1 entry.
const pendingStrikesByEntity = new Map<number, StalkerStrike[]>();

export function resetStalkerStrikes(): void {
  pendingStrikesByEntity.clear();
}

export function updateStalkerAI(
  enemyId: number,
  playerX: number,
  playerY: number,
  playerVelX: number,
  playerVelY: number,
  deltaTime: number
): void {
  const enemyX = Transform.x[enemyId];
  const enemyY = Transform.y[enemyId];
  const dx = playerX - enemyX;
  const dy = playerY - enemyY;
  const distance = Math.sqrt(dx * dx + dy * dy) || 1;
  const speed = Velocity.speed[enemyId];
  const state = EnemyAI.state[enemyId];

  const towardX = dx / distance;
  const towardY = dy / distance;

  Transform.rotation[enemyId] = Math.atan2(dy, dx); // aim the dart at the player

  if (state === 0) {
    // Stalk: hold the medium band with a circling strafe, closing in if too far.
    const strafeDirection = enemyId % 2 === 0 ? 1 : -1;
    const tangentX = -towardY * strafeDirection;
    const tangentY = towardX * strafeDirection;

    let radialFactor = 0;
    if (distance < PREFERRED_RANGE - RANGE_SLACK) {
      radialFactor = -0.8; // too close — ease back
    } else if (distance > PREFERRED_RANGE + RANGE_SLACK) {
      radialFactor = 1.0;  // too far — close in aggressively
    }

    const moveX = tangentX * 0.7 + towardX * radialFactor;
    const moveY = tangentY * 0.7 + towardY * radialFactor;
    const moveMagnitude = Math.sqrt(moveX * moveX + moveY * moveY) || 1;
    Velocity.x[enemyId] = (moveX / moveMagnitude) * speed;
    Velocity.y[enemyId] = (moveY / moveMagnitude) * speed;

    EnemyAI.specialTimer[enemyId] -= deltaTime;
    if (EnemyAI.specialTimer[enemyId] <= 0) {
      // Snapshot the player's heading and hurl a predictive line of strikes that
      // races ahead of it. A (near-)stationary player has no heading — the planner
      // falls back to a tight escapable ring.
      const playerSpeed = Math.sqrt(playerVelX * playerVelX + playerVelY * playerVelY);
      let headingX = 0;
      let headingY = 0;
      if (playerSpeed > STALKER_MOVING_THRESHOLD) {
        headingX = playerVelX / playerSpeed;
        headingY = playerVelY / playerSpeed;
      }
      const strikes = planStalkerVolley(playerX, playerY, headingX, headingY);
      pendingStrikesByEntity.set(enemyId, strikes.slice());
      for (const strike of strikes) {
        spawnTelegraph(
          telegraphManager,
          strike.x,
          strike.y,
          stalkerStrikeTelegraph(strike.impactDelay)
        );
      }
      EnemyAI.state[enemyId] = 1;
      EnemyAI.timer[enemyId] = 0;
    }
  } else if (state === 1) {
    // Pounce: keep pressing toward the prey as the predicted strikes land.
    Velocity.x[enemyId] = towardX * speed * 0.6;
    Velocity.y[enemyId] = towardY * speed * 0.6;

    const strikes = pendingStrikesByEntity.get(enemyId);
    const elapsed = EnemyAI.timer[enemyId];
    if (strikes && strikes.length > 0) {
      const damage = EnemyType.baseDamage[enemyId];
      for (let strikeIndex = strikes.length - 1; strikeIndex >= 0; strikeIndex--) {
        if (elapsed >= strikes[strikeIndex].impactDelay) {
          const strike = strikes[strikeIndex];
          if (groundSlamCallback) {
            groundSlamCallback(strike.x, strike.y, STALKER_BLAST_RADIUS, damage);
          }
          strikes.splice(strikeIndex, 1);
        }
      }
    } else {
      // Volley complete (or restored with no plan) — reload and resume stalking.
      pendingStrikesByEntity.delete(enemyId);
      EnemyAI.state[enemyId] = 0;
      EnemyAI.specialTimer[enemyId] = VOLLEY_COOLDOWN;
    }
  }
}
