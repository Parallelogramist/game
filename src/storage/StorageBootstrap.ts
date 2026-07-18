/**
 * StorageBootstrap - Initializes encrypted storage before game starts.
 *
 * This module MUST complete initialization before any manager singletons
 * are created, as managers read from storage in their constructors.
 *
 * Call initializeStorage() in main.ts before creating the Phaser game.
 */

import { StorageEncryption } from './StorageEncryption';

/**
 * All SecureStorage keys used by the game.
 * These are pre-loaded and decrypted during bootstrap.
 *
 * A key a manager reads/writes via SecureStorage but that's missing from this
 * list silently reads back as null on EVERY fresh page load: SecureStorage.getItem
 * only ever answers from StorageEncryption's in-memory cache, and only keys listed
 * here get loaded into that cache during initializeStorage(). The write still lands
 * in encrypted localStorage (setItem populates the cache immediately, so same-session
 * reads look fine), but a reload never sees it. New STORAGE_KEY* constant → add it here.
 * `StorageBootstrap.test.ts` guards this by scanning src/ for the naming convention.
 */
export const ALL_STORAGE_KEYS = [
  // MetaProgressionManager
  'survivor-meta-gold',
  'survivor-meta-upgrades',
  'survivor-meta-world-level',
  'survivor-meta-streak',
  'survivor-meta-runs-completed',
  'survivor-meta-achievement-bonuses',
  'survivor-meta-last-run-upgrades',
  'survivor-meta-ascension',

  // GameStateManager
  'survivor-game-state',

  // SettingsManager
  'settings-sfx-enabled',
  'settings-sfx-volume',
  'settings-screen-shake',
  'settings-screen-shake-intensity',
  'settings-grid-effects',
  'settings-fps-counter',
  'settings-damage-numbers-mode',
  'settings-status-text',
  'settings-ui-scale',
  'settings-tutorial-seen',
  'settings-reduced-motion',
  'settings-director-debug',
  'settings-colorblind-mode',
  'settings-high-contrast',
  'settings-minimap-enabled',

  // MusicManager
  'survivor-music-enabled',
  'survivor-music-mode',
  'survivor-music-volume',

  // GameScene
  'game_autoBuyEnabled',

  // CardCollectionManager
  'survivor-meta-cards',

  // BoostCardManager (one-run boost armed by a flux cache)
  'survivor-meta-boosts',

  // ShipModManager (per-ship mod-track levels)
  'survivor-meta-ship-mods',

  // CodexManager
  'survivor-codex',

  // AchievementManager
  'survivor-achievements',

  // BestScoreManager (per-run best score by world level)
  'survivor-best-scores',

  // TutorialHintManager (one-time contextual hint flags)
  'survivor-tutorial-hints',

  // RunHistoryManager (recent run summaries)
  'survivor-run-history',

  // HiddenUnlocks (hidden-gated ship/content unlock progress)
  'hiddenUnlocksV1',

  // DailyChallengeManager (daily/weekly challenge leaderboard)
  'dailyLeaderboardV1',

  // RunnerBestScore (endless-runner mode best score)
  'survivor-runner-best',
  'survivor-runner-leaderboard',

  // GauntletBestWave (gauntlet boss-rush mode best cleared wave)
  'survivor-gauntlet-best',

  // ThreatProgress (campaign Threat Level ladder — highest cleared + last selected)
  'survivor-threat-best',
  'survivor-threat-last',
  'survivor-gauntlet-leaderboard',

  // LastLoadout (one-tap replay of the last pre-run funnel configuration)
  'survivor-last-loadout',

  // EndlessBestCycle (post-victory endless mode deepest cycle reached)
  'survivor-endless-best',
  'survivor-endless-leaderboard',

  // BackupReminder (device-local backup bookkeeping — see NON_TRANSFERABLE_STORAGE_KEYS)
  'survivor-last-export-at',
  'survivor-backup-nudge-at',

  // InstallHint (device-local one-time stamp)
  'survivor-install-hint-at',

  // ShipPaintManager (player-chosen hull paint; auto-transfers with the profile)
  'survivor-ship-paint',
];

/**
 * Initialize the secure storage system.
 * This function:
 * 1. Derives the encryption key (first run generates salt)
 * 2. Pre-loads all storage keys into the decrypted cache
 * 3. Auto-migrates any unencrypted (legacy) values
 *
 * MUST be called and awaited before creating any manager singletons.
 *
 * @returns Promise that resolves when initialization is complete
 */
export async function initializeStorage(): Promise<void> {
  const startTime = performance.now();

  const storage = StorageEncryption.getInstance();

  // Initialize the encryption key (PBKDF2 derivation)
  await storage.initialize();

  // Pre-load all keys in parallel for faster startup
  await Promise.all(
    ALL_STORAGE_KEYS.map((key) => storage.loadAndCache(key))
  );

  const elapsed = performance.now() - startTime;
  console.log(`Storage initialized in ${elapsed.toFixed(1)}ms`);
}

/**
 * Flush any pending writes before page unload.
 * Attach this to the 'beforeunload' event if needed.
 */
export async function flushStorage(): Promise<void> {
  await StorageEncryption.getInstance().flushPendingWrites();
}
