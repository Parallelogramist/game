import Phaser from 'phaser';
import { getMusicManager } from '../../audio/MusicManager';
import { SoundKeys, SoundManager } from '../../audio/SoundManager';
import { getMetaProgressionManager } from '../../meta/MetaProgressionManager';
import { getAscensionManager } from '../../meta/AscensionManager';
import { preloadIcons } from '../../utils/IconRenderer';
import { getGameStateManager } from '../../save/GameStateManager';
import { fadeOut, fadeIn } from '../../utils/SceneTransition';
import { computeMenuLayoutScale, computeMenuFontScale, scaledFontPx, scaledInt } from '../../utils/HudScale';
import { getSettingsManager } from '../../settings';

/**
 * BootScene handles initial setup and asset loading.
 * Shows a click-to-start screen (required for audio).
 */
export class BootScene extends Phaser.Scene {
  private menuItems: Phaser.GameObjects.Text[] = [];
  private menuActions: (() => void)[] = [];
  private menuLabels: string[] = [];
  private selectedIndex: number = 0;
  private keydownHandler: ((event: KeyboardEvent) => void) | null = null;
  private pulseTween: Phaser.Tweens.Tween | null = null;
  private confirmationOverlay: Phaser.GameObjects.Container | null = null;
  private soundManager!: SoundManager;

  constructor() {
    super({ key: 'BootScene' });
  }

  preload(): void {
    // Generate particle texture programmatically (4x4 white square)
    const particleGraphics = this.make.graphics({});
    particleGraphics.fillStyle(0xffffff);
    particleGraphics.fillRect(0, 0, 4, 4);
    particleGraphics.generateTexture('particle', 4, 4);
    particleGraphics.destroy();

    // Generate soft glow particle (radial gradient circle for Geometry Wars effects)
    const glowSize = 16;
    const glowGraphics = this.make.graphics({});
    // Draw concentric circles to simulate radial gradient
    for (let r = glowSize; r > 0; r -= 2) {
      const alpha = (r / glowSize) * 0.8;
      glowGraphics.fillStyle(0xffffff, alpha);
      glowGraphics.fillCircle(glowSize, glowSize, r);
    }
    glowGraphics.generateTexture('particle_glow', glowSize * 2, glowSize * 2);
    glowGraphics.destroy();

    // Generate streak particle (elongated for motion blur effect)
    const streakGraphics = this.make.graphics({});
    streakGraphics.fillStyle(0xffffff, 1);
    streakGraphics.fillRect(0, 1, 12, 2);
    streakGraphics.fillStyle(0xffffff, 0.5);
    streakGraphics.fillRect(0, 0, 12, 1);
    streakGraphics.fillRect(0, 3, 12, 1);
    streakGraphics.generateTexture('particle_streak', 12, 4);
    streakGraphics.destroy();

    // Load sound effects (Kenney.nl CC0 licensed)
    this.load.audio(SoundKeys.HIT, 'sfx/hit.ogg');
    this.load.audio(SoundKeys.PICKUP_XP, 'sfx/pickup_xp.ogg');
    this.load.audio(SoundKeys.PICKUP_HEALTH, 'sfx/pickup_health.ogg');
    this.load.audio(SoundKeys.LEVEL_UP, 'sfx/levelup.ogg');
    this.load.audio(SoundKeys.PLAYER_HURT, 'sfx/player_hurt.ogg');

    // Load icon sprite atlas (game-icons.net CC BY 3.0)
    preloadIcons(this);
  }

  create(): void {
    const centerX = this.cameras.main.centerX;
    const centerY = this.cameras.main.centerY;
    const musicManager = getMusicManager();

    // Compute scaling for responsive layout on phones
    const layoutScale = computeMenuLayoutScale(this.scale.width, this.scale.height);
    const fontScale = computeMenuFontScale(this.scale.width, this.scale.height, getSettingsManager().getUiScale());

    // Fade in from black
    fadeIn(this, 200);

    // Reset state for scene restart
    this.soundManager = new SoundManager(this);
    this.menuItems = [];
    this.menuActions = [];
    this.menuLabels = [];
    this.selectedIndex = 0;
    this.confirmationOverlay = null;

    // Start music on first user interaction (required for Web Audio)
    const startMenuMusic = async () => {
      if (musicManager.getPlaybackMode() !== 'off' && !musicManager.getIsPlaying()) {
        await musicManager.play();
      }
    };
    this.input.once('pointerdown', startMenuMusic);
    this.input.keyboard?.once('keydown', startMenuMusic);

    // Title
    this.add
      .text(centerX, centerY - scaledInt(layoutScale, 140), 'PEW PEW SURVIVOR', {
        fontSize: scaledFontPx(fontScale, 64),
        color: '#ffdd44',
        fontFamily: 'Arial',
        fontStyle: 'bold',
      })
      .setOrigin(0.5);

    // World level indicator (below title)
    const metaManager = getMetaProgressionManager();
    const ascensionLevel = getAscensionManager().getLevel();
    const worldText = ascensionLevel > 0
      ? `Ascension ${ascensionLevel}  ·  World ${metaManager.getWorldLevel()}`
      : `World ${metaManager.getWorldLevel()}`;
    this.add
      .text(centerX, centerY - scaledInt(layoutScale, 60), worldText, {
        fontSize: scaledFontPx(fontScale, 28),
        color: '#88aaff',
        fontFamily: 'Arial',
        fontStyle: 'bold',
      })
      .setOrigin(0.5);

    // Streak indicator (below world level, if player has a streak)
    const currentStreak = metaManager.getCurrentStreak();
    if (currentStreak > 0) {
      const streakBonus = metaManager.getStreakBonusPercent();
      const fireEmoji = currentStreak >= 5 ? '🔥🔥' : '🔥';
      this.add
        .text(centerX, centerY - scaledInt(layoutScale, 28), `${fireEmoji} Streak: ${currentStreak} (+${streakBonus}% gold)`, {
          fontSize: scaledFontPx(fontScale, 18),
          color: '#ffaa44',
          fontFamily: 'Arial',
        })
        .setOrigin(0.5);
    }

    // Check for saved game
    const gameStateManager = getGameStateManager();
    const hasSave = gameStateManager.hasSave();
    const saveInfo = gameStateManager.getSaveInfo();

    // Define menu actions
    const continueGame = async () => {
      try {
        if (musicManager.getPlaybackMode() !== 'off' && !musicManager.getIsPlaying()) {
          await musicManager.play();
        }
        fadeOut(this, 200, () => this.scene.start('GameScene', { restore: true }));
      } catch (error) {
        console.error('Could not continue game:', error);
        this.scene.start('GameScene', { restore: true });
      }
    };

    const startNewGame = async () => {
      try {
        if (musicManager.getPlaybackMode() !== 'off' && !musicManager.getIsPlaying()) {
          await musicManager.play();
        }
        gameStateManager.clearSave();
        fadeOut(this, 200, () => this.scene.start('WeaponSelectScene'));
      } catch (error) {
        console.error('Could not start game:', error);
        gameStateManager.clearSave();
        this.scene.start('WeaponSelectScene');
      }
    };

    const startGameWithConfirmation = () => {
      if (hasSave) {
        this.showNewGameConfirmation(startNewGame);
      } else {
        startNewGame();
      }
    };

    const openShop = () => fadeOut(this, 150, () => this.scene.start('ShopScene'));
    const openAchievements = () => fadeOut(this, 150, () => this.scene.start('AchievementScene'));
    const openCodex = () => fadeOut(this, 150, () => this.scene.start('CodexScene'));
    const openSettings = () => fadeOut(this, 150, () => this.scene.start('SettingsScene', { returnTo: 'BootScene' }));
    const openCredits = () => fadeOut(this, 150, () => this.scene.start('CreditsScene'));

    // Build menu with visual grouping
    const menuConfig: { label: string; y: number; fontSize: string; action: () => void; color?: string }[] = [];
    let yOffset = centerY + scaledInt(layoutScale, 10);

    // ─── Primary: Play actions ───
    if (hasSave) {
      menuConfig.push({
        label: 'CONTINUE',
        y: yOffset,
        fontSize: scaledFontPx(fontScale, 26),
        action: continueGame,
        color: '#cccccc',
      });
      // Save info subtitle
      const worldStr = saveInfo.worldLevel ? `W${saveInfo.worldLevel}` : 'W1';
      const timeStr = saveInfo.gameTime ? this.formatTime(saveInfo.gameTime) : '0:00';
      const levelStr = saveInfo.level ? `Lv ${saveInfo.level}` : 'Lv 1';
      this.add
        .text(centerX, yOffset + scaledInt(layoutScale, 18), `${worldStr}  ·  ${levelStr}  ·  ${timeStr}`, {
          fontSize: scaledFontPx(fontScale, 12),
          color: '#555555',
          fontFamily: 'Arial',
        })
        .setOrigin(0.5);
      yOffset += scaledInt(layoutScale, 48);

      menuConfig.push({
        label: 'NEW GAME',
        y: yOffset,
        fontSize: scaledFontPx(fontScale, 18),
        action: startGameWithConfirmation,
      });
      yOffset += scaledInt(layoutScale, 38);
    } else {
      menuConfig.push({
        label: 'START',
        y: yOffset,
        fontSize: scaledFontPx(fontScale, 26),
        action: startGameWithConfirmation,
        color: '#cccccc',
      });
      yOffset += scaledInt(layoutScale, 48);
    }

    // ─── Divider ───
    const dividerY = yOffset;
    const dividerGraphics = this.add.graphics();
    dividerGraphics.lineStyle(1, 0x333355, 0.5);
    dividerGraphics.lineBetween(centerX - scaledInt(layoutScale, 80), dividerY, centerX + scaledInt(layoutScale, 80), dividerY);
    yOffset += scaledInt(layoutScale, 18);

    // ─── Meta: Progression screens ───
    menuConfig.push({
      label: 'SHOP',
      y: yOffset,
      fontSize: scaledFontPx(fontScale, 18),
      action: openShop,
    });
    // Gold subtitle
    this.add
      .text(centerX, yOffset + scaledInt(layoutScale, 16), `${metaManager.getGold()} gold`, {
        fontSize: scaledFontPx(fontScale, 11),
        color: '#666644',
        fontFamily: 'Arial',
      })
      .setOrigin(0.5);
    yOffset += scaledInt(layoutScale, 42);

    menuConfig.push({ label: 'ACHIEVEMENTS', y: yOffset, fontSize: scaledFontPx(fontScale, 18), action: openAchievements });
    yOffset += scaledInt(layoutScale, 38);
    menuConfig.push({ label: 'CODEX', y: yOffset, fontSize: scaledFontPx(fontScale, 18), action: openCodex });
    yOffset += scaledInt(layoutScale, 38);

    // ─── Divider ───
    const divider2Y = yOffset;
    dividerGraphics.lineBetween(centerX - scaledInt(layoutScale, 50), divider2Y, centerX + scaledInt(layoutScale, 50), divider2Y);
    yOffset += scaledInt(layoutScale, 16);

    // ─── Utility: Secondary screens ───
    menuConfig.push({ label: 'SETTINGS', y: yOffset, fontSize: scaledFontPx(fontScale, 15), action: openSettings, color: '#666666' });
    yOffset += scaledInt(layoutScale, 32);
    menuConfig.push({ label: 'CREDITS', y: yOffset, fontSize: scaledFontPx(fontScale, 15), action: openCredits, color: '#666666' });

    menuConfig.forEach((config, index) => {
      const defaultColor = config.color ?? '#888888';
      const menuItem = this.add
        .text(centerX, config.y, `[ ${config.label} ]`, {
          fontSize: config.fontSize,
          color: defaultColor,
          fontFamily: 'Arial',
        })
        .setOrigin(0.5)
        .setInteractive({ useHandCursor: true });

      menuItem.setData('defaultColor', defaultColor);

      // Pointer events
      menuItem.on('pointerover', () => {
        if (this.selectedIndex !== index && !this.confirmationOverlay) {
          this.selectItem(index);
        }
      });

      menuItem.on('pointerdown', () => {
        if (!this.confirmationOverlay) {
          this.soundManager.playUIClick();
          config.action();
        }
      });

      this.menuItems.push(menuItem);
      this.menuActions.push(config.action);
      this.menuLabels.push(config.label);
    });

    // Register shutdown listener for cleanup
    this.events.once('shutdown', this.shutdown, this);

    // Select first item by default
    this.selectItem(0);

    // Setup keyboard navigation (arrows + WASD)
    this.keydownHandler = (event: KeyboardEvent) => {
      // If confirmation dialog is open, handle it separately
      if (this.confirmationOverlay) {
        if (event.key === 'Escape') {
          event.preventDefault();
          this.hideNewGameConfirmation();
        }
        return;
      }

      const key = event.key.toLowerCase();
      if (event.key === 'ArrowDown' || key === 's') {
        event.preventDefault();
        this.selectNext();
      } else if (event.key === 'ArrowUp' || key === 'w') {
        event.preventDefault();
        this.selectPrevious();
      } else if (event.key === ' ' || event.key === 'Enter') {
        event.preventDefault();
        this.activateSelected();
      }
    };
    this.input.keyboard?.on('keydown', this.keydownHandler);
  }

  /**
   * Formats seconds into M:SS format.
   */
  private formatTime(seconds: number): string {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  }

  /**
   * Shows confirmation dialog for starting a new game when save exists.
   */
  private showNewGameConfirmation(onConfirm: () => void): void {
    const centerX = this.cameras.main.centerX;
    const centerY = this.cameras.main.centerY;
    const layoutScale = computeMenuLayoutScale(this.scale.width, this.scale.height);
    const fontScale = computeMenuFontScale(this.scale.width, this.scale.height, getSettingsManager().getUiScale());

    // Create overlay container
    this.confirmationOverlay = this.add.container(0, 0);
    this.confirmationOverlay.setDepth(100);

    // Dark background
    const bg = this.add.rectangle(centerX, centerY, scaledInt(layoutScale, 400), scaledInt(layoutScale, 200), 0x000000, 0.9);
    bg.setStrokeStyle(2, 0xffdd44);
    this.confirmationOverlay.add(bg);

    // Warning text
    const warningText = this.add.text(centerX, centerY - scaledInt(layoutScale, 50), 'START NEW GAME?', {
      fontSize: scaledFontPx(fontScale, 24),
      color: '#ffdd44',
      fontFamily: 'Arial',
      fontStyle: 'bold',
    }).setOrigin(0.5);
    this.confirmationOverlay.add(warningText);

    const subtextLine = this.add.text(centerX, centerY - scaledInt(layoutScale, 15), 'Your current progress will be lost.', {
      fontSize: scaledFontPx(fontScale, 16),
      color: '#aaaaaa',
      fontFamily: 'Arial',
    }).setOrigin(0.5);
    this.confirmationOverlay.add(subtextLine);

    // YES button
    const yesButton = this.add.text(centerX - scaledInt(layoutScale, 60), centerY + scaledInt(layoutScale, 40), '[ YES ]', {
      fontSize: scaledFontPx(fontScale, 20),
      color: '#ff4444',
      fontFamily: 'Arial',
    }).setOrigin(0.5).setInteractive({ useHandCursor: true });
    yesButton.on('pointerover', () => yesButton.setColor('#ff8888'));
    yesButton.on('pointerout', () => yesButton.setColor('#ff4444'));
    yesButton.on('pointerdown', () => {
      this.soundManager.playUIClick();
      this.hideNewGameConfirmation();
      onConfirm();
    });
    this.confirmationOverlay.add(yesButton);

    // NO button
    const noButton = this.add.text(centerX + scaledInt(layoutScale, 60), centerY + scaledInt(layoutScale, 40), '[ NO ]', {
      fontSize: scaledFontPx(fontScale, 20),
      color: '#44ff44',
      fontFamily: 'Arial',
    }).setOrigin(0.5).setInteractive({ useHandCursor: true });
    noButton.on('pointerover', () => noButton.setColor('#88ff88'));
    noButton.on('pointerout', () => noButton.setColor('#44ff44'));
    noButton.on('pointerdown', () => {
      this.soundManager.playUIClick();
      this.hideNewGameConfirmation();
    });
    this.confirmationOverlay.add(noButton);

    // ESC hint
    const escHint = this.add.text(centerX, centerY + scaledInt(layoutScale, 80), '(ESC to cancel)', {
      fontSize: scaledFontPx(fontScale, 12),
      color: '#666666',
      fontFamily: 'Arial',
    }).setOrigin(0.5);
    this.confirmationOverlay.add(escHint);
  }

  /**
   * Hides the new game confirmation dialog.
   */
  private hideNewGameConfirmation(): void {
    if (this.confirmationOverlay) {
      this.confirmationOverlay.destroy();
      this.confirmationOverlay = null;
    }
  }

  /**
   * Selects a menu item by index and updates visual state.
   */
  private selectItem(index: number): void {
    if (index !== this.selectedIndex) {
      this.soundManager.playUIClick();
    }
    // Update previous selection (remove highlight)
    const previousItem = this.menuItems[this.selectedIndex];
    if (previousItem && this.menuLabels[this.selectedIndex]) {
      previousItem.setText(`[ ${this.menuLabels[this.selectedIndex]} ]`);
      previousItem.setColor(previousItem.getData('defaultColor') ?? '#888888');
      previousItem.setAlpha(1);
    }

    // Update current selection
    this.selectedIndex = index;
    const currentItem = this.menuItems[this.selectedIndex];
    if (currentItem && this.menuLabels[this.selectedIndex]) {
      currentItem.setText(`[ ${this.menuLabels[this.selectedIndex]} ]`);
      currentItem.setColor('#ffdd44');

      // Update pulse animation to target new selection
      if (this.pulseTween) {
        this.pulseTween.stop();
      }
      currentItem.setAlpha(1);
      this.pulseTween = this.tweens.add({
        targets: currentItem,
        alpha: 0.5,
        duration: 800,
        yoyo: true,
        repeat: -1,
      });
    }
  }

  /**
   * Selects the next menu item (wraps around).
   */
  private selectNext(): void {
    const nextIndex = (this.selectedIndex + 1) % this.menuItems.length;
    this.selectItem(nextIndex);
  }

  /**
   * Selects the previous menu item (wraps around).
   */
  private selectPrevious(): void {
    const previousIndex = (this.selectedIndex - 1 + this.menuItems.length) % this.menuItems.length;
    this.selectItem(previousIndex);
  }

  /**
   * Activates the currently selected menu item.
   */
  private activateSelected(): void {
    const action = this.menuActions[this.selectedIndex];
    if (action) {
      action();
    }
  }

  /**
   * Cleanup keyboard handlers when scene shuts down.
   */
  shutdown(): void {
    if (this.keydownHandler) {
      this.input.keyboard?.off('keydown', this.keydownHandler);
      this.keydownHandler = null;
    }
    if (this.pulseTween) {
      this.pulseTween.stop();
      this.pulseTween = null;
    }
    this.tweens.killAll();
  }
}
