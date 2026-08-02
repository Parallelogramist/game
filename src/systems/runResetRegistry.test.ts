import { describe, test, expect } from 'vitest';
import registrySource from './runResetRegistry.ts?raw';
import gameSceneSource from '../game/scenes/GameScene.ts?raw';
import enemyAiStateSource from '../ecs/systems/enemy-ai/state.ts?raw';

const scopedSources = import.meta.glob<string>(
  ['./**/*.ts', '../ecs/**/*.ts', '!./**/*.test.ts', '!../ecs/**/*.test.ts'],
  { query: '?raw', import: 'default', eager: true }
);

// A reset named *ForTests / *ForTesting is a suite helper, not a run-scoped system:
// registering one would wipe live state at the start of every run.
const declaredResets = new Set(
  Object.values(scopedSources)
    .flatMap((source) =>
      [...source.matchAll(/^export function (reset[A-Za-z0-9_]*)\(/gm)].map((match) => match[1])
    )
    .filter((name) => !/For(Tests|Testing)$/.test(name))
);

const registryBlockStart = registrySource.indexOf('const RUN_RESETS');
const registryBlock = registrySource.slice(
  registryBlockStart,
  registrySource.indexOf('];', registryBlockStart)
);
const registeredResets = new Set(
  [...registryBlock.matchAll(/\breset[A-Za-z0-9_]*\b/g)].map((match) => match[0])
);

const EXEMPT_FROM_REGISTRY: Record<string, { reason: string; stillCovered: () => boolean }> = {
  resetDirectorSystem: {
    reason: 'takes the run strategy, so GameScene calls it in the tail of resetAllRunSystems',
    stillCovered: () => gameSceneSource.includes('resetDirectorSystem(this.directorStrategy)'),
  },
  resetEnemyNavState: {
    reason: 'resetEnemyAISystem calls it, and resetEnemyAISystem is registered',
    stillCovered: () => enemyAiStateSource.includes('resetEnemyNavState()'),
  },
};

describe('run reset registry', () => {
  test('the source scan finds the reset exports it is meant to police', () => {
    expect(declaredResets.size).toBeGreaterThan(25);
    expect(registeredResets.size).toBeGreaterThan(25);
  });

  test('every run-scoped reset in src/systems and src/ecs is registered', () => {
    const unregistered = [...declaredResets].filter(
      (name) => !registeredResets.has(name) && !(name in EXEMPT_FROM_REGISTRY)
    );
    expect(unregistered, 'these bleed their state into the next run').toEqual([]);
  });

  test('each registry exemption is still covered the way it claims', () => {
    const broken = Object.entries(EXEMPT_FROM_REGISTRY)
      .filter(([, exemption]) => !exemption.stillCovered())
      .map(([name, exemption]) => `${name}: ${exemption.reason}`);
    expect(broken).toEqual([]);
  });
});
