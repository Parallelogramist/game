/**
 * DailyChallengeManager — date-seeded daily runs with leaderboard tracking.
 *
 * Design:
 *   - Every day (UTC) has a deterministic seed derived from the date string.
 *   - The seed picks: 3 modifiers (instead of the usual 1-2), starting weapon,
 *     starting ship, and difficulty rolls.
 *   - Local leaderboard tracks best score per day; resets automatically at UTC
 *     midnight when the date changes.
 *   - Weekly challenge (Monday seed) uses 4 modifiers for max chaos.
 *
 * Seeding strategy:
 *   Simple hash of the date string (YYYY-MM-DD). Same date => same seed,
 *   always. Deterministic integer RNG (mulberry32) drives all picks.
 */

import { SecureStorage } from '../storage/SecureStorage';
import { RUN_MODIFIERS } from '../data/RunModifiers';
import { SHIP_CHARACTERS } from '../data/ShipCharacters';
import { getWeaponInfoList } from '../weapons';

const STORAGE_KEY_DAILY_LEADERBOARD = 'dailyLeaderboardV1';

// ---------------------------------------------------------------------------
// Seeded RNG — mulberry32, chosen for speed and adequate distribution
// ---------------------------------------------------------------------------

type SeededRng = () => number;

function mulberry32(seed: number): SeededRng {
  let currentSeed = seed >>> 0;
  return function next(): number {
    currentSeed = (currentSeed + 0x6D2B79F5) >>> 0;
    let temp = currentSeed;
    temp = Math.imul(temp ^ (temp >>> 15), temp | 1);
    temp ^= temp + Math.imul(temp ^ (temp >>> 7), temp | 61);
    return ((temp ^ (temp >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Convert a string to a 32-bit seed using a simple FNV-1a hash.
 * Stable across runs for a given input.
 */
function hashStringToSeed(input: string): number {
  let hash = 2166136261;
  for (let index = 0; index < input.length; index++) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

// ---------------------------------------------------------------------------
// Date helpers
// ---------------------------------------------------------------------------

/** Returns the current UTC date string in YYYY-MM-DD format. */
export function getCurrentDailyDate(): string {
  const now = new Date();
  const year = now.getUTCFullYear();
  const month = String(now.getUTCMonth() + 1).padStart(2, '0');
  const day = String(now.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/** Returns the current ISO week string for weekly challenges. */
export function getCurrentWeeklyDate(): string {
  const now = new Date();
  const target = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const dayNumber = (target.getUTCDay() + 6) % 7; // ISO: 0 = Mon
  target.setUTCDate(target.getUTCDate() - dayNumber + 3);
  const firstThursday = target.getTime();
  const yearStart = Date.UTC(target.getUTCFullYear(), 0, 4);
  const weekNumber = Math.round(1 + (firstThursday - yearStart) / 604800000);
  return `${target.getUTCFullYear()}-W${String(weekNumber).padStart(2, '0')}`;
}

// ---------------------------------------------------------------------------
// Daily challenge config (what the seed produces)
// ---------------------------------------------------------------------------

export interface DailyChallengeConfig {
  seed: number;
  dateString: string;
  challengeType: 'daily' | 'weekly';
  modifierIds: string[];
  startingWeaponId: string;
  shipId: string;
}

/**
 * Generates the day's challenge. All picks are deterministic from the seed.
 */
export function generateDailyChallenge(): DailyChallengeConfig {
  const dateString = getCurrentDailyDate();
  const seed = hashStringToSeed(`daily:${dateString}`);
  const rng = mulberry32(seed);

  // Pick 3 modifiers (no duplicates)
  const shuffledModifiers = shuffleWithRng([...RUN_MODIFIERS], rng);
  const pickedModifiers = shuffledModifiers.slice(0, 3);

  // Pick a starting weapon from the full weapon list (daily dares use any weapon)
  const allWeapons = getWeaponInfoList();
  const weaponIndex = Math.floor(rng() * allWeapons.length);
  const startingWeaponId = allWeapons[weaponIndex].id;

  // Pick a ship from unlocked-for-all ships (daily always uses default ships only)
  const unlockedShips = SHIP_CHARACTERS.filter((ship) => !ship.unlockRequirement);
  const shipIndex = Math.floor(rng() * unlockedShips.length);
  const shipId = unlockedShips[shipIndex].id;

  return {
    seed,
    dateString,
    challengeType: 'daily',
    modifierIds: pickedModifiers.map((modifier) => modifier.id),
    startingWeaponId,
    shipId,
  };
}

export function generateWeeklyChallenge(): DailyChallengeConfig {
  const weekString = getCurrentWeeklyDate();
  const seed = hashStringToSeed(`weekly:${weekString}`);
  const rng = mulberry32(seed);

  const shuffledModifiers = shuffleWithRng([...RUN_MODIFIERS], rng);
  const pickedModifiers = shuffledModifiers.slice(0, 4); // 4 modifiers for weekly

  const allWeapons = getWeaponInfoList();
  const weaponIndex = Math.floor(rng() * allWeapons.length);
  const startingWeaponId = allWeapons[weaponIndex].id;

  const unlockedShips = SHIP_CHARACTERS.filter((ship) => !ship.unlockRequirement);
  const shipIndex = Math.floor(rng() * unlockedShips.length);
  const shipId = unlockedShips[shipIndex].id;

  return {
    seed,
    dateString: weekString,
    challengeType: 'weekly',
    modifierIds: pickedModifiers.map((modifier) => modifier.id),
    startingWeaponId,
    shipId,
  };
}

function shuffleWithRng<T>(items: T[], rng: SeededRng): T[] {
  const copy = [...items];
  for (let index = copy.length - 1; index > 0; index--) {
    const swapIndex = Math.floor(rng() * (index + 1));
    [copy[index], copy[swapIndex]] = [copy[swapIndex], copy[index]];
  }
  return copy;
}

// ---------------------------------------------------------------------------
// Leaderboard (local, per-day)
// ---------------------------------------------------------------------------

export interface DailyLeaderboardEntry {
  dateString: string;
  challengeType: 'daily' | 'weekly';
  survivalSeconds: number;
  killCount: number;
  levelReached: number;
  wasVictory: boolean;
  timestamp: number;
}

interface LeaderboardState {
  version: number;
  entries: Record<string, DailyLeaderboardEntry>; // key: "daily:2026-04-16" or "weekly:2026-W16"
}

const LEADERBOARD_VERSION = 1;

function makeLeaderboardKey(challengeType: 'daily' | 'weekly', dateString: string): string {
  return `${challengeType}:${dateString}`;
}

function loadLeaderboard(): LeaderboardState {
  const defaults: LeaderboardState = { version: LEADERBOARD_VERSION, entries: {} };
  try {
    const stored = SecureStorage.getItem(STORAGE_KEY_DAILY_LEADERBOARD);
    if (stored) {
      const parsed = JSON.parse(stored) as LeaderboardState;
      return { version: LEADERBOARD_VERSION, entries: { ...defaults.entries, ...parsed.entries } };
    }
  } catch {
    console.warn('DailyChallenge: leaderboard load failed');
  }
  return defaults;
}

function saveLeaderboard(state: LeaderboardState): void {
  try {
    SecureStorage.setItem(STORAGE_KEY_DAILY_LEADERBOARD, JSON.stringify(state));
  } catch {
    console.warn('DailyChallenge: leaderboard save failed');
  }
}

/**
 * Records a run's result. Only updates the stored entry if this run outperforms
 * the prior best for that day. Scoring priority: kills > survival > level.
 */
export function recordDailyRun(
  challengeType: 'daily' | 'weekly',
  dateString: string,
  entry: Omit<DailyLeaderboardEntry, 'dateString' | 'challengeType' | 'timestamp'>
): void {
  const state = loadLeaderboard();
  const key = makeLeaderboardKey(challengeType, dateString);
  const prior = state.entries[key];
  const newEntry: DailyLeaderboardEntry = {
    ...entry,
    dateString,
    challengeType,
    timestamp: Date.now(),
  };

  if (!prior || isRunBetter(newEntry, prior)) {
    state.entries[key] = newEntry;
    saveLeaderboard(state);
  }
}

export function getDailyBest(challengeType: 'daily' | 'weekly', dateString: string): DailyLeaderboardEntry | undefined {
  const state = loadLeaderboard();
  return state.entries[makeLeaderboardKey(challengeType, dateString)];
}

function isRunBetter(a: DailyLeaderboardEntry, b: DailyLeaderboardEntry): boolean {
  if (a.killCount !== b.killCount) return a.killCount > b.killCount;
  if (a.survivalSeconds !== b.survivalSeconds) return a.survivalSeconds > b.survivalSeconds;
  return a.levelReached > b.levelReached;
}

/** Returns all entries for the prior N days (for future leaderboard UI). */
export function getRecentLeaderboardEntries(count: number = 14): DailyLeaderboardEntry[] {
  const state = loadLeaderboard();
  return Object.values(state.entries)
    .sort((a, b) => b.timestamp - a.timestamp)
    .slice(0, count);
}
