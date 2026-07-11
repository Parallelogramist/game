/**
 * The Legion (boss) — split-tree accounting for the mitosis fight.
 *
 * The boss splits ON DEATH: the root spawns 2 half-scale fragments, each
 * fragment spawns 2 quarter-scale motes — 7 entities total sharing one HP
 * pool. Rewards (XP, drops, victory) pay out only when the last living member
 * dies; mid-tree deaths are splits, not kills.
 *
 * Pure bookkeeping (no Phaser, no ECS reads): GameScene owns entity
 * creation/removal and health reads and reports them here. Group state is
 * keyed by entity id and rebuilt from typeIds after a save-restore.
 */

export interface LegionGeneration {
  typeId: string;
  childTypeId: string | null;
  childCount: number;
  /** Each child spawns with this fraction of its parent's max HP. */
  childHealthFraction: number;
  /** Children spawn this far from the parent's death position. */
  spawnOffsetRadius: number;
}

export const LEGION_GENERATIONS: readonly LegionGeneration[] = [
  { typeId: 'the_legion', childTypeId: 'legion_fragment', childCount: 2, childHealthFraction: 0.5, spawnOffsetRadius: 48 },
  { typeId: 'legion_fragment', childTypeId: 'legion_mote', childCount: 2, childHealthFraction: 0.5, spawnOffsetRadius: 30 },
  { typeId: 'legion_mote', childTypeId: null, childCount: 0, childHealthFraction: 0, spawnOffsetRadius: 0 },
];

export function legionGenerationForType(typeId: string): number | null {
  for (let generation = 0; generation < LEGION_GENERATIONS.length; generation++) {
    if (LEGION_GENERATIONS[generation].typeId === typeId) return generation;
  }
  return null;
}

export function isLegionTypeId(typeId: string): boolean {
  return legionGenerationForType(typeId) !== null;
}

/**
 * Total max HP of a member's not-yet-spawned descendants as a multiple of the
 * member's own max HP. Each split conserves the pool (2 children × 0.5), so a
 * root (gen 0) carries 2 conserved generations = 2× its own max.
 */
export function legionPotentialMultiplier(generation: number): number {
  return LEGION_GENERATIONS.length - 1 - generation;
}

/**
 * Full group HP pool reconstructed from any single living member: the root's
 * max is memberMax × 2^generation, and the pool is root + 2 conserved
 * generations = 3 × rootMax.
 */
export function legionPoolFromMember(generation: number, maxHealth: number): number {
  return maxHealth * Math.pow(2, generation) * LEGION_GENERATIONS.length;
}

/** Deterministic child spawn positions fanned evenly around the parent. */
export function legionChildSpawnOffsets(
  count: number,
  radius: number,
  seedAngle: number
): Array<{ x: number; y: number }> {
  const offsets: Array<{ x: number; y: number }> = [];
  for (let childIndex = 0; childIndex < count; childIndex++) {
    const angle = seedAngle + (childIndex / count) * Math.PI * 2;
    offsets.push({ x: Math.cos(angle) * radius, y: Math.sin(angle) * radius });
  }
  return offsets;
}

interface LegionGroup {
  anchorId: number;
  /** entityId → generation, living members only. */
  members: Map<number, number>;
}

const groupsById = new Map<number, LegionGroup>();
const groupIdByMember = new Map<number, number>();

export function resetLegionSystem(): void {
  groupsById.clear();
  groupIdByMember.clear();
}

export function registerLegionRoot(entityId: number): void {
  const group: LegionGroup = { anchorId: entityId, members: new Map([[entityId, 0]]) };
  groupsById.set(entityId, group);
  groupIdByMember.set(entityId, entityId);
}

export function registerLegionChild(childEntityId: number, groupId: number, generation: number): void {
  const group = groupsById.get(groupId);
  if (!group) return;
  group.members.set(childEntityId, generation);
  groupIdByMember.set(childEntityId, groupId);
}

export interface LegionDeathOutcome {
  groupId: number;
  generation: number;
  /** True when this death empties the tree — pay boss rewards + victory. */
  isLastMember: boolean;
  anchorId: number;
  childTypeId: string | null;
  childCount: number;
  childHealthFraction: number;
  spawnOffsetRadius: number;
}

export function onLegionMemberDeath(entityId: number): LegionDeathOutcome | null {
  const groupId = groupIdByMember.get(entityId);
  if (groupId === undefined) return null;
  const group = groupsById.get(groupId);
  if (!group) {
    groupIdByMember.delete(entityId);
    return null;
  }
  const generation = group.members.get(entityId);
  if (generation === undefined) {
    groupIdByMember.delete(entityId);
    return null;
  }

  group.members.delete(entityId);
  groupIdByMember.delete(entityId);

  const generationSpec = LEGION_GENERATIONS[generation];
  const willSplit = generationSpec.childTypeId !== null;
  const isLastMember = group.members.size === 0 && !willSplit;
  if (isLastMember) groupsById.delete(groupId);

  return {
    groupId,
    generation,
    isLastMember,
    anchorId: group.anchorId,
    childTypeId: generationSpec.childTypeId,
    childCount: generationSpec.childCount,
    childHealthFraction: generationSpec.childHealthFraction,
    spawnOffsetRadius: generationSpec.spawnOffsetRadius,
  };
}

/**
 * Rebuild one group from save-restored members (module state does not survive
 * a refresh). All restored legion entities join a single group anchored to the
 * first member — a save can only ever hold one legion fight.
 */
export function registerRestoredLegionMembers(
  members: Array<{ entityId: number; generation: number }>
): { anchorId: number } | null {
  if (members.length === 0) return null;
  const anchorId = members[0].entityId;
  const group: LegionGroup = { anchorId, members: new Map() };
  groupsById.set(anchorId, group);
  for (const member of members) {
    group.members.set(member.entityId, member.generation);
    groupIdByMember.set(member.entityId, anchorId);
  }
  return { anchorId };
}

/** Allocation-free iteration for the per-frame HUD pool sum. */
export function forEachLegionGroup(
  callback: (anchorId: number, members: ReadonlyMap<number, number>) => void
): void {
  for (const group of groupsById.values()) {
    callback(group.anchorId, group.members);
  }
}
