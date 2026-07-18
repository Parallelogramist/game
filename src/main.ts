import Phaser from 'phaser';
import { GAME_CONFIG } from './GameConfig';
import { BootScene } from './game/scenes/BootScene';
import { GameScene } from './game/scenes/GameScene';
import { UpgradeScene } from './game/scenes/UpgradeScene';
import { RelicDraftScene } from './game/scenes/RelicDraftScene';
import { MusicSettingsScene } from './game/scenes/MusicSettingsScene';
import { SettingsScene } from './game/scenes/SettingsScene';
import { ShopScene } from './game/scenes/ShopScene';
import { CreditsScene } from './game/scenes/CreditsScene';
import { AchievementScene } from './game/scenes/AchievementScene';
import { CodexScene } from './game/scenes/CodexScene';
import { PaintScene } from './game/scenes/PaintScene';
import { WeaponSelectScene } from './game/scenes/WeaponSelectScene';
import { PactSelectScene } from './game/scenes/PactSelectScene';
import { DirectorSelectScene } from './game/scenes/DirectorSelectScene';
import { ThreatSelectScene } from './game/scenes/ThreatSelectScene';
import { ModifierDraftScene } from './game/scenes/ModifierDraftScene';
import { BlessingDraftScene } from './game/scenes/BlessingDraftScene';
import { PracticeScene } from './game/scenes/PracticeScene';
import { LeaderboardScene } from './game/scenes/LeaderboardScene';
import { CardsScene } from './game/scenes/CardsScene';
import { RunnerScene } from './game/scenes/RunnerScene';
import { LoadoutScene } from './game/scenes/LoadoutScene';
import { initializeStorage, flushStorage } from './storage';
import { baseSizeForViewport, installOrientationWatcher } from './utils/Orientation';
import { copyTextToClipboard } from './utils/Clipboard';
import { BloomPipeline } from './visual/BloomPipeline';
import { DistortionPipeline } from './visual/DistortionPipeline';
import { ColorblindPipeline } from './visual/ColorblindPipeline';
import { registerServiceWorker } from './pwa/registerServiceWorker';
import { captureInstallPromptEvent } from './pwa/InstallHint';
import { loadGameFonts } from './visual/fontLoading';

/**
 * Main entry point for the Survivor Game.
 *
 * Architecture:
 * - Phaser 3 for rendering, input, and audio
 * - bitECS for high-performance entity management
 * - Minimalist visual style using shapes instead of sprites
 * - Encrypted localStorage for anti-cheat protection
 */

// ─── Error log capture ───────────────────────────────────────────────────
// Ring buffer of recent console errors/warnings so the crash overlay can
// offer a copyable report — on mobile there is no devtools console, so this
// is the only way the player can hand over diagnostics. Installed before
// anything else so boot-time failures are captured too.
const MAX_LOG_ENTRIES = 50;
const recentLogs: string[] = [];

function stringifyLogArg(arg: unknown): string {
  if (arg instanceof Error) return `${arg.message}\n${arg.stack ?? ''}`;
  if (typeof arg === 'string') return arg;
  try {
    return JSON.stringify(arg);
  } catch {
    return String(arg);
  }
}

for (const level of ['error', 'warn'] as const) {
  const original = console[level].bind(console);
  console[level] = (...args: unknown[]) => {
    try {
      recentLogs.push(`[${new Date().toISOString()}] ${level}: ${args.map(stringifyLogArg).join(' ')}`);
      if (recentLogs.length > MAX_LOG_ENTRIES) recentLogs.shift();
    } catch {
      // Log capture must never break logging itself.
    }
    original(...args);
  };
}

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

  // Copy button first: it must not trigger the tap-anywhere reload below.
  const copyButton = document.getElementById('crash-copy');
  if (copyButton) {
    const report = [
      'Pew Pew Survivor crash report',
      `time: ${new Date().toISOString()}`,
      `source: ${source}`,
      `url: ${window.location.href}`,
      `userAgent: ${navigator.userAgent}`,
      `viewport: ${window.innerWidth}x${window.innerHeight} @ dpr ${window.devicePixelRatio}`,
      '',
      `fatal: ${stringifyLogArg(error)}`,
      '',
      `recent console errors/warnings (${recentLogs.length}):`,
      ...recentLogs,
    ].join('\n');
    copyButton.addEventListener('click', async (event) => {
      event.stopPropagation();
      const copied = await copyTextToClipboard(report);
      copyButton.textContent = copied ? 'COPIED' : 'COPY FAILED';
      setTimeout(() => {
        copyButton.textContent = 'COPY ERROR LOGS';
      }, 2000);
    });
  }

  overlay.addEventListener('click', () => window.location.reload(), { once: true });
}
window.addEventListener('error', (event) => showCrashOverlay('error', event.error ?? event.message));
// Rejected promises never abort Phaser's step — the game keeps running — and
// several fire-and-forget async paths reject routinely (music track fetch
// while offline, iOS AudioContext.resume before a user gesture). Those must
// not raise the fatal overlay over a healthy game; log for diagnosis only.
window.addEventListener('unhandledrejection', (event) => {
  console.error('[unhandledrejection]', event.reason);
});

// Async bootstrap wrapper - ensures encrypted storage is ready before game starts
(async () => {
  registerServiceWorker();
  captureInstallPromptEvent();

  // Kicked off before the storage await so the two overlap, then awaited below:
  // Phaser caches every text texture on first draw, so any face that lands after
  // the game is constructed never reaches the screen.
  const fontsReady = loadGameFonts(document.fonts);

  // Initialize encrypted storage and migrate any legacy plaintext data
  await initializeStorage();

  await fontsReady;

  // Create game configuration with scenes. The base size is orientation-aware
  // (1280×720 landscape, 720×1280 portrait) — EXPAND grows the long axis from
  // there, so the shorter side stays 720 game units in both orientations and
  // world/UI objects keep a steady physical size.
  const initialBase = baseSizeForViewport();
  const config: Phaser.Types.Core.GameConfig = {
    ...GAME_CONFIG,
    width: initialBase.width,
    height: initialBase.height,
    scene: [BootScene, GameScene, RunnerScene, UpgradeScene, RelicDraftScene, MusicSettingsScene, SettingsScene, ShopScene, CreditsScene, AchievementScene, CodexScene, PaintScene, CardsScene, WeaponSelectScene, PactSelectScene, DirectorSelectScene, ThreatSelectScene, ModifierDraftScene, BlessingDraftScene, PracticeScene, LeaderboardScene, LoadoutScene],
  };

  // Initialize the game
  const game = new Phaser.Game(config);

  // Swap the base size on orientation flips and re-lay-out whatever is live.
  // Menu scenes restart with their original launch payload (sys.settings.data)
  // plus `relayout: true` — the flag a scene holding half-composed input reads
  // to re-render at the new size instead of resetting to defaults the way a
  // fresh entry does. GameScene does its save-restore round trip (the same
  // machinery as a mid-run UI-scale change). UpgradeScene is deliberately
  // skipped: a restart would regress mid-modal state (rerolled offers, card
  // locks); it closes back into a GameScene that has already re-laid itself out.
  installOrientationWatcher(game, () => {
    for (const scene of game.scene.getScenes(true)) {
      const key = scene.scene.key;
      if (key === 'GameScene') {
        (scene as GameScene).handleOrientationFlip();
      } else if (key !== 'UpgradeScene' && key !== 'RelicDraftScene') {
        // RelicDraftScene is skipped for the same reason as UpgradeScene: a
        // restart would regress its mid-modal state. It closes back into a
        // GameScene that has re-laid itself out (handleOrientationFlip defers
        // while a draft is up and settles once it closes).
        const launchData = (scene.sys.settings.data ?? {}) as Record<string, unknown>;
        scene.scene.restart({ ...launchData, relayout: true });
      }
    }
  });

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
