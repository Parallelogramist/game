import Phaser from 'phaser';
import { getMusicManager } from '../../audio/MusicManager';
import { SoundKeys, SoundManager } from '../../audio/SoundManager';
import { getMetaProgressionManager } from '../../meta/MetaProgressionManager';
import { getAscensionManager } from '../../meta/AscensionManager';
import { preloadIcons, createIcon, setIconFrame } from '../../utils/IconRenderer';
import { getGameStateManager } from '../../save/GameStateManager';
import { getBoostCardManager } from '../../meta/BoostCardManager';
import { loadLastLoadout, saveLastLoadout, type LastLoadout } from '../../meta/LastLoadout';
import { loadLoadoutPresets, consumePendingReplay } from '../../meta/LoadoutPresets';
import { buildRandomLoadout } from '../../meta/RandomLoadout';
import { bossIdAtRotation, challengeBossRotationIndex, getUpcomingBossId } from '../../meta/BossRotationManager';
import { getEnemyType } from '../../enemies/EnemyTypes';
import {
  fadeOut,
  addButtonInteraction,
  transitionToScene,
  sweepIn,
  staggerEntrance,
} from '../../utils/SceneTransition';
import {
  computeMenuLayoutScale,
  computeMenuFontScale,
  computeMenuLayoutScalePortrait,
  computeMenuFontScalePortrait,
  scaledFontPx,
  scaledInt,
} from '../../utils/HudScale';
import { getSettingsManager } from '../../settings';
import { MenuNavigator } from '../../input/MenuNavigator';
import {
  generateDailyChallenge,
  generateWeeklyChallenge,
  getDailyBest,
  DailyChallengeConfig,
  DailyLeaderboardEntry,
} from '../../meta/DailyChallengeManager';
import { getModifierById, selectRunModifiers } from '../../data/RunModifiers';
import { getWeaponInfoList } from '../../weapons';
import { SHIP_CHARACTERS } from '../../data/ShipCharacters';
import { createMenuCard, MenuCard } from '../../visual/MenuCard';
import { createMenuBackground, MenuBackground } from '../../visual/MenuBackground';
import { MENU_COLORS as COLORS, MENU_FONT, DISPLAY_FONT } from '../../visual/MenuStyle';
import { makeDisplayText } from '../../visual/DisplayText';
import { createSubmenuOverlay, SubmenuEntry, SubmenuOverlay } from '../../visual/SubmenuOverlay';
import { showBackupReminderOverlay } from '../../ui/ProfileTransferOverlay';
import {
  loadLastExportAt, loadLastNudgeAt, saveLastNudgeAt, shouldShowBackupNudge,
} from '../../storage';
import { showInstallHintOverlay } from '../../ui/InstallHintOverlay';
import { showCodeEntryOverlay } from '../../ui/CodeEntryOverlay';
import { getDailyQuestCompletionCount } from '../../meta/DailyQuestManager';
import { DAILY_QUEST_COUNT } from '../../data/DailyQuests';
import {
  detectInstallPlatform, isRunningStandalone, loadInstallHintShownAt,
  saveInstallHintShownAt, shouldShowInstallHint, subscribeInstallPromptAvailable,
} from '../../pwa/InstallHint';
import {
  getBankedSeasons,
  getCurrentExpeditionSeasonIndex,
  getCurrentExpeditionSeed,
  getNextExpeditionSeedChoices,
  switchExpeditionWorld,
} from '../../expedition/ExpeditionSeasonStore';
import { isWardenFelled, wardenBossIdForWorld } from '../../expedition/wardenIdentity';
import { getAchievementManager } from '../../achievements';
import { WORLDGEN_VERSION } from '../../world/worldTypes';
import type { RunModeKind } from '../world/WorldModeAdapter';
import {
  bindCurrentExpeditionWorld,
  describeBankedWorlds,
  describeSecretsFound,
  generateExpeditionWorld,
  previewExpeditionWorld,
  previewExpeditionWorlds,
  summariseCurrentExpedition,
} from '../../expedition/expeditionWorld';
import type { BankedWorldRow, ExpeditionProgressSummary } from '../../expedition/expeditionWorld';
import { describeCompletionRecordClause, loadCompletionRecord } from '../../expedition/completionRecord';
import { questWorldStamp } from '../../systems/QuestProgress';
import {
  getActiveQuestStepViews,
  getHeldWorldKeyIds,
  getWorldBoundStepProgress,
} from '../../meta/ExpeditionQuestManager';
import { getOwnedTraversalAbilityIds } from '../../meta/TraversalAbilityManager';
import { isWorldConquered } from '../../expedition/WorldProfileStore';
import { parseSectorKey, sectorCenterWorld } from '../../world/worldSpace';
import type { MapSceneData } from './MapScene';
import {
  RETURN_WORLD_SORT_LABELS,
  nextReturnWorldSort,
  returnWorldPage,
} from '../../expedition/returnWorlds';
import type { ReturnWorldSort } from '../../expedition/returnWorlds';
import { getDiscoveryManager } from '../../expedition/DiscoveryManager';
import { buildQuestBriefingLines } from '../../expedition/questBriefing';
import { decodeSeedCode, encodeSeedCode } from '../../expedition/seedCode';
import { copyTextToClipboard } from '../../utils/Clipboard';

interface FocusEntry {
  onFocus: () => void;
  onBlur: () => void;
  onActivate: () => void;
}

interface ChallengeHalf {
  label: string;
  bodyHex: number;
  accentHex: number;
  accentTextStr: string;
  challenge: DailyChallengeConfig;
  best?: DailyLeaderboardEntry;
  onActivate: () => void;
}

interface ConfirmationCopy {
  title: string;
  /** Newline-separated; the card grows to fit and the text is centred. */
  body: string;
  confirmLabel: string;
  cancelLabel: string;
  /** When present, one button per label replaces the single confirm button and the index of
   *  the pressed one is handed to onConfirm. Absent means the two-button dialog. */
  choiceLabels?: readonly string[];
}

/** What BootScene is started or restarted with. Two setters: main.ts's orientation watcher, and
 *  MapScene's browse-mode close, which names the submenu the survey was opened from. */
interface BootLaunchData {
  relayout?: boolean;
  openSubmenu?: string;
}

const DEFAULT_CONFIRMATION_COPY: ConfirmationCopy = {
  title: 'START NEW RUN?',
  body: 'Your current run will be lost.',
  confirmLabel: 'YES',
  cancelLabel: 'NO',
};

export class BootScene extends Phaser.Scene {
  private soundManager!: SoundManager;
  private menuNavigator: MenuNavigator | null = null;
  private confirmationOverlay: Phaser.GameObjects.Container | null = null;
  private confirmationNavigator: MenuNavigator | null = null;
  private metaTooltip: Phaser.GameObjects.Container | null = null;
  private submenu: SubmenuOverlay | null = null;
  private openSubmenuTitle: string | null = null;
  private submenuOpeners = new Map<string, () => void>();
  private pendingSubmenuTitle: string | null = null;
  private tooltipEscHandler: ((event: KeyboardEvent) => void) | null = null;
  private selectedFocusIndex: number = 0;
  private focusEntries: FocusEntry[] = [];

  private menuBackground: MenuBackground | null = null;
  private backupOverlayTeardown: (() => void) | null = null;
  private installHintTeardown: (() => void) | null = null;
  private codeEntryTeardown: (() => void) | null = null;
  private installPromptUnsubscribe: (() => void) | null = null;
  private cards: MenuCard[] = [];
  private titleTicker: ((timeSeconds: number) => void) | null = null;
  private updateHandler: ((time: number, delta: number) => void) | null = null;

  constructor() {
    super({ key: 'BootScene' });
  }

  /** `relayout` is set only by main.ts's orientation watcher, which pairs it with the title of
   *  the submenu that was open so a flip puts the player back where they were. A fresh entry
   *  carries neither field and always opens on the deck row. */
  init(data?: BootLaunchData): void {
    this.pendingSubmenuTitle = data?.relayout === true && typeof data.openSubmenu === 'string'
      ? data.openSubmenu
      : null;
  }

  preload(): void {
    const particleGraphics = this.make.graphics({});
    particleGraphics.fillStyle(0xffffff);
    particleGraphics.fillRect(0, 0, 4, 4);
    particleGraphics.generateTexture('particle', 4, 4);
    particleGraphics.destroy();

    const glowSize = 16;
    const glowGraphics = this.make.graphics({});
    for (let radius = glowSize; radius > 0; radius -= 2) {
      const alpha = (radius / glowSize) * 0.8;
      glowGraphics.fillStyle(0xffffff, alpha);
      glowGraphics.fillCircle(glowSize, glowSize, radius);
    }
    glowGraphics.generateTexture('particle_glow', glowSize * 2, glowSize * 2);
    glowGraphics.destroy();

    const streakGraphics = this.make.graphics({});
    streakGraphics.fillStyle(0xffffff, 1);
    streakGraphics.fillRect(0, 1, 12, 2);
    streakGraphics.fillStyle(0xffffff, 0.5);
    streakGraphics.fillRect(0, 0, 12, 1);
    streakGraphics.fillRect(0, 3, 12, 1);
    streakGraphics.generateTexture('particle_streak', 12, 4);
    streakGraphics.destroy();

    this.load.audio(SoundKeys.HIT, 'sfx/hit.ogg');
    this.load.audio(SoundKeys.PICKUP_XP, 'sfx/pickup_xp.ogg');
    this.load.audio(SoundKeys.PICKUP_HEALTH, 'sfx/pickup_health.ogg');
    this.load.audio(SoundKeys.LEVEL_UP, 'sfx/levelup.ogg');
    this.load.audio(SoundKeys.PLAYER_HURT, 'sfx/player_hurt.ogg');

    preloadIcons(this);
  }

  create(): void {
    this.soundManager = new SoundManager(this);
    this.focusEntries = [];
    this.cards = [];
    this.selectedFocusIndex = 0;
    this.confirmationOverlay = null;
    this.confirmationNavigator = null;
    this.metaTooltip = null;
    this.submenu = null;
    this.tooltipEscHandler = null;
    this.titleTicker = null;
    this.updateHandler = null;
    this.backupOverlayTeardown = null;
    this.installHintTeardown = null;
    this.codeEntryTeardown = null;
    this.installPromptUnsubscribe = null;

    const musicManager = getMusicManager();
    const startMenuMusic = async () => {
      try {
        if (musicManager.getPlaybackMode() !== 'off' && !musicManager.getIsPlaying()) {
          await musicManager.play();
        }
      } catch {
        // AudioContext may still be locked or the track fetch failed — menu
        // music is best-effort; the next gesture path can retry.
      }
    };
    this.input.once('pointerdown', startMenuMusic);
    this.input.keyboard?.once('keydown', startMenuMusic);

    // ─── data ───────────────────────────────────────────────────────────
    const metaManager = getMetaProgressionManager();
    const ascensionManager = getAscensionManager();
    const ascensionLevel = ascensionManager.getLevel();
    const worldLevel = metaManager.getWorldLevel();
    const currentStreak = metaManager.getCurrentStreak();
    const streakBonus = metaManager.getStreakBonusPercent();
    const goldAmount = metaManager.getGold();

    const gameStateManager = getGameStateManager();
    const hasSave = gameStateManager.hasSave();
    const saveInfo = gameStateManager.getSaveInfo();
    const lastLoadout = loadLastLoadout();

    // The boss the hero card's button will actually field: a saved daily keeps its date-seeded
    // boss, an expedition (the live default for a fresh run) meets that world's own Warden, and
    // only an arena run still takes the persisted rotation.
    const heroRunMode: RunModeKind = hasSave ? saveInfo.runMode ?? 'arena' : 'expedition';
    const upcomingBossId = hasSave && saveInfo.dailyDate
      ? bossIdAtRotation(challengeBossRotationIndex(saveInfo.dailyDate))
      : heroRunMode === 'expedition'
        ? wardenBossIdForWorld(getCurrentExpeditionSeed(), WORLDGEN_VERSION)
        : getUpcomingBossId();
    const upcomingBossName = getEnemyType(upcomingBossId)?.name ?? '';

    const dailyChallenge = generateDailyChallenge();
    const weeklyChallenge = generateWeeklyChallenge();
    const bestDaily = getDailyBest('daily', dailyChallenge.dateString);
    const bestWeekly = getDailyBest('weekly', weeklyChallenge.dateString);

    // ─── actions ────────────────────────────────────────────────────────
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
        // Explicit false — Phaser keeps a scene's last settings.data when
        // start() gets none, so a prior GAUNTLET launch would otherwise leak
        // its mode flag into every later standard PLAY.
        transitionToScene(this, 'WeaponSelectScene', { gauntletMode: false });
      } catch (error) {
        console.error('Could not start game:', error);
        gameStateManager.clearSave();
        this.scene.start('WeaponSelectScene', { gauntletMode: false });
      }
    };

    const startGameWithConfirmation = () => {
      if (hasSave) {
        this.showNewGameConfirmation(startNewGame);
      } else {
        startNewGame();
      }
    };

    // Runner mode is gameplay — fade like CONTINUE, not the menu sweep.
    const startRunner = () => fadeOut(this, 200, () => this.scene.start('RunnerScene'));

    // Practice is a weapon picker, not gameplay itself — sweep like the other menus.
    // Explicit false — Phaser keeps a scene's last settings.data when start()
    // gets none (same trap as startNewGame above), so a flip's `relayout: true`
    // would otherwise leak into the next fresh PRACTICE entry.
    const startPractice = () => transitionToScene(this, 'PracticeScene', { relayout: false });

    // Gauntlet boss-rush runs through the standard ship/weapon/pact flow with
    // the mode flag threaded; it uses the same save slot as a standard run, so
    // an existing save gets the same overwrite confirmation as NEW RUN.
    const startGauntlet = async () => {
      try {
        if (musicManager.getPlaybackMode() !== 'off' && !musicManager.getIsPlaying()) {
          await musicManager.play();
        }
        gameStateManager.clearSave();
        transitionToScene(this, 'WeaponSelectScene', { gauntletMode: true });
      } catch (error) {
        console.error('Could not start gauntlet:', error);
        gameStateManager.clearSave();
        this.scene.start('WeaponSelectScene', { gauntletMode: true });
      }
    };
    const startGauntletWithConfirmation = () => {
      if (hasSave) {
        this.showNewGameConfirmation(startGauntlet);
      } else {
        startGauntlet();
      }
    };

    // Arena skirmish (FEAT-EXPEDITION-PROMOTE): the fixed-room run the game shipped
    // with, kept as an explicit choice now that the default START is an expedition.
    // Same funnel, same save slot, so it gets the same overwrite confirmation.
    const startSkirmish = async () => {
      try {
        if (musicManager.getPlaybackMode() !== 'off' && !musicManager.getIsPlaying()) {
          await musicManager.play();
        }
        gameStateManager.clearSave();
        transitionToScene(this, 'WeaponSelectScene', { gauntletMode: false, runMode: 'arena' });
      } catch (error) {
        console.error('Could not start skirmish:', error);
        gameStateManager.clearSave();
        this.scene.start('WeaponSelectScene', { gauntletMode: false, runMode: 'arena' });
      }
    };
    const startSkirmishWithConfirmation = () => {
      if (hasSave) {
        this.showNewGameConfirmation(startSkirmish);
      } else {
        startSkirmish();
      }
    };

    // FEAT-EXPEDITION-SEASONS: the world seed is per profile now, so a charted world can be
    // banked and traded for a fresh one. FEAT-SEASON-WORLD-CHOICE: which fresh one is the
    // player's pick out of three. FEAT-SEASON-RETURN-TO-WORLD: a banked world keeps its chart,
    // so leaving one is reversible.
    // FEAT-SEASON-RETURN-FULL-LIST: the return dialog pages, so every banked world is
    // reachable and not only the three most recent. The press costs four generateWorld calls
    // (34 ms each, measured): the summary plus one preview per candidate, memoised on the
    // candidate list.
    const flyExpeditionWorld = (
      summary: ExpeditionProgressSummary, targetSeed?: number,
    ) => {
      const next = switchExpeditionWorld({
        completionPercent: summary.completionPercent,
        sectorsCharted: summary.sectorsCharted,
        secretsFound: summary.secretsFound,
      }, targetSeed);
      // A restored transform names a point in the world that just stopped being the live one.
      gameStateManager.clearSave();
      // Nothing in memory may keep pointing at the world that was just banked.
      getDiscoveryManager().bindWorld(generateExpeditionWorld(next.currentSeed));
      this.scene.restart();
    };

    const describeBankedRow = (row: BankedWorldRow) => (
      `W${row.index}   ·   ${row.completionPercent}% charted`
      + `   ·   ${row.sectorsCharted} sectors`
      + `   ·   ${describeSecretsFound(row.secretsFound, previewExpeditionWorld(row.seed).secretSlots)}`
      + (row.conquered ? '   ·   CONQUERED' : '')
    );

    // The price the three world-change dialogs did not name. A distinct sweep's rooms are
    // stamped to the world they were charted in and are dropped whole on a change, so the
    // dialog that makes the change is where that has to be said.
    const worldBoundObjectiveLines = (summary: ExpeditionProgressSummary): string[] => {
      const stamp = questWorldStamp(summary);
      const bound = getWorldBoundStepProgress().filter(row => row.worldStamp === stamp);
      if (bound.length === 0) return [];
      const lines = ['', bound.length === 1
        ? 'One objective counts rooms in this world and restarts with it:'
        : `${bound.length} objectives count rooms in this world and restart with it:`];
      for (const row of bound) {
        lines.push(`${row.questName}: ${row.roomsCounted} charted so far`);
      }
      return lines;
    };

    // MORE walks the pages rather than a scrolling panel: the confirmation's button row fits
    // five, which is three worlds plus MORE plus BACK, and the page index wraps so one button
    // reaches every one of the 20 worlds the archive keeps. SORT re-orders that same list and
    // always returns to page 1, because a re-ordered page 3 would name worlds the player has
    // not been shown. The order is dialog-local and threaded through the reopen exactly as the
    // page is, so nothing about it is persisted.
    const openReturnToBankedWorld = (
      summary: ExpeditionProgressSummary,
      requestedPage = 0,
      sort: ReturnWorldSort = 'recent',
    ): void => {
      const allRows = describeBankedWorlds(getBankedSeasons());
      const { rows: returnable, page, pageCount } = returnWorldPage(allRows, sort, requestedPage);
      const completionRecord = loadCompletionRecord();
      const lines = [
        `WORLD ${summary.seasonIndex}   ·   SEED ${summary.seed}`
          + (summary.conquered ? '   ·   CONQUERED' : ''),
        `Charted ${summary.completionPercent}%   ·   ${summary.sectorsCharted} / ${summary.knowableSectors} sectors`
          + `   ·   ${describeSecretsFound(summary.secretsFound, summary.knowableSecrets)}`
          + describeCompletionRecordClause(completionRecord, summary.completionPercent),
        '',
        'The world you leave is banked with its chart.',
        'A world you return to is exactly as you left it: the same',
        'chart, the same broken walls, the same secrets found.',
      ];
      lines.push(...worldBoundObjectiveLines(summary));
      if (hasSave) lines.push('', 'Your current run will be lost.');
      const order = RETURN_WORLD_SORT_LABELS[sort];
      lines.push('', pageCount > 1
        ? `Fly back to, ${order}   (page ${page + 1} of ${pageCount}):`
        : `Fly back to, ${order}:`);
      for (const row of returnable) lines.push(describeBankedRow(row));

      // Both trailing buttons are conditional, so their indexes are computed rather than being
      // "past the last row": with one banked world there is neither, and the row is FLY + BACK.
      const hasMore = pageCount > 1;
      const hasSort = allRows.length > 1;
      const moreIndex = hasMore ? returnable.length : -1;
      const sortIndex = hasSort ? returnable.length + (hasMore ? 1 : 0) : -1;

      this.showNewGameConfirmation(
        (choiceIndex) => {
          if (choiceIndex === sortIndex) {
            openReturnToBankedWorld(summary, 0, nextReturnWorldSort(sort));
            return;
          }
          if (choiceIndex === moreIndex) {
            openReturnToBankedWorld(summary, page + 1, sort);
            return;
          }
          flyExpeditionWorld(summary, returnable[choiceIndex]?.seed);
        },
        {
          title: 'RETURN TO A WORLD?',
          body: lines.join('\n'),
          confirmLabel: 'FLY',
          cancelLabel: 'BACK',
          choiceLabels: [
            ...returnable.map(row => `FLY W${row.index}`),
            ...(hasMore ? ['MORE'] : []),
            ...(hasSort ? ['SORT'] : []),
          ],
        },
      );
    };

    // FEAT-SEASON-CHOICE-SEED-ENTRY: adopting a shared world is the same commit CHART A NEW
    // WORLD makes, so it banks the current world the same way and reuses flyExpeditionWorld.
    // The warning is its own, because leaving your deterministic chain is not one of the three
    // this dialog's siblings carry.
    const openPastedWorldConfirmation = (
      summary: ExpeditionProgressSummary, seed: number,
    ): void => {
      // One generateWorld, 34 ms measured, on a button press.
      const preview = previewExpeditionWorld(seed);
      const returning = getBankedSeasons().some(season => season.seed === seed);
      const lines = [
        `${encodeSeedCode(seed)}   ·   SEED ${seed}`,
        `${preview.secretSlots} secrets   ·   ${preview.cacheSlots} caches`
          + `   ·   ${preview.deepestSectorDepth} sectors out   ·   ${preview.deepestRegionName}`
          + `   ·   ${preview.wardenName}`
          + (isWardenFelled(
            getAchievementManager().getLifetimeStats().wardensFelledMask, preview.wardenBossId,
          ) ? '' : ' (NEW)'),
        '',
        `Leaving world ${summary.seasonIndex} banks it with its chart, so you can`,
        'return to it. Traversal abilities and quest keys are kept.',
        'The worlds you are dealt next follow on from this one.',
      ];
      if (returning) {
        lines.push('', 'You have flown this world before: its chart comes back with it.');
      }
      lines.push(...worldBoundObjectiveLines(summary));
      if (hasSave) lines.push('', 'Your current run will be lost.');
      this.showNewGameConfirmation(
        () => flyExpeditionWorld(summary, seed),
        {
          title: 'FLY A SHARED WORLD?',
          body: lines.join('\n'),
          confirmLabel: 'FLY IT',
          cancelLabel: 'BACK',
        },
      );
    };

    // FEAT-SEASON-SEED-SHARE: the copy half. Both halves live in one nested dialog rather than two
    // buttons on the CHART row, which is already five wide. A status line rather than a flash:
    // showNewGameConfirmation always closes before it calls back, so the dialog is reopened
    // carrying its own result, exactly as RETURN's MORE button reopens itself on the next page.
    const openSeedCodeDialog = (
      summary: ExpeditionProgressSummary, status?: string,
    ): void => {
      const code = encodeSeedCode(summary.seed);
      const lines = [
        `WORLD ${summary.seasonIndex}   ·   SEED ${summary.seed}`,
        `CODE   ${code}`,
        '',
        'Copy the code to hand this world to another player.',
        'Paste a code, or TYPE one you can read but not copy, to fly',
        'the world it names: the world you leave is banked with its',
        'chart and can be returned to.',
      ];
      if (status) lines.push('', status);
      this.showNewGameConfirmation(
        (choiceIndex) => {
          if (choiceIndex === 0) {
            void copyTextToClipboard(code).then(copied => openSeedCodeDialog(
              summary,
              copied ? 'Code copied to the clipboard.' : 'Could not reach the clipboard.',
            ));
            return;
          }
          if (choiceIndex === 2) {
            // showNewGameConfirmation closed the dialog and resumeMainNavigator rebuilt the menu
            // navigator before this ran, so it is live behind the DOM field and would eat every
            // keystroke; this is the same pairing maybeShowBackupReminder uses.
            this.menuNavigator?.setEnabled(false);
            this.codeEntryTeardown = showCodeEntryOverlay<number>({
              title: 'ENTER A WORLD CODE',
              body: 'Type a world code, or the seed number printed beside it.',
              placeholder: 'PPW1-...',
              submitLabel: 'FLY IT',
              autocapitalize: 'characters',
              decode: (typed) => {
                const typedSeed = decodeSeedCode(typed);
                if (typedSeed === null) return { ok: false, error: 'That is not a world code.' };
                // switchExpeditionWorld ignores a chosen seed equal to the live one and rolls a
                // random world instead, so accepting your own code would fly somewhere else.
                if (typedSeed === summary.seed) {
                  return { ok: false, error: 'That is the world you are already flying.' };
                }
                return { ok: true, value: typedSeed };
              },
              onSubmit: (typedSeed) => {
                this.codeEntryTeardown = null;
                this.menuNavigator?.setEnabled(true);
                openPastedWorldConfirmation(summary, typedSeed);
              },
              onClose: () => {
                this.codeEntryTeardown = null;
                this.menuNavigator?.setEnabled(true);
                openSeedCodeDialog(summary);
              },
            });
            return;
          }
          void (async () => {
            let pasted = '';
            try {
              pasted = (await navigator.clipboard?.readText?.()) ?? '';
            } catch {
              pasted = '';
            }
            const seed = decodeSeedCode(pasted);
            if (seed === null) {
              openSeedCodeDialog(summary, 'No world code on the clipboard.');
              return;
            }
            // switchExpeditionWorld ignores a chosen seed equal to the live one and rolls a
            // random world instead, so pasting your own code would fly somewhere else entirely.
            if (seed === summary.seed) {
              openSeedCodeDialog(summary, 'That code is the world you are already flying.');
              return;
            }
            openPastedWorldConfirmation(summary, seed);
          })();
        },
        {
          title: 'WORLD CODE',
          body: lines.join('\n'),
          confirmLabel: 'COPY',
          cancelLabel: 'BACK',
          choiceLabels: ['COPY', 'PASTE', 'TYPE'],
        },
      );
    };

    const openExpeditionSeasons = () => {
      const summary = summariseCurrentExpedition();
      const banked = describeBankedWorlds(getBankedSeasons());
      const choices = getNextExpeditionSeedChoices();
      const previews = previewExpeditionWorlds(choices);
      const felledMask = getAchievementManager().getLifetimeStats().wardensFelledMask;
      const completionRecord = loadCompletionRecord();
      const wardenClause = (bossTypeId: string, name: string) => (
        isWardenFelled(felledMask, bossTypeId) ? name : `${name} (NEW)`
      );
      const lines = [
        `WORLD ${summary.seasonIndex}   ·   SEED ${summary.seed}`
          + (summary.conquered ? '   ·   CONQUERED' : ''),
        `Charted ${summary.completionPercent}%   ·   ${summary.sectorsCharted} / ${summary.knowableSectors} sectors`
          + `   ·   ${describeSecretsFound(summary.secretsFound, summary.knowableSecrets)}`
          + describeCompletionRecordClause(completionRecord, summary.completionPercent),
        `Warden: ${wardenClause(summary.wardenBossId, summary.wardenName)}`,
        '',
        'A new world resets the chart, the leads and every broken wall.',
        'The world you leave is banked and can be returned to.',
        'Traversal abilities and quest keys are kept, so doors you have',
        'already earned open on sight.',
      ];
      lines.push(...worldBoundObjectiveLines(summary));
      if (hasSave) lines.push('', 'Your current run will be lost.');
      lines.push('', 'Choose the world you fly next:');
      for (const [index, preview] of previews.entries()) {
        lines.push(
          `${String.fromCharCode(65 + index)}   ${preview.secretSlots} secrets`
          + `   ·   ${preview.cacheSlots} caches`
          + `   ·   ${preview.deepestSectorDepth} sectors out`
          + `   ·   ${preview.deepestRegionName}`
          + `   ·   ${wardenClause(preview.wardenBossId, preview.wardenName)}`,
        );
      }
      if (banked.length > 0) {
        const recent = banked.slice(-5);
        // The count is what tells the player RETURN reaches more than the five rows shown.
        const label = banked.length > recent.length
          ? `Banked (${banked.length} worlds, last ${recent.length})`
          : 'Banked';
        lines.push('', `${label}: ${recent
          .map(season => `W${season.index} ${season.completionPercent}%${season.conquered ? '*' : ''}`)
          .join('   ·   ')}`);
        // An asterisk rather than a glyph: the menu font is only trusted for ASCII plus the
        // middle dot this dialog already uses.
        if (recent.some(season => season.conquered)) lines.push('* conquered');
      }
      this.showNewGameConfirmation(
        (choiceIndex) => {
          // The tail of the row is RETURN (only when something is banked) then CODE, so the two
          // are indexed off the preview count rather than by "past the last preview".
          const returnIndex = banked.length > 0 ? choices.length : -1;
          const codeIndex = choices.length + (banked.length > 0 ? 1 : 0);
          if (choiceIndex === codeIndex) {
            openSeedCodeDialog(summary);
            return;
          }
          if (choiceIndex === returnIndex) {
            openReturnToBankedWorld(summary);
            return;
          }
          // An out-of-range index cannot happen and would be harmless if it did: an undefined
          // chosen seed falls back to the deterministic roll in the store.
          flyExpeditionWorld(summary, choices[choiceIndex]);
        },
        {
          title: 'CHART A NEW WORLD?',
          body: lines.join('\n'),
          confirmLabel: 'NEW WORLD',
          cancelLabel: 'BACK',
          choiceLabels: [
            ...previews.map((_, index) => `FLY ${String.fromCharCode(65 + index)}`),
            ...(banked.length > 0 ? ['RETURN'] : []),
            'CODE',
          ],
        },
      );
    };
    // The objectives a profile carries are readable only from inside a run (the HUD ticker, the
    // map's OBJECTIVES panel, the pause row), so between runs there is nowhere to read what the
    // next one is for. One summariseCurrentExpedition call (one generateWorld, 33 ms measured) on
    // a button press, the same price the CHART dialog already pays.
    const openObjectives = () => {
      const summary = summariseCurrentExpedition();
      const worldStamp = questWorldStamp(summary);
      const lines = buildQuestBriefingLines({
        seasonIndex: summary.seasonIndex,
        completionPercent: summary.completionPercent,
        worldStamp,
        views: getActiveQuestStepViews(worldStamp, null),
        worldBound: getWorldBoundStepProgress(),
      });
      // An empty choiceLabels leaves the single centred cancel button, which is what an
      // informational dialog wants: onConfirm can never fire, so it is a no-op.
      this.showNewGameConfirmation(() => {}, {
        title: 'OBJECTIVES',
        body: lines.join('\n'),
        confirmLabel: 'BACK',
        cancelLabel: 'BACK',
        choiceLabels: [],
      });
    };
    // The chart itself, not a summary of it: every panel twenty sessions built on that screen
    // (objectives, leads, LOCKED OUT with its hop counts, the plotted course, marks and notes)
    // existed only inside a live run until now. One bindCurrentExpeditionWorld, the same single
    // generateWorld the CHART dialog already pays, on a button press.
    const openWorldSurvey = () => {
      const map = bindCurrentExpeditionWorld();
      const hangar = parseSectorKey(map.startKey) ?? { col: 0, row: 0 };
      const hangarCentre = sectorCenterWorld(hangar);
      const payload: MapSceneData = {
        returnTo: 'BootScene',
        map,
        // The hangar, because a fresh expedition unconditionally starts there: every hop count on
        // the LOCKED OUT panel and every plotted course then measures the trip the next run
        // actually makes. The ship marker is left drawn on it rather than swapped for a new glyph,
        // because between runs the ship IS docked at the hangar, and a new marker would need a
        // legend row on the one surface four filed items are already queued behind.
        playerWorldX: hangarCentre.x,
        playerWorldY: hangarCentre.y,
        playerFacing: 0,
        ownedAbilityIds: getOwnedTraversalAbilityIds(),
        earnedQuestKeyIds: getHeldWorldKeyIds(map.seed, map.worldGenVersion),
        // Nests, lairs, spent hives and this expedition's blooms and shifts are run-scoped: they
        // exist only once a run has stocked them, so between runs the honest answer is "none".
        // The warden is not run-scoped: it stands in its arena until the world is conquered, and
        // it is the one dormant threat a pre-run chart must name.
        hazardSectors: isWorldConquered(map.seed, map.worldGenVersion)
          ? []
          : [{ sectorKey: map.bossArenaKey, kind: 'warden' }],
        spentNestSectorKeys: [],
        bloomedSectors: [],
        shiftedSectors: [],
        recallAvailable: false,
        sortieAvailable: false,
      };
      transitionToScene(this, 'MapScene', payload);
    };
    const openShop = () => transitionToScene(this, 'ShopScene');
    const openAchievements = () => transitionToScene(this, 'AchievementScene');
    const openCodex = () => transitionToScene(this, 'CodexScene');
    const openCards = () => transitionToScene(this, 'CardsScene');
    const openLeaderboard = () => transitionToScene(this, 'LeaderboardScene');
    const openPaint = () => transitionToScene(this, 'PaintScene');
    const openSettings = () => transitionToScene(this, 'SettingsScene', { returnTo: 'BootScene' });
    const openCredits = () => transitionToScene(this, 'CreditsScene');

    const launchChallenge = async (challenge: DailyChallengeConfig) => {
      try {
        if (musicManager.getPlaybackMode() !== 'off' && !musicManager.getIsPlaying()) {
          await musicManager.play();
        }
        gameStateManager.clearSave();
        fadeOut(this, 200, () => {
          this.scene.start('GameScene', {
            restore: false,
            startingWeapon: challenge.startingWeaponId,
            shipId: challenge.shipId,
            modifierIds: challenge.modifierIds,
            dailyMode: true,
            dailyDate: challenge.dateString,
            dailyChallengeType: challenge.challengeType,
          });
        });
      } catch (error) {
        console.error(`Could not start ${challenge.challengeType} run:`, error);
      }
    };

    const startDailyRun = () => launchChallenge(dailyChallenge);
    const startWeeklyRun = () => launchChallenge(weeklyChallenge);

    // Replay re-rolls run modifiers (they are random per-run variety, never a
    // player choice) and clears any in-progress save, exactly like NEW RUN, then
    // drops straight into GameScene — skipping the whole pre-run funnel.
    const replayLoadout = async (loadout: LastLoadout) => {
      try {
        if (musicManager.getPlaybackMode() !== 'off' && !musicManager.getIsPlaying()) {
          await musicManager.play();
        }
        gameStateManager.clearSave();
        fadeOut(this, 200, () => {
          this.scene.start('GameScene', {
            restore: false,
            startingWeapon: loadout.startingWeapon,
            shipId: loadout.shipId,
            stageId: loadout.stageId,
            modifierIds: selectRunModifiers(2).map((modifier) => modifier.id),
            pactIds: loadout.pactIds,
            gauntletMode: loadout.gauntletMode,
            runMode: loadout.runMode,
            directorStrategy: loadout.directorStrategy,
            threatLevel: loadout.threatLevel,
          });
        });
      } catch (error) {
        console.error('Could not replay loadout:', error);
      }
    };
    const replayLoadoutWithConfirmation = (loadout: LastLoadout) => {
      if (hasSave) {
        this.showNewGameConfirmation(() => replayLoadout(loadout));
      } else {
        replayLoadout(loadout);
      }
    };

    // Surprise Me: roll a fully-randomized valid loadout and drop straight into a
    // run (re-rolling modifiers like a replay), skipping the whole pre-run funnel.
    // Saved as the last loadout so a surprise run you liked re-launches from REPLAY.
    const surpriseRun = () => {
      const loadout = buildRandomLoadout();
      saveLastLoadout(loadout);
      return replayLoadout(loadout);
    };
    const startSurpriseRunWithConfirmation = () => {
      if (hasSave) {
        this.showNewGameConfirmation(surpriseRun);
      } else {
        surpriseRun();
      }
    };

    // ─── scaling ────────────────────────────────────────────────────────
    // Portrait uses the orientation-matched 720×1280 design fit: the menu is
    // a ~600-unit-wide centered column, so it renders FULL SIZE there —
    // shrinking the landscape design in instead (0.5625) stranded a tiny
    // menu in the top third of the screen. The column is then centered
    // vertically via columnOffsetY (everything below the title cascades
    // from titleY/heroCenterY; the meta stack and footer stay edge-pinned).
    const portrait = this.scale.height > this.scale.width;
    const layoutScale = portrait
      ? computeMenuLayoutScalePortrait(this.scale.width, this.scale.height)
      : computeMenuLayoutScale(this.scale.width, this.scale.height);
    const fontScale = portrait
      ? computeMenuFontScalePortrait(this.scale.width, this.scale.height, getSettingsManager().getUiScale())
      : computeMenuFontScale(
          this.scale.width,
          this.scale.height,
          getSettingsManager().getUiScale(),
        );
    const columnOffsetY = portrait
      ? Math.max(0, Math.round((this.scale.height - scaledInt(layoutScale, 720)) / 2))
      : 0;
    const centerX = this.cameras.main.centerX;

    // ─── menu backdrop ──────────────────────────────────────────────────
    this.menuBackground = createMenuBackground(this);

    // ─── title block ────────────────────────────────────────────────────
    const titleY = scaledInt(layoutScale, 100) + columnOffsetY;
    this.createTitleBlock(centerX, titleY, fontScale);

    // ─── meta-stack mini cards (top-left) ───────────────────────────────
    this.createMetaStack({
      worldLevel,
      ascensionLevel,
      currentStreak,
      streakBonus,
      layoutScale,
      fontScale,
    });

    // ─── hero card (CONTINUE / START) ───────────────────────────────────
    const heroWidth = scaledInt(layoutScale, 360);
    const heroHeight = scaledInt(layoutScale, 170);
    const heroCenterY = scaledInt(layoutScale, 280) + columnOffsetY;
    this.createHeroCard({
      centerX,
      centerY: heroCenterY,
      width: heroWidth,
      height: heroHeight,
      fontScale,
      layoutScale,
      hasSave,
      saveInfo,
      upcomingBossName,
      onActivate: hasSave ? continueGame : startGameWithConfirmation,
    });

    // ─── new-run link (only when a save exists) ─────────────────────────
    let belowHeroY = heroCenterY + heroHeight / 2 + scaledInt(layoutScale, 22);
    if (hasSave) {
      this.createNewRunLink({
        centerX,
        centerY: belowHeroY,
        layoutScale,
        fontScale,
        onActivate: startGameWithConfirmation,
      });
      belowHeroY += scaledInt(layoutScale, 36);
    }

    // ─── challenge card (daily + weekly, one card, two tap zones) ───────
    const challengeWidth = scaledInt(layoutScale, 596);
    const challengeHeight = scaledInt(layoutScale, 130);
    const challengeRowY = belowHeroY + challengeHeight / 2 + scaledInt(layoutScale, 6);

    this.createChallengeRow({
      centerX,
      centerY: challengeRowY,
      width: challengeWidth,
      height: challengeHeight,
      layoutScale,
      fontScale,
      halves: [
        {
          label: 'DAILY',
          bodyHex: COLORS.bodyGold,
          accentHex: COLORS.accentGold,
          accentTextStr: COLORS.accentGoldStr,
          challenge: dailyChallenge,
          best: bestDaily,
          onActivate: startDailyRun,
        },
        {
          label: 'WEEKLY',
          bodyHex: COLORS.bodyMagenta,
          accentHex: COLORS.accentMagenta,
          accentTextStr: COLORS.accentMagentaStr,
          challenge: weeklyChallenge,
          best: bestWeekly,
          onActivate: startWeeklyRun,
        },
      ],
    });

    // ─── progression deck (Shop / Ach / Codex / Leaderboard) ────────────
    const deckCardWidth = scaledInt(layoutScale, 96);
    const deckCardHeight = scaledInt(layoutScale, 110);
    const deckGap = scaledInt(layoutScale, 22);
    const naturalDeckY = challengeRowY + challengeHeight / 2 + scaledInt(layoutScale, 32) + deckCardHeight / 2;

    // Reserve space for the footer pill so the deck never overlaps it on
    // short viewports — pill height must match createFooterStrip
    // (fontSize + padY * 2).
    const footerFontSize = scaledInt(fontScale, 12);
    const footerPadY = scaledInt(layoutScale, 8);
    const footerPillHeight = footerFontSize + footerPadY * 2;
    const footerBottomY = this.scale.height - scaledInt(layoutScale, 18);
    const footerTopY = footerBottomY - footerPillHeight;
    const footerClearance = scaledInt(layoutScale, 14);
    const maxDeckY = footerTopY - footerClearance - deckCardHeight / 2;
    const deckY = Math.min(naturalDeckY, maxDeckY);

    // The same filter the dialog lists from, so the badge cannot disagree with it, and no
    // generateWorld: WORLDGEN_VERSION is the version a freshly generated world carries, the
    // shortcut describeBankedWorlds already takes.
    const activeObjectiveCount = getActiveQuestStepViews(
      questWorldStamp({ seed: getCurrentExpeditionSeed(), worldGenVersion: WORLDGEN_VERSION }),
      null,
    ).length;

    this.createProgressionDeck({
      centerX,
      centerY: deckY,
      cardWidth: deckCardWidth,
      cardHeight: deckCardHeight,
      gap: deckGap,
      layoutScale,
      fontScale,
      goldAmount,
      questBadge: `${getDailyQuestCompletionCount()}/${DAILY_QUEST_COUNT}`,
      onShop: openShop,
      onAchievements: openAchievements,
      onCodex: openCodex,
      onCards: openCards,
      onSkirmish: startSkirmishWithConfirmation,
      onGauntlet: startGauntletWithConfirmation,
      onRunner: startRunner,
      onPractice: startPractice,
      onLeaderboard: openLeaderboard,
      onPaint: openPaint,
      onExpeditionSeasons: openExpeditionSeasons,
      onObjectives: openObjectives,
      objectiveCount: activeObjectiveCount,
      onWorldSurvey: openWorldSurvey,
      onSurprise: startSurpriseRunWithConfirmation,
      showLoadouts: Boolean(lastLoadout) || loadLoadoutPresets().length > 0,
      onLoadouts: () => transitionToScene(this, 'LoadoutScene'),
    });

    // ─── footer strip ───────────────────────────────────────────────────
    this.createFooterStrip({
      centerX,
      bottomY: footerBottomY,
      layoutScale,
      fontScale,
      onSettings: openSettings,
      onCredits: openCredits,
    });

    // ─── entrance choreography ──────────────────────────────────────────
    // Cards rise into place top-to-bottom (creation order matches visual
    // order); the title block runs its own fade in createTitleBlock.
    staggerEntrance(this, this.cards.map((card) => card.container));
    sweepIn(this);

    // ─── per-frame idle driver ──────────────────────────────────────────
    this.updateHandler = (time: number, delta: number) => {
      const seconds = time / 1000;
      this.menuBackground?.update(delta);
      for (const card of this.cards) card.tickIdle(seconds);
      this.titleTicker?.(seconds);
    };
    this.events.on(Phaser.Scenes.Events.UPDATE, this.updateHandler);

    // ─── menu nav ───────────────────────────────────────────────────────
    this.buildMainNavigator(this.selectedFocusIndex);

    // A resize or orientation flip restarts this scene (src/main.ts), which would otherwise drop
    // a player browsing a submenu back onto the deck row. Fires after the navigator is built
    // because openSubmenu pauses it.
    if (this.pendingSubmenuTitle !== null) {
      this.submenuOpeners.get(this.pendingSubmenuTitle)?.();
      this.pendingSubmenuTitle = null;
    }

    this.maybeShowBackupReminder(metaManager.getRunsCompleted());
    this.maybeShowInstallHint(metaManager.getRunsCompleted());

    // A launch chosen in LoadoutScene is handed here to reuse the existing
    // confirm-if-a-run-is-in-progress + clear-save + fade-to-run path. consume
    // clears it so a later plain return to BootScene never re-fires the replay.
    const pendingReplay = consumePendingReplay();
    if (pendingReplay) {
      replayLoadoutWithConfirmation(pendingReplay);
    }

    this.events.once('shutdown', this.shutdown, this);
  }

  private maybeShowBackupReminder(runsCompleted: number): void {
    if (this.backupOverlayTeardown) return;
    const now = Date.now();
    if (!shouldShowBackupNudge({
      runsCompleted,
      lastExportAt: loadLastExportAt(),
      lastNudgeAt: loadLastNudgeAt(),
      now,
    })) return;

    // Stamped on show, not on dismiss: create() re-runs on every orientation
    // flip and on every return to the menu, and the cooldown is the only thing
    // stopping the prompt reopening each time.
    saveLastNudgeAt(now);
    this.menuNavigator?.setEnabled(false);
    this.backupOverlayTeardown = showBackupReminderOverlay({
      runsCompleted,
      onClose: () => {
        this.backupOverlayTeardown = null;
        this.menuNavigator?.setEnabled(true);
      },
    });
  }

  /**
   * The backup nudge outranks this: losing a profile costs more than missing an
   * install, and two stacked DOM backdrops would fight. Deferring here leaves
   * the hint unstamped, so it gets its turn on a later launch.
   */
  private maybeShowInstallHint(runsCompleted: number): void {
    if (this.backupOverlayTeardown || this.installHintTeardown) return;

    const platform = detectInstallPlatform(navigator.userAgent, navigator.maxTouchPoints);
    if (platform === 'unsupported') return;
    if (!shouldShowInstallHint({
      runsCompleted,
      isStandalone: isRunningStandalone(),
      alreadyShownAt: loadInstallHintShownAt(),
    })) return;

    if (platform === 'ios') {
      this.showInstallHint('ios');
      return;
    }

    // Chrome fires beforeinstallprompt on its own schedule, routinely after
    // this scene is already up — checking once here would make the hint
    // silently never appear on Android/desktop.
    this.installPromptUnsubscribe = subscribeInstallPromptAvailable(() => {
      if (this.backupOverlayTeardown || this.installHintTeardown) return;
      this.showInstallHint('prompt');
    });
  }

  private showInstallHint(platform: 'prompt' | 'ios'): void {
    // Stamped on show, not on dismiss: create() re-runs on every orientation
    // flip and every return to the menu.
    saveInstallHintShownAt(Date.now());
    this.menuNavigator?.setEnabled(false);
    this.installHintTeardown = showInstallHintOverlay({
      platform,
      onClose: () => {
        this.installHintTeardown = null;
        this.menuNavigator?.setEnabled(true);
      },
    });
  }

  // ═══════════════════════════════════════════════════════════════════════
  //  TITLE BLOCK — sharp display type over an accent rule. Flat, no sway.
  // ═══════════════════════════════════════════════════════════════════════

  private createTitleBlock(centerX: number, centerY: number, fontScale: number): void {
    const fontSize = scaledInt(fontScale, 58);

    const container = this.add.container(centerX, centerY);

    // Soft glow ghosts behind the letterforms — two stacked layers make a
    // smooth neon halo (wide faint pass + tight brighter pass).
    const glowWide = this.add.text(0, 0, 'PEW PEW SURVIVOR', {
      fontSize: `${fontSize}px`,
      color: COLORS.accentGoldStr,
      fontFamily: DISPLAY_FONT,
      fontStyle: 'bold',
      letterSpacing: 6,
    }).setOrigin(0.5).setAlpha(0.1).setScale(1.045);
    container.add(glowWide);
    const glow = this.add.text(0, 0, 'PEW PEW SURVIVOR', {
      fontSize: `${fontSize}px`,
      color: COLORS.accentGoldStr,
      fontFamily: DISPLAY_FONT,
      fontStyle: 'bold',
      letterSpacing: 6,
    }).setOrigin(0.5).setAlpha(0.22).setScale(1.015);
    container.add(glow);

    const text = this.add.text(0, 0, 'PEW PEW SURVIVOR', {
      fontSize: `${fontSize}px`,
      color: COLORS.headingGold,
      fontFamily: DISPLAY_FONT,
      fontStyle: 'bold',
      stroke: COLORS.outline,
      strokeThickness: 2,
      letterSpacing: 6,
    }).setOrigin(0.5);
    container.add(text);

    // Thin accent rule under the wordmark — clean underline, sells the
    // sharp tech look.
    const rule = this.add.graphics();
    const ruleHalf = text.width * 0.52;
    const ruleY = text.height * 0.56;
    rule.fillStyle(COLORS.accentGold, 0.9);
    rule.fillRect(-ruleHalf, ruleY, ruleHalf * 2, 2);
    rule.fillStyle(COLORS.accentGold, 0.35);
    rule.fillRect(-ruleHalf, ruleY + 3, ruleHalf * 2, 1);
    container.add(rule);

    // Reduced motion: no entrance fade, no shimmer — glow and rule hold the
    // breathe midpoint so the title still reads as lit.
    if (getSettingsManager().isReducedMotionEnabled()) {
      glow.setAlpha(0.21);
      glowWide.setAlpha(0.1);
      rule.setAlpha(0.86);
      return;
    }

    container.setAlpha(0);
    this.tweens.add({
      targets: container,
      alpha: 1,
      duration: 420,
      ease: 'Sine.Out',
    });

    // Slow glow breathe — brightness only, geometry stays locked. The rule
    // shimmers slightly out of phase with the halo so the block feels lit,
    // not blinking.
    const seed = Math.random() * 10;
    this.titleTicker = (timeSeconds: number) => {
      const breathe = (Math.sin(timeSeconds * 1.4 + seed) + 1) * 0.5;
      glow.setAlpha(0.16 + breathe * 0.1);
      glowWide.setAlpha(0.07 + breathe * 0.06);
      rule.setAlpha(0.72 + (Math.sin(timeSeconds * 1.4 + seed + 1.3) + 1) * 0.14);
    };
  }

  // ═══════════════════════════════════════════════════════════════════════
  //  META STACK — small overlapping mini-cards in the top-left corner.
  // ═══════════════════════════════════════════════════════════════════════

  private createMetaStack(opts: {
    worldLevel: number;
    ascensionLevel: number;
    currentStreak: number;
    streakBonus: number;
    layoutScale: number;
    fontScale: number;
  }): void {
    const { worldLevel, ascensionLevel, currentStreak, streakBonus, layoutScale, fontScale } = opts;
    const stackOriginX = scaledInt(layoutScale, 30);
    const stackOriginY = scaledInt(layoutScale, 32);
    const cardWidth = scaledInt(layoutScale, 110);
    const cardHeight = scaledInt(layoutScale, 56);

    interface ChipData {
      label: string;
      sub?: string;
      accentHex: number;
      bodyHex: number;
    }
    const chips: ChipData[] = [];
    chips.push({
      label: `WORLD ${worldLevel}`,
      accentHex: COLORS.accentPrimary,
      bodyHex: COLORS.bodyPrimary,
    });
    if (ascensionLevel > 0) {
      chips.push({
        label: `ASC ${ascensionLevel}`,
        accentHex: COLORS.accentGold,
        bodyHex: COLORS.bodyGold,
      });
    }
    if (currentStreak > 0) {
      chips.push({
        label: `STREAK ${currentStreak}`,
        sub: `+${streakBonus}%`,
        accentHex: COLORS.accentMagenta,
        bodyHex: COLORS.bodyMagenta,
      });
    }

    // Spread chips horizontally — back cards must show enough of themselves
    // (label + accent strip) to be readable, not just a thin sliver.
    const stepX = scaledInt(layoutScale, 78);
    const stepY = scaledInt(layoutScale, 8);

    const createdCards: MenuCard[] = [];
    chips.forEach((chip, index) => {
      const card = createMenuCard(this, {
        x: stackOriginX + cardWidth / 2 + index * stepX,
        y: stackOriginY + cardHeight / 2 + index * stepY,
        width: cardWidth,
        height: cardHeight,
        pulseSeed: index * 1.7,
        bodyFillColor: chip.bodyHex,
        accentColor: chip.accentHex,
        bannerHeight: scaledInt(layoutScale, 7),
        shadowOffsetY: scaledInt(layoutScale, 5),
        shadowOffsetX: 0,
        interactive: index === chips.length - 1, // front card is the click target
      });
      this.cards.push(card);
      createdCards.push(card);

      // Plain bold label centered in the body region (below banner).
      const labelY = chip.sub ? -scaledInt(layoutScale, 2) : scaledInt(layoutScale, 4);
      const label = this.add.text(0, labelY, chip.label, {
        fontSize: scaledFontPx(fontScale, 14),
        color: COLORS.textBody,
        fontFamily: MENU_FONT,
        fontStyle: 'bold',
        letterSpacing: 1.5,
      }).setOrigin(0.5);
      card.frame.add(label);

      if (chip.sub) {
        const sub = this.add.text(0, labelY + scaledInt(layoutScale, 14), chip.sub, {
          fontSize: scaledFontPx(fontScale, 11),
          color: COLORS.accentGoldStr,
          fontFamily: MENU_FONT,
          fontStyle: 'bold',
          letterSpacing: 0.5,
        }).setOrigin(0.5);
        card.frame.add(sub);
      }
    });

    // Front card opens the progression explainer tooltip.
    const front = createdCards[createdCards.length - 1];
    if (front) {
      front.hitZone.on('pointerover', () => front.setHoverState(true));
      front.hitZone.on('pointerout', () => front.setHoverState(false));
      front.hitZone.on('pointerdown', () => {
        this.soundManager.playUIClick();
        if (this.metaTooltip) {
          this.hideMetaTooltip();
        } else {
          this.showMetaTooltip(worldLevel, ascensionLevel, currentStreak, streakBonus, layoutScale, fontScale);
        }
      });
    }
  }

  // ═══════════════════════════════════════════════════════════════════════
  //  HERO CARD — the big CONTINUE / START card with run summary.
  // ═══════════════════════════════════════════════════════════════════════

  private createHeroCard(opts: {
    centerX: number;
    centerY: number;
    width: number;
    height: number;
    fontScale: number;
    layoutScale: number;
    hasSave: boolean;
    saveInfo: { worldLevel?: number; level?: number; gameTime?: number };
    upcomingBossName: string;
    onActivate: () => void;
  }): void {
    const { centerX, centerY, width, height, fontScale, layoutScale, hasSave, saveInfo, upcomingBossName, onActivate } = opts;

    const bannerHeight = scaledInt(layoutScale, 36);

    const card = createMenuCard(this, {
      x: centerX,
      y: centerY,
      width,
      height,
      pulseSeed: 12,
      bodyFillColor: COLORS.bodyPrimary,
      accentColor: COLORS.accentPrimary,
      bannerHeight,
      shadowOffsetY: scaledInt(layoutScale, 16),
      shadowOffsetX: scaledInt(layoutScale, 7),
    });
    this.cards.push(card);

    // Banner label — "MAIN MENU" or run identifier on the strip.
    const bannerCenterY = -height / 2 + bannerHeight / 2;
    const bannerLabel = makeDisplayText(
      this,
      0,
      bannerCenterY,
      hasSave ? 'YOUR RUN' : 'NEW JOURNEY',
      {
        fontSize: scaledInt(fontScale, 16),
        color: COLORS.headingWhite,
        strokeWidth: 2,
        letterSpacing: 4,
      },
    );
    card.frame.add(bannerLabel);

    // Big primary label — CONTINUE / START in gold display text.
    const primaryLabel = hasSave ? 'CONTINUE' : 'START';
    const primaryY = -height / 2 + bannerHeight + scaledInt(layoutScale, 30);
    const primaryText = makeDisplayText(this, 0, primaryY, primaryLabel, {
      fontSize: scaledInt(fontScale, 36),
      color: COLORS.headingGold,
      strokeWidth: 4,
      letterSpacing: 4,
    });
    card.frame.add(primaryText);

    // Bottom row: ship icon (left) + run summary chip (right).
    const rowY = height / 2 - scaledInt(layoutScale, 26);
    const iconSize = scaledInt(layoutScale, 38);
    const iconX = -width / 2 + scaledInt(layoutScale, 38);

    // Glow halo behind ship icon.
    const glow = this.add.graphics();
    glow.fillStyle(COLORS.accentPrimary, 0.16);
    glow.fillCircle(iconX, rowY, iconSize * 0.85);
    glow.fillStyle(COLORS.accentPrimary, 0.3);
    glow.fillCircle(iconX, rowY, iconSize * 0.55);
    card.frame.add(glow);

    const shipIcon = createIcon(this, {
      x: iconX,
      y: rowY,
      iconKey: 'rocket',
      size: iconSize,
      tint: 0xffffff,
    });
    card.frame.add(shipIcon);

    // Run summary "chip" — a small accent-tinted pill on the right side.
    if (hasSave) {
      const summary = `W${saveInfo.worldLevel ?? 1}  ·  Lv ${saveInfo.level ?? 1}  ·  ${
        saveInfo.gameTime ? this.formatTime(saveInfo.gameTime) : '0:00'
      }`;
      const probe = this.add.text(0, 0, summary, {
        fontSize: scaledFontPx(fontScale, 14),
        fontFamily: MENU_FONT,
        fontStyle: 'bold',
        letterSpacing: 1,
      });
      const chipPadX = scaledInt(layoutScale, 14);
      const chipPadY = scaledInt(layoutScale, 7);
      const chipWidth = probe.width + chipPadX * 2;
      const chipHeight = probe.height + chipPadY * 2;
      probe.destroy();
      const chipX = width / 2 - chipWidth / 2 - scaledInt(layoutScale, 16);
      const chipBg = this.add.graphics();
      chipBg.fillStyle(0x000000, 0.45);
      chipBg.fillRoundedRect(
        chipX - chipWidth / 2,
        rowY - chipHeight / 2,
        chipWidth,
        chipHeight,
        8,
      );
      chipBg.lineStyle(2, COLORS.accentPrimary, 0.85);
      chipBg.strokeRoundedRect(
        chipX - chipWidth / 2,
        rowY - chipHeight / 2,
        chipWidth,
        chipHeight,
        8,
      );
      card.frame.add(chipBg);
      const chipText = this.add.text(chipX, rowY, summary, {
        fontSize: scaledFontPx(fontScale, 14),
        color: COLORS.textBody,
        fontFamily: MENU_FONT,
        fontStyle: 'bold',
        letterSpacing: 1,
      }).setOrigin(0.5);
      card.frame.add(chipText);
    } else {
      const tag = this.add.text(width / 2 - scaledInt(layoutScale, 16), rowY, 'press to launch', {
        fontSize: scaledFontPx(fontScale, 14),
        color: COLORS.textMuted,
        fontFamily: MENU_FONT,
        fontStyle: 'italic',
      }).setOrigin(1, 0.5);
      card.frame.add(tag);
    }

    // The upcoming-boss line and the armed boost charge line (flux cache,
    // FEAT-CARDS-3) share the gap between the big CONTINUE/START label and the
    // bottom icon row. One line centers in the gap (the layout before the boss
    // line existed); two stack around that center and still clear both
    // neighbours.
    const armedBoost = getBoostCardManager().getPending();
    const bandCenterY = Math.round((primaryY + rowY) / 2);
    const lineStep = scaledInt(layoutScale, 15);
    const stacked = upcomingBossName.length > 0 && Boolean(armedBoost);

    if (upcomingBossName) {
      const bossLine = this.add.text(
        0,
        stacked ? bandCenterY - lineStep / 2 : bandCenterY,
        `NEXT BOSS: ${upcomingBossName.toUpperCase()}`,
        {
          fontSize: scaledFontPx(fontScale, 12),
          color: COLORS.accentDangerStr,
          fontFamily: MENU_FONT,
          fontStyle: 'bold',
          letterSpacing: 1,
        },
      ).setOrigin(0.5);
      card.frame.add(bossLine);
    }

    if (armedBoost) {
      const boostLine = this.add.text(
        0,
        stacked ? bandCenterY + lineStep / 2 : bandCenterY,
        `⚡ NEXT RUN: ${armedBoost.description.toUpperCase()}`,
        {
          fontSize: scaledFontPx(fontScale, 12),
          color: COLORS.headingGold,
          fontFamily: MENU_FONT,
          fontStyle: 'bold',
          letterSpacing: 1,
        },
      ).setOrigin(0.5);
      card.frame.add(boostLine);
    }

    this.registerFocusable(card, onActivate);
  }

  // ═══════════════════════════════════════════════════════════════════════
  //  NEW RUN LINK — small italic ribbon below the hero card.
  // ═══════════════════════════════════════════════════════════════════════

  private createNewRunLink(opts: {
    centerX: number;
    centerY: number;
    layoutScale: number;
    fontScale: number;
    onActivate: () => void;
  }): void {
    const { centerX, centerY, layoutScale, fontScale, onActivate } = opts;
    const width = scaledInt(layoutScale, 138);
    const height = scaledInt(layoutScale, 26);
    const card = createMenuCard(this, {
      x: centerX,
      y: centerY,
      width,
      height,
      pulseSeed: 22,
      bodyFillColor: COLORS.bodyNeutral,
      accentColor: COLORS.accentFocus,
      bannerHeight: 0,
      borderColor: COLORS.accentFocus,
      borderWidth: 2,
      cornerRadius: scaledInt(layoutScale, 8),
      shadowOffsetY: scaledInt(layoutScale, 6),
      shadowOffsetX: scaledInt(layoutScale, 3),
    });
    this.cards.push(card);

    const text = this.add.text(0, 0, '✦  NEW RUN  ✦', {
      fontSize: scaledFontPx(fontScale, 12),
      color: COLORS.accentFocusStr,
      fontFamily: MENU_FONT,
      fontStyle: 'bold',
      letterSpacing: 3,
    }).setOrigin(0.5);
    card.frame.add(text);

    this.registerFocusable(card, onActivate);
  }

  // ═══════════════════════════════════════════════════════════════════════
  //  CHALLENGE ROW — one card, DAILY and WEEKLY as two independent halves.
  // ═══════════════════════════════════════════════════════════════════════

  private createChallengeRow(opts: {
    centerX: number;
    centerY: number;
    width: number;
    height: number;
    layoutScale: number;
    fontScale: number;
    halves: ChallengeHalf[];
  }): void {
    const { centerX, centerY, width, height, layoutScale, fontScale, halves } = opts;
    const bannerHeight = scaledInt(layoutScale, 30);

    // Built non-interactive so each half owns its own hit area: Phaser's
    // topOnly input would otherwise let the card-wide zone and the half zones
    // swallow each other.
    const card = createMenuCard(this, {
      x: centerX,
      y: centerY,
      width,
      height,
      pulseSeed: 5,
      bodyFillColor: COLORS.bodyPrimary,
      accentColor: COLORS.accentPrimary,
      bannerHeight,
      shadowOffsetY: scaledInt(layoutScale, 6),
      shadowOffsetX: 0,
      interactive: false,
    });
    this.cards.push(card);

    const halfWidth = width / 2;
    const divider = this.add.graphics();
    divider.lineStyle(2, COLORS.accentNeutral, 0.45);
    divider.lineBetween(
      0,
      -height / 2 + bannerHeight,
      0,
      height / 2 - scaledInt(layoutScale, 8),
    );
    card.frame.add(divider);

    halves.forEach((half, index) => {
      this.addChallengeHalf({
        card,
        half,
        halfCenterX: (index === 0 ? -1 : 1) * (halfWidth / 2),
        halfWidth,
        height,
        bannerHeight,
        layoutScale,
        fontScale,
      });
    });
  }

  private addChallengeHalf(opts: {
    card: MenuCard;
    half: ChallengeHalf;
    halfCenterX: number;
    halfWidth: number;
    height: number;
    bannerHeight: number;
    layoutScale: number;
    fontScale: number;
  }): void {
    const {
      card, half, halfCenterX, halfWidth, height, bannerHeight, layoutScale, fontScale,
    } = opts;
    const { challenge, best, accentHex, accentTextStr } = half;

    const inset = scaledInt(layoutScale, 5);
    const panelX = halfCenterX - halfWidth / 2 + inset;
    const panelY = -height / 2 + bannerHeight + inset;
    const panelWidth = halfWidth - inset * 2;
    const panelHeight = height / 2 - inset - panelY;

    const tint = this.add.graphics();
    tint.fillStyle(half.bodyHex, 0.55);
    tint.fillRoundedRect(panelX, panelY, panelWidth, panelHeight, 5);
    card.frame.add(tint);

    const focusRing = this.add.graphics();
    focusRing.lineStyle(2, accentHex, 1);
    focusRing.strokeRoundedRect(panelX, panelY, panelWidth, panelHeight, 5);
    focusRing.setAlpha(0);
    card.frame.add(focusRing);

    // Banner label (DAILY / WEEKLY) centered over its own half.
    const bannerCenterY = -height / 2 + bannerHeight / 2;
    const bannerLabel = makeDisplayText(
      this,
      halfCenterX,
      bannerCenterY,
      `${half.label} CHALLENGE`,
      {
        fontSize: scaledInt(fontScale, 14),
        color: COLORS.headingWhite,
        strokeWidth: 2,
        letterSpacing: 3,
      },
    );
    card.frame.add(bannerLabel);

    // Body lines: ship + weapon + mod summary.
    const ship = SHIP_CHARACTERS.find((s) => s.id === challenge.shipId)?.name ?? 'Default';
    const weapon = getWeaponInfoList().find((w) => w.id === challenge.startingWeaponId)?.name ?? 'Random';
    const modCount = challenge.modifierIds.filter((id) => Boolean(getModifierById(id))).length;
    const modSummary = modCount > 0 ? `${modCount} MOD${modCount === 1 ? '' : 'S'}` : 'NO MODS';

    const bodyLeftX = halfCenterX - halfWidth / 2 + scaledInt(layoutScale, 20);
    const bodyTopY = -height / 2 + bannerHeight + scaledInt(layoutScale, 14);
    const shipText = this.add.text(
      bodyLeftX,
      bodyTopY,
      ship.toUpperCase(),
      {
        fontSize: scaledFontPx(fontScale, 14),
        color: COLORS.textBody,
        fontFamily: MENU_FONT,
        fontStyle: 'bold',
        letterSpacing: 2,
      },
    ).setOrigin(0, 0);
    card.frame.add(shipText);

    const weaponText = this.add.text(
      bodyLeftX,
      bodyTopY + scaledInt(layoutScale, 18),
      `${weapon.toUpperCase()}  ·  ${modSummary}`,
      {
        fontSize: scaledFontPx(fontScale, 11),
        color: COLORS.textMuted,
        fontFamily: MENU_FONT,
        letterSpacing: 1,
      },
    ).setOrigin(0, 0);
    card.frame.add(weaponText);

    const challengeBossName =
      getEnemyType(bossIdAtRotation(challengeBossRotationIndex(challenge.dateString)))?.name ?? '';
    if (challengeBossName) {
      const bossText = this.add.text(
        bodyLeftX,
        bodyTopY + scaledInt(layoutScale, 34),
        `BOSS: ${challengeBossName.toUpperCase()}`,
        {
          fontSize: scaledFontPx(fontScale, 11),
          color: COLORS.accentDangerStr,
          fontFamily: MENU_FONT,
          letterSpacing: 1,
        },
      ).setOrigin(0, 0);
      card.frame.add(bossText);
    }

    // Best-score chip (bottom-right of the half). Lives in a tinted pill so it
    // reads as a discrete badge rather than dim placeholder text.
    const badgeY = height / 2 - scaledInt(layoutScale, 18);
    const badgeText = best
      ? `★ ${best.score.toLocaleString()} · ${best.killCount}k · ${this.formatTime(best.survivalSeconds)}${best.wasVictory ? '  W' : ''}`
      : 'NEW';
    const badgeFontSize = scaledInt(fontScale, 11);
    const probe = this.add.text(0, 0, badgeText, {
      fontSize: `${badgeFontSize}px`,
      fontFamily: MENU_FONT,
      fontStyle: 'bold',
      letterSpacing: 1,
    });
    const padX = scaledInt(layoutScale, 10);
    const padY = scaledInt(layoutScale, 5);
    const badgeWidth = probe.width + padX * 2;
    const badgeHeight = probe.height + padY * 2;
    probe.destroy();

    const badgeX = halfCenterX + halfWidth / 2 - badgeWidth / 2 - scaledInt(layoutScale, 18);
    const badgeBg = this.add.graphics();
    badgeBg.fillStyle(best ? accentHex : 0x000000, best ? 0.25 : 0.4);
    badgeBg.fillRoundedRect(
      badgeX - badgeWidth / 2,
      badgeY - badgeHeight / 2,
      badgeWidth,
      badgeHeight,
      6,
    );
    badgeBg.lineStyle(2, accentHex, best ? 0.9 : 0.5);
    badgeBg.strokeRoundedRect(
      badgeX - badgeWidth / 2,
      badgeY - badgeHeight / 2,
      badgeWidth,
      badgeHeight,
      6,
    );
    card.frame.add(badgeBg);

    const badge = this.add.text(badgeX, badgeY, badgeText, {
      fontSize: `${badgeFontSize}px`,
      color: best ? accentTextStr : COLORS.textDim,
      fontFamily: MENU_FONT,
      fontStyle: 'bold',
      letterSpacing: 1,
    }).setOrigin(0.5);
    card.frame.add(badge);

    const zone = this.add.zone(halfCenterX, 0, halfWidth, height)
      .setOrigin(0.5)
      .setInteractive({ useHandCursor: true });
    card.frame.add(zone);

    const localIndex = this.focusEntries.length;
    let hovered = false;
    let focused = false;
    const syncHighlight = () => focusRing.setAlpha(hovered || focused ? 1 : 0);

    zone.on('pointerover', () => {
      hovered = true;
      syncHighlight();
      card.setHoverState(true);
      if (this.selectedFocusIndex !== localIndex && !this.isOverlayOpen()) {
        this.requestFocus(localIndex);
      }
    });
    zone.on('pointerout', () => {
      hovered = false;
      syncHighlight();
      card.setHoverState(false);
      card.hitZone.emit('pointerout');
    });
    // The card is non-interactive, so its press-pose listeners never fire from
    // its own hit zone — the focused half drives them instead.
    zone.on('pointerdown', () => {
      if (this.isOverlayOpen()) return;
      card.hitZone.emit('pointerdown');
      this.soundManager.playUIClick();
      half.onActivate();
    });
    zone.on('pointerup', () => card.hitZone.emit('pointerup'));

    this.focusEntries.push({
      onFocus: () => {
        focused = true;
        syncHighlight();
        card.setFocusState(true);
      },
      onBlur: () => {
        focused = false;
        syncHighlight();
        card.setFocusState(false);
      },
      onActivate: half.onActivate,
    });
  }

  // ═══════════════════════════════════════════════════════════════════════
  //  PROGRESSION DECK — one row of three wide cards: SHOP, GAME MODES and
  //  COLLECTION. Everything else in the menu lives behind the latter two.
  // ═══════════════════════════════════════════════════════════════════════

  private createProgressionDeck(opts: {
    centerX: number;
    centerY: number;
    cardWidth: number;
    cardHeight: number;
    gap: number;
    layoutScale: number;
    fontScale: number;
    goldAmount: number;
    questBadge: string;
    onShop: () => void;
    onAchievements: () => void;
    onCodex: () => void;
    onCards: () => void;
    onLeaderboard: () => void;
    onPaint: () => void;
    onExpeditionSeasons: () => void;
    onObjectives: () => void;
    objectiveCount: number;
    onWorldSurvey: () => void;
    onSkirmish: () => void;
    onGauntlet: () => void;
    onRunner: () => void;
    onPractice: () => void;
    onSurprise: () => void;
    showLoadouts: boolean;
    onLoadouts: () => void;
  }): void {
    const {
      centerX, centerY, cardHeight, layoutScale, fontScale, goldAmount, questBadge,
      onShop, onAchievements, onCodex, onCards, onLeaderboard, onPaint, onExpeditionSeasons,
      onObjectives, objectiveCount, onWorldSurvey,
      onSkirmish, onGauntlet, onRunner, onPractice, onSurprise, showLoadouts, onLoadouts,
    } = opts;

    const submenuAction = (run: () => void) => () => {
      this.soundManager.playUIClick();
      this.closeSubmenu();
      run();
    };

    interface DeckEntry {
      label: string;
      iconKey: string;
      bodyHex: number;
      accentHex: number;
      action: () => void;
      badge?: string;
      iconTint: number;
    }
    const gameModeEntries: SubmenuEntry[] = [
      {
        label: 'SKIRMISH', iconKey: 'shield', accentRole: 'danger',
        iconTint: 0xbbffcc, action: submenuAction(onSkirmish),
      },
      {
        label: 'GAUNTLET', iconKey: 'sword', accentRole: 'danger',
        iconTint: 0xffbbcc, action: submenuAction(onGauntlet),
      },
      {
        label: 'RUNNER', iconKey: 'run', accentRole: 'danger',
        iconTint: 0xffbbaa, action: submenuAction(onRunner),
      },
      {
        label: 'PRACTICE', iconKey: 'target', accentRole: 'danger',
        iconTint: 0xffddaa, action: submenuAction(onPractice),
      },
      {
        label: 'SURPRISE', iconKey: 'dice', accentRole: 'gold',
        iconTint: 0xffe2a0, action: submenuAction(onSurprise),
      },
      {
        label: 'CHART', iconKey: 'globe', accentRole: 'primary',
        badge: `W${getCurrentExpeditionSeasonIndex()}`,
        iconTint: 0xaaccff, action: submenuAction(onExpeditionSeasons),
      },
      {
        label: 'SURVEY', iconKey: 'telescope', accentRole: 'primary',
        iconTint: 0xaaccff, action: submenuAction(onWorldSurvey),
      },
      {
        label: 'OBJECTIVES', iconKey: 'clipboard', accentRole: 'teal',
        badge: objectiveCount > 0 ? String(objectiveCount) : undefined,
        iconTint: 0xaaffee, action: submenuAction(onObjectives),
      },
    ];
    if (showLoadouts) {
      gameModeEntries.push({
        label: 'LOADOUTS', iconKey: 'star', accentRole: 'neutral',
        iconTint: 0x88ccff, action: submenuAction(onLoadouts),
      });
    }

    const collectionEntries: SubmenuEntry[] = [
      {
        label: 'ACHIEVEMENTS', iconKey: 'trophy', accentRole: 'teal',
        badge: questBadge, iconTint: 0xaaffee, action: submenuAction(onAchievements),
      },
      {
        label: 'CODEX', iconKey: 'book', accentRole: 'magenta',
        iconTint: 0xeebbff, action: submenuAction(onCodex),
      },
      {
        label: 'CARDS', iconKey: 'gem', accentRole: 'safe',
        iconTint: 0xaaffcc, action: submenuAction(onCards),
      },
      {
        label: 'LEADERBOARDS', iconKey: 'crown', accentRole: 'primary',
        iconTint: 0xbbddff, action: submenuAction(onLeaderboard),
      },
      {
        label: 'PAINT', iconKey: 'aura', accentRole: 'magenta',
        iconTint: 0xffbbff, action: submenuAction(onPaint),
      },
    ];

    // Keyed by the title the overlay itself shows, so a restart can reopen exactly what was open.
    const openGameModes = () => this.openSubmenu('GAME MODES', gameModeEntries);
    const openCollection = () => this.openSubmenu('COLLECTION', collectionEntries);
    this.submenuOpeners = new Map([
      ['GAME MODES', openGameModes],
      ['COLLECTION', openCollection],
    ]);

    const entries: DeckEntry[] = [
      {
        label: 'SHOP',
        iconKey: 'coins',
        bodyHex: COLORS.bodyGold,
        accentHex: COLORS.accentGold,
        action: onShop,
        badge: `${goldAmount}`,
        iconTint: 0xffe2a0,
      },
      {
        // GAME MODES group (FEAT-MENU-COLLAPSE) — every non-expedition way to
        // play, plus the world chart and the saved loadouts, one tap deeper.
        // The hero card still launches an expedition in one tap.
        label: 'GAME MODES',
        iconKey: 'katana',
        bodyHex: COLORS.bodyDanger,
        accentHex: COLORS.accentDanger,
        iconTint: 0xffbbcc,
        action: openGameModes,
      },
      {
        // COLLECTION group (FEAT-MENU-SUBMENU-KIT) — achievements, codex, cards,
        // leaderboards and paint sit one tap deeper so the deck row stays wide
        // enough to hit on a phone.
        label: 'COLLECTION',
        iconKey: 'trophy',
        bodyHex: COLORS.bodyTeal,
        accentHex: COLORS.accentTeal,
        badge: questBadge,
        iconTint: 0xaaffee,
        action: openCollection,
      },
    ];

    // Fit-to-row: three cards at the design width (3×96 + 2×22 = 332 units)
    // leave two thirds of the 696-unit portrait row empty, so the card widens
    // to fill it — capped, and never the gap. A longer row still shrinks
    // width+gap proportionally rather than overflowing.
    const DECK_CARD_MAX_WIDTH = 200;
    const usableRowWidth = this.scale.width - scaledInt(layoutScale, 24);
    const naturalRowWidth = entries.length * opts.cardWidth + (entries.length - 1) * opts.gap;
    const rowShrink = naturalRowWidth > usableRowWidth ? usableRowWidth / naturalRowWidth : 1;
    const gap = Math.floor(opts.gap * rowShrink);
    const shrunkCardWidth = Math.floor(opts.cardWidth * rowShrink);
    const availableWidthPerCard = Math.floor(
      (usableRowWidth - gap * (entries.length - 1)) / entries.length,
    );
    const cardWidth = Math.max(
      shrunkCardWidth,
      Math.min(scaledInt(layoutScale, DECK_CARD_MAX_WIDTH), availableWidthPerCard),
    );

    const totalWidth = entries.length * cardWidth + (entries.length - 1) * gap;
    const startX = centerX - totalWidth / 2 + cardWidth / 2;
    const bannerHeight = scaledInt(layoutScale, 18);

    entries.forEach((entry, index) => {
      const cardX = startX + index * (cardWidth + gap);
      const card = createMenuCard(this, {
        x: cardX,
        y: centerY,
        width: cardWidth,
        height: cardHeight,
        pulseSeed: index * 0.93,
        bodyFillColor: entry.bodyHex,
        accentColor: entry.accentHex,
        bannerHeight,
        shadowOffsetY: scaledInt(layoutScale, 5),
        shadowOffsetX: 0,
      });
      this.cards.push(card);

      // Display label rides the banner (bold, white).
      const bannerCenterY = -cardHeight / 2 + bannerHeight / 2;
      const bannerLabel = makeDisplayText(this, 0, bannerCenterY, entry.label, {
        fontSize: scaledInt(fontScale, 11),
        color: COLORS.headingWhite,
        strokeWidth: 2,
        letterSpacing: 2,
      });
      card.frame.add(bannerLabel);

      // Icon — large, centered in the body region.
      const bodyCenterY = -cardHeight / 2 + bannerHeight + (cardHeight - bannerHeight) / 2;
      const iconSize = scaledInt(layoutScale, 42);
      const iconOffset = entry.badge ? -scaledInt(layoutScale, 6) : 0;
      const icon = createIcon(this, {
        x: 0,
        y: bodyCenterY + iconOffset,
        iconKey: entry.iconKey,
        size: iconSize,
        tint: entry.iconTint,
      });
      card.frame.add(icon);

      // Bottom strip badge — gold count for SHOP, lives BELOW the icon so it
      // doesn't clip into it. Painted as a tinted pill for emphasis.
      if (entry.badge) {
        const badgeY = cardHeight / 2 - scaledInt(layoutScale, 14);
        const badgeBg = this.add.graphics();
        // Capped so a 4-digit gold count does not sit inside a 184-unit pill on
        // the widened card; below a 104-unit card the cap never binds.
        const badgeWidth = Math.min(
          cardWidth - scaledInt(layoutScale, 16),
          scaledInt(layoutScale, 88),
        );
        const badgeHeight = scaledInt(layoutScale, 18);
        badgeBg.fillStyle(0x000000, 0.45);
        badgeBg.fillRoundedRect(-badgeWidth / 2, badgeY - badgeHeight / 2, badgeWidth, badgeHeight, 6);
        badgeBg.lineStyle(1.5, entry.accentHex, 0.7);
        badgeBg.strokeRoundedRect(-badgeWidth / 2, badgeY - badgeHeight / 2, badgeWidth, badgeHeight, 6);
        card.frame.add(badgeBg);

        const badgeText = this.add.text(0, badgeY, entry.badge, {
          fontSize: scaledFontPx(fontScale, 11),
          color: COLORS.accentGoldStr,
          fontFamily: MENU_FONT,
          fontStyle: 'bold',
          letterSpacing: 1,
        }).setOrigin(0.5);
        card.frame.add(badgeText);
      }

      this.registerFocusable(card, entry.action);
    });
  }

  // ═══════════════════════════════════════════════════════════════════════
  //  FOOTER STRIP — settings · credits · mute, low visual weight.
  // ═══════════════════════════════════════════════════════════════════════

  private createFooterStrip(opts: {
    centerX: number;
    bottomY: number;
    layoutScale: number;
    fontScale: number;
    onSettings: () => void;
    onCredits: () => void;
  }): void {
    const { centerX, bottomY, layoutScale, fontScale, onSettings, onCredits } = opts;
    const fontSize = scaledInt(fontScale, 12);

    const items: Array<{ label: string; action: () => void }> = [
      { label: 'SETTINGS', action: onSettings },
      { label: 'CREDITS', action: onCredits },
    ];

    const style = {
      fontSize: `${fontSize}px`,
      fontFamily: MENU_FONT,
      fontStyle: 'bold' as const,
      letterSpacing: 2,
    };
    const probes = items.map((item) => this.add.text(0, 0, item.label, style));
    const widths = probes.map((p) => p.width);
    probes.forEach((p) => p.destroy());

    const sepWidth = scaledInt(layoutScale, 18);
    const muteSize = scaledInt(fontScale, 18);
    const muteSpace = muteSize + scaledInt(layoutScale, 18);

    const padX = scaledInt(layoutScale, 22);
    const padY = scaledInt(layoutScale, 8);
    const innerWidth = widths.reduce((a, b) => a + b, 0) + sepWidth * items.length + muteSpace;
    const pillWidth = innerWidth + padX * 2;
    const pillHeight = fontSize + padY * 2;
    const rowY = bottomY - pillHeight / 2;

    // Pill background — low-key dim pill so the footer feels like a single
    // unit instead of three floating items.
    const pill = this.add.graphics();
    pill.fillStyle(0x000000, 0.45);
    pill.fillRoundedRect(centerX - pillWidth / 2, rowY - pillHeight / 2, pillWidth, pillHeight, pillHeight / 2);
    pill.lineStyle(1, 0x4a5a78, 0.55);
    pill.strokeRoundedRect(centerX - pillWidth / 2, rowY - pillHeight / 2, pillWidth, pillHeight, pillHeight / 2);

    let cursorX = centerX - innerWidth / 2;

    items.forEach((item, index) => {
      const text = this.add.text(cursorX, rowY, item.label, {
        ...style,
        color: COLORS.textMuted,
      }).setOrigin(0, 0.5).setInteractive({ useHandCursor: true });

      const localIndex = this.focusEntries.length;
      this.attachFocusableInteraction(text, localIndex, item.action);
      addButtonInteraction(this, text);

      this.focusEntries.push({
        onFocus: () => {
          text.setColor(COLORS.accentFocusStr);
          text.setShadow(0, 0, COLORS.accentFocusStr, 6, false, true);
        },
        onBlur: () => {
          text.setColor(COLORS.textMuted);
          text.setShadow(0, 0, 'transparent', 0);
        },
        onActivate: item.action,
      });

      cursorX += widths[index];
      this.add.text(cursorX + sepWidth / 2, rowY, '·', {
        ...style,
        color: COLORS.textDim,
      }).setOrigin(0.5);
      cursorX += sepWidth;
    });

    cursorX += scaledInt(layoutScale, 6);
    this.createMuteToggle(cursorX + muteSize / 2, rowY, muteSize);
  }

  private createMuteToggle(x: number, y: number, size: number): void {
    const musicManager = getMusicManager();
    const icon = createIcon(this, {
      x,
      y,
      iconKey: musicManager.getPlaybackMode() === 'off' ? 'mute' : 'music',
      size: Math.round(size * 1.4),
    });

    const hit = this.add.zone(x, y, 44, 44).setInteractive({ useHandCursor: true });

    const syncIcon = () => {
      const isMuted = musicManager.getPlaybackMode() === 'off';
      setIconFrame(icon, isMuted ? 'mute' : 'music');
      icon.setTint(isMuted ? 0x8899aa : 0xaabbcc);
    };
    syncIcon();

    hit.on('pointerover', () => icon.setTint(0xffdd44));
    hit.on('pointerout', () => syncIcon());
    hit.on('pointerdown', async () => {
      this.soundManager.playUIClick();
      const isMuted = musicManager.getPlaybackMode() === 'off';
      if (isMuted) {
        musicManager.setPlaybackMode('sequential');
        if (!musicManager.getIsPlaying()) {
          try { await musicManager.play(); } catch { /* AudioContext may still be locked */ }
        }
      } else {
        musicManager.setPlaybackMode('off');
        musicManager.stop();
      }
      syncIcon();
    });
    addButtonInteraction(this, icon);
  }

  // ═══════════════════════════════════════════════════════════════════════
  //  Focus / nav / interaction plumbing
  // ═══════════════════════════════════════════════════════════════════════

  /**
   * Wire a MenuCard into the hover/focus/click pipeline. Hovering or focusing
   * the card triggers the lift animation; clicking activates. Adding to
   * focusEntries lets MenuNavigator step through cards with arrows/gamepad.
   */
  private registerFocusable(card: MenuCard, onActivate: () => void): void {
    const localIndex = this.focusEntries.length;

    card.hitZone.on('pointerover', () => {
      card.setHoverState(true);
      if (this.selectedFocusIndex !== localIndex && !this.isOverlayOpen()) {
        this.requestFocus(localIndex);
      }
    });
    card.hitZone.on('pointerout', () => {
      card.setHoverState(false);
    });
    card.hitZone.on('pointerdown', () => {
      if (this.isOverlayOpen()) return;
      this.soundManager.playUIClick();
      onActivate();
    });

    this.focusEntries.push({
      onFocus: () => card.setFocusState(true),
      onBlur: () => card.setFocusState(false),
      onActivate,
    });
  }

  private buildMainNavigator(initialIndex: number): void {
    this.menuNavigator = new MenuNavigator({
      scene: this,
      initialIndex,
      items: this.focusEntries.map((entry, index) => ({
        onFocus: () => this.focusIndex(index),
        onBlur: () => this.blurIndex(index),
        onActivate: () => {
          if (this.confirmationOverlay || this.metaTooltip) return;
          entry.onActivate();
        },
      })),
      onCancel: () => {
        if (this.confirmationOverlay) {
          this.hideNewGameConfirmation();
        } else if (this.metaTooltip) {
          this.hideMetaTooltip();
        }
      },
    });
  }

  private pauseMainNavigator(): void {
    this.menuNavigator?.destroy();
    this.menuNavigator = null;
  }

  private resumeMainNavigator(): void {
    if (!this.menuNavigator && this.focusEntries.length > 0) {
      this.buildMainNavigator(this.selectedFocusIndex);
    }
  }

  private openSubmenu(title: string, entries: SubmenuEntry[]): void {
    if (this.submenu) return;
    this.pauseMainNavigator();
    this.openSubmenuTitle = title;
    this.submenu = createSubmenuOverlay({
      scene: this,
      title,
      entries,
      onClose: () => this.closeSubmenu(),
    });
  }

  private closeSubmenu(): void {
    if (!this.submenu) return;
    this.submenu.destroy();
    this.submenu = null;
    this.openSubmenuTitle = null;
    this.resumeMainNavigator();
  }

  /** The open submenu's title, or null. main.ts's orientation watcher reads it before firing the
   *  restart, so the rebuilt menu can reopen the same one. */
  getOpenSubmenuTitle(): string | null {
    return this.openSubmenuTitle;
  }

  private isOverlayOpen(): boolean {
    return this.confirmationOverlay !== null || this.metaTooltip !== null
      || this.submenu !== null;
  }

  private attachFocusableInteraction(
    target: Phaser.GameObjects.GameObject,
    localIndex: number,
    onActivate: () => void,
  ): void {
    target.on('pointerover', () => {
      if (this.selectedFocusIndex !== localIndex && !this.isOverlayOpen()) {
        this.requestFocus(localIndex);
      }
    });
    target.on('pointerdown', () => {
      if (this.isOverlayOpen()) return;
      this.soundManager.playUIClick();
      onActivate();
    });
  }

  private requestFocus(index: number): void {
    if (this.confirmationOverlay || this.metaTooltip) return;
    if (this.menuNavigator) {
      this.menuNavigator.selectIndex(index);
    } else {
      this.focusIndex(index);
    }
  }

  private focusIndex(index: number): void {
    if (this.confirmationOverlay || this.metaTooltip) return;
    if (index < 0 || index >= this.focusEntries.length) return;
    if (this.selectedFocusIndex !== index) {
      this.soundManager.playUIClick();
    }
    this.selectedFocusIndex = index;
    this.focusEntries[this.selectedFocusIndex]?.onFocus();
  }

  private blurIndex(index: number): void {
    this.focusEntries[index]?.onBlur();
  }

  // ═══════════════════════════════════════════════════════════════════════
  //  META TOOLTIP — explainer panel reached by clicking the meta stack.
  // ═══════════════════════════════════════════════════════════════════════

  private showMetaTooltip(
    worldLevel: number,
    ascensionLevel: number,
    currentStreak: number,
    streakBonus: number,
    layoutScale: number,
    fontScale: number,
  ): void {
    const centerX = this.cameras.main.centerX;
    const centerY = this.cameras.main.centerY;
    const width = scaledInt(layoutScale, 440);
    const padding = scaledInt(layoutScale, 20);

    const container = this.add.container(0, 0);
    container.setDepth(200);

    const dim = this.add.rectangle(centerX, centerY, this.scale.width, this.scale.height, 0x000000, 0.55);
    dim.setInteractive();
    dim.on('pointerdown', () => this.hideMetaTooltip());
    container.add(dim);

    const title = this.add.text(centerX, centerY - scaledInt(layoutScale, 70), 'PROGRESSION', {
      fontSize: scaledFontPx(fontScale, 22),
      color: COLORS.accentFocusStr,
      fontFamily: MENU_FONT,
      fontStyle: 'bold',
      letterSpacing: 3,
    }).setOrigin(0.5);
    container.add(title);

    const lines: string[] = [
      `World ${worldLevel}   +${((worldLevel - 1) * 15).toFixed(0)}% enemy HP, +${((worldLevel - 1) * 10).toFixed(0)}% damage`,
    ];
    if (ascensionLevel > 0) {
      lines.push(
        `Ascension ${ascensionLevel}   +${ascensionLevel * 10}% stats, +${ascensionLevel * 15}% gold`,
      );
    }
    if (currentStreak > 0) {
      lines.push(`Streak ${currentStreak}   +${streakBonus}% gold (cap 10 wins)`);
    }
    lines.push('');
    lines.push('Click anywhere or press ESC to close.');

    const body = this.add.text(centerX, centerY - scaledInt(layoutScale, 20), lines.join('\n'), {
      fontSize: scaledFontPx(fontScale, 14),
      color: '#ddeeff',
      fontFamily: MENU_FONT,
      align: 'center',
      lineSpacing: 6,
      wordWrap: { width: width - padding * 2 },
    }).setOrigin(0.5, 0);
    container.add(body);

    const height = body.height + scaledInt(layoutScale, 120);
    const frame = this.add.graphics();
    frame.fillStyle(0x06080f, 0.95);
    frame.fillRoundedRect(centerX - width / 2, centerY - height / 2, width, height, 8);
    frame.lineStyle(1, 0x4488cc, 0.9);
    frame.strokeRoundedRect(centerX - width / 2, centerY - height / 2, width, height, 8);
    container.addAt(frame, 1);

    this.metaTooltip = container;
    this.pauseMainNavigator();

    this.tooltipEscHandler = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        this.hideMetaTooltip();
      }
    };
    this.input.keyboard?.on('keydown', this.tooltipEscHandler);
  }

  private hideMetaTooltip(): void {
    if (this.tooltipEscHandler) {
      this.input.keyboard?.off('keydown', this.tooltipEscHandler);
      this.tooltipEscHandler = null;
    }
    if (!this.metaTooltip) return;
    this.metaTooltip.destroy();
    this.metaTooltip = null;
    this.resumeMainNavigator();
  }

  // ═══════════════════════════════════════════════════════════════════════
  //  NEW-GAME CONFIRMATION
  // ═══════════════════════════════════════════════════════════════════════

  private showNewGameConfirmation(
    onConfirm: (choiceIndex: number) => void,
    copy: ConfirmationCopy = DEFAULT_CONFIRMATION_COPY,
  ): void {
    const centerX = this.cameras.main.centerX;
    const centerY = this.cameras.main.centerY;
    const layoutScale = computeMenuLayoutScale(this.scale.width, this.scale.height);
    const fontScale = computeMenuFontScale(
      this.scale.width,
      this.scale.height,
      getSettingsManager().getUiScale(),
    );

    this.pauseMainNavigator();

    this.confirmationOverlay = this.add.container(0, 0);
    this.confirmationOverlay.setDepth(100);

    const dim = this.add.rectangle(centerX, centerY, this.scale.width, this.scale.height, 0x000000, 0.6);
    dim.setInteractive();
    this.confirmationOverlay.add(dim);

    const bodyLineCount = copy.body.split('\n').length;
    const width = scaledInt(
      layoutScale, copy.choiceLabels ? 660 : (bodyLineCount > 1 ? 560 : 420),
    );
    const height = scaledInt(layoutScale, 200 + (bodyLineCount - 1) * 18);
    const halfHeight = height / 2;
    const frame = this.add.graphics();
    frame.fillStyle(0x0a0a14, 0.98);
    frame.fillRoundedRect(centerX - width / 2, centerY - height / 2, width, height, 10);
    frame.lineStyle(2, 0xff5566, 0.8);
    frame.strokeRoundedRect(centerX - width / 2, centerY - height / 2, width, height, 10);
    this.confirmationOverlay.add(frame);

    const title = this.add.text(
      centerX, centerY - halfHeight + scaledInt(layoutScale, 45), copy.title, {
        fontSize: scaledFontPx(fontScale, 22),
        color: '#ffffff',
        fontFamily: MENU_FONT,
        fontStyle: 'bold',
        letterSpacing: 3,
      },
    ).setOrigin(0.5);
    this.confirmationOverlay.add(title);

    const body = this.add.text(
      centerX, centerY - halfHeight + scaledInt(layoutScale, 78), copy.body, {
        fontSize: scaledFontPx(fontScale, 14),
        color: '#aabbcc',
        fontFamily: MENU_FONT,
        align: 'center',
      },
    ).setOrigin(0.5, 0);
    body.setLineSpacing(2);
    this.confirmationOverlay.add(body);

    const makeButton = (label: string, color: string, offsetX: number, action: () => void) => {
      const button = this.add.text(
        centerX + offsetX, centerY + halfHeight - scaledInt(layoutScale, 60), label, {
          fontSize: scaledFontPx(fontScale, 20),
          color,
          fontFamily: MENU_FONT,
          fontStyle: 'bold',
          letterSpacing: 3,
        },
      ).setOrigin(0.5).setInteractive({ useHandCursor: true });
      button.setData('defaultColor', color);
      button.on('pointerdown', () => {
        this.soundManager.playUIClick();
        action();
      });
      addButtonInteraction(this, button);
      this.confirmationOverlay!.add(button);
      return button;
    };

    const choiceLabels = copy.choiceLabels ?? [copy.confirmLabel];
    const buttonCount = choiceLabels.length + 1;
    // 70 reproduces the shipped two-button offsets exactly; 65 is what four buttons fit in.
    const halfStep = scaledInt(layoutScale, buttonCount <= 2 ? 70 : 65);
    const offsetFor = (index: number) => (index - (buttonCount - 1) / 2) * halfStep * 2;

    const choiceButtons = choiceLabels.map((label, index) => makeButton(
      label, COLORS.danger, offsetFor(index), () => {
        this.hideNewGameConfirmation();
        onConfirm(index);
      },
    ));
    const cancelButton = makeButton(
      copy.cancelLabel, COLORS.safe, offsetFor(choiceLabels.length), () => {
        this.hideNewGameConfirmation();
      },
    );

    // Five buttons is what the fixed step fits. The CHART row can now be six (three worlds,
    // RETURN, CODE, BACK), so past that the row packs from the buttons' own measured widths
    // rather than from a constant, which is what keeps a label off its neighbour and inside the
    // frame without growing the card.
    if (buttonCount >= 6) {
      const rowButtons = [...choiceButtons, cancelButton];
      const gap = scaledInt(layoutScale, 16);
      const rowWidth = rowButtons.reduce((total, button) => total + button.width, 0)
        + gap * (buttonCount - 1);
      let cursor = centerX - rowWidth / 2;
      for (const button of rowButtons) {
        button.setX(cursor + button.width / 2);
        cursor += button.width + gap;
      }
    }

    const hint = this.add.text(centerX, centerY + halfHeight - scaledInt(layoutScale, 20), 'ESC cancels  ·  ← → to choose  ·  Enter to confirm', {
      fontSize: scaledFontPx(fontScale, 11),
      color: '#8899aa',
      fontFamily: MENU_FONT,
    }).setOrigin(0.5);
    this.confirmationOverlay.add(hint);

    const highlightButton = (button: Phaser.GameObjects.Text, highlighted: boolean) => {
      const baseColor = button.getData('defaultColor') as string;
      if (highlighted) {
        button.setColor(COLORS.accentFocusStr);
        button.setShadow(0, 0, '#ffdd44', 6, false, true);
      } else {
        button.setColor(baseColor);
        button.setShadow(0, 0, 'transparent', 0);
      }
    };

    this.confirmationNavigator = new MenuNavigator({
      scene: this,
      columns: buttonCount,
      initialIndex: choiceLabels.length,
      items: [
        ...choiceButtons.map((button, index) => ({
          onFocus: () => highlightButton(button, true),
          onBlur: () => highlightButton(button, false),
          onActivate: () => {
            this.soundManager.playUIClick();
            this.hideNewGameConfirmation();
            onConfirm(index);
          },
        })),
        {
          onFocus: () => highlightButton(cancelButton, true),
          onBlur: () => highlightButton(cancelButton, false),
          onActivate: () => {
            this.soundManager.playUIClick();
            this.hideNewGameConfirmation();
          },
        },
      ],
      onCancel: () => this.hideNewGameConfirmation(),
    });
  }

  private hideNewGameConfirmation(): void {
    if (!this.confirmationOverlay) return;
    this.confirmationNavigator?.destroy();
    this.confirmationNavigator = null;
    this.confirmationOverlay.destroy();
    this.confirmationOverlay = null;
    this.resumeMainNavigator();
  }

  // ═══════════════════════════════════════════════════════════════════════
  //  Utility
  // ═══════════════════════════════════════════════════════════════════════

  private formatTime(seconds: number): string {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  }

  shutdown(): void {
    if (this.updateHandler) {
      this.events.off(Phaser.Scenes.Events.UPDATE, this.updateHandler);
      this.updateHandler = null;
    }
    this.titleTicker = null;

    this.menuNavigator?.destroy();
    this.menuNavigator = null;
    this.confirmationNavigator?.destroy();
    this.confirmationNavigator = null;
    this.confirmationOverlay?.destroy();
    this.confirmationOverlay = null;
    if (this.tooltipEscHandler) {
      this.input.keyboard?.off('keydown', this.tooltipEscHandler);
      this.tooltipEscHandler = null;
    }
    this.metaTooltip?.destroy();
    this.metaTooltip = null;
    this.submenu?.destroy();
    this.submenu = null;
    this.openSubmenuTitle = null;

    for (const card of this.cards) card.destroy();
    this.cards = [];

    this.menuBackground?.destroy();
    this.menuBackground = null;

    this.backupOverlayTeardown?.();
    this.backupOverlayTeardown = null;

    this.installHintTeardown?.();
    this.installHintTeardown = null;
    this.codeEntryTeardown?.();
    this.codeEntryTeardown = null;
    this.installPromptUnsubscribe?.();
    this.installPromptUnsubscribe = null;

    this.tweens.killAll();
  }
}
