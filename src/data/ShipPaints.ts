import { NeonColorPair } from '../visual/NeonColors';

/**
 * A ship hull paint earned by satisfying a hidden `cosmetic` unlock. The paint's
 * `unlockId` matches the `unlockId` of its HiddenUnlock condition (see
 * `src/meta/HiddenUnlocks.ts`), so a paint becomes available exactly when its
 * cosmetic unlock is earned. `rank` orders paints by prestige (roughly by how hard
 * the condition is) — the equipped paint is the highest-rank *unlocked* one, so each
 * tougher milestone visibly upgrades the hull. `name` matches the unlock's display
 * name and is consumed by the future paint picker (FEAT-SHIP-PAINT-PICKER).
 */
export interface ShipPaint {
  unlockId: string;
  name: string;
  rank: number;
  color: NeonColorPair;
}

export const SHIP_PAINTS: ShipPaint[] = [
  { unlockId: 'cosmetic_survivor_trim',  name: 'Initiate Trim',        rank: 1,  color: { core: 0x88bbff, glow: 0xbbddff } },
  { unlockId: 'cosmetic_rookie_badge',   name: 'Rookie Badge',         rank: 2,  color: { core: 0x33ddbb, glow: 0x77ffdd } },
  { unlockId: 'cosmetic_max_gear',       name: 'Maximalist Plate',     rank: 3,  color: { core: 0xccccdd, glow: 0xffffff } },
  { unlockId: 'cosmetic_veteran_trim',   name: 'Veteran Trim',         rank: 4,  color: { core: 0xcc9944, glow: 0xeecc88 } },
  { unlockId: 'cosmetic_inferno_trail',  name: 'Inferno Trail',        rank: 5,  color: { core: 0xff5522, glow: 0xff9955 } },
  { unlockId: 'cosmetic_speed_glow',     name: 'Speedrun Glow',        rank: 6,  color: { core: 0x22ffee, glow: 0x88fff5 } },
  { unlockId: 'cosmetic_starforge',      name: 'Starforge Badge',      rank: 7,  color: { core: 0x6655ff, glow: 0x9988ff } },
  { unlockId: 'cosmetic_gold_hull',      name: 'Golden Hull',          rank: 8,  color: { core: 0xffcc22, glow: 0xffe680 } },
  { unlockId: 'cosmetic_crit_aura',      name: 'Crit Aura',            rank: 9,  color: { core: 0xff33aa, glow: 0xff88cc } },
  { unlockId: 'cosmetic_level_crown',    name: 'Level Crown',          rank: 10, color: { core: 0xbb44ff, glow: 0xdd99ff } },
  { unlockId: 'cosmetic_cluster_badge',  name: 'Cluster Badge',        rank: 11, color: { core: 0x99ff22, glow: 0xccff88 } },
  { unlockId: 'cosmetic_damage_dealer',  name: 'Damage Dealer Badge',  rank: 12, color: { core: 0xff2244, glow: 0xff6688 } },
  { unlockId: 'cosmetic_streak_flame',   name: 'Streak Flame',         rank: 13, color: { core: 0xffffff, glow: 0xffffcc } },
];

/**
 * Given the set of unlocked hidden-unlock target ids (from
 * `HiddenUnlockManager.getUnlockedTargetIds()`), return the highest-rank unlocked
 * ship paint, or null if the player has earned none. Pure — callers pass the ids, so
 * this is trivially testable and holds no global state.
 */
export function resolveEquippedPaint(unlockedTargetIds: readonly string[]): ShipPaint | null {
  const unlocked = new Set(unlockedTargetIds);
  let best: ShipPaint | null = null;
  for (const paint of SHIP_PAINTS) {
    if (!unlocked.has(paint.unlockId)) continue;
    if (best === null || paint.rank > best.rank) best = paint;
  }
  return best;
}

/**
 * Sentinel stored when the player explicitly opts out of paints and wants the
 * ship's own signature colour. Distinct from "no choice stored" (null), which
 * falls back to the highest-rank auto-equip.
 */
export const SHIP_DEFAULT_PAINT_CHOICE = 'ship_default';

/**
 * Resolve the paint the ship should actually render, honouring an explicit player
 * choice and self-healing a stale one:
 *  - `SHIP_DEFAULT_PAINT_CHOICE` → null (wear the ship's signature colour).
 *  - a paint id the player has unlocked → that paint.
 *  - anything else (no choice, or a choice whose unlock was since wiped) → the
 *    highest-rank unlocked paint (`resolveEquippedPaint`), or null if none.
 * Pure — callers pass ids + choice, so it holds no global state and is testable.
 */
export function resolveActivePaint(
  unlockedTargetIds: readonly string[],
  storedChoice: string | null,
): ShipPaint | null {
  if (storedChoice === SHIP_DEFAULT_PAINT_CHOICE) return null;
  if (storedChoice) {
    const chosen = SHIP_PAINTS.find((paint) => paint.unlockId === storedChoice);
    if (chosen && unlockedTargetIds.includes(chosen.unlockId)) return chosen;
  }
  return resolveEquippedPaint(unlockedTargetIds);
}
