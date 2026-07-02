import Phaser from 'phaser';
import { getMusicManager } from '../../audio/MusicManager';
import { SoundKeys, SoundManager } from '../../audio/SoundManager';
import { getMetaProgressionManager } from '../../meta/MetaProgressionManager';
import { getAscensionManager } from '../../meta/AscensionManager';
import { preloadIcons, createIcon, setIconFrame } from '../../utils/IconRenderer';
import { getGameStateManager } from '../../save/GameStateManager';
import { fadeOut, fadeIn, addButtonInteraction } from '../../utils/SceneTransition';
import { computeMenuLayoutScale, computeMenuFontScale, scaledFontPx, scaledInt } from '../../utils/HudScale';
import { getSettingsManager } from '../../settings';
import { MenuNavigator } from '../../input/MenuNavigator';
import {
  generateDailyChallenge,
  generateWeeklyChallenge,
  getDailyBest,
  DailyChallengeConfig,
  DailyLeaderboardEntry,
} from '../../meta/DailyChallengeManager';
import { getModifierById } from '../../data/RunModifiers';
import { getWeaponInfoList } from '../../weapons';
import { SHIP_CHARACTERS } from '../../data/ShipCharacters';
import { createMenuCard, MenuCard } from '../../visual/MenuCard';
import { createMenuBackground, MenuBackground } from '../../visual/MenuBackground';
import { MENU_COLORS as COLORS, MENU_FONT, DISPLAY_FONT } from '../../visual/MenuStyle';
import { makeDisplayText } from '../../visual/DisplayText';

interface FocusEntry {
  onFocus: () => void;
  onBlur: () => void;
  onActivate: () => void;
}

export class BootScene extends Phaser.Scene {
  private soundManager!: SoundManager;
  private menuNavigator: MenuNavigator | null = null;
  private confirmationOverlay: Phaser.GameObjects.Container | null = null;
  private confirmationNavigator: MenuNavigator | null = null;
  private metaTooltip: Phaser.GameObjects.Container | null = null;
  private tooltipEscHandler: ((event: KeyboardEvent) => void) | null = null;
  private selectedFocusIndex: number = 0;
  private focusEntries: FocusEntry[] = [];

  private menuBackground: MenuBackground | null = null;
  private cards: MenuCard[] = [];
  private titleTicker: ((timeSeconds: number) => void) | null = null;
  private updateHandler: ((time: number, delta: number) => void) | null = null;

  constructor() {
    super({ key: 'BootScene' });
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
    this.tooltipEscHandler = null;
    this.titleTicker = null;
    this.updateHandler = null;

    fadeIn(this, 220);

    const musicManager = getMusicManager();
    const startMenuMusic = async () => {
      if (musicManager.getPlaybackMode() !== 'off' && !musicManager.getIsPlaying()) {
        await musicManager.play();
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
    const openLeaderboard = () => fadeOut(this, 150, () => this.scene.start('LeaderboardScene'));
    const openSettings = () =>
      fadeOut(this, 150, () => this.scene.start('SettingsScene', { returnTo: 'BootScene' }));
    const openCredits = () => fadeOut(this, 150, () => this.scene.start('CreditsScene'));

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

    // ─── scaling ────────────────────────────────────────────────────────
    const layoutScale = computeMenuLayoutScale(this.scale.width, this.scale.height);
    const fontScale = computeMenuFontScale(
      this.scale.width,
      this.scale.height,
      getSettingsManager().getUiScale(),
    );
    const centerX = this.cameras.main.centerX;

    // ─── menu backdrop ──────────────────────────────────────────────────
    this.menuBackground = createMenuBackground(this);

    // ─── title block ────────────────────────────────────────────────────
    const titleY = scaledInt(layoutScale, 100);
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
    const heroCenterY = scaledInt(layoutScale, 280);
    this.createHeroCard({
      centerX,
      centerY: heroCenterY,
      width: heroWidth,
      height: heroHeight,
      fontScale,
      layoutScale,
      hasSave,
      saveInfo,
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

    // ─── challenge cards (daily + weekly side by side) ──────────────────
    const challengeWidth = scaledInt(layoutScale, 280);
    const challengeHeight = scaledInt(layoutScale, 130);
    const challengeGap = scaledInt(layoutScale, 36);
    const challengeRowY = belowHeroY + challengeHeight / 2 + scaledInt(layoutScale, 6);

    this.createChallengeCard({
      centerX: centerX - (challengeWidth + challengeGap) / 2,
      centerY: challengeRowY,
      width: challengeWidth,
      height: challengeHeight,
      label: 'DAILY',
      bodyHex: COLORS.bodyGold,
      accentHex: COLORS.accentGold,
      accentTextStr: COLORS.accentGoldStr,
      challenge: dailyChallenge,
      best: bestDaily,
      layoutScale,
      fontScale,
      onActivate: startDailyRun,
    });

    this.createChallengeCard({
      centerX: centerX + (challengeWidth + challengeGap) / 2,
      centerY: challengeRowY,
      width: challengeWidth,
      height: challengeHeight,
      label: 'WEEKLY',
      bodyHex: COLORS.bodyMagenta,
      accentHex: COLORS.accentMagenta,
      accentTextStr: COLORS.accentMagentaStr,
      challenge: weeklyChallenge,
      best: bestWeekly,
      layoutScale,
      fontScale,
      onActivate: startWeeklyRun,
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

    this.createProgressionDeck({
      centerX,
      centerY: deckY,
      cardWidth: deckCardWidth,
      cardHeight: deckCardHeight,
      gap: deckGap,
      layoutScale,
      fontScale,
      goldAmount,
      onShop: openShop,
      onAchievements: openAchievements,
      onCodex: openCodex,
      onLeaderboard: openLeaderboard,
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

    this.events.once('shutdown', this.shutdown, this);
  }

  // ═══════════════════════════════════════════════════════════════════════
  //  TITLE BLOCK — sharp display type over an accent rule. Flat, no sway.
  // ═══════════════════════════════════════════════════════════════════════

  private createTitleBlock(centerX: number, centerY: number, fontScale: number): void {
    const fontSize = scaledInt(fontScale, 58);

    const container = this.add.container(centerX, centerY);

    // Soft glow ghost behind the letterforms — subtle neon halo, not a
    // cartoon drop shadow.
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

    container.setAlpha(0);
    this.tweens.add({
      targets: container,
      alpha: 1,
      duration: 420,
      ease: 'Sine.Out',
    });

    // Slow glow breathe — brightness only, geometry stays locked.
    const seed = Math.random() * 10;
    this.titleTicker = (timeSeconds: number) => {
      glow.setAlpha(0.16 + (Math.sin(timeSeconds * 1.4 + seed) + 1) * 0.05);
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
    onActivate: () => void;
  }): void {
    const { centerX, centerY, width, height, fontScale, layoutScale, hasSave, saveInfo, onActivate } = opts;

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
  //  CHALLENGE CARD — Daily / Weekly side-by-side cards.
  // ═══════════════════════════════════════════════════════════════════════

  private createChallengeCard(opts: {
    centerX: number;
    centerY: number;
    width: number;
    height: number;
    label: string;
    bodyHex: number;
    accentHex: number;
    accentTextStr: string;
    challenge: DailyChallengeConfig;
    best?: DailyLeaderboardEntry;
    layoutScale: number;
    fontScale: number;
    onActivate: () => void;
  }): void {
    const {
      centerX, centerY, width, height, label, bodyHex, accentHex, accentTextStr,
      challenge, best, layoutScale, fontScale, onActivate,
    } = opts;

    const bannerHeight = scaledInt(layoutScale, 30);

    const card = createMenuCard(this, {
      x: centerX,
      y: centerY,
      width,
      height,
      pulseSeed: label.length,
      bodyFillColor: bodyHex,
      accentColor: accentHex,
      bannerHeight,
      shadowOffsetY: scaledInt(layoutScale, 6),
      shadowOffsetX: 0,
    });
    this.cards.push(card);

    // Banner label (DAILY / WEEKLY) centered in the colored strip.
    const bannerCenterY = -height / 2 + bannerHeight / 2;
    const bannerLabel = makeDisplayText(this, 0, bannerCenterY, `${label} CHALLENGE`, {
      fontSize: scaledInt(fontScale, 14),
      color: COLORS.headingWhite,
      strokeWidth: 2,
      letterSpacing: 3,
    });
    card.frame.add(bannerLabel);

    // Body lines: ship + weapon + mod summary.
    const ship = SHIP_CHARACTERS.find((s) => s.id === challenge.shipId)?.name ?? 'Default';
    const weapon = getWeaponInfoList().find((w) => w.id === challenge.startingWeaponId)?.name ?? 'Random';
    const modCount = challenge.modifierIds.filter((id) => Boolean(getModifierById(id))).length;
    const modSummary = modCount > 0 ? `${modCount} MOD${modCount === 1 ? '' : 'S'}` : 'NO MODS';

    const bodyTopY = -height / 2 + bannerHeight + scaledInt(layoutScale, 14);
    const shipText = this.add.text(
      -width / 2 + scaledInt(layoutScale, 14),
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
      -width / 2 + scaledInt(layoutScale, 14),
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

    // Best-score chip (bottom-right). Lives in a tinted pill so it reads as a
    // discrete badge rather than dim placeholder text.
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

    const badgeX = width / 2 - badgeWidth / 2 - scaledInt(layoutScale, 12);
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

    this.registerFocusable(card, onActivate);
  }

  // ═══════════════════════════════════════════════════════════════════════
  //  PROGRESSION DECK — 4 small square cards in a row.
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
    onShop: () => void;
    onAchievements: () => void;
    onCodex: () => void;
    onLeaderboard: () => void;
  }): void {
    const {
      centerX, centerY, cardWidth, cardHeight, gap, layoutScale, fontScale, goldAmount,
      onShop, onAchievements, onCodex, onLeaderboard,
    } = opts;

    interface DeckEntry {
      label: string;
      iconKey: string;
      bodyHex: number;
      accentHex: number;
      action: () => void;
      badge?: string;
      iconTint: number;
    }
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
        label: 'ACHIEVE',
        iconKey: 'trophy',
        bodyHex: COLORS.bodyTeal,
        accentHex: COLORS.accentTeal,
        action: onAchievements,
        iconTint: 0xaaffee,
      },
      {
        label: 'CODEX',
        iconKey: 'book',
        bodyHex: COLORS.bodyMagenta,
        accentHex: COLORS.accentMagenta,
        action: onCodex,
        iconTint: 0xeebbff,
      },
      {
        label: 'LEADERS',
        iconKey: 'crown',
        bodyHex: COLORS.bodyPrimary,
        accentHex: COLORS.accentPrimary,
        action: onLeaderboard,
        iconTint: 0xbbddff,
      },
    ];

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
        const badgeWidth = cardWidth - scaledInt(layoutScale, 16);
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

  private isOverlayOpen(): boolean {
    return this.confirmationOverlay !== null || this.metaTooltip !== null;
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

  private showNewGameConfirmation(onConfirm: () => void): void {
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

    const width = scaledInt(layoutScale, 420);
    const height = scaledInt(layoutScale, 200);
    const frame = this.add.graphics();
    frame.fillStyle(0x0a0a14, 0.98);
    frame.fillRoundedRect(centerX - width / 2, centerY - height / 2, width, height, 10);
    frame.lineStyle(2, 0xff5566, 0.8);
    frame.strokeRoundedRect(centerX - width / 2, centerY - height / 2, width, height, 10);
    this.confirmationOverlay.add(frame);

    const title = this.add.text(centerX, centerY - scaledInt(layoutScale, 55), 'START NEW RUN?', {
      fontSize: scaledFontPx(fontScale, 22),
      color: '#ffffff',
      fontFamily: MENU_FONT,
      fontStyle: 'bold',
      letterSpacing: 3,
    }).setOrigin(0.5);
    this.confirmationOverlay.add(title);

    const body = this.add.text(centerX, centerY - scaledInt(layoutScale, 15), 'Your current run will be lost.', {
      fontSize: scaledFontPx(fontScale, 14),
      color: '#aabbcc',
      fontFamily: MENU_FONT,
    }).setOrigin(0.5);
    this.confirmationOverlay.add(body);

    const makeButton = (label: string, color: string, offsetX: number, action: () => void) => {
      const button = this.add.text(centerX + offsetX, centerY + scaledInt(layoutScale, 40), label, {
        fontSize: scaledFontPx(fontScale, 20),
        color,
        fontFamily: MENU_FONT,
        fontStyle: 'bold',
        letterSpacing: 3,
      }).setOrigin(0.5).setInteractive({ useHandCursor: true });
      button.setData('defaultColor', color);
      button.on('pointerdown', () => {
        this.soundManager.playUIClick();
        action();
      });
      addButtonInteraction(this, button);
      this.confirmationOverlay!.add(button);
      return button;
    };

    const yesButton = makeButton('YES', COLORS.danger, -scaledInt(layoutScale, 70), () => {
      this.hideNewGameConfirmation();
      onConfirm();
    });
    const noButton = makeButton('NO', COLORS.safe, scaledInt(layoutScale, 70), () => {
      this.hideNewGameConfirmation();
    });

    const hint = this.add.text(centerX, centerY + scaledInt(layoutScale, 80), 'ESC cancels  ·  ← → to choose  ·  Enter to confirm', {
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
      columns: 2,
      initialIndex: 1,
      items: [
        {
          onFocus: () => highlightButton(yesButton, true),
          onBlur: () => highlightButton(yesButton, false),
          onActivate: () => {
            this.soundManager.playUIClick();
            this.hideNewGameConfirmation();
            onConfirm();
          },
        },
        {
          onFocus: () => highlightButton(noButton, true),
          onBlur: () => highlightButton(noButton, false),
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

    for (const card of this.cards) card.destroy();
    this.cards = [];

    this.menuBackground?.destroy();
    this.menuBackground = null;

    this.tweens.killAll();
  }
}
