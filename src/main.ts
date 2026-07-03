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
import { WeaponSelectScene } from './game/scenes/WeaponSelectScene';
import { PactSelectScene } from './game/scenes/PactSelectScene';
import { LeaderboardScene } from './game/scenes/LeaderboardScene';
import { initializeStorage, flushStorage } from './storage';
import { BloomPipeline } from './visual/BloomPipeline';
import { DistortionPipeline } from './visual/DistortionPipeline';
import { ColorblindPipeline } from './visual/ColorblindPipeline';

/**
 * Main entry point for the Survivor Game.
 *
 * Architecture:
 * - Phaser 3 for rendering, input, and audio
 * - bitECS for high-performance entity management
 * - Minimalist visual style using shapes instead of sprites
 * - Encrypted localStorage for anti-cheat protection
 */

// ─── Crash recovery ──────────────────────────────────────────────────────
// Phaser only reschedules its next requestAnimationFrame after a step
// completes without throwing — any uncaught exception inside a scene's
// update()/create() silently freezes the whole game on the last-rendered
// frame, with zero feedback to the player. Registered before the async
// bootstrap below so it also covers boot-time failures (storage init,
// Phaser construction), not just in-game ones.
let crashHandled = false;
function showCrashOverlay(source: string, error: unknown): void {
  if (crashHandled) return;
  crashHandled = true;

  console.error(`[fatal:${source}]`, error);

  // Best-effort — the storage layer itself may be what's broken, and this
  // must never throw past this point or the overlay below won't show.
  try {
    flushStorage();
  } catch (flushError) {
    console.error('[fatal] flushStorage failed during crash handling', flushError);
  }

  const overlay = document.getElementById('crash-overlay');
  if (!overlay) return;
  overlay.classList.add('crash-overlay-visible');
  overlay.addEventListener('click', () => window.location.reload(), { once: true });
}
window.addEventListener('error', (event) => showCrashOverlay('error', event.error ?? event.message));
window.addEventListener('unhandledrejection', (event) => showCrashOverlay('unhandledrejection', event.reason));

// Async bootstrap wrapper - ensures encrypted storage is ready before game starts
(async () => {
  // Initialize encrypted storage and migrate any legacy plaintext data
  await initializeStorage();

  // Create game configuration with scenes
  const config: Phaser.Types.Core.GameConfig = {
    ...GAME_CONFIG,
    scene: [BootScene, GameScene, UpgradeScene, MusicSettingsScene, SettingsScene, ShopScene, CreditsScene, AchievementScene, CodexScene, WeaponSelectScene, PactSelectScene, LeaderboardScene],
  };

  // Initialize the game
  const game = new Phaser.Game(config);

  // Dismiss the HTML boot loader once Phaser is presenting. READY fires when
  // the renderer + first scene are up; one extra rAF-after-delay ensures a
  // painted frame is actually on screen before the 320ms fade starts.
  const dismissBootLoader = () => {
    const loader = document.getElementById('boot-loader');
    if (!loader) return;
    loader.classList.add('boot-loader-hidden');
    setTimeout(() => loader.remove(), 400);
  };
  game.events.once(Phaser.Core.Events.READY, () => {
    setTimeout(() => requestAnimationFrame(dismissBootLoader), 400);
  });
  // Hard fallback — never strand the loader if READY is missed.
  setTimeout(dismissBootLoader, 12000);

  // Register post-processing pipelines (WebGL only)
  if (game.renderer.type === Phaser.WEBGL) {
    const renderer = game.renderer as Phaser.Renderer.WebGL.WebGLRenderer;
    renderer.pipelines.addPostPipeline('BloomPipeline', BloomPipeline);
    renderer.pipelines.addPostPipeline('DistortionPipeline', DistortionPipeline);
    renderer.pipelines.addPostPipeline('ColorblindPipeline', ColorblindPipeline);
  }

  // Flush pending encrypted writes when the page goes away. iOS Safari
  // rarely fires beforeunload — pagehide and visibilitychange(hidden) are
  // the reliable lifecycle signals there. flushStorage is idempotent.
  const flushOnExit = () => {
    flushStorage();
  };
  window.addEventListener('beforeunload', flushOnExit);
  window.addEventListener('pagehide', flushOnExit);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flushOnExit();
  });
})();
