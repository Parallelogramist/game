import { getWeaponInfoList } from '../weapons';
import { getCodexManager } from '../codex/CodexManager';
import { SHIP_CHARACTERS } from '../data/ShipCharacters';
import { STAGES } from '../data/Stages';
import { PACTS } from '../data/Pacts';
import { DIRECTOR_STRATEGIES } from '../systems/DirectorSystem';
import { isUnlockRequirementMet, UnlockGateContext } from '../data/UnlockGates';
import { getHiddenUnlockManager } from './HiddenUnlocks';
import { getMetaProgressionManager } from './MetaProgressionManager';
import { loadThreatBest } from './ThreatProgress';
import type { LastLoadout } from './LastLoadout';

/** How many pacts a surprise run may roll. Capped below MAX_PACTS (3) so a
 *  dice-roll can't chance-stack maximal curses — the full 3-pact commitment
 *  stays a deliberate funnel choice. */
const MAX_SURPRISE_PACTS = 2;

function pickRandom<T>(items: readonly T[]): T {
  return items[Math.floor(Math.random() * items.length)];
}

/** Uniformly pick `count` distinct items from `items` (count clamped to length). */
function pickDistinct<T>(items: readonly T[], count: number): T[] {
  const pool = [...items];
  const chosen: T[] = [];
  const take = Math.min(count, pool.length);
  for (let i = 0; i < take; i++) {
    const index = Math.floor(Math.random() * pool.length);
    chosen.push(pool[index]);
    pool.splice(index, 1);
  }
  return chosen;
}

function buildGateContext(): UnlockGateContext {
  const metaManager = getMetaProgressionManager();
  return {
    unlockedConditionIds: getHiddenUnlockManager().getUnlockedConditionIds(),
    worldLevel: metaManager.getWorldLevel(),
    accountLevel: metaManager.getAccountLevel(),
  };
}

/**
 * Roll a fully randomized, always-valid pre-run loadout for the one-tap
 * "Surprise Me" launcher. Only unlocked / discovered options are eligible, so the
 * run is always legally reachable; Threat never exceeds the player's highest
 * cleared tier; pacts are capped at MAX_SURPRISE_PACTS; the run is a normal (not
 * gauntlet) run. Run modifiers are omitted — the launch path re-rolls them, exactly
 * like a replay.
 */
export function buildRandomLoadout(): LastLoadout {
  const gateContext = buildGateContext();
  const codexManager = getCodexManager();

  const discoveredWeapons = getWeaponInfoList().filter((weapon) =>
    codexManager.isWeaponDiscovered(weapon.id),
  );
  const availableShips = SHIP_CHARACTERS.filter((ship) =>
    isUnlockRequirementMet(ship.unlockRequirement, gateContext),
  );
  const availableStages = STAGES.filter((stage) =>
    isUnlockRequirementMet(stage.unlockRequirement, gateContext),
  );

  const startingWeapon = discoveredWeapons.length > 0 ? pickRandom(discoveredWeapons).id : 'projectile';
  const shipId = availableShips.length > 0 ? pickRandom(availableShips).id : 'ship_default';
  const stageId = availableStages.length > 0 ? pickRandom(availableStages).id : 'stage_deep_void';

  const pactCount = Math.floor(Math.random() * (MAX_SURPRISE_PACTS + 1)); // 0..2
  const pactIds = pickDistinct(PACTS, pactCount).map((pact) => pact.id);

  const directorStrategy = pickRandom(DIRECTOR_STRATEGIES);

  const highestClearedThreat = Math.max(0, Math.floor(loadThreatBest()));
  const threatLevel = Math.floor(Math.random() * (highestClearedThreat + 1)); // 0..highestClearedThreat

  return {
    startingWeapon,
    shipId,
    stageId,
    pactIds,
    directorStrategy,
    threatLevel,
    gauntletMode: false,
  };
}
