/**
 * TutorialHints - pure definitions + decision logic for one-time contextual
 * onboarding hints. Each hint fires at the moment its mechanic first matters
 * (not as an up-front info dump — that's the first-run coach-mark overlay,
 * gated separately by `tutorialSeen`). Persistence and display live in
 * TutorialHintManager / the owning scene; everything here is side-effect free
 * so it can be unit-tested without Phaser.
 */

import { getEvolutionForWeapon } from '../data/WeaponEvolutions';

export type TutorialHintId =
  | 'first-level-up'
  | 'dash-danger'
  | 'evolution-progress'
  | 'first-miniboss'
  | 'ultimate-ready'
  | 'shop';

export interface TutorialHintDef {
  id: TutorialHintId;
  title: string;
  description: string;
  /** Touch-device wording (on-screen buttons instead of keys). Falls back to `description`. */
  descriptionTouch?: string;
  icon: string;
  color: number;
  duration: number;
}

export const TUTORIAL_HINT_DEFS: readonly TutorialHintDef[] = [
  {
    id: 'first-level-up',
    title: 'Level Up!',
    description: 'Pick an upgrade to power up',
    icon: 'star',
    color: 0x44aaff,
    duration: 3000,
  },
  {
    id: 'dash-danger',
    title: 'Dash Out!',
    description: 'Shift dashes you through enemies — brief invincibility',
    descriptionTouch: 'The dash button (bottom-right) blinks you through enemies',
    icon: 'wind',
    color: 0x44aaff,
    duration: 3500,
  },
  {
    id: 'evolution-progress',
    title: 'Evolution Within Reach',
    description: 'Max the matching stat to evolve your weapon',
    icon: 'star',
    color: 0xcc66ff,
    duration: 4000,
  },
  {
    id: 'first-miniboss',
    title: 'Elite Incoming!',
    description: 'Minibosses are tough but drop powerful rewards',
    icon: 'skull',
    color: 0xff8844,
    duration: 3500,
  },
  {
    id: 'ultimate-ready',
    title: 'Overdrive Ready!',
    description: 'Press Q to unleash a screen-clearing nova',
    descriptionTouch: 'Tap the glowing gold button (bottom-right) to unleash your nova',
    icon: 'star',
    color: 0xffcc33,
    duration: 3500,
  },
  {
    id: 'shop',
    title: 'Shop',
    description: 'Spend gold on permanent upgrades',
    icon: 'coins',
    color: 0x44aaff,
    duration: 3000,
  },
];

const DEFS_BY_ID = new Map(TUTORIAL_HINT_DEFS.map((def) => [def.id, def]));

export function getTutorialHintDef(id: TutorialHintId): TutorialHintDef {
  // The id union guarantees membership; the non-null assert keeps callers clean.
  return DEFS_BY_ID.get(id)!;
}

export function getHintDescription(def: TutorialHintDef, isTouchDevice: boolean): string {
  return isTouchDevice && def.descriptionTouch ? def.descriptionTouch : def.description;
}

// ═══════════════════════════════════════════════════════════════════════════
// Dash hint decision
// ═══════════════════════════════════════════════════════════════════════════

/**
 * 'show'    → display the hint and mark it seen.
 * 'defer'   → conditions not right (dash cooling down); stay unseen, retry on
 *             the next hit.
 * 'dismiss' → the player already dashes on their own; mark seen silently so
 *             the hint never nags someone who knows the mechanic.
 */
export type DashHintOutcome = 'show' | 'defer' | 'dismiss';

export function evaluateDashDangerHint(input: {
  dashReady: boolean;
  hasDashedThisRun: boolean;
}): DashHintOutcome {
  if (input.hasDashedThisRun) return 'dismiss';
  return input.dashReady ? 'show' : 'defer';
}

// ═══════════════════════════════════════════════════════════════════════════
// Evolution-progress detection
// ═══════════════════════════════════════════════════════════════════════════

export interface EvolutionWeaponState {
  id: string;
  name: string;
  level: number;
  isEvolved: boolean;
}

export interface EvolutionStatState {
  id: string;
  name: string;
  currentLevel: number;
}

export interface BlockedEvolution {
  weaponId: string;
  weaponName: string;
  evolvedName: string;
  statId: string;
  statName: string;
  requiredStatLevel: number;
}

/**
 * Finds the first weapon that has reached its evolution weapon-level but whose
 * required stat still lags — i.e. the moment the player is one stat away from
 * an evolution and likely doesn't know the system exists. Mirrors the
 * threshold math of WeaponManager.checkEvolutions (level requirement floored
 * at 1 by the evolution level reduction). Returns null when nothing is blocked.
 */
export function findBlockedEvolution(
  weapons: readonly EvolutionWeaponState[],
  statUpgrades: readonly EvolutionStatState[],
  evolutionLevelReduction: number = 0
): BlockedEvolution | null {
  for (const weapon of weapons) {
    if (weapon.isEvolved) continue;
    const recipe = getEvolutionForWeapon(weapon.id);
    if (!recipe) continue;

    const requiredWeaponLevel = Math.max(1, recipe.requiredWeaponLevel - evolutionLevelReduction);
    if (weapon.level < requiredWeaponLevel) continue;

    const stat = statUpgrades.find((upgrade) => upgrade.id === recipe.requiredStatId);
    const statLevel = stat?.currentLevel ?? 0;
    if (statLevel >= recipe.requiredStatLevel) continue;

    return {
      weaponId: weapon.id,
      weaponName: weapon.name,
      evolvedName: recipe.evolvedName,
      statId: recipe.requiredStatId,
      statName: stat?.name ?? recipe.requiredStatId,
      requiredStatLevel: recipe.requiredStatLevel,
    };
  }
  return null;
}

export function formatEvolutionHint(blocked: BlockedEvolution): string {
  return `${blocked.weaponName} can evolve — get ${blocked.statName} to Lv ${blocked.requiredStatLevel} to unlock ${blocked.evolvedName}!`;
}
