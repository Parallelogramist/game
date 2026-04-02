import Phaser from 'phaser';
import { computeHudScale } from '../../utils/HudScale';
import { getSettingsManager } from '../../settings';
import { getMetaProgressionManager } from '../../meta/MetaProgressionManager';
import { getMusicManager } from '../../audio/MusicManager';
import { createIcon } from '../../utils/IconRenderer';
import { SecureStorage } from '../../storage';
import { VisualQuality } from '../../visual/GlowGraphics';
import { STORAGE_KEY_AUTO_BUY } from '../../data/GameTuning';
import { MasteryIconEffectsManager } from '../../visual/MasteryIconEffectsManager';
import { RunEvent, getActiveEvent } from '../../systems/EventSystem';
import { getNextComboThreshold } from '../../systems/ComboSystem';

interface BossHealthBar {
  entityId: number;
  name: string;
  isFinalBoss: boolean;
  container: Phaser.GameObjects.Container;
  nameText: Phaser.GameObjects.Text;
  barBackground: Phaser.GameObjects.Rectangle;
  barFill: Phaser.GameObjects.Rectangle;
  healthText: Phaser.GameObjects.Text;
  glowGraphics: Phaser.GameObjects.Graphics;
}

export interface HUDUpdateState {
  gameTime: number;
  deltaSeconds: number;
  killCount: number;
  playerLevel: number;
  xp: number;
  xpToNextLevel: number;
  currentHP: number;
  maxHP: number;
  hasWon: boolean;
  comboCount: number;
  comboTier: string;
  comboDecayPercent: number;
  bossHealthData: Array<{ entityId: number; currentHP: number; maxHP: number }>;
}

export interface EvolutionInfo {
  requiredWeaponLevel: number;
  requiredStatName: string;
  requiredStatLevel: number;
  currentStatLevel: number;
  isEvolved: boolean;
  evolvedName: string;
}

export interface UpgradeIconData {
  id: string;
  icon: string;
  name: string;
  description: string;
  currentLevel: number;
  maxLevel: number;
  type: 'skill' | 'weapon';
  evolutionInfo?: EvolutionInfo;
}

interface HUDManagerOptions {
  worldLevel: number;
  onPauseClicked: () => void;
  onAutoBuyToggled: () => void;
}

const HUD_DEPTH = 1000;
const HUD_ALPHA = 0.75;
const HUD_EDGE_PADDING = 16;
const HUD_ELEMENT_SPACING = 8;
const WORLD_LEVEL_TEXT_HEIGHT = 18;

export class HUDManager {
  private scene: Phaser.Scene;
  private options: HUDManagerOptions;

  // HUD scale factor for mobile/small screens
  private hudScale: number = 1;

  // XP Bar UI elements
  private xpBarBackground!: Phaser.GameObjects.Rectangle;
  private xpBarFill!: Phaser.GameObjects.Rectangle;
  private levelText!: Phaser.GameObjects.Text;
  private milestoneHintText!: Phaser.GameObjects.Text;
  private xpGlowGraphics!: Phaser.GameObjects.Graphics;
  private xpShimmerActive: boolean = false;

  // HP Bar UI elements
  private hpBarBackground!: Phaser.GameObjects.Rectangle;
  private hpBarFill!: Phaser.GameObjects.Rectangle;
  private hpText!: Phaser.GameObjects.Text;
  private hpGlowGraphics!: Phaser.GameObjects.Graphics;
  private lastHPThreshold: 'green' | 'yellow' | 'red' = 'green';

  // Upgrade icons UI
  private upgradeIconsContainer!: Phaser.GameObjects.Container;
  private upgradeTooltip!: Phaser.GameObjects.Container;
  private activeIconHighlights: Map<string, number> = new Map();

  // BGM UI elements
  private bgmContainer!: Phaser.GameObjects.Container;
  private bgmTrackText!: Phaser.GameObjects.Text;
  private bgmMuteButton!: Phaser.GameObjects.Image;
  private bgmMuteStrike!: Phaser.GameObjects.Graphics;
  private lastTrackId: string = '';

  // FPS counter
  private fpsText: Phaser.GameObjects.Text | null = null;
  private fpsHistory: number[] = [];
  private readonly FPS_HISTORY_SIZE = 30;

  // Auto-buy toggle
  private autoBuyToggleText: Phaser.GameObjects.Text | null = null;
  private autoBuyToggleBg: Phaser.GameObjects.Rectangle | null = null;
  private isAutoBuyEnabled: boolean = false;

  // Event indicator
  private eventIndicatorContainer: Phaser.GameObjects.Container | null = null;
  private eventIndicatorBarFill: Phaser.GameObjects.Rectangle | null = null;
  private eventIndicatorTimeText: Phaser.GameObjects.Text | null = null;
  private eventIndicatorTotalDuration: number = 0;

  // Visual quality (auto-scales based on FPS)
  private visualQuality: VisualQuality = 'high';

  // Mastery icon effects (glow + particles for maxed weapons/skills in HUD)
  private masteryIconEffects: MasteryIconEffectsManager;

  // Boss health bar UI tracking (stacked bars for multiple bosses)
  private activeBossHealthBars: BossHealthBar[] = [];
  private readonly BOSS_HEALTH_BAR_START_Y = 75;
  private readonly BOSS_HEALTH_BAR_HEIGHT = 48;
  private readonly BOSS_HEALTH_BAR_WIDTH = 350;

  constructor(scene: Phaser.Scene, options: HUDManagerOptions) {
    this.scene = scene;
    this.options = options;
    this.hudScale = this.computeHudScaleFactor();
    this.masteryIconEffects = new MasteryIconEffectsManager(scene);
  }

  /**
   * Computes the HUD scale factor based on canvas dimensions.
   * Returns 1.0 on desktop (1280+), scales up on smaller screens (phones/tablets).
   */
  private computeHudScaleFactor(): number {
    return computeHudScale(this.scene.scale.width, this.scene.scale.height, getSettingsManager().getUiScale());
  }

  /** Returns a scaled font size string like '28px'. */
  private scaledFontSize(basePixels: number): string {
    return `${Math.round(basePixels * this.hudScale)}px`;
  }

  /** Returns a dimension scaled by hudScale, rounded to integer. */
  private scaledSize(basePixels: number): number {
    return Math.round(basePixels * this.hudScale);
  }

  /**
   * Creates all HUD elements. Call once after construction.
   */
  create(): void {
    const leftMargin = this.scaledSize(HUD_EDGE_PADDING);
    let currentY = this.scaledSize(HUD_EDGE_PADDING);

    // === TOP LEFT: Level & Stats Panel ===

    // Level display (large)
    this.levelText = this.scene.add.text(leftMargin, currentY, 'Level 1', {
      fontSize: this.scaledFontSize(28),
      color: '#ffdd44',
      fontFamily: 'Arial',
      fontStyle: 'bold',
    });
    this.levelText.setDepth(HUD_DEPTH).setAlpha(HUD_ALPHA);

    // Weapon milestone hint (shown when close to a milestone level)
    this.milestoneHintText = this.scene.add.text(leftMargin, currentY + this.scaledSize(28), '', {
      fontSize: this.scaledFontSize(11),
      color: '#aaaaff',
      fontFamily: 'Arial',
    });
    this.milestoneHintText.setDepth(HUD_DEPTH).setAlpha(0);

    currentY += this.scaledSize(35);

    // HP Bar (above XP bar)
    const hpBarWidth = this.scaledSize(180);
    const hpBarHeight = this.scaledSize(14);

    // HP glow (behind bar)
    this.hpGlowGraphics = this.scene.add.graphics();
    this.hpGlowGraphics.fillStyle(0x44ff44, 0.25);
    this.hpGlowGraphics.fillRoundedRect(
      leftMargin - 4, currentY - 3,
      hpBarWidth + 8, hpBarHeight + 6, 4
    );
    this.hpGlowGraphics.setDepth(HUD_DEPTH - 1);
    this.scene.tweens.add({
      targets: this.hpGlowGraphics,
      alpha: { from: 0.15, to: 0.3 },
      duration: 1500,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut',
    });

    this.hpBarBackground = this.scene.add.rectangle(
      leftMargin + hpBarWidth / 2,
      currentY + hpBarHeight / 2,
      hpBarWidth,
      hpBarHeight,
      0x333333
    );
    this.hpBarBackground.setStrokeStyle(1, 0x666666);
    this.hpBarBackground.setDepth(HUD_DEPTH).setAlpha(HUD_ALPHA);

    this.hpBarFill = this.scene.add.rectangle(
      leftMargin + 1,
      currentY + hpBarHeight / 2,
      hpBarWidth - 2,
      hpBarHeight - 2,
      0x44ff44
    );
    this.hpBarFill.setOrigin(0, 0.5);
    this.hpBarFill.setDepth(HUD_DEPTH).setAlpha(HUD_ALPHA);

    // HP Text overlay
    this.hpText = this.scene.add.text(
      leftMargin + hpBarWidth / 2,
      currentY + hpBarHeight / 2,
      '100/100',
      {
        fontSize: this.scaledFontSize(11),
        color: '#000000',
        fontFamily: 'Arial',
        stroke: '#ffffff',
        strokeThickness: 2,
      }
    );
    this.hpText.setOrigin(0.5);
    this.hpText.setDepth(HUD_DEPTH).setAlpha(HUD_ALPHA);

    // HP label
    this.scene.add.text(leftMargin + hpBarWidth + this.scaledSize(8), currentY + hpBarHeight / 2, 'HP', {
      fontSize: this.scaledFontSize(12),
      color: '#ff6666',
      fontFamily: 'Arial',
    }).setOrigin(0, 0.5).setDepth(HUD_DEPTH).setAlpha(HUD_ALPHA);

    currentY += hpBarHeight + this.scaledSize(HUD_ELEMENT_SPACING);

    // XP Bar (below HP bar)
    const xpBarWidth = this.scaledSize(180);
    const xpBarHeight = this.scaledSize(12);

    // XP glow (behind bar)
    this.xpGlowGraphics = this.scene.add.graphics();
    this.xpGlowGraphics.fillStyle(0x44aaff, 0.2);
    this.xpGlowGraphics.fillRoundedRect(
      leftMargin - 3, currentY - 2,
      xpBarWidth + 6, xpBarHeight + 4, 3
    );
    this.xpGlowGraphics.setDepth(HUD_DEPTH - 1);
    this.scene.tweens.add({
      targets: this.xpGlowGraphics,
      alpha: { from: 0.15, to: 0.3 },
      duration: 1500,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut',
    });

    this.xpBarBackground = this.scene.add.rectangle(
      leftMargin + xpBarWidth / 2,
      currentY + xpBarHeight / 2,
      xpBarWidth,
      xpBarHeight,
      0x333333
    );
    this.xpBarBackground.setStrokeStyle(1, 0x666666);
    this.xpBarBackground.setDepth(HUD_DEPTH).setAlpha(HUD_ALPHA);

    this.xpBarFill = this.scene.add.rectangle(
      leftMargin + 1,
      currentY + xpBarHeight / 2,
      0,
      xpBarHeight - 2,
      0x44ff44
    );
    this.xpBarFill.setOrigin(0, 0.5);
    this.xpBarFill.setDepth(HUD_DEPTH).setAlpha(HUD_ALPHA);

    // XP label
    this.scene.add.text(leftMargin + xpBarWidth + this.scaledSize(8), currentY + xpBarHeight / 2, 'XP', {
      fontSize: this.scaledFontSize(12),
      color: '#44ff44',
      fontFamily: 'Arial',
    }).setOrigin(0, 0.5).setDepth(HUD_DEPTH).setAlpha(HUD_ALPHA);

    currentY += xpBarHeight + this.scaledSize(HUD_ELEMENT_SPACING) * 2;

    // === Upgrade Icons Container ===
    this.upgradeIconsContainer = this.scene.add.container(leftMargin, currentY);
    this.upgradeIconsContainer.setDepth(HUD_DEPTH).setAlpha(HUD_ALPHA);

    // Create upgrade tooltip (hidden by default)
    this.upgradeTooltip = this.scene.add.container(0, 0);
    this.upgradeTooltip.setVisible(false);
    this.upgradeTooltip.setDepth(HUD_DEPTH + 1); // Slightly above other HUD elements

    const tooltipBg = this.scene.add.rectangle(0, 0, this.scaledSize(200), this.scaledSize(76), 0x222244, 0.95);
    tooltipBg.setStrokeStyle(2, 0x4444aa);
    tooltipBg.setOrigin(0, 0);
    tooltipBg.setName('tooltipBg');

    const tooltipTitle = this.scene.add.text(this.scaledSize(10), this.scaledSize(8), '', {
      fontSize: this.scaledFontSize(14),
      color: '#ffffff',
      fontFamily: 'Arial',
      fontStyle: 'bold',
    }).setName('tooltipTitle');

    const tooltipDesc = this.scene.add.text(this.scaledSize(10), this.scaledSize(28), '', {
      fontSize: this.scaledFontSize(11),
      color: '#aaaaaa',
      fontFamily: 'Arial',
    }).setName('tooltipDesc');

    const tooltipLevel = this.scene.add.text(this.scaledSize(10), this.scaledSize(44), '', {
      fontSize: this.scaledFontSize(11),
      color: '#88aaff',
      fontFamily: 'Arial',
    }).setName('tooltipLevel');

    const tooltipEvolution = this.scene.add.text(this.scaledSize(10), this.scaledSize(60), '', {
      fontSize: this.scaledFontSize(10),
      color: '#ffaa44',
      fontFamily: 'Arial',
    }).setName('tooltipEvolution');

    this.upgradeTooltip.add([tooltipBg, tooltipTitle, tooltipDesc, tooltipLevel, tooltipEvolution]);

    // === TOP RIGHT: Pause Button & Game Stats ===

    // Pause button (top right corner) — minimum 44px for touch accessibility
    const scaledPadding = this.scaledSize(HUD_EDGE_PADDING);
    const scaledSpacing = this.scaledSize(HUD_ELEMENT_SPACING);
    const pauseButtonSize = Math.max(this.scaledSize(36), 44);
    const pauseButtonX = this.scene.scale.width - scaledPadding - pauseButtonSize / 2;
    const pauseButtonY = scaledPadding + pauseButtonSize / 2;

    // Stats positioned below the pause button, right-aligned to screen edge
    const statsRightX = this.scene.scale.width - scaledPadding;
    const statsTopY = pauseButtonY + pauseButtonSize / 2 + scaledSpacing;

    // World level display (centered, above timer)
    const worldLevel = this.options.worldLevel;
    this.scene.add.text(this.scene.scale.width / 2, scaledPadding, `World ${worldLevel}`, {
      fontSize: this.scaledFontSize(14),
      color: '#88aaff',
      fontFamily: 'Arial',
    }).setOrigin(0.5, 0).setName('worldLevelText').setDepth(HUD_DEPTH).setAlpha(HUD_ALPHA);

    // Game time display (centered top, below world level)
    const scaledWorldLevelHeight = this.scaledSize(WORLD_LEVEL_TEXT_HEIGHT);
    this.scene.add.text(this.scene.scale.width / 2, scaledPadding + scaledWorldLevelHeight + scaledSpacing, '', {
      fontSize: this.scaledFontSize(28),
      color: '#ffffff',
      fontFamily: 'Arial',
    }).setOrigin(0.5, 0).setName('timerText').setDepth(HUD_DEPTH).setAlpha(HUD_ALPHA);

    // Kill count display (below pause button, right-aligned)
    this.scene.add.text(statsRightX, statsTopY, '', {
      fontSize: this.scaledFontSize(16),
      color: '#88ff88',
      fontFamily: 'Arial',
      backgroundColor: '#00000080',
      padding: { x: this.scaledSize(6), y: this.scaledSize(3) },
    }).setOrigin(1, 0).setName('killCountText').setDepth(HUD_DEPTH).setAlpha(HUD_ALPHA);

    // Gold preview display (below kill count, right-aligned)
    this.scene.add.text(statsRightX, statsTopY + this.scaledSize(24), '', {
      fontSize: this.scaledFontSize(14),
      color: '#ffdd44',
      fontFamily: 'Arial',
      backgroundColor: '#00000080',
      padding: { x: this.scaledSize(6), y: this.scaledSize(2) },
    }).setOrigin(1, 0).setName('goldPreviewText').setDepth(HUD_DEPTH).setAlpha(HUD_ALPHA);

    // Combo counter display (below gold preview, right-aligned)
    this.scene.add.text(statsRightX, statsTopY + this.scaledSize(48), '', {
      fontSize: this.scaledFontSize(18),
      color: '#ffffff',
      fontFamily: 'Arial',
      fontStyle: 'bold',
      stroke: '#000000',
      strokeThickness: this.scaledSize(3),
    }).setOrigin(1, 0).setName('comboText').setDepth(HUD_DEPTH).setAlpha(0);

    // Combo progress bar (thin bar below combo text showing progress to next threshold)
    const comboProgressBar = this.scene.add.graphics();
    comboProgressBar.setName('comboProgressBar');
    comboProgressBar.setDepth(HUD_DEPTH);
    comboProgressBar.setAlpha(0);

    const pauseButtonBg = this.scene.add.rectangle(
      pauseButtonX,
      pauseButtonY,
      pauseButtonSize,
      pauseButtonSize,
      0x333333,
      0.8
    );
    pauseButtonBg.setStrokeStyle(2, 0x666666);
    pauseButtonBg.setInteractive({ useHandCursor: true });
    pauseButtonBg.setName('pauseButtonBg');
    pauseButtonBg.setDepth(HUD_DEPTH).setAlpha(HUD_ALPHA);

    const pauseButtonIcon = this.scene.add.text(pauseButtonX, pauseButtonY, '\u23F8', {
      fontSize: this.scaledFontSize(20),
    });
    pauseButtonIcon.setOrigin(0.5);
    pauseButtonIcon.setName('pauseButtonIcon');
    pauseButtonIcon.setDepth(HUD_DEPTH).setAlpha(HUD_ALPHA);

    // Pause button hover effects
    pauseButtonBg.on('pointerover', () => {
      pauseButtonBg.setFillStyle(0x555555, 0.9);
    });
    pauseButtonBg.on('pointerout', () => {
      pauseButtonBg.setFillStyle(0x333333, 0.8);
    });
    pauseButtonBg.on('pointerdown', () => {
      this.options.onPauseClicked();
    });

    // Controls hint (bottom left)
    this.scene.add.text(scaledPadding, this.scene.scale.height - scaledPadding, 'WASD / Arrows / Mouse to move', {
      fontSize: this.scaledFontSize(14),
      color: '#888888',
      fontFamily: 'Arial',
      backgroundColor: '#00000080',
      padding: { x: this.scaledSize(6), y: this.scaledSize(3) },
    }).setOrigin(0, 1).setDepth(HUD_DEPTH).setAlpha(HUD_ALPHA);

    // BGM info display (bottom left, above controls hint)
    this.createBGMDisplay();
    this.updateBGMDisplay();

    // Auto-buy toggle UI (bottom right, above music controls)
    this.createAutoBuyToggle();

    // FPS counter (bottom right corner, above auto-buy toggle)
    const autoBuyToggleHeight = this.scaledSize(26);
    const fpsY = this.scene.scale.height - scaledPadding - autoBuyToggleHeight - scaledSpacing;
    this.fpsText = this.scene.add.text(this.scene.scale.width - scaledPadding, fpsY, 'FPS: --', {
      fontSize: this.scaledFontSize(14),
      color: '#00ff00',
      fontFamily: 'monospace',
      backgroundColor: '#000000aa',
      padding: { x: this.scaledSize(4), y: this.scaledSize(2) },
    });
    this.fpsText.setOrigin(1, 1);
    this.fpsText.setDepth(HUD_DEPTH).setAlpha(HUD_ALPHA);
    // Set initial visibility based on settings
    this.fpsText.setVisible(getSettingsManager().isFpsCounterEnabled());
  }

  /**
   * Updates all HUD elements each frame.
   */
  update(state: HUDUpdateState): void {
    // Update timer
    const timerText = this.scene.children.getByName('timerText') as Phaser.GameObjects.Text;
    if (timerText) {
      const minutes = Math.floor(state.gameTime / 60);
      const seconds = Math.floor(state.gameTime % 60);
      timerText.setText(`${minutes}:${seconds.toString().padStart(2, '0')}`);

      // Gold timer after victory to indicate "bonus time"
      if (state.hasWon) {
        timerText.setColor('#ffdd44');
      }
    }

    // Update kill count
    const killCountText = this.scene.children.getByName('killCountText') as Phaser.GameObjects.Text;
    if (killCountText) {
      killCountText.setText(`Kills: ${state.killCount}`);
    }

    // Update gold preview - show both death and victory amounts
    const goldPreviewText = this.scene.children.getByName('goldPreviewText') as Phaser.GameObjects.Text;
    if (goldPreviewText) {
      const metaManager = getMetaProgressionManager();
      const deathGold = metaManager.calculateRunGold(
        state.killCount,
        state.gameTime,
        state.playerLevel,
        false
      );
      const victoryGold = metaManager.calculateRunGold(
        state.killCount,
        state.gameTime,
        state.playerLevel,
        true
      );
      goldPreviewText.setText(`Gold: ${deathGold} (win: ${victoryGold})`);
    }

    // Update combo counter display
    const comboText = this.scene.children.getByName('comboText') as Phaser.GameObjects.Text;
    const comboProgressBar = this.scene.children.getByName('comboProgressBar') as Phaser.GameObjects.Graphics;
    if (comboText) {
      if (state.comboCount >= 5) {
        const tierColors: Record<string, string> = {
          none: '#ffffff',
          warm: '#ffdd44',
          hot: '#ffaa00',
          blazing: '#ff6622',
          inferno: '#ff2244',
        };
        const tierHexColors: Record<string, number> = {
          none: 0xffffff,
          warm: 0xffdd44,
          hot: 0xffaa00,
          blazing: 0xff6622,
          inferno: 0xff2244,
        };
        comboText.setText(`x${state.comboCount}`);
        comboText.setColor(tierColors[state.comboTier] || '#ffffff');
        const comboAlpha = Math.max(0.3, state.comboDecayPercent) * HUD_ALPHA;
        comboText.setAlpha(comboAlpha);

        // Draw combo progress bar toward next threshold
        if (comboProgressBar) {
          const nextThreshold = getNextComboThreshold();
          comboProgressBar.clear();
          if (nextThreshold) {
            const barWidth = this.scaledSize(60);
            const barHeight = this.scaledSize(3);
            const barX = comboText.x - barWidth;
            const barY = comboText.y + comboText.height + this.scaledSize(2);

            // Background
            comboProgressBar.fillStyle(0x222233, 0.6);
            comboProgressBar.fillRect(barX, barY, barWidth, barHeight);
            // Fill
            const fillColor = tierHexColors[state.comboTier] || 0xffffff;
            comboProgressBar.fillStyle(fillColor, 0.8);
            comboProgressBar.fillRect(barX, barY, barWidth * nextThreshold.progress, barHeight);
          }
          comboProgressBar.setAlpha(comboAlpha);
        }
      } else {
        comboText.setAlpha(0);
        if (comboProgressBar) {
          comboProgressBar.clear();
          comboProgressBar.setAlpha(0);
        }
      }
    }

    // Update XP bar
    const xpBarMaxWidth = this.scaledSize(180) - 2; // scaled width minus padding
    const xpProgress = state.xp / state.xpToNextLevel;
    this.xpBarFill.width = xpBarMaxWidth * xpProgress;

    // XP shimmer when approaching level-up (>85% full)
    if (xpProgress > 0.85) {
      if (!this.xpShimmerActive) {
        this.xpShimmerActive = true;
        this.scene.tweens.killTweensOf(this.xpGlowGraphics);
        this.scene.tweens.add({
          targets: this.xpGlowGraphics,
          alpha: { from: 0.15, to: 0.6 },
          duration: 300,
          yoyo: true,
          repeat: -1,
          ease: 'Sine.easeInOut',
        });
      }
    } else if (this.xpShimmerActive) {
      this.xpShimmerActive = false;
      this.scene.tweens.killTweensOf(this.xpGlowGraphics);
      this.scene.tweens.add({
        targets: this.xpGlowGraphics,
        alpha: { from: 0.15, to: 0.3 },
        duration: 1500,
        yoyo: true,
        repeat: -1,
        ease: 'Sine.easeInOut',
      });
    }

    // Update level text and weapon milestone hint
    this.levelText.setText(`Level ${state.playerLevel}`);
    const levelsToMilestone = 5 - (state.playerLevel % 5);
    if (levelsToMilestone <= 2 && levelsToMilestone > 0 && state.playerLevel % 5 !== 0) {
      const nextMilestone = state.playerLevel + levelsToMilestone;
      this.milestoneHintText.setText(`Weapon at Lv.${nextMilestone}`);
      this.milestoneHintText.setColor('#aaaaff');
      this.milestoneHintText.setAlpha(HUD_ALPHA * 0.8);
    } else if (state.playerLevel % 5 === 0 && state.playerLevel > 0) {
      this.milestoneHintText.setText('Weapon milestone!');
      this.milestoneHintText.setColor('#ffdd44');
      this.milestoneHintText.setAlpha(HUD_ALPHA);
    } else {
      this.milestoneHintText.setAlpha(0);
    }

    // Update HP bar
    const hpBarMaxWidth = this.scaledSize(180) - 2; // scaled width minus padding
    const hpProgress = Math.max(0, state.currentHP / state.maxHP);
    this.hpBarFill.width = hpBarMaxWidth * hpProgress;

    // Update HP text
    this.hpText.setText(`${Math.ceil(state.currentHP)}/${Math.ceil(state.maxHP)}`);

    // Change HP bar color based on health percentage
    const currentHPThreshold: 'green' | 'yellow' | 'red' =
      hpProgress > 0.5 ? 'green' : hpProgress > 0.25 ? 'yellow' : 'red';

    if (hpProgress > 0.5) {
      this.hpBarFill.setFillStyle(0x44ff44); // Green
    } else if (hpProgress > 0.25) {
      this.hpBarFill.setFillStyle(0xffff44); // Yellow
    } else {
      this.hpBarFill.setFillStyle(0xff4444); // Red
    }

    // Pulse HP glow on threshold change
    if (currentHPThreshold !== this.lastHPThreshold) {
      this.lastHPThreshold = currentHPThreshold;
      const glowColor = currentHPThreshold === 'green' ? 0x44ff44
        : currentHPThreshold === 'yellow' ? 0xffff44
        : 0xff4444;

      // Redraw glow with new color
      const hpGlowWidth = this.scaledSize(180);
      const hpGlowHeight = this.scaledSize(14);
      this.hpGlowGraphics.clear();
      this.hpGlowGraphics.fillStyle(glowColor, 0.25);
      this.hpGlowGraphics.fillRoundedRect(
        this.hpBarBackground.x - hpGlowWidth / 2 - 4,
        this.hpBarBackground.y - hpGlowHeight / 2 - 3,
        hpGlowWidth + 8, hpGlowHeight + 6, 4
      );

      // Flash then resume idle pulse
      this.scene.tweens.killTweensOf(this.hpGlowGraphics);
      this.scene.tweens.add({
        targets: this.hpGlowGraphics,
        alpha: { from: 0.8, to: 0.25 },
        duration: 400,
        ease: 'Power2',
        onComplete: () => {
          this.scene.tweens.add({
            targets: this.hpGlowGraphics,
            alpha: { from: 0.15, to: 0.3 },
            duration: 1500,
            yoyo: true,
            repeat: -1,
            ease: 'Sine.easeInOut',
          });
        },
      });
    }

    // Update boss health bars
    const barMaxWidth = this.scaledSize(this.BOSS_HEALTH_BAR_WIDTH) - 2; // Account for padding
    for (const bossBar of this.activeBossHealthBars) {
      const bossData = state.bossHealthData.find(
        (bossEntry) => bossEntry.entityId === bossBar.entityId
      );
      if (bossData) {
        const bossProgress = Math.max(0, bossData.currentHP / bossData.maxHP);

        // Smooth health bar decrease with lerp
        const targetWidth = barMaxWidth * bossProgress;
        bossBar.barFill.width = Phaser.Math.Linear(bossBar.barFill.width, targetWidth, 0.1);

        // Update health text (pad current HP to match max HP width for alignment)
        const maxHPStr = Math.ceil(bossData.maxHP).toString();
        const currentHPStr = Math.ceil(bossData.currentHP).toString().padStart(maxHPStr.length, ' ');
        bossBar.healthText.setText(`${currentHPStr} / ${maxHPStr}`);
      }
    }

    // Update BGM display
    this.updateBGMDisplay();

    // Update mastery icon effects (HUD glow + particles)
    this.masteryIconEffects.update(state.deltaSeconds);
  }

  /**
   * Updates the upgrade icons display to show current upgrades.
   * Skills have purple-blue backgrounds, weapons have gold backgrounds.
   */
  updateUpgradeIcons(upgrades: UpgradeIconData[]): void {
    // Clear existing icons
    this.upgradeIconsContainer.removeAll(true);

    // Layout constants (scaled for mobile)
    const iconsPerRow = 5;
    const iconSize = this.scaledSize(32);
    const iconSpacing = this.scaledSize(8);

    // Color schemes for different types
    const skillColors = { bg: 0x2a2a5a, stroke: 0x5a5a9a, hover: 0x3a3a7a, badge: '#88aaff' };
    const weaponColors = { bg: 0x4a3a2a, stroke: 0x8a6a4a, hover: 0x5a4a3a, badge: '#ffcc88' };
    const masteryColors = { stroke: 0xffd700, badge: '#ffd700' }; // Gold for mastered icons

    // Track mastered icon positions for visual effects
    const masteredPositions = new Map<string, { x: number; y: number }>();

    // Get container position for calculating screen coordinates
    const containerX = this.upgradeIconsContainer.x;
    const containerY = this.upgradeIconsContainer.y;

    upgrades.forEach((upgrade, index) => {
      const row = Math.floor(index / iconsPerRow);
      const col = index % iconsPerRow;
      const iconX = col * (iconSize + iconSpacing);
      const iconY = row * (iconSize + iconSpacing);

      // Get colors based on type
      const colors = upgrade.type === 'weapon' ? weaponColors : skillColors;
      const isMastered = upgrade.currentLevel >= upgrade.maxLevel;

      // Track mastered icon positions for visual effects
      if (isMastered) {
        masteredPositions.set(upgrade.id, {
          x: containerX + iconX + iconSize / 2,
          y: containerY + iconY + iconSize / 2,
        });
      }

      // Check if this icon should be highlighted (recently acquired)
      const isHighlighted = this.activeIconHighlights.has(upgrade.id);
      let glowRect: Phaser.GameObjects.Rectangle | null = null;

      if (isHighlighted) {
        // Create glow rectangle behind the icon
        glowRect = this.scene.add.rectangle(
          iconX + iconSize / 2,
          iconY + iconSize / 2,
          iconSize + this.scaledSize(8),
          iconSize + this.scaledSize(8),
          0xffdd44,  // Gold glow color
          0.6
        );
        glowRect.setStrokeStyle(3, 0xffffff, 0.8);

        // Pulsing animation
        this.scene.tweens.add({
          targets: glowRect,
          alpha: { from: 0.6, to: 0.2 },
          scaleX: { from: 1.0, to: 1.15 },
          scaleY: { from: 1.0, to: 1.15 },
          duration: 500,
          yoyo: true,
          repeat: -1,
          ease: 'Sine.easeInOut',
        });
      }

      // Icon background with type-specific color
      const iconBg = this.scene.add.rectangle(
        iconX + iconSize / 2,
        iconY + iconSize / 2,
        iconSize,
        iconSize,
        colors.bg
      );
      iconBg.setStrokeStyle(2, isMastered ? masteryColors.stroke : colors.stroke);
      iconBg.setInteractive({ useHandCursor: true });

      // Icon sprite
      const iconSprite = createIcon(this.scene, {
        x: iconX + iconSize / 2,
        y: iconY + iconSize / 2,
        iconKey: upgrade.icon,
        size: this.scaledSize(18),
      });

      // Level indicator badge with dark background for readability
      const badgeX = iconX + iconSize - 2;
      const badgeY = iconY + iconSize - 2;
      const badgeSize = this.scaledSize(14);

      const levelBadgeBg = this.scene.add.rectangle(
        badgeX,
        badgeY,
        badgeSize,
        badgeSize,
        0x000000,
        0.8
      );
      levelBadgeBg.setStrokeStyle(1, 0xffffff, 0.5);

      const levelBadge = this.scene.add.text(
        badgeX,
        badgeY,
        isMastered ? '\u2605' : `${upgrade.currentLevel}`,
        {
          fontSize: isMastered ? this.scaledFontSize(14) : this.scaledFontSize(12),
          color: isMastered ? '#ffd700' : '#ffffff',
          fontFamily: 'Arial',
          fontStyle: 'bold',
          stroke: '#000000',
          strokeThickness: 2,
        }
      );
      levelBadge.setOrigin(0.5, 0.5);

      // Hover events with type-specific highlight
      iconBg.on('pointerover', () => {
        iconBg.setFillStyle(colors.hover);
        this.showUpgradeTooltip(upgrade, iconX, iconY + iconSize + this.scaledSize(10));
      });

      iconBg.on('pointerout', () => {
        iconBg.setFillStyle(colors.bg);
        this.upgradeTooltip.setVisible(false);
      });

      // Add to container - glow first (behind), then icon elements
      const elementsToAdd: Phaser.GameObjects.GameObject[] = [];
      if (glowRect) elementsToAdd.push(glowRect);
      elementsToAdd.push(iconBg, iconSprite, levelBadgeBg, levelBadge);
      this.upgradeIconsContainer.add(elementsToAdd);
    });

    // Update mastery icon effects with new positions
    this.masteryIconEffects.updateMasteredIcons(masteredPositions);
  }

  /**
   * Highlights an upgrade icon for 5 seconds (visual feedback for acquired upgrades).
   */
  highlightUpgradeIcon(upgradeId: string, gameTime: number): void {
    // Set expiration time (5 seconds from now)
    this.activeIconHighlights.set(upgradeId, gameTime + 5.0);
  }

  /**
   * Checks for expired icon highlights and returns true if any were removed.
   */
  expireHighlights(gameTime: number): boolean {
    let highlightsExpired = false;
    for (const [upgradeId, expiresAt] of this.activeIconHighlights) {
      if (gameTime >= expiresAt) {
        this.activeIconHighlights.delete(upgradeId);
        highlightsExpired = true;
      }
    }
    return highlightsExpired;
  }

  /**
   * Returns the entity IDs of all active boss health bars.
   */
  getBossEntityIds(): number[] {
    return this.activeBossHealthBars.map(bar => bar.entityId);
  }

  /**
   * Creates a boss health bar UI element for a miniboss or boss.
   * The bar includes a pulsing glow effect and displays name + health.
   */
  createBossHealthBar(entityId: number, name: string, isFinalBoss: boolean): BossHealthBar {
    const centerX = this.scene.scale.width / 2;
    const barWidth = this.scaledSize(this.BOSS_HEALTH_BAR_WIDTH);
    const barHeight = this.scaledSize(15);
    const barTopOffset = this.scaledSize(20);

    // Colors based on boss type
    const fillColor = isFinalBoss ? 0x990066 : 0xcc0000;
    const glowColor = isFinalBoss ? 0xcc00aa : 0xff4444;

    // Create container to hold all bar elements
    const container = this.scene.add.container(centerX, 0);
    container.setDepth(HUD_DEPTH).setAlpha(HUD_ALPHA);

    // Glow graphics (pulsing effect behind bar)
    const glowGraphics = this.scene.add.graphics();
    glowGraphics.fillStyle(glowColor, 0.3);
    glowGraphics.fillRoundedRect(-barWidth / 2 - 6, barTopOffset - 4, barWidth + 12, barHeight + 8, 6);
    container.add(glowGraphics);

    // Name text with decorative elements
    const nameText = this.scene.add.text(0, 0, `\u2550\u2550\u2550 ${name.toUpperCase()} \u2550\u2550\u2550`, {
      fontSize: this.scaledFontSize(14),
      color: isFinalBoss ? '#ff66cc' : '#ff6666',
      fontFamily: 'Arial',
      fontStyle: 'bold',
      stroke: '#000000',
      strokeThickness: this.scaledSize(3),
    });
    nameText.setOrigin(0.5, 0);
    container.add(nameText);

    // Bar background
    const barBackground = this.scene.add.rectangle(0, barTopOffset + barHeight / 2, barWidth, barHeight, 0x222222);
    barBackground.setStrokeStyle(1, 0x444444);
    container.add(barBackground);

    // Bar fill (starts at full width)
    const barFill = this.scene.add.rectangle(
      -barWidth / 2 + barWidth / 2,
      barTopOffset + barHeight / 2,
      barWidth,
      barHeight - 2,
      fillColor
    );
    barFill.setOrigin(0, 0.5);
    barFill.x = -barWidth / 2 + 1;
    container.add(barFill);

    // Health text (vertically centered in bar)
    const healthText = this.scene.add.text(0, barTopOffset + barHeight / 2, '', {
      fontSize: this.scaledFontSize(11),
      color: '#ffffff',
      fontFamily: 'Arial',
      fontStyle: 'bold',
      stroke: '#000000',
      strokeThickness: 2,
    });
    healthText.setOrigin(0.5, 0.5);
    container.add(healthText);

    // Start pulsing glow tween (pronounced effect)
    this.scene.tweens.add({
      targets: glowGraphics,
      alpha: { from: 0.15, to: 0.9 },
      duration: 700,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut',
    });

    const bossBar: BossHealthBar = {
      entityId,
      name,
      isFinalBoss,
      container,
      nameText,
      barBackground,
      barFill,
      healthText,
      glowGraphics,
    };

    this.activeBossHealthBars.push(bossBar);

    return bossBar;
  }

  /**
   * Removes a boss health bar when the boss dies.
   */
  removeBossHealthBar(entityId: number): void {
    const index = this.activeBossHealthBars.findIndex(bar => bar.entityId === entityId);
    if (index === -1) return;

    const bar = this.activeBossHealthBars[index];

    // Stop any tweens on the glow
    this.scene.tweens.killTweensOf(bar.glowGraphics);

    // Fade out and destroy
    this.scene.tweens.add({
      targets: bar.container,
      alpha: 0,
      duration: 300,
      ease: 'Power2',
      onComplete: () => {
        bar.container.destroy();
      },
    });

    // Remove from array immediately so repositioning works
    this.activeBossHealthBars.splice(index, 1);

    // Reposition remaining bars
    this.repositionBossHealthBars();
  }

  /**
   * Repositions all boss health bars vertically (stacking).
   */
  repositionBossHealthBars(): void {
    for (let barIndex = 0; barIndex < this.activeBossHealthBars.length; barIndex++) {
      const bar = this.activeBossHealthBars[barIndex];
      const targetY = this.scaledSize(this.BOSS_HEALTH_BAR_START_Y) + barIndex * this.scaledSize(this.BOSS_HEALTH_BAR_HEIGHT);

      // Animate to new position
      this.scene.tweens.add({
        targets: bar.container,
        y: targetY,
        duration: 200,
        ease: 'Power2',
      });
    }
  }

  /**
   * Creates the persistent event duration indicator in the bottom-right corner.
   */
  createEventIndicator(event: RunEvent): void {
    this.destroyEventIndicator();

    const panelWidth = this.scaledSize(180);
    const panelHeight = this.scaledSize(48);
    const barWidth = panelWidth - this.scaledSize(16);
    const colorHex = `#${event.color.toString(16).padStart(6, '0')}`;

    // Position above FPS counter and auto-buy toggle in bottom-right
    const scaledPadding = this.scaledSize(HUD_EDGE_PADDING);
    const panelX = this.scene.scale.width - scaledPadding - panelWidth / 2;
    const panelY = this.scene.scale.height - scaledPadding - this.scaledSize(70) - panelHeight / 2;

    this.eventIndicatorContainer = this.scene.add.container(panelX, panelY);
    this.eventIndicatorContainer.setDepth(HUD_DEPTH);
    this.eventIndicatorContainer.setAlpha(0);

    // Dark background
    const background = this.scene.add.rectangle(0, 0, panelWidth, panelHeight, 0x1a1a2e, 0.9);
    background.setStrokeStyle(1, event.color);
    this.eventIndicatorContainer.add(background);

    // Event name
    const nameText = this.scene.add.text(0, this.scaledSize(-12), event.name, {
      fontSize: this.scaledFontSize(12),
      fontFamily: 'Arial',
      color: colorHex,
      fontStyle: 'bold',
    }).setOrigin(0.5);
    this.eventIndicatorContainer.add(nameText);

    // Event description
    const descriptionText = this.scene.add.text(0, this.scaledSize(2), event.description, {
      fontSize: this.scaledFontSize(10),
      fontFamily: 'Arial',
      color: '#aaaaaa',
    }).setOrigin(0.5);
    this.eventIndicatorContainer.add(descriptionText);

    // Progress bar background
    const barY = this.scaledSize(16);
    const barHeight = this.scaledSize(4);
    const barBackground = this.scene.add.rectangle(0, barY, barWidth, barHeight, 0x333355);
    this.eventIndicatorContainer.add(barBackground);

    // Progress bar fill
    this.eventIndicatorBarFill = this.scene.add.rectangle(
      -barWidth / 2, barY, barWidth, barHeight, event.color
    );
    this.eventIndicatorBarFill.setOrigin(0, 0.5);
    this.eventIndicatorContainer.add(this.eventIndicatorBarFill);

    // Time remaining text
    this.eventIndicatorTimeText = this.scene.add.text(
      barWidth / 2, barY, `${event.duration.toFixed(1)}s`,
      { fontSize: this.scaledFontSize(9), fontFamily: 'monospace', color: '#888888' }
    ).setOrigin(1, 0.5);
    this.eventIndicatorContainer.add(this.eventIndicatorTimeText);

    this.eventIndicatorTotalDuration = event.duration;

    // Fade in
    this.scene.tweens.add({
      targets: this.eventIndicatorContainer,
      alpha: 1,
      duration: 200,
      ease: 'Sine.easeOut',
    });
  }

  /**
   * Updates the event indicator each frame -- adjusts progress bar and time text.
   */
  updateEventIndicator(_activeEvent: RunEvent | null): void {
    if (!this.eventIndicatorContainer) return;

    const activeEventState = getActiveEvent();
    if (!activeEventState) {
      // Event ended -- fade out and destroy
      const containerToDestroy = this.eventIndicatorContainer;
      this.eventIndicatorContainer = null;
      this.scene.tweens.add({
        targets: containerToDestroy,
        alpha: 0,
        duration: 200,
        ease: 'Sine.easeIn',
        onComplete: () => containerToDestroy.destroy(),
      });
      this.eventIndicatorBarFill = null;
      this.eventIndicatorTimeText = null;
      return;
    }

    const remainingTime = activeEventState.remainingTime;
    const barWidth = 180 - 16; // panelWidth - padding
    const fillWidth = Math.max(0, (remainingTime / this.eventIndicatorTotalDuration) * barWidth);

    if (this.eventIndicatorBarFill) {
      this.eventIndicatorBarFill.width = fillWidth;
    }
    if (this.eventIndicatorTimeText) {
      this.eventIndicatorTimeText.setText(`${remainingTime.toFixed(1)}s`);
    }
  }

  /**
   * Destroys the event indicator and nulls references.
   */
  destroyEventIndicator(): void {
    if (this.eventIndicatorContainer) {
      this.eventIndicatorContainer.destroy();
      this.eventIndicatorContainer = null;
      this.eventIndicatorBarFill = null;
      this.eventIndicatorTimeText = null;
    }
  }

  /**
   * Sets the auto-buy enabled state and updates the visual.
   */
  setAutoBuyEnabled(enabled: boolean): void {
    this.isAutoBuyEnabled = enabled;
    this.updateAutoBuyToggleVisual();
  }

  /**
   * Returns whether auto-buy is currently active.
   */
  isAutoBuyActive(): boolean {
    return this.isAutoBuyEnabled;
  }

  /**
   * Handles screen resize events. Repositions all HUD elements anchored to screen edges or center.
   */
  handleResize(width: number, height: number): void {
    // Recompute HUD scale for new dimensions
    this.hudScale = this.computeHudScaleFactor();
    const scaledPadding = this.scaledSize(HUD_EDGE_PADDING);
    const scaledSpacing = this.scaledSize(HUD_ELEMENT_SPACING);

    // --- Top-center elements ---
    const worldLevelText = this.scene.children.getByName('worldLevelText') as Phaser.GameObjects.Text;
    if (worldLevelText) worldLevelText.setX(width / 2);

    const timerText = this.scene.children.getByName('timerText') as Phaser.GameObjects.Text;
    if (timerText) timerText.setX(width / 2);

    // --- Top-right elements ---
    const pauseButtonSize = Math.max(this.scaledSize(36), 44);
    const pauseButtonX = width - scaledPadding - pauseButtonSize / 2;
    const pauseButtonY = scaledPadding + pauseButtonSize / 2;

    const pauseBg = this.scene.children.getByName('pauseButtonBg') as Phaser.GameObjects.Rectangle;
    if (pauseBg) pauseBg.setPosition(pauseButtonX, pauseButtonY);

    const pauseIcon = this.scene.children.getByName('pauseButtonIcon') as Phaser.GameObjects.Text;
    if (pauseIcon) pauseIcon.setPosition(pauseButtonX, pauseButtonY);

    const statsRightX = width - scaledPadding;

    const killCountText = this.scene.children.getByName('killCountText') as Phaser.GameObjects.Text;
    if (killCountText) killCountText.setX(statsRightX);

    const goldPreviewText = this.scene.children.getByName('goldPreviewText') as Phaser.GameObjects.Text;
    if (goldPreviewText) goldPreviewText.setX(statsRightX);

    // --- Bottom-left elements ---
    const controlsHint = this.scene.children.getAll().find(
      (child) => child instanceof Phaser.GameObjects.Text && (child as Phaser.GameObjects.Text).text?.includes('WASD')
    ) as Phaser.GameObjects.Text;
    if (controlsHint) controlsHint.setY(height - scaledPadding);

    // BGM container
    if (this.bgmContainer) {
      const controlsHintHeight = this.scaledSize(18);
      const bgmRowHeight = this.scaledSize(14);
      const bottomY = height - scaledPadding - controlsHintHeight - scaledSpacing * 2 - bgmRowHeight;
      this.bgmContainer.setY(bottomY);
    }

    // --- Bottom-right elements ---
    if (this.fpsText) {
      const autoBuyToggleHeight = this.scaledSize(26);
      const fpsY = height - scaledPadding - autoBuyToggleHeight - scaledSpacing;
      this.fpsText.setPosition(width - scaledPadding, fpsY);
    }

    if (this.autoBuyToggleBg && this.autoBuyToggleText) {
      const toggleWidth = this.scaledSize(190);
      const toggleHeight = this.scaledSize(26);
      const toggleX = width - scaledPadding - toggleWidth / 2;
      const toggleY = height - scaledPadding - toggleHeight / 2;
      this.autoBuyToggleBg.setPosition(toggleX, toggleY);
      this.autoBuyToggleText.setPosition(toggleX, toggleY);
    }

    // --- Boss health bars ---
    if (this.activeBossHealthBars) {
      const centerX = width / 2;
      for (const bar of this.activeBossHealthBars) {
        if (bar.container) {
          bar.container.setX(centerX);
        }
      }
    }
  }

  /**
   * Updates FPS counter display and visual quality auto-scaling.
   * Returns the new quality level if it changed, or null if unchanged.
   */
  updateFPS(delta: number): VisualQuality | null {
    // Calculate current FPS
    const fps = 1000 / delta;

    // Update FPS counter display and visibility
    if (this.fpsText) {
      const fpsEnabled = getSettingsManager().isFpsCounterEnabled();
      this.fpsText.setVisible(fpsEnabled);
      if (fpsEnabled) {
        this.fpsText.setText(`FPS: ${Math.round(fps)}`);
      }
    }

    // Add to history
    this.fpsHistory.push(fps);
    if (this.fpsHistory.length > this.FPS_HISTORY_SIZE) {
      this.fpsHistory.shift();
    }

    // Only adjust after we have enough samples
    if (this.fpsHistory.length < this.FPS_HISTORY_SIZE) return null;

    // Calculate average FPS
    const avgFps = this.fpsHistory.reduce((a, b) => a + b, 0) / this.fpsHistory.length;

    // Determine quality level based on FPS thresholds
    let newQuality: VisualQuality = this.visualQuality;

    if (avgFps < 40) {
      newQuality = 'low';
    } else if (avgFps < 50) {
      newQuality = 'medium';
    } else if (avgFps > 55) {
      newQuality = 'high';
    }

    // Only report change if quality actually changed
    if (newQuality !== this.visualQuality) {
      this.visualQuality = newQuality;
      return newQuality;
    }

    return null;
  }

  /**
   * Destroys all HUD game objects and cleans up resources.
   */
  destroy(): void {
    // Destroy HUD bar glow tweens
    this.scene.tweens.killTweensOf(this.hpGlowGraphics);
    this.scene.tweens.killTweensOf(this.xpGlowGraphics);

    // Destroy event indicator
    this.destroyEventIndicator();

    // Destroy mastery icon effects
    if (this.masteryIconEffects) {
      this.masteryIconEffects.destroy();
    }

    // Destroy boss health bars
    for (const bar of this.activeBossHealthBars) {
      this.scene.tweens.killTweensOf(bar.glowGraphics);
      bar.container.destroy();
    }
    this.activeBossHealthBars = [];

    // Destroy upgrade tooltip
    if (this.upgradeTooltip) {
      this.upgradeTooltip.destroy();
    }

    // Destroy upgrade icons container
    if (this.upgradeIconsContainer) {
      this.upgradeIconsContainer.destroy();
    }

    // Destroy BGM container
    if (this.bgmContainer) {
      this.bgmContainer.destroy();
    }

    // Destroy FPS text
    if (this.fpsText) {
      this.fpsText.destroy();
      this.fpsText = null;
    }

    // Destroy auto-buy toggle elements
    if (this.autoBuyToggleBg) {
      this.autoBuyToggleBg.destroy();
      this.autoBuyToggleBg = null;
    }
    if (this.autoBuyToggleText) {
      this.autoBuyToggleText.destroy();
      this.autoBuyToggleText = null;
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Private methods
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Creates the auto-buy toggle UI with clickable button.
   * Position: Bottom-right corner, matching the game's bracket-style UI.
   * Only shown if auto-upgrade is purchased from the shop.
   */
  private createAutoBuyToggle(): void {
    // Only show toggle if auto-upgrade is purchased (level >= 1)
    const autoUpgradeLevel = getMetaProgressionManager().getAutoUpgradeLevel();
    if (autoUpgradeLevel < 1) {
      return; // Toggle hidden until purchased
    }

    // Load saved auto-buy preference from secure storage
    const savedAutoBuy = SecureStorage.getItem(STORAGE_KEY_AUTO_BUY);
    if (savedAutoBuy !== null) {
      this.isAutoBuyEnabled = savedAutoBuy === 'true';
    }

    const toggleWidth = this.scaledSize(190);
    const toggleHeight = this.scaledSize(26);
    const scaledPadding = this.scaledSize(HUD_EDGE_PADDING);
    // Position with right edge at scaled padding from screen edge
    const toggleX = this.scene.scale.width - scaledPadding - toggleWidth / 2;
    // Position with bottom edge at scaled padding from screen edge
    const toggleY = this.scene.scale.height - scaledPadding - toggleHeight / 2;

    // Background rectangle for the toggle button
    this.autoBuyToggleBg = this.scene.add.rectangle(
      toggleX,
      toggleY,
      toggleWidth,
      toggleHeight,
      0x2a2a4a
    );
    this.autoBuyToggleBg.setStrokeStyle(2, 0x4a4a7a);
    this.autoBuyToggleBg.setInteractive({ useHandCursor: true });
    this.autoBuyToggleBg.setName('autoBuyToggleBg');
    this.autoBuyToggleBg.setDepth(HUD_DEPTH).setAlpha(HUD_ALPHA);

    // Toggle text with bracket format matching existing UI
    this.autoBuyToggleText = this.scene.add.text(
      toggleX,
      toggleY,
      '[ AUTO-UPGRADE: OFF ]',
      {
        fontSize: this.scaledFontSize(14),
        fontFamily: 'Arial',
        color: '#888888',
      }
    );
    this.autoBuyToggleText.setOrigin(0.5);
    this.autoBuyToggleText.setName('autoBuyToggleText');
    this.autoBuyToggleText.setDepth(HUD_DEPTH).setAlpha(HUD_ALPHA);

    // Click handler
    this.autoBuyToggleBg.on('pointerdown', () => {
      this.options.onAutoBuyToggled();
    });

    // Hover effects
    this.autoBuyToggleBg.on('pointerover', () => {
      this.autoBuyToggleBg?.setFillStyle(0x3a3a6a);
    });
    this.autoBuyToggleBg.on('pointerout', () => {
      this.autoBuyToggleBg?.setFillStyle(0x2a2a4a);
    });

    // Update visual state based on initial setting
    this.updateAutoBuyToggleVisual();
  }

  /**
   * Updates the auto-buy toggle visual state based on current setting.
   * Shows tier level when enabled (T2, T3, T4) for purchased intelligence upgrades.
   */
  private updateAutoBuyToggleVisual(): void {
    if (!this.autoBuyToggleText) return;

    const autoUpgradeLevel = getMetaProgressionManager().getAutoUpgradeLevel();

    if (this.isAutoBuyEnabled) {
      // Show tier indicator if level > 1 (has intelligence upgrades)
      const tierText = autoUpgradeLevel > 1 ? ` T${autoUpgradeLevel}` : '';
      this.autoBuyToggleText.setText(`[ AUTO${tierText}: ON ]`);
      this.autoBuyToggleText.setColor('#ffdd44'); // Gold for active
      this.autoBuyToggleBg?.setStrokeStyle(2, 0xffdd44);
    } else {
      this.autoBuyToggleText.setText('[ AUTO-UPGRADE: OFF ]');
      this.autoBuyToggleText.setColor('#888888'); // Gray for inactive
      this.autoBuyToggleBg?.setStrokeStyle(2, 0x4a4a7a);
    }
  }

  /**
   * Creates the BGM info display with track info, mute, and skip controls.
   */
  private createBGMDisplay(): void {
    // Position BGM row above controls hint with consistent spacing
    const scaledPadding = this.scaledSize(HUD_EDGE_PADDING);
    const scaledSpacing = this.scaledSize(HUD_ELEMENT_SPACING);
    const controlsHintHeight = this.scaledSize(18);
    const bgmIconSize = this.scaledSize(14);
    const bottomY = this.scene.scale.height - scaledPadding - controlsHintHeight - scaledSpacing * 2 - bgmIconSize;

    // Container for all BGM elements
    this.bgmContainer = this.scene.add.container(scaledPadding, bottomY);
    this.bgmContainer.setDepth(HUD_DEPTH).setAlpha(HUD_ALPHA);

    const bgmIconScale = bgmIconSize / 64; // icon atlas is 64px

    // Mute button (sprite) - first element (always shows volume icon)
    this.bgmMuteButton = createIcon(this.scene, {
      x: this.scaledSize(7),
      y: this.scaledSize(7),
      iconKey: 'volume',
      size: bgmIconSize,
    });
    this.bgmMuteButton.setInteractive({ useHandCursor: true });
    this.bgmMuteButton.on('pointerover', () => {
      this.bgmMuteButton.setScale(this.bgmMuteButton.scaleX * 1.2);
    });
    this.bgmMuteButton.on('pointerout', () => {
      this.bgmMuteButton.setScale(bgmIconScale);
    });
    this.bgmMuteButton.on('pointerdown', () => {
      this.toggleBGMMute();
    });

    // Strikethrough line for muted state (diagonal from top-right to bottom-left)
    this.bgmMuteStrike = this.scene.add.graphics();
    this.bgmMuteStrike.lineStyle(2, 0xff4444, 1);
    this.bgmMuteStrike.lineBetween(bgmIconSize, 0, 0, bgmIconSize);
    this.bgmMuteStrike.setVisible(false);

    // Skip button (sprite) - after mute
    const skipButton = createIcon(this.scene, {
      x: this.scaledSize(25),
      y: this.scaledSize(7),
      iconKey: 'forward',
      size: bgmIconSize,
    });
    skipButton.setInteractive({ useHandCursor: true });
    skipButton.on('pointerover', () => {
      skipButton.setScale(skipButton.scaleX * 1.2);
    });
    skipButton.on('pointerout', () => {
      skipButton.setScale(bgmIconScale);
    });
    skipButton.on('pointerdown', () => {
      this.skipToNextTrack();
    });

    // Music note icon (sprite) - after controls with small gap
    const musicIcon = createIcon(this.scene, {
      x: this.scaledSize(50),
      y: this.scaledSize(7),
      iconKey: 'music',
      size: bgmIconSize,
      tint: 0x8888aa,
    });

    // Track info text - after music icon
    this.bgmTrackText = this.scene.add.text(this.scaledSize(65), 0, 'Loading...', {
      fontSize: this.scaledFontSize(12),
      color: '#8888aa',
      fontFamily: 'Arial',
      backgroundColor: '#00000080',
      padding: { x: this.scaledSize(4), y: this.scaledSize(2) },
    });

    this.bgmContainer.add([this.bgmMuteButton, this.bgmMuteStrike, skipButton, musicIcon, this.bgmTrackText]);
  }

  /**
   * Toggles BGM mute state.
   */
  private toggleBGMMute(): void {
    const musicManager = getMusicManager();
    const currentMode = musicManager.getPlaybackMode();

    if (currentMode === 'off') {
      // Unmute - restore to sequential
      musicManager.setPlaybackMode('sequential');
      musicManager.play();
      this.bgmMuteStrike.setVisible(false);
    } else {
      // Mute
      musicManager.setPlaybackMode('off');
      this.bgmMuteStrike.setVisible(true);
    }
  }

  /**
   * Skips to the next track in the playlist.
   */
  private skipToNextTrack(): void {
    const musicManager = getMusicManager();
    if (musicManager.getPlaybackMode() !== 'off') {
      musicManager.nextTrack();
    }
  }

  /**
   * Updates the BGM display with current track info and button states.
   */
  private updateBGMDisplay(): void {
    const musicManager = getMusicManager();
    const currentTrack = musicManager.getCurrentTrack();
    const isPlaying = musicManager.getPlaybackMode() !== 'off';

    // Update track text only when track changes (avoid unnecessary updates)
    if (currentTrack) {
      const trackId = currentTrack.id;
      if (trackId !== this.lastTrackId) {
        this.lastTrackId = trackId;
        // Truncate long names to fit the display
        const displayText = currentTrack.title;
        const truncatedText = displayText.length > 24
          ? displayText.substring(0, 22) + '...'
          : displayText;
        this.bgmTrackText.setText(truncatedText);
      }
    } else if (!isPlaying) {
      this.bgmTrackText.setText('Music Off');
      this.lastTrackId = '';
    } else {
      // Music is enabled but no track available (empty playlist)
      this.bgmTrackText.setText('No Tracks');
      this.lastTrackId = '';
    }

    // Sync mute button state (show/hide strikethrough line)
    this.bgmMuteStrike.setVisible(!isPlaying);
  }

  /**
   * Shows tooltip for an upgrade.
   */
  private showUpgradeTooltip(
    upgrade: UpgradeIconData,
    offsetX: number,
    offsetY: number
  ): void {
    const containerPos = this.upgradeIconsContainer.getBounds();

    this.upgradeTooltip.setPosition(
      containerPos.x + offsetX,
      containerPos.y + offsetY
    );

    const titleText = this.upgradeTooltip.getByName('tooltipTitle') as Phaser.GameObjects.Text;
    const descText = this.upgradeTooltip.getByName('tooltipDesc') as Phaser.GameObjects.Text;
    const levelText = this.upgradeTooltip.getByName('tooltipLevel') as Phaser.GameObjects.Text;
    const evolutionText = this.upgradeTooltip.getByName('tooltipEvolution') as Phaser.GameObjects.Text;
    const tooltipBg = this.upgradeTooltip.getByName('tooltipBg') as Phaser.GameObjects.Rectangle;

    if (titleText) titleText.setText(upgrade.name);
    if (descText) descText.setText(upgrade.description);
    const isMastered = upgrade.currentLevel >= upgrade.maxLevel;
    if (levelText) levelText.setText(isMastered ? '\u2605 MASTERED' : `Level ${upgrade.currentLevel}/${upgrade.maxLevel}`);

    // Show evolution info for weapons
    if (evolutionText) {
      const evoInfo = upgrade.evolutionInfo;
      if (evoInfo) {
        if (evoInfo.isEvolved) {
          evolutionText.setText(`Evolved: ${evoInfo.evolvedName}`);
          evolutionText.setColor('#ffdd44');
        } else {
          const weaponMet = upgrade.currentLevel >= evoInfo.requiredWeaponLevel;
          const statMet = evoInfo.currentStatLevel >= evoInfo.requiredStatLevel;
          const wpnStatus = weaponMet ? '\u2713' : `${upgrade.currentLevel}/${evoInfo.requiredWeaponLevel}`;
          const statStatus = statMet ? '\u2713' : `${evoInfo.currentStatLevel}/${evoInfo.requiredStatLevel}`;
          evolutionText.setText(`Evolve: Wpn ${wpnStatus} + ${evoInfo.requiredStatName} ${statStatus}`);
          evolutionText.setColor(weaponMet && statMet ? '#88ff88' : '#ffaa44');
        }
        // Expand tooltip to fit evolution text
        if (tooltipBg) tooltipBg.setSize(this.scaledSize(200), this.scaledSize(76));
      } else {
        evolutionText.setText('');
        // Shrink tooltip when no evolution info
        if (tooltipBg) tooltipBg.setSize(this.scaledSize(200), this.scaledSize(60));
      }
    }

    this.upgradeTooltip.setVisible(true);
  }
}
