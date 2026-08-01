import { EnemyAI, Transform } from '../../components';
import { EnemyAIType } from '../../../enemies/EnemyTypes';

/**
 * A friendly object hostiles will break off and walk at, published by GameScene while a quest
 * escort drone is alive and cleared with it. Arena, daily, weekly, practice and gauntlet never set
 * one, so every mode but the expedition is untouched by construction.
 */

/** Only hostiles already this close break off: a decoy is a local threat, never a room magnet. */
export const DECOY_AGGRO_RADIUS = 360;
/**
 * A hostile this close to the ship always prefers the ship, which is the whole counterplay: flying
 * to your drone takes its attackers back off it, so an escort is defended rather than watched.
 */
export const DECOY_PLAYER_GUARD_RADIUS = 200;
/** Nearest-first, so a drone under fire is a fight the player can win rather than a room-wide pull. */
export const DECOY_MAX_FOLLOWERS = 4;

/**
 * The regular AI types a decoy can honestly redirect: every type whose attack can actually reach
 * the drone. The melee family walks into its target; Shooter and Sniper fire pooled enemy
 * projectiles, which the drone is solid to since FEAT-DECOY-RANGED-INTEREST, so aiming them at it
 * is a real threat rather than deleting them from the fight. Every exclusion is deliberate: Circle
 * orbits at a standoff and has no attack at all; Healer flees its target; Teleporter's whole read
 * is blinking next to the ship; Giant and Warden deal telegraphed AOE the drone is still not solid
 * to (FEAT-DECOY-AOE-INTEREST); a Wraith is intangible and harmless for half of its cycle; Rallier
 * buffs its own allies rather than touching anything. Minibosses and bosses (aiType >= 50) are
 * absent on purpose: an escort must never be able to pull a boss.
 */
export const DECOY_AGGRO_AI_TYPES: ReadonlySet<EnemyAIType> = new Set([
  EnemyAIType.Chase,
  EnemyAIType.Zigzag,
  EnemyAIType.Dash,
  EnemyAIType.Swarm,
  EnemyAIType.Tank,
  EnemyAIType.Exploder,
  EnemyAIType.Splitter,
  EnemyAIType.Shielded,
  EnemyAIType.Lurker,
  EnemyAIType.Ghost,
  EnemyAIType.SplitterMini,
  EnemyAIType.Shooter,
  EnemyAIType.Sniper,
]);

const decoyPoint = { x: 0, y: 0 };
let decoyActive = false;

const followerIds = new Int32Array(DECOY_MAX_FOLLOWERS);
const followerDistSq = new Float64Array(DECOY_MAX_FOLLOWERS);
let followerCount = 0;

export function setEnemyDecoy(x: number, y: number): void {
  decoyPoint.x = x;
  decoyPoint.y = y;
  decoyActive = true;
}

export function clearEnemyDecoy(): void {
  decoyActive = false;
  followerCount = 0;
}

export function resetDecoySystem(): void {
  clearEnemyDecoy();
  decoyPoint.x = 0;
  decoyPoint.y = 0;
}

/**
 * Rebuild the follower set for this frame and hand back where they should walk, or null when
 * nothing is decoying. Returns a shared instance: read it before the next call, never retain it.
 */
export function updateDecoyFollowers(
  enemyIds: ArrayLike<number>,
  playerX: number,
  playerY: number,
): { x: number; y: number } | null {
  followerCount = 0;
  if (!decoyActive) return null;

  const aggroRadiusSq = DECOY_AGGRO_RADIUS * DECOY_AGGRO_RADIUS;
  const guardRadiusSq = DECOY_PLAYER_GUARD_RADIUS * DECOY_PLAYER_GUARD_RADIUS;

  for (let i = 0; i < enemyIds.length; i++) {
    const enemyId = enemyIds[i];
    const enemyX = Transform.x[enemyId];
    const enemyY = Transform.y[enemyId];

    const toDecoyX = enemyX - decoyPoint.x;
    const toDecoyY = enemyY - decoyPoint.y;
    const decoyDistSq = toDecoyX * toDecoyX + toDecoyY * toDecoyY;
    if (decoyDistSq > aggroRadiusSq) continue;

    const toPlayerX = enemyX - playerX;
    const toPlayerY = enemyY - playerY;
    if (toPlayerX * toPlayerX + toPlayerY * toPlayerY <= guardRadiusSq) continue;

    if (!DECOY_AGGRO_AI_TYPES.has(EnemyAI.aiType[enemyId])) continue;

    insertFollower(enemyId, decoyDistSq);
  }

  return decoyPoint;
}

/** Insertion into a sorted four-slot list, so the nearest bodies hold the decoy and the rest of
 *  the room is never sorted. */
function insertFollower(enemyId: number, distSq: number): void {
  let slot = followerCount < DECOY_MAX_FOLLOWERS ? followerCount : DECOY_MAX_FOLLOWERS - 1;
  if (followerCount === DECOY_MAX_FOLLOWERS && distSq >= followerDistSq[slot]) return;
  while (slot > 0 && followerDistSq[slot - 1] > distSq) {
    followerIds[slot] = followerIds[slot - 1];
    followerDistSq[slot] = followerDistSq[slot - 1];
    slot--;
  }
  followerIds[slot] = enemyId;
  followerDistSq[slot] = distSq;
  if (followerCount < DECOY_MAX_FOLLOWERS) followerCount++;
}

export function isDecoyFollower(enemyId: number): boolean {
  for (let i = 0; i < followerCount; i++) {
    if (followerIds[i] === enemyId) return true;
  }
  return false;
}

export function getDecoyFollowerCount(): number {
  return followerCount;
}
