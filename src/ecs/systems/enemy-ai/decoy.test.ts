import { describe, test, expect, beforeEach } from 'vitest';
import { createWorld, addEntity, addComponent } from 'bitecs';
import { EnemyAI, Transform } from '../../components';
import { EnemyAIType } from '../../../enemies/EnemyTypes';
import {
  setEnemyDecoy,
  resetDecoySystem,
  updateDecoyFollowers,
  isDecoyFollower,
  getDecoyFollowerCount,
  DECOY_MAX_FOLLOWERS,
} from './decoy';

const world = createWorld();

function makeEnemy(x: number, y: number, aiType: EnemyAIType): number {
  const entityId = addEntity(world);
  addComponent(world, Transform, entityId);
  addComponent(world, EnemyAI, entityId);
  Transform.x[entityId] = x;
  Transform.y[entityId] = y;
  EnemyAI.aiType[entityId] = aiType;
  return entityId;
}

/** The ship sits at the origin for every case, so "near the drone" and "near the ship" are both
 *  read straight off the coordinates. */
const PLAYER_X = 0;
const PLAYER_Y = 0;
const DECOY_X = 600;
const DECOY_Y = 0;

describe('updateDecoyFollowers', () => {
  beforeEach(() => {
    resetDecoySystem();
  });

  test('no decoy means no followers and a null target', () => {
    const chaser = makeEnemy(DECOY_X, DECOY_Y, EnemyAIType.Chase);
    expect(updateDecoyFollowers([chaser], PLAYER_X, PLAYER_Y)).toBeNull();
    expect(isDecoyFollower(chaser)).toBe(false);
  });

  test('a melee chaser near the decoy and away from the ship breaks off', () => {
    setEnemyDecoy(DECOY_X, DECOY_Y);
    const chaser = makeEnemy(DECOY_X + 100, DECOY_Y, EnemyAIType.Chase);
    const target = updateDecoyFollowers([chaser], PLAYER_X, PLAYER_Y);
    expect(target).toEqual({ x: DECOY_X, y: DECOY_Y });
    expect(isDecoyFollower(chaser)).toBe(true);
  });

  test('a chaser inside the ship guard radius stays on the ship', () => {
    setEnemyDecoy(150, 0);
    const chaser = makeEnemy(190, 0, EnemyAIType.Chase);
    updateDecoyFollowers([chaser], PLAYER_X, PLAYER_Y);
    expect(isDecoyFollower(chaser)).toBe(false);
  });

  test('a chaser beyond the aggro radius ignores the decoy', () => {
    setEnemyDecoy(DECOY_X, DECOY_Y);
    const chaser = makeEnemy(DECOY_X + 400, DECOY_Y, EnemyAIType.Chase);
    updateDecoyFollowers([chaser], PLAYER_X, PLAYER_Y);
    expect(isDecoyFollower(chaser)).toBe(false);
  });

  test('non-attacking and boss types never break off, however close they are', () => {
    setEnemyDecoy(DECOY_X, DECOY_Y);
    const orbiter = makeEnemy(DECOY_X + 10, DECOY_Y, EnemyAIType.Circle);
    const healer = makeEnemy(DECOY_X + 12, DECOY_Y, EnemyAIType.Healer);
    const boss = makeEnemy(DECOY_X + 14, DECOY_Y, EnemyAIType.HordeKing);
    updateDecoyFollowers([orbiter, healer, boss], PLAYER_X, PLAYER_Y);
    expect(getDecoyFollowerCount()).toBe(0);
  });

  test('a ranged hostile near the decoy and away from the ship breaks off to shoot it', () => {
    setEnemyDecoy(DECOY_X, DECOY_Y);
    const sniper = makeEnemy(DECOY_X + 100, DECOY_Y, EnemyAIType.Sniper);
    const shooter = makeEnemy(DECOY_X + 120, DECOY_Y, EnemyAIType.Shooter);
    updateDecoyFollowers([sniper, shooter], PLAYER_X, PLAYER_Y);
    expect(isDecoyFollower(sniper)).toBe(true);
    expect(isDecoyFollower(shooter)).toBe(true);
  });

  test('only the nearest DECOY_MAX_FOLLOWERS hold the decoy', () => {
    setEnemyDecoy(DECOY_X, DECOY_Y);
    const nearest = [40, 60, 80, 100].map((offset) =>
      makeEnemy(DECOY_X + offset, DECOY_Y, EnemyAIType.Chase));
    const farther = [200, 250].map((offset) =>
      makeEnemy(DECOY_X + offset, DECOY_Y, EnemyAIType.Chase));
    updateDecoyFollowers([...farther, ...nearest], PLAYER_X, PLAYER_Y);
    expect(getDecoyFollowerCount()).toBe(DECOY_MAX_FOLLOWERS);
    for (const entityId of nearest) expect(isDecoyFollower(entityId)).toBe(true);
    for (const entityId of farther) expect(isDecoyFollower(entityId)).toBe(false);
  });
});
