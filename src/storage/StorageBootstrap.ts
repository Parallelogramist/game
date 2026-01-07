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
 * All localStorage keys used by the game.
 * These are pre-loaded and decrypted during bootstrap.
 */
const ALL_STORAGE_KEYS = [
  // MetaProgressionManager
  'survivor-meta-gold',
  'survivor-meta-upgrades',
  'survivor-meta-world-level',

  // GameStateManager
  'survivor-game-state',

  // SettingsManager
  'settings-sfx-enabled',
  'settings-sfx-volume',
  'settings-screen-shake',
  'settings-fps-counter',
  'settings-damage-numbers-mode',
  'settings-status-text',

  // MusicManager
  'survivor-music-enabled',
  'survivor-music-mode',
  'survivor-music-volume',

  // GameScene
  'game_autoBuyEnabled',
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
