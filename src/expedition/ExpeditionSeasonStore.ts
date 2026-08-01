/**
 * Which expedition world this profile is flying, and what its finished worlds scored.
 *
 * The seed was a module constant in ExpeditionModeAdapter until FEAT-EXPEDITION-SEASONS:
 * one fixed layout for every profile forever, which capped the map at a single
 * 48-sector world. The default here IS that constant, so a profile that has never
 * re-rolled keeps its world, its chart and every broken wall byte for byte.
 */

import { SecureStorage } from '../storage';
import { hashStringToSeed, mulberry32 } from '../utils/dailySeed';

const STORAGE_KEY_SEASONS = 'survivor-expedition-seasons';
const SEASON_STATE_VERSION = 1;

/** The world every profile flew before seasons existed. Changing it discards the
 *  discovery and world-profile state of every profile still on season 1. */
export const FIRST_EXPEDITION_WORLD_SEED = 20260727;

/** Enough history to read as a chase, small enough that a tampered payload cannot make
 *  the menu walk a huge list. */
const MAX_BANKED_SEASONS = 20;

export interface BankedSeason {
  /** 1-based ordinal, the number the player saw while flying it. */
  index: number;
  seed: number;
  completionPercent: number;
  sectorsCharted: number;
  secretsFound: number;
}

export interface ExpeditionSeasonState {
  version: number;
  currentSeed: number;
  currentIndex: number;
  banked: BankedSeason[];
}

export function emptySeasonState(): ExpeditionSeasonState {
  return {
    version: SEASON_STATE_VERSION,
    currentSeed: FIRST_EXPEDITION_WORLD_SEED,
    currentIndex: 1,
    banked: [],
  };
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0;
}

function clampPercent(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(100, Math.max(0, Math.round(value)));
}

/**
 * A payload from another version, or one whose seed is not a usable positive integer, is
 * discarded whole rather than repaired: a half-trusted seed would strand the profile on a
 * world its discovery store does not match, which reads to the player as a wiped map.
 */
export function sanitizeSeasonState(parsed: unknown): ExpeditionSeasonState {
  const fresh = emptySeasonState();
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return fresh;
  const candidate = parsed as Partial<ExpeditionSeasonState>;
  if (candidate.version !== SEASON_STATE_VERSION) return fresh;
  if (!isPositiveInteger(candidate.currentSeed)) return fresh;
  if (!isPositiveInteger(candidate.currentIndex)) return fresh;
  const banked = Array.isArray(candidate.banked) ? candidate.banked : [];
  return {
    version: SEASON_STATE_VERSION,
    currentSeed: candidate.currentSeed,
    currentIndex: candidate.currentIndex,
    banked: banked
      .filter((entry): entry is BankedSeason => (
        typeof entry === 'object' && entry !== null
        && isPositiveInteger((entry as BankedSeason).index)
        && isPositiveInteger((entry as BankedSeason).seed)
        && typeof (entry as BankedSeason).completionPercent === 'number'
        && typeof (entry as BankedSeason).sectorsCharted === 'number'
        && typeof (entry as BankedSeason).secretsFound === 'number'
      ))
      .map(entry => ({
        index: entry.index,
        seed: entry.seed,
        completionPercent: clampPercent(entry.completionPercent),
        sectorsCharted: Math.max(0, Math.trunc(entry.sectorsCharted)),
        secretsFound: Math.max(0, Math.trunc(entry.secretsFound)),
      }))
      .slice(-MAX_BANKED_SEASONS),
  };
}

/**
 * The next world in this profile's sequence. Deterministic on purpose: a profile's chain
 * of worlds is a pure function of the one it started on, so nothing here needs a clock or
 * Math.random, and the same profile restored on another device keeps flying the same
 * chain. The equality guard matters because a repeated seed would silently keep the old
 * world's discovery state alive under a new season number.
 */
export function rollNextExpeditionSeed(currentSeed: number, currentIndex: number): number {
  const rng = mulberry32(hashStringToSeed(`season:${currentSeed}:${currentIndex}`));
  const next = 1 + Math.floor(rng() * 2_000_000_000);
  return next === currentSeed ? next + 1 : next;
}

/** Three is what the CHART dialog's button row fits beside BACK, and each candidate costs one
 *  generateWorld (34 ms measured on the Deck) to preview. */
export const NEXT_WORLD_CHOICE_COUNT = 3;

/**
 * The worlds this profile may trade into. Index 0 IS rollNextExpeditionSeed, so a player who
 * always takes the first option flies exactly the chain the store dealt before choosing
 * existed; the alternates come from the same hash family, so nothing here needs a clock or
 * Math.random and the same profile restored elsewhere is offered the same three.
 *
 * The alt loop is bounded rather than "until three": an unbounded search over a hash that
 * cannot collide in practice is still an unbounded loop in the menu's press path.
 */
export function rollNextExpeditionSeedChoices(
  currentSeed: number, currentIndex: number,
): number[] {
  const choices = [rollNextExpeditionSeed(currentSeed, currentIndex)];
  for (let alt = 1; alt <= 64 && choices.length < NEXT_WORLD_CHOICE_COUNT; alt += 1) {
    const rng = mulberry32(hashStringToSeed(`season:${currentSeed}:${currentIndex}:alt${alt}`));
    const candidate = 1 + Math.floor(rng() * 2_000_000_000);
    if (candidate === currentSeed || choices.includes(candidate)) continue;
    choices.push(candidate);
  }
  return choices;
}

/** Pure: the state that replaces `state` once the player commits to a new world. A chosen
 *  seed is honoured only when it is usable and is not the world being left: a repeated seed
 *  would keep the old world's discovery state alive under a new season number, which is what
 *  rollNextExpeditionSeed's own equality guard refuses. */
export function bankSeasonAndRoll(
  state: ExpeditionSeasonState,
  record: { completionPercent: number; sectorsCharted: number; secretsFound: number },
  chosenSeed?: number,
): ExpeditionSeasonState {
  const banked = [
    ...state.banked,
    {
      index: state.currentIndex,
      seed: state.currentSeed,
      completionPercent: clampPercent(record.completionPercent),
      sectorsCharted: Math.max(0, Math.trunc(record.sectorsCharted)),
      secretsFound: Math.max(0, Math.trunc(record.secretsFound)),
    },
  ].slice(-MAX_BANKED_SEASONS);
  const nextSeed = isPositiveInteger(chosenSeed) && chosenSeed !== state.currentSeed
    ? chosenSeed
    : rollNextExpeditionSeed(state.currentSeed, state.currentIndex);
  return {
    version: SEASON_STATE_VERSION,
    currentSeed: nextSeed,
    currentIndex: state.currentIndex + 1,
    banked,
  };
}

export function loadExpeditionSeasons(): ExpeditionSeasonState {
  try {
    const stored = SecureStorage.getItem(STORAGE_KEY_SEASONS);
    if (stored) return sanitizeSeasonState(JSON.parse(stored));
  } catch {
    console.warn('Could not load expedition seasons from storage');
  }
  return emptySeasonState();
}

export function getCurrentExpeditionSeed(): number {
  return loadExpeditionSeasons().currentSeed;
}

export function getCurrentExpeditionSeasonIndex(): number {
  return loadExpeditionSeasons().currentIndex;
}

export function getBankedSeasons(): readonly BankedSeason[] {
  return loadExpeditionSeasons().banked;
}

export function getNextExpeditionSeedChoices(): number[] {
  const state = loadExpeditionSeasons();
  return rollNextExpeditionSeedChoices(state.currentSeed, state.currentIndex);
}

/** Commits the new world. The caller must also clear the in-run save: a restored player
 *  transform names a point in the world that just stopped existing. */
export function beginNextExpeditionSeason(
  record: { completionPercent: number; sectorsCharted: number; secretsFound: number },
  chosenSeed?: number,
): ExpeditionSeasonState {
  const next = bankSeasonAndRoll(loadExpeditionSeasons(), record, chosenSeed);
  try {
    SecureStorage.setItem(STORAGE_KEY_SEASONS, JSON.stringify(next));
  } catch {
    console.warn('Could not save expedition seasons to storage');
  }
  return next;
}
