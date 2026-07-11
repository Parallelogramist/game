import { Transform, Velocity, EnemyAI } from '../../components';
import { checkBossPhaseTransition } from './boss-phase';
import { EnemyAIType } from '../../../enemies/EnemyTypes';

/**
 * The Legion (boss) — a splitting swarm-lord. The fight grammar lives in the
 * death-split (legion-split.ts + GameScene's legion death branch); the AI here
 * is the pressure layer:
 * - Root: lumbering advance with a periodic surge lunge.
 * - Fragments/motes: encircle the player on a drifting orbit slot, then take
 *   turns lunging. Slot + timers live entirely in serialized EnemyAI fields,
 *   so a mid-fight save-restore resumes seamlessly.
 *
 * States: 0 = advance/encircle, 1 = lunging.
 */

const ROOT_SURGE_DURATION = 1.1;
const ROOT_SURGE_SPEED_MULT = 1.9;
const ROOT_SURGE_SPEED_MULT_PER_PHASE = 0.25;
const ROOT_SURGE_COOLDOWN_BASE = 5.5;
const ROOT_SURGE_COOLDOWN_PER_PHASE = 0.7;

const FRAGMENT_RING_RADIUS = 200;
const MOTE_RING_RADIUS = 130;
const FRAGMENT_ORBIT_DRIFT = 0.35; // rad/s slot creep — the pack slowly wheels around the player
const MOTE_ORBIT_DRIFT = 0.55;
const LUNGE_DURATION = 0.85;
const LUNGE_SPEED_MULT = 2.1;
const LUNGE_COOLDOWN_BASE = 3.2;
const LUNGE_RANGE_FACTOR = 1.6; // may lunge when player is within ring × this

export function updateLegionAI(
  enemyId: number,
  playerX: number,
  playerY: number,
  deltaTime: number
): void {
  const dx = playerX - Transform.x[enemyId];
  const dy = playerY - Transform.y[enemyId];
  const distance = Math.sqrt(dx * dx + dy * dy) || 1;
  const baseSpeed = Velocity.speed[enemyId];
  const legionPhase = checkBossPhaseTransition(enemyId);

  if (EnemyAI.state[enemyId] === 1) {
    const surgeSpeed = baseSpeed * (ROOT_SURGE_SPEED_MULT + ROOT_SURGE_SPEED_MULT_PER_PHASE * legionPhase);
    Velocity.x[enemyId] = (dx / distance) * surgeSpeed;
    Velocity.y[enemyId] = (dy / distance) * surgeSpeed;
    EnemyAI.timer[enemyId] -= deltaTime;
    if (EnemyAI.timer[enemyId] <= 0) {
      EnemyAI.state[enemyId] = 0;
      EnemyAI.specialTimer[enemyId] = ROOT_SURGE_COOLDOWN_BASE - ROOT_SURGE_COOLDOWN_PER_PHASE * legionPhase;
    }
  } else {
    Velocity.x[enemyId] = (dx / distance) * baseSpeed;
    Velocity.y[enemyId] = (dy / distance) * baseSpeed;
    EnemyAI.specialTimer[enemyId] -= deltaTime;
    if (EnemyAI.specialTimer[enemyId] <= 0) {
      EnemyAI.state[enemyId] = 1;
      EnemyAI.timer[enemyId] = ROOT_SURGE_DURATION;
    }
  }

  Transform.rotation[enemyId] = Math.atan2(dy, dx);
}

export function updateLegionFragmentAI(
  enemyId: number,
  playerX: number,
  playerY: number,
  deltaTime: number
): void {
  const isMote = EnemyAI.aiType[enemyId] === EnemyAIType.LegionMote;
  const ringRadius = isMote ? MOTE_RING_RADIUS : FRAGMENT_RING_RADIUS;
  const orbitDrift = isMote ? MOTE_ORBIT_DRIFT : FRAGMENT_ORBIT_DRIFT;

  const enemyX = Transform.x[enemyId];
  const enemyY = Transform.y[enemyId];
  const toPlayerX = playerX - enemyX;
  const toPlayerY = playerY - enemyY;
  const playerDistance = Math.sqrt(toPlayerX * toPlayerX + toPlayerY * toPlayerY) || 1;
  const baseSpeed = Velocity.speed[enemyId];

  if (EnemyAI.state[enemyId] === 1) {
    Velocity.x[enemyId] = (toPlayerX / playerDistance) * baseSpeed * LUNGE_SPEED_MULT;
    Velocity.y[enemyId] = (toPlayerY / playerDistance) * baseSpeed * LUNGE_SPEED_MULT;
    EnemyAI.timer[enemyId] -= deltaTime;
    if (EnemyAI.timer[enemyId] <= 0) {
      EnemyAI.state[enemyId] = 0;
      // Slot-derived jitter staggers the pack so lunges take turns.
      EnemyAI.specialTimer[enemyId] = LUNGE_COOLDOWN_BASE + (EnemyAI.phase[enemyId] % 1.3);
    }
  } else {
    EnemyAI.phase[enemyId] += orbitDrift * deltaTime;
    const slotAngle = EnemyAI.phase[enemyId];
    const slotX = playerX + Math.cos(slotAngle) * ringRadius;
    const slotY = playerY + Math.sin(slotAngle) * ringRadius;
    const toSlotX = slotX - enemyX;
    const toSlotY = slotY - enemyY;
    const slotDistance = Math.sqrt(toSlotX * toSlotX + toSlotY * toSlotY) || 1;
    Velocity.x[enemyId] = (toSlotX / slotDistance) * baseSpeed;
    Velocity.y[enemyId] = (toSlotY / slotDistance) * baseSpeed;

    EnemyAI.specialTimer[enemyId] -= deltaTime;
    if (EnemyAI.specialTimer[enemyId] <= 0 && playerDistance < ringRadius * LUNGE_RANGE_FACTOR) {
      EnemyAI.state[enemyId] = 1;
      EnemyAI.timer[enemyId] = LUNGE_DURATION;
    }
  }

  Transform.rotation[enemyId] = Math.atan2(toPlayerY, toPlayerX);
}
