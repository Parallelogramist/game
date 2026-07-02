/**
 * LeaderboardScene — personal bests + challenge history.
 */

import Phaser from 'phaser';
import { transitionToScene, sweepIn, staggerEntrance, type EntranceItem } from '../../utils/SceneTransition';
import { MenuNavigator } from '../../input/MenuNavigator';
import {
  getRecentLeaderboardEntries,
  DailyLeaderboardEntry,
} from '../../meta/DailyChallengeManager';
import { getAchievementManager } from '../../achievements/AchievementManager';
import { getMetaProgressionManager } from '../../meta/MetaProgressionManager';
import { createMenuCard, MenuCard } from '../../visual/MenuCard';
import { createMenuBackground, MenuBackground } from '../../visual/MenuBackground';
import { createMenuButton, MenuButton } from '../../visual/MenuButton';
import { createMenuTabs, MenuTabs } from '../../visual/MenuTab';
import { makeDisplayText, makeBodyText } from '../../visual/DisplayText';
import {
  ACCENT_COLORS_STR,
  BODY_COLORS,
  TEXT_COLORS,
} from '../../visual/MenuStyle';

const ENTRIES_TO_SHOW = 30;

type FilterMode = 'all' | 'daily' | 'weekly' | 'victory';

function filterEntries(entries: DailyLeaderboardEntry[], mode: FilterMode): DailyLeaderboardEntry[] {
  switch (mode) {
    case 'daily':
      return entries.filter((entry) => entry.challengeType === 'daily');
    case 'weekly':
      return entries.filter((entry) => entry.challengeType === 'weekly');
    case 'victory':
      return entries.filter((entry) => entry.wasVictory);
    case 'all':
    default:
      return entries;
  }
}

export class LeaderboardScene extends Phaser.Scene {
  private menuNavigator: MenuNavigator | null = null;
  private currentFilter: FilterMode = 'all';
  private entryListChildren: Phaser.GameObjects.GameObject[] = [];
  private entryCards: MenuCard[] = [];
  private allEntries: DailyLeaderboardEntry[] = [];
  private menuBackground: MenuBackground | null = null;
  private bgUpdateHandler: ((time: number, delta: number) => void) | null = null;
  private bestsCards: MenuCard[] = [];
  private menuTabs: MenuTabs | null = null;
  private backButton!: MenuButton;

  constructor() {
    super({ key: 'LeaderboardScene' });
  }

  create(): void {
    const centerX = this.cameras.main.centerX;
    const screenHeight = this.cameras.main.height;

    this.menuBackground = createMenuBackground(this);
    this.bgUpdateHandler = (time, delta) => {
      this.menuBackground?.update(delta);
      const seconds = time / 1000;
      for (const card of this.bestsCards) card.tickIdle(seconds);
      for (const card of this.entryCards) card.tickIdle(seconds);
      this.menuTabs?.tickIdle(seconds);
      this.backButton?.tickIdle(seconds);
    };
    this.events.on('update', this.bgUpdateHandler);

    const title = makeDisplayText(this, centerX, 32, 'LEADERBOARD', {
      fontSize: 30,
      color: ACCENT_COLORS_STR.gold,
      strokeWidth: 5,
      letterSpacing: 4,
    });

    const subtitle = makeBodyText(this, centerX, 64, 'Personal bests + challenge history', {
      fontSize: 12,
      color: TEXT_COLORS.muted,
    });

    this.renderPersonalBestsStrip(centerX, 110);
    this.renderFilterTabs(centerX, 192);

    this.allEntries = getRecentLeaderboardEntries(ENTRIES_TO_SHOW);
    this.renderCurrentEntries(centerX);

    this.backButton = createMenuButton({
      scene: this,
      x: centerX,
      y: screenHeight - 36,
      width: 200,
      height: 44,
      label: '← BACK',
      variant: 'neutral',
      fontSize: 16,
      onActivate: () => this.returnToMenu(),
    });
    this.backButton.card.hitZone.on('pointerover', () => this.backButton.setHoverState(true));
    this.backButton.card.hitZone.on('pointerout', () => this.backButton.setHoverState(false));

    this.menuNavigator = new MenuNavigator({
      scene: this,
      items: [
        {
          onFocus: () => this.backButton.setFocusState(true),
          onBlur: () => this.backButton.setFocusState(false),
          onActivate: () => this.returnToMenu(),
        },
      ],
      onCancel: () => this.returnToMenu(),
    });

    // Entrance choreography: title, bests tiles, tabs, then the history rows.
    // Rows re-rendered by later filter changes appear without the stagger.
    const entranceItems: EntranceItem[] = [
      title,
      subtitle,
      ...this.bestsCards.map((card) => card.container),
    ];
    if (this.menuTabs) entranceItems.push(this.menuTabs.container);
    entranceItems.push(
      ...(this.entryListChildren as EntranceItem[]),
      ...this.entryCards.map((card) => card.container),
      this.backButton.container,
    );
    staggerEntrance(this, entranceItems, { stepMs: 25 });
    sweepIn(this);

    this.events.once('shutdown', this.shutdown, this);
  }

  /** Six personal-bests tiles using small menu cards. */
  private renderPersonalBestsStrip(centerX: number, topY: number): void {
    const lifetimeStats = getAchievementManager().getLifetimeStats();
    const accountLevel = getMetaProgressionManager().getAccountLevel();

    const tiles: { label: string; value: string; role: 'primary' | 'magenta' | 'gold' | 'safe' | 'teal' }[] = [
      { label: 'LONGEST RUN', value: formatTime(lifetimeStats.longestSurvivalSeconds), role: 'primary' },
      { label: 'MOST KILLS', value: String(lifetimeStats.mostKillsInRun), role: 'magenta' },
      { label: 'HIGHEST LV', value: String(lifetimeStats.highestLevel), role: 'gold' },
      { label: 'BEST COMBO', value: String(lifetimeStats.highestComboInRun), role: 'magenta' },
      { label: 'VICTORIES', value: String(lifetimeStats.totalVictories), role: 'safe' },
      { label: 'ACCOUNT LV', value: String(accountLevel), role: 'teal' },
    ];

    const tileWidth = 160;
    const tileHeight = 70;
    const gap = 12;
    const totalWidth = tiles.length * tileWidth + (tiles.length - 1) * gap;
    const startX = centerX - totalWidth / 2 + tileWidth / 2;

    tiles.forEach((tile, index) => {
      const x = startX + index * (tileWidth + gap);
      const role = tile.role;
      const bodyKey = role === 'safe' ? 'safe' : role === 'primary' ? 'primary' : role === 'gold' ? 'gold' : role === 'magenta' ? 'magenta' : 'teal';
      const card = createMenuCard(this, {
        x,
        y: topY,
        width: tileWidth,
        height: tileHeight,
        pulseSeed: index * 0.7,
        bodyFillColor: BODY_COLORS[bodyKey as keyof typeof BODY_COLORS],
        accentColor: roleAccent(role),
        bannerHeight: 22,
        borderWidth: 2,
        borderColor: roleAccent(role),
        cornerRadius: 6,
      });

      const labelText = makeDisplayText(this, 0, card.bannerTopY + 11, tile.label, {
        fontSize: 11,
        color: TEXT_COLORS.heading,
        letterSpacing: 1,
      });
      card.frame.add(labelText);

      const valueText = makeDisplayText(this, 0, 12, tile.value, {
        fontSize: 22,
        color: roleAccentStr(role),
        letterSpacing: 1,
      });
      card.frame.add(valueText);

      this.bestsCards.push(card);
    });
  }

  private renderFilterTabs(centerX: number, tabY: number): void {
    const tabs: { mode: FilterMode; label: string; accentRole: 'primary' | 'gold' | 'magenta' | 'safe' }[] = [
      { mode: 'all', label: 'ALL', accentRole: 'primary' },
      { mode: 'daily', label: 'DAILY', accentRole: 'gold' },
      { mode: 'weekly', label: 'WEEKLY', accentRole: 'magenta' },
      { mode: 'victory', label: 'VICTORIES', accentRole: 'safe' },
    ];

    this.menuTabs?.destroy();
    this.menuTabs = createMenuTabs({
      scene: this,
      x: centerX,
      y: tabY,
      tabs: tabs.map((t) => ({ id: t.mode, label: t.label, accentRole: t.accentRole })),
      tabWidth: 110,
      tabHeight: 32,
      spacing: 8,
      fontSize: 13,
      initialActiveId: this.currentFilter,
      onChange: (id) => {
        this.currentFilter = id as FilterMode;
        this.renderCurrentEntries(this.cameras.main.centerX);
      },
    });
  }

  private renderCurrentEntries(centerX: number): void {
    for (const child of this.entryListChildren) child.destroy();
    this.entryListChildren = [];
    for (const card of this.entryCards) card.destroy();
    this.entryCards = [];

    const filtered = filterEntries(this.allEntries, this.currentFilter);
    if (filtered.length === 0) {
      const emptyText = makeBodyText(this, centerX, this.cameras.main.centerY + 40,
        this.currentFilter === 'all'
          ? 'No attempts yet — try a daily or weekly run!'
          : 'No runs match this filter.',
        {
          fontSize: 16,
          color: TEXT_COLORS.dim,
        });
      this.entryListChildren.push(emptyText);
      return;
    }

    this.renderEntries(filtered, centerX);
  }

  private renderEntries(entries: DailyLeaderboardEntry[], centerX: number): void {
    const listStartY = 240;
    const rowHeight = 36;
    const maxRows = 12;
    const displayEntries = entries.slice(0, maxRows);
    const rowWidth = 800;
    const leftX = centerX - rowWidth / 2;

    // Header label.
    const headerLabels: { x: number; text: string; width: number }[] = [
      { x: leftX + 80, text: 'DATE', width: 100 },
      { x: leftX + 200, text: 'TYPE', width: 80 },
      { x: leftX + 290, text: 'RESULT', width: 90 },
      { x: leftX + 410, text: 'KILLS', width: 70 },
      { x: leftX + 510, text: 'TIME', width: 70 },
      { x: leftX + 620, text: 'LEVEL', width: 70 },
      { x: leftX + 720, text: 'SCORE', width: 80 },
    ];
    for (const header of headerLabels) {
      const t = makeDisplayText(this, header.x, listStartY, header.text, {
        fontSize: 11,
        color: TEXT_COLORS.muted,
        letterSpacing: 1,
      });
      this.entryListChildren.push(t);
    }

    displayEntries.forEach((entry, index) => {
      const rowY = listStartY + 28 + index * rowHeight;
      const isWeekly = entry.challengeType === 'weekly';
      const role: 'gold' | 'magenta' | 'safe' = entry.wasVictory ? 'safe' : isWeekly ? 'magenta' : 'gold';

      const card = createMenuCard(this, {
        x: centerX,
        y: rowY,
        width: rowWidth,
        height: 30,
        bodyFillColor: BODY_COLORS[role],
        accentColor: roleAccent(role),
        bannerHeight: 0,
        borderWidth: 2,
        borderColor: roleAccent(role),
        cornerRadius: 6,
        shadowOffsetY: 4,
        shadowAlpha: 0.35,
      });
      this.entryCards.push(card);

      const valueColor = entry.wasVictory ? ACCENT_COLORS_STR.safe : TEXT_COLORS.body;

      const cells: { x: number; text: string; color: string; emphasis: boolean }[] = [
        { x: leftX + 80 - centerX, text: entry.dateString, color: valueColor, emphasis: false },
        { x: leftX + 200 - centerX, text: isWeekly ? 'Weekly' : 'Daily', color: isWeekly ? ACCENT_COLORS_STR.magenta : ACCENT_COLORS_STR.gold, emphasis: true },
        { x: leftX + 290 - centerX, text: entry.wasVictory ? 'Victory' : 'Loss', color: valueColor, emphasis: entry.wasVictory },
        { x: leftX + 410 - centerX, text: String(entry.killCount), color: valueColor, emphasis: false },
        { x: leftX + 510 - centerX, text: formatTime(entry.survivalSeconds), color: valueColor, emphasis: false },
        { x: leftX + 620 - centerX, text: `Lv ${entry.levelReached}`, color: valueColor, emphasis: false },
        { x: leftX + 720 - centerX, text: entry.score.toLocaleString(), color: valueColor, emphasis: false },
      ];
      for (const cell of cells) {
        const t = cell.emphasis
          ? makeDisplayText(this, cell.x, 0, cell.text, { fontSize: 12, color: cell.color, letterSpacing: 1 })
          : makeBodyText(this, cell.x, 0, cell.text, { fontSize: 12, color: cell.color, align: 'center' });
        card.frame.add(t);
      }
    });

    if (entries.length > displayEntries.length) {
      const moreText = makeBodyText(this, centerX, listStartY + 28 + displayEntries.length * rowHeight + 8,
        `... ${entries.length - displayEntries.length} more`, {
          fontSize: 11,
          color: TEXT_COLORS.dim,
        });
      this.entryListChildren.push(moreText);
    }
  }

  private returnToMenu(): void {
    transitionToScene(this, 'BootScene');
  }

  shutdown(): void {
    if (this.menuNavigator) {
      this.menuNavigator.destroy();
      this.menuNavigator = null;
    }
    if (this.bgUpdateHandler) {
      this.events.off('update', this.bgUpdateHandler);
      this.bgUpdateHandler = null;
    }
    this.menuBackground?.destroy();
    this.menuBackground = null;
    for (const card of this.bestsCards) card.destroy();
    this.bestsCards = [];
    for (const card of this.entryCards) card.destroy();
    this.entryCards = [];
    this.menuTabs?.destroy();
    this.menuTabs = null;
    this.backButton?.destroy();
    this.tweens.killAll();
  }
}

function formatTime(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

function roleAccent(role: 'primary' | 'gold' | 'magenta' | 'safe' | 'teal'): number {
  switch (role) {
    case 'primary': return 0x66bbff;
    case 'gold': return 0xffcc44;
    case 'magenta': return 0xcc66ff;
    case 'safe': return 0x66dd88;
    case 'teal': return 0x66ddcc;
  }
}

function roleAccentStr(role: 'primary' | 'gold' | 'magenta' | 'safe' | 'teal'): string {
  switch (role) {
    case 'primary': return '#66bbff';
    case 'gold': return '#ffcc44';
    case 'magenta': return '#cc88ff';
    case 'safe': return '#66dd88';
    case 'teal': return '#66ddcc';
  }
}
