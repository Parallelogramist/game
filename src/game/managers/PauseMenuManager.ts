import Phaser from 'phaser';
import { getMetaProgressionManager } from '../../meta/MetaProgressionManager';
import { getAscensionManager } from '../../meta/AscensionManager';
import { getGameStateManager } from '../../save/GameStateManager';
import { MenuNavigator } from '../../input/MenuNavigator';
import { SoundManager } from '../../audio/SoundManager';
import { addButtonInteraction } from '../../utils/SceneTransition';
import { WeaponRunStats } from '../../weapons/WeaponManager';
import { UnlockProgressEntry } from '../../meta/HiddenUnlocks';
import { ACCENT_COLORS, ACCENT_COLORS_STR, BODY_COLORS, MENU_COLORS } from '../../visual/MenuStyle';

/**
 * Paint a Balatro-style panel: drop shadow + dark navy body + thick accent
 * border + thin highlight stripe across the top. Replaces the prior flat
 * dark-rectangle look so end-of-run / pause panels read as the same family
 * as the BootScene cards.
 */
function paintPanelBackground(
  graphics: Phaser.GameObjects.Graphics,
  topLeftX: number,
  topLeftY: number,
  width: number,
  height: number,
  _opts: { withPanelBreaks?: boolean; accentColor?: number } = {}
): void {
  const radius = 12;
  const accent = _opts.accentColor ?? ACCENT_COLORS.primary;

  // Drop shadow (offset down-right).
  graphics.fillStyle(0x000000, 0.45);
  graphics.fillRoundedRect(topLeftX + 5, topLeftY + 7, width, height, radius + 2);

  // Accent border layer.
  graphics.fillStyle(accent, 1);
  graphics.fillRoundedRect(topLeftX - 2, topLeftY - 2, width + 4, height + 4, radius + 1);

  // Body fill (deep saturated navy).
  graphics.fillStyle(BODY_COLORS.primary, 0.94);
  graphics.fillRoundedRect(topLeftX, topLeftY, width, height, radius);

  // Thin top highlight stripe — sells the "card with banner" feel.
  graphics.fillStyle(accent, 0.55);
  graphics.fillRect(topLeftX + 3, topLeftY + 2, width - 6, 2);

  // Subtle bottom inner shadow.
  graphics.fillStyle(0x000000, 0.22);
  graphics.fillRoundedRect(topLeftX, topLeftY + height - 4, width, 4, {
    tl: 0, tr: 0, bl: radius, br: radius,
  });
}

/**
 * Paint a Balatro-style pill button: drop shadow + accent border + body fill +
 * thin top banner highlight. Drawn into a fresh graphics layer behind the
 * provided rectangle so the rectangle stays as the interactive hit zone.
 */
function paintPillBackground(
  graphics: Phaser.GameObjects.Graphics,
  centerX: number,
  centerY: number,
  width: number,
  height: number,
  bodyColor: number,
  accentColor: number,
): void {
  const halfW = width / 2;
  const halfH = height / 2;
  const radius = Math.min(height * 0.4, 14);
  // 3px accent ring. The body sits `BORDER` px inside it, so the body's corner
  // radius shrinks by the same amount to keep the two arcs concentric —
  // otherwise the body's corners overrun the border's curve and read as sharp.
  const BORDER = 3;
  const bodyRadius = Math.max(0, radius - BORDER);

  graphics.clear();

  // Drop shadow.
  graphics.fillStyle(0x000000, 0.45);
  graphics.fillRoundedRect(centerX - halfW + 4, centerY - halfH + 6, width, height, radius + 1);

  // Accent border (rounded). This is also the focus/hover indicator — repainted
  // white when a button is focused (see createLabeledButton's setStrokeStyle shim).
  graphics.fillStyle(accentColor, 1);
  graphics.fillRoundedRect(centerX - halfW - BORDER, centerY - halfH - BORDER, width + BORDER * 2, height + BORDER * 2, radius);

  // Body fill (radius reduced by the border width so its corners nest inside the border).
  graphics.fillStyle(bodyColor, 1);
  graphics.fillRoundedRect(centerX - halfW, centerY - halfH, width, height, bodyRadius);

  // Top highlight stripe (the Balatro banner feel). Inset past the rounded
  // corners so the sharp stripe never overruns them.
  graphics.fillStyle(accentColor, 0.7);
  graphics.fillRect(centerX - halfW + radius, centerY - halfH + 2, width - radius * 2, 3);

  // Bottom inner shadow — same corner-safe inset.
  graphics.fillStyle(0x000000, 0.25);
  graphics.fillRect(centerX - halfW + radius, centerY + halfH - 3, width - radius * 2, 2);
}

void MENU_COLORS;
void ACCENT_COLORS_STR;

// Above the LightingSystem glow texture (depth 1999) so frozen game lights/bloom
// don't bleed over the menu. The pause menu is top-most UI.
const PAUSE_MENU_DEPTH = 2100;

function formatLargeNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(Math.floor(n));
}

function formatTime(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const remainderSeconds = Math.floor(seconds % 60);
  return `${minutes}:${remainderSeconds.toString().padStart(2, '0')}`;
}

/** Formats unlock progress as "current/target" with units hinted by target size. */
function formatProgressText(current: number, target: number): string {
  const fmt = target >= 10_000
    ? formatLargeNumber
    : (n: number) => String(Math.floor(n));
  return `${fmt(current)} / ${fmt(target)}`;
}

export interface PauseMenuOptions {
  onPauseStateChanged: (isPaused: boolean) => void;
  onRestart: () => void;
  onQuitToMenu: () => void;
  onQuitToShop: (goldEarned: number) => void;
  onOpenSettings: () => void;
  onContinueRun: () => void;
  onNextWorld: (goldEarned: number) => void;
  getGameState: () => PauseGameState;
}

export interface PauseGameState {
  killCount: number;
  gameTime: number;
  playerLevel: number;
  hasWon: boolean;
  isGameOver: boolean;
  isPaused: boolean;
  isPauseMenuOpen: boolean;
}

export interface VictoryData {
  killCount: number;
  gameTime: number;
  playerLevel: number;
  goldEarned: number;
  clearedWorld: number;
  newWorldLevel: number;
  previousStreak: number;
  newStreak: number;
  streakBonusPercent: number;
}

export interface GameOverData {
  killCount: number;
  gameTime: number;
  playerLevel: number;
  goldEarned: number;
  previousStreak: number;
  highestCombo: number;
  totalDamageDealt?: number;
  totalDamageTaken?: number;
  weaponStats?: WeaponRunStats[];
  personalBests?: {
    longestSurvival: number;
    mostKills: number;
    highestLevel: number;
    highestCombo: number;
  };
  /** Top locked unlocks the player is closest to — surfaced as retention hook. */
  unlockProgress?: UnlockProgressEntry[];
  /** S–F performance grade for this run. */
  performanceGrade?: { grade: string; color: string };
  /** Composite run score + persisted best (by world level). */
  runScore?: number;
  bestScore?: number;
  isNewBest?: boolean;
}

export class PauseMenuManager {
  private scene: Phaser.Scene;
  private options: PauseMenuOptions;
  private soundManager: SoundManager;

  // Pause menu state (separate from isPaused which is used for upgrades/victory)
  public isPauseMenuOpen: boolean = false;

  // Shop confirmation state
  public isShopConfirmationOpen: boolean = false;

  // Count-up animation targets for run summary
  private countUpStats: { text: Phaser.GameObjects.Text; target: number }[] = [];
  private shopConfirmKeyHandler: ((event: KeyboardEvent) => void) | null = null;

  // Pause menu keyboard + gamepad navigation
  private pauseMenuNavigator: MenuNavigator | null = null;

  // Victory choice handlers (for cleanup)
  private victoryContinueHandler: (() => void) | null = null;
  private victoryNextWorldHandler: (() => void) | null = null;
  private gameOverRestartHandler: (() => void) | null = null;
  private gameOverGamepadPoll: Phaser.Time.TimerEvent | null = null;

  constructor(scene: Phaser.Scene, options: PauseMenuOptions, soundManager: SoundManager) {
    this.scene = scene;
    this.options = options;
    this.soundManager = soundManager;
  }

  /**
   * Destroys scene children whose names are in the list. Missing names are
   * silently ignored — safe to call when the overlay was never shown.
   */
  private destroyElementsByName(names: string[]): void {
    for (const name of names) {
      const element = this.scene.children.getByName(name);
      if (element) element.destroy();
    }
  }

  /**
   * Creates a button (bg rectangle + centered label). Wires hover fill swap,
   * pointerdown -> UI click sound -> onActivate, and standard depth/interaction.
   * Returns the bg + text so callers can reference them for nav or cleanup.
   */
  private createLabeledButton(params: {
    x: number;
    y: number;
    width: number;
    height: number;
    label: string;
    fontSize: string;
    baseColor: number;
    hoverColor: number;
    strokeColor: number;
    bgName: string;
    textName: string;
    onActivate: () => void;
  }): { bg: Phaser.GameObjects.Rectangle; text: Phaser.GameObjects.Text } {
    // Balatro pill: a graphics layer paints the shadow / accent border / body /
    // banner stripe; the Rectangle stays as the hit zone (kept fully transparent).
    const pillGfx = this.scene.add.graphics();
    pillGfx.setDepth(PAUSE_MENU_DEPTH + 0.5);
    pillGfx.setName(`${params.bgName}_gfx`);
    paintPillBackground(pillGfx, params.x, params.y, params.width, params.height, params.baseColor, params.strokeColor);

    const bg = this.scene.add.rectangle(params.x, params.y, params.width, params.height, params.baseColor, 0);
    bg.setStrokeStyle(0);
    bg.setInteractive({ useHandCursor: true });
    bg.setDepth(PAUSE_MENU_DEPTH + 1);
    bg.setName(params.bgName);
    addButtonInteraction(this.scene, bg);

    const text = this.scene.add.text(params.x, params.y, params.label, {
      fontSize: params.fontSize,
      color: '#ffffff',
      fontFamily: '"Atkinson Hyperlegible", Arial, sans-serif',
      fontStyle: 'bold',
      stroke: '#000000',
      strokeThickness: 3,
    });
    text.setOrigin(0.5);
    text.setDepth(PAUSE_MENU_DEPTH + 2);
    text.setName(params.textName);

    // Shim: setFillStyle calls from existing focus/hover code repaint the pill
    // graphics layer instead of the (transparent) Rectangle. Keeps existing
    // call sites working without surgery.
    const originalSetFill = bg.setFillStyle.bind(bg);
    (bg as Phaser.GameObjects.Rectangle).setFillStyle = ((color?: number, _alpha?: number) => {
      if (color !== undefined) {
        paintPillBackground(pillGfx, params.x, params.y, params.width, params.height, color, params.strokeColor);
      }
      // Keep the hit-zone Rectangle fully transparent. Phaser's setFillStyle
      // defaults alpha to 1 when omitted, which would turn this invisible hit
      // zone into an OPAQUE SHARP-cornered rectangle drawn over the rounded pill
      // (the "sharp corners on hover" bug). Force alpha 0; the color is still
      // recorded on bg.fillColor for the setStrokeStyle shim to read.
      return originalSetFill(color, 0);
    }) as typeof bg.setFillStyle;
    // Same for setStrokeStyle — re-paint the pill's (rounded) accent border with
    // the new color. The hit-zone Rectangle itself stays strokeless: a real
    // rectangle stroke has SHARP corners that overrun the rounded pill and bleed
    // past it (the focus/blur "border" bug). The rounded border lives in pillGfx.
    const originalSetStroke = bg.setStrokeStyle.bind(bg);
    (bg as Phaser.GameObjects.Rectangle).setStrokeStyle = ((_lineWidth?: number, color?: number, _alpha?: number) => {
      if (color !== undefined) {
        paintPillBackground(pillGfx, params.x, params.y, params.width, params.height, bg.fillColor, color);
      }
      // No-arg form sets isStroked=false; passing 0 would leave a stroke enabled.
      return originalSetStroke();
    }) as typeof bg.setStrokeStyle;

    bg.on('pointerover', () => bg.setFillStyle(params.hoverColor));
    bg.on('pointerout', () => bg.setFillStyle(params.baseColor));
    bg.on('pointerdown', () => {
      this.soundManager.playUIClick();
      params.onActivate();
    });

    // When the rectangle gets destroyed, take the graphics with it.
    bg.once('destroy', () => pillGfx.destroy());

    return { bg, text };
  }

  /**
   * Tears down the C / N keyboard listeners wired up by showVictory. Safe to
   * call multiple times — nulls the refs once removed.
   */
  private clearVictoryKeyboardHandlers(): void {
    if (this.victoryContinueHandler) {
      this.scene.input.keyboard?.off('keydown-C', this.victoryContinueHandler);
      this.victoryContinueHandler = null;
    }
    if (this.victoryNextWorldHandler) {
      this.scene.input.keyboard?.off('keydown-N', this.victoryNextWorldHandler);
      this.victoryNextWorldHandler = null;
    }
  }

  /**
   * Full-screen dark overlay used by pause menu / victory / confirmation dialogs.
   * Fades in from 0 to targetAlpha. Caller sets the name for later cleanup.
   */
  private createFadeInOverlay(
    name: string,
    targetAlpha: number,
    fadeDuration: number
  ): Phaser.GameObjects.Rectangle {
    const overlay = this.scene.add.rectangle(
      this.scene.scale.width / 2,
      this.scene.scale.height / 2,
      this.scene.scale.width,
      this.scene.scale.height,
      0x000000,
      1
    );
    overlay.setDepth(PAUSE_MENU_DEPTH);
    overlay.setName(name);
    overlay.setAlpha(0);
    this.scene.tweens.add({ targets: overlay, alpha: targetAlpha, duration: fadeDuration, ease: 'Sine.easeOut' });
    return overlay;
  }

  /**
   * Toggles the pause menu on/off.
   * Only works when not in upgrade selection, victory screen, or game over.
   */
  public togglePauseMenu(): void {
    if (this.isPauseMenuOpen) {
      this.hidePauseMenu();
    } else {
      const gameState = this.options.getGameState();
      if (!gameState.isPaused && !gameState.isGameOver) {
        this.showPauseMenu();
      }
    }
  }

  /**
   * Called by SettingsScene when returning to GameScene.
   * Ensures the pause menu is shown reliably (doesn't rely on resume event).
   */
  public showPauseMenuFromSettings(): void {
    const gameState = this.options.getGameState();
    if (!this.isPauseMenuOpen && !gameState.isGameOver) {
      this.options.onPauseStateChanged(true);
      this.showPauseMenu();
    }
  }

  /**
   * Shows the pause menu with Resume and Restart options.
   */
  private showPauseMenu(): void {
    this.isPauseMenuOpen = true;
    this.options.onPauseStateChanged(true);

    // Create pause overlay with fade-in (opaque enough to mute the frozen game scene behind the menu)
    this.createFadeInOverlay('pauseOverlay', 0.82, 115);

    // 8px grid spacing for pause menu
    const menuCenterY = this.scene.scale.height / 2;
    const buttonSpacing = 64; // 8px aligned gap between button centers

    // Pause title — sticker style for Balatro punch.
    const pauseTitle = this.scene.add.text(this.scene.scale.width / 2, menuCenterY - 144, 'PAUSED', {
      fontSize: '56px',
      color: ACCENT_COLORS_STR.focus,
      fontFamily: '"Atkinson Hyperlegible", Arial, sans-serif',
      fontStyle: 'bold',
      stroke: '#000000',
      strokeThickness: 6,
    });
    pauseTitle.setLetterSpacing(4);
    pauseTitle.setOrigin(0.5);
    pauseTitle.setDepth(PAUSE_MENU_DEPTH + 1);
    pauseTitle.setName('pauseTitle');

    // Subtle pulse on title
    this.scene.tweens.add({
      targets: pauseTitle,
      scaleX: 1.03,
      scaleY: 1.03,
      duration: 575,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut',
    });

    // Gold display in pause menu (48px below title)
    const metaManager = getMetaProgressionManager();
    const pauseGoldDisplay = this.scene.add.text(
      this.scene.scale.width / 2,
      menuCenterY - 88,
      `Gold: ${metaManager.getGold()}`,
      {
        fontSize: '24px',
        color: '#ffcc00',
        fontFamily: '"Atkinson Hyperlegible", Arial, sans-serif',
      }
    );
    pauseGoldDisplay.setOrigin(0.5);
    pauseGoldDisplay.setDepth(PAUSE_MENU_DEPTH + 1);
    pauseGoldDisplay.setName('pauseGoldText');

    // Resume button (48px below gold)
    const resumeButtonWidth = 320;
    const resumeButtonHeight = 50;
    const resumeButtonY = menuCenterY - 32;
    const buttonCenterX = this.scene.scale.width / 2;

    const resumeBaseColor = 0x44aa44;
    const resumeHoverColor = 0x55bb55;
    const { bg: resumeButtonBg, text: resumeButtonText } = this.createLabeledButton({
      x: buttonCenterX, y: resumeButtonY,
      width: resumeButtonWidth, height: resumeButtonHeight,
      label: 'Resume', fontSize: '24px',
      baseColor: resumeBaseColor, hoverColor: resumeHoverColor, strokeColor: 0x66cc66,
      bgName: 'resumeButtonBg', textName: 'resumeButtonText',
      onActivate: () => this.hidePauseMenu(),
    });

    // Settings button (64px below resume)
    const settingsButtonY = resumeButtonY + buttonSpacing;
    const settingsBaseColor = 0x446688;
    const settingsHoverColor = 0x5577aa;
    const { bg: settingsButtonBg, text: settingsButtonText } = this.createLabeledButton({
      x: buttonCenterX, y: settingsButtonY,
      width: resumeButtonWidth, height: resumeButtonHeight,
      label: 'Settings', fontSize: '24px',
      baseColor: settingsBaseColor, hoverColor: settingsHoverColor, strokeColor: 0x6688aa,
      bgName: 'settingsButtonBg', textName: 'settingsButtonText',
      onActivate: () => { this.hidePauseMenu(); this.options.onOpenSettings(); },
    });

    // Restart button (neutral slate — non-destructive intent)
    const restartButtonY = settingsButtonY + buttonSpacing;
    const restartBaseColor = 0x3a3a5a;
    const restartHoverColor = 0x55558a;
    const { bg: restartButtonBg, text: restartButtonText } = this.createLabeledButton({
      x: buttonCenterX, y: restartButtonY,
      width: resumeButtonWidth, height: resumeButtonHeight,
      label: '↻  Restart Run', fontSize: '24px',
      baseColor: restartBaseColor, hoverColor: restartHoverColor, strokeColor: 0x7878aa,
      bgName: 'restartButtonBg', textName: 'restartButtonText',
      onActivate: () => this.showEndRunConfirmation('restart'),
    });

    // Quit to Menu button (red — destructive, aborts the run)
    const quitMenuButtonY = restartButtonY + buttonSpacing;
    const quitMenuBaseColor = 0x802020;
    const quitMenuHoverColor = 0xaa2f2f;
    const { bg: quitMenuButtonBg, text: quitMenuButtonText } = this.createLabeledButton({
      x: buttonCenterX, y: quitMenuButtonY,
      width: resumeButtonWidth, height: resumeButtonHeight,
      label: '⌂  Quit to Menu', fontSize: '24px',
      baseColor: quitMenuBaseColor, hoverColor: quitMenuHoverColor, strokeColor: 0xcc4444,
      bgName: 'quitMenuButtonBg', textName: 'quitMenuButtonText',
      onActivate: () => this.showEndRunConfirmation('menu'),
    });

    // Quit to Shop button (gold — destructive but the "cash out" intent)
    const quitShopButtonY = quitMenuButtonY + buttonSpacing;
    const quitShopBaseColor = 0x8a6a14;
    const quitShopHoverColor = 0xbb8e1e;
    const { bg: quitShopButtonBg, text: quitShopButtonText } = this.createLabeledButton({
      x: buttonCenterX, y: quitShopButtonY,
      width: resumeButtonWidth, height: resumeButtonHeight,
      label: '$  Cash Out (Shop)', fontSize: '24px',
      baseColor: quitShopBaseColor, hoverColor: quitShopHoverColor, strokeColor: 0xddaa33,
      bgName: 'quitShopButtonBg', textName: 'quitShopButtonText',
      onActivate: () => this.showEndRunConfirmation('shop'),
    });

    // Hint text (48px below last button)
    const hintText = this.scene.add.text(this.scene.scale.width / 2, quitShopButtonY + 48, 'Arrow keys to navigate, Enter to select', {
      fontSize: '14px',
      color: '#888888',
      fontFamily: '"Atkinson Hyperlegible", Arial, sans-serif',
    });
    hintText.setOrigin(0.5);
    hintText.setDepth(PAUSE_MENU_DEPTH + 1);
    hintText.setName('pauseHintText');

    // Run modifiers panel (right side)
    const runModifiersElements = this.createRunModifiersPanel();

    // Keyboard + gamepad navigation for pause menu
    const pauseButtons = [
      { bg: resumeButtonBg, action: () => this.hidePauseMenu(), baseColor: resumeBaseColor, hoverColor: resumeHoverColor },
      { bg: settingsButtonBg, action: () => { this.hidePauseMenu(); this.options.onOpenSettings(); }, baseColor: settingsBaseColor, hoverColor: settingsHoverColor },
      { bg: restartButtonBg, action: () => this.showEndRunConfirmation('restart'), baseColor: restartBaseColor, hoverColor: restartHoverColor },
      { bg: quitMenuButtonBg, action: () => this.showEndRunConfirmation('menu'), baseColor: quitMenuBaseColor, hoverColor: quitMenuHoverColor },
      { bg: quitShopButtonBg, action: () => this.showEndRunConfirmation('shop'), baseColor: quitShopBaseColor, hoverColor: quitShopHoverColor },
    ];

    this.pauseMenuNavigator = new MenuNavigator({
      scene: this.scene,
      items: pauseButtons.map((btn) => ({
        onFocus: () => {
          btn.bg.setFillStyle(btn.hoverColor);
          btn.bg.setStrokeStyle(3, 0xffffff);
        },
        onBlur: () => {
          btn.bg.setFillStyle(btn.baseColor);
          btn.bg.setStrokeStyle(3, btn.baseColor + 0x224422);
        },
        onActivate: () => { this.soundManager.playUIClick(); btn.action(); },
      })),
      // ESC closing is handled by GameScene's polling-based ESC key check

    });

    // Staggered entrance animation
    const animatedElements = [
      pauseTitle, pauseGoldDisplay,
      resumeButtonBg, resumeButtonText,
      settingsButtonBg, settingsButtonText,
      restartButtonBg, restartButtonText,
      quitMenuButtonBg, quitMenuButtonText,
      quitShopButtonBg, quitShopButtonText,
      hintText,
      ...runModifiersElements,
    ];
    // Disable buttons during stagger to prevent addButtonInteraction's killTweensOf
    // from canceling the alpha fade-in tween on hover
    const interactiveButtons = [resumeButtonBg, settingsButtonBg, restartButtonBg, quitMenuButtonBg, quitShopButtonBg];
    interactiveButtons.forEach((btn) => btn.disableInteractive());

    const staggerDelay = 35;
    animatedElements.forEach((element, index) => {
      element.setAlpha(0);
      this.scene.tweens.add({
        targets: element,
        alpha: 1,
        duration: 85,
        delay: index * staggerDelay,
        ease: 'Sine.easeOut',
      });
    });
    // Re-enable buttons after all stagger animations complete
    const totalStaggerTime = (animatedElements.length - 1) * staggerDelay + 85;
    this.scene.time.delayedCall(totalStaggerTime, () => {
      interactiveButtons.forEach((btn) => {
        if (btn.scene) btn.setInteractive({ useHandCursor: true });
      });
    });
  }

  /**
   * Hides the pause menu and resumes gameplay.
   */
  public hidePauseMenu(): void {
    // Remove pause menu navigator
    if (this.pauseMenuNavigator) {
      this.pauseMenuNavigator.destroy();
      this.pauseMenuNavigator = null;
    }

    // Remove all pause menu UI elements
    this.destroyElementsByName([
      'pauseOverlay',
      'pauseTitle',
      'pauseGoldText',
      'resumeButtonBg',
      'resumeButtonText',
      'settingsButtonBg',
      'settingsButtonText',
      'restartButtonBg',
      'restartButtonText',
      'quitMenuButtonBg',
      'quitMenuButtonText',
      'quitShopButtonBg',
      'quitShopButtonText',
      'pauseHintText',
      'runModifiersTitle',
      'runModifiersBg',
      'runModifiersText',
    ]);

    this.isPauseMenuOpen = false;
    this.options.onPauseStateChanged(false);

    // Ensure scene is resumed at Phaser level (safe to call even if not paused)
    this.scene.scene.resume();
  }

  /**
   * Creates a panel showing active run modifiers (world level, ascension, streak, curse).
   * Returns the created game objects for inclusion in stagger animation.
   */
  private createRunModifiersPanel(): (Phaser.GameObjects.Graphics | Phaser.GameObjects.Text)[] {
    const metaManager = getMetaProgressionManager();
    const ascensionManager = getAscensionManager();

    const lines: { label: string; value: string; color: string }[] = [];

    // World Level
    const worldLevel = metaManager.getWorldLevel();
    if (worldLevel > 0) {
      const enemyHpPercent = Math.round((metaManager.getWorldLevelEnemyHealthMultiplier() - 1) * 100);
      const enemyDmgPercent = Math.round((metaManager.getWorldLevelEnemyDamageMultiplier() - 1) * 100);
      const goldPercent = Math.round((metaManager.getWorldLevelGoldMultiplier() - 1) * 100);
      const xpPercent = Math.round((metaManager.getWorldLevelXPMultiplier() - 1) * 100);
      lines.push({ label: `World ${worldLevel}`, value: '', color: '#88ccff' });
      lines.push({ label: '  Enemy HP', value: `+${enemyHpPercent}%`, color: '#ff8888' });
      lines.push({ label: '  Enemy DMG', value: `+${enemyDmgPercent}%`, color: '#ff8888' });
      lines.push({ label: '  Gold', value: `+${goldPercent}%`, color: '#88ff88' });
      lines.push({ label: '  XP', value: `+${xpPercent}%`, color: '#88ff88' });
    }

    // Ascension
    const ascensionLevel = ascensionManager.getLevel();
    if (ascensionLevel > 0) {
      const statsPercent = Math.round((ascensionManager.getStatMultiplier() - 1) * 100);
      const goldPercent = Math.round((ascensionManager.getGoldMultiplier() - 1) * 100);
      lines.push({ label: `Ascension ${ascensionLevel}`, value: '', color: '#ffcc44' });
      lines.push({ label: '  All Stats', value: `+${statsPercent}%`, color: '#88ff88' });
      lines.push({ label: '  Gold', value: `+${goldPercent}%`, color: '#88ff88' });
      if (ascensionManager.getBonusWeaponSlots() > 0) {
        lines.push({ label: '  Weapon Slots', value: `+${ascensionManager.getBonusWeaponSlots()}`, color: '#88ff88' });
      }
    }

    // Win Streak
    const streakPercent = metaManager.getStreakBonusPercent();
    if (streakPercent > 0) {
      lines.push({ label: `Win Streak x${metaManager.getCurrentStreak()}`, value: `+${streakPercent}% Gold`, color: '#88ff88' });
    }

    // Curse
    const curseLevel = metaManager.getStartingCurseLevel();
    if (curseLevel > 0) {
      const cursePercent = curseLevel * 15;
      lines.push({ label: `Curse ${curseLevel}`, value: `+${cursePercent}% Enemy & Rewards`, color: '#ff66ff' });
    }

    // Newcomer bonus
    const newcomerMultiplier = metaManager.getNewcomerMultiplier();
    if (newcomerMultiplier > 1) {
      lines.push({ label: 'Newcomer Bonus', value: `${newcomerMultiplier.toFixed(1)}x Gold`, color: '#88ff88' });
    }

    // If nothing active, show a simple message
    if (lines.length === 0) {
      lines.push({ label: 'No active modifiers', value: '', color: '#666666' });
    }

    const panelX = this.scene.scale.width * 0.82;
    const panelTopY = this.scene.scale.height / 2 - 144;
    const lineHeight = 20;
    const panelWidth = 220;
    const panelHeight = lines.length * lineHeight + 40;

    // Panel background
    const panelBg = this.scene.add.graphics();
    paintPanelBackground(
      panelBg,
      panelX - panelWidth / 2 - 12,
      panelTopY - 10,
      panelWidth + 24,
      panelHeight
    );
    panelBg.setDepth(PAUSE_MENU_DEPTH + 1);
    panelBg.setName('runModifiersBg');

    // Title
    const titleText = this.scene.add.text(panelX, panelTopY + 4, 'RUN MODIFIERS', {
      fontSize: '14px',
      color: '#aaaacc',
      fontFamily: '"Atkinson Hyperlegible", Arial, sans-serif',
      fontStyle: 'bold',
    });
    titleText.setOrigin(0.5, 0);
    titleText.setDepth(PAUSE_MENU_DEPTH + 2);
    titleText.setName('runModifiersTitle');

    // Modifier lines
    let modifierTextContent = '';
    for (const line of lines) {
      if (line.value) {
        modifierTextContent += `${line.label}  ${line.value}\n`;
      } else {
        modifierTextContent += `${line.label}\n`;
      }
    }

    const modifiersText = this.scene.add.text(panelX, panelTopY + 26, modifierTextContent.trim(), {
      fontSize: '13px',
      color: '#ccccdd',
      fontFamily: '"Atkinson Hyperlegible", Arial, sans-serif',
      lineSpacing: 4,
      align: 'center',
    });
    modifiersText.setOrigin(0.5, 0);
    modifiersText.setDepth(PAUSE_MENU_DEPTH + 2);
    modifiersText.setName('runModifiersText');

    return [panelBg, titleText, modifiersText];
  }

  /**
   * Shows the end run confirmation dialog with gold breakdown.
   * Allows player to confirm or cancel ending the run.
   * @param destination Where to go after confirming: 'shop', 'menu', or 'restart'
   */
  private showEndRunConfirmation(destination: 'shop' | 'menu' | 'restart'): void {
    // Hide pause menu first
    this.hidePauseMenu();
    this.options.onPauseStateChanged(true); // Keep game paused
    this.isShopConfirmationOpen = true;

    // Calculate gold using the same formula as death (hasWon=false)
    const gameState = this.options.getGameState();
    const metaManager = getMetaProgressionManager();
    const finalTotal = metaManager.calculateRunGold(
      gameState.killCount,
      gameState.gameTime,
      gameState.playerLevel,
      false  // Same as death, no victory bonus
    );

    // Calculate breakdown components for display
    const killGold = Math.floor(gameState.killCount * 2.5);
    const timeGold = Math.floor(gameState.gameTime / 10);
    const levelGold = gameState.playerLevel * 10;
    const baseTotal = killGold + timeGold + levelGold;
    const goldMultiplier = metaManager.getStartingGoldMultiplier();
    const worldLevelMultiplier = metaManager.getWorldLevelGoldMultiplier();
    const streakMultiplier = metaManager.getStreakGoldMultiplier();

    // Create confirmation overlay with fade-in
    this.createFadeInOverlay('shopConfirmOverlay', 0.85, 200);

    // 8px grid spacing for confirmation dialog
    const dialogCenterY = this.scene.scale.height / 2;

    // Title — sticker style.
    const titleText = this.scene.add.text(this.scene.scale.width / 2, dialogCenterY - 168, 'END RUN?', {
      fontSize: '48px',
      color: ACCENT_COLORS_STR.gold,
      fontFamily: '"Atkinson Hyperlegible", Arial, sans-serif',
      fontStyle: 'bold',
      stroke: '#000000',
      strokeThickness: 6,
    });
    titleText.setLetterSpacing(3);
    titleText.setOrigin(0.5);
    titleText.setDepth(PAUSE_MENU_DEPTH + 1);
    titleText.setName('shopConfirmTitle');

    // Subtitle (56px below title)
    const subtitleText = this.scene.add.text(
      this.scene.scale.width / 2,
      dialogCenterY - 104,
      'You will earn the following gold:',
      {
        fontSize: '20px',
        color: '#aaaaaa',
        fontFamily: '"Atkinson Hyperlegible", Arial, sans-serif',
      }
    );
    subtitleText.setOrigin(0.5);
    subtitleText.setDepth(PAUSE_MENU_DEPTH + 1);
    subtitleText.setName('shopConfirmSubtitle');

    // Gold breakdown (32px below subtitle, using top-center origin for multi-line text)
    const breakdownLines = [
      `Kills: ${gameState.killCount} × 2.5 = ${killGold} gold`,
      `Time: ${Math.floor(gameState.gameTime)}s ÷ 10 = ${timeGold} gold`,
      `Level: ${gameState.playerLevel} × 10 = ${levelGold} gold`,
      `Base: ${baseTotal} gold`,
    ];

    // Add multiplier lines if applicable
    if (goldMultiplier > 1) {
      breakdownLines.push(`Gold Bonus: ×${goldMultiplier.toFixed(2)}`);
    }
    if (worldLevelMultiplier > 1) {
      breakdownLines.push(`World Level: ×${worldLevelMultiplier.toFixed(2)}`);
    }
    if (streakMultiplier > 1) {
      breakdownLines.push(`Win Streak: ×${streakMultiplier.toFixed(2)}`);
    }
    const newcomerMultiplier = metaManager.getNewcomerMultiplier();
    if (newcomerMultiplier > 1) {
      breakdownLines.push(`Newcomer Bonus: ×${newcomerMultiplier.toFixed(2)}`);
    }

    const breakdownText = this.scene.add.text(
      this.scene.scale.width / 2,
      dialogCenterY - 64,
      breakdownLines.join('\n'),
      {
        fontSize: '18px',
        color: '#cccccc',
        fontFamily: '"Atkinson Hyperlegible", Arial, sans-serif',
        align: 'center',
        lineSpacing: 12,
      }
    );
    breakdownText.setOrigin(0.5, 0); // Top-center origin for proper multi-line positioning
    breakdownText.setDepth(PAUSE_MENU_DEPTH + 1);
    breakdownText.setName('shopConfirmBreakdown');

    // Total gold (24px below breakdown bottom)
    const totalY = breakdownText.y + breakdownText.height + 24;
    const totalText = this.scene.add.text(
      this.scene.scale.width / 2,
      totalY,
      `Total: +${finalTotal} gold`,
      {
        fontSize: '32px',
        color: '#ffdd44',
        fontFamily: '"Atkinson Hyperlegible", Arial, sans-serif',
        fontStyle: 'bold',
      }
    );
    totalText.setOrigin(0.5);
    totalText.setDepth(PAUSE_MENU_DEPTH + 1);
    totalText.setName('shopConfirmTotal');

    // Buttons (48px below total)
    const confirmButtonWidth = 160;
    const confirmButtonHeight = 50;
    const buttonY = totalY + 48 + confirmButtonHeight / 2;

    const { bg: confirmButtonBg } = this.createLabeledButton({
      x: this.scene.scale.width / 2 - 100, y: buttonY,
      width: confirmButtonWidth, height: confirmButtonHeight,
      label: 'Confirm', fontSize: '24px',
      baseColor: 0x44aa44, hoverColor: 0x55bb55, strokeColor: 0x66cc66,
      bgName: 'shopConfirmButtonBg', textName: 'shopConfirmButtonText',
      onActivate: () => {
        // Clear the save to prevent exploit (continuing after intentionally ending)
        getGameStateManager().clearSave();
        // Award gold and go to destination
        metaManager.addGold(finalTotal);
        if (destination === 'restart') {
          this.options.onRestart();
        } else if (destination === 'shop') {
          this.options.onQuitToShop(finalTotal);
        } else {
          this.options.onQuitToMenu();
        }
      },
    });

    // Cancel button
    const { bg: cancelButtonBg } = this.createLabeledButton({
      x: this.scene.scale.width / 2 + 100, y: buttonY,
      width: confirmButtonWidth, height: confirmButtonHeight,
      label: 'Cancel', fontSize: '24px',
      baseColor: 0x664444, hoverColor: 0x885555, strokeColor: 0x886666,
      bgName: 'shopCancelButtonBg', textName: 'shopCancelButtonText',
      onActivate: () => {
        this.hideShopConfirmation();
        this.showPauseMenu();
      },
    });

    // Keyboard navigation for confirm/cancel
    const confirmButtons = [
      { bg: confirmButtonBg, action: () => confirmButtonBg.emit('pointerdown'), baseColor: 0x44aa44, hoverColor: 0x55bb55, strokeBase: 0x66cc66 },
      { bg: cancelButtonBg, action: () => cancelButtonBg.emit('pointerdown'), baseColor: 0x664444, hoverColor: 0x885555, strokeBase: 0x886666 },
    ];
    let confirmSelectedIndex = 0;

    const updateConfirmSelection = (newIndex: number) => {
      confirmButtons[confirmSelectedIndex].bg.setFillStyle(confirmButtons[confirmSelectedIndex].baseColor);
      confirmButtons[confirmSelectedIndex].bg.setStrokeStyle(3, confirmButtons[confirmSelectedIndex].strokeBase);
      confirmSelectedIndex = newIndex;
      confirmButtons[confirmSelectedIndex].bg.setFillStyle(confirmButtons[confirmSelectedIndex].hoverColor);
      confirmButtons[confirmSelectedIndex].bg.setStrokeStyle(3, 0xffffff);
    };

    updateConfirmSelection(0);

    this.shopConfirmKeyHandler = (event: KeyboardEvent) => {
      if (event.key === 'ArrowRight' || event.key === 'd' || event.key === 'D' ||
          event.key === 'ArrowLeft' || event.key === 'a' || event.key === 'A') {
        updateConfirmSelection(confirmSelectedIndex === 0 ? 1 : 0);
      } else if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        confirmButtons[confirmSelectedIndex].action();
      } else if (event.key === 'Escape') {
        cancelButtonBg.emit('pointerdown');
      }
    };
    this.scene.input.keyboard?.on('keydown', this.shopConfirmKeyHandler);
  }

  /**
   * Hides the shop confirmation dialog.
   */
  private hideShopConfirmation(): void {
    if (this.shopConfirmKeyHandler) {
      this.scene.input.keyboard?.off('keydown', this.shopConfirmKeyHandler);
      this.shopConfirmKeyHandler = null;
    }

    this.destroyElementsByName([
      'shopConfirmOverlay',
      'shopConfirmTitle',
      'shopConfirmSubtitle',
      'shopConfirmBreakdown',
      'shopConfirmTotal',
      'shopConfirmButtonBg',
      'shopConfirmButtonText',
      'shopCancelButtonBg',
      'shopCancelButtonText',
    ]);

    this.isShopConfirmationOpen = false;
  }

  /**
   * Shows victory screen when player survives 10 minutes.
   * Game pauses to celebrate, then continues when player presses SPACE.
   */
  public showVictory(data: VictoryData): void {
    // Create victory overlay with fade-in
    this.createFadeInOverlay('victoryOverlay', 0.8, 200);

    // World cleared text
    const worldClearedText = this.scene.add.text(
      this.scene.scale.width / 2,
      this.scene.scale.height / 2 - 120,
      `WORLD ${data.clearedWorld} CLEARED!`,
      {
        fontSize: '32px',
        color: '#88aaff',
        fontFamily: '"Atkinson Hyperlegible", Arial, sans-serif',
        stroke: '#000000',
        strokeThickness: 4,
      }
    );
    worldClearedText.setOrigin(0.5);
    worldClearedText.setDepth(PAUSE_MENU_DEPTH + 1);
    worldClearedText.setName('victoryWorldCleared');

    const victoryText = this.scene.add.text(this.scene.scale.width / 2, this.scene.scale.height / 2 - 60, 'VICTORY!', {
      fontSize: '72px',
      color: ACCENT_COLORS_STR.focus,
      fontFamily: '"Atkinson Hyperlegible", Arial, sans-serif',
      fontStyle: 'bold',
      stroke: '#000000',
      strokeThickness: 8,
    });
    victoryText.setLetterSpacing(5);
    victoryText.setOrigin(0.5);
    victoryText.setDepth(PAUSE_MENU_DEPTH + 1);
    victoryText.setName('victoryText');

    // Pulse animation on VICTORY! text
    this.scene.tweens.add({
      targets: victoryText,
      scaleX: 1.05,
      scaleY: 1.05,
      duration: 800,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut',
    });

    // Gold confetti particle rain
    if (this.scene.textures.exists('particle')) {
      const confettiEmitter = this.scene.add.particles(
        this.scene.scale.width / 2, -10, 'particle', {
          x: { min: -this.scene.scale.width / 2, max: this.scene.scale.width / 2 },
          speed: { min: 40, max: 120 },
          angle: { min: 70, max: 110 },
          scale: { start: 1.5, end: 0.3 },
          lifespan: { min: 2000, max: 3500 },
          alpha: { start: 0.9, end: 0 },
          tint: [0xffd700, 0xffec8b, 0xffffff, 0xffdd44, 0xff8800],
          frequency: 60,
          quantity: 2,
        }
      );
      confettiEmitter.setDepth(PAUSE_MENU_DEPTH + 3);
      confettiEmitter.setScrollFactor(0);
      confettiEmitter.setName('victoryConfetti');
    }

    const messageText = this.scene.add.text(
      this.scene.scale.width / 2,
      this.scene.scale.height / 2 + 20,
      'Boss Defeated!',
      {
        fontSize: '28px',
        color: '#88ff88',
        fontFamily: '"Atkinson Hyperlegible", Arial, sans-serif',
      }
    );
    messageText.setOrigin(0.5);
    messageText.setDepth(PAUSE_MENU_DEPTH + 1);
    messageText.setName('victoryMessage');

    // Next world text
    const nextWorldText = this.scene.add.text(
      this.scene.scale.width / 2,
      this.scene.scale.height / 2 + 60,
      `Next: World ${data.newWorldLevel}`,
      {
        fontSize: '22px',
        color: '#aaddff',
        fontFamily: '"Atkinson Hyperlegible", Arial, sans-serif',
      }
    );
    nextWorldText.setOrigin(0.5);
    nextWorldText.setDepth(PAUSE_MENU_DEPTH + 1);
    nextWorldText.setName('victoryNextWorld');

    const statsText = this.scene.add.text(
      this.scene.scale.width / 2,
      this.scene.scale.height / 2 + 100,
      `Kills: ${data.killCount}  |  Level: ${data.playerLevel}`,
      {
        fontSize: '20px',
        color: '#ffffff',
        fontFamily: '"Atkinson Hyperlegible", Arial, sans-serif',
      }
    );
    statsText.setOrigin(0.5);
    statsText.setDepth(PAUSE_MENU_DEPTH + 1);
    statsText.setName('victoryStats');

    // Streak display
    const fireEmoji = data.newStreak >= 5 ? '\u{1F525}\u{1F525}' : '\u{1F525}';
    const streakText = this.scene.add.text(
      this.scene.scale.width / 2,
      this.scene.scale.height / 2 + 125,
      `${fireEmoji} Streak: ${data.previousStreak} \u2192 ${data.newStreak}! (+${data.streakBonusPercent}% gold)`,
      {
        fontSize: '18px',
        color: '#ffaa44',
        fontFamily: '"Atkinson Hyperlegible", Arial, sans-serif',
      }
    );
    streakText.setOrigin(0.5);
    streakText.setDepth(PAUSE_MENU_DEPTH + 1);
    streakText.setName('victoryStreak');

    // Calculate gold reward for preview (with victory 1.5x bonus)
    const goldToEarn = data.goldEarned;

    // Button dimensions and positions
    const buttonWidth = 180;
    const buttonHeight = 45;
    const buttonY = this.scene.scale.height / 2 + 175;
    const continueButtonX = this.scene.scale.width / 2 - 100;
    const nextWorldButtonX = this.scene.scale.width / 2 + 100;

    // Continue Run button (green, left)
    this.createLabeledButton({
      x: continueButtonX, y: buttonY,
      width: buttonWidth, height: buttonHeight,
      label: 'Continue [C]', fontSize: '20px',
      baseColor: 0x44aa44, hoverColor: 0x55bb55, strokeColor: 0x66cc66,
      bgName: 'victoryContinueButtonBg', textName: 'victoryContinueButtonText',
      onActivate: () => this.handleVictoryContinue(),
    });

    // Next World button (blue, right)
    this.createLabeledButton({
      x: nextWorldButtonX, y: buttonY,
      width: buttonWidth, height: buttonHeight,
      label: 'Next World [N]', fontSize: '20px',
      baseColor: 0x4488cc, hoverColor: 0x5599dd, strokeColor: 0x66aaee,
      bgName: 'victoryNextWorldButtonBg', textName: 'victoryNextWorldButtonText',
      onActivate: () => this.handleVictoryNextWorld(goldToEarn),
    });

    // Gold preview centered below buttons
    const goldPreviewText = this.scene.add.text(
      this.scene.scale.width / 2,
      buttonY + 38,
      `+${goldToEarn} gold`,
      {
        fontSize: '16px',
        color: '#ffdd44',
        fontFamily: '"Atkinson Hyperlegible", Arial, sans-serif',
      }
    );
    goldPreviewText.setOrigin(0.5);
    goldPreviewText.setDepth(PAUSE_MENU_DEPTH + 1);
    goldPreviewText.setName('victoryGoldPreview');

    // Keyboard handlers (store for cleanup). Pointer click handlers are wired
    // by createLabeledButton above.
    this.victoryContinueHandler = () => this.handleVictoryContinue();
    this.victoryNextWorldHandler = () => this.handleVictoryNextWorld(goldToEarn);

    this.scene.input.keyboard?.on('keydown-C', this.victoryContinueHandler);
    this.scene.input.keyboard?.on('keydown-N', this.victoryNextWorldHandler);
  }

  /**
   * Handles the "Continue Run" choice after boss victory.
   * Dismisses the victory overlay and resumes gameplay.
   */
  private handleVictoryContinue(): void {
    // Remove keyboard listeners first
    this.clearVictoryKeyboardHandlers();

    // Remove all victory UI elements
    this.destroyElementsByName([
      'victoryOverlay',
      'victoryWorldCleared',
      'victoryText',
      'victoryMessage',
      'victoryNextWorld',
      'victoryStats',
      'victoryContinueButtonBg',
      'victoryContinueButtonText',
      'victoryNextWorldButtonBg',
      'victoryNextWorldButtonText',
      'victoryGoldPreview',
      'victoryStreak',
      'victoryConfetti',
    ]);

    this.options.onContinueRun();
  }

  /**
   * Handles the "Next World" choice after boss victory.
   * Awards gold and restarts the scene for a fresh run at the new world level.
   */
  private handleVictoryNextWorld(goldAmount: number): void {
    // Remove keyboard listeners
    this.clearVictoryKeyboardHandlers();

    this.options.onNextWorld(goldAmount);
  }

  /**
   * Handles game over state.
   */
  public gameOver(data: GameOverData): void {
    this.countUpStats = [];
    const metaManager = getMetaProgressionManager();

    // Prepare streak change text for display (only shown on death, not victory)
    const streakChangeText = data.previousStreak > 0 ? '\u{1F494} Streak broken!' : '';
    const hasWon = this.options.getGameState().hasWon;

    // Show game over UI
    const overlay = this.scene.add.rectangle(
      this.scene.scale.width / 2,
      this.scene.scale.height / 2,
      this.scene.scale.width,
      this.scene.scale.height,
      0x000000,
      0.7
    );
    overlay.setDepth(PAUSE_MENU_DEPTH);

    // Different display for winners vs non-winners
    const titleLabel = hasWon ? 'VICTORY!' : 'GAME OVER';
    const titleColor = hasWon ? '#ffdd44' : '#ff4444';
    const titleColorHex = hasWon ? 0xffdd44 : 0xff4444;
    const depth = PAUSE_MENU_DEPTH + 1;
    const centerX = this.scene.scale.width / 2;
    const centerY = this.scene.scale.height / 2;

    // Title glow (two concentric circles behind title)
    const glowGraphics = this.scene.add.graphics();
    glowGraphics.setDepth(depth - 1);
    glowGraphics.fillStyle(titleColorHex, 0.08);
    glowGraphics.fillCircle(centerX, centerY - 110, 120);
    glowGraphics.fillStyle(titleColorHex, 0.15);
    glowGraphics.fillCircle(centerX, centerY - 110, 70);

    // Collect elements for staggered entrance animation
    const animatedElements: (Phaser.GameObjects.Text | Phaser.GameObjects.Graphics)[] = [glowGraphics];

    const titleText = this.scene.add.text(centerX, centerY - 110, titleLabel, {
      fontSize: '64px',
      color: titleColor,
      fontFamily: '"Atkinson Hyperlegible", Arial, sans-serif',
      fontStyle: 'bold',
      stroke: '#000000',
      strokeThickness: 7,
    });
    titleText.setLetterSpacing(4);
    titleText.setOrigin(0.5).setDepth(depth);
    animatedElements.push(titleText);

    // Performance grade badge (left of the title).
    if (data.performanceGrade) {
      const gradeColorHex = Phaser.Display.Color.HexStringToColor(data.performanceGrade.color).color;
      const badgeX = centerX - 185;
      const badgeGraphics = this.scene.add.graphics();
      badgeGraphics.setDepth(depth - 1);
      badgeGraphics.fillStyle(0x000000, 0.55);
      badgeGraphics.fillCircle(badgeX, centerY - 110, 36);
      badgeGraphics.lineStyle(3, gradeColorHex, 1);
      badgeGraphics.strokeCircle(badgeX, centerY - 110, 36);
      const gradeText = this.scene.add.text(badgeX, centerY - 110, data.performanceGrade.grade, {
        fontSize: '46px',
        color: data.performanceGrade.color,
        fontFamily: '"Atkinson Hyperlegible", Arial, sans-serif',
        fontStyle: 'bold',
        stroke: '#000000',
        strokeThickness: 4,
      }).setOrigin(0.5).setDepth(depth);
      const gradeLabel = this.scene.add.text(badgeX, centerY - 66, 'GRADE', {
        fontSize: '11px', color: '#8888aa', fontFamily: 'Arial',
      }).setOrigin(0.5).setDepth(depth);
      animatedElements.push(badgeGraphics, gradeText, gradeLabel);
    }

    // Score line (below the title).
    if (data.runScore !== undefined) {
      const scoreStr = data.isNewBest
        ? `★ NEW BEST  ${data.runScore.toLocaleString()}`
        : `Score ${data.runScore.toLocaleString()}   ·   Best ${(data.bestScore ?? data.runScore).toLocaleString()}`;
      const scoreText = this.scene.add.text(centerX, centerY - 66, scoreStr, {
        fontSize: '16px',
        color: data.isNewBest ? '#ffdd44' : '#9999bb',
        fontFamily: '"Atkinson Hyperlegible", Arial, sans-serif',
        fontStyle: 'bold',
      }).setOrigin(0.5).setDepth(depth);
      animatedElements.push(scoreText);
    }

    // Run stats — each stat gets its own line with count-up animation
    const minutes = Math.floor(data.gameTime / 60);
    const seconds = Math.floor(data.gameTime % 60);
    const timeStr = `${minutes}:${seconds.toString().padStart(2, '0')}`;

    const statLabelStyle = { fontSize: '14px', color: '#8888aa', fontFamily: 'Arial' };
    const statValueStyle = { fontSize: '20px', color: '#aaaacc', fontFamily: '"Atkinson Hyperlegible", Arial, sans-serif', fontStyle: 'bold' };

    // Stat lines — compact 2-column layout
    const leftColX = centerX - 100;
    const rightColX = centerX + 100;
    let statRowY = centerY - 45;
    const statRowSpacing = 28;

    // Adds a (label, value) pair centered at (x, y) with value directly below.
    // Returns the value text so callers can attach count-up animations.
    const addStatPair = (
      x: number,
      y: number,
      label: string,
      value: string,
      valueStyleOverrides: Partial<Phaser.Types.GameObjects.Text.TextStyle> = {}
    ): Phaser.GameObjects.Text => {
      const labelText = this.scene.add.text(x, y, label, statLabelStyle).setOrigin(0.5).setDepth(depth);
      const valueText = this.scene.add.text(
        x,
        y + 16,
        value,
        { ...statValueStyle, ...valueStyleOverrides }
      ).setOrigin(0.5).setDepth(depth);
      animatedElements.push(labelText, valueText);
      return valueText;
    };

    // Row 1: Time & Kills
    addStatPair(leftColX, statRowY, 'Survived', timeStr);
    const killValue = addStatPair(rightColX, statRowY, 'Kills', '0');

    statRowY += statRowSpacing + 16;

    // Row 2: Level & Combo
    const levelValue = addStatPair(leftColX, statRowY, 'Level', '0');

    if (data.highestCombo > 0) {
      const comboValue = addStatPair(rightColX, statRowY, 'Best Combo', '0', { color: '#ffdd44' });
      // Combo count-up (delayed to appear after stagger)
      this.countUpStats.push({ text: comboValue, target: data.highestCombo });
    }

    // Track count-up targets
    this.countUpStats.push(
      { text: killValue, target: data.killCount },
      { text: levelValue, target: data.playerLevel },
    );

    statRowY += statRowSpacing + 16;

    // Row 3: Damage dealt (with DPS) & taken
    if (data.totalDamageDealt !== undefined || data.totalDamageTaken !== undefined) {
      const dmgDealt = formatLargeNumber(data.totalDamageDealt ?? 0);
      const dmgTaken = formatLargeNumber(data.totalDamageTaken ?? 0);
      const dps = data.gameTime > 0 ? formatLargeNumber(Math.floor((data.totalDamageDealt ?? 0) / data.gameTime)) : '0';

      addStatPair(leftColX, statRowY, 'Damage Dealt', `${dmgDealt} (${dps}/s)`, { fontSize: '16px' });
      addStatPair(rightColX, statRowY, 'Damage Taken', dmgTaken, { fontSize: '16px', color: '#ff8888' });

      statRowY += statRowSpacing + 16;
    }

    // Divider line between stats and gold
    const divider = this.scene.add.graphics();
    divider.setDepth(depth);
    divider.lineStyle(1, 0x4a4a7a, 0.6);
    divider.lineBetween(centerX - 120, statRowY + 5, centerX + 120, statRowY + 5);
    animatedElements.push(divider);

    // Animated gold counter
    const goldY = statRowY + 25;
    const goldText = this.scene.add.text(centerX, goldY, 'Gold: +0', {
      fontSize: '28px',
      color: '#ffdd44',
      fontFamily: '"Atkinson Hyperlegible", Arial, sans-serif',
      fontStyle: 'bold',
      stroke: '#000000',
      strokeThickness: 3,
    }).setOrigin(0.5).setDepth(depth);
    const goldElementIndex = animatedElements.length;
    animatedElements.push(goldText);

    // Streak text
    if (streakChangeText) {
      const streakDisplay = this.scene.add.text(centerX, goldY + 35, streakChangeText, {
        fontSize: '18px',
        color: data.previousStreak > 0 && !hasWon ? '#ff6666' : '#ffdd44',
        fontFamily: '"Atkinson Hyperlegible", Arial, sans-serif',
      }).setOrigin(0.5).setDepth(depth);
      animatedElements.push(streakDisplay);
    }

    // Track the bottom of the content for dynamic positioning
    let contentBottomY = goldY + 35;
    if (streakChangeText) {
      contentBottomY = goldY + 70;
    }

    // Weapon breakdown panel (right side) + personal bests panel (left side)
    if (data.weaponStats && data.weaponStats.length > 0) {
      this.createWeaponBreakdownPanel(data.weaponStats, depth, animatedElements);
    }
    if (data.personalBests) {
      this.createPersonalBestsPanel(data, depth, animatedElements);
    }

    // "Progress toward unlocks" panel — turns wasted runs into forward motion
    // by surfacing the top 3 locked hidden unlocks the player is closest to.
    if (data.unlockProgress && data.unlockProgress.length > 0) {
      contentBottomY = this.createUnlockProgressPanel(
        data.unlockProgress,
        centerX,
        contentBottomY + 30,
        depth,
        animatedElements
      );
    }

    // Restart hint
    const isTouchDevice = this.scene.input.manager.touch !== null && this.scene.sys.game.device.input.touch;
    const restartHint = isTouchDevice ? 'Tap to restart' : 'Press SPACE to restart';
    const restartText = this.scene.add.text(centerX, contentBottomY + 50, restartHint, {
      fontSize: '20px',
      color: '#888888',
      fontFamily: '"Atkinson Hyperlegible", Arial, sans-serif',
    }).setOrigin(0.5).setDepth(depth);
    animatedElements.push(restartText);

    // Staggered entrance animations
    const staggerDelay = 120;
    animatedElements.forEach((element, index) => {
      element.setAlpha(0);
      this.scene.tweens.add({
        targets: element,
        alpha: 1,
        duration: 300,
        delay: index * staggerDelay,
        ease: 'Sine.easeOut',
      });
    });

    // Stat count-up animations (start after stagger reveals them)
    const statCountUpDelay = 4 * staggerDelay + 300; // After first stat values appear
    this.scene.time.delayedCall(statCountUpDelay, () => {
      for (const stat of this.countUpStats) {
        this.scene.tweens.addCounter({
          from: 0,
          to: stat.target,
          duration: Math.min(800, stat.target * 5 + 200),
          ease: 'Sine.easeOut',
          onUpdate: (tween) => {
            stat.text.setText(String(Math.floor(tween.getValue() ?? 0)));
          },
          onComplete: () => {
            stat.text.setText(String(Math.round(stat.target)));
          },
        });
      }
      this.countUpStats = [];
    });

    // Gold counter starts after gold text fades in
    let goldCounterDone = false;
    let goldCounter: Phaser.Tweens.Tween;
    this.scene.time.delayedCall(goldElementIndex * staggerDelay + 300, () => {
      goldCounter = this.scene.tweens.addCounter({
        from: 0,
        to: data.goldEarned,
        duration: Math.min(1500, data.goldEarned * 3),
        ease: 'Sine.easeOut',
        onUpdate: (tween) => {
          const currentGold = Math.floor(tween.getValue() ?? 0);
          goldText.setText(`Gold: +${currentGold}`);
        },
        onComplete: () => {
          goldCounterDone = true;
          goldText.setText(`Gold: +${data.goldEarned}`);
        },
      });
    });

    // "You can now afford" teaser (appears after gold counter finishes)
    const goldCounterDelay = goldElementIndex * staggerDelay + 300;
    this.scene.time.delayedCall(goldCounterDelay + Math.min(1800, data.goldEarned * 3 + 300), () => {
      const nextUpgrade = metaManager.getNextAffordableUpgrade?.();
      if (nextUpgrade) {
        const affordLabel = nextUpgrade.canAfford
          ? `You can now afford: ${nextUpgrade.name}`
          : `${nextUpgrade.goldNeeded}g away from: ${nextUpgrade.name}`;
        const affordColor = nextUpgrade.canAfford ? '#44ff88' : '#aaaacc';
        this.scene.add.text(centerX, contentBottomY + 25, affordLabel, {
          fontSize: '16px',
          color: affordColor,
          fontFamily: '"Atkinson Hyperlegible", Arial, sans-serif',
          fontStyle: 'italic',
        }).setOrigin(0.5).setDepth(depth);
      }
    });

    // Skip gold animation on tap/space, then restart on second press
    const handleRestart = () => {
      if (!goldCounterDone) {
        goldCounter?.complete();
        goldCounterDone = true;
        goldText.setText(`Gold: +${data.goldEarned}`);
        return;
      }
      this.options.onRestart();
    };

    this.gameOverRestartHandler = handleRestart;
    this.scene.input.keyboard?.on('keydown-SPACE', handleRestart);
    this.scene.time.delayedCall(500, () => {
      this.scene.input.on('pointerdown', handleRestart);
    });

    // Gamepad A button to restart (edge-detected polling)
    let previousAPressed = false;
    this.gameOverGamepadPoll = this.scene.time.addEvent({
      delay: 16,
      loop: true,
      callback: () => {
        const pad = this.scene.input.gamepad?.pad1;
        if (!pad || !pad.connected) return;
        const aPressed = pad.buttons[0]?.pressed ?? false;
        if (aPressed && !previousAPressed) {
          handleRestart();
        }
        previousAPressed = aPressed;
      },
    });
  }

  /**
   * Creates the per-weapon damage breakdown panel shown on the right side of game over.
   * Sorted by total damage descending. Top-5 weapons displayed.
   */
  private createWeaponBreakdownPanel(
    weaponStats: WeaponRunStats[],
    depth: number,
    animatedElements: (Phaser.GameObjects.Text | Phaser.GameObjects.Graphics)[]
  ): void {
    const sortedWeapons = [...weaponStats]
      .filter((stat) => stat.totalDamage > 0)
      .sort((a, b) => b.totalDamage - a.totalDamage)
      .slice(0, 5);

    if (sortedWeapons.length === 0) return;

    const totalDamageAll = sortedWeapons.reduce((sum, stat) => sum + stat.totalDamage, 0);

    const panelX = this.scene.scale.width * 0.82;
    const panelTopY = this.scene.scale.height / 2 - 150;
    const panelWidth = 240;
    const rowHeight = 36;
    const panelHeight = sortedWeapons.length * rowHeight + 52;

    // Background
    const panelBackground = this.scene.add.graphics();
    paintPanelBackground(
      panelBackground,
      panelX - panelWidth / 2,
      panelTopY,
      panelWidth,
      panelHeight
    );
    panelBackground.setDepth(depth);
    animatedElements.push(panelBackground);

    // Title
    const titleText = this.scene.add.text(panelX, panelTopY + 8, 'WEAPON DAMAGE', {
      fontSize: '14px',
      color: '#aaaacc',
      fontFamily: '"Atkinson Hyperlegible", Arial, sans-serif',
      fontStyle: 'bold',
    }).setOrigin(0.5, 0).setDepth(depth);
    animatedElements.push(titleText);

    // Per-weapon rows
    sortedWeapons.forEach((weaponStat, index) => {
      const rowY = panelTopY + 32 + index * rowHeight;
      const damagePercentage = totalDamageAll > 0 ? (weaponStat.totalDamage / totalDamageAll) * 100 : 0;

      // Weapon name (left-aligned)
      const nameText = this.scene.add.text(panelX - panelWidth / 2 + 10, rowY + 2, weaponStat.weaponName, {
        fontSize: '13px',
        color: '#ddddee',
        fontFamily: '"Atkinson Hyperlegible", Arial, sans-serif',
      }).setOrigin(0, 0).setDepth(depth);
      animatedElements.push(nameText);

      // Damage value (right-aligned)
      const damageText = this.scene.add.text(
        panelX + panelWidth / 2 - 10,
        rowY + 2,
        `${formatLargeNumber(weaponStat.totalDamage)}  ${damagePercentage.toFixed(0)}%`,
        {
          fontSize: '12px',
          color: '#ffcc66',
          fontFamily: '"Atkinson Hyperlegible", Arial, sans-serif',
        }
      ).setOrigin(1, 0).setDepth(depth);
      animatedElements.push(damageText);

      // Horizontal bar
      const barBackground = this.scene.add.graphics();
      barBackground.fillStyle(0x222233, 0.8);
      barBackground.fillRect(panelX - panelWidth / 2 + 10, rowY + 20, panelWidth - 20, 5);
      barBackground.setDepth(depth);
      animatedElements.push(barBackground);

      const barFill = this.scene.add.graphics();
      const barFillWidth = ((panelWidth - 20) * damagePercentage) / 100;
      const barColor = index === 0 ? 0xffcc44 : 0x8888bb;
      barFill.fillStyle(barColor, 1);
      barFill.fillRect(panelX - panelWidth / 2 + 10, rowY + 20, barFillWidth, 5);
      barFill.setDepth(depth);
      animatedElements.push(barFill);
    });
  }

  /**
   * Creates a panel showing personal bests comparison on the left side.
   * Flags records that were broken during this run.
   */
  private createPersonalBestsPanel(
    data: GameOverData,
    depth: number,
    animatedElements: (Phaser.GameObjects.Text | Phaser.GameObjects.Graphics)[]
  ): void {
    const bests = data.personalBests!;
    const panelX = this.scene.scale.width * 0.18;
    const panelTopY = this.scene.scale.height / 2 - 150;
    const panelWidth = 220;
    const rowHeight = 32;

    interface BestRow {
      label: string;
      current: string;
      record: string;
      broke: boolean;
    }

    const rows: BestRow[] = [];

    const survivalBroke = data.gameTime > bests.longestSurvival;
    rows.push({
      label: 'Survival',
      current: formatTime(data.gameTime),
      record: formatTime(bests.longestSurvival),
      broke: survivalBroke,
    });

    const killsBroke = data.killCount > bests.mostKills;
    rows.push({
      label: 'Kills',
      current: String(data.killCount),
      record: String(bests.mostKills),
      broke: killsBroke,
    });

    const levelBroke = data.playerLevel > bests.highestLevel;
    rows.push({
      label: 'Level',
      current: String(data.playerLevel),
      record: String(bests.highestLevel),
      broke: levelBroke,
    });

    const comboBroke = data.highestCombo > bests.highestCombo;
    rows.push({
      label: 'Combo',
      current: String(data.highestCombo),
      record: String(bests.highestCombo),
      broke: comboBroke,
    });

    const panelHeight = rows.length * rowHeight + 48;

    const panelBackground = this.scene.add.graphics();
    paintPanelBackground(
      panelBackground,
      panelX - panelWidth / 2,
      panelTopY,
      panelWidth,
      panelHeight
    );
    panelBackground.setDepth(depth);
    animatedElements.push(panelBackground);

    const titleText = this.scene.add.text(panelX, panelTopY + 8, 'PERSONAL BESTS', {
      fontSize: '14px',
      color: '#aaaacc',
      fontFamily: '"Atkinson Hyperlegible", Arial, sans-serif',
      fontStyle: 'bold',
    }).setOrigin(0.5, 0).setDepth(depth);
    animatedElements.push(titleText);

    rows.forEach((row, index) => {
      const rowY = panelTopY + 32 + index * rowHeight;

      const labelColor = row.broke ? '#ffdd44' : '#8888aa';
      const valueColor = row.broke ? '#ffdd44' : '#ccccdd';
      const labelPrefix = row.broke ? '[NEW] ' : '';

      const labelText = this.scene.add.text(panelX - panelWidth / 2 + 10, rowY + 2, `${labelPrefix}${row.label}`, {
        fontSize: '13px',
        color: labelColor,
        fontFamily: '"Atkinson Hyperlegible", Arial, sans-serif',
        fontStyle: row.broke ? 'bold' : 'normal',
      }).setOrigin(0, 0).setDepth(depth);
      animatedElements.push(labelText);

      const valueText = this.scene.add.text(
        panelX + panelWidth / 2 - 10,
        rowY + 2,
        `${row.current}  /  ${row.record}`,
        {
          fontSize: '12px',
          color: valueColor,
          fontFamily: '"Atkinson Hyperlegible", Arial, sans-serif',
        }
      ).setOrigin(1, 0).setDepth(depth);
      animatedElements.push(valueText);
    });
  }

  /**
   * Renders a compact "Progress Toward Unlocks" panel below the main stats.
   * Each row shows the unlock's display name + a thin progress bar.
   * Returns the new content bottom Y so the restart hint can stack below it.
   */
  private createUnlockProgressPanel(
    entries: UnlockProgressEntry[],
    centerX: number,
    startY: number,
    depth: number,
    animatedElements: (Phaser.GameObjects.Text | Phaser.GameObjects.Graphics)[]
  ): number {
    const panelWidth = 340;
    const rowHeight = 22;
    const headerOffset = 18;
    const panelHeight = headerOffset + entries.length * rowHeight + 14;

    // Panel background
    const panelBackground = this.scene.add.graphics();
    paintPanelBackground(
      panelBackground,
      centerX - panelWidth / 2,
      startY,
      panelWidth,
      panelHeight
    );
    panelBackground.setDepth(depth);
    animatedElements.push(panelBackground);

    const header = this.scene.add.text(centerX, startY + 6, 'CLOSEST TO UNLOCK', {
      fontSize: '12px',
      color: '#cc99ff',
      fontFamily: '"Atkinson Hyperlegible", Arial, sans-serif',
      fontStyle: 'bold',
    }).setOrigin(0.5, 0).setDepth(depth);
    animatedElements.push(header);

    const barWidth = 110;
    const barHeight = 6;
    const leftTextX = centerX - panelWidth / 2 + 14;
    const barX = centerX + panelWidth / 2 - barWidth - 14;

    entries.forEach((entry, index) => {
      const rowY = startY + headerOffset + 8 + index * rowHeight;
      const percent = Math.round(entry.ratio * 100);
      const progressText = formatProgressText(entry.current, entry.target);

      const nameText = this.scene.add.text(leftTextX, rowY, entry.condition.displayName, {
        fontSize: '13px',
        color: '#ccccdd',
        fontFamily: '"Atkinson Hyperlegible", Arial, sans-serif',
      }).setOrigin(0, 0).setDepth(depth);
      animatedElements.push(nameText);

      // Background bar
      const barGraphics = this.scene.add.graphics();
      barGraphics.fillStyle(0x2a2a44, 0.9);
      barGraphics.fillRoundedRect(barX, rowY + 4, barWidth, barHeight, 3);
      // Fill portion
      const fillWidth = Math.max(2, barWidth * entry.ratio);
      barGraphics.fillStyle(0xaa44ff, 1.0);
      barGraphics.fillRoundedRect(barX, rowY + 4, fillWidth, barHeight, 3);
      barGraphics.setDepth(depth);
      animatedElements.push(barGraphics);

      const percentText = this.scene.add.text(barX + barWidth + 6, rowY, `${percent}%`, {
        fontSize: '11px',
        color: percent >= 90 ? '#ffdd44' : '#888899',
        fontFamily: '"Atkinson Hyperlegible", Arial, sans-serif',
      }).setOrigin(0, 0).setDepth(depth);
      animatedElements.push(percentText);

      const detailText = this.scene.add.text(leftTextX, rowY + 11, progressText, {
        fontSize: '10px',
        color: '#6677aa',
        fontFamily: '"Atkinson Hyperlegible", Arial, sans-serif',
      }).setOrigin(0, 0).setDepth(depth);
      animatedElements.push(detailText);
    });

    return startY + panelHeight;
  }

  /**
   * Cleans up all keyboard handlers and destroys any visible overlays.
   * Must be called when the scene shuts down.
   */
  public destroy(): void {
    // Remove pause menu navigator
    if (this.pauseMenuNavigator) {
      this.pauseMenuNavigator.destroy();
      this.pauseMenuNavigator = null;
    }

    // Remove shop confirmation keyboard handler
    if (this.shopConfirmKeyHandler) {
      this.scene.input.keyboard?.off('keydown', this.shopConfirmKeyHandler);
      this.shopConfirmKeyHandler = null;
    }

    // Remove victory keyboard handlers (if victory overlay was showing)
    this.clearVictoryKeyboardHandlers();

    // Remove game over keyboard/pointer/gamepad handlers
    if (this.gameOverRestartHandler) {
      this.scene.input.keyboard?.off('keydown-SPACE', this.gameOverRestartHandler);
      this.scene.input.off('pointerdown', this.gameOverRestartHandler);
      this.gameOverRestartHandler = null;
    }
    if (this.gameOverGamepadPoll) {
      this.gameOverGamepadPoll.remove();
      this.gameOverGamepadPoll = null;
    }

    // Hide any open menus/dialogs (removes their UI elements)
    if (this.isPauseMenuOpen) {
      this.hidePauseMenu();
    }
    if (this.isShopConfirmationOpen) {
      this.hideShopConfirmation();
    }
  }
}
