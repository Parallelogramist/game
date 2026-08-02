import { describe, test, expect, beforeEach, afterEach } from 'vitest';
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
import {
  chaseHeading,
  setNavigationContext,
  setNavFrame,
  advanceNavClock,
  resetEnemyNavState,
} from './common';
import type { NavigationContext } from './common';

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

/**
 * The flow field is solved toward the ship, so a follower that falls to it walks away from the
 * drone. The failure is silent: the enemy still moves plausibly, just in the wrong direction.
 */
describe('a follower steering at the drone', () => {
  const FOLLOWER_ID = 4101;
  const FOLLOWER_X = 300;
  const DRONE_X = 600;
  const TICK_SECONDS = 0.016;

  /** No sight of anything, and a flow route that always steps one tile west, toward the ship. */
  function routedTowardTheShip(
    isSolidAt: (x: number, y: number) => boolean,
  ): NavigationContext {
    return {
      hasLineOfSight: () => false,
      flowStep: (x, y, out) => { out.x = x - 40; out.y = y; return true; },
      isSolidAt,
      freeSpotNear: (x, y, out) => { out.x = x; out.y = y; },
    };
  }

  /** One AI tick for a body at FOLLOWER_X steering east at `targetX`. */
  function tick(targetX: number, targetIsOffFlowRoute: boolean): { x: number; y: number } {
    advanceNavClock(TICK_SECONDS);
    setNavFrame(FOLLOWER_ID, TICK_SECONDS, targetIsOffFlowRoute);
    const direction = Math.sign(targetX - FOLLOWER_X);
    const heading = chaseHeading(FOLLOWER_X, 0, targetX, 0, direction, 0);
    return { x: heading.x, y: heading.y };
  }

  beforeEach(() => {
    resetEnemyNavState();
  });

  afterEach(() => {
    setNavigationContext(null);
    resetEnemyNavState();
  });

  test('keeps walking at the drone in the open instead of taking the route to the ship', () => {
    setNavigationContext(routedTowardTheShip(() => false));

    const heading = tick(DRONE_X, true);

    expect(heading.x).toBeCloseTo(1);
    expect(heading.y).toBeCloseTo(0);
  });

  test('turns along a wall between it and the drone, never back toward the ship', () => {
    setNavigationContext(routedTowardTheShip(x => Math.floor(x / 40) === 8));

    const heading = tick(DRONE_X, true);

    expect(heading.x).toBeCloseTo(0);
    expect(Math.abs(heading.y)).toBeCloseTo(1);
  });

  test('a hostile still chasing the ship keeps the flow route', () => {
    setNavigationContext(routedTowardTheShip(x => Math.floor(x / 40) === 8));

    const heading = tick(0, false);

    expect(heading.x).toBeCloseTo(-1);
    expect(heading.y).toBeCloseTo(0);
  });
});
