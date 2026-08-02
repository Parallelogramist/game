import type { CombinedUpgrade, Upgrade } from '../../data/Upgrades';

/**
 * Everything the auto-buy scorer needs from the live run. GameScene builds it; the scorer
 * itself never touches Phaser or scene state.
 */
export interface AutoBuyContext {
  playerLevel: number;
  autoUpgradeLevel: number;
  isHealthStruggling: boolean;
  canAddWeapon: boolean;
  ownedWeaponIds: string[];
  upgrades: Upgrade[];
}

const PRIORITY_STATS = ['might', 'haste', 'vitality', 'swiftness'];
const DEFENSIVE_STATS = ['vitality', 'shieldBarrier'];
const GATES = [3, 6, 9];

/**
 * Tier 1: weapon milestones (every 5th level) prefer new weapons, normal levels prefer
 * levelling the weapons and stats that are furthest behind.
 */
export function calculateBaseScore(upgrade: CombinedUpgrade, context: AutoBuyContext): number {
  const isWeaponMilestone = context.playerLevel % 5 === 0;
  let score = 0;

  if (upgrade.upgradeType === 'weapon') {
    // Should already be filtered out, but auto-buy must never spend a level-up on a
    // weapon the player has no slot for.
    if (upgrade.type === 'add' && !context.canAddWeapon) {
      return -1000;
    }

    if (isWeaponMilestone) {
      if (upgrade.type === 'add') {
        score = 100;
      } else {
        score = 50 + (upgrade.maxLevel - upgrade.currentLevel);
      }
    } else {
      if (upgrade.type === 'level') {
        score = 40 + (10 - upgrade.currentLevel);
      } else {
        score = 20;
      }
    }
  } else {
    if (isWeaponMilestone) {
      score = 0;
    } else {
      // Limit Break overflow upgrades have maxLevel 999; a raw deficit score would dwarf
      // everything and starve weapon level-ups. Score them modestly (they're a fallback only).
      const overflowUpgrade = context.upgrades.find(u => u.id === upgrade.id);
      if (overflowUpgrade?.isOverflow) {
        return 35;
      }

      const levelDeficit = upgrade.maxLevel - upgrade.currentLevel;
      score = 30 + levelDeficit * 5;

      if (PRIORITY_STATS.includes(upgrade.id)) {
        score += 10;
      }
    }
  }

  return score;
}

/**
 * Tier 2: bonus toward the stats that still have to reach the next break-level gate, and a
 * penalty for one that is already there while others lag, so the run does not bottleneck.
 */
export function calculateGatePlanningBonus(
  upgrade: CombinedUpgrade,
  context: AutoBuyContext
): number {
  if (upgrade.upgradeType !== 'stat') return 0;

  const upgradeData = context.upgrades.find(u => u.id === upgrade.id);
  if (!upgradeData || !upgradeData.isStatUpgrade) return 0;

  const currentLevel = upgrade.currentLevel;
  const nextGate = GATES.find(g => g > currentLevel);
  if (!nextGate) return 0;

  const ownedStats = context.upgrades.filter(u => u.isStatUpgrade && u.currentLevel > 0);
  const statsBelowGate = ownedStats.filter(u => u.currentLevel < nextGate);

  if (currentLevel === nextGate - 1 || currentLevel === nextGate) {
    if (statsBelowGate.length > 1) {
      return -10;
    }
  }

  if (currentLevel < nextGate && statsBelowGate.length > 0) {
    return 15;
  }

  return 0;
}

/**
 * Tier 3: lean defensive when the player has taken more than half their max HP since the
 * last level-up.
 */
export function calculateHealthAdaptiveBonus(upgrade: CombinedUpgrade): number {
  if (upgrade.upgradeType !== 'stat') return 0;

  return DEFENSIVE_STATS.includes(upgrade.id) ? 30 : 0;
}

/**
 * Tier 4: prefer the stats that match the weapons actually equipped.
 */
export function calculateWeaponSynergyBonus(
  upgrade: CombinedUpgrade,
  context: AutoBuyContext
): number {
  if (upgrade.upgradeType !== 'stat') return 0;

  const weaponIds = context.ownedWeaponIds;

  const projectileWeapons = ['projectile', 'ricochet', 'homing_missile', 'shuriken'];
  const hasProjectileWeapons = projectileWeapons.some(id => weaponIds.includes(id));
  const projectileStats = ['multishot', 'piercing', 'velocity', 'reach'];

  const meleeAuraWeapons = ['katana', 'aura', 'orbiting_blades', 'frost_nova'];
  const hasMeleeAura = meleeAuraWeapons.some(id => weaponIds.includes(id));
  const meleeStats = ['haste', 'might', 'swiftness'];

  const beamAoeWeapons = ['laser_beam', 'flamethrower', 'meteor', 'ground_spike', 'chain_lightning'];
  const hasBeamAoe = beamAoeWeapons.some(id => weaponIds.includes(id));
  const beamStats = ['might', 'reach', 'haste'];

  let bonus = 0;
  if (hasProjectileWeapons && projectileStats.includes(upgrade.id)) bonus += 15;
  if (hasMeleeAura && meleeStats.includes(upgrade.id)) bonus += 15;
  if (hasBeamAoe && beamStats.includes(upgrade.id)) bonus += 15;

  return bonus;
}

export function scoreAutoBuyUpgrade(upgrade: CombinedUpgrade, context: AutoBuyContext): number {
  let score = calculateBaseScore(upgrade, context);

  if (context.autoUpgradeLevel >= 2) {
    score += calculateGatePlanningBonus(upgrade, context);
  }
  if (context.autoUpgradeLevel >= 3 && context.isHealthStruggling) {
    score += calculateHealthAdaptiveBonus(upgrade);
  }
  if (context.autoUpgradeLevel >= 4) {
    score += calculateWeaponSynergyBonus(upgrade, context);
  }

  return score;
}

/**
 * Picks the highest-scoring offer, breaking ties randomly between the top two so a run is
 * not perfectly predictable. Assumes a non-empty offer list, as the caller guarantees.
 */
export function selectAutoBuyUpgrade(
  availableUpgrades: CombinedUpgrade[],
  context: AutoBuyContext
): CombinedUpgrade {
  const scoredUpgrades = availableUpgrades
    .map(upgrade => ({ upgrade, score: scoreAutoBuyUpgrade(upgrade, context) }))
    .sort((a, b) => b.score - a.score);

  const topChoices = scoredUpgrades.filter(s => s.score >= scoredUpgrades[0].score - 10);
  const selectedIndex = Math.floor(Math.random() * Math.min(topChoices.length, 2));

  return topChoices[selectedIndex].upgrade;
}
