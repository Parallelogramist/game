import { describe, test, expect } from 'vitest';
import { createWorld, addEntity, removeEntity, hasComponent } from 'bitecs';
import { StatusEffect } from '../components';
import {
  applyBurn,
  applyFreeze,
  applyPoison,
  setChainImmunity,
} from './StatusEffectSystem';

/**
 * Regression guard for the 2026-07-06 field crash: "bitECS - entity does not
 * exist in the world". Systems that consume the per-frame enemy cache (e.g.
 * the FREEZE floor consumable) can hand these appliers an entity that was
 * killed and recycled earlier in the same frame. Every status applier must
 * tolerate a stale id instead of throwing — an uncaught throw here kills
 * Phaser's rAF loop and freezes the whole game.
 */

type Applier = { name: string; apply: (world: ReturnType<typeof createWorld>, eid: number) => void };

const APPLIERS: Applier[] = [
  { name: 'applyBurn', apply: (w, e) => applyBurn(w, e, 10, 1000) },
  { name: 'applyFreeze', apply: (w, e) => applyFreeze(w, e, 0.5, 1000) },
  { name: 'applyPoison', apply: (w, e) => applyPoison(w, e, 2, 1000) },
  { name: 'setChainImmunity', apply: (w, e) => setChainImmunity(w, e, 500) },
];

describe('status appliers on stale entity ids', () => {
  for (const { name, apply } of APPLIERS) {
    test(`${name} does not throw for a removed entity`, () => {
      const world = createWorld();
      const eid = addEntity(world);
      removeEntity(world, eid);

      expect(() => apply(world, eid)).not.toThrow();
    });

    test(`${name} still applies to a live entity`, () => {
      const world = createWorld();
      const eid = addEntity(world);

      apply(world, eid);

      expect(hasComponent(world, StatusEffect, eid)).toBe(true);
    });
  }

  test('applyFreeze on a live entity records the slow and duration', () => {
    const world = createWorld();
    const eid = addEntity(world);

    applyFreeze(world, eid, 0.12, 2800);

    expect(StatusEffect.freezeMultiplier[eid]).toBeCloseTo(0.12);
    expect(StatusEffect.freezeDuration[eid]).toBe(2800);
  });

  test('a stale-id apply does not resurrect state onto the dead slot', () => {
    const world = createWorld();
    const eid = addEntity(world);
    applyFreeze(world, eid, 0.5, 1000);
    removeEntity(world, eid);

    applyFreeze(world, eid, 0.12, 2800);

    // The slot must not have been re-registered with the component.
    // (Component data arrays may retain old values; what matters is that the
    // entity was not structurally touched after removal.)
    let liveWithComponent = false;
    try {
      liveWithComponent = hasComponent(world, StatusEffect, eid);
    } catch {
      // Some bitECS builds throw on hasComponent for dead ids — equally fine:
      // the applier must have early-returned before addComponent.
      liveWithComponent = false;
    }
    expect(liveWithComponent).toBe(false);
  });
});
