import { describe, test, expect, beforeEach } from 'vitest';
import { Transform, Velocity, EnemyAI, EnemyType, Health } from '../../components';
import { linkTwins, resetEnemyAISystem, unlinkTwin } from './state';
import { updateTwinAI, TWIN_BERSERK_STATE } from './twin';

const TWIN_A = 9001;
const TWIN_B = 9002;
const SPAWN_DAMAGE = 20;
const FRAME_SECONDS = 1 / 60;

function stepFrames(enemyId: number, frames: number): void {
  for (let frame = 0; frame < frames; frame++) {
    updateTwinAI(enemyId, 600, 0, FRAME_SECONDS);
  }
}

beforeEach(() => {
  resetEnemyAISystem();
  for (const twinId of [TWIN_A, TWIN_B]) {
    Transform.x[twinId] = 0;
    Transform.y[twinId] = 0;
    Transform.rotation[twinId] = 0;
    Velocity.x[twinId] = 0;
    Velocity.y[twinId] = 0;
    Velocity.speed[twinId] = 100;
    Health.current[twinId] = 100;
    Health.max[twinId] = 100;
    EnemyAI.state[twinId] = 0;
    EnemyAI.phase[twinId] = 0;
    EnemyType.baseDamage[twinId] = SPAWN_DAMAGE;
  }
  Transform.x[TWIN_B] = 90;
});

describe('updateTwinAI berserk buff', () => {
  test('a twin whose partner died is buffed once, however long it survives', () => {
    linkTwins(TWIN_A, TWIN_B);
    unlinkTwin(TWIN_B);

    stepFrames(TWIN_A, 120);

    expect(EnemyType.baseDamage[TWIN_A]).toBe(SPAWN_DAMAGE * 1.5);
    expect(EnemyAI.state[TWIN_A]).toBe(TWIN_BERSERK_STATE);
  });

  test('a linked pair is never buffed', () => {
    linkTwins(TWIN_A, TWIN_B);

    stepFrames(TWIN_A, 120);

    expect(EnemyType.baseDamage[TWIN_A]).toBe(SPAWN_DAMAGE);
    expect(EnemyAI.state[TWIN_A]).toBe(0);
  });

  test('a restored berserk twin is not buffed a second time', () => {
    EnemyAI.state[TWIN_A] = TWIN_BERSERK_STATE;
    EnemyType.baseDamage[TWIN_A] = SPAWN_DAMAGE * 1.5;

    stepFrames(TWIN_A, 120);

    expect(EnemyType.baseDamage[TWIN_A]).toBe(SPAWN_DAMAGE * 1.5);
  });
});
