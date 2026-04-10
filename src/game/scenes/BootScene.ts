import Phaser from 'phaser';
import { getMusicManager } from '../../audio/MusicManager';
import { SoundKeys, SoundManager } from '../../audio/SoundManager';
import { getMetaProgressionManager } from '../../meta/MetaProgressionManager';
import { getAscensionManager } from '../../meta/AscensionManager';
import { preloadIcons } from '../../utils/IconRenderer';
import { getGameStateManager } from '../../save/GameStateManager';
import { fadeOut, fadeIn, addButtonInteraction } from '../../utils/SceneTransition';
import { computeMenuLayoutScale, computeMenuFontScale, scaledFontPx, scaledInt } from '../../utils/HudScale';
import { getSettingsManager } from '../../settings';
import { MenuNavigator } from '../../input/MenuNavigator';

/**
 * BootScene handles initial setup and asset loading.
 * Shows a click-to-start screen (required for audio).
 */
export class BootScene extends Phaser.Scene {
  private menuItems: Phaser.GameObjects.Text[] = [];
  private menuActions: (() => void)[] = [];
  private menuLabels: string[] = [];
  private selectedIndex: number = 0;
  private menuNavigator: MenuNavigator | null = null;
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

    // ═══════════════════════════════════════════════════════════════
    //  DATA
    // ═══════════════════════════════════════════════════════════════

    const metaManager = getMetaProgressionManager();
    const ascensionLevel = getAscensionManager().getLevel();
    const gameStateManager = getGameStateManager();
    const hasSave = gameStateManager.hasSave();
    const saveInfo = gameStateManager.getSaveInfo();
    const currentStreak = metaManager.getCurrentStreak();

    // ─── Actions ───
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

    // ═══════════════════════════════════════════════════════════════
    //  LAYOUT — build menu items by group, then vertically center
    // ═══════════════════════════════════════════════════════════════

    // Spacing constants (all scaled)
    const itemGap = scaledInt(layoutScale, 34);         // between items within a group
    const groupGap = scaledInt(layoutScale, 20);        // between group containers
    const containerPadY = scaledInt(layoutScale, 16);   // vertical padding inside containers
    const containerWidth = scaledInt(layoutScale, 260);  // container width
    const subtitleOffset = scaledInt(layoutScale, 15);  // gap from item to its subtitle

    // Define menu structure as groups of items
    interface MenuItem {
      label: string;
      action: () => void;
      fontSize: number;       // unscaled px
      color: string;          // default color
      subtitle?: string;      // small text below
      subtitleColor?: string;
    }
    interface MenuGroup { items: MenuItem[]; accentColor: number }

    const playGroup: MenuGroup = { items: [], accentColor: 0x4488ff };
    if (hasSave) {
      const worldStr = saveInfo.worldLevel ? `W${saveInfo.worldLevel}` : 'W1';
      const timeStr = saveInfo.gameTime ? this.formatTime(saveInfo.gameTime) : '0:00';
      const levelStr = saveInfo.level ? `Lv ${saveInfo.level}` : 'Lv 1';
      playGroup.items.push({
        label: 'CONTINUE',
        action: continueGame,
        fontSize: 24,
        color: '#dddddd',
        subtitle: `${worldStr}  ·  ${levelStr}  ·  ${timeStr}`,
        subtitleColor: '#556677',
      });
      playGroup.items.push({
        label: 'NEW GAME',
        action: startGameWithConfirmation,
        fontSize: 17,
        color: '#888899',
      });
    } else {
      playGroup.items.push({
        label: 'START',
        action: startGameWithConfirmation,
        fontSize: 24,
        color: '#dddddd',
      });
    }

    const goldAmount = metaManager.getGold();
    const progressionGroup: MenuGroup = {
      accentColor: 0xffaa33,
      items: [
        { label: 'SHOP', action: openShop, fontSize: 17, color: '#888899', subtitle: `${goldAmount} gold`, subtitleColor: '#887744' },
        { label: 'ACHIEVEMENTS', action: openAchievements, fontSize: 17, color: '#888899' },
        { label: 'CODEX', action: openCodex, fontSize: 17, color: '#888899' },
      ],
    };

    const utilityGroup: MenuGroup = {
      accentColor: 0x445566,
      items: [
        { label: 'SETTINGS', action: openSettings, fontSize: 15, color: '#667788' },
        { label: 'CREDITS', action: openCredits, fontSize: 15, color: '#667788' },
      ],
    };

    const groups = [playGroup, progressionGroup, utilityGroup];

    // ─── Measure each group's height ───
    const groupHeights: number[] = groups.map(group => {
      let height = containerPadY * 2; // top + bottom padding
      for (let i = 0; i < group.items.length; i++) {
        const item = group.items[i];
        const textHeight = scaledInt(fontScale, item.fontSize);
        height += textHeight;
        if (item.subtitle) {
          height += subtitleOffset;
        }
        if (i < group.items.length - 1) {
          height += item.subtitle ? scaledInt(layoutScale, 22) : itemGap;
        }
      }
      return height;
    });

    // Title block height
    const titleFontSize = scaledInt(fontScale, 56);
    const worldFontSize = scaledInt(fontScale, 24);
    const titleBlockGap = scaledInt(layoutScale, 10);
    let titleBlockHeight = titleFontSize + titleBlockGap + worldFontSize;
    if (currentStreak > 0) {
      titleBlockHeight += scaledInt(layoutScale, 6) + scaledInt(fontScale, 16);
    }

    const titleToMenuGap = scaledInt(layoutScale, 36);
    const totalMenuHeight = groupHeights.reduce((sum, h) => sum + h, 0)
      + groupGap * (groups.length - 1);
    const totalHeight = titleBlockHeight + titleToMenuGap + totalMenuHeight;

    // Center everything vertically
    let cursorY = centerY - totalHeight / 2;

    // ═══════════════════════════════════════════════════════════════
    //  TITLE AREA
    // ═══════════════════════════════════════════════════════════════

    this.add.text(centerX, cursorY + titleFontSize / 2, 'PEW PEW SURVIVOR', {
      fontSize: `${titleFontSize}px`,
      color: '#ffdd44',
      fontFamily: 'Arial',
      fontStyle: 'bold',
    }).setOrigin(0.5).setShadow(0, 0, '#ffdd44', 4, false, true);
    cursorY += titleFontSize + titleBlockGap;

    // World / Ascension
    const worldText = ascensionLevel > 0
      ? `Ascension ${ascensionLevel}  ·  World ${metaManager.getWorldLevel()}`
      : `World ${metaManager.getWorldLevel()}`;
    this.add.text(centerX, cursorY + worldFontSize / 2, worldText, {
      fontSize: `${worldFontSize}px`,
      color: '#7799cc',
      fontFamily: 'Arial',
      fontStyle: 'bold',
    }).setOrigin(0.5);
    cursorY += worldFontSize;

    // Streak (if applicable)
    if (currentStreak > 0) {
      const streakBonus = metaManager.getStreakBonusPercent();
      const streakFontSize = scaledInt(fontScale, 16);
      cursorY += scaledInt(layoutScale, 6);
      this.add.text(centerX, cursorY + streakFontSize / 2,
        `Streak ${currentStreak}  ·  +${streakBonus}% gold`, {
        fontSize: `${streakFontSize}px`,
        color: '#cc8833',
        fontFamily: 'Arial',
      }).setOrigin(0.5);
      cursorY += streakFontSize;
    }

    cursorY += titleToMenuGap;

    // ═══════════════════════════════════════════════════════════════
    //  MENU GROUPS — container panels with accent lines
    // ═══════════════════════════════════════════════════════════════

    const panelGraphics = this.add.graphics();
    let menuItemIndex = 0;

    for (let g = 0; g < groups.length; g++) {
      const group = groups[g];
      const groupHeight = groupHeights[g];
      const groupTop = cursorY;

      // Container background — subtle dark panel
      const panelLeft = centerX - containerWidth / 2;
      panelGraphics.fillStyle(0x0c0c1e, 0.5);
      panelGraphics.fillRoundedRect(panelLeft, groupTop, containerWidth, groupHeight, 6);

      // Accent line on left edge
      panelGraphics.fillStyle(group.accentColor, 0.35);
      panelGraphics.fillRoundedRect(panelLeft, groupTop + 6, 2, groupHeight - 12, 1);

      // Position items inside the container
      let itemY = groupTop + containerPadY;

      for (let i = 0; i < group.items.length; i++) {
        const item = group.items[i];
        const textHeight = scaledInt(fontScale, item.fontSize);

        // Create menu item text (no brackets — clean look)
        const menuItem = this.add.text(centerX, itemY + textHeight / 2, item.label, {
          fontSize: scaledFontPx(fontScale, item.fontSize),
          color: item.color,
          fontFamily: 'Arial',
          letterSpacing: 2,
        }).setOrigin(0.5).setInteractive({ useHandCursor: true });

        menuItem.setData('defaultColor', item.color);

        // Subtitle (save info, gold amount)
        if (item.subtitle) {
          const subFontSize = scaledInt(fontScale, 11);
          this.add.text(centerX, itemY + textHeight + subtitleOffset - subFontSize / 2, item.subtitle, {
            fontSize: scaledFontPx(fontScale, 11),
            color: item.subtitleColor ?? '#555555',
            fontFamily: 'Arial',
          }).setOrigin(0.5);
        }

        // Pointer events
        const capturedIndex = menuItemIndex;
        menuItem.on('pointerover', () => {
          if (this.selectedIndex !== capturedIndex && !this.confirmationOverlay) {
            this.selectItem(capturedIndex);
          }
        });
        menuItem.on('pointerdown', () => {
          if (!this.confirmationOverlay) {
            this.soundManager.playUIClick();
            item.action();
          }
        });

        addButtonInteraction(this, menuItem);
        this.menuItems.push(menuItem);
        this.menuActions.push(item.action);
        this.menuLabels.push(item.label);
        menuItemIndex++;

        // Advance Y
        itemY += textHeight;
        if (item.subtitle) {
          itemY += subtitleOffset;
        }
        if (i < group.items.length - 1) {
          itemY += item.subtitle ? scaledInt(layoutScale, 22) : itemGap;
        }
      }

      cursorY += groupHeight + groupGap;
    }

    // Register shutdown listener for cleanup
    this.events.once('shutdown', this.shutdown, this);

    // Setup keyboard + gamepad navigation via MenuNavigator
    this.menuNavigator = new MenuNavigator({
      scene: this,
      items: this.menuItems.map((_item, index) => ({
        onFocus: () => this.selectItem(index),
        onBlur: () => this.deselectItem(index),
        onActivate: () => {
          if (this.confirmationOverlay) return;
          this.activateSelected();
        },
      })),
      onCancel: () => {
        if (this.confirmationOverlay) {
          this.hideNewGameConfirmation();
        }
      },
    });
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
    const yesButton = this.add.text(centerX - scaledInt(layoutScale, 60), centerY + scaledInt(layoutScale, 40), 'YES', {
      fontSize: scaledFontPx(fontScale, 20),
      color: '#ff4444',
      fontFamily: 'Arial',
      letterSpacing: 2,
    }).setOrigin(0.5).setInteractive({ useHandCursor: true });
    yesButton.on('pointerover', () => { yesButton.setColor('#ff8888'); yesButton.setShadow(0, 0, '#ff4444', 4, false, true); });
    yesButton.on('pointerout', () => { yesButton.setColor('#ff4444'); yesButton.setShadow(0, 0, 'transparent', 0); });
    yesButton.on('pointerdown', () => {
      this.soundManager.playUIClick();
      this.hideNewGameConfirmation();
      onConfirm();
    });
    addButtonInteraction(this, yesButton);
    this.confirmationOverlay.add(yesButton);

    // NO button
    const noButton = this.add.text(centerX + scaledInt(layoutScale, 60), centerY + scaledInt(layoutScale, 40), 'NO', {
      fontSize: scaledFontPx(fontScale, 20),
      color: '#44ff44',
      fontFamily: 'Arial',
      letterSpacing: 2,
    }).setOrigin(0.5).setInteractive({ useHandCursor: true });
    noButton.on('pointerover', () => { noButton.setColor('#88ff88'); noButton.setShadow(0, 0, '#44ff44', 4, false, true); });
    noButton.on('pointerout', () => { noButton.setColor('#44ff44'); noButton.setShadow(0, 0, 'transparent', 0); });
    noButton.on('pointerdown', () => {
      this.soundManager.playUIClick();
      this.hideNewGameConfirmation();
    });
    addButtonInteraction(this, noButton);
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
  private deselectItem(index: number): void {
    const item = this.menuItems[index];
    if (item) {
      item.setColor(item.getData('defaultColor') ?? '#888899');
      item.setShadow(0, 0, 'transparent', 0);
      item.setAlpha(1);
    }
  }

  private selectItem(index: number): void {
    if (index !== this.selectedIndex) {
      this.deselectItem(this.selectedIndex);
      this.soundManager.playUIClick();
    }
    this.selectedIndex = index;
    const currentItem = this.menuItems[this.selectedIndex];
    if (currentItem) {
      currentItem.setColor('#ffdd44');
      currentItem.setShadow(0, 0, '#ffdd44', 6, false, true);

      // Subtle glow pulse (shadow blur oscillation via alpha)
      if (this.pulseTween) {
        this.pulseTween.stop();
      }
      currentItem.setAlpha(1);
      this.pulseTween = this.tweens.add({
        targets: currentItem,
        alpha: { from: 1, to: 0.75 },
        duration: 1000,
        ease: 'Sine.easeInOut',
        yoyo: true,
        repeat: -1,
      });
    }
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
    if (this.menuNavigator) {
      this.menuNavigator.destroy();
      this.menuNavigator = null;
    }
    if (this.pulseTween) {
      this.pulseTween.stop();
      this.pulseTween = null;
    }
    this.tweens.killAll();
  }
}
