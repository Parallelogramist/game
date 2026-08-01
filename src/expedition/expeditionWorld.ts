/**
 * The one place an expedition world is built. Two callers need the exact same world: the
 * mode adapter that flies it, and the menu that reports how much of it is charted, so the
 * generator inputs live here rather than being written out twice and drifting.
 */

import { generateWorld } from '../world/generateWorld';
import { STAGES } from '../data/Stages';
import { TRAVERSAL_ABILITY_GATE_ORDER } from '../data/TraversalAbilities';
import { EXPEDITION_QUEST_KEY_ORDER } from '../data/ExpeditionQuests';
import type { WorldMap } from '../world/worldTypes';
import {
  getCurrentExpeditionSeasonIndex,
  getCurrentExpeditionSeed,
} from './ExpeditionSeasonStore';
import { getDiscoveryManager } from './DiscoveryManager';
import { isWorldConquered } from './WorldProfileStore';

/** Three concealed rooms per world: enough that a run can stumble on one, few enough that
 *  finding one still reads as a find. */
export const EXPEDITION_HIDDEN_SECTOR_COUNT = 3;

export function generateExpeditionWorld(seed: number): WorldMap {
  return generateWorld(seed, {
    abilityGateOrder: [...TRAVERSAL_ABILITY_GATE_ORDER],
    questKeyOrder: [...EXPEDITION_QUEST_KEY_ORDER],
    hiddenSectorCount: EXPEDITION_HIDDEN_SECTOR_COUNT,
    availableBiomeIds: STAGES.map(stage => stage.id),
  });
}

export interface ExpeditionProgressSummary {
  seasonIndex: number;
  seed: number;
  completionPercent: number;
  sectorsCharted: number;
  knowableSectors: number;
  secretsFound: number;
  conquered: boolean;
}

/**
 * What the profile has charted of the world it is currently on, read outside a run.
 *
 * Binding the discovery singleton here is the manager's own contract ("bindWorld is what
 * re-reads it for the world actually being played") and is what GameScene does at every
 * run start, so the only thing this can disturb is the newly-passable overlay, which a
 * scene start clears anyway. One generateWorld measured at 33 ms on the Deck: call this on
 * a button press, never per frame and never from a scene's create().
 */
export function summariseCurrentExpedition(): ExpeditionProgressSummary {
  const seed = getCurrentExpeditionSeed();
  const discovery = getDiscoveryManager();
  const map = generateExpeditionWorld(seed);
  discovery.bindWorld(map);
  return {
    seasonIndex: getCurrentExpeditionSeasonIndex(),
    seed,
    completionPercent: discovery.getCompletionPercent(),
    sectorsCharted: discovery.getVisitedSectorCount(),
    knowableSectors: discovery.getKnowableSectorCount(),
    secretsFound: discovery.getFoundSecretCount(),
    conquered: isWorldConquered(seed, map.worldGenVersion),
  };
}
