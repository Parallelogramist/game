import { Transform, Velocity, EnemyAI } from '../../components';

/**
 * Splitter family — the parent wobbles toward the player with a pulsing
 * gelatinous gait that hints at its split-on-death mechanic; the minis it
 * spawns scatter outward for 0.5s, then chase frantically with a
 * half-amplitude zigzag.
 */

/**
 * Splitter - wobbling chase that pulses in speed.
 * Gelatinous feel that hints at splitting mechanic.
 */
export function updateSplitterAI(enemyId: number, playerX: number, playerY: number, deltaTime: number): void {
  const enemyX = Transform.x[enemyId];
  const enemyY = Transform.y[enemyId];
  const dx = playerX - enemyX;
  const dy = playerY - enemyY;
  const distance = Math.sqrt(dx * dx + dy * dy);

  if (distance > 1) {
    EnemyAI.phase[enemyId] += deltaTime;
    const phase = EnemyAI.phase[enemyId];
    const speed = Velocity.speed[enemyId];

    // Pulsing speed: 0.6x to 1.2x
    const speedMultiplier = 0.9 + Math.sin(phase * 3) * 0.3;

    // Slight perpendicular drift for wobble
    const perpX = -dy / distance;
    const perpY = dx / distance;
    const wobble = Math.sin(phase * 1.7) * 0.15;

    const moveX = (dx / distance) + perpX * wobble;
    const moveY = (dy / distance) + perpY * wobble;
    const moveMag = Math.sqrt(moveX * moveX + moveY * moveY);

    Velocity.x[enemyId] = (moveX / moveMag) * speed * speedMultiplier;
    Velocity.y[enemyId] = (moveY / moveMag) * speed * speedMultiplier;
    Transform.rotation[enemyId] = Math.atan2(dy, dx);
  }
}

/**
 * Splitter Mini - scatter burst then frantic chase.
 * State 0: Scatter outward for 0.5s in random direction
 * State 1: Chase with half-amplitude zigzag
 */
export function updateSplitterMiniAI(enemyId: number, playerX: number, playerY: number, deltaTime: number): void {
  const state = EnemyAI.state[enemyId];
  const enemyX = Transform.x[enemyId];
  const enemyY = Transform.y[enemyId];
  const speed = Velocity.speed[enemyId];

  if (state === 0) {
    // Scatter — burst outward in direction set by phase at spawn
    const scatterAngle = EnemyAI.phase[enemyId];
    Velocity.x[enemyId] = Math.cos(scatterAngle) * speed * 1.5;
    Velocity.y[enemyId] = Math.sin(scatterAngle) * speed * 1.5;
    Transform.rotation[enemyId] = scatterAngle;

    if (EnemyAI.timer[enemyId] > 0.5) {
      EnemyAI.state[enemyId] = 1;
      EnemyAI.timer[enemyId] = 0;
    }
  } else {
    // Frantic chase with half-amplitude zigzag
    const dx = playerX - enemyX;
    const dy = playerY - enemyY;
    const distance = Math.sqrt(dx * dx + dy * dy);

    if (distance > 1) {
      EnemyAI.phase[enemyId] += deltaTime * 5;
      const phase = EnemyAI.phase[enemyId];

      const perpX = -dy / distance;
      const perpY = dx / distance;
      const zigzag = Math.sin(phase) * 0.25; // Half amplitude

      const moveX = (dx / distance) + perpX * zigzag;
      const moveY = (dy / distance) + perpY * zigzag;
      const moveMag = Math.sqrt(moveX * moveX + moveY * moveY);

      Velocity.x[enemyId] = (moveX / moveMag) * speed;
      Velocity.y[enemyId] = (moveY / moveMag) * speed;
      Transform.rotation[enemyId] = Math.atan2(moveY, moveX);
    }
  }
}
