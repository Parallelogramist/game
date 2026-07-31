import Phaser from 'phaser';
import { getMetaProgressionManager } from '../../meta/MetaProgressionManager';
import { getAscensionManager } from '../../meta/AscensionManager';
import { getGameStateManager } from '../../save/GameStateManager';
import { MenuNavigator } from '../../input/MenuNavigator';
import { SoundManager } from '../../audio/SoundManager';
import { addButtonInteraction } from '../../utils/SceneTransition';
import { WeaponRunStats } from '../../weapons/WeaponManager';
import { WeaponSynergy } from '../../data/WeaponSynergies';
import { deriveBuildStats, orderThreatsByDamage, type DamageSourceTally } from './buildStats';
import { layoutRunTimeline, TIMELINE_KIND_ORDER, type RunTimelineEvent, type RunTimelineEventKind } from './runTimeline';
import { UnlockProgressEntry } from '../../meta/HiddenUnlocks';
import { RunSummary } from '../../meta/RunHistoryManager';
import { ACCENT_COLORS, ACCENT_COLORS_STR, BODY_COLORS, MENU_COLORS, DISPLAY_FONT } from '../../visual/MenuStyle';
import { getSettingsManager } from '../../settings';
import { OverlayDepths } from '../../visual/DepthLayers';
import { formatDailyShareText, DailyShareInput } from '../../meta/DailyShare';
import { copyTextToClipboard } from '../../utils/Clipboard';
import { getDailyQuestBoard, getLiveDailyQuestBoard, previewDailyQuestSettle, settleDailyQuests, claimDailyQuestGold, type DailyQuestProgress } from '../../meta/DailyQuestManager';
import { DAILY_QUEST_COUNT, formatQuestValue, type DailyQuestDefinition, type DailyQuestRunData } from '../../data/DailyQuests';
import { summarizeRunPace } from '../../meta/PaceGhostManager';
import { computeRunNetGold, formatRunEconomyLine } from '../../meta/RunEconomy';
import { buildRunEarnings, formatRunEarningsLine, type RunEarning, type RunEarningSources, type RunEarningTag } from '../../meta/RunEarnings';

/**
 * Paint a sharp menu panel: soft shadow + dark navy body + thin accent
 * border + hairline accent across the top — the same family as the
 * BootScene cards.
 */
function paintPanelBackground(
  graphics: Phaser.GameObjects.Graphics,
  topLeftX: number,
  topLeftY: number,
  width: number,
  height: number,
  _opts: { withPanelBreaks?: boolean; accentColor?: number } = {}
): void {
  const radius = 6;
  const accent = _opts.accentColor ?? ACCENT_COLORS.primary;

  // Soft drop shadow directly beneath the panel.
  graphics.fillStyle(0x000000, 0.4);
  graphics.fillRoundedRect(topLeftX, topLeftY + 4, width, height, radius + 2);

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
 * Paint a sharp pill button: soft shadow + accent border + body fill + thin
 * top accent line. Drawn into a fresh graphics layer behind the provided
 * rectangle so the rectangle stays as the interactive hit zone.
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
  const radius = Math.min(height * 0.25, 8);
  // 2px accent ring. The body sits `BORDER` px inside it, so the body's corner
  // radius shrinks by the same amount to keep the two arcs concentric —
  // otherwise the body's corners overrun the border's curve and read as sharp.
  const BORDER = 2;
  const bodyRadius = Math.max(0, radius - BORDER);

  graphics.clear();

  // Soft drop shadow.
  graphics.fillStyle(0x000000, 0.4);
  graphics.fillRoundedRect(centerX - halfW, centerY - halfH + 3, width, height, radius + 1);

  // Accent border (rounded). This is also the focus/hover indicator — repainted
  // white when a button is focused (see createLabeledButton's setStrokeStyle shim).
  graphics.fillStyle(accentColor, 1);
  graphics.fillRoundedRect(centerX - halfW - BORDER, centerY - halfH - BORDER, width + BORDER * 2, height + BORDER * 2, radius);

  // Body fill (radius reduced by the border width so its corners nest inside the border).
  graphics.fillStyle(bodyColor, 1);
  graphics.fillRoundedRect(centerX - halfW, centerY - halfH, width, height, bodyRadius);

  // Hairline top accent, inset past the rounded corners so it never
  // overruns them.
  graphics.fillStyle(accentColor, 0.7);
  graphics.fillRect(centerX - halfW + radius, centerY - halfH + 2, width - radius * 2, 2);

  // Bottom inner shadow — same corner-safe inset.
  graphics.fillStyle(0x000000, 0.25);
  graphics.fillRect(centerX - halfW + radius, centerY + halfH - 3, width - radius * 2, 2);
}

void MENU_COLORS;
void ACCENT_COLORS_STR;

// Shared stat-cell typography for the two end screens (game over + victory).
// One definition so the label/value treatment can't drift between them.
const END_STAT_LABEL_STYLE = {
  fontSize: '13px',
  color: '#8898b0',
  fontFamily: '"Atkinson Hyperlegible", Arial, sans-serif',
} as const;
const END_STAT_VALUE_STYLE = {
  fontSize: '20px',
  color: '#e8ecf4',
  fontFamily: DISPLAY_FONT,
  fontStyle: 'bold',
} as const;

// Top-most UI layer — above the HUD, minimap, off-screen arrows, intro
// overlays, and tooltips.
const PAUSE_MENU_DEPTH = OverlayDepths.PAUSE_MENU;

/**
 * Rarity accent colors for the end-screen card reveal. Mirrors
 * getRelicRarityColor (src/data/Relics.ts) / getCardRarityColor
 * (src/data/Cards.ts) — duplicated locally because the end screens render
 * cards structurally (see GameOverData/VictoryData.discoveredCard) and must
 * not couple this manager to the card data module.
 */
const CARD_RARITY_ACCENTS: Record<'common' | 'rare' | 'epic' | 'legendary', number> = {
  common: 0xaaaaaa,
  rare: 0x4488ff,
  epic: 0xcc44ff,
  legendary: 0xffaa22,
};

function colorToHexString(color: number): string {
  return `#${color.toString(16).padStart(6, '0')}`;
}

function formatLargeNumber(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '0';
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1)}B`;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(Math.floor(n));
}

function formatTime(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const remainderSeconds = Math.floor(seconds % 60);
  return `${minutes}:${remainderSeconds.toString().padStart(2, '0')}`;
}

/**
 * Compact bonus readout for an active synergy on the build dashboard, e.g.
 * "+30% dmg", "+15% spd", or both. Each synergy multiplier is applied to both
 * weapons in the pair; this surfaces the magnitude the player is gaining so the
 * synergy is no longer an invisible buff.
 */
function formatSynergyBonus(synergy: WeaponSynergy): string {
  const parts: string[] = [];
  if (synergy.damageMultiplier > 1) {
    parts.push(`+${Math.round((synergy.damageMultiplier - 1) * 100)}% dmg`);
  }
  if (synergy.cooldownMultiplier < 1) {
    parts.push(`+${Math.round((1 - synergy.cooldownMultiplier) * 100)}% spd`);
  }
  return parts.length > 0 ? parts.join('  ') : 'active';
}

/** Formats unlock progress as "current/target" with units hinted by target size. */
function formatProgressText(current: number, target: number): string {
  const fmt = target >= 10_000
    ? formatLargeNumber
    : (n: number) => String(Math.floor(n));
  return `${fmt(current)} / ${fmt(target)}`;
}

/** One quest's right-column readout: `DONE`, `7:12 / 10:00`, or `312 / 400`. */
function formatQuestProgress(entry: DailyQuestProgress): string {
  if (entry.complete) return 'DONE';
  if (entry.quest.format === 'time') {
    return `${formatQuestValue(entry.quest, entry.value)} / ${formatQuestValue(entry.quest, entry.quest.target)}`;
  }
  return formatProgressText(entry.value, entry.quest.target);
}

export interface PauseMenuOptions {
  onPauseStateChanged: (isPaused: boolean) => void;
  onRestart: () => void;
  onRematch: () => void;
  onQuitToMenu: () => void;
  onQuitToShop: (goldEarned: number) => void;
  /**
   * Ending a run IS a run end, so it must write every record a death writes. Only
   * GameScene holds the run state those records need, so it owns the recording.
   * Returns what the recording earned, because the unlock/achievement toasts it
   * raises draw at OverlayDepths.HUD, under this dialog, and are never seen.
   */
  onRecordRunEnd: (goldEarned: number) => Pick<RunEarningSources, 'unlocks' | 'achievements'>;
  onOpenSettings: () => void;
  /** Expedition only: whether the current mode has a world map. Decides the MAP row. */
  hasWorldMap?: () => boolean;
  /** Opens the world map; called after the menu has hidden itself and cleared the pause. */
  onOpenMap?: () => void;
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
  /** Per-weapon run stats, for the live build dashboard on the pause overlay. */
  weaponStats: WeaponRunStats[];
  /** Total damage the player has taken this run (build dashboard). */
  totalDamageTaken: number;
  /** Damage taken this run bucketed by what dealt it (build dashboard). */
  damageBySource: DamageSourceTally[];
  /** Currently-active weapon synergies, listed on the build dashboard. */
  activeSynergies?: WeaponSynergy[];
  /** Total damage the player has dealt this run (live daily-quest board). */
  totalDamageDealt: number;
  /** Highest combo reached this run (live daily-quest board). */
  highestCombo: number;
  /** True in the practice sandbox, which never moves the day's quest board. */
  practiceModeActive: boolean;
  /** Ship/stage/pact/relic/blessing/modifier gold bonus — the run-scoped multiplier both run-end payouts apply. */
  runGoldMultiplier: number;
}

export interface VictoryData {
  killCount: number;
  gameTime: number;
  playerLevel: number;
  goldEarned: number;
  /** What the run itself moved through the wallet, snapshotted before the quest settle. */
  goldLedger?: { earned: number; spent: number };
  /** Daily-quest gold settled at run end. */
  questGold?: number;
  /** What the run's end earned (see GameOverData.runEarnings). */
  runEarnings?: RunEarning[];
  clearedWorld: number;
  newWorldLevel: number;
  previousStreak: number;
  newStreak: number;
  streakBonusPercent: number;
  /** Relic unlocked by a first-ever kill of this run's boss (FEAT-BOSS-TROPHY). */
  trophyUnlockedName?: string;
  /** S–F performance grade for this run (parity with the game-over overlay). */
  performanceGrade?: { grade: string; color: string };
  /** Card discovered from an in-run data cache — revealed on this screen. */
  discoveredCard?: { id: string; name: string; description: string; rarity: 'common' | 'rare' | 'epic' | 'legendary'; icon: string } | null;
  /** Composite run score + persisted best (by world level). */
  runScore?: number;
  bestScore?: number;
  isNewBest?: boolean;
  /** Prior runs (newest-first) for the "RECENT" trend strip. */
  recentRuns?: RunSummary[];
  /** Daily/weekly challenge result — presents the COPY RESULT button. Undefined on standard runs. */
  daily?: DailyShareInput;
}

const TIMELINE_MARKER_COLORS: Record<RunTimelineEventKind, number> = {
  level: 0x66aaff,
  ultimate: 0x44ffff,
  miniboss: 0xffaa44,
  boss: 0xff66ff,
  bossDown: 0x44ff88,
  closeCall: 0xff4444,
};

const TIMELINE_LEGEND_LABELS: Record<RunTimelineEventKind, string> = {
  level: 'LEVEL',
  ultimate: 'ULT',
  miniboss: 'MINIBOSS',
  boss: 'BOSS',
  bossDown: 'KILLED',
  closeCall: 'HURT',
};

const RUN_EARNING_TAG_COLORS: Record<RunEarningTag, string> = {
  SHIP: '#66ccff',
  WEAPON: '#ff9944',
  STAGE: '#88ff99',
  COSMETIC: '#cc99ff',
  ACHIEVEMENT: '#ffdd44',
  QUEST: '#ffe26a',
};

/**
 * Below this width the death-screen recap surfaces cannot use the side margins or
 * the below-column slots (both are spoken for at portrait widths) and move into the
 * free band above the title glow instead. Portrait is 720–1280 game units wide under
 * EXPAND; landscape is never below 1280.
 */
const NARROW_RECAP_MAX_WIDTH = 1000;

export interface GameOverData {
  killCount: number;
  gameTime: number;
  playerLevel: number;
  goldEarned: number;
  /**
   * What the run itself moved through the wallet, snapshotted before the end-of-run
   * payout landed. Not persisted — a reload-restored run reports zeroes and the row
   * hides, same as `totalDamageTaken`.
   */
  goldLedger?: { earned: number; spent: number };
  /** Daily-quest gold settled at run end — paid after the ledger snapshot, so it is in no other number. */
  questGold?: number;
  /**
   * What the run's end earned: hidden unlocks, achievements and settled daily quests.
   * Their toasts draw at OverlayDepths.HUD, underneath this overlay, so this is the
   * only surface that reports them.
   */
  runEarnings?: RunEarning[];
  previousStreak: number;
  highestCombo: number;
  totalDamageDealt?: number;
  totalDamageTaken?: number;
  /** Per-source damage-taken tally for the run-end threat panel. Ordered + shared there. */
  damageBySource?: DamageSourceTally[];
  /** Attribution bucket of the lethal hit. Undefined/null when the run ended without one. */
  killedBy?: string | null;
  /** The hunter the next run will field, if this death planted one. */
  nemesis?: { name: string; grudge: number } | null;
  /**
   * Pace-vs-ghost recap. `ghost` is the curve the run RACED (captured at run
   * start), not a re-read — a new best has already replaced the stored one.
   */
  pace?: {
    ghost: number[] | null;
    runSamples: number[];
    ghostReplaced: boolean;
  };
  /** Boss-tier target the run can re-fight in PRACTICE. Undefined = no REMATCH action. */
  rematch?: { targetName: string };
  /** Per-run beat log for the RUN TIMELINE ribbon. Undefined for a restored run. */
  runTimeline?: RunTimelineEvent[];
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
  /** Card discovered from an in-run data cache — revealed on this screen. */
  discoveredCard?: { id: string; name: string; description: string; rarity: 'common' | 'rare' | 'epic' | 'legendary'; icon: string } | null;
  /** Composite run score + persisted best (by world level). */
  runScore?: number;
  bestScore?: number;
  isNewBest?: boolean;
  /** Prior runs (newest-first) for the "RECENT" trend strip. */
  recentRuns?: RunSummary[];
  /** GAUNTLET mode result — replaces the score line with the wave reached. */
  gauntlet?: { wave: number; bestWave: number; isNewBest: boolean };
  /** Post-victory ENDLESS result — the score line also carries the cycle reached. */
  endless?: { cycle: number; bestCycle: number; isNewBest: boolean };
  /** Daily/weekly challenge result — presents the COPY RESULT button. Undefined on standard runs. */
  daily?: DailyShareInput;
}

export class PauseMenuManager {
  private scene: Phaser.Scene;
  private options: PauseMenuOptions;
  private soundManager: SoundManager;

  // Pause menu state (separate from isPaused which is used for upgrades/victory)
  public isPauseMenuOpen: boolean = false;

  // Shop confirmation state
  public isShopConfirmationOpen: boolean = false;

  /** createRunEarningsPanel builds a variable number of objects and names none, so the
   *  END RUN earnings panel is torn down by reference rather than by name. */
  private endRunEarnedElements: (Phaser.GameObjects.Text | Phaser.GameObjects.Graphics)[] = [];

  // Count-up animation targets for run summary
  private countUpStats: { text: Phaser.GameObjects.Text; target: number }[] = [];
  /** END RUN confirm dialog + the RUN ENDED panel that replaces it; only one is ever alive. */
  private endRunNavigator: MenuNavigator | null = null;

  // Pause menu keyboard + gamepad navigation
  private pauseMenuNavigator: MenuNavigator | null = null;

  // Victory choice handlers (for cleanup)
  private victoryContinueHandler: (() => void) | null = null;
  private victoryNextWorldHandler: (() => void) | null = null;
  /** Victory stat-cell texts — collector-torn-down (see addVictoryCell). */
  private victoryStatCellElements: Phaser.GameObjects.Text[] = [];
  private gameOverRestartHandler: (() => void) | null = null;
  private gameOverRematchHandler: (() => void) | null = null;
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
      // createLabeledButton paints each pill into a sibling Graphics named
      // `<bgName>_gfx` at PAUSE_MENU + 0.5. Destroying only the (transparent) hit-zone
      // rectangle leaves the painted pill on screen above every overlay, and a fresh
      // one is added on each re-open.
      for (const target of [name, `${name}_gfx`]) {
        const element = this.scene.children.getByName(target);
        if (element) {
          // Infinite tweens (pause-title pulse, victory breathe) outlive their
          // target otherwise — destroy() never detaches a tween from its target.
          this.scene.tweens.killTweensOf(element);
          element.destroy();
        }
      }
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
    // Pill button: a graphics layer paints the shadow / accent border / body /
    // banner stripe; the Rectangle stays as the hit zone (kept fully transparent).
    const pillGfx = this.scene.add.graphics();
    pillGfx.setDepth(PAUSE_MENU_DEPTH + 0.5).setScrollFactor(0);
    pillGfx.setName(`${params.bgName}_gfx`);
    paintPillBackground(pillGfx, params.x, params.y, params.width, params.height, params.baseColor, params.strokeColor);

    const bg = this.scene.add.rectangle(params.x, params.y, params.width, params.height, params.baseColor, 0);
    bg.setStrokeStyle(0);
    bg.setInteractive({ useHandCursor: true });
    bg.setDepth(PAUSE_MENU_DEPTH + 1).setScrollFactor(0);
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
    text.setDepth(PAUSE_MENU_DEPTH + 2).setScrollFactor(0);
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
   * COPY RESULT pill for a finished daily/weekly run.
   *
   * The game-over screen restarts the run on a scene-level `pointerdown`, so
   * this button's own down-handler must cancel the event: Phaser only emits the
   * scene-level POINTER_DOWN when no game-object handler called
   * stopPropagation (InputPlugin.processDownEvents). Without it, tapping COPY
   * RESULT would copy AND instantly restart.
   */
  private createDailyShareButton(
    share: DailyShareInput,
    x: number,
    y: number,
    width: number,
    height: number,
    fontSize: string,
    bgName: string,
    textName: string
  ): { bg: Phaser.GameObjects.Rectangle; text: Phaser.GameObjects.Text } {
    const shareText = formatDailyShareText(share);
    const button = this.createLabeledButton({
      x,
      y,
      width,
      height,
      label: 'COPY RESULT',
      fontSize,
      baseColor: 0x2a8f84,
      hoverColor: 0x35a89c,
      strokeColor: 0x66ddcc,
      bgName,
      textName,
      onActivate: () => {
        void copyTextToClipboard(shareText).then((copied) => {
          // The victory overlay's CONTINUE destroys this label while the scene
          // keeps running, so both the result and the revert must re-check it.
          if (!button.text.active) return;
          button.text.setText(copied ? 'COPIED!' : 'COPY FAILED');
          this.scene.time.delayedCall(2000, () => {
            if (!button.text.active) return;
            button.text.setText('COPY RESULT');
          });
        });
      },
    });
    button.bg.on(
      'pointerdown',
      (_pointer: Phaser.Input.Pointer, _x: number, _y: number, event?: Phaser.Types.Input.EventData) => {
        event?.stopPropagation();
      }
    );
    return button;
  }

  /**
   * REMATCH pill — practices the boss-tier enemy the run died to. Cancels its own
   * pointerdown for the same reason createDailyShareButton does: the game-over
   * screen restarts on a scene-level pointerdown, so without stopPropagation a tap
   * would launch the rematch AND restart the run underneath it.
   */
  private createRematchButton(
    targetName: string,
    x: number,
    y: number,
    width: number,
    height: number
  ): void {
    const button = this.createLabeledButton({
      x,
      y,
      width,
      height,
      label: `REMATCH ${targetName.toUpperCase()}`,
      fontSize: '15px',
      baseColor: 0x8f2a3a,
      hoverColor: 0xa83545,
      strokeColor: 0xdd6677,
      bgName: 'gameOverRematchButtonBg',
      textName: 'gameOverRematchButtonText',
      onActivate: () => this.options.onRematch(),
    });
    button.bg.on(
      'pointerdown',
      (_pointer: Phaser.Input.Pointer, _x: number, _y: number, event?: Phaser.Types.Input.EventData) => {
        event?.stopPropagation();
      }
    );
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
    overlay.setDepth(PAUSE_MENU_DEPTH).setScrollFactor(0);
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

    // Pause title — display style.
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
    pauseTitle.setDepth(PAUSE_MENU_DEPTH + 1).setScrollFactor(0);
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
      `Gold: ${metaManager.getGold().toLocaleString('en-US')}`,
      {
        fontSize: '24px',
        color: '#ffcc00',
        fontFamily: '"Atkinson Hyperlegible", Arial, sans-serif',
      }
    );
    pauseGoldDisplay.setOrigin(0.5);
    pauseGoldDisplay.setDepth(PAUSE_MENU_DEPTH + 1).setScrollFactor(0);
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

    // World Map button (expedition only, between Resume and Settings). Touch has no free
    // physical button, so without this row a phone cannot open the map at all.
    const mapRowVisible = this.options.hasWorldMap?.() === true
      && this.options.onOpenMap !== undefined;
    const mapBaseColor = 0x4a3a7a;
    const mapHoverColor = 0x6a55aa;
    let mapButtonBg: Phaser.GameObjects.Rectangle | null = null;
    let mapButtonText: Phaser.GameObjects.Text | null = null;
    if (mapRowVisible) {
      const created = this.createLabeledButton({
        x: buttonCenterX, y: resumeButtonY + buttonSpacing,
        width: resumeButtonWidth, height: resumeButtonHeight,
        label: '◈  World Map', fontSize: '24px',
        baseColor: mapBaseColor, hoverColor: mapHoverColor, strokeColor: 0x8877cc,
        bgName: 'mapButtonBg', textName: 'mapButtonText',
        onActivate: () => { this.hidePauseMenu(); this.options.onOpenMap!(); },
      });
      mapButtonBg = created.bg;
      mapButtonText = created.text;
    }

    // Settings button (64px below resume, or below the map row when it exists)
    const settingsButtonY = resumeButtonY + buttonSpacing * (mapRowVisible ? 2 : 1);
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
    hintText.setDepth(PAUSE_MENU_DEPTH + 1).setScrollFactor(0);
    hintText.setName('pauseHintText');

    // Run modifiers panel (right side)
    const runModifiersElements = this.createRunModifiersPanel();

    // Live build dashboard (left side) — DPS / crit % / kills-min / damage taken
    // and the top weapons by damage, so a build can be inspected mid-run.
    const buildStatsElements = this.createBuildStatsPanel();

    // Today's quest board (top centre). Faded in on its own short stagger rather
    // than appended to `animatedElements`: the shared stagger's delay also gates
    // when the buttons become interactive, and eight more elements would lock
    // them for an extra ~280 ms every time the game is paused.
    const dailyQuestElements = this.createDailyQuestsPanel();
    dailyQuestElements.forEach((element, index) => {
      element.setAlpha(0);
      this.scene.tweens.add({
        targets: element,
        alpha: 1,
        duration: 85,
        delay: index * 12,
        ease: 'Sine.easeOut',
      });
    });

    // Keyboard + gamepad navigation for pause menu
    const pauseButtons = [
      { bg: resumeButtonBg, action: () => this.hidePauseMenu(), baseColor: resumeBaseColor, hoverColor: resumeHoverColor },
      ...(mapButtonBg ? [
        { bg: mapButtonBg, action: () => { this.hidePauseMenu(); this.options.onOpenMap!(); }, baseColor: mapBaseColor, hoverColor: mapHoverColor },
      ] : []),
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
      ...(mapButtonBg && mapButtonText ? [mapButtonBg, mapButtonText] : []),
      settingsButtonBg, settingsButtonText,
      restartButtonBg, restartButtonText,
      quitMenuButtonBg, quitMenuButtonText,
      quitShopButtonBg, quitShopButtonText,
      hintText,
      ...runModifiersElements,
      ...buildStatsElements,
    ];
    // Disable buttons during stagger to prevent addButtonInteraction's killTweensOf
    // from canceling the alpha fade-in tween on hover
    const interactiveButtons = [resumeButtonBg, settingsButtonBg, restartButtonBg, quitMenuButtonBg, quitShopButtonBg];
    if (mapButtonBg) interactiveButtons.push(mapButtonBg);
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
      'mapButtonBg',
      'mapButtonText',
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
      'buildStatsTitle',
      'buildStatsBg',
      'buildStatsSummary',
      'buildStatsWeapons',
      'dailyQuestsBg',
      'dailyQuestsTitle',
      ...Array.from({ length: DAILY_QUEST_COUNT }, (_, index) => `dailyQuestName${index}`),
      ...Array.from({ length: DAILY_QUEST_COUNT }, (_, index) => `dailyQuestValue${index}`),
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

    // Blessing — which ones were rolled shows in the HUD strip; this is the count.
    const blessingCount = metaManager.getStartingBlessingCount();
    if (blessingCount > 0) {
      lines.push({ label: `Blessing ${blessingCount}`, value: `${blessingCount} random bonus`, color: '#88ff88' });
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

    // Narrow (portrait) viewports: the side columns would overlap the
    // centered buttons, so the two dashboards sit side-by-side BELOW the
    // button stack instead (bottom button ends at centerY+249; height ≥1280).
    const narrow = this.scene.scale.width < 900;
    const panelX = narrow ? this.scene.scale.width / 2 + 130 : this.scene.scale.width * 0.82;
    const panelTopY = narrow ? this.scene.scale.height / 2 + 268 : this.scene.scale.height / 2 - 144;
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
    panelBg.setDepth(PAUSE_MENU_DEPTH + 1).setScrollFactor(0);
    panelBg.setName('runModifiersBg');

    // Title
    const titleText = this.scene.add.text(panelX, panelTopY + 4, 'RUN MODIFIERS', {
      fontSize: '14px',
      color: '#aaaacc',
      fontFamily: '"Atkinson Hyperlegible", Arial, sans-serif',
      fontStyle: 'bold',
    });
    titleText.setOrigin(0.5, 0);
    titleText.setDepth(PAUSE_MENU_DEPTH + 2).setScrollFactor(0);
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
    modifiersText.setDepth(PAUSE_MENU_DEPTH + 2).setScrollFactor(0);
    modifiersText.setName('runModifiersText');

    return [panelBg, titleText, modifiersText];
  }

  /**
   * Creates the live build dashboard on the left side of the pause overlay:
   * headline DPS / crit % / kills-per-minute / damage taken, plus the top
   * weapons by damage with each weapon's share. Lets a player answer "which
   * weapon is carrying?" mid-run, not just on the results screen. Built from a
   * two-column pair of text objects (left labels, right values) so the columns
   * align without one named game object per cell.
   * Returns the created game objects for inclusion in the stagger animation.
   */
  private createBuildStatsPanel(): (Phaser.GameObjects.Graphics | Phaser.GameObjects.Text)[] {
    const gameState = this.options.getGameState();
    const stats = deriveBuildStats({
      weaponStats: gameState.weaponStats ?? [],
      gameTimeSeconds: gameState.gameTime,
      killCount: gameState.killCount,
      totalDamageTaken: gameState.totalDamageTaken ?? 0,
      damageBySource: gameState.damageBySource ?? [],
    });

    const formatPercent = (rate: number): string => `${Math.round(rate * 100)}%`;

    // Two parallel columns: left = labels, right = values. Same line index ⇒
    // same row, so they read as an aligned table.
    const leftLines: string[] = ['DPS', 'Crit', 'Kills/min', 'Dmg Taken'];
    const rightLines: string[] = [
      formatLargeNumber(stats.dps),
      formatPercent(stats.critRate),
      String(Math.round(stats.killsPerMinute)),
      formatLargeNumber(stats.totalDamageTaken),
    ];

    if (stats.topWeapons.length > 0) {
      leftLines.push('', 'TOP WEAPONS');
      rightLines.push('', '');
      for (const weapon of stats.topWeapons) {
        leftLines.push(weapon.weaponName);
        rightLines.push(`${formatLargeNumber(weapon.totalDamage)}  ${formatPercent(weapon.damageShare)}`);
      }
    } else {
      leftLines.push('', 'No damage yet');
      rightLines.push('', '');
    }

    // Active weapon synergies — otherwise an invisible build layer. Shows the
    // player which weapon pairs are buffing each other and by how much, so the
    // pause dashboard answers "what is my build actually doing?" in full.
    const activeSynergies = (gameState.activeSynergies ?? []).slice(0, 4);
    if (activeSynergies.length > 0) {
      leftLines.push('', 'SYNERGIES');
      rightLines.push('', '');
      for (const synergy of activeSynergies) {
        leftLines.push(synergy.name);
        rightLines.push(formatSynergyBonus(synergy));
      }
    }

    // Defensive mirror of TOP WEAPONS: what is actually taking the player's HP.
    if (stats.topThreats.length > 0) {
      leftLines.push('', 'TOP THREATS');
      rightLines.push('', '');
      for (const threat of stats.topThreats) {
        leftLines.push(threat.sourceName);
        rightLines.push(`${formatLargeNumber(threat.totalDamage)}  ${formatPercent(threat.damageShare)}`);
      }
    }

    const lineCount = leftLines.length;
    const lineHeight = 20;
    // Mirrors the run-modifiers panel: below the buttons on narrow viewports.
    const narrow = this.scene.scale.width < 900;
    const panelX = narrow ? this.scene.scale.width / 2 - 130 : this.scene.scale.width * 0.18;
    const panelTopY = narrow ? this.scene.scale.height / 2 + 268 : this.scene.scale.height / 2 - 144;
    const panelWidth = 220;
    const panelHeight = lineCount * lineHeight + 40;
    const contentLeftX = panelX - panelWidth / 2;
    const contentRightX = panelX + panelWidth / 2;
    const contentTopY = panelTopY + 26;

    // Panel background
    const panelBg = this.scene.add.graphics();
    paintPanelBackground(
      panelBg,
      panelX - panelWidth / 2 - 12,
      panelTopY - 10,
      panelWidth + 24,
      panelHeight,
    );
    panelBg.setDepth(PAUSE_MENU_DEPTH + 1).setScrollFactor(0);
    panelBg.setName('buildStatsBg');

    // Title
    const titleText = this.scene.add.text(panelX, panelTopY + 4, 'BUILD STATS', {
      fontSize: '14px',
      color: '#aaaacc',
      fontFamily: '"Atkinson Hyperlegible", Arial, sans-serif',
      fontStyle: 'bold',
    });
    titleText.setOrigin(0.5, 0);
    titleText.setDepth(PAUSE_MENU_DEPTH + 2).setScrollFactor(0);
    titleText.setName('buildStatsTitle');

    // Left column: labels (and weapon names).
    const summaryText = this.scene.add.text(contentLeftX, contentTopY, leftLines.join('\n'), {
      fontSize: '13px',
      color: '#ccccdd',
      fontFamily: '"Atkinson Hyperlegible", Arial, sans-serif',
      lineSpacing: 4,
    });
    summaryText.setOrigin(0, 0);
    summaryText.setDepth(PAUSE_MENU_DEPTH + 2).setScrollFactor(0);
    summaryText.setName('buildStatsSummary');

    // Right column: values, right-aligned to the panel edge.
    const valuesText = this.scene.add.text(contentRightX, contentTopY, rightLines.join('\n'), {
      fontSize: '13px',
      color: '#ffcc66',
      fontFamily: '"Atkinson Hyperlegible", Arial, sans-serif',
      lineSpacing: 4,
      align: 'right',
    });
    valuesText.setOrigin(1, 0);
    valuesText.setDepth(PAUSE_MENU_DEPTH + 2).setScrollFactor(0);
    valuesText.setName('buildStatsWeapons');

    return [panelBg, titleText, summaryText, valuesText];
  }

  /**
   * Today's daily-quest board, pinned top-centre on the pause overlay. The two
   * side dashboards own the left/right columns and the button stack owns the
   * middle, so the band above the PAUSED title is the only free space in both
   * orientations — and being fixed-height it never collides with either panel's
   * variable line count.
   *
   * Rows are one text per column per quest rather than two multi-line columns
   * (the BUILD STATS idiom) so a completed row can be coloured on its own without
   * depending on font line metrics for alignment.
   * Returns the created game objects for the caller's fade-in.
   */
  private createDailyQuestsPanel(): (Phaser.GameObjects.Graphics | Phaser.GameObjects.Text)[] {
    const gameState = this.options.getGameState();
    // Practice never settles into the day's board, so folding a sandbox run in
    // would show progress the run can never bank.
    const board = gameState.practiceModeActive
      ? getDailyQuestBoard()
      : getLiveDailyQuestBoard({
          wasVictory: false,
          killCount: gameState.killCount,
          levelReached: gameState.playerLevel,
          survivalTimeSeconds: gameState.gameTime,
          damageDealt: gameState.totalDamageDealt,
          damageTaken: gameState.totalDamageTaken,
          goldEarned: 0,
          highestCombo: gameState.highestCombo,
        });

    const completeCount = board.filter((entry) => entry.complete).length;

    const lineHeight = 20;
    const panelWidth = 300;
    const panelX = this.scene.scale.width / 2;
    const panelTopY = 56;
    const panelHeight = board.length * lineHeight + 40;
    const contentLeftX = panelX - panelWidth / 2;
    const contentRightX = panelX + panelWidth / 2;
    const contentTopY = panelTopY + 26;

    const panelBg = this.scene.add.graphics();
    paintPanelBackground(
      panelBg,
      panelX - panelWidth / 2 - 12,
      panelTopY - 10,
      panelWidth + 24,
      panelHeight,
    );
    panelBg.setDepth(PAUSE_MENU_DEPTH + 1).setScrollFactor(0);
    panelBg.setName('dailyQuestsBg');

    const titleText = this.scene.add.text(
      panelX,
      panelTopY + 4,
      `DAILY QUESTS  ${completeCount}/${board.length}`,
      {
        fontSize: '14px',
        color: '#aaaacc',
        fontFamily: '"Atkinson Hyperlegible", Arial, sans-serif',
        fontStyle: 'bold',
      },
    );
    titleText.setOrigin(0.5, 0);
    titleText.setDepth(PAUSE_MENU_DEPTH + 2).setScrollFactor(0);
    titleText.setName('dailyQuestsTitle');

    const elements: (Phaser.GameObjects.Graphics | Phaser.GameObjects.Text)[] = [panelBg, titleText];

    board.forEach((entry, index) => {
      const rowY = contentTopY + index * lineHeight;

      const nameText = this.scene.add.text(contentLeftX, rowY, entry.quest.name, {
        fontSize: '13px',
        color: entry.complete ? '#88ff88' : '#ccccdd',
        fontFamily: '"Atkinson Hyperlegible", Arial, sans-serif',
      });
      nameText.setOrigin(0, 0);
      nameText.setDepth(PAUSE_MENU_DEPTH + 2).setScrollFactor(0);
      nameText.setName(`dailyQuestName${index}`);

      const valueText = this.scene.add.text(contentRightX, rowY, formatQuestProgress(entry), {
        fontSize: '13px',
        color: entry.complete ? '#88ff88' : '#ffcc66',
        fontFamily: '"Atkinson Hyperlegible", Arial, sans-serif',
        fontStyle: entry.complete ? 'bold' : 'normal',
      });
      valueText.setOrigin(1, 0);
      valueText.setDepth(PAUSE_MENU_DEPTH + 2).setScrollFactor(0);
      valueText.setName(`dailyQuestValue${index}`);

      elements.push(nameText, valueText);
    });

    return elements;
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
    // Ending a practice run banks nothing (GameScene.recordEarlyRunEnd returns empty),
    // so this dialog must neither promise gold nor pay it below.
    const practiceRun = gameState.practiceModeActive;
    const finalTotal = metaManager.calculateRunGold(
      gameState.killCount,
      gameState.gameTime,
      gameState.playerLevel,
      false,  // Same as death, no victory bonus
      gameState.runGoldMultiplier
    );

    // Ending a run IS a run end: the save is cleared and the run's gold is banked, so the
    // day's quest board must fold it in the same way death does. Previewed here (a pure
    // read) so the dialog can promise the quest gold before the player commits, and
    // settled only on Confirm so Cancel leaves the board exactly as it was.
    const endRunQuestData: DailyQuestRunData = {
      wasVictory: false,
      killCount: gameState.killCount,
      levelReached: gameState.playerLevel,
      survivalTimeSeconds: gameState.gameTime,
      damageDealt: gameState.totalDamageDealt,
      damageTaken: gameState.totalDamageTaken,
      goldEarned: finalTotal,
      highestCombo: gameState.highestCombo,
    };
    // showVictory() already folded this run into the board, and every 'sum' quest
    // counts a second fold twice, so the endless continuation must not fold again.
    // gameOver() guards its own settle the same way (`if (!this.hasWon)`).
    const questsSettledByVictory = gameState.hasWon;
    const pendingQuests = questsSettledByVictory || practiceRun ? [] : previewDailyQuestSettle(endRunQuestData);
    const pendingQuestGold = pendingQuests.reduce((sum, quest) => sum + quest.gold, 0);
    const grandTotal = finalTotal + pendingQuestGold;

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

    // Title — display style.
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
    titleText.setDepth(PAUSE_MENU_DEPTH + 1).setScrollFactor(0);
    titleText.setName('shopConfirmTitle');

    // Subtitle (56px below title)
    const subtitleText = this.scene.add.text(
      this.scene.scale.width / 2,
      dialogCenterY - 104,
      practiceRun
        ? 'Practice run. This is what it would have paid:'
        : 'You will earn the following gold:',
      {
        fontSize: '20px',
        color: '#aaaaaa',
        fontFamily: '"Atkinson Hyperlegible", Arial, sans-serif',
      }
    );
    subtitleText.setOrigin(0.5);
    subtitleText.setDepth(PAUSE_MENU_DEPTH + 1).setScrollFactor(0);
    subtitleText.setName('shopConfirmSubtitle');

    // Gold breakdown (32px below subtitle, using top-center origin for multi-line text)
    const breakdownLines = [
      `Kills: ${gameState.killCount} × 2.5 = ${killGold} gold`,
      `Time: ${Math.floor(gameState.gameTime)}s ÷ 10 = ${timeGold} gold`,
      `Level: ${gameState.playerLevel} × 10 = ${levelGold} gold`,
      `Base: ${baseTotal} gold`,
    ];

    if (gameState.runGoldMultiplier > 1) {
      breakdownLines.push(`Run Bonus: ×${gameState.runGoldMultiplier.toFixed(2)}`);
    }

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
    if (pendingQuests.length > 0) {
      breakdownLines.push(`Daily Quests: ${pendingQuests.length} complete = ${pendingQuestGold} gold`);
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
    breakdownText.setDepth(PAUSE_MENU_DEPTH + 1).setScrollFactor(0);
    breakdownText.setName('shopConfirmBreakdown');

    // The dialog grows downward from a fixed top, so a run carrying every multiplier plus
    // the quest line can push Confirm past the bottom edge of a 720-tall landscape canvas.
    // Measure the real block once and lift the whole thing by however much it overruns.
    const confirmButtonHeight = 50;
    const dialogBottomIfUnshifted =
      breakdownText.y + breakdownText.height + 24 + 48 + confirmButtonHeight;
    const dialogOverflow = Math.max(0, dialogBottomIfUnshifted - (this.scene.scale.height - 24));
    if (dialogOverflow > 0) {
      titleText.y -= dialogOverflow;
      subtitleText.y -= dialogOverflow;
      breakdownText.y -= dialogOverflow;
    }

    // Total gold (24px below breakdown bottom)
    const totalY = breakdownText.y + breakdownText.height + 24;
    const totalText = this.scene.add.text(
      this.scene.scale.width / 2,
      totalY,
      `Total: +${grandTotal} gold`,
      {
        fontSize: '32px',
        color: '#ffdd44',
        fontFamily: '"Atkinson Hyperlegible", Arial, sans-serif',
        fontStyle: 'bold',
      }
    );
    totalText.setOrigin(0.5);
    totalText.setDepth(PAUSE_MENU_DEPTH + 1).setScrollFactor(0);
    totalText.setName('shopConfirmTotal');

    // Buttons (48px below total)
    const confirmButtonWidth = 160;
    const buttonY = totalY + 48 + confirmButtonHeight / 2;

    let runEndCommitted = false;

    const { bg: confirmButtonBg } = this.createLabeledButton({
      x: this.scene.scale.width / 2 - 100, y: buttonY,
      width: confirmButtonWidth, height: confirmButtonHeight,
      label: 'Confirm', fontSize: '24px',
      baseColor: 0x44aa44, hoverColor: 0x55bb55, strokeColor: 0x66cc66,
      bgName: 'shopConfirmButtonBg', textName: 'shopConfirmButtonText',
      onActivate: () => {
        // Enter is bound on `keydown`, so an auto-repeat (or a fast double tap on
        // Confirm) re-enters this before the destination scene swaps in, paying and
        // recording the run twice.
        if (runEndCommitted) return;
        runEndCommitted = true;
        // Clear the save to prevent exploit (continuing after intentionally ending)
        getGameStateManager().clearSave();
        // Award gold and go to destination
        if (!practiceRun) {
          metaManager.addGold(finalTotal);
        }
        // Ordered as gameOver() orders it: gold banked, then the run recorded, then
        // the day's board settled.
        const recordedEarnings = this.options.onRecordRunEnd(finalTotal);
        // Then fold the run into the day's board, exactly as both run-end paths in
        // GameScene do. Claiming (rather than adding each quest's gold) also sweeps up
        // anything an earlier failed payout left pending — the same reason
        // GameScene.payDailyQuests claims.
        let settledQuests: DailyQuestDefinition[] = [];
        if (!questsSettledByVictory && !practiceRun) {
          settledQuests = settleDailyQuests(endRunQuestData);
          if (settledQuests.length > 0) {
            metaManager.addGold(claimDailyQuestGold());
          }
        }

        const goToDestination = () => {
          if (destination === 'restart') {
            this.options.onRestart();
          } else if (destination === 'shop') {
            this.options.onQuitToShop(finalTotal);
          } else {
            this.options.onQuitToMenu();
          }
        };

        // Every toast the three lines above raised draws at OverlayDepths.HUD, under
        // this dialog, into a scene torn down by the next line, so the dialog names
        // them itself. A run that earned nothing leaves immediately, as before.
        const runEarnings = buildRunEarnings({ ...recordedEarnings, quests: settledQuests });
        if (runEarnings.length === 0) {
          goToDestination();
          return;
        }
        this.showEndRunEarned(runEarnings, goToDestination);
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

    // Keyboard + gamepad navigation. showEndRunConfirmation opens by destroying the
    // pause menu's navigator, so this is the only object polling the pad while the
    // dialog is up: without it a gamepad-only player cannot answer the dialog at all.
    this.endRunNavigator = new MenuNavigator({
      scene: this.scene,
      columns: 2,
      items: [
        {
          onFocus: () => {
            confirmButtonBg.setFillStyle(0x55bb55);
            confirmButtonBg.setStrokeStyle(3, 0xffffff);
          },
          onBlur: () => {
            confirmButtonBg.setFillStyle(0x44aa44);
            confirmButtonBg.setStrokeStyle(3, 0x66cc66);
          },
          onActivate: () => confirmButtonBg.emit('pointerdown'),
        },
        {
          onFocus: () => {
            cancelButtonBg.setFillStyle(0x885555);
            cancelButtonBg.setStrokeStyle(3, 0xffffff);
          },
          onBlur: () => {
            cancelButtonBg.setFillStyle(0x664444);
            cancelButtonBg.setStrokeStyle(3, 0x886666);
          },
          onActivate: () => cancelButtonBg.emit('pointerdown'),
        },
      ],
      onCancel: () => cancelButtonBg.emit('pointerdown'),
    });
  }

  /**
   * Hides the shop confirmation dialog.
   */
  private hideShopConfirmation(): void {
    if (this.endRunNavigator) {
      this.endRunNavigator.destroy();
      this.endRunNavigator = null;
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
      'endRunEarnedTitle',
      'endRunContinueButtonBg',
      'endRunContinueButtonText',
    ]);

    for (const element of this.endRunEarnedElements) {
      this.scene.tweens.killTweensOf(element);
      element.destroy();
    }
    this.endRunEarnedElements = [];

    this.isShopConfirmationOpen = false;
  }

  /**
   * Replaces the END RUN confirm dialog with what confirming just earned. The dialog
   * cannot preview this: the unlocks, achievements and quest payouts only come into
   * existence once Confirm has run.
   */
  private showEndRunEarned(earnings: RunEarning[], onContinue: () => void): void {
    if (this.endRunNavigator) {
      this.endRunNavigator.destroy();
      this.endRunNavigator = null;
    }

    // The overlay stays, so the screen does not flash black between the two dialogs.
    this.destroyElementsByName([
      'shopConfirmTitle',
      'shopConfirmSubtitle',
      'shopConfirmBreakdown',
      'shopConfirmTotal',
      'shopConfirmButtonBg',
      'shopConfirmButtonText',
      'shopCancelButtonBg',
      'shopCancelButtonText',
    ]);

    const centerX = this.scene.scale.width / 2;
    const dialogCenterY = this.scene.scale.height / 2;

    const titleText = this.scene.add.text(centerX, dialogCenterY - 120, 'RUN ENDED', {
      fontSize: '40px',
      color: ACCENT_COLORS_STR.gold,
      fontFamily: '"Atkinson Hyperlegible", Arial, sans-serif',
      fontStyle: 'bold',
      stroke: '#000000',
      strokeThickness: 6,
    });
    titleText.setLetterSpacing(3);
    titleText.setOrigin(0.5);
    titleText.setDepth(PAUSE_MENU_DEPTH + 1).setScrollFactor(0);
    titleText.setName('endRunEarnedTitle');

    const panelBottomY = this.createRunEarningsPanel(
      earnings,
      centerX,
      dialogCenterY - 88,
      PAUSE_MENU_DEPTH + 1,
      this.endRunEarnedElements
    );

    let continueCommitted = false;
    const commitContinue = () => {
      if (continueCommitted) return;
      continueCommitted = true;
      onContinue();
    };

    const { bg: continueButtonBg } = this.createLabeledButton({
      x: centerX, y: panelBottomY + 49,
      width: 200, height: 50,
      label: 'Continue', fontSize: '24px',
      baseColor: 0x44aa44, hoverColor: 0x55bb55, strokeColor: 0x66cc66,
      bgName: 'endRunContinueButtonBg', textName: 'endRunContinueButtonText',
      onActivate: commitContinue,
    });

    // Confirm's Enter binding is `keydown`, so a held Enter would otherwise land on
    // this screen the frame it opens and skip it unread. The pad has the same problem
    // with a held A, which the navigator's own button-state priming absorbs.
    this.scene.time.delayedCall(350, () => {
      if (!this.isShopConfirmationOpen) return;
      this.endRunNavigator = new MenuNavigator({
        scene: this.scene,
        items: [
          {
            onFocus: () => {
              continueButtonBg.setFillStyle(0x55bb55);
              continueButtonBg.setStrokeStyle(3, 0xffffff);
            },
            onBlur: () => {
              continueButtonBg.setFillStyle(0x44aa44);
              continueButtonBg.setStrokeStyle(3, 0x66cc66);
            },
            onActivate: () => continueButtonBg.emit('pointerdown'),
          },
        ],
        onCancel: commitContinue,
      });
    });
  }

  /**
   * Shows victory screen when player survives 10 minutes.
   * Game pauses to celebrate, then continues when player presses SPACE.
   */
  public showVictory(data: VictoryData): void {
    // Create victory overlay with fade-in
    this.createFadeInOverlay('victoryOverlay', 0.8, 200);

    // Kicker — world + boss context above the title, display style.
    const kickerLine = data.trophyUnlockedName
      ? `WORLD ${data.clearedWorld} CLEARED  ·  TROPHY UNLOCKED: ${data.trophyUnlockedName.toUpperCase()}`
      : `WORLD ${data.clearedWorld} CLEARED  ·  BOSS DEFEATED`;
    const worldClearedText = this.scene.add.text(
      this.scene.scale.width / 2,
      this.scene.scale.height / 2 - 214,
      kickerLine,
      {
        fontSize: '16px',
        color: '#88aaff',
        fontFamily: DISPLAY_FONT,
        fontStyle: 'bold',
        stroke: '#000000',
        strokeThickness: 2,
      }
    );
    worldClearedText.setLetterSpacing(6);
    worldClearedText.setOrigin(0.5);
    worldClearedText.setDepth(PAUSE_MENU_DEPTH + 1).setScrollFactor(0);
    worldClearedText.setName('victoryWorldCleared');

    // Title — same slot/styling as the game-over screen for end-screen parity.
    const victoryText = this.scene.add.text(this.scene.scale.width / 2, this.scene.scale.height / 2 - 172, 'VICTORY!', {
      fontSize: '58px',
      color: ACCENT_COLORS_STR.focus,
      fontFamily: DISPLAY_FONT,
      fontStyle: 'bold',
      stroke: '#000000',
      strokeThickness: 3,
    });
    victoryText.setLetterSpacing(6);
    victoryText.setOrigin(0.5);
    victoryText.setDepth(PAUSE_MENU_DEPTH + 1).setScrollFactor(0);
    victoryText.setName('victoryText');

    // Gentle breathe — skipped under reduced motion.
    if (!getSettingsManager().isReducedMotionEnabled()) {
      this.scene.tweens.add({
        targets: victoryText,
        scaleX: 1.02,
        scaleY: 1.02,
        duration: 900,
        yoyo: true,
        repeat: -1,
        ease: 'Sine.easeInOut',
      });
    }

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

    // Run stats — contained two-column panel matching the game-over grid:
    // labels flush left, values flush right per cell.
    const victoryCX = this.scene.scale.width / 2;
    const victoryStatsTop = this.scene.scale.height / 2 - 12;
    const victoryStatsWidth = 400;
    const victoryStatsHeight = 56;
    const statsPanelGfx = this.scene.add.graphics();
    paintPanelBackground(statsPanelGfx, victoryCX - victoryStatsWidth / 2, victoryStatsTop, victoryStatsWidth, victoryStatsHeight);
    statsPanelGfx.fillStyle(0x8898b0, 0.18);
    statsPanelGfx.fillRect(victoryCX, victoryStatsTop + 12, 1, victoryStatsHeight - 24);
    statsPanelGfx.setDepth(PAUSE_MENU_DEPTH + 1).setScrollFactor(0);
    statsPanelGfx.setName('victoryStatsPanel');

    const victoryCellRow = victoryStatsTop + victoryStatsHeight / 2 + 3;
    // Cells register into a collector destroyed by handleVictoryContinue —
    // no per-cell name to hand-mirror into a teardown list, so adding a
    // stat cell can't silently leak into the endless run.
    const addVictoryCell = (leftX: number, rightX: number, label: string, value: string): void => {
      const l = this.scene.add.text(leftX, victoryCellRow, label, END_STAT_LABEL_STYLE)
        .setOrigin(0, 0.5).setDepth(PAUSE_MENU_DEPTH + 2).setScrollFactor(0);
      const v = this.scene.add.text(rightX, victoryCellRow, value, END_STAT_VALUE_STYLE)
        .setOrigin(1, 0.5).setDepth(PAUSE_MENU_DEPTH + 2).setScrollFactor(0);
      this.victoryStatCellElements.push(l, v);
    };
    addVictoryCell(victoryCX - victoryStatsWidth / 2 + 18, victoryCX - 22, 'Kills', String(data.killCount));
    addVictoryCell(victoryCX + 22, victoryCX + victoryStatsWidth / 2 - 18, 'Level', String(data.playerLevel));

    // Next world line below the stats panel.
    const nextWorldText = this.scene.add.text(
      victoryCX,
      victoryStatsTop + victoryStatsHeight + 24,
      `Next: World ${data.newWorldLevel}`,
      {
        fontSize: '20px',
        color: '#aaddff',
        fontFamily: DISPLAY_FONT,
        fontStyle: 'bold',
      }
    );
    nextWorldText.setLetterSpacing(2);
    nextWorldText.setOrigin(0.5);
    nextWorldText.setDepth(PAUSE_MENU_DEPTH + 1).setScrollFactor(0);
    nextWorldText.setName('victoryNextWorld');

    // Streak display \u2014 clean text label, no emoji (system emoji font is
    // soft/off-brand next to the vector UI).
    const streakText = this.scene.add.text(
      this.scene.scale.width / 2,
      victoryStatsTop + victoryStatsHeight + 52,
      `WIN STREAK ${data.previousStreak} \u2192 ${data.newStreak}  (+${data.streakBonusPercent}% gold)`,
      {
        fontSize: '18px',
        color: '#ffaa44',
        fontFamily: '"Atkinson Hyperlegible", Arial, sans-serif',
      }
    );
    streakText.setOrigin(0.5);
    streakText.setDepth(PAUSE_MENU_DEPTH + 1).setScrollFactor(0);
    streakText.setName('victoryStreak');

    const victoryCenterX = this.scene.scale.width / 2;
    const victoryTitleY = this.scene.scale.height / 2 - 172;

    // Performance grade badge (left of the VICTORY! title) — mirrors the
    // game-over overlay so both end screens surface the same S–F grade.
    if (data.performanceGrade) {
      const gradeColorHex = Phaser.Display.Color.HexStringToColor(data.performanceGrade.color).color;
      const badgeX = victoryCenterX - victoryText.displayWidth / 2 - 58;
      const gradeBadge = this.scene.add.graphics();
      gradeBadge.setDepth(PAUSE_MENU_DEPTH + 1).setScrollFactor(0);
      gradeBadge.fillStyle(0x000000, 0.55);
      gradeBadge.fillCircle(badgeX, victoryTitleY, 34);
      gradeBadge.lineStyle(3, gradeColorHex, 1);
      gradeBadge.strokeCircle(badgeX, victoryTitleY, 34);
      gradeBadge.setName('victoryGradeBadge');
      const gradeText = this.scene.add.text(badgeX, victoryTitleY, data.performanceGrade.grade, {
        fontSize: '40px',
        color: data.performanceGrade.color,
        fontFamily: DISPLAY_FONT,
        fontStyle: 'bold',
        stroke: '#000000',
        strokeThickness: 3,
      });
      gradeText.setOrigin(0.5);
      gradeText.setDepth(PAUSE_MENU_DEPTH + 2).setScrollFactor(0);
      gradeText.setName('victoryGradeText');
      const gradeLabel = this.scene.add.text(badgeX, victoryTitleY + 46, 'GRADE', {
        fontSize: '11px', color: '#8888aa', fontFamily: 'Arial',
      });
      gradeLabel.setOrigin(0.5);
      gradeLabel.setDepth(PAUSE_MENU_DEPTH + 2).setScrollFactor(0);
      gradeLabel.setName('victoryGradeLabel');
    }

    // Score line (between the streak readout and the action buttons).
    if (data.runScore !== undefined) {
      const scoreStr = data.isNewBest
        ? `NEW BEST  ${data.runScore.toLocaleString()}`
        : `Score ${data.runScore.toLocaleString()}   ·   Best ${(data.bestScore ?? data.runScore).toLocaleString()}`;
      const scoreText = this.scene.add.text(
        victoryCenterX,
        victoryTitleY + 48,
        scoreStr,
        {
          fontSize: '16px',
          color: data.isNewBest ? '#ffdd44' : '#9999bb',
          fontFamily: '"Atkinson Hyperlegible", Arial, sans-serif',
          fontStyle: 'bold',
        }
      );
      scoreText.setOrigin(0.5);
      scoreText.setDepth(PAUSE_MENU_DEPTH + 1).setScrollFactor(0);
      scoreText.setName('victoryScore');
    }

    // What this win earned, in the free band between the score line (centerY - 124) and
    // the stats panel (top centerY - 12). One line, not a panel: every centered slot
    // below the panel is taken, and growing the 400-wide panel pushes the button row.
    const earningsLine = formatRunEarningsLine(data.runEarnings ?? []);
    if (earningsLine) {
      const earningsText = this.scene.add.text(
        victoryCenterX,
        this.scene.scale.height / 2 - 96,
        earningsLine,
        {
          fontSize: '15px',
          color: '#ffdd44',
          fontFamily: '"Atkinson Hyperlegible", Arial, sans-serif',
          fontStyle: 'bold',
        }
      );
      earningsText.setOrigin(0.5);
      earningsText.setDepth(PAUSE_MENU_DEPTH + 1).setScrollFactor(0);
      earningsText.setName('victoryEarned');
    }

    // Recent-run trend strip (left margin, clear of the centered title/buttons).
    // Skipped at portrait widths: unlike the death screen, this overlay has no
    // free band above its title to fall back to.
    if (this.scene.scale.width >= 900) {
      this.createRecentRunsStrip(
        data.recentRuns,
        28,
        this.scene.scale.height / 2 - 40,
        PAUSE_MENU_DEPTH + 1,
        { namePrefix: 'victoryRecent' }
      );
    }

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

    // COPY RESULT — daily/weekly runs only. Sits in the free band between the
    // streak readout (centerY + 96) and the button row (top edge centerY +
    // 152.5); every other centered slot is taken, and the portrait card reveal
    // owns centerY + 250.
    if (data.daily) {
      this.createDailyShareButton(
        data.daily,
        this.scene.scale.width / 2,
        this.scene.scale.height / 2 + 128,
        200,
        30,
        '14px',
        'victoryShareButtonBg',
        'victoryShareButtonText'
      );
    }

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
    goldPreviewText.setDepth(PAUSE_MENU_DEPTH + 1).setScrollFactor(0);
    goldPreviewText.setName('victoryGoldPreview');

    // The run's own economy, under the payout preview. This overlay has no free
    // centered slot ABOVE the buttons (streak owns centerY + 96, COPY RESULT owns
    // centerY + 128 on daily runs) and no room to grow the 400-wide stats panel
    // without pushing the button row, so it reads as one compact line here. The
    // narrow card reveal's top edge is centerY + 250; this line's baseline is
    // centerY + 233 at 14px, clearing it by ~10 units.
    const economyLine = formatRunEconomyLine({
      payout: data.goldEarned,
      found: data.goldLedger?.earned ?? 0,
      spent: data.goldLedger?.spent ?? 0,
      questGold: data.questGold ?? 0,
    });
    if (economyLine) {
      const economyText = this.scene.add.text(
        this.scene.scale.width / 2,
        buttonY + 58,
        economyLine,
        {
          fontSize: '14px',
          color: '#9999bb',
          fontFamily: '"Atkinson Hyperlegible", Arial, sans-serif',
        }
      );
      economyText.setOrigin(0.5);
      economyText.setDepth(PAUSE_MENU_DEPTH + 1).setScrollFactor(0);
      economyText.setName('victoryGoldEconomy');
    }

    // New-card reveal — right column, clear of the centered stats panel
    // (400 wide) and buttons at all 1280–2000 widths; the left margin holds
    // the recent-runs strip. Every element is named victoryCard* and torn
    // down by handleVictoryContinue's destroyElementsByName list.
    if (data.discoveredCard) {
      // Narrow (portrait) viewports: the right-column slot lands ON the
      // centered stats panel (it covered the Level cell), so the reveal
      // drops to a centered slot below the buttons + gold line instead.
      const narrow = this.scene.scale.width < 900;
      const cardPanelX = narrow
        ? this.scene.scale.width / 2
        : Math.min(this.scene.scale.width * 0.82, this.scene.scale.width - 144);
      const cardPanelTop = narrow
        ? this.scene.scale.height / 2 + 250
        : this.scene.scale.height / 2 - 64;
      const cardReveal = this.createCardRevealPanel(
        data.discoveredCard,
        cardPanelX,
        cardPanelTop,
        PAUSE_MENU_DEPTH + 1,
        { namePrefix: 'victoryCard' }
      );
      // Reduced motion: elements stay at alpha 1 (static reveal, full
      // information) and playGlowPulse no-ops internally.
      if (!getSettingsManager().isReducedMotionEnabled()) {
        for (const element of cardReveal.elements) {
          element.setAlpha(0);
          this.scene.tweens.add({
            targets: element,
            alpha: 1,
            duration: 300,
            ease: 'Sine.easeOut',
          });
        }
        // Pulse once the fade-in lands. playGlowPulse guards against the
        // overlay having been dismissed before this fires.
        this.scene.time.delayedCall(320, () => cardReveal.playGlowPulse());
      }
      // Discovery chime rides the reveal, not the panel creation, so it lands
      // after the victory fanfare instead of colliding with it.
      this.scene.time.delayedCall(320, () => this.soundManager.playAchievementUnlock());
    }

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
    for (const cellText of this.victoryStatCellElements) {
      this.scene.tweens.killTweensOf(cellText);
      cellText.destroy();
    }
    this.victoryStatCellElements = [];

    this.destroyElementsByName([
      'victoryOverlay',
      'victoryWorldCleared',
      'victoryText',
      'victoryNextWorld',
      'victoryStatsPanel',
      'victoryContinueButtonBg',
      'victoryContinueButtonText',
      'victoryNextWorldButtonBg',
      'victoryNextWorldButtonText',
      'victoryShareButtonBg',
      'victoryShareButtonText',
      'victoryGoldPreview',
      'victoryGoldEconomy',
      'victoryEarned',
      'victoryStreak',
      'victoryConfetti',
      'victoryGradeBadge',
      'victoryGradeText',
      'victoryGradeLabel',
      'victoryScore',
      'victoryRecentHeader',
      'victoryRecentRow0',
      'victoryRecentRow1',
      'victoryRecentRow2',
      'victoryCardPanel',
      'victoryCardKicker',
      'victoryCardName',
      'victoryCardDesc',
      'victoryCardRarity',
      'victoryCardGlow',
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
    const streakChangeText = data.previousStreak > 0 ? 'Streak broken!' : '';
    const gameState = this.options.getGameState();
    const hasWon = gameState.hasWon;
    // GameScene.gameOver() recorded nothing for a practice run and already passes 0 gold,
    // no streak, no records — this screen must not imply otherwise.
    const practiceRun = gameState.practiceModeActive;

    // Show game over UI
    const overlay = this.scene.add.rectangle(
      this.scene.scale.width / 2,
      this.scene.scale.height / 2,
      this.scene.scale.width,
      this.scene.scale.height,
      0x000000,
      0.7
    );
    overlay.setDepth(PAUSE_MENU_DEPTH).setScrollFactor(0);

    // Different display for winners vs non-winners
    const titleLabel = hasWon ? 'VICTORY!' : 'GAME OVER';
    const titleColor = hasWon ? '#ffdd44' : '#ff4444';
    const titleColorHex = hasWon ? 0xffdd44 : 0xff4444;
    const depth = PAUSE_MENU_DEPTH + 1;
    const centerX = this.scene.scale.width / 2;
    const centerY = this.scene.scale.height / 2;

    // Title glow (two concentric circles behind title)
    const titleY = centerY - 172;
    const glowGraphics = this.scene.add.graphics();
    glowGraphics.setDepth(depth - 1).setScrollFactor(0);
    glowGraphics.fillStyle(titleColorHex, 0.08);
    glowGraphics.fillCircle(centerX, titleY, 120);
    glowGraphics.fillStyle(titleColorHex, 0.15);
    glowGraphics.fillCircle(centerX, titleY, 70);

    // Collect elements for staggered entrance animation
    const animatedElements: (Phaser.GameObjects.Text | Phaser.GameObjects.Graphics)[] = [glowGraphics];

    const titleText = this.scene.add.text(centerX, titleY, titleLabel, {
      fontSize: '58px',
      color: titleColor,
      fontFamily: DISPLAY_FONT,
      fontStyle: 'bold',
      stroke: '#000000',
      strokeThickness: 3,
    });
    titleText.setLetterSpacing(6);
    titleText.setOrigin(0.5).setDepth(depth).setScrollFactor(0);
    animatedElements.push(titleText);

    // Performance grade badge — positioned off the measured title width so it
    // never overlaps the letterforms.
    if (data.performanceGrade) {
      const gradeColorHex = Phaser.Display.Color.HexStringToColor(data.performanceGrade.color).color;
      const badgeX = centerX - titleText.displayWidth / 2 - 58;
      const badgeGraphics = this.scene.add.graphics();
      badgeGraphics.setDepth(depth - 1).setScrollFactor(0);
      badgeGraphics.fillStyle(0x000000, 0.55);
      badgeGraphics.fillCircle(badgeX, titleY, 32);
      badgeGraphics.lineStyle(2, gradeColorHex, 1);
      badgeGraphics.strokeCircle(badgeX, titleY, 32);
      const gradeText = this.scene.add.text(badgeX, titleY, data.performanceGrade.grade, {
        fontSize: '40px',
        color: data.performanceGrade.color,
        fontFamily: DISPLAY_FONT,
        fontStyle: 'bold',
        stroke: '#000000',
        strokeThickness: 3,
      }).setOrigin(0.5).setDepth(depth).setScrollFactor(0);
      const gradeLabel = this.scene.add.text(badgeX, titleY + 44, 'GRADE', {
        fontSize: '11px', color: '#8888aa', fontFamily: DISPLAY_FONT, fontStyle: 'bold',
      }).setOrigin(0.5).setDepth(depth).setScrollFactor(0);
      gradeLabel.setLetterSpacing(2);
      animatedElements.push(badgeGraphics, gradeText, gradeLabel);
    }

    // Score line (below the title). GAUNTLET runs show the wave reached in the
    // same slot instead (their measure is waves, not the composite score), and
    // post-victory ENDLESS runs lead with the cycle reached, score trailing.
    if (data.gauntlet) {
      const waveStr = data.gauntlet.isNewBest
        ? `GAUNTLET · WAVE ${data.gauntlet.wave} — NEW BEST!`
        : `GAUNTLET · WAVE ${data.gauntlet.wave}   ·   Best ${data.gauntlet.bestWave}`;
      const waveText = this.scene.add.text(centerX, titleY + 48, waveStr, {
        fontSize: '16px',
        color: data.gauntlet.isNewBest ? '#ffdd44' : '#9999bb',
        fontFamily: '"Atkinson Hyperlegible", Arial, sans-serif',
        fontStyle: 'bold',
      }).setOrigin(0.5).setDepth(depth).setScrollFactor(0);
      animatedElements.push(waveText);
    } else if (data.endless) {
      const scoreSuffix = data.runScore !== undefined
        ? `   ·   Score ${data.runScore.toLocaleString()}`
        : '';
      const cycleStr = data.endless.isNewBest
        ? `ENDLESS · CYCLE ${data.endless.cycle} — NEW BEST!${scoreSuffix}`
        : `ENDLESS · CYCLE ${data.endless.cycle}   ·   Best ${data.endless.bestCycle}${scoreSuffix}`;
      const cycleText = this.scene.add.text(centerX, titleY + 48, cycleStr, {
        fontSize: '16px',
        color: data.endless.isNewBest ? '#ffdd44' : '#9999bb',
        fontFamily: '"Atkinson Hyperlegible", Arial, sans-serif',
        fontStyle: 'bold',
      }).setOrigin(0.5).setDepth(depth).setScrollFactor(0);
      animatedElements.push(cycleText);
    } else if (data.runScore !== undefined) {
      const scoreStr = data.isNewBest
        ? `NEW BEST  ${data.runScore.toLocaleString()}`
        : `Score ${data.runScore.toLocaleString()}   ·   Best ${(data.bestScore ?? data.runScore).toLocaleString()}`;
      const scoreText = this.scene.add.text(centerX, titleY + 48, scoreStr, {
        fontSize: '16px',
        color: data.isNewBest ? '#ffdd44' : '#9999bb',
        fontFamily: '"Atkinson Hyperlegible", Arial, sans-serif',
        fontStyle: 'bold',
      }).setOrigin(0.5).setDepth(depth).setScrollFactor(0);
      animatedElements.push(scoreText);
    } else if (practiceRun) {
      // The score slot is free in practice (no score was computed), and this is the one
      // line that answers "where did my gold and my unlock go?" before it is asked.
      const practiceNotice = this.scene.add.text(
        centerX,
        titleY + 48,
        'PRACTICE RUN · NOTHING RECORDED',
        {
          fontSize: '16px',
          color: ACCENT_COLORS_STR.teal,
          fontFamily: '"Atkinson Hyperlegible", Arial, sans-serif',
          fontStyle: 'bold',
        }
      ).setOrigin(0.5).setDepth(depth).setScrollFactor(0);
      animatedElements.push(practiceNotice);
    }

    // ── Run stats panel ────────────────────────────────────────────────────
    // Two-column grid inside one container: labels flush left, values flush
    // right per cell, so every number lines up regardless of digit count.
    const minutes = Math.floor(data.gameTime / 60);
    const seconds = Math.floor(data.gameTime % 60);
    const timeStr = `${minutes}:${seconds.toString().padStart(2, '0')}`;

    const hasDamageRow = data.totalDamageDealt !== undefined || data.totalDamageTaken !== undefined;
    const goldFound = data.goldLedger?.earned ?? 0;
    const goldSpent = data.goldLedger?.spent ?? 0;
    const questGold = data.questGold ?? 0;
    const hasLedgerRow = goldFound > 0 || goldSpent > 0;
    const hasQuestRow = questGold > 0;
    const hasEconomy = hasLedgerRow || hasQuestRow;
    const statRowCount = 2 + (hasDamageRow ? 1 : 0) + (hasLedgerRow ? 1 : 0) + (hasQuestRow ? 1 : 0);
    const statRowHeight = 34;
    const statsPanelWidth = 480;
    const statsPanelHeight = statRowCount * statRowHeight + 22;
    const statsPanelTop = centerY - 104;

    const statsPanel = this.scene.add.graphics();
    paintPanelBackground(
      statsPanel,
      centerX - statsPanelWidth / 2,
      statsPanelTop,
      statsPanelWidth,
      statsPanelHeight
    );
    // Hairline column divider down the middle of the grid.
    statsPanel.fillStyle(0x8898b0, 0.18);
    statsPanel.fillRect(centerX, statsPanelTop + 12, 1, statsPanelHeight - 24);
    statsPanel.setDepth(depth).setScrollFactor(0);
    animatedElements.push(statsPanel);

    const statLabelStyle = END_STAT_LABEL_STYLE;
    const statValueStyle = END_STAT_VALUE_STYLE;

    const cellInset = 20;
    const cellGutter = 26;
    const leftCellLeftX = centerX - statsPanelWidth / 2 + cellInset;
    const leftCellRightX = centerX - cellGutter;
    const rightCellLeftX = centerX + cellGutter;
    const rightCellRightX = centerX + statsPanelWidth / 2 - cellInset;

    // Adds a stat row cell: label flush left, value flush right on the same
    // baseline. Returns the value text (right-anchored, so count-up digits
    // grow leftward and stay aligned).
    const addStatCell = (
      cellLeftX: number,
      cellRightX: number,
      y: number,
      label: string,
      value: string,
      valueStyleOverrides: Partial<Phaser.Types.GameObjects.Text.TextStyle> = {}
    ): Phaser.GameObjects.Text => {
      const labelText = this.scene.add.text(cellLeftX, y, label, statLabelStyle)
        .setOrigin(0, 0.5).setDepth(depth).setScrollFactor(0);
      const valueText = this.scene.add.text(
        cellRightX,
        y,
        value,
        { ...statValueStyle, ...valueStyleOverrides }
      ).setOrigin(1, 0.5).setDepth(depth).setScrollFactor(0);
      animatedElements.push(labelText, valueText);
      return valueText;
    };

    const statRowY = (row: number): number =>
      statsPanelTop + 11 + statRowHeight * row + statRowHeight / 2;

    // Row 1: Time & Kills
    addStatCell(leftCellLeftX, leftCellRightX, statRowY(0), 'Survived', timeStr);
    const killValue = addStatCell(rightCellLeftX, rightCellRightX, statRowY(0), 'Kills', '0');

    // Row 2: Level & Combo
    const levelValue = addStatCell(leftCellLeftX, leftCellRightX, statRowY(1), 'Level', '0');
    if (data.highestCombo > 0) {
      const comboValue = addStatCell(rightCellLeftX, rightCellRightX, statRowY(1), 'Best Combo', '0', { color: '#ffdd44' });
      this.countUpStats.push({ text: comboValue, target: data.highestCombo });
    }

    // Track count-up targets
    this.countUpStats.push(
      { text: killValue, target: data.killCount },
      { text: levelValue, target: data.playerLevel },
    );

    // Row 3: Damage dealt (with DPS) & taken
    if (hasDamageRow) {
      const dmgDealt = formatLargeNumber(data.totalDamageDealt ?? 0);
      const dmgTaken = formatLargeNumber(data.totalDamageTaken ?? 0);
      const dps = data.gameTime > 0 ? formatLargeNumber(Math.floor((data.totalDamageDealt ?? 0) / data.gameTime)) : '0';

      addStatCell(leftCellLeftX, leftCellRightX, statRowY(2), 'Damage Dealt', `${dmgDealt} (${dps}/s)`, { fontSize: '16px' });
      addStatCell(rightCellLeftX, rightCellRightX, statRowY(2), 'Damage Taken', dmgTaken, { fontSize: '16px', color: '#ff8888' });
    }

    // The run's own economy. The gold pill below counts up the end-of-run payout only,
    // so mid-run income and market spending had no surface anywhere before this row.
    if (hasLedgerRow) {
      const ledgerRow = hasDamageRow ? 3 : 2;
      addStatCell(leftCellLeftX, leftCellRightX, statRowY(ledgerRow), 'Gold Found', `+${goldFound}`, { fontSize: '16px', color: '#ffdd44' });
      addStatCell(rightCellLeftX, rightCellRightX, statRowY(ledgerRow), 'Gold Spent', `-${goldSpent}`, { fontSize: '16px', color: '#ff8888' });
    }

    // Quest gold is settled after the payout snapshot, so `Gold Found` cannot own it —
    // and the completion toast that names it is drawn at OverlayDepths.HUD, underneath
    // this overlay. Without this row the player is paid and never told.
    if (hasQuestRow) {
      const questRow = (hasDamageRow ? 3 : 2) + (hasLedgerRow ? 1 : 0);
      addStatCell(leftCellLeftX, leftCellRightX, statRowY(questRow), 'Quest Gold', `+${questGold}`, { fontSize: '16px', color: '#ffdd44' });
    }

    // ── Gold pill ──────────────────────────────────────────────────────────
    const goldPillHeight = 40;
    const goldPillWidth = hasEconomy ? 360 : 250;
    const goldY = statsPanelTop + statsPanelHeight + 14 + goldPillHeight / 2;
    const goldPill = this.scene.add.graphics();
    paintPillBackground(goldPill, centerX, goldY, goldPillWidth, goldPillHeight, BODY_COLORS.gold, ACCENT_COLORS.gold);
    goldPill.setDepth(depth).setScrollFactor(0);
    animatedElements.push(goldPill);

    const goldText = this.scene.add.text(centerX, goldY, 'Gold: +0', {
      fontSize: '22px',
      color: '#ffdd44',
      fontFamily: DISPLAY_FONT,
      fontStyle: 'bold',
    }).setOrigin(0.5).setDepth(depth).setScrollFactor(0);
    const goldElementIndex = animatedElements.length;
    animatedElements.push(goldText);

    // Net = what the wallet is worth after this run vs. before it: the payout landing
    // now, plus what the run found, minus what it spent.
    const runNetGold = computeRunNetGold({ payout: data.goldEarned, found: goldFound, spent: goldSpent, questGold });
    const goldFinalText = practiceRun
      ? 'PRACTICE · NO GOLD BANKED'
      : hasEconomy
        ? `Gold: +${data.goldEarned}   ·   net ${runNetGold < 0 ? '-' : '+'}${Math.abs(runNetGold)}`
        : `Gold: +${data.goldEarned}`;

    // Streak text
    if (streakChangeText) {
      const streakDisplay = this.scene.add.text(centerX, goldY + 38, streakChangeText, {
        fontSize: '18px',
        color: data.previousStreak > 0 && !hasWon ? '#ff6666' : '#ffdd44',
        fontFamily: '"Atkinson Hyperlegible", Arial, sans-serif',
      }).setOrigin(0.5).setDepth(depth).setScrollFactor(0);
      animatedElements.push(streakDisplay);
    }

    // Track the bottom of the content for dynamic positioning
    let contentBottomY = goldY + goldPillHeight / 2;
    if (streakChangeText) {
      contentBottomY = goldY + 52;
    }

    // Weapon breakdown panel (right side) + personal bests panel (left side).
    // Narrow (portrait) viewports have exactly two below-column slots; when a
    // card reveal exists it takes the right slot and the PERSONAL BESTS panel
    // yields — the reveal is the rarer, one-per-run moment.
    const narrowGameOver = this.scene.scale.width < 900;
    if (data.weaponStats && data.weaponStats.length > 0) {
      this.createWeaponBreakdownPanel(data.weaponStats, depth, animatedElements);
    }
    if (data.personalBests && !(narrowGameOver && data.discoveredCard)) {
      this.createPersonalBestsPanel(data, depth, animatedElements);
    }

    // New-card reveal — right column, aligned under the weapon-damage panel's
    // MAXIMUM footprint (5 rows ⇒ bottom at centerY + 82) so the slot is
    // collision-free at 1280–2000 widths regardless of how many weapons dealt
    // damage (or whether the weapon panel rendered at all). Narrow: right
    // slot of the below-column pair (see above).
    let cardReveal: { playGlowPulse: () => void } | null = null;
    let cardRevealLastIndex = 0;
    if (data.discoveredCard) {
      const cardPanelX = narrowGameOver
        ? this.scene.scale.width / 2 + 126
        : Math.min(this.scene.scale.width * 0.82, this.scene.scale.width - 144);
      const cardPanelTop = narrowGameOver ? centerY + 320 : centerY + 98;
      cardReveal = this.createCardRevealPanel(
        data.discoveredCard,
        cardPanelX,
        cardPanelTop,
        depth,
        { collector: animatedElements }
      );
      // The panel registers several elements (panel, kicker, name, desc, tag)
      // — the glow must wait for the LAST one's stagger slot, not the first.
      cardRevealLastIndex = animatedElements.length - 1;
    }

    // What the run just earned outranks what it is close to earning, and all three own the
    // same slot: at 720 game units tall the stat panel, gold pill and CLOSEST TO UNLOCK
    // already reach the restart hint, so stacking a second panel pushes content off the
    // viewport. The run-end unlock/achievement/quest toasts draw at OverlayDepths.HUD,
    // under this overlay, so this panel is the only place they are reported.
    if (data.runEarnings && data.runEarnings.length > 0) {
      contentBottomY = this.createRunEarningsPanel(
        data.runEarnings,
        centerX,
        contentBottomY + 18,
        depth,
        animatedElements
      );
    } else {
      // Between two "what you are close to" panels, the one with a deadline wins: today's
      // board resets at UTC midnight and pays gold, while hidden-unlock progress keeps.
      // A finished board has nothing left to chase, so it yields the slot back.
      const questBoard = getDailyQuestBoard();
      if (questBoard.some((entry) => !entry.complete)) {
        contentBottomY = this.createDailyQuestBoardPanel(
          questBoard,
          centerX,
          contentBottomY + 18,
          depth,
          animatedElements
        );
      } else if (data.unlockProgress && data.unlockProgress.length > 0) {
        contentBottomY = this.createUnlockProgressPanel(
          data.unlockProgress,
          centerX,
          contentBottomY + 18,
          depth,
          animatedElements
        );
      }
    }

    // REMATCH — only when a boss-tier enemy can be re-fielded. Sits above COPY
    // RESULT so the share pill keeps its slot adjacent to the restart hint.
    if (data.rematch) {
      const rematchButtonHeight = 38;
      const rematchButtonY = contentBottomY + 20 + rematchButtonHeight / 2;
      this.createRematchButton(
        data.rematch.targetName,
        centerX,
        rematchButtonY,
        300,
        rematchButtonHeight
      );
      contentBottomY = rematchButtonY + rematchButtonHeight / 2;
    }

    // COPY RESULT — daily/weekly runs only. Last item in the centered flow so
    // it sits directly above the restart hint, grouping the two actions.
    if (data.daily) {
      const shareButtonHeight = 38;
      const shareButtonY = contentBottomY + 20 + shareButtonHeight / 2;
      this.createDailyShareButton(
        data.daily,
        centerX,
        shareButtonY,
        220,
        shareButtonHeight,
        '16px',
        'gameOverShareButtonBg',
        'gameOverShareButtonText'
      );
      contentBottomY = shareButtonY + shareButtonHeight / 2;
    }

    // Restart hint — clamped above the bottom edge so it never sits under
    // the iOS home indicator or off-screen on short landscape viewports.
    const isTouchDevice = this.scene.input.manager.touch !== null && this.scene.sys.game.device.input.touch;
    const restartHint = isTouchDevice ? 'Tap to restart' : 'Press SPACE to restart';
    const restartY = Math.min(contentBottomY + 56, this.scene.scale.height - 24);
    const affordY = restartY - 28;
    const restartText = this.scene.add.text(centerX, restartY, restartHint, {
      fontSize: '20px',
      color: '#888888',
      fontFamily: '"Atkinson Hyperlegible", Arial, sans-serif',
    }).setOrigin(0.5).setDepth(depth).setScrollFactor(0);
    animatedElements.push(restartText);

    // Recent-run trend strip: left margin, vertically centered in landscape —
    // clear of the centered stat column and side panels. At portrait widths the
    // mid-height left margin is under the stat column, so it moves into the top
    // band beside WHAT KILLED YOU (which is centered from x = centerX ± 120).
    const narrowRecentRuns = this.scene.scale.width < 900;
    this.createRecentRunsStrip(
      data.recentRuns,
      narrowRecentRuns ? 24 : 28,
      narrowRecentRuns ? 104 : centerY - 30,
      depth,
      { collector: animatedElements }
    );

    // Registered last on purpose: goldElementIndex, cardRevealLastIndex and
    // contentBottomY are all computed above, so nothing already on screen
    // shifts position or stagger slot.
    this.createThreatRecapPanel(data, depth, animatedElements);
    this.createRunTimelineStrip(data, depth);
    this.createPaceRecapBadge(data, centerX, titleY, titleText.displayWidth, depth);

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

    // Card-reveal glow pulse — fires once the panel's own stagger fade-in has
    // finished (last registered element's slot), so the halo lands on a fully
    // visible panel. If the scene restarts first, the delayed call dies with
    // it and playGlowPulse's active-guard covers any race.
    if (cardReveal) {
      // `let` narrowing doesn't survive into the closure — pin to a const.
      const reveal = cardReveal;
      const revealDone = cardRevealLastIndex * staggerDelay + 300;
      this.scene.time.delayedCall(revealDone, () => {
        reveal.playGlowPulse();
        // Discovery chime lands with the halo, well after the game-over sting.
        this.soundManager.playAchievementUnlock();
      });
    }

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
          goldText.setText(goldFinalText);
        },
      });
    });

    // "You can now afford" teaser (appears after gold counter finishes)
    const goldCounterDelay = goldElementIndex * staggerDelay + 300;
    this.scene.time.delayedCall(goldCounterDelay + Math.min(1800, data.goldEarned * 3 + 300), () => {
      if (practiceRun) return;
      const nextUpgrade = metaManager.getNextAffordableUpgrade?.();
      if (nextUpgrade) {
        const affordLabel = nextUpgrade.canAfford
          ? `You can now afford: ${nextUpgrade.name}`
          : `${nextUpgrade.goldNeeded}g away from: ${nextUpgrade.name}`;
        const affordColor = nextUpgrade.canAfford ? '#44ff88' : '#aaaacc';
        this.scene.add.text(centerX, affordY, affordLabel, {
          fontSize: '16px',
          color: affordColor,
          fontFamily: '"Atkinson Hyperlegible", Arial, sans-serif',
          fontStyle: 'italic',
        }).setOrigin(0.5).setDepth(depth).setScrollFactor(0);
      }
    });

    // Skip gold animation on tap/space, then restart on second press
    const handleRestart = () => {
      if (!goldCounterDone) {
        goldCounter?.complete();
        goldCounterDone = true;
        goldText.setText(goldFinalText);
        return;
      }
      this.options.onRestart();
    };

    if (data.rematch) {
      this.gameOverRematchHandler = () => this.options.onRematch();
      this.scene.input.keyboard?.on('keydown-R', this.gameOverRematchHandler);
    }
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
   * Renders a compact left-margin "RECENT" strip listing the player's prior runs
   * (newest-first): grade letter, duration, and score per row, tinted by grade so
   * the trend reads at a glance. No-op when there is no history. Shared by the
   * game-over overlay (fades in via `collector`) and the victory overlay (named
   * elements, torn down with the scene). A ✓ marks prior victories.
   */
  private createRecentRunsStrip(
    runs: RunSummary[] | undefined,
    x: number,
    topY: number,
    depth: number,
    options: {
      namePrefix?: string;
      collector?: (Phaser.GameObjects.Text | Phaser.GameObjects.Graphics)[];
    } = {}
  ): void {
    if (!runs || runs.length === 0) return;

    const gradeColors: Record<string, string> = {
      S: '#ffd24a', A: '#66ff99', B: '#66ccff', C: '#bbbbdd', D: '#cc9966', F: '#ff6666',
    };
    const register = (element: Phaser.GameObjects.Text, name: string): void => {
      element.setDepth(depth);
      if (options.namePrefix) element.setName(`${options.namePrefix}${name}`);
      options.collector?.push(element);
    };

    const header = this.scene.add.text(x, topY, 'RECENT', {
      fontSize: '12px', color: '#7777aa', fontFamily: 'Arial', fontStyle: 'bold',
    }).setOrigin(0, 0).setScrollFactor(0);
    header.setLetterSpacing(2);
    register(header, 'Header');

    let rowY = topY + 20;
    for (let index = 0; index < Math.min(3, runs.length); index++) {
      const run = runs[index];
      const minutes = Math.floor(run.durationSeconds / 60);
      const seconds = Math.floor(run.durationSeconds % 60);
      const timeStr = `${minutes}:${seconds.toString().padStart(2, '0')}`;
      const victoryMark = run.victory ? '✓ ' : '';
      const rowLabel = `${run.grade}   ${victoryMark}${timeStr}   ${run.score.toLocaleString()}`;
      const rowText = this.scene.add.text(x, rowY, rowLabel, {
        fontSize: '13px',
        color: gradeColors[run.grade] ?? '#9999bb',
        fontFamily: '"Atkinson Hyperlegible", Arial, sans-serif',
      }).setOrigin(0, 0).setScrollFactor(0);
      register(rowText, `Row${index}`);
      rowY += 18;
    }
  }

  /**
   * Renders the compact "NEW CARD DISCOVERED" reveal panel shared by both end
   * screens: rarity-accented panel (paintPanelBackground draws the accent
   * border + top hairline), kicker, card name, one-line bonus description, and
   * a rarity tag. Shares createRecentRunsStrip's dual teardown regime — the
   * game-over overlay passes `collector` (stagger fade-in, scene-restart
   * teardown), the victory overlay passes `namePrefix` (destroyElementsByName
   * teardown in handleVictoryContinue).
   *
   * Returns `playGlowPulse`, a one-shot accent halo (alpha 0.6 → 0, 500ms) the
   * caller fires once the panel is visible. The pulse self-destroys, no-ops
   * under reduced motion, and no-ops if the panel was already torn down (the
   * victory screen can be dismissed before its delayed pulse fires).
   */
  private createCardRevealPanel(
    card: { name: string; description: string; rarity: 'common' | 'rare' | 'epic' | 'legendary' },
    panelX: number,
    panelTopY: number,
    depth: number,
    options: {
      namePrefix?: string;
      collector?: (Phaser.GameObjects.Text | Phaser.GameObjects.Graphics)[];
    } = {}
  ): {
    elements: (Phaser.GameObjects.Text | Phaser.GameObjects.Graphics)[];
    playGlowPulse: () => void;
  } {
    const panelWidth = 240;
    const panelHeight = 116;
    const accent = CARD_RARITY_ACCENTS[card.rarity];
    const accentStr = colorToHexString(accent);
    const elements: (Phaser.GameObjects.Text | Phaser.GameObjects.Graphics)[] = [];

    const register = (
      element: Phaser.GameObjects.Text | Phaser.GameObjects.Graphics,
      name: string
    ): void => {
      element.setDepth(depth);
      if (options.namePrefix) element.setName(`${options.namePrefix}${name}`);
      options.collector?.push(element);
      elements.push(element);
    };

    const panelBg = this.scene.add.graphics().setScrollFactor(0);
    paintPanelBackground(
      panelBg,
      panelX - panelWidth / 2,
      panelTopY,
      panelWidth,
      panelHeight,
      { accentColor: accent }
    );
    register(panelBg, 'Panel');

    const kicker = this.scene.add.text(panelX, panelTopY + 12, 'NEW CARD DISCOVERED', {
      fontSize: '11px',
      color: accentStr,
      fontFamily: DISPLAY_FONT,
      fontStyle: 'bold',
    }).setOrigin(0.5, 0).setScrollFactor(0);
    kicker.setLetterSpacing(2);
    register(kicker, 'Kicker');

    const nameText = this.scene.add.text(panelX, panelTopY + 32, card.name, {
      fontSize: '18px',
      color: '#e8ecf4',
      fontFamily: DISPLAY_FONT,
      fontStyle: 'bold',
    }).setOrigin(0.5, 0).setScrollFactor(0);
    register(nameText, 'Name');

    const descText = this.scene.add.text(panelX, panelTopY + 58, card.description, {
      fontSize: '12px',
      color: '#aab4cc',
      fontFamily: '"Atkinson Hyperlegible", Arial, sans-serif',
      align: 'center',
      wordWrap: { width: panelWidth - 24 },
    }).setOrigin(0.5, 0).setScrollFactor(0);
    register(descText, 'Desc');

    const rarityTag = this.scene.add.text(
      panelX,
      panelTopY + panelHeight - 22,
      card.rarity.toUpperCase(),
      {
        fontSize: '11px',
        color: accentStr,
        fontFamily: DISPLAY_FONT,
        fontStyle: 'bold',
      }
    ).setOrigin(0.5, 0).setScrollFactor(0);
    rarityTag.setLetterSpacing(3);
    register(rarityTag, 'Rarity');

    const playGlowPulse = (): void => {
      if (getSettingsManager().isReducedMotionEnabled()) return;
      // The pulse is fired via delayed calls; the overlay may have been torn
      // down in the meantime (victory Continue) — never spawn an orphan halo.
      if (!panelBg.active) return;
      const halo = this.scene.add.graphics();
      halo.fillStyle(accent, 1);
      halo.fillRoundedRect(
        panelX - panelWidth / 2 - 8,
        panelTopY - 8,
        panelWidth + 16,
        panelHeight + 16,
        10
      );
      halo.setDepth(depth - 1).setScrollFactor(0);
      halo.setAlpha(0.6);
      // Named so handleVictoryContinue's destroyElementsByName can kill a
      // mid-pulse halo; on game over the scene restart's killAll covers it.
      if (options.namePrefix) halo.setName(`${options.namePrefix}Glow`);
      this.scene.tweens.add({
        targets: halo,
        alpha: 0,
        duration: 500,
        ease: 'Sine.easeOut',
        onComplete: () => halo.destroy(),
      });
    };

    return { elements, playGlowPulse };
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

    const panelWidth = 240;
    // Narrow (portrait) viewports: the side columns would sit on top of the
    // centered stat panel (480 wide), so this panel pairs up with PERSONAL
    // BESTS below the whole center column instead — height ≥1280 there.
    const narrow = this.scene.scale.width < 900;
    const panelX = narrow
      ? this.scene.scale.width / 2 - panelWidth / 2 - 6
      : Math.min(this.scene.scale.width * 0.82, this.scene.scale.width - panelWidth / 2 - 24);
    const panelTopY = narrow ? this.scene.scale.height / 2 + 320 : this.scene.scale.height / 2 - 150;
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
    panelBackground.setDepth(depth).setScrollFactor(0);
    animatedElements.push(panelBackground);

    // Title
    const titleText = this.scene.add.text(panelX, panelTopY + 8, 'WEAPON DAMAGE', {
      fontSize: '14px',
      color: '#aaaacc',
      fontFamily: '"Atkinson Hyperlegible", Arial, sans-serif',
      fontStyle: 'bold',
    }).setOrigin(0.5, 0).setDepth(depth).setScrollFactor(0);
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
      }).setOrigin(0, 0).setDepth(depth).setScrollFactor(0);
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
      ).setOrigin(1, 0).setDepth(depth).setScrollFactor(0);
      animatedElements.push(damageText);

      // Horizontal bar
      const barBackground = this.scene.add.graphics();
      barBackground.fillStyle(0x222233, 0.8);
      barBackground.fillRect(panelX - panelWidth / 2 + 10, rowY + 20, panelWidth - 20, 5);
      barBackground.setDepth(depth).setScrollFactor(0);
      animatedElements.push(barBackground);

      const barFill = this.scene.add.graphics();
      const barFillWidth = ((panelWidth - 20) * damagePercentage) / 100;
      const barColor = index === 0 ? 0xffcc44 : 0x8888bb;
      barFill.fillStyle(barColor, 1);
      barFill.fillRect(panelX - panelWidth / 2 + 10, rowY + 20, barFillWidth, 5);
      barFill.setDepth(depth).setScrollFactor(0);
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
    const panelWidth = 240;
    // Mirrors the weapon-damage panel: right slot of the below-column pair
    // on narrow (portrait) viewports.
    const narrow = this.scene.scale.width < 900;
    const panelX = narrow
      ? this.scene.scale.width / 2 + panelWidth / 2 + 6
      : Math.max(this.scene.scale.width * 0.18, panelWidth / 2 + 24);
    const panelTopY = narrow ? this.scene.scale.height / 2 + 320 : this.scene.scale.height / 2 - 150;
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
      current: formatLargeNumber(data.killCount),
      record: formatLargeNumber(bests.mostKills),
      broke: killsBroke,
    });

    const levelBroke = data.playerLevel > bests.highestLevel;
    rows.push({
      label: 'Level',
      current: formatLargeNumber(data.playerLevel),
      record: formatLargeNumber(bests.highestLevel),
      broke: levelBroke,
    });

    const comboBroke = data.highestCombo > bests.highestCombo;
    rows.push({
      label: 'Combo',
      current: formatLargeNumber(data.highestCombo),
      record: formatLargeNumber(bests.highestCombo),
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
    panelBackground.setDepth(depth).setScrollFactor(0);
    animatedElements.push(panelBackground);

    const titleText = this.scene.add.text(panelX, panelTopY + 8, 'PERSONAL BESTS', {
      fontSize: '14px',
      color: '#aaaacc',
      fontFamily: '"Atkinson Hyperlegible", Arial, sans-serif',
      fontStyle: 'bold',
    }).setOrigin(0.5, 0).setDepth(depth).setScrollFactor(0);
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
      }).setOrigin(0, 0).setDepth(depth).setScrollFactor(0);
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
      ).setOrigin(1, 0).setDepth(depth).setScrollFactor(0);
      animatedElements.push(valueText);
    });
  }

  /**
   * "WHAT KILLED YOU" panel: the lethal hit's attribution bucket plus the run's
   * worst damage sources. In landscape it sits in the left column below PERSONAL
   * BESTS; its top Y is a constant because that panel is always 4 rows tall
   * (bottom `centerY + 26`), so this one never drifts with content. Below
   * `NARROW_RECAP_MAX_WIDTH` neither that column nor the below-column slots are
   * free, so it moves to the band above the title glow instead.
   */
  private createThreatRecapPanel(
    data: GameOverData,
    depth: number,
    animatedElements: (Phaser.GameObjects.Text | Phaser.GameObjects.Graphics)[]
  ): void {
    const narrow = this.scene.scale.width < NARROW_RECAP_MAX_WIDTH;
    if (!narrow && this.scene.scale.height < 520) return;

    const threatRows = orderThreatsByDamage(data.damageBySource ?? [], 3);
    if (threatRows.length === 0 && !data.killedBy && !data.nemesis) return;

    const panelWidth = 240;
    // Narrow (portrait): the left margin sits under the 480-wide centered stat
    // column and both below-column slots are taken by WEAPON DAMAGE and
    // PERSONAL BESTS / the card reveal, so this drops into the band above the
    // title glow, under the RUN TIMELINE ribbon.
    const panelX = narrow
      ? this.scene.scale.width / 2
      : Math.max(this.scene.scale.width * 0.18, panelWidth / 2 + 24);
    const panelTopY = narrow ? 92 : this.scene.scale.height / 2 + 42;
    const rowHeight = 34;
    const killedByHeight = data.killedBy ? 26 : 0;
    const nemesisHeight = data.nemesis ? 20 : 0;
    const rowsTopY = panelTopY + 30 + killedByHeight + nemesisHeight;
    const panelHeight = 30 + killedByHeight + nemesisHeight + threatRows.length * rowHeight + 12;

    // Same clearance rule the timeline ribbon uses: a viewport too short for the
    // band simply gets no panel rather than one drawn over the title.
    if (narrow && this.scene.scale.height / 2 - 292 - (panelTopY + panelHeight) < 8) return;

    const panelBackground = this.scene.add.graphics();
    paintPanelBackground(
      panelBackground,
      panelX - panelWidth / 2,
      panelTopY,
      panelWidth,
      panelHeight,
      { accentColor: ACCENT_COLORS.danger }
    );
    panelBackground.setDepth(depth).setScrollFactor(0);
    animatedElements.push(panelBackground);

    const titleText = this.scene.add.text(panelX, panelTopY + 8, 'WHAT KILLED YOU', {
      fontSize: '14px',
      color: '#ffaaaa',
      fontFamily: '"Atkinson Hyperlegible", Arial, sans-serif',
      fontStyle: 'bold',
    }).setOrigin(0.5, 0).setDepth(depth).setScrollFactor(0);
    animatedElements.push(titleText);

    if (data.killedBy) {
      const killedByText = this.scene.add.text(
        panelX,
        panelTopY + 30,
        `KILLED BY  ${data.killedBy}`,
        {
          fontSize: '14px',
          color: '#ff6666',
          fontFamily: '"Atkinson Hyperlegible", Arial, sans-serif',
          fontStyle: 'bold',
        }
      ).setOrigin(0.5, 0).setDepth(depth).setScrollFactor(0);
      animatedElements.push(killedByText);
    }

    if (data.nemesis) {
      const nemesisText = this.scene.add.text(
        panelX,
        panelTopY + 30 + killedByHeight,
        `IT HUNTS YOU NEXT RUN${data.nemesis.grudge > 1 ? `  ·  GRUDGE ${data.nemesis.grudge}` : ''}`,
        {
          fontSize: '11px',
          color: '#ffaa66',
          fontFamily: '"Atkinson Hyperlegible", Arial, sans-serif',
        }
      ).setOrigin(0.5, 0).setDepth(depth).setScrollFactor(0);
      animatedElements.push(nemesisText);
    }

    threatRows.forEach((threat, index) => {
      const rowY = rowsTopY + index * rowHeight;
      const sharePercent = Math.round(threat.damageShare * 100);

      const nameText = this.scene.add.text(
        panelX - panelWidth / 2 + 10,
        rowY + 2,
        threat.sourceName,
        {
          fontSize: '13px',
          color: '#ddddee',
          fontFamily: '"Atkinson Hyperlegible", Arial, sans-serif',
        }
      ).setOrigin(0, 0).setDepth(depth).setScrollFactor(0);
      animatedElements.push(nameText);

      const damageText = this.scene.add.text(
        panelX + panelWidth / 2 - 10,
        rowY + 2,
        `${formatLargeNumber(threat.totalDamage)}  ${sharePercent}%`,
        {
          fontSize: '12px',
          color: '#ff9977',
          fontFamily: '"Atkinson Hyperlegible", Arial, sans-serif',
        }
      ).setOrigin(1, 0).setDepth(depth).setScrollFactor(0);
      animatedElements.push(damageText);

      const barBackground = this.scene.add.graphics();
      barBackground.fillStyle(0x222233, 0.8);
      barBackground.fillRect(panelX - panelWidth / 2 + 10, rowY + 20, panelWidth - 20, 5);
      barBackground.setDepth(depth).setScrollFactor(0);
      animatedElements.push(barBackground);

      const barFill = this.scene.add.graphics();
      const barFillWidth = ((panelWidth - 20) * sharePercent) / 100;
      barFill.fillStyle(index === 0 ? 0xff6666 : 0x8888bb, 1);
      barFill.fillRect(panelX - panelWidth / 2 + 10, rowY + 20, barFillWidth, 5);
      barFill.setDepth(depth).setScrollFactor(0);
      animatedElements.push(barFill);
    });
  }

  /**
   * PACE — the title band's right-hand medal, mirroring the GRADE badge on the
   * left: how the run finished against the ghost it raced, where the lead was
   * lost, and whether this run became the new ghost. The title band's right
   * side is the only free real estate left on this overlay (both columns, the
   * centered flow, the left margin and the top ribbon are all spoken for).
   *
   * It runs its own short fade-in instead of joining `animatedElements`: the
   * shared `index * 120 ms` stagger would land it seconds after its twin badge.
   */
  private createPaceRecapBadge(
    data: GameOverData,
    titleX: number,
    titleY: number,
    titleDisplayWidth: number,
    depth: number
  ): void {
    const pace = data.pace;
    if (!pace) return;

    const summary = summarizeRunPace(pace.ghost, pace.runSamples, data.gameTime, data.killCount);
    if (summary.finalDelta === null && !pace.ghostReplaced) return;

    // Floored so the subline can never reach back over the centered score line
    // (up to 170 wide each side of centre) on the shorter VICTORY! title.
    const badgeX = Math.max(titleX + titleDisplayWidth / 2 + 58, titleX + 240);
    if (badgeX + 80 > this.scene.scale.width - 8) return;

    const delta = summary.finalDelta;
    const headline = delta === null
      ? 'SET'
      : delta > 0 ? `+${delta}` : delta < 0 ? String(delta) : 'EVEN';
    const headlineColor = delta === null || delta > 0
      ? ACCENT_COLORS_STR.safe
      : delta < 0 ? ACCENT_COLORS_STR.danger : '#ffffff';
    const headlineHex = Phaser.Display.Color.HexStringToColor(headlineColor).color;
    const headlineSize = headline.length >= 4 ? '20px' : headline.length === 3 ? '24px' : '28px';

    let subline: string;
    if (delta === null) {
      subline = 'NEW PACE TO BEAT';
    } else if (summary.outlastedSeconds > 0) {
      subline = `OUTLASTED BEST BY ${formatTime(summary.outlastedSeconds)}`;
    } else if (summary.shape === 'ahead-at-end') {
      subline = 'AHEAD AT THE END';
    } else if (summary.shape === 'lost-lead') {
      subline = `AHEAD UNTIL ${formatTime(summary.lostLeadAtSeconds ?? 0)}`;
    } else if (summary.shape === 'never-ahead') {
      subline = 'NEVER AHEAD';
    } else {
      subline = 'VS YOUR BEST RUN';
    }

    const badgeElements: (Phaser.GameObjects.Graphics | Phaser.GameObjects.Text)[] = [];

    const badgeGraphics = this.scene.add.graphics();
    badgeGraphics.setDepth(depth - 1).setScrollFactor(0);
    badgeGraphics.fillStyle(0x000000, 0.55);
    badgeGraphics.fillCircle(badgeX, titleY, 32);
    badgeGraphics.lineStyle(2, headlineHex, 1);
    badgeGraphics.strokeCircle(badgeX, titleY, 32);
    badgeElements.push(badgeGraphics);

    badgeElements.push(this.scene.add.text(badgeX, titleY, headline, {
      fontSize: headlineSize,
      color: headlineColor,
      fontFamily: DISPLAY_FONT,
      fontStyle: 'bold',
      stroke: '#000000',
      strokeThickness: 3,
    }).setOrigin(0.5).setDepth(depth).setScrollFactor(0));

    const labelText = this.scene.add.text(badgeX, titleY + 44, 'PACE', {
      fontSize: '11px', color: '#8888aa', fontFamily: DISPLAY_FONT, fontStyle: 'bold',
    }).setOrigin(0.5).setDepth(depth).setScrollFactor(0);
    labelText.setLetterSpacing(2);
    badgeElements.push(labelText);

    badgeElements.push(this.scene.add.text(badgeX, titleY + 62, subline, {
      fontSize: '11px',
      color: '#8899bb',
      fontFamily: '"Atkinson Hyperlegible", Arial, sans-serif',
    }).setOrigin(0.5).setDepth(depth).setScrollFactor(0));

    if (pace.ghostReplaced && delta !== null) {
      const ghostText = this.scene.add.text(badgeX, titleY + 80, 'NEW GHOST', {
        fontSize: '11px',
        color: ACCENT_COLORS_STR.safe,
        fontFamily: DISPLAY_FONT,
        fontStyle: 'bold',
      }).setOrigin(0.5).setDepth(depth).setScrollFactor(0);
      ghostText.setLetterSpacing(1);
      badgeElements.push(ghostText);
    }

    badgeElements.forEach((element, index) => {
      element.setAlpha(0);
      this.scene.tweens.add({
        targets: element,
        alpha: 1,
        duration: 300,
        delay: 260 + index * 60,
        ease: 'Sine.easeOut',
      });
    });
  }

  /**
   * The run's whole clock as one ribbon across the top of the death screen: a
   * minute grid, a marker per beat, and a legend. The top band is the only free
   * real estate left on this overlay (the centered column, both side columns and
   * the left margin are all spoken for), so the strip lives above the title and
   * guards on its clearance from the title's glow circle rather than on a magic
   * viewport height: a short landscape simply gets no ribbon.
   *
   * It runs its OWN short stagger instead of joining `animatedElements`, whose
   * shared delay is `index * 120 ms` over the overlay's whole element list, which
   * would land the top of the screen several seconds after the rest of it. Same
   * reason createDailyQuestsPanel keeps its own. Nothing else reads its indices,
   * so registering it changes no existing element's position or stagger slot.
   */
  private createRunTimelineStrip(data: GameOverData, depth: number): void {
    const events = data.runTimeline ?? [];
    if (events.length === 0) return;

    // Narrow (portrait) viewports cannot fit the legend on the title's row —
    // six kinds need ~350 units and the title already owns the left of a
    // 720-wide strip — so it drops to its own row and the strip grows to suit.
    const narrow = this.scene.scale.width < NARROW_RECAP_MAX_WIDTH;
    const stripTopY = 12;
    const stripHeight = narrow ? 68 : 44;
    const glowTopY = this.scene.scale.height / 2 - 172 - 120;
    if (glowTopY - (stripTopY + stripHeight) < 8) return;

    const trackInset = narrow ? 24 : 60;
    const trackLeftX = trackInset;
    const trackRightX = this.scene.scale.width - trackInset;
    const trackWidth = trackRightX - trackLeftX;
    const trackY = stripTopY + 30;

    const markers = layoutRunTimeline(events, data.gameTime, trackWidth);
    if (markers.length === 0) return;

    const stripElements: (Phaser.GameObjects.Text | Phaser.GameObjects.Graphics)[] = [];

    const panelBackground = this.scene.add.graphics();
    paintPanelBackground(
      panelBackground,
      trackLeftX - 16,
      stripTopY - 6,
      trackWidth + 32,
      stripHeight + 4,
      { accentColor: ACCENT_COLORS.neutral }
    );
    panelBackground.setDepth(depth).setScrollFactor(0);
    stripElements.push(panelBackground);

    const titleText = this.scene.add.text(trackLeftX, stripTopY, 'RUN TIMELINE', {
      fontSize: '12px',
      color: '#8899bb',
      fontFamily: DISPLAY_FONT,
      fontStyle: 'bold',
    }).setOrigin(0, 0).setDepth(depth).setScrollFactor(0);
    titleText.setLetterSpacing(2);
    stripElements.push(titleText);

    // Grid first, markers over it: a minute notch must never hide a beat.
    const gridGraphics = this.scene.add.graphics();
    gridGraphics.fillStyle(0x2a2a3a, 0.7);
    for (let minute = 1; minute * 60 < data.gameTime; minute++) {
      const tickX = trackLeftX + Math.round(trackWidth * ((minute * 60) / data.gameTime));
      gridGraphics.fillRect(tickX, trackY - 12, 1, 24);
    }
    gridGraphics.fillStyle(0x445566, 0.9);
    gridGraphics.fillRect(trackLeftX, trackY - 1, trackWidth, 2);
    gridGraphics.setDepth(depth).setScrollFactor(0);
    stripElements.push(gridGraphics);

    const markerGraphics = this.scene.add.graphics();
    markerGraphics.setDepth(depth).setScrollFactor(0);
    markers.forEach((marker) => {
      this.paintTimelineMarker(markerGraphics, marker.kind, trackLeftX + marker.offsetX, trackY, marker.count);
    });
    stripElements.push(markerGraphics);

    // Legend, left-to-right from a fixed origin so its width never has to be
    // measured up front; only the kinds this run actually produced are named.
    const legendY = narrow ? stripTopY + 50 : stripTopY + 6;
    let legendX = narrow ? trackLeftX : trackRightX - 380;
    TIMELINE_KIND_ORDER.filter((kind) => markers.some((marker) => marker.kind === kind)).forEach((kind) => {
      const swatch = this.scene.add.graphics();
      this.paintTimelineMarker(swatch, kind, legendX, legendY, 1);
      swatch.setDepth(depth).setScrollFactor(0);
      stripElements.push(swatch);

      const legendText = this.scene.add.text(legendX + 9, legendY, TIMELINE_LEGEND_LABELS[kind], {
        fontSize: '11px',
        color: '#8899bb',
        fontFamily: '"Atkinson Hyperlegible", Arial, sans-serif',
      }).setOrigin(0, 0.5).setDepth(depth).setScrollFactor(0);
      stripElements.push(legendText);

      legendX += 9 + legendText.displayWidth + 16;
    });

    stripElements.forEach((element, index) => {
      element.setAlpha(0);
      this.scene.tweens.add({
        targets: element,
        alpha: 1,
        duration: 300,
        delay: 200 + index * 40,
        ease: 'Sine.easeOut',
      });
    });
  }

  /**
   * One beat, on the track (build), above it (threats) or below it (hurt). A
   * collapsed cluster paints one pixel wider per side so a burst reads as heavier
   * than a single beat without moving off its own time slot.
   */
  private paintTimelineMarker(
    graphics: Phaser.GameObjects.Graphics,
    kind: RunTimelineEventKind,
    centerX: number,
    trackY: number,
    count: number
  ): void {
    const grow = count > 1 ? 1 : 0;
    graphics.fillStyle(TIMELINE_MARKER_COLORS[kind], 1);
    switch (kind) {
      case 'level':
      case 'ultimate':
        graphics.fillCircle(centerX, trackY, 3 + grow);
        break;
      case 'miniboss':
        graphics.fillRect(centerX - 3 - grow, trackY - 11, 7 + grow * 2, 7);
        break;
      case 'boss':
        graphics.fillRect(centerX - 4 - grow, trackY - 12, 9 + grow * 2, 9);
        break;
      case 'bossDown':
        graphics.fillRect(centerX - 3 - grow, trackY - 11, 7 + grow * 2, 7);
        break;
      case 'closeCall':
        graphics.fillRect(centerX - 1 - grow, trackY + 4, 3 + grow * 2, 9);
        break;
    }
  }

  /**
   * Renders an "EARNED THIS RUN" panel: what the run-end settle awarded, which is
   * announced nowhere else (its toasts draw at OverlayDepths.HUD, under this overlay).
   * Returns the new content bottom Y so the restart hint stacks below it.
   */
  private createRunEarningsPanel(
    earnings: RunEarning[],
    centerX: number,
    startY: number,
    depth: number,
    animatedElements: (Phaser.GameObjects.Text | Phaser.GameObjects.Graphics)[]
  ): number {
    const maxRows = 3;
    const rows = earnings.slice(0, maxRows);
    const overflow = earnings.length - rows.length;
    const panelWidth = 340;
    const rowHeight = 26;
    const headerOffset = 18;
    const panelHeight = headerOffset + rows.length * rowHeight + (overflow > 0 ? 14 : 0) + 14;

    const panelBackground = this.scene.add.graphics();
    paintPanelBackground(
      panelBackground,
      centerX - panelWidth / 2,
      startY,
      panelWidth,
      panelHeight
    );
    panelBackground.setDepth(depth).setScrollFactor(0);
    animatedElements.push(panelBackground);

    const header = this.scene.add.text(centerX, startY + 6, 'EARNED THIS RUN', {
      fontSize: '12px',
      color: '#ffdd44',
      fontFamily: '"Atkinson Hyperlegible", Arial, sans-serif',
      fontStyle: 'bold',
    }).setOrigin(0.5, 0).setDepth(depth).setScrollFactor(0);
    animatedElements.push(header);

    const leftTextX = centerX - panelWidth / 2 + 14;
    const tagRightX = centerX + panelWidth / 2 - 12;
    // The detail line is one row tall and must not wrap: a wrapped row would
    // overrun the next row's slot and the panel's own height.
    const detailLimit = 46;

    rows.forEach((earning, index) => {
      const rowY = startY + headerOffset + 8 + index * rowHeight;

      const nameText = this.scene.add.text(leftTextX, rowY, earning.name, {
        fontSize: '13px',
        color: '#ffffff',
        fontFamily: '"Atkinson Hyperlegible", Arial, sans-serif',
      }).setOrigin(0, 0).setDepth(depth).setScrollFactor(0);
      animatedElements.push(nameText);

      const tagText = this.scene.add.text(tagRightX, rowY, earning.tag, {
        fontSize: '10px',
        color: RUN_EARNING_TAG_COLORS[earning.tag],
        fontFamily: '"Atkinson Hyperlegible", Arial, sans-serif',
        fontStyle: 'bold',
      }).setOrigin(1, 0).setDepth(depth).setScrollFactor(0);
      animatedElements.push(tagText);

      const detail = earning.detail.length > detailLimit
        ? `${earning.detail.slice(0, detailLimit - 3)}...`
        : earning.detail;
      const detailText = this.scene.add.text(leftTextX, rowY + 13, detail, {
        fontSize: '10px',
        color: '#6677aa',
        fontFamily: '"Atkinson Hyperlegible", Arial, sans-serif',
      }).setOrigin(0, 0).setDepth(depth).setScrollFactor(0);
      animatedElements.push(detailText);
    });

    if (overflow > 0) {
      const overflowText = this.scene.add.text(
        centerX,
        startY + headerOffset + 8 + rows.length * rowHeight,
        `+${overflow} more`,
        {
          fontSize: '10px',
          color: '#8888aa',
          fontFamily: '"Atkinson Hyperlegible", Arial, sans-serif',
        }
      ).setOrigin(0.5, 0).setDepth(depth).setScrollFactor(0);
      animatedElements.push(overflowText);
    }

    return startY + panelHeight;
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
    panelBackground.setDepth(depth).setScrollFactor(0);
    animatedElements.push(panelBackground);

    const header = this.scene.add.text(centerX, startY + 6, 'CLOSEST TO UNLOCK', {
      fontSize: '12px',
      color: '#cc99ff',
      fontFamily: '"Atkinson Hyperlegible", Arial, sans-serif',
      fontStyle: 'bold',
    }).setOrigin(0.5, 0).setDepth(depth).setScrollFactor(0);
    animatedElements.push(header);

    const barWidth = 110;
    const barHeight = 6;
    const leftTextX = centerX - panelWidth / 2 + 14;
    const percentRightX = centerX + panelWidth / 2 - 12;
    const barX = percentRightX - 34 - barWidth;

    entries.forEach((entry, index) => {
      const rowY = startY + headerOffset + 8 + index * rowHeight;
      const percent = Math.round(entry.ratio * 100);
      const progressText = formatProgressText(entry.current, entry.target);

      const nameText = this.scene.add.text(leftTextX, rowY, entry.condition.displayName, {
        fontSize: '13px',
        color: '#ccccdd',
        fontFamily: '"Atkinson Hyperlegible", Arial, sans-serif',
      }).setOrigin(0, 0).setDepth(depth).setScrollFactor(0);
      animatedElements.push(nameText);

      // Background bar
      const barGraphics = this.scene.add.graphics();
      barGraphics.fillStyle(0x2a2a44, 0.9);
      barGraphics.fillRoundedRect(barX, rowY + 4, barWidth, barHeight, 3);
      // Fill portion
      const fillWidth = Math.max(2, barWidth * entry.ratio);
      barGraphics.fillStyle(0xaa44ff, 1.0);
      barGraphics.fillRoundedRect(barX, rowY + 4, fillWidth, barHeight, 3);
      barGraphics.setDepth(depth).setScrollFactor(0);
      animatedElements.push(barGraphics);

      const percentText = this.scene.add.text(percentRightX, rowY, `${percent}%`, {
        fontSize: '11px',
        color: percent >= 90 ? '#ffdd44' : '#888899',
        fontFamily: '"Atkinson Hyperlegible", Arial, sans-serif',
      }).setOrigin(1, 0).setDepth(depth).setScrollFactor(0);
      animatedElements.push(percentText);

      const detailText = this.scene.add.text(leftTextX, rowY + 11, progressText, {
        fontSize: '10px',
        color: '#6677aa',
        fontFamily: '"Atkinson Hyperlegible", Arial, sans-serif',
      }).setOrigin(0, 0).setDepth(depth).setScrollFactor(0);
      animatedElements.push(detailText);
    });

    return startY + panelHeight;
  }

  /**
   * Renders today's DAILY QUESTS board below the main stats: one row per quest with a
   * progress bar, the gold at stake, and how far short the run left it. Returns the new
   * content bottom Y so the restart hint can stack below it.
   *
   * The board is read straight from storage rather than folded live: gameOver() runs
   * after GameScene has already called settleDailyQuests(), so the stored board is
   * this-run-inclusive, and folding again here would double-count the run.
   */
  private createDailyQuestBoardPanel(
    board: DailyQuestProgress[],
    centerX: number,
    startY: number,
    depth: number,
    animatedElements: (Phaser.GameObjects.Text | Phaser.GameObjects.Graphics)[]
  ): number {
    const panelWidth = 340;
    const rowHeight = 22;
    const headerOffset = 18;
    const panelHeight = headerOffset + board.length * rowHeight + 14;
    const completeCount = board.filter((entry) => entry.complete).length;

    const panelBackground = this.scene.add.graphics();
    paintPanelBackground(
      panelBackground,
      centerX - panelWidth / 2,
      startY,
      panelWidth,
      panelHeight
    );
    panelBackground.setDepth(depth).setScrollFactor(0);
    animatedElements.push(panelBackground);

    const header = this.scene.add.text(
      centerX,
      startY + 6,
      `DAILY QUESTS  ${completeCount}/${board.length}`,
      {
        fontSize: '12px',
        color: '#ffcc66',
        fontFamily: '"Atkinson Hyperlegible", Arial, sans-serif',
        fontStyle: 'bold',
      }
    ).setOrigin(0.5, 0).setDepth(depth).setScrollFactor(0);
    animatedElements.push(header);

    const barWidth = 110;
    const barHeight = 6;
    const leftTextX = centerX - panelWidth / 2 + 14;
    const rewardRightX = centerX + panelWidth / 2 - 12;
    const barX = rewardRightX - 40 - barWidth;

    board.forEach((entry, index) => {
      const rowY = startY + headerOffset + 8 + index * rowHeight;
      const ratio = entry.quest.target > 0
        ? Math.min(1, entry.value / entry.quest.target)
        : 1;

      const nameText = this.scene.add.text(leftTextX, rowY, entry.quest.name, {
        fontSize: '13px',
        color: entry.complete ? '#88ff88' : '#ccccdd',
        fontFamily: '"Atkinson Hyperlegible", Arial, sans-serif',
      }).setOrigin(0, 0).setDepth(depth).setScrollFactor(0);
      animatedElements.push(nameText);

      const barGraphics = this.scene.add.graphics();
      barGraphics.fillStyle(0x2a2a44, 0.9);
      barGraphics.fillRoundedRect(barX, rowY + 4, barWidth, barHeight, 3);
      const fillWidth = Math.max(2, barWidth * ratio);
      barGraphics.fillStyle(entry.complete ? 0x66cc66 : 0xffcc44, 1.0);
      barGraphics.fillRoundedRect(barX, rowY + 4, fillWidth, barHeight, 3);
      barGraphics.setDepth(depth).setScrollFactor(0);
      animatedElements.push(barGraphics);

      const rewardText = this.scene.add.text(
        rewardRightX,
        rowY,
        `+${entry.quest.gold}g`,
        {
          fontSize: '11px',
          color: entry.complete ? '#88ff88' : '#ffcc66',
          fontFamily: '"Atkinson Hyperlegible", Arial, sans-serif',
        }
      ).setOrigin(1, 0).setDepth(depth).setScrollFactor(0);
      animatedElements.push(rewardText);

      const detailText = this.scene.add.text(
        leftTextX,
        rowY + 11,
        formatQuestProgress(entry),
        {
          fontSize: '10px',
          color: '#6677aa',
          fontFamily: '"Atkinson Hyperlegible", Arial, sans-serif',
        }
      ).setOrigin(0, 0).setDepth(depth).setScrollFactor(0);
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

    // Remove the END RUN dialog / earned panel navigator
    if (this.endRunNavigator) {
      this.endRunNavigator.destroy();
      this.endRunNavigator = null;
    }

    // Remove victory keyboard handlers (if victory overlay was showing)
    this.clearVictoryKeyboardHandlers();

    // Remove game over keyboard/pointer/gamepad handlers
    if (this.gameOverRestartHandler) {
      this.scene.input.keyboard?.off('keydown-SPACE', this.gameOverRestartHandler);
      this.scene.input.off('pointerdown', this.gameOverRestartHandler);
      this.gameOverRestartHandler = null;
    }
    if (this.gameOverRematchHandler) {
      this.scene.input.keyboard?.off('keydown-R', this.gameOverRematchHandler);
      this.gameOverRematchHandler = null;
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
