import { Transform, Velocity, EnemyAI } from '../../components';
import { PI_HALF, telegraphManager } from './common';
import { spawnTelegraph, zigzagDartTelegraph } from './telegraphs';

/**
 * Zigzag Runner — advances on the player with a layered side-to-side
 * oscillation that never exactly repeats, periodically telegraphing a windup
 * and then darting in a straight double-speed lunge.
 */

/**
 * Zigzag - moves toward player but oscillates side to side
 */
export function updateZigzagAI(
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
  if (distance <= 1) return;

  const baseSpeed = Velocity.speed[enemyId];
  const phase = EnemyAI.phase[enemyId];
  // Variable phase speed: oscillates between 3-7 rad/s instead of constant 6
  EnemyAI.phase[enemyId] += deltaTime * (5 + Math.sin(phase * 0.7) * 2);

  // Dart-burst state machine: 0 = cruise, 1 = windup (telegraph), 2 = dart.
  // Phase seeds the cruise interval so a group doesn't lunge in unison.
  EnemyAI.timer[enemyId] -= deltaTime;
  const state = EnemyAI.state[enemyId];
  if (state === 0 && EnemyAI.timer[enemyId] <= 0) {
    // Begin windup; telegraph the lunge lane toward the player.
    EnemyAI.state[enemyId] = 1;
    EnemyAI.timer[enemyId] = 0.35;
    spawnTelegraph(telegraphManager, enemyX, enemyY, zigzagDartTelegraph(Math.atan2(dy, dx)));
  } else if (state === 1 && EnemyAI.timer[enemyId] <= 0) {
    EnemyAI.state[enemyId] = 2;
    EnemyAI.timer[enemyId] = 0.4;
  } else if (state === 2 && EnemyAI.timer[enemyId] <= 0) {
    EnemyAI.state[enemyId] = 0;
    EnemyAI.timer[enemyId] = 2.0 + Math.abs(Math.sin(phase)) * 1.5; // ~2.0-3.5s cruise
  }
  const currentState = EnemyAI.state[enemyId];

  // Calculate perpendicular vector for the side-to-side oscillation
  const perpX = -dy / distance;
  const perpY = dx / distance;

  // Windup slows slightly; dart reduces zigzag and doubles speed for a clean lunge.
  let speed = baseSpeed;
  let zigScale = 1.0;
  if (currentState === 1) {
    speed = baseSpeed * 0.7;
  } else if (currentState === 2) {
    speed = baseSpeed * 2.0;
    zigScale = 0.25;
  }

  // Layered oscillation — irrational ratio means it never exactly repeats
  const rawZigzag = (Math.sin(phase) * 0.5 + Math.sin(phase * 2.3) * 0.35) * zigScale;
  // Distance-sensitive amplitude: full zigzag at range, tightens at close range
  const amplitudeScale = 0.4 + Math.min(distance / 300, 1.0) * 0.6;
  const zigzagAmount = rawZigzag * amplitudeScale;

  // Combine forward movement with zigzag
  const moveX = (dx / distance) + perpX * zigzagAmount;
  const moveY = (dy / distance) + perpY * zigzagAmount;
  const moveMag = Math.sqrt(moveX * moveX + moveY * moveY);

  Velocity.x[enemyId] = (moveX / moveMag) * speed;
  Velocity.y[enemyId] = (moveY / moveMag) * speed;

  // Banking lean: tilt the sprite into the turn (visual only; doesn't alter velocity).
  // Add π/2 so the triangle tip leads; bank from the signed oscillation, capped ±0.3 rad.
  const bank = Math.max(-0.3, Math.min(0.3, zigzagAmount * 0.5));
  Transform.rotation[enemyId] = Math.atan2(Velocity.y[enemyId], Velocity.x[enemyId]) + PI_HALF + bank;
}
