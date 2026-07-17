import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// JuiceManager imports Phaser for types only — it makes no runtime Phaser calls —
// so an empty module keeps it loadable in the Node test env.
vi.mock('phaser', () => ({ default: {} }));
// Reduced motion on suppresses the camera-zoom tween, leaving tweens.timeScale as
// the single observable this suite needs.
vi.mock('../settings', () => ({
  getSettingsManager: () => ({ isReducedMotionEnabled: () => true }),
}));

import { JuiceManager } from './JuiceManager';

type SceneArg = Parameters<JuiceManager['setScene']>[0];

interface FakeScene {
  time: { now: number; delayedCall: (delay: number, callback: () => void) => void };
  tweens: {
    timeScale: number;
    add: () => { remove: () => void };
    addCounter: () => { timeScale: number };
  };
  cameras: { main: Record<string, unknown> };
  pendingDelays: Array<() => void>;
}

function makeFakeScene(): FakeScene {
  const pendingDelays: Array<() => void> = [];
  return {
    time: {
      now: 0,
      delayedCall: (_delay: number, callback: () => void) => {
        pendingDelays.push(callback);
      },
    },
    tweens: {
      timeScale: 1,
      add: () => ({ remove: () => {} }),
      addCounter: () => ({ timeScale: 1 }),
    },
    cameras: { main: {} },
    pendingDelays,
  };
}

const asScene = (scene: FakeScene): SceneArg => scene as unknown as SceneArg;

describe('JuiceManager hit stop / slow motion handoff', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  // The regression this file exists for: every dramatic callsite fires hitStop and
  // slowMotion in one synchronous call (boss kill, miniboss kill, phase break, combo
  // annihilation), and the slow-mo used to be dropped on the spot.
  it('plays a slow-motion requested during a hit stop once the freeze ends', () => {
    const juice = new JuiceManager();
    const scene = makeFakeScene();
    juice.setScene(asScene(scene));

    juice.hitStop(100, 1.0);
    const frozenTimeScale = scene.tweens.timeScale;
    expect(frozenTimeScale).toBeLessThan(0.5);

    juice.slowMotion(300, 0.25);
    // Must wait rather than fight the hit stop for ownership of timeScale.
    expect(scene.tweens.timeScale).toBe(frozenTimeScale);

    scene.pendingDelays.forEach((callback) => callback());

    expect(scene.tweens.timeScale).toBe(0.25);
  });

  it('plays a slow-motion immediately when no hit stop is in flight', () => {
    const juice = new JuiceManager();
    const scene = makeFakeScene();
    juice.setScene(asScene(scene));

    juice.slowMotion(300, 0.25);

    expect(scene.tweens.timeScale).toBe(0.25);
  });

  // A hit stop's clearing delayedCall lives on the scene's clock and dies with it.
  it('does not let a hit stop cut short by scene teardown mute the next run', () => {
    const juice = new JuiceManager();
    const dyingScene = makeFakeScene();
    juice.setScene(asScene(dyingScene));

    juice.hitStop(100, 1.0);
    juice.setScene(null);

    const nextRun = makeFakeScene();
    juice.setScene(asScene(nextRun));
    juice.slowMotion(300, 0.25);

    expect(nextRun.tweens.timeScale).toBe(0.25);
  });

  it('does not let a hit stop cut short by scene teardown mute later hit stops', () => {
    const juice = new JuiceManager();
    const dyingScene = makeFakeScene();
    juice.setScene(asScene(dyingScene));

    juice.hitStop(100, 1.0);
    juice.setScene(null);

    const nextRun = makeFakeScene();
    juice.setScene(asScene(nextRun));
    juice.hitStop(60, 0.9);

    expect(nextRun.tweens.timeScale).toBeLessThan(1);
    expect(juice.isHitStopActive()).toBe(true);
  });
});
