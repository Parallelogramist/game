import { describe, expect, it } from 'vitest';
import { describeRegionSignature } from './regionSignature';
import { STAGE_SPAWN_BIASES } from './DirectorSystem';
import { STAGE_HAZARD_BIASES } from './stageHazardBias';

describe('describeRegionSignature', () => {
  it('states the boosted pair, the suppressed type and the hazard the ground grows', () => {
    expect(describeRegionSignature('stage_ion_field'))
      .toBe('SENDS SHOOTER AND SNIPER  ·  FEW EXPLODER  ·  BLOOMS ENERGY');
    // teleporter and wraith are both 3.0, so only the id tie-break makes this stable.
    expect(describeRegionSignature('stage_endless_void'))
      .toBe('SENDS TELEPORTER AND WRAITH  ·  FEW TANK  ·  BLOOMS VOID');
    // burn 2.5 outranks energy 1.5, and swarm/zigzag tie at 0.5 on the suppressed side.
    expect(describeRegionSignature('stage_molten_vault'))
      .toBe('SENDS GIANT AND TANK  ·  FEW TINY SWARM  ·  BLOOMS FIRE');
  });

  it('says nothing for the unbiased default stage or an unknown one', () => {
    expect(STAGE_SPAWN_BIASES.stage_deep_void).toEqual({});
    expect(STAGE_HAZARD_BIASES.stage_deep_void.weightMultipliers)
      .toEqual({ burn: 1, ice: 1, void: 1, energy: 1 });
    expect(describeRegionSignature('stage_deep_void')).toBeNull();
    expect(describeRegionSignature('stage_not_a_real_id')).toBeNull();
  });

  it('names every biased stage without leaking an unresolved id', () => {
    for (const stageId of Object.keys(STAGE_SPAWN_BIASES)) {
      const line = describeRegionSignature(stageId);
      if (line === null) continue;
      expect(line).toMatch(/^SENDS .+ {2}·{1} {2}FEW .+ {2}·{1} {2}BLOOMS [A-Z]+$/);
      expect(line).not.toContain('undefined');
    }
  });
});
