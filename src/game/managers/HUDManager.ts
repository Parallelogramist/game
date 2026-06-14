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
import { TouchActionButtons } from '../../ui/TouchActionButtons';
import { Relic, getRelicRarityColor } from '../../data/Relics';
import { RunModifier } from '../../data/RunModifiers';
import { ACCENT_COLORS, ACCENT_COLORS_STR, BODY_COLORS } from '../../visual/MenuStyle';

/**
 * Draws a Balatro-style HUD panel into the supplied Graphics object: drop
 * shadow + accent ink border + dark body + thin top highlight stripe. Same
 * visual language as `MenuCard` but cheap (single redraw per refresh, no
 * tweens), so per-frame HUD widgets can adopt the menu look without paying
 * MenuCard's hover/wisp overhead.
 */
function paintHudPanel(
  graphics: Phaser.GameObjects.Graphics,
  centerX: number,
  centerY: number,
  width: number,
  height: number,
  bodyColor: number,
  accentColor: number,
  cornerRadius: number = 10,
  alpha: number = 1,
): void {
  graphics.clear();
  const halfW = width / 2;
  const halfH = height / 2;
  // Drop shadow.
  graphics.fillStyle(0x000000, 0.45 * alpha);
  graphics.fillRoundedRect(centerX - halfW + 3, centerY - halfH + 4, width, height, cornerRadius + 1);
  // Accent border.
  graphics.fillStyle(accentColor, alpha);
  graphics.fillRoundedRect(centerX - halfW - 2, centerY - halfH - 2, width + 4, height + 4, cornerRadius);
  // Body fill.
  graphics.fillStyle(bodyColor, alpha);
  graphics.fillRoundedRect(centerX - halfW, centerY - halfH, width, height, cornerRadius);
  // Top highlight stripe.
  graphics.fillStyle(accentColor, 0.65 * alpha);
  graphics.fillRect(centerX - halfW + 4, centerY - halfH + 2, width - 8, 2);
  // Bottom inner shadow.
  graphics.fillStyle(0x000000, 0.22 * alpha);
  graphics.fillRect(centerX - halfW + 4, centerY + halfH - 3, width - 8, 2);
}

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
  lastHP: number;
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
  comboBuffActive: boolean;
  comboBuffPercent: number;
  ultimateChargeRatio: number;
  ultimateReady: boolean;
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

// Module-level constants to avoid per-frame allocation
const TIER_COLORS: Record<string, string> = {
  none: '#ffffff',
  warm: '#ffdd44',
  hot: '#ffaa00',
  blazing: '#ff6622',
  inferno: '#ff2244',
};
const TIER_HEX_COLORS: Record<string, number> = {
  none: 0xffffff,
  warm: 0xffdd44,
  hot: 0xffaa00,
  blazing: 0xff6622,
  inferno: 0xff2244,
};
const TIER_FONT_SIZES: Record<string, number> = {
  none: 18, warm: 20, hot: 24, blazing: 30, inferno: 38,
};
type HPThreshold = 'green' | 'yellow' | 'red';
const HP_THRESHOLD_COLORS: Record<HPThreshold, number> = {
  green: 0x44ff44,
  yellow: 0xffff44,
  red: 0xff4444,
};
const getHPThreshold = (progress: number): HPThreshold =>
  progress > 0.5 ? 'green' : progress > 0.25 ? 'yellow' : 'red';

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
  private lastHPThreshold: HPThreshold = 'green';
  private lastPlayerHP: number = -1;

  // Ultimate ("Overdrive") charge meter — below the XP bar.
  private ultBarBackground: Phaser.GameObjects.Rectangle | null = null;
  private ultBarFill: Phaser.GameObjects.Rectangle | null = null;
  private ultBarGlow: Phaser.GameObjects.Graphics | null = null;
  private ultLabel: Phaser.GameObjects.Text | null = null;
  private ultBarWidth: number = 0;
  private wasUltimateReady: boolean = false;

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
  private fpsHistory: Float32Array = new Float32Array(60);
  private fpsHistoryIndex: number = 0;
  private fpsHistorySamples: number = 0;
  private readonly FPS_HISTORY_SIZE = 60;
  private qualityUpgradeTimer: number = 0;
  private readonly QUALITY_UPGRADE_DELAY = 5.0; // seconds of sustained good FPS before upgrading

  // Auto-buy toggle
  private autoBuyToggleText: Phaser.GameObjects.Text | null = null;
  private autoBuyToggleBg: Phaser.GameObjects.Rectangle | null = null;
  private isAutoBuyEnabled: boolean = false;

  // Touch action buttons (dash + fullscreen)
  private touchActionButtons: TouchActionButtons | null = null;

  // Event indicator
  private eventIndicatorContainer: Phaser.GameObjects.Container | null = null;
  private eventIndicatorBarFill: Phaser.GameObjects.Rectangle | null = null;
  private eventIndicatorTimeText: Phaser.GameObjects.Text | null = null;
  private eventIndicatorTotalDuration: number = 0;

  // Relic/modifier strip — persistent icon row for active run modifiers and
  // equipped relics. Tooltip shows on hover/tap. Rebuilt on pickup.
  private relicStripContainer: Phaser.GameObjects.Container | null = null;
  private relicStripTooltip: Phaser.GameObjects.Container | null = null;
  private relicStripTooltipBg: Phaser.GameObjects.Rectangle | null = null;
  private relicStripTooltipTitle: Phaser.GameObjects.Text | null = null;
  private relicStripTooltipDesc: Phaser.GameObjects.Text | null = null;

  // Visual quality (auto-scales based on FPS)
  private visualQuality: VisualQuality = 'high';

  // Combo feedback state
  private previousComboCount: number = 0;
  private previousComboTier: string = '';
  private comboBuffText: Phaser.GameObjects.Text | null = null;

  // Cached text references (avoid getByName() O(n) scan per frame)
  private timerTextRef: Phaser.GameObjects.Text | null = null;
  private killCountTextRef: Phaser.GameObjects.Text | null = null;
  private goldPreviewTextRef: Phaser.GameObjects.Text | null = null;
  private comboTextRef: Phaser.GameObjects.Text | null = null;
  private comboProgressBarRef: Phaser.GameObjects.Graphics | null = null;

  // Dirty-check previous values to skip redundant setText calls
  private lastTimerMinutes: number = -1;
  private lastTimerSeconds: number = -1;
  private lastKillCount: number = -1;
  private lastDeathGold: number = -1;
  private lastPlayerLevel: number = -1;

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

    // Level display — sticker style for menu-Balatro coherence.
    this.levelText = this.scene.add.text(leftMargin, currentY, 'LEVEL 1', {
      fontSize: this.scaledFontSize(28),
      color: ACCENT_COLORS_STR.gold,
      fontFamily: '"Atkinson Hyperlegible", Arial, sans-serif',
      fontStyle: 'bold',
      stroke: '#000000',
      strokeThickness: this.scaledSize(4),
    });
    this.levelText.setLetterSpacing(2);
    this.levelText.setDepth(HUD_DEPTH + 1).setAlpha(HUD_ALPHA);

    // Weapon milestone hint (shown when close to a milestone level)
    this.milestoneHintText = this.scene.add.text(leftMargin, currentY + this.scaledSize(28), '', {
      fontSize: this.scaledFontSize(11),
      color: '#aaaaff',
      fontFamily: '"Atkinson Hyperlegible", Arial, sans-serif',
    });
    this.milestoneHintText.setDepth(HUD_DEPTH + 1).setAlpha(0);

    currentY += this.scaledSize(46);

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
      BODY_COLORS.primary
    );
    this.hpBarBackground.setStrokeStyle(2, ACCENT_COLORS.danger);
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
        fontFamily: '"Atkinson Hyperlegible", Arial, sans-serif',
        stroke: '#ffffff',
        strokeThickness: 2,
      }
    );
    this.hpText.setOrigin(0.5);
    this.hpText.setDepth(HUD_DEPTH).setAlpha(HUD_ALPHA);

    // HP label — sticker style.
    this.scene.add.text(leftMargin + hpBarWidth + this.scaledSize(8), currentY + hpBarHeight / 2, 'HP', {
      fontSize: this.scaledFontSize(12),
      color: ACCENT_COLORS_STR.danger,
      fontFamily: '"Atkinson Hyperlegible", Arial, sans-serif',
      fontStyle: 'bold',
      stroke: '#000000',
      strokeThickness: 2,
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
      BODY_COLORS.primary
    );
    this.xpBarBackground.setStrokeStyle(2, ACCENT_COLORS.safe);
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

    // XP label — sticker style.
    this.scene.add.text(leftMargin + xpBarWidth + this.scaledSize(8), currentY + xpBarHeight / 2, 'XP', {
      fontSize: this.scaledFontSize(12),
      color: ACCENT_COLORS_STR.safe,
      fontFamily: '"Atkinson Hyperlegible", Arial, sans-serif',
      fontStyle: 'bold',
      stroke: '#000000',
      strokeThickness: 2,
    }).setOrigin(0, 0.5).setDepth(HUD_DEPTH).setAlpha(HUD_ALPHA);

    currentY += xpBarHeight + this.scaledSize(HUD_ELEMENT_SPACING);

    // Ultimate ("Overdrive") charge bar (below XP bar) — fills from kills +
    // damage; glows gold when ready to fire (Q / gamepad Y / touch button).
    const ultBarWidth = this.scaledSize(180);
    const ultBarHeight = this.scaledSize(8);
    this.ultBarWidth = ultBarWidth - 2;

    this.ultBarGlow = this.scene.add.graphics();
    this.ultBarGlow.fillStyle(0xffcc33, 0.0);
    this.ultBarGlow.fillRoundedRect(leftMargin - 3, currentY - 2, ultBarWidth + 6, ultBarHeight + 4, 3);
    this.ultBarGlow.setDepth(HUD_DEPTH - 1);

    this.ultBarBackground = this.scene.add.rectangle(
      leftMargin + ultBarWidth / 2,
      currentY + ultBarHeight / 2,
      ultBarWidth,
      ultBarHeight,
      BODY_COLORS.primary
    );
    this.ultBarBackground.setStrokeStyle(2, 0xffcc33);
    this.ultBarBackground.setDepth(HUD_DEPTH).setAlpha(HUD_ALPHA);

    this.ultBarFill = this.scene.add.rectangle(
      leftMargin + 1,
      currentY + ultBarHeight / 2,
      0,
      ultBarHeight - 2,
      0xffcc33
    );
    this.ultBarFill.setOrigin(0, 0.5);
    this.ultBarFill.setDepth(HUD_DEPTH).setAlpha(HUD_ALPHA);

    // ULT label — sticker style (shows the [Q] hotkey when ready).
    this.ultLabel = this.scene.add.text(leftMargin + ultBarWidth + this.scaledSize(8), currentY + ultBarHeight / 2, 'ULT', {
      fontSize: this.scaledFontSize(12),
      color: '#ffcc33',
      fontFamily: '"Atkinson Hyperlegible", Arial, sans-serif',
      fontStyle: 'bold',
      stroke: '#000000',
      strokeThickness: 2,
    });
    this.ultLabel.setOrigin(0, 0.5).setDepth(HUD_DEPTH).setAlpha(HUD_ALPHA);

    currentY += ultBarHeight + this.scaledSize(HUD_ELEMENT_SPACING) * 2;

    // === Upgrade Icons Container ===
    this.upgradeIconsContainer = this.scene.add.container(leftMargin, currentY);
    this.upgradeIconsContainer.setDepth(HUD_DEPTH).setAlpha(HUD_ALPHA);

    // Create upgrade tooltip (hidden by default)
    this.upgradeTooltip = this.scene.add.container(0, 0);
    this.upgradeTooltip.setVisible(false);
    this.upgradeTooltip.setDepth(HUD_DEPTH + 1); // Slightly above other HUD elements

    // Tooltip background — Balatro panel painted via graphics. Sized dynamically per-show in showUpgradeTooltip.
    const tooltipPanel = this.scene.add.graphics();
    tooltipPanel.setName('tooltipPanel');
    const tooltipBg = this.scene.add.rectangle(0, 0, 0, 0, 0x000000, 0);
    tooltipBg.setOrigin(0, 0);
    tooltipBg.setName('tooltipBg');

    const upgradeTooltipMaxWidth = this.scaledSize(240);

    const tooltipTitle = this.scene.add.text(0, 0, '', {
      fontSize: this.scaledFontSize(14),
      color: '#ffffff',
      fontFamily: '"Atkinson Hyperlegible", Arial, sans-serif',
      fontStyle: 'bold',
      wordWrap: { width: upgradeTooltipMaxWidth - this.scaledSize(20) },
    }).setName('tooltipTitle');

    const tooltipDesc = this.scene.add.text(0, 0, '', {
      fontSize: this.scaledFontSize(11),
      color: '#aaaaaa',
      fontFamily: '"Atkinson Hyperlegible", Arial, sans-serif',
      wordWrap: { width: upgradeTooltipMaxWidth - this.scaledSize(20) },
    }).setName('tooltipDesc');

    const tooltipLevel = this.scene.add.text(0, 0, '', {
      fontSize: this.scaledFontSize(11),
      color: '#88aaff',
      fontFamily: '"Atkinson Hyperlegible", Arial, sans-serif',
    }).setName('tooltipLevel');

    const tooltipEvolution = this.scene.add.text(0, 0, '', {
      fontSize: this.scaledFontSize(10),
      color: '#ffaa44',
      fontFamily: '"Atkinson Hyperlegible", Arial, sans-serif',
      wordWrap: { width: upgradeTooltipMaxWidth - this.scaledSize(20) },
    }).setName('tooltipEvolution');

    this.upgradeTooltip.add([tooltipPanel, tooltipBg, tooltipTitle, tooltipDesc, tooltipLevel, tooltipEvolution]);

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

    // World level display — sticker style.
    const worldLevel = this.options.worldLevel;
    this.scene.add.text(this.scene.scale.width / 2, scaledPadding, `WORLD ${worldLevel}`, {
      fontSize: this.scaledFontSize(14),
      color: ACCENT_COLORS_STR.primary,
      fontFamily: '"Atkinson Hyperlegible", Arial, sans-serif',
      fontStyle: 'bold',
      stroke: '#000000',
      strokeThickness: 2,
    }).setOrigin(0.5, 0).setName('worldLevelText').setDepth(HUD_DEPTH).setAlpha(HUD_ALPHA);

    // Game time display — sticker style, big + chunky for the timer.
    const scaledWorldLevelHeight = this.scaledSize(WORLD_LEVEL_TEXT_HEIGHT);
    const timerLabel = this.scene.add.text(this.scene.scale.width / 2, scaledPadding + scaledWorldLevelHeight + scaledSpacing, '', {
      fontSize: this.scaledFontSize(28),
      color: '#ffffff',
      fontFamily: '"Atkinson Hyperlegible", Arial, sans-serif',
      fontStyle: 'bold',
      stroke: '#000000',
      strokeThickness: this.scaledSize(4),
    });
    timerLabel.setLetterSpacing(2);
    timerLabel.setOrigin(0.5, 0).setName('timerText').setDepth(HUD_DEPTH).setAlpha(HUD_ALPHA);

    // Kill count display — sticker on Balatro pill.
    this.scene.add.text(statsRightX, statsTopY, '', {
      fontSize: this.scaledFontSize(16),
      color: ACCENT_COLORS_STR.safe,
      fontFamily: '"Atkinson Hyperlegible", Arial, sans-serif',
      fontStyle: 'bold',
      stroke: '#000000',
      strokeThickness: 3,
    }).setOrigin(1, 0).setName('killCountText').setDepth(HUD_DEPTH + 1).setAlpha(HUD_ALPHA);

    // Gold preview display — sticker on Balatro pill.
    this.scene.add.text(statsRightX, statsTopY + this.scaledSize(24), '', {
      fontSize: this.scaledFontSize(14),
      color: ACCENT_COLORS_STR.gold,
      fontFamily: '"Atkinson Hyperlegible", Arial, sans-serif',
      fontStyle: 'bold',
      stroke: '#000000',
      strokeThickness: 3,
    }).setOrigin(1, 0).setName('goldPreviewText').setDepth(HUD_DEPTH + 1).setAlpha(HUD_ALPHA);

    // Combo counter display — anchored bottom-center above the controls hint
    // so it doesn't compete with pause/kills/gold in the top-right. Sticker
    // typography (bold + thick stroke + letter-spaced) so it feels like the
    // big crit callouts in the menu.
    const comboAnchorY = this.scene.scale.height - this.scaledSize(96);
    const comboTextNode = this.scene.add.text(this.scene.scale.width / 2, comboAnchorY, '', {
      fontSize: this.scaledFontSize(18),
      color: '#ffffff',
      fontFamily: '"Atkinson Hyperlegible", Arial, sans-serif',
      fontStyle: 'bold',
      stroke: '#000000',
      strokeThickness: this.scaledSize(4),
    });
    comboTextNode.setLetterSpacing(3);
    comboTextNode.setOrigin(0.5, 1).setName('comboText').setDepth(HUD_DEPTH).setAlpha(0).setScrollFactor(0);

    // Combo progress bar (thin bar below combo text showing progress to next threshold)
    const comboProgressBar = this.scene.add.graphics();
    comboProgressBar.setName('comboProgressBar');
    comboProgressBar.setDepth(HUD_DEPTH);
    comboProgressBar.setAlpha(0);

    // Combo buff timer text — anchored beneath the combo counter (bottom-center).
    this.comboBuffText = this.scene.add.text(
      this.scene.scale.width / 2,
      comboAnchorY + this.scaledSize(4),
      '',
      {
        fontSize: this.scaledFontSize(12),
        color: '#ff8844',
        fontFamily: '"Atkinson Hyperlegible", Arial, sans-serif',
        fontStyle: 'bold',
        stroke: '#000000',
        strokeThickness: this.scaledSize(2),
      }
    ).setOrigin(0.5, 0).setDepth(HUD_DEPTH).setAlpha(0).setScrollFactor(0);

    // Pause button \u2014 Balatro pill (graphics back-layer + transparent rect hit zone).
    const pauseGfx = this.scene.add.graphics();
    pauseGfx.setDepth(HUD_DEPTH - 1).setAlpha(HUD_ALPHA);
    paintHudPanel(pauseGfx, pauseButtonX, pauseButtonY, pauseButtonSize, pauseButtonSize, BODY_COLORS.primary, ACCENT_COLORS.neutral, 12);

    const pauseButtonBg = this.scene.add.rectangle(
      pauseButtonX,
      pauseButtonY,
      pauseButtonSize,
      pauseButtonSize,
      0x000000,
      0
    );
    pauseButtonBg.setInteractive({ useHandCursor: true });
    pauseButtonBg.setName('pauseButtonBg');
    pauseButtonBg.setDepth(HUD_DEPTH);

    const pauseButtonIcon = this.scene.add.text(pauseButtonX, pauseButtonY, '\u23F8', {
      fontSize: this.scaledFontSize(20),
      color: '#ffffff',
      fontStyle: 'bold',
      stroke: '#000000',
      strokeThickness: 3,
    });
    pauseButtonIcon.setOrigin(0.5);
    pauseButtonIcon.setName('pauseButtonIcon');
    pauseButtonIcon.setDepth(HUD_DEPTH).setAlpha(HUD_ALPHA);

    // Pause button hover \u2014 repaint the pill with brighter accent.
    pauseButtonBg.on('pointerover', () => {
      paintHudPanel(pauseGfx, pauseButtonX, pauseButtonY, pauseButtonSize, pauseButtonSize, BODY_COLORS.primary, ACCENT_COLORS.focus, 12);
    });
    pauseButtonBg.on('pointerout', () => {
      paintHudPanel(pauseGfx, pauseButtonX, pauseButtonY, pauseButtonSize, pauseButtonSize, BODY_COLORS.primary, ACCENT_COLORS.neutral, 12);
    });
    pauseButtonBg.on('pointerdown', () => {
      this.options.onPauseClicked();
    });
    pauseButtonBg.once('destroy', () => pauseGfx.destroy());

    // Controls hint (bottom left) — sticker style.
    this.scene.add.text(scaledPadding, this.scene.scale.height - scaledPadding, 'WASD / Arrows / Mouse to move', {
      fontSize: this.scaledFontSize(13),
      color: '#aaaaaa',
      fontFamily: '"Atkinson Hyperlegible", Arial, sans-serif',
      fontStyle: 'bold',
      stroke: '#000000',
      strokeThickness: 3,
    }).setOrigin(0, 1).setDepth(HUD_DEPTH).setAlpha(HUD_ALPHA);

    // BGM info display (bottom left, above controls hint)
    this.createBGMDisplay();
    this.updateBGMDisplay();

    // Auto-buy toggle UI (bottom right, above music controls)
    this.createAutoBuyToggle();

    // Touch action buttons (dash + fullscreen, only visible for touch users)
    this.touchActionButtons = new TouchActionButtons(this.scene, {
      onDash: () => this.scene.events.emit('input-dash-requested'),
      onUltimate: () => this.scene.events.emit('input-ultimate-requested'),
      hudScale: this.hudScale,
    });

    // FPS counter — sticker style (bottom right corner, above auto-buy toggle).
    const autoBuyToggleHeight = Math.max(this.scaledSize(26), 44);
    const fpsY = this.scene.scale.height - scaledPadding - autoBuyToggleHeight - scaledSpacing;
    this.fpsText = this.scene.add.text(this.scene.scale.width - scaledPadding, fpsY, 'FPS: --', {
      fontSize: this.scaledFontSize(14),
      color: ACCENT_COLORS_STR.safe,
      fontFamily: '"Atkinson Hyperlegible", Arial, monospace',
      fontStyle: 'bold',
      stroke: '#000000',
      strokeThickness: 3,
    });
    this.fpsText.setOrigin(1, 1);
    this.fpsText.setDepth(HUD_DEPTH).setAlpha(HUD_ALPHA);
    // Set initial visibility based on settings
    this.fpsText.setVisible(getSettingsManager().isFpsCounterEnabled());

    // Cache text references to avoid O(n) getByName() per frame
    const findByName = <T>(name: string): T => this.scene.children.getByName(name) as unknown as T;
    this.timerTextRef = findByName<Phaser.GameObjects.Text>('timerText');
    this.killCountTextRef = findByName<Phaser.GameObjects.Text>('killCountText');
    this.goldPreviewTextRef = findByName<Phaser.GameObjects.Text>('goldPreviewText');
    this.comboTextRef = findByName<Phaser.GameObjects.Text>('comboText');
    this.comboProgressBarRef = findByName<Phaser.GameObjects.Graphics>('comboProgressBar');
  }

  /**
   * Updates all HUD elements each frame.
   */
  update(state: HUDUpdateState): void {
    // Update timer (only when seconds change)
    if (this.timerTextRef) {
      const minutes = Math.floor(state.gameTime / 60);
      const seconds = Math.floor(state.gameTime % 60);
      if (minutes !== this.lastTimerMinutes || seconds !== this.lastTimerSeconds) {
        this.lastTimerMinutes = minutes;
        this.lastTimerSeconds = seconds;
        this.timerTextRef.setText(`${minutes}:${seconds.toString().padStart(2, '0')}`);
      }

      // Gold timer after victory to indicate "bonus time"
      if (state.hasWon) {
        this.timerTextRef.setColor('#ffdd44');
      }
    }

    // Update kill count (only when changed)
    if (this.killCountTextRef && state.killCount !== this.lastKillCount) {
      this.lastKillCount = state.killCount;
      this.killCountTextRef.setText(`Kills: ${state.killCount}`);
    }

    // Update gold preview — single compact number to reduce HUD clutter.
    // Victory bonus is implicit to the player; they'll see it in the end screen.
    if (this.goldPreviewTextRef) {
      const deathGold = getMetaProgressionManager().calculateRunGold(
        state.killCount,
        state.gameTime,
        state.playerLevel,
        false
      );
      if (deathGold !== this.lastDeathGold) {
        this.lastDeathGold = deathGold;
        this.goldPreviewTextRef.setText(`⟁ ${deathGold}`);
      }
    }

    // Update combo counter display
    const comboText = this.comboTextRef;
    const comboProgressBar = this.comboProgressBarRef;
    if (comboText) {
      if (state.comboCount >= 5) {
        const comboCountChanged = state.comboCount !== this.previousComboCount;
        const comboTierChanged = state.comboTier !== this.previousComboTier;

        // Only update text/font/color when combo count or tier changes
        if (comboCountChanged || comboTierChanged) {
          comboText.setFontSize(this.scaledFontSize(TIER_FONT_SIZES[state.comboTier] ?? 18));
          comboText.setText(`x${state.comboCount}`);
          comboText.setColor(TIER_COLORS[state.comboTier] ?? '#ffffff');
        }

        const comboAlpha = Math.max(0.3, state.comboDecayPercent) * HUD_ALPHA;
        comboText.setAlpha(comboAlpha);

        // Scale-punch tween when combo count increases
        if (state.comboCount > this.previousComboCount) {
          this.scene.tweens.killTweensOf(comboText);
          comboText.setScale(1.3);
          this.scene.tweens.add({
            targets: comboText,
            scale: 1.0,
            duration: 150,
            ease: 'Back.easeOut',
          });
        }

        // Draw combo progress bar (redraw when combo changes OR when pulsing near threshold)
        if (comboProgressBar) {
          const nextThreshold = getNextComboThreshold();
          const needsPulse = nextThreshold && nextThreshold.progress > 0.8;
          if (comboCountChanged || comboTierChanged || needsPulse) {
            comboProgressBar.clear();
            if (nextThreshold) {
              const barWidth = this.scaledSize(80);
              const barHeight = this.scaledSize(5);
              // Combo text is bottom-center-anchored now; draw the bar right below it.
              const barX = comboText.x - barWidth / 2;
              const barY = comboText.y + this.scaledSize(4);
              const fillColor = TIER_HEX_COLORS[state.comboTier] || 0xffffff;

              // Background
              comboProgressBar.fillStyle(0x222233, 0.6);
              comboProgressBar.fillRect(barX, barY, barWidth, barHeight);

              // Fill
              const fillAlpha = nextThreshold.progress > 0.8
                ? 0.7 + 0.3 * Math.abs(Math.sin(state.gameTime * 5))
                : 0.8;
              comboProgressBar.fillStyle(fillColor, fillAlpha);
              comboProgressBar.fillRect(barX, barY, barWidth * nextThreshold.progress, barHeight);

              // Outline
              comboProgressBar.lineStyle(1, 0xffffff, 0.4);
              comboProgressBar.strokeRect(barX, barY, barWidth, barHeight);

              // Tick marks at threshold positions (25, 50, 100)
              const maxThreshold = nextThreshold.nextCount;
              for (const threshold of [25, 50, 100]) {
                if (threshold < maxThreshold) {
                  const tickX = barX + (threshold / maxThreshold) * barWidth;
                  comboProgressBar.lineStyle(1, 0xffffff, 0.3);
                  comboProgressBar.lineBetween(tickX, barY, tickX, barY + barHeight);
                }
              }
            }
          }
          comboProgressBar.setAlpha(comboAlpha);
        }

        this.previousComboTier = state.comboTier;

        // Combo buff timer text — position below combo text + progress bar
        if (this.comboBuffText) {
          if (state.comboBuffActive) {
            const remainingSeconds = (state.comboBuffPercent * 8).toFixed(1);
            this.comboBuffText.setText(`POWER ${remainingSeconds}s`);
            const buffY = comboText.y + this.scaledSize(14);
            this.comboBuffText.setY(buffY);
            this.comboBuffText.setAlpha(0.7 + 0.3 * Math.sin(state.gameTime * 5));
          } else {
            this.comboBuffText.setAlpha(0);
          }
        }
      } else {
        comboText.setAlpha(0);
        this.previousComboTier = '';
        if (comboProgressBar) {
          comboProgressBar.clear();
          comboProgressBar.setAlpha(0);
        }
        if (this.comboBuffText) {
          this.comboBuffText.setAlpha(0);
        }
      }
    }

    this.previousComboCount = state.comboCount;

    // Update ultimate charge bar
    if (this.ultBarFill && this.ultLabel && this.ultBarGlow) {
      const ratio = Phaser.Math.Clamp(state.ultimateChargeRatio, 0, 1);
      this.ultBarFill.width = this.ultBarWidth * ratio;

      if (state.ultimateReady) {
        this.ultBarFill.setFillStyle(0xffffff);
        this.ultLabel.setText('ULT [Q]');
        // One-shot pulse + glow ramp the moment it becomes ready.
        if (!this.wasUltimateReady) {
          this.ultBarGlow.clear();
          this.ultBarGlow.fillStyle(0xffcc33, 0.55);
          this.ultBarGlow.fillRoundedRect(
            this.ultBarFill.x - 4, this.ultBarFill.y - this.scaledSize(7),
            this.ultBarWidth + 8, this.scaledSize(14), 3
          );
          this.scene.tweens.killTweensOf(this.ultBarGlow);
          this.scene.tweens.add({
            targets: this.ultBarGlow,
            alpha: { from: 0.5, to: 1 },
            duration: 600,
            yoyo: true,
            repeat: -1,
            ease: 'Sine.easeInOut',
          });
        }
      } else {
        this.ultBarFill.setFillStyle(0xffcc33);
        if (this.wasUltimateReady) {
          this.ultLabel.setText('ULT');
          this.scene.tweens.killTweensOf(this.ultBarGlow);
          this.ultBarGlow.setAlpha(1);
          this.ultBarGlow.clear();
        }
      }
      this.wasUltimateReady = state.ultimateReady;
    }
    // Mirror the charge onto the mobile ultimate button.
    this.touchActionButtons?.updateUltimateCharge(state.ultimateChargeRatio, state.ultimateReady);

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

    // Update level text and weapon milestone hint (only when level changes)
    if (state.playerLevel !== this.lastPlayerLevel) {
      this.lastPlayerLevel = state.playerLevel;
      this.levelText.setText(`LEVEL ${state.playerLevel}`);
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
    }

    // Update HP bar
    const hpBarMaxWidth = this.scaledSize(180) - 2; // scaled width minus padding
    const hpProgress = Math.max(0, state.currentHP / state.maxHP);
    this.hpBarFill.width = hpBarMaxWidth * hpProgress;

    // HP damage flash: brief white pulse when player takes damage
    if (this.lastPlayerHP >= 0 && state.currentHP < this.lastPlayerHP) {
      this.hpBarFill.setFillStyle(0xffffff);
      this.scene.time.delayedCall(80, () => {
        // Restore threshold color (will be set below on next frame)
        this.hpBarFill.setFillStyle(HP_THRESHOLD_COLORS[getHPThreshold(hpProgress)]);
      });
    }
    this.lastPlayerHP = state.currentHP;

    // Update HP text
    this.hpText.setText(`${Math.ceil(state.currentHP)}/${Math.ceil(state.maxHP)}`);

    const currentHPThreshold = getHPThreshold(hpProgress);
    this.hpBarFill.setFillStyle(HP_THRESHOLD_COLORS[currentHPThreshold]);

    // Pulse HP glow on threshold change
    if (currentHPThreshold !== this.lastHPThreshold) {
      this.lastHPThreshold = currentHPThreshold;
      const glowColor = HP_THRESHOLD_COLORS[currentHPThreshold];

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

        // Damage flash: brief red-white pulse when boss takes significant damage
        if (bossBar.lastHP >= 0 && bossData.currentHP < bossBar.lastHP) {
          const damageFraction = (bossBar.lastHP - bossData.currentHP) / bossData.maxHP;
          if (damageFraction > 0.01) {
            const fillColor = bossBar.isFinalBoss ? 0x990066 : 0xcc0000;
            bossBar.barFill.setFillStyle(0xff8888);
            this.scene.time.delayedCall(80, () => {
              bossBar.barFill.setFillStyle(fillColor);
            });
          }
        }
        bossBar.lastHP = bossData.currentHP;

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

      // Icon background — Balatro pill chip via graphics + transparent hit rect.
      const chipPanel = this.scene.add.graphics();
      const chipAccent = isMastered ? masteryColors.stroke : colors.stroke;
      paintHudPanel(chipPanel, iconX + iconSize / 2, iconY + iconSize / 2, iconSize, iconSize, colors.bg, chipAccent, 6);
      const iconBg = this.scene.add.rectangle(
        iconX + iconSize / 2,
        iconY + iconSize / 2,
        iconSize,
        iconSize,
        0x000000,
        0,
      );
      iconBg.setInteractive({ useHandCursor: true });
      iconBg.once('destroy', () => chipPanel.destroy());

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
          fontFamily: '"Atkinson Hyperlegible", Arial, sans-serif',
          fontStyle: 'bold',
          stroke: '#000000',
          strokeThickness: 2,
        }
      );
      levelBadge.setOrigin(0.5, 0.5);

      // Hover events with Balatro pill repaint (brighter accent on hover).
      iconBg.on('pointerover', () => {
        paintHudPanel(chipPanel, iconX + iconSize / 2, iconY + iconSize / 2, iconSize, iconSize, colors.hover, ACCENT_COLORS.focus, 6);
        this.showUpgradeTooltip(upgrade, iconX, iconY + iconSize + this.scaledSize(10));
      });

      iconBg.on('pointerout', () => {
        paintHudPanel(chipPanel, iconX + iconSize / 2, iconY + iconSize / 2, iconSize, iconSize, colors.bg, chipAccent, 6);
        this.upgradeTooltip.setVisible(false);
      });

      // Add to container — chip panel first (behind icon), then glow if present, then icon elements.
      const elementsToAdd: Phaser.GameObjects.GameObject[] = [chipPanel];
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

    // Name text \u2014 sticker banner with chunky outline.
    const nameText = this.scene.add.text(0, 0, name.toUpperCase(), {
      fontSize: this.scaledFontSize(16),
      color: isFinalBoss ? '#ff66cc' : '#ff6666',
      fontFamily: '"Atkinson Hyperlegible", Arial, sans-serif',
      fontStyle: 'bold',
      stroke: '#000000',
      strokeThickness: this.scaledSize(5),
    });
    nameText.setLetterSpacing(4);
    nameText.setOrigin(0.5, 0);
    container.add(nameText);

    // Bar background \u2014 Balatro panel.
    const barPanel = this.scene.add.graphics();
    paintHudPanel(
      barPanel, 0, barTopOffset + barHeight / 2, barWidth, barHeight,
      BODY_COLORS.primary, isFinalBoss ? ACCENT_COLORS.magenta : ACCENT_COLORS.danger,
      8, 1,
    );
    container.add(barPanel);
    const barBackground = this.scene.add.rectangle(0, barTopOffset + barHeight / 2, barWidth, barHeight, 0x000000, 0);
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
      fontFamily: '"Atkinson Hyperlegible", Arial, sans-serif',
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
      lastHP: -1,
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
    const startY = this.scaledSize(this.BOSS_HEALTH_BAR_START_Y);
    const rowHeight = this.scaledSize(this.BOSS_HEALTH_BAR_HEIGHT);
    this.activeBossHealthBars.forEach((bar, barIndex) => {
      this.scene.tweens.add({
        targets: bar.container,
        y: startY + barIndex * rowHeight,
        duration: 200,
        ease: 'Power2',
      });
    });
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

    // Balatro panel background.
    const panelGfx = this.scene.add.graphics();
    paintHudPanel(panelGfx, 0, 0, panelWidth, panelHeight, BODY_COLORS.primary, event.color, 10);
    this.eventIndicatorContainer.add(panelGfx);
    const background = this.scene.add.rectangle(0, 0, panelWidth, panelHeight, 0x000000, 0);
    this.eventIndicatorContainer.add(background);

    // Event name — sticker style.
    const nameText = this.scene.add.text(0, this.scaledSize(-12), event.name.toUpperCase(), {
      fontSize: this.scaledFontSize(13),
      fontFamily: '"Atkinson Hyperlegible", Arial, sans-serif',
      color: colorHex,
      fontStyle: 'bold',
      stroke: '#000000',
      strokeThickness: 2,
    });
    nameText.setLetterSpacing(2);
    nameText.setOrigin(0.5);
    this.eventIndicatorContainer.add(nameText);

    // Event description
    const descriptionText = this.scene.add.text(0, this.scaledSize(2), event.description, {
      fontSize: this.scaledFontSize(10),
      fontFamily: '"Atkinson Hyperlegible", Arial, sans-serif',
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
      { fontSize: this.scaledFontSize(9), fontFamily: '"Atkinson Hyperlegible", Arial, monospace', color: '#888888' }
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
   * Rebuilds the relic/modifier icon strip. Called whenever the player picks up
   * a new relic or at run start when modifiers are applied. Modifiers show
   * with a category-colored border; relics use rarity color.
   */
  updateRelicModifierStrip(modifiers: readonly RunModifier[], relics: readonly Relic[]): void {
    if (!this.relicStripContainer) {
      this.createRelicModifierStrip();
    }
    const container = this.relicStripContainer!;
    container.removeAll(true);

    const iconSize = this.scaledSize(26);
    const iconSpacing = this.scaledSize(4);
    const modifierCategoryColors: Record<string, number> = {
      offense: 0xff6644,
      defense: 0x44aaff,
      resources: 0xffcc22,
      chaos: 0xaa44ff,
    };

    type StripEntry = {
      iconKey: string;
      borderColor: number;
      tooltipTitle: string;
      tooltipBody: string;
      isModifier: boolean;
    };
    const entries: StripEntry[] = [];

    // Modifiers first so they sit on the right side (anchored origin 1,0 means
    // leftmost slot is rightmost icon). We reverse the visual order later.
    for (const modifier of modifiers) {
      entries.push({
        iconKey: 'warning',
        borderColor: modifierCategoryColors[modifier.category] ?? 0xffffff,
        tooltipTitle: `${modifier.name} (${modifier.category})`,
        tooltipBody: modifier.description,
        isModifier: true,
      });
    }
    for (const relic of relics) {
      entries.push({
        iconKey: relic.icon,
        borderColor: getRelicRarityColor(relic.rarity),
        tooltipTitle: `${relic.name} · ${relic.rarity}`,
        tooltipBody: relic.description,
        isModifier: false,
      });
    }

    // Icons extend leftward from the container anchor (right edge).
    // Index 0 sits rightmost; each subsequent icon shifts left.
    entries.forEach((entry, index) => {
      const x = -(iconSize / 2) - index * (iconSize + iconSpacing);
      const y = iconSize / 2;

      // Balatro pill slot — graphics back-layer + transparent hit zone.
      const slotPanel = this.scene.add.graphics();
      paintHudPanel(slotPanel, x, y, iconSize, iconSize, BODY_COLORS.primary, entry.borderColor, 8);
      container.add(slotPanel);
      const slotBackground = this.scene.add.rectangle(x, y, iconSize, iconSize, 0x000000, 0);
      slotBackground.setInteractive({ useHandCursor: true });
      container.add(slotBackground);

      const slotIcon = createIcon(this.scene, {
        x, y,
        iconKey: entry.iconKey,
        size: Math.floor(iconSize * 0.7),
        tint: 0xffffff,
      });
      container.add(slotIcon);

      // Modifier marker — tiny dot in top-right corner to distinguish from relics
      if (entry.isModifier) {
        const marker = this.scene.add.circle(
          x + iconSize / 2 - 3, y - iconSize / 2 + 3, 3, entry.borderColor, 1
        );
        marker.setStrokeStyle(1, 0x000000);
        container.add(marker);
      }

      slotBackground.on('pointerover', () => {
        this.showRelicTooltip(entry.tooltipTitle, entry.tooltipBody, entry.borderColor, x + container.x, y + container.y + iconSize);
      });
      slotBackground.on('pointerout', () => {
        this.hideRelicTooltip();
      });
      slotBackground.on('pointerdown', () => {
        this.showRelicTooltip(entry.tooltipTitle, entry.tooltipBody, entry.borderColor, x + container.x, y + container.y + iconSize);
      });
    });
  }

  /** Creates the persistent strip container + tooltip (lazy-init). */
  private createRelicModifierStrip(): void {
    const scaledPadding = this.scaledSize(HUD_EDGE_PADDING);
    // Anchor at right edge, just below the gold preview row (gold + kill count
    // together are ~48px tall from the top of the pause button area).
    const pauseButtonSize = Math.max(this.scaledSize(36), 44);
    const topY = scaledPadding + pauseButtonSize + this.scaledSize(HUD_ELEMENT_SPACING) + this.scaledSize(48);
    const rightX = this.scene.scale.width - scaledPadding;

    this.relicStripContainer = this.scene.add.container(rightX, topY);
    this.relicStripContainer.setDepth(HUD_DEPTH);
    this.relicStripContainer.setScrollFactor(0);
    this.relicStripContainer.setAlpha(HUD_ALPHA);

    // Tooltip (hidden by default, positioned per-hover)
    this.relicStripTooltip = this.scene.add.container(0, 0);
    this.relicStripTooltip.setDepth(HUD_DEPTH + 2);
    this.relicStripTooltip.setScrollFactor(0);
    this.relicStripTooltip.setVisible(false);

    // Panel sized dynamically per-show to hug text. Init at zero; showRelicTooltip repaints.
    const relicTooltipPanel = this.scene.add.graphics();
    relicTooltipPanel.setName('relicStripTooltipPanel');
    this.relicStripTooltip.add(relicTooltipPanel);

    this.relicStripTooltipBg = this.scene.add.rectangle(0, 0, 0, 0, 0x000000, 0);
    this.relicStripTooltipBg.setOrigin(1, 0);
    this.relicStripTooltip.add(this.relicStripTooltipBg);

    const tooltipMaxWidth = this.scaledSize(240);

    this.relicStripTooltipTitle = this.scene.add.text(0, 0, '', {
      fontSize: this.scaledFontSize(13),
      color: '#ffffff',
      fontFamily: '"Atkinson Hyperlegible", Arial, sans-serif',
      fontStyle: 'bold',
    }).setOrigin(1, 0);
    this.relicStripTooltip.add(this.relicStripTooltipTitle);

    this.relicStripTooltipDesc = this.scene.add.text(0, 0, '', {
      fontSize: this.scaledFontSize(11),
      color: '#bbbbcc',
      fontFamily: '"Atkinson Hyperlegible", Arial, sans-serif',
      wordWrap: { width: tooltipMaxWidth - this.scaledSize(20) },
      align: 'right',
    }).setOrigin(1, 0);
    this.relicStripTooltip.add(this.relicStripTooltipDesc);
  }

  private showRelicTooltip(title: string, body: string, accentColor: number, anchorX: number, anchorY: number): void {
    if (!this.relicStripTooltip || !this.relicStripTooltipBg
      || !this.relicStripTooltipTitle || !this.relicStripTooltipDesc) return;

    const horizontalPadding = this.scaledSize(10);
    const verticalPadding = this.scaledSize(6);
    const titleDescGap = this.scaledSize(4);
    const tooltipMaxWidth = this.scaledSize(240);

    this.relicStripTooltipTitle.setText(title);
    this.relicStripTooltipDesc.setText(body);

    const contentWidth = Math.max(this.relicStripTooltipTitle.width, this.relicStripTooltipDesc.width);
    const tooltipWidth = Math.min(tooltipMaxWidth, Math.ceil(contentWidth + horizontalPadding * 2));
    const tooltipHeight = Math.ceil(
      this.relicStripTooltipTitle.height + titleDescGap + this.relicStripTooltipDesc.height + verticalPadding * 2,
    );

    // Position text inside the panel. Container origin is the panel's top-right.
    this.relicStripTooltipTitle.setPosition(-horizontalPadding, verticalPadding);
    this.relicStripTooltipDesc.setPosition(
      -horizontalPadding,
      verticalPadding + this.relicStripTooltipTitle.height + titleDescGap,
    );

    this.relicStripTooltipBg.setSize(tooltipWidth, tooltipHeight);

    const panel = this.relicStripTooltip.getByName('relicStripTooltipPanel') as Phaser.GameObjects.Graphics | null;
    if (panel) {
      paintHudPanel(
        panel,
        -tooltipWidth / 2, tooltipHeight / 2,
        tooltipWidth, tooltipHeight,
        BODY_COLORS.primary, accentColor, 10, 0.95,
      );
    }

    // Position tooltip so its right edge aligns with the icon's right edge,
    // extending leftward and downward below the icon.
    const scaledPadding = this.scaledSize(HUD_EDGE_PADDING);
    const rightEdge = Math.min(anchorX + this.scaledSize(13), this.scene.scale.width - scaledPadding);
    this.relicStripTooltip.setPosition(rightEdge, anchorY + this.scaledSize(4));
    this.relicStripTooltip.setVisible(true);
  }

  private hideRelicTooltip(): void {
    if (this.relicStripTooltip) this.relicStripTooltip.setVisible(false);
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

    const findByName = <T>(name: string): T | null =>
      this.scene.children.getByName(name) as unknown as T | null;

    // --- Top-center elements ---
    const worldLevelText = findByName<Phaser.GameObjects.Text>('worldLevelText');
    if (worldLevelText) worldLevelText.setX(width / 2);

    const timerText = findByName<Phaser.GameObjects.Text>('timerText');
    if (timerText) timerText.setX(width / 2);

    // --- Top-right elements ---
    const pauseButtonSize = Math.max(this.scaledSize(36), 44);
    const pauseButtonX = width - scaledPadding - pauseButtonSize / 2;
    const pauseButtonY = scaledPadding + pauseButtonSize / 2;

    const pauseBg = findByName<Phaser.GameObjects.Rectangle>('pauseButtonBg');
    if (pauseBg) pauseBg.setPosition(pauseButtonX, pauseButtonY);

    const pauseIcon = findByName<Phaser.GameObjects.Text>('pauseButtonIcon');
    if (pauseIcon) pauseIcon.setPosition(pauseButtonX, pauseButtonY);

    const statsRightX = width - scaledPadding;

    const killCountText = findByName<Phaser.GameObjects.Text>('killCountText');
    if (killCountText) killCountText.setX(statsRightX);

    const goldPreviewText = findByName<Phaser.GameObjects.Text>('goldPreviewText');
    if (goldPreviewText) goldPreviewText.setX(statsRightX);

    const comboText = findByName<Phaser.GameObjects.Text>('comboText');
    if (comboText) comboText.setX(statsRightX);

    if (this.comboBuffText) {
      this.comboBuffText.setX(width - this.scaledSize(10));
    }

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
      const autoBuyToggleHeight = Math.max(this.scaledSize(26), 44);
      const fpsY = height - scaledPadding - autoBuyToggleHeight - scaledSpacing;
      this.fpsText.setPosition(width - scaledPadding, fpsY);
    }

    if (this.autoBuyToggleBg && this.autoBuyToggleText) {
      const toggleWidth = this.scaledSize(190);
      const toggleHeight = Math.max(this.scaledSize(26), 44);
      const toggleX = width - scaledPadding - toggleWidth / 2;
      const toggleY = height - scaledPadding - toggleHeight / 2;
      this.autoBuyToggleBg.setPosition(toggleX, toggleY);
      this.autoBuyToggleText.setPosition(toggleX, toggleY);
    }

    // --- Event indicator ---
    if (this.eventIndicatorContainer) {
      const panelWidth = this.scaledSize(180);
      const panelHeight = this.scaledSize(48);
      const eventPanelX = width - scaledPadding - panelWidth / 2;
      const eventPanelY = height - scaledPadding - this.scaledSize(70) - panelHeight / 2;
      this.eventIndicatorContainer.setPosition(eventPanelX, eventPanelY);
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

    // --- Touch action buttons ---
    if (this.touchActionButtons) {
      this.touchActionButtons.handleResize(width, height);
    }

  }

  /**
   * Updates FPS counter display and visual quality auto-scaling.
   * Returns the new quality level if it changed, or null if unchanged.
   */
  updateFPS(delta: number): VisualQuality | null {
    // Calculate current FPS
    const fps = 1000 / delta;
    const deltaSeconds = delta * 0.001;

    // Update FPS counter display and visibility
    if (this.fpsText) {
      const fpsEnabled = getSettingsManager().isFpsCounterEnabled();
      this.fpsText.setVisible(fpsEnabled);
      if (fpsEnabled) this.fpsText.setText(`FPS: ${Math.round(fps)}`);
    }

    // Circular buffer for FPS history (avoids O(n) shift)
    this.fpsHistory[this.fpsHistoryIndex] = fps;
    this.fpsHistoryIndex = (this.fpsHistoryIndex + 1) % this.FPS_HISTORY_SIZE;
    if (this.fpsHistorySamples < this.FPS_HISTORY_SIZE) {
      this.fpsHistorySamples++;
    }

    // Only adjust after we have enough samples
    if (this.fpsHistorySamples < this.FPS_HISTORY_SIZE) return null;

    // Calculate average FPS from circular buffer
    let fpsSum = 0;
    for (let i = 0; i < this.FPS_HISTORY_SIZE; i++) {
      fpsSum += this.fpsHistory[i];
    }
    const avgFps = fpsSum / this.FPS_HISTORY_SIZE;

    // Quality tiers with hysteresis:
    // - Downgrade immediately when FPS drops (responsive to lag)
    // - Upgrade only after sustained good FPS (prevents flapping)
    const qualityOrder: VisualQuality[] = ['low', 'medium', 'high'];
    const currentIndex = qualityOrder.indexOf(this.visualQuality);
    let targetIndex = currentIndex;

    if (avgFps < 35) {
      targetIndex = 0; // low
    } else if (avgFps < 48) {
      targetIndex = Math.min(currentIndex, 1); // medium or stay lower
    } else if (avgFps > 56) {
      targetIndex = Math.min(currentIndex + 1, 2); // step up one tier
    }

    // Downgrade immediately, but upgrade requires sustained performance
    if (targetIndex < currentIndex) {
      this.qualityUpgradeTimer = 0;
      this.visualQuality = qualityOrder[targetIndex];
      return this.visualQuality;
    } else if (targetIndex > currentIndex) {
      this.qualityUpgradeTimer += deltaSeconds;
      if (this.qualityUpgradeTimer >= this.QUALITY_UPGRADE_DELAY) {
        this.qualityUpgradeTimer = 0;
        this.visualQuality = qualityOrder[targetIndex];
        return this.visualQuality;
      }
    } else {
      this.qualityUpgradeTimer = 0;
    }

    return null;
  }

  /**
   * Destroys all HUD game objects and cleans up resources.
   */

  destroy(): void {
    this.comboBuffText?.destroy();
    this.comboBuffText = null;

    // Destroy HUD bar glow tweens
    this.scene.tweens.killTweensOf(this.hpGlowGraphics);
    this.scene.tweens.killTweensOf(this.xpGlowGraphics);

    // Destroy event indicator
    this.destroyEventIndicator();

    // Destroy mastery icon effects
    this.masteryIconEffects?.destroy();

    // Destroy boss health bars
    for (const bar of this.activeBossHealthBars) {
      this.scene.tweens.killTweensOf(bar.glowGraphics);
      bar.container.destroy();
    }
    this.activeBossHealthBars = [];

    // Destroy upgrade tooltip, icons container, BGM container
    this.upgradeTooltip?.destroy();
    this.upgradeIconsContainer?.destroy();
    this.bgmContainer?.destroy();

    // Destroy FPS text
    this.fpsText?.destroy();
    this.fpsText = null;

    // Destroy auto-buy toggle elements
    this.autoBuyToggleBg?.destroy();
    this.autoBuyToggleBg = null;
    this.autoBuyToggleText?.destroy();
    this.autoBuyToggleText = null;

    // Destroy touch action buttons
    this.touchActionButtons?.destroy();
    this.touchActionButtons = null;
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
    const toggleHeight = Math.max(this.scaledSize(26), 44); // Min 44px for touch
    const scaledPadding = this.scaledSize(HUD_EDGE_PADDING);
    // Position with right edge at scaled padding from screen edge
    const toggleX = this.scene.scale.width - scaledPadding - toggleWidth / 2;
    // Position with bottom edge at scaled padding from screen edge
    const toggleY = this.scene.scale.height - scaledPadding - toggleHeight / 2;

    // Balatro pill — graphics back-layer + transparent hit zone.
    const autoBuyGfx = this.scene.add.graphics();
    autoBuyGfx.setName('autoBuyToggleGfx');
    autoBuyGfx.setDepth(HUD_DEPTH - 1).setAlpha(HUD_ALPHA);
    paintHudPanel(autoBuyGfx, toggleX, toggleY, toggleWidth, toggleHeight, BODY_COLORS.primary, ACCENT_COLORS.neutral, 12);

    this.autoBuyToggleBg = this.scene.add.rectangle(
      toggleX, toggleY, toggleWidth, toggleHeight, 0x000000, 0,
    );
    this.autoBuyToggleBg.setInteractive({ useHandCursor: true });
    this.autoBuyToggleBg.setName('autoBuyToggleBg');
    this.autoBuyToggleBg.setDepth(HUD_DEPTH);

    // Toggle text — sticker style.
    this.autoBuyToggleText = this.scene.add.text(
      toggleX, toggleY, 'AUTO-UPGRADE  OFF',
      {
        fontSize: this.scaledFontSize(13),
        fontFamily: '"Atkinson Hyperlegible", Arial, sans-serif',
        color: '#888888',
        fontStyle: 'bold',
        stroke: '#000000',
        strokeThickness: 2,
      },
    );
    this.autoBuyToggleText.setLetterSpacing(2);
    this.autoBuyToggleText.setOrigin(0.5);
    this.autoBuyToggleText.setName('autoBuyToggleText');
    this.autoBuyToggleText.setDepth(HUD_DEPTH).setAlpha(HUD_ALPHA);

    this.autoBuyToggleBg.on('pointerdown', () => {
      this.options.onAutoBuyToggled();
    });
    this.autoBuyToggleBg.on('pointerover', () => {
      paintHudPanel(autoBuyGfx, toggleX, toggleY, toggleWidth, toggleHeight, BODY_COLORS.primary, ACCENT_COLORS.focus, 12);
    });
    this.autoBuyToggleBg.on('pointerout', () => {
      this.refreshAutoBuyPanel();
    });
    this.autoBuyToggleBg.once('destroy', () => autoBuyGfx.destroy());

    // Stash refs for `updateAutoBuyToggleVisual` to call repaint on state change.
    this.autoBuyToggleBg.setData('panelGfx', autoBuyGfx);
    this.autoBuyToggleBg.setData('toggleX', toggleX);
    this.autoBuyToggleBg.setData('toggleY', toggleY);
    this.autoBuyToggleBg.setData('toggleW', toggleWidth);
    this.autoBuyToggleBg.setData('toggleH', toggleHeight);

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
      // Show tier indicator if level > 1 (has intelligence upgrades).
      const tierText = autoUpgradeLevel > 1 ? `  T${autoUpgradeLevel}` : '';
      this.autoBuyToggleText.setText(`AUTO${tierText}  ON`);
      this.autoBuyToggleText.setColor(ACCENT_COLORS_STR.gold);
    } else {
      this.autoBuyToggleText.setText('AUTO-UPGRADE  OFF');
      this.autoBuyToggleText.setColor('#888888');
    }
    this.refreshAutoBuyPanel();
  }

  /**
   * Repaints the auto-buy pill background with the right accent for the
   * current state (gold when enabled, neutral when off).
   */
  private refreshAutoBuyPanel(): void {
    if (!this.autoBuyToggleBg) return;
    const gfx = this.autoBuyToggleBg.getData('panelGfx') as Phaser.GameObjects.Graphics | undefined;
    if (!gfx) return;
    const x = this.autoBuyToggleBg.getData('toggleX') as number;
    const y = this.autoBuyToggleBg.getData('toggleY') as number;
    const w = this.autoBuyToggleBg.getData('toggleW') as number;
    const h = this.autoBuyToggleBg.getData('toggleH') as number;
    const accent = this.isAutoBuyEnabled ? ACCENT_COLORS.gold : ACCENT_COLORS.neutral;
    paintHudPanel(gfx, x, y, w, h, BODY_COLORS.primary, accent, 12);
  }

  /**
   * Update touch action button visibility based on current control mode.
   * Shows buttons only when player is using touch input.
   */
  updateTouchButtonVisibility(controlMode: string): void {
    this.touchActionButtons?.setVisible(controlMode === 'joystick');
  }

  /**
   * Returns the touch action buttons instance so input managers can query
   * button zones for joystick exclusion.
   */
  getTouchActionButtons(): TouchActionButtons | null {
    return this.touchActionButtons;
  }

  /**
   * Update the dash cooldown visual on the touch dash button.
   */
  updateDashCooldown(remaining: number, total: number): void {
    this.touchActionButtons?.updateDashCooldown(remaining, total);
  }

  /**
   * Enable or disable touch action buttons (e.g., during pause).
   */
  setTouchButtonsEnabled(isEnabled: boolean): void {
    this.touchActionButtons?.setEnabled(isEnabled);
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

    // Track info text — sticker style on accent color.
    this.bgmTrackText = this.scene.add.text(this.scaledSize(65), 0, 'Loading...', {
      fontSize: this.scaledFontSize(12),
      color: ACCENT_COLORS_STR.primary,
      fontFamily: '"Atkinson Hyperlegible", Arial, sans-serif',
      fontStyle: 'bold',
      stroke: '#000000',
      strokeThickness: 2,
    });

    this.bgmContainer.add([this.bgmMuteButton, this.bgmMuteStrike, skipButton, musicIcon, this.bgmTrackText]);
  }

  /**
   * Toggles BGM mute state.
   */
  private toggleBGMMute(): void {
    const musicManager = getMusicManager();
    const isCurrentlyMuted = musicManager.getPlaybackMode() === 'off';

    if (isCurrentlyMuted) {
      // Unmute - restore to sequential
      musicManager.setPlaybackMode('sequential');
      musicManager.play();
    } else {
      musicManager.setPlaybackMode('off');
    }
    this.bgmMuteStrike.setVisible(!isCurrentlyMuted);
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
      if (currentTrack.id !== this.lastTrackId) {
        this.lastTrackId = currentTrack.id;
        // Truncate long names to fit the display
        const title = currentTrack.title;
        this.bgmTrackText.setText(title.length > 24 ? title.substring(0, 22) + '...' : title);
      }
    } else {
      // Music Off when disabled, No Tracks when enabled but playlist empty
      this.bgmTrackText.setText(isPlaying ? 'No Tracks' : 'Music Off');
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

    const findInTooltip = <T>(name: string): T | null =>
      this.upgradeTooltip.getByName(name) as unknown as T | null;
    const titleText = findInTooltip<Phaser.GameObjects.Text>('tooltipTitle');
    const descText = findInTooltip<Phaser.GameObjects.Text>('tooltipDesc');
    const levelText = findInTooltip<Phaser.GameObjects.Text>('tooltipLevel');
    const evolutionText = findInTooltip<Phaser.GameObjects.Text>('tooltipEvolution');
    const tooltipBg = findInTooltip<Phaser.GameObjects.Rectangle>('tooltipBg');
    const tooltipPanel = findInTooltip<Phaser.GameObjects.Graphics>('tooltipPanel');

    if (titleText) titleText.setText(upgrade.name);
    if (descText) descText.setText(upgrade.description);
    const isMastered = upgrade.currentLevel >= upgrade.maxLevel;
    if (levelText) levelText.setText(isMastered ? '\u2605 MASTERED' : `Level ${upgrade.currentLevel}/${upgrade.maxLevel}`);

    let hasEvolution = false;
    if (evolutionText) {
      const evoInfo = upgrade.evolutionInfo;
      if (evoInfo) {
        hasEvolution = true;
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
      } else {
        evolutionText.setText('');
      }
    }

    // Stack rows vertically with dynamic widths. Each row uses its measured height.
    const horizontalPadding = this.scaledSize(10);
    const verticalPadding = this.scaledSize(8);
    const rowGap = this.scaledSize(4);
    const maxTooltipWidth = this.scaledSize(240);

    let cursorY = verticalPadding;
    let maxContentWidth = 0;
    const layoutRow = (row: Phaser.GameObjects.Text | null, visible: boolean): void => {
      if (!row) return;
      row.setVisible(visible);
      if (!visible) return;
      row.setPosition(horizontalPadding, cursorY);
      cursorY += row.height + rowGap;
      maxContentWidth = Math.max(maxContentWidth, row.width);
    };

    layoutRow(titleText, true);
    layoutRow(descText, true);
    layoutRow(levelText, true);
    layoutRow(evolutionText, hasEvolution);

    const tooltipWidth = Math.min(maxTooltipWidth, Math.ceil(maxContentWidth + horizontalPadding * 2));
    const tooltipHeight = Math.ceil(cursorY - rowGap + verticalPadding);

    if (tooltipBg) tooltipBg.setSize(tooltipWidth, tooltipHeight);
    if (tooltipPanel) {
      paintHudPanel(
        tooltipPanel,
        tooltipWidth / 2, tooltipHeight / 2,
        tooltipWidth, tooltipHeight,
        BODY_COLORS.primary, ACCENT_COLORS.primary, 10, 0.95,
      );
    }

    this.upgradeTooltip.setVisible(true);
  }
}
