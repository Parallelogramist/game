import Phaser from 'phaser';
import { getMetaProgressionManager } from '../../meta/MetaProgressionManager';
import { getGameStateManager } from '../../save/GameStateManager';

const PAUSE_MENU_DEPTH = 1100;

function formatLargeNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(Math.floor(n));
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
}

export class PauseMenuManager {
  private scene: Phaser.Scene;
  private options: PauseMenuOptions;

  // Pause menu state (separate from isPaused which is used for upgrades/victory)
  public isPauseMenuOpen: boolean = false;

  // Shop confirmation state
  public isShopConfirmationOpen: boolean = false;

  // Count-up animation targets for run summary
  private countUpStats: { text: Phaser.GameObjects.Text; target: number }[] = [];
  private shopConfirmKeyHandler: ((event: KeyboardEvent) => void) | null = null;

  // Pause menu keyboard navigation handler
  private pauseMenuKeyHandler: ((event: KeyboardEvent) => void) | null = null;

  // Victory choice handlers (for cleanup)
  private victoryContinueHandler: (() => void) | null = null;
  private victoryNextWorldHandler: (() => void) | null = null;
  private gameOverRestartHandler: (() => void) | null = null;

  constructor(scene: Phaser.Scene, options: PauseMenuOptions) {
    this.scene = scene;
    this.options = options;
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

    // Create pause overlay
    const overlay = this.scene.add.rectangle(
      this.scene.scale.width / 2,
      this.scene.scale.height / 2,
      this.scene.scale.width,
      this.scene.scale.height,
      0x000000,
      0.75
    );
    overlay.setDepth(PAUSE_MENU_DEPTH);
    overlay.setName('pauseOverlay');

    // 8px grid spacing for pause menu
    const menuCenterY = this.scene.scale.height / 2;
    const buttonSpacing = 64; // 8px aligned gap between button centers

    // Pause title
    const pauseTitle = this.scene.add.text(this.scene.scale.width / 2, menuCenterY - 144, 'PAUSED', {
      fontSize: '56px',
      color: '#ffffff',
      fontFamily: 'Arial',
      stroke: '#000000',
      strokeThickness: 4,
    });
    pauseTitle.setOrigin(0.5);
    pauseTitle.setDepth(PAUSE_MENU_DEPTH + 1);
    pauseTitle.setName('pauseTitle');

    // Gold display in pause menu (48px below title)
    const metaManager = getMetaProgressionManager();
    const pauseGoldDisplay = this.scene.add.text(
      this.scene.scale.width / 2,
      menuCenterY - 88,
      `Gold: ${metaManager.getGold()}`,
      {
        fontSize: '24px',
        color: '#ffcc00',
        fontFamily: 'Arial',
      }
    );
    pauseGoldDisplay.setOrigin(0.5);
    pauseGoldDisplay.setDepth(PAUSE_MENU_DEPTH + 1);
    pauseGoldDisplay.setName('pauseGoldText');

    // Resume button (48px below gold)
    const resumeButtonWidth = 180;
    const resumeButtonHeight = 50;
    const resumeButtonY = menuCenterY - 32;

    const resumeButtonBg = this.scene.add.rectangle(
      this.scene.scale.width / 2,
      resumeButtonY,
      resumeButtonWidth,
      resumeButtonHeight,
      0x44aa44
    );
    resumeButtonBg.setStrokeStyle(3, 0x66cc66);
    resumeButtonBg.setInteractive({ useHandCursor: true });
    resumeButtonBg.setDepth(PAUSE_MENU_DEPTH + 1);
    resumeButtonBg.setName('resumeButtonBg');

    const resumeButtonText = this.scene.add.text(this.scene.scale.width / 2, resumeButtonY, 'Resume', {
      fontSize: '24px',
      color: '#ffffff',
      fontFamily: 'Arial',
    });
    resumeButtonText.setOrigin(0.5);
    resumeButtonText.setDepth(PAUSE_MENU_DEPTH + 2);
    resumeButtonText.setName('resumeButtonText');

    // Resume button hover effects
    resumeButtonBg.on('pointerover', () => {
      resumeButtonBg.setFillStyle(0x55bb55);
    });
    resumeButtonBg.on('pointerout', () => {
      resumeButtonBg.setFillStyle(0x44aa44);
    });
    resumeButtonBg.on('pointerdown', () => {
      this.hidePauseMenu();
    });

    // Settings button (64px below resume)
    const settingsButtonY = resumeButtonY + buttonSpacing;

    const settingsButtonBg = this.scene.add.rectangle(
      this.scene.scale.width / 2,
      settingsButtonY,
      resumeButtonWidth,
      resumeButtonHeight,
      0x446688
    );
    settingsButtonBg.setStrokeStyle(3, 0x6688aa);
    settingsButtonBg.setInteractive({ useHandCursor: true });
    settingsButtonBg.setDepth(PAUSE_MENU_DEPTH + 1);
    settingsButtonBg.setName('settingsButtonBg');

    const settingsButtonText = this.scene.add.text(this.scene.scale.width / 2, settingsButtonY, 'Settings', {
      fontSize: '24px',
      color: '#ffffff',
      fontFamily: 'Arial',
    });
    settingsButtonText.setOrigin(0.5);
    settingsButtonText.setDepth(PAUSE_MENU_DEPTH + 2);
    settingsButtonText.setName('settingsButtonText');

    // Settings button hover effects
    settingsButtonBg.on('pointerover', () => {
      settingsButtonBg.setFillStyle(0x5577aa);
    });
    settingsButtonBg.on('pointerout', () => {
      settingsButtonBg.setFillStyle(0x446688);
    });
    settingsButtonBg.on('pointerdown', () => {
      this.hidePauseMenu();
      this.options.onOpenSettings();
    });

    // Restart button (64px below settings)
    const restartButtonY = settingsButtonY + buttonSpacing;

    const restartButtonBg = this.scene.add.rectangle(
      this.scene.scale.width / 2,
      restartButtonY,
      resumeButtonWidth,
      resumeButtonHeight,
      0x666666
    );
    restartButtonBg.setStrokeStyle(3, 0x888888);
    restartButtonBg.setInteractive({ useHandCursor: true });
    restartButtonBg.setDepth(PAUSE_MENU_DEPTH + 1);
    restartButtonBg.setName('restartButtonBg');

    const restartButtonText = this.scene.add.text(this.scene.scale.width / 2, restartButtonY, 'Restart', {
      fontSize: '24px',
      color: '#ffffff',
      fontFamily: 'Arial',
    });
    restartButtonText.setOrigin(0.5);
    restartButtonText.setDepth(PAUSE_MENU_DEPTH + 2);
    restartButtonText.setName('restartButtonText');

    // Restart button hover effects
    restartButtonBg.on('pointerover', () => {
      restartButtonBg.setFillStyle(0x884444);
    });
    restartButtonBg.on('pointerout', () => {
      restartButtonBg.setFillStyle(0x666666);
    });
    restartButtonBg.on('pointerdown', () => {
      this.showEndRunConfirmation('restart');
    });

    // Quit to Menu button (64px below restart)
    const quitMenuButtonY = restartButtonY + buttonSpacing;

    const quitMenuButtonBg = this.scene.add.rectangle(
      this.scene.scale.width / 2,
      quitMenuButtonY,
      resumeButtonWidth,
      resumeButtonHeight,
      0x664444
    );
    quitMenuButtonBg.setStrokeStyle(3, 0x886666);
    quitMenuButtonBg.setInteractive({ useHandCursor: true });
    quitMenuButtonBg.setDepth(PAUSE_MENU_DEPTH + 1);
    quitMenuButtonBg.setName('quitMenuButtonBg');

    const quitMenuButtonText = this.scene.add.text(this.scene.scale.width / 2, quitMenuButtonY, 'Quit to Menu', {
      fontSize: '24px',
      color: '#ffffff',
      fontFamily: 'Arial',
    });
    quitMenuButtonText.setOrigin(0.5);
    quitMenuButtonText.setDepth(PAUSE_MENU_DEPTH + 2);
    quitMenuButtonText.setName('quitMenuButtonText');

    quitMenuButtonBg.on('pointerover', () => {
      quitMenuButtonBg.setFillStyle(0x885555);
    });
    quitMenuButtonBg.on('pointerout', () => {
      quitMenuButtonBg.setFillStyle(0x664444);
    });
    quitMenuButtonBg.on('pointerdown', () => {
      this.showEndRunConfirmation('menu');
    });

    // Quit to Shop button (64px below quit menu)
    const quitShopButtonY = quitMenuButtonY + buttonSpacing;

    const quitShopButtonBg = this.scene.add.rectangle(
      this.scene.scale.width / 2,
      quitShopButtonY,
      resumeButtonWidth,
      resumeButtonHeight,
      0x666644
    );
    quitShopButtonBg.setStrokeStyle(3, 0x888866);
    quitShopButtonBg.setInteractive({ useHandCursor: true });
    quitShopButtonBg.setDepth(PAUSE_MENU_DEPTH + 1);
    quitShopButtonBg.setName('quitShopButtonBg');

    const quitShopButtonText = this.scene.add.text(this.scene.scale.width / 2, quitShopButtonY, 'Quit to Shop', {
      fontSize: '24px',
      color: '#ffffff',
      fontFamily: 'Arial',
    });
    quitShopButtonText.setOrigin(0.5);
    quitShopButtonText.setDepth(PAUSE_MENU_DEPTH + 2);
    quitShopButtonText.setName('quitShopButtonText');

    quitShopButtonBg.on('pointerover', () => {
      quitShopButtonBg.setFillStyle(0x888855);
    });
    quitShopButtonBg.on('pointerout', () => {
      quitShopButtonBg.setFillStyle(0x666644);
    });
    quitShopButtonBg.on('pointerdown', () => {
      this.showEndRunConfirmation('shop');
    });

    // Hint text (48px below last button)
    const hintText = this.scene.add.text(this.scene.scale.width / 2, quitShopButtonY + 48, 'Arrow keys to navigate, Enter to select', {
      fontSize: '14px',
      color: '#888888',
      fontFamily: 'Arial',
    });
    hintText.setOrigin(0.5);
    hintText.setDepth(PAUSE_MENU_DEPTH + 1);
    hintText.setName('pauseHintText');

    // Keyboard navigation for pause menu
    const pauseButtons = [
      { bg: resumeButtonBg, action: () => this.hidePauseMenu(), baseColor: 0x44aa44, hoverColor: 0x55bb55 },
      { bg: settingsButtonBg, action: () => { this.hidePauseMenu(); this.options.onOpenSettings(); }, baseColor: 0x446688, hoverColor: 0x5577aa },
      { bg: restartButtonBg, action: () => this.showEndRunConfirmation('restart'), baseColor: 0x666666, hoverColor: 0x884444 },
      { bg: quitMenuButtonBg, action: () => this.showEndRunConfirmation('menu'), baseColor: 0x664444, hoverColor: 0x885555 },
      { bg: quitShopButtonBg, action: () => this.showEndRunConfirmation('shop'), baseColor: 0x666644, hoverColor: 0x888855 },
    ];
    let pauseSelectedIndex = 0;

    const updatePauseSelection = (newIndex: number) => {
      // Reset previous button to base color
      pauseButtons[pauseSelectedIndex].bg.setFillStyle(pauseButtons[pauseSelectedIndex].baseColor);
      pauseButtons[pauseSelectedIndex].bg.setStrokeStyle(3, pauseButtons[pauseSelectedIndex].baseColor + 0x224422);
      // Set new button to hover color with bright stroke
      pauseSelectedIndex = newIndex;
      pauseButtons[pauseSelectedIndex].bg.setFillStyle(pauseButtons[pauseSelectedIndex].hoverColor);
      pauseButtons[pauseSelectedIndex].bg.setStrokeStyle(3, 0xffffff);
    };

    // Highlight initial selection
    updatePauseSelection(0);

    this.pauseMenuKeyHandler = (event: KeyboardEvent) => {
      if (event.key === 'ArrowDown' || event.key === 's' || event.key === 'S') {
        updatePauseSelection((pauseSelectedIndex + 1) % pauseButtons.length);
      } else if (event.key === 'ArrowUp' || event.key === 'w' || event.key === 'W') {
        updatePauseSelection((pauseSelectedIndex - 1 + pauseButtons.length) % pauseButtons.length);
      } else if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        pauseButtons[pauseSelectedIndex].action();
      }
    };
    this.scene.input.keyboard?.on('keydown', this.pauseMenuKeyHandler);
  }

  /**
   * Hides the pause menu and resumes gameplay.
   */
  public hidePauseMenu(): void {
    // Remove pause menu keyboard handler
    if (this.pauseMenuKeyHandler) {
      this.scene.input.keyboard?.off('keydown', this.pauseMenuKeyHandler);
      this.pauseMenuKeyHandler = null;
    }

    // Remove all pause menu UI elements
    const elementsToRemove = [
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
    ];
    elementsToRemove.forEach((name) => {
      const element = this.scene.children.getByName(name);
      if (element) element.destroy();
    });

    this.isPauseMenuOpen = false;
    this.options.onPauseStateChanged(false);

    // Ensure scene is resumed at Phaser level (safe to call even if not paused)
    this.scene.scene.resume();
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

    // Create confirmation overlay
    const overlay = this.scene.add.rectangle(
      this.scene.scale.width / 2,
      this.scene.scale.height / 2,
      this.scene.scale.width,
      this.scene.scale.height,
      0x000000,
      0.85
    );
    overlay.setDepth(PAUSE_MENU_DEPTH);
    overlay.setName('shopConfirmOverlay');

    // 8px grid spacing for confirmation dialog
    const dialogCenterY = this.scene.scale.height / 2;

    // Title
    const titleText = this.scene.add.text(this.scene.scale.width / 2, dialogCenterY - 168, 'End Run?', {
      fontSize: '48px',
      color: '#ffcc00',
      fontFamily: 'Arial',
      stroke: '#000000',
      strokeThickness: 4,
    });
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
        fontFamily: 'Arial',
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
        fontFamily: 'Arial',
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
        fontFamily: 'Arial',
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

    const confirmButtonBg = this.scene.add.rectangle(
      this.scene.scale.width / 2 - 100,
      buttonY,
      confirmButtonWidth,
      confirmButtonHeight,
      0x44aa44
    );
    confirmButtonBg.setStrokeStyle(3, 0x66cc66);
    confirmButtonBg.setInteractive({ useHandCursor: true });
    confirmButtonBg.setDepth(PAUSE_MENU_DEPTH + 1);
    confirmButtonBg.setName('shopConfirmButtonBg');

    const confirmButtonText = this.scene.add.text(this.scene.scale.width / 2 - 100, buttonY, 'Confirm', {
      fontSize: '24px',
      color: '#ffffff',
      fontFamily: 'Arial',
    });
    confirmButtonText.setOrigin(0.5);
    confirmButtonText.setDepth(PAUSE_MENU_DEPTH + 2);
    confirmButtonText.setName('shopConfirmButtonText');

    confirmButtonBg.on('pointerover', () => {
      confirmButtonBg.setFillStyle(0x55bb55);
    });
    confirmButtonBg.on('pointerout', () => {
      confirmButtonBg.setFillStyle(0x44aa44);
    });
    confirmButtonBg.on('pointerdown', () => {
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
    });

    // Cancel button
    const cancelButtonBg = this.scene.add.rectangle(
      this.scene.scale.width / 2 + 100,
      buttonY,
      confirmButtonWidth,
      confirmButtonHeight,
      0x664444
    );
    cancelButtonBg.setStrokeStyle(3, 0x886666);
    cancelButtonBg.setInteractive({ useHandCursor: true });
    cancelButtonBg.setDepth(PAUSE_MENU_DEPTH + 1);
    cancelButtonBg.setName('shopCancelButtonBg');

    const cancelButtonText = this.scene.add.text(this.scene.scale.width / 2 + 100, buttonY, 'Cancel', {
      fontSize: '24px',
      color: '#ffffff',
      fontFamily: 'Arial',
    });
    cancelButtonText.setOrigin(0.5);
    cancelButtonText.setDepth(PAUSE_MENU_DEPTH + 2);
    cancelButtonText.setName('shopCancelButtonText');

    cancelButtonBg.on('pointerover', () => {
      cancelButtonBg.setFillStyle(0x885555);
    });
    cancelButtonBg.on('pointerout', () => {
      cancelButtonBg.setFillStyle(0x664444);
    });
    cancelButtonBg.on('pointerdown', () => {
      this.hideShopConfirmation();
      this.showPauseMenu();
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

    const elementsToRemove = [
      'shopConfirmOverlay',
      'shopConfirmTitle',
      'shopConfirmSubtitle',
      'shopConfirmBreakdown',
      'shopConfirmTotal',
      'shopConfirmButtonBg',
      'shopConfirmButtonText',
      'shopCancelButtonBg',
      'shopCancelButtonText',
    ];
    elementsToRemove.forEach((name) => {
      const element = this.scene.children.getByName(name);
      if (element) element.destroy();
    });

    this.isShopConfirmationOpen = false;
  }

  /**
   * Shows victory screen when player survives 10 minutes.
   * Game pauses to celebrate, then continues when player presses SPACE.
   */
  public showVictory(data: VictoryData): void {
    // Create victory overlay
    const overlay = this.scene.add.rectangle(
      this.scene.scale.width / 2,
      this.scene.scale.height / 2,
      this.scene.scale.width,
      this.scene.scale.height,
      0x000000,
      0.8
    );
    overlay.setDepth(PAUSE_MENU_DEPTH);
    overlay.setName('victoryOverlay');

    // World cleared text
    const worldClearedText = this.scene.add.text(
      this.scene.scale.width / 2,
      this.scene.scale.height / 2 - 120,
      `WORLD ${data.clearedWorld} CLEARED!`,
      {
        fontSize: '32px',
        color: '#88aaff',
        fontFamily: 'Arial',
        stroke: '#000000',
        strokeThickness: 4,
      }
    );
    worldClearedText.setOrigin(0.5);
    worldClearedText.setDepth(PAUSE_MENU_DEPTH + 1);
    worldClearedText.setName('victoryWorldCleared');

    const victoryText = this.scene.add.text(this.scene.scale.width / 2, this.scene.scale.height / 2 - 60, 'VICTORY!', {
      fontSize: '72px',
      color: '#ffdd44',
      fontFamily: 'Arial',
      stroke: '#000000',
      strokeThickness: 6,
    });
    victoryText.setOrigin(0.5);
    victoryText.setDepth(PAUSE_MENU_DEPTH + 1);
    victoryText.setName('victoryText');

    const messageText = this.scene.add.text(
      this.scene.scale.width / 2,
      this.scene.scale.height / 2 + 20,
      'Boss Defeated!',
      {
        fontSize: '28px',
        color: '#88ff88',
        fontFamily: 'Arial',
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
        fontFamily: 'Arial',
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
        fontFamily: 'Arial',
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
        fontFamily: 'Arial',
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
    const continueButtonBg = this.scene.add.rectangle(
      continueButtonX,
      buttonY,
      buttonWidth,
      buttonHeight,
      0x44aa44
    );
    continueButtonBg.setStrokeStyle(3, 0x66cc66);
    continueButtonBg.setInteractive({ useHandCursor: true });
    continueButtonBg.setDepth(PAUSE_MENU_DEPTH + 1);
    continueButtonBg.setName('victoryContinueButtonBg');

    const continueButtonText = this.scene.add.text(continueButtonX, buttonY, 'Continue [C]', {
      fontSize: '20px',
      color: '#ffffff',
      fontFamily: 'Arial',
    });
    continueButtonText.setOrigin(0.5);
    continueButtonText.setDepth(PAUSE_MENU_DEPTH + 2);
    continueButtonText.setName('victoryContinueButtonText');

    // Next World button (blue, right)
    const nextWorldButtonBg = this.scene.add.rectangle(
      nextWorldButtonX,
      buttonY,
      buttonWidth,
      buttonHeight,
      0x4488cc
    );
    nextWorldButtonBg.setStrokeStyle(3, 0x66aaee);
    nextWorldButtonBg.setInteractive({ useHandCursor: true });
    nextWorldButtonBg.setDepth(PAUSE_MENU_DEPTH + 1);
    nextWorldButtonBg.setName('victoryNextWorldButtonBg');

    const nextWorldButtonText = this.scene.add.text(nextWorldButtonX, buttonY, 'Next World [N]', {
      fontSize: '20px',
      color: '#ffffff',
      fontFamily: 'Arial',
    });
    nextWorldButtonText.setOrigin(0.5);
    nextWorldButtonText.setDepth(PAUSE_MENU_DEPTH + 2);
    nextWorldButtonText.setName('victoryNextWorldButtonText');

    // Gold preview centered below buttons
    const goldPreviewText = this.scene.add.text(
      this.scene.scale.width / 2,
      buttonY + 38,
      `+${goldToEarn} gold`,
      {
        fontSize: '16px',
        color: '#ffdd44',
        fontFamily: 'Arial',
      }
    );
    goldPreviewText.setOrigin(0.5);
    goldPreviewText.setDepth(PAUSE_MENU_DEPTH + 1);
    goldPreviewText.setName('victoryGoldPreview');

    // Hover effects
    continueButtonBg.on('pointerover', () => {
      continueButtonBg.setFillStyle(0x55bb55);
    });
    continueButtonBg.on('pointerout', () => {
      continueButtonBg.setFillStyle(0x44aa44);
    });
    nextWorldButtonBg.on('pointerover', () => {
      nextWorldButtonBg.setFillStyle(0x5599dd);
    });
    nextWorldButtonBg.on('pointerout', () => {
      nextWorldButtonBg.setFillStyle(0x4488cc);
    });

    // Click handlers
    continueButtonBg.on('pointerdown', () => {
      this.handleVictoryContinue();
    });
    nextWorldButtonBg.on('pointerdown', () => {
      this.handleVictoryNextWorld(goldToEarn);
    });

    // Keyboard handlers (store for cleanup)
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
    if (this.victoryContinueHandler) {
      this.scene.input.keyboard?.off('keydown-C', this.victoryContinueHandler);
    }
    if (this.victoryNextWorldHandler) {
      this.scene.input.keyboard?.off('keydown-N', this.victoryNextWorldHandler);
    }
    this.victoryContinueHandler = null;
    this.victoryNextWorldHandler = null;

    // Remove all victory UI elements
    const elementsToRemove = [
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
    ];
    elementsToRemove.forEach((name) => {
      const element = this.scene.children.getByName(name);
      if (element) element.destroy();
    });

    this.options.onContinueRun();
  }

  /**
   * Handles the "Next World" choice after boss victory.
   * Awards gold and restarts the scene for a fresh run at the new world level.
   */
  private handleVictoryNextWorld(goldAmount: number): void {
    // Remove keyboard listeners
    if (this.victoryContinueHandler) {
      this.scene.input.keyboard?.off('keydown-C', this.victoryContinueHandler);
    }
    if (this.victoryNextWorldHandler) {
      this.scene.input.keyboard?.off('keydown-N', this.victoryNextWorldHandler);
    }
    this.victoryContinueHandler = null;
    this.victoryNextWorldHandler = null;

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
      fontFamily: 'Arial',
      stroke: '#000000',
      strokeThickness: 4,
    }).setOrigin(0.5).setDepth(depth);
    animatedElements.push(titleText);

    // Run stats — each stat gets its own line with count-up animation
    const minutes = Math.floor(data.gameTime / 60);
    const seconds = Math.floor(data.gameTime % 60);
    const timeStr = `${minutes}:${seconds.toString().padStart(2, '0')}`;

    const statLabelStyle = { fontSize: '14px', color: '#8888aa', fontFamily: 'Arial' };
    const statValueStyle = { fontSize: '20px', color: '#aaaacc', fontFamily: 'Arial', fontStyle: 'bold' };

    // Stat lines — compact 2-column layout
    const leftColX = centerX - 100;
    const rightColX = centerX + 100;
    let statRowY = centerY - 45;
    const statRowSpacing = 28;

    // Row 1: Time & Kills
    const timeLabel = this.scene.add.text(leftColX, statRowY, 'Survived', statLabelStyle).setOrigin(0.5).setDepth(depth);
    const timeValue = this.scene.add.text(leftColX, statRowY + 16, timeStr, statValueStyle).setOrigin(0.5).setDepth(depth);
    animatedElements.push(timeLabel, timeValue);

    const killLabel = this.scene.add.text(rightColX, statRowY, 'Kills', statLabelStyle).setOrigin(0.5).setDepth(depth);
    const killValue = this.scene.add.text(rightColX, statRowY + 16, '0', statValueStyle).setOrigin(0.5).setDepth(depth);
    animatedElements.push(killLabel, killValue);

    statRowY += statRowSpacing + 16;

    // Row 2: Level & Combo
    const levelLabel = this.scene.add.text(leftColX, statRowY, 'Level', statLabelStyle).setOrigin(0.5).setDepth(depth);
    const levelValue = this.scene.add.text(leftColX, statRowY + 16, '0', statValueStyle).setOrigin(0.5).setDepth(depth);
    animatedElements.push(levelLabel, levelValue);

    if (data.highestCombo > 0) {
      const comboLabel = this.scene.add.text(rightColX, statRowY, 'Best Combo', statLabelStyle).setOrigin(0.5).setDepth(depth);
      const comboValue = this.scene.add.text(rightColX, statRowY + 16, '0', { ...statValueStyle, color: '#ffdd44' }).setOrigin(0.5).setDepth(depth);
      animatedElements.push(comboLabel, comboValue);

      // Combo count-up (delayed to appear after stagger)
      this.countUpStats.push({ text: comboValue, target: data.highestCombo });
    }

    // Track count-up targets
    this.countUpStats.push(
      { text: killValue, target: data.killCount },
      { text: levelValue, target: data.playerLevel },
    );

    statRowY += statRowSpacing + 16;

    // Row 3: Damage dealt & taken
    if (data.totalDamageDealt !== undefined || data.totalDamageTaken !== undefined) {
      const dmgDealt = formatLargeNumber(data.totalDamageDealt ?? 0);
      const dmgTaken = formatLargeNumber(data.totalDamageTaken ?? 0);
      const damageText = this.scene.add.text(
        centerX, statRowY,
        `Dealt: ${dmgDealt}  |  Taken: ${dmgTaken}`,
        { fontSize: '13px', color: '#777799', fontFamily: 'Arial' }
      ).setOrigin(0.5).setDepth(depth);
      animatedElements.push(damageText);
      statRowY += 20;
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
      fontFamily: 'Arial',
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
        fontFamily: 'Arial',
      }).setOrigin(0.5).setDepth(depth);
      animatedElements.push(streakDisplay);
    }

    // Restart hint
    const isTouchDevice = this.scene.input.manager.touch !== null && this.scene.sys.game.device.input.touch;
    const restartHint = isTouchDevice ? 'Tap to restart' : 'Press SPACE to restart';
    const restartText = this.scene.add.text(centerX, centerY + 165, restartHint, {
      fontSize: '20px',
      color: '#888888',
      fontFamily: 'Arial',
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
            stat.text.setText(String(stat.target));
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
        this.scene.add.text(centerX, centerY + 110, affordLabel, {
          fontSize: '16px',
          color: affordColor,
          fontFamily: 'Arial',
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
  }

  /**
   * Cleans up all keyboard handlers and destroys any visible overlays.
   * Must be called when the scene shuts down.
   */
  public destroy(): void {
    // Remove pause menu keyboard handler
    if (this.pauseMenuKeyHandler) {
      this.scene.input.keyboard?.off('keydown', this.pauseMenuKeyHandler);
      this.pauseMenuKeyHandler = null;
    }

    // Remove shop confirmation keyboard handler
    if (this.shopConfirmKeyHandler) {
      this.scene.input.keyboard?.off('keydown', this.shopConfirmKeyHandler);
      this.shopConfirmKeyHandler = null;
    }

    // Remove victory keyboard handlers (if victory overlay was showing)
    if (this.victoryContinueHandler) {
      this.scene.input.keyboard?.off('keydown-C', this.victoryContinueHandler);
      this.victoryContinueHandler = null;
    }
    if (this.victoryNextWorldHandler) {
      this.scene.input.keyboard?.off('keydown-N', this.victoryNextWorldHandler);
      this.victoryNextWorldHandler = null;
    }

    // Remove game over keyboard/pointer handlers
    if (this.gameOverRestartHandler) {
      this.scene.input.keyboard?.off('keydown-SPACE', this.gameOverRestartHandler);
      this.scene.input.off('pointerdown', this.gameOverRestartHandler);
      this.gameOverRestartHandler = null;
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
