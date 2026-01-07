import Phaser from 'phaser';
import { GAME_CONFIG } from './GameConfig';
import { BootScene } from './game/scenes/BootScene';
import { GameScene } from './game/scenes/GameScene';
import { UpgradeScene } from './game/scenes/UpgradeScene';
import { MusicSettingsScene } from './game/scenes/MusicSettingsScene';
import { SettingsScene } from './game/scenes/SettingsScene';
import { ShopScene } from './game/scenes/ShopScene';
import { CreditsScene } from './game/scenes/CreditsScene';
import { AchievementScene } from './game/scenes/AchievementScene';
import { CodexScene } from './game/scenes/CodexScene';
import { initializeStorage, flushStorage } from './storage';

/**
 * Main entry point for the Survivor Game.
 *
 * Architecture:
 * - Phaser 3 for rendering, input, and audio
 * - bitECS for high-performance entity management
 * - Minimalist visual style using shapes instead of sprites
 * - Encrypted localStorage for anti-cheat protection
 */

// Async bootstrap wrapper - ensures encrypted storage is ready before game starts
(async () => {
  // Initialize encrypted storage and migrate any legacy plaintext data
  await initializeStorage();

  // Create game configuration with scenes
  const config: Phaser.Types.Core.GameConfig = {
    ...GAME_CONFIG,
    scene: [BootScene, GameScene, UpgradeScene, MusicSettingsScene, SettingsScene, ShopScene, CreditsScene, AchievementScene, CodexScene],
  };

  // Initialize the game!
  const game = new Phaser.Game(config);

  // Export for debugging in console
  (window as unknown as { game: Phaser.Game }).game = game;

  // Flush pending encrypted writes before page unload
  window.addEventListener('beforeunload', () => {
    flushStorage();
  });
})();
