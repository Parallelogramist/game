/**
 * Which of the twelve bosses guards a world.
 *
 * A world's Warden is a property of the WORLD, not of the player's arena rotation: the same
 * world is guarded by the same boss on every expedition into it, and two worlds are guarded by
 * different ones. Pure, Phaser-free and persistence-free, so it needs no storage key and no
 * version constant.
 *
 * The order is read off TUNING rather than off BossRotationManager's BOSS_ROTATION (which is the
 * same array) so this module does not pull SecureStorage into a pure import chain.
 */

import { TUNING } from '../data/GameTuning';
import { getEnemyType } from '../enemies/EnemyTypes';
import { hashStringToSeed, mulberry32 } from '../utils/dailySeed';

const WARDEN_BOSS_ORDER: readonly string[] = TUNING.bosses.order;

/** Shown when a boss id somehow resolves to no ENEMY_TYPES entry, which a red
 *  referentialIntegrity run would already have caught. */
export const WARDEN_FALLBACK_NAME = 'The Warden';

/**
 * Seeded exactly the way challengeBossRotationIndex seeds a daily's boss, from its own key
 * namespace, so the world's Warden is stable and spends nothing.
 */
export function wardenBossIdForWorld(worldSeed: number, worldGenVersion: number): string {
  const rng = mulberry32(hashStringToSeed(`warden:${worldSeed}:v${worldGenVersion}`));
  return WARDEN_BOSS_ORDER[Math.floor(rng() * WARDEN_BOSS_ORDER.length)];
}

export function wardenBossNameForWorld(worldSeed: number, worldGenVersion: number): string {
  const boss = getEnemyType(wardenBossIdForWorld(worldSeed, worldGenVersion));
  return boss?.name ?? WARDEN_FALLBACK_NAME;
}

/** How many distinct guardians a profile can ever fell. */
export const WARDEN_ROSTER_SIZE = WARDEN_BOSS_ORDER.length;

/** Every bit a stored roster mask may legitimately carry, so a tampered value cannot make the
 *  roster read as more than twelve. */
export const WARDEN_MASK_ALL = (1 << WARDEN_ROSTER_SIZE) - 1;

/** 0 for an id that is not in the rotation order, so an unknown boss records nothing rather
 *  than colliding with roster slot 0. */
export function wardenFelledBit(bossTypeId: string): number {
  const rosterIndex = WARDEN_BOSS_ORDER.indexOf(bossTypeId);
  return rosterIndex < 0 ? 0 : 1 << rosterIndex;
}

export function isWardenFelled(felledMask: number, bossTypeId: string): boolean {
  const bit = wardenFelledBit(bossTypeId);
  return bit !== 0 && (felledMask & bit) !== 0;
}

export function countFelledWardens(felledMask: number): number {
  let remaining = felledMask & WARDEN_MASK_ALL;
  let felled = 0;
  while (remaining !== 0) {
    remaining &= remaining - 1;
    felled++;
  }
  return felled;
}

export interface WardenRosterRow {
  bossTypeId: string;
  name: string;
  felled: boolean;
}

/** The twelve in rotation order, which is the order every other Warden surface already uses. */
export function describeWardenRoster(felledMask: number): readonly WardenRosterRow[] {
  return WARDEN_BOSS_ORDER.map(bossTypeId => ({
    bossTypeId,
    name: getEnemyType(bossTypeId)?.name ?? WARDEN_FALLBACK_NAME,
    felled: isWardenFelled(felledMask, bossTypeId),
  }));
}
