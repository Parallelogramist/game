import { describe, expect, it } from 'vitest';
import { describeRegionSignature } from './regionSignature';
import { STAGE_SPAWN_BIASES } from './DirectorSystem';

describe('describeRegionSignature', () => {
  it('states the boosted pair and the suppressed type, breaking ties by id', () => {
    expect(describeRegionSignature('stage_ion_field'))
      .toBe('SENDS SHOOTER AND SNIPER  ·  FEW EXPLODER');
    // teleporter and wraith are both 3.0, so only the id tie-break makes this stable.
    expect(describeRegionSignature('stage_endless_void'))
      .toBe('SENDS TELEPORTER AND WRAITH  ·  FEW TANK');
  });

  it('says nothing for the unbiased default stage or an unknown one', () => {
    expect(STAGE_SPAWN_BIASES.stage_deep_void).toEqual({});
    expect(describeRegionSignature('stage_deep_void')).toBeNull();
    expect(describeRegionSignature('stage_not_a_real_id')).toBeNull();
  });

  it('names every biased stage without leaking an unresolved enemy id', () => {
    for (const stageId of Object.keys(STAGE_SPAWN_BIASES)) {
      const line = describeRegionSignature(stageId);
      if (line === null) continue;
      expect(line).toMatch(/^SENDS .+ {2}·{1} {2}FEW .+$/);
      expect(line).not.toContain('undefined');
    }
  });
});
