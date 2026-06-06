/**
 * AscensionManager - Prestige system for long-term progression.
 *
 * When a player reaches a high enough account level, they can "Ascend":
 * - All shop upgrade levels reset to 0
 * - Gold is refunded (100% of total spent)
 * - Player gains an Ascension Level with permanent global multipliers
 * - Account level requirement increases per ascension
 *
 * Inspired by The Tower's prestige loop and idle game ascension mechanics.
 */

import { SecureStorage } from '../storage';

const STORAGE_KEY_ASCENSION = 'survivor-meta-ascension';

/** Account level required to ascend (increases each time) */
const BASE_ASCENSION_THRESHOLD = 50;
const THRESHOLD_INCREMENT = 15;

/** Per-level bonuses */
const STAT_MULTIPLIER_PER_LEVEL = 0.10;    // +10% all stats per ascension
const GOLD_MULTIPLIER_PER_LEVEL = 0.15;    // +15% gold earn per ascension

/** Hard cap on stored ascension level — a defensive clamp applied on load. */
const MAX_ASCENSION_LEVEL = 50;

interface AscensionState {
  level: number;
  totalAscensions: number;
}

function createDefaultAscensionState(): AscensionState {
  return { level: 0, totalAscensions: 0 };
}

/**
 * Coerce a persisted ascension counter to a finite non-negative integer within
 * [0, MAX_ASCENSION_LEVEL]. SecureStorage is the anti-cheat layer, so a corrupt
 * or tampered payload is the threat model: a non-numeric value (a string/object)
 * or a `1e999` overflow (which JSON.parse reads back as Infinity) must never
 * survive load. The old `?? 0` guard only caught null/undefined, so a string
 * slipped through and `Math.max(0, Math.min("abc", 50))` is NaN — and a NaN level
 * poisons every consumer: getStatMultiplier/getGoldMultiplier → NaN (which feeds
 * run gold and the shop/boot/pause UI) and getAscensionThreshold → NaN, making
 * `accountLevel >= NaN` false forever, so re-ascension is bricked.
 */
function toBoundedCount(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(Math.floor(value), MAX_ASCENSION_LEVEL));
}

export class AscensionManager {
  private state: AscensionState;

  constructor() {
    this.state = this.loadState();
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Queries
  // ─────────────────────────────────────────────────────────────────────────

  getLevel(): number {
    return this.state.level;
  }

  getTotalAscensions(): number {
    return this.state.totalAscensions;
  }

  /**
   * Account level threshold required for the next ascension.
   */
  getAscensionThreshold(): number {
    return BASE_ASCENSION_THRESHOLD + this.state.level * THRESHOLD_INCREMENT;
  }

  /**
   * Whether the player can ascend at the given account level.
   */
  canAscend(accountLevel: number): boolean {
    return accountLevel >= this.getAscensionThreshold();
  }

  /**
   * Global stat multiplier from ascension. Applied to damage, speed, attack speed, etc.
   * e.g., level 3 = 1.30 (30% bonus)
   */
  getStatMultiplier(): number {
    return 1 + this.state.level * STAT_MULTIPLIER_PER_LEVEL;
  }

  /**
   * Gold earn multiplier from ascension.
   * e.g., level 3 = 1.45 (45% bonus)
   */
  getGoldMultiplier(): number {
    return 1 + this.state.level * GOLD_MULTIPLIER_PER_LEVEL;
  }

  /**
   * Extra weapon slots granted by ascension (1 at level 2+).
   */
  getBonusWeaponSlots(): number {
    if (this.state.level >= 2) return 1;
    return 0;
  }

  /**
   * Bonus starting levels from ascension (1 at level 3+).
   */
  getBonusStartingLevel(): number {
    if (this.state.level >= 3) return 1;
    return 0;
  }

  /**
   * XP gem multiplier from ascension (2x at level 4+).
   */
  getXPGemMultiplier(): number {
    if (this.state.level >= 4) return 2;
    return 1;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Actions
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Perform an ascension if account level meets the threshold.
   * Caller is responsible for resetting upgrades and adding refunded gold.
   * @returns true if ascension was performed, false if requirements not met
   */
  performAscension(accountLevel: number): boolean {
    if (!this.canAscend(accountLevel)) return false;
    this.state.level++;
    this.state.totalAscensions++;
    this.saveState();
    return true;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Persistence
  // ─────────────────────────────────────────────────────────────────────────

  private loadState(): AscensionState {
    const defaults = createDefaultAscensionState();
    try {
      const stored = SecureStorage.getItem(STORAGE_KEY_ASCENSION);
      if (stored) {
        const parsed = JSON.parse(stored) as Partial<AscensionState> | null;
        return {
          level: toBoundedCount(parsed?.level),
          totalAscensions: toBoundedCount(parsed?.totalAscensions),
        };
      }
    } catch {
      console.warn('Could not load ascension state from storage');
    }
    return defaults;
  }

  private saveState(): void {
    try {
      SecureStorage.setItem(STORAGE_KEY_ASCENSION, JSON.stringify(this.state));
    } catch {
      console.warn('Could not save ascension state to storage');
    }
  }

  resetProgress(): void {
    this.state = createDefaultAscensionState();
    this.saveState();
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// SINGLETON
// ═══════════════════════════════════════════════════════════════════════════

let ascensionManagerInstance: AscensionManager | null = null;

export function getAscensionManager(): AscensionManager {
  if (!ascensionManagerInstance) {
    ascensionManagerInstance = new AscensionManager();
  }
  return ascensionManagerInstance;
}
