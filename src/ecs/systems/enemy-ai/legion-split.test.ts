import { describe, test, expect, beforeEach } from 'vitest';
import {
  legionGenerationForType,
  isLegionTypeId,
  legionPotentialMultiplier,
  legionPoolFromMember,
  legionChildSpawnOffsets,
  resetLegionSystem,
  registerLegionRoot,
  registerLegionChild,
  onLegionMemberDeath,
  registerRestoredLegionMembers,
  forEachLegionGroup,
} from './legion-split';

beforeEach(() => {
  resetLegionSystem();
});

describe('legionGenerationForType', () => {
  test('resolves generation for each legion typeId, null otherwise', () => {
    expect(legionGenerationForType('the_legion')).toBe(0);
    expect(legionGenerationForType('legion_fragment')).toBe(1);
    expect(legionGenerationForType('legion_mote')).toBe(2);
    expect(legionGenerationForType('basic')).toBeNull();
  });
});

describe('isLegionTypeId', () => {
  test('true for all three legion types, false for non-legion types', () => {
    expect(isLegionTypeId('the_legion')).toBe(true);
    expect(isLegionTypeId('legion_fragment')).toBe(true);
    expect(isLegionTypeId('legion_mote')).toBe(true);
    expect(isLegionTypeId('the_bastion')).toBe(false);
  });
});

describe('legionPotentialMultiplier', () => {
  test('decreases with generation', () => {
    expect(legionPotentialMultiplier(0)).toBe(2);
    expect(legionPotentialMultiplier(1)).toBe(1);
    expect(legionPotentialMultiplier(2)).toBe(0);
  });
});

describe('legionPoolFromMember', () => {
  test('any member reconstructs the same total pool', () => {
    expect(legionPoolFromMember(0, 100)).toBe(300);
    expect(legionPoolFromMember(1, 50)).toBe(300);
    expect(legionPoolFromMember(2, 25)).toBe(300);
  });
});

describe('legionChildSpawnOffsets', () => {
  test('fans children evenly and deterministically', () => {
    const offsets = legionChildSpawnOffsets(2, 48, 0);
    expect(offsets[0].x).toBeCloseTo(48);
    expect(offsets[0].y).toBeCloseTo(0);
    expect(offsets[1].x).toBeCloseTo(-48);
    expect(offsets[1].y).toBeCloseTo(0);

    const again = legionChildSpawnOffsets(2, 48, 0);
    expect(again).toEqual(offsets);
  });
});

describe('onLegionMemberDeath', () => {
  test('root death splits, is not the last member', () => {
    registerLegionRoot(10);
    const outcome = onLegionMemberDeath(10);
    expect(outcome).not.toBeNull();
    expect(outcome!.isLastMember).toBe(false);
    expect(outcome!.childTypeId).toBe('legion_fragment');
    expect(outcome!.childCount).toBe(2);
    expect(outcome!.anchorId).toBe(10);
    expect(outcome!.generation).toBe(0);
  });

  test('unknown entity returns null', () => {
    expect(onLegionMemberDeath(99)).toBeNull();
  });

  test('double-death of the same id returns null the second time', () => {
    registerLegionRoot(10);
    expect(onLegionMemberDeath(10)).not.toBeNull();
    expect(onLegionMemberDeath(10)).toBeNull();
  });

  test('full cascade to the last member pays out once', () => {
    registerLegionRoot(10);
    const rootOutcome = onLegionMemberDeath(10)!;
    expect(rootOutcome.isLastMember).toBe(false);

    registerLegionChild(11, rootOutcome.groupId, 1);
    registerLegionChild(12, rootOutcome.groupId, 1);

    const outcome11 = onLegionMemberDeath(11)!;
    expect(outcome11.isLastMember).toBe(false);
    registerLegionChild(13, outcome11.groupId, 2);
    registerLegionChild(14, outcome11.groupId, 2);

    const outcome12 = onLegionMemberDeath(12)!;
    expect(outcome12.isLastMember).toBe(false);
    registerLegionChild(15, outcome12.groupId, 2);
    registerLegionChild(16, outcome12.groupId, 2);

    expect(onLegionMemberDeath(13)!.isLastMember).toBe(false);
    expect(onLegionMemberDeath(14)!.isLastMember).toBe(false);
    expect(onLegionMemberDeath(15)!.isLastMember).toBe(false);

    const finalOutcome = onLegionMemberDeath(16)!;
    expect(finalOutcome.isLastMember).toBe(true);
    expect(finalOutcome.anchorId).toBe(10);

    expect(onLegionMemberDeath(16)).toBeNull();
  });

  test('restore rebuild resumes the cascade correctly', () => {
    const rebuilt = registerRestoredLegionMembers([
      { entityId: 20, generation: 1 },
      { entityId: 21, generation: 1 },
    ]);
    expect(rebuilt).toEqual({ anchorId: 20 });

    const outcome20 = onLegionMemberDeath(20)!;
    expect(outcome20.isLastMember).toBe(false);
    expect(outcome20.childTypeId).toBe('legion_mote');
    registerLegionChild(22, outcome20.groupId, 2);
    registerLegionChild(23, outcome20.groupId, 2);

    expect(onLegionMemberDeath(21)!.isLastMember).toBe(false);
    expect(onLegionMemberDeath(22)!.isLastMember).toBe(false);
    expect(onLegionMemberDeath(23)!.isLastMember).toBe(true);
  });

  test('multiple groups stay isolated', () => {
    registerLegionRoot(30);
    registerLegionRoot(40);

    const outcome30 = onLegionMemberDeath(30)!;
    registerLegionChild(31, outcome30.groupId, 1);
    registerLegionChild(32, outcome30.groupId, 1);

    const outcome31 = onLegionMemberDeath(31)!;
    registerLegionChild(33, outcome31.groupId, 2);
    registerLegionChild(34, outcome31.groupId, 2);

    const outcome32 = onLegionMemberDeath(32)!;
    registerLegionChild(35, outcome32.groupId, 2);
    registerLegionChild(36, outcome32.groupId, 2);

    onLegionMemberDeath(33);
    onLegionMemberDeath(34);
    onLegionMemberDeath(35);
    const finalOutcome = onLegionMemberDeath(36)!;
    expect(finalOutcome.isLastMember).toBe(true);
    expect(finalOutcome.anchorId).toBe(30);

    const outcome40 = onLegionMemberDeath(40);
    expect(outcome40).not.toBeNull();
    expect(outcome40!.anchorId).toBe(40);

    const remainingAnchors: number[] = [];
    forEachLegionGroup((anchorId) => remainingAnchors.push(anchorId));
    expect(remainingAnchors).toEqual([40]);
  });
});
