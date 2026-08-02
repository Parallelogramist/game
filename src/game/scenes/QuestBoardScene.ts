import Phaser from 'phaser';
import { createIcon } from '../../utils/IconRenderer';
import { SoundManager } from '../../audio/SoundManager';
import { MenuNavigator, NavigableItem } from '../../input/MenuNavigator';
import { createMenuCard, MenuCard } from '../../visual/MenuCard';
import { createMenuButton, MenuButton } from '../../visual/MenuButton';
import { createMenuOverlay, MenuOverlay } from '../../visual/MenuOverlay';
import { makeDisplayText, makeBodyText } from '../../visual/DisplayText';
import { ACCENT_COLORS, ACCENT_COLORS_STR, BODY_COLORS, TEXT_COLORS } from '../../visual/MenuStyle';
import { getDiscoveryManager } from '../../expedition/DiscoveryManager';
import { cargoLabelOf, droneLabelOf } from '../../data/ExpeditionQuests';
import {
  ACTIVE_EXPEDITION_QUEST_LIMIT,
  acceptExpeditionQuest,
  assignExpeditionQuestDrone,
  getExpeditionQuestCargoStatus,
  getQuestBoardEntries,
  setExpeditionQuestAside,
  type QuestBoardEntry,
} from '../../meta/ExpeditionQuestManager';
import type { SectorSupplySnapshot } from '../../world/sectorTags';
import { computeCardGridInBand, fitTextWidth, resolveMenuFontScale, scaledInt } from '../../utils/HudScale';
import { getSettingsManager } from '../../settings';

/** Data passed to QuestBoardScene by GameScene.openQuestBoard(). */
export interface QuestBoardSceneData {
  /** Which world the crate notice is about: a crate dropped in another world is still owed by a
   *  board. */
  worldStamp: string;
  /** What this world can supply to a reachSector step, so the board shows the same clamped
   *  target the ticker does. Null outside an expedition. */
  sectorSupply: SectorSupplySnapshot | null;
  /** Called exactly once; true when at least one accept or set-aside actually landed. */
  onClose: (changed: boolean) => void;
}

const CARD_WIDTH = 236;
const CARD_HEIGHT = 268;
const CARD_SPACING = 20;
const MAX_COLUMNS = 4;
const COMPLETE_CARD_ALPHA = 0.45;
/** Design-space units the title, subtitle and accepted counter occupy above the grid band. */
const HEADER_RESERVE = 168;
/** Design-space units the LEAVE button occupies below it. */
const FOOTER_RESERVE = 80;

/**
 * QuestBoardScene: the walk-in objective board (FEAT-QUEST-BOARD).
 *
 * Launched over a paused GameScene exactly like MarketScene, but nothing is consumed here and
 * nothing is forced: the player toggles chains between accepted and set aside as often as they
 * like and LEAVE is always live. Each toggle writes through the quest store and re-renders from
 * it, PaintScene's shape, so the cards can never drift from what the ticker reads.
 */
export class QuestBoardScene extends Phaser.Scene {
  private onCloseCallback: ((changed: boolean) => void) | null = null;
  private entries: QuestBoardEntry[] = [];
  private cards: MenuCard[] = [];
  private activateHandlers: Array<() => void> = [];
  private contentContainer: Phaser.GameObjects.Container | null = null;
  private statusText: Phaser.GameObjects.Text | null = null;
  private subtitleText: Phaser.GameObjects.Text | null = null;
  private titleText: Phaser.GameObjects.Text | null = null;
  private cargoNotice = '';
  private worldStamp = '';
  private sectorSupply: SectorSupplySnapshot | null = null;
  private navigator: MenuNavigator | null = null;
  private leaveButton: MenuButton | null = null;
  private overlayUpdateHandler: ((time: number, delta: number) => void) | null = null;
  private menuOverlay: MenuOverlay | null = null;
  private soundManager!: SoundManager;
  private changed = false;
  private resolved = false;
  private focusedIndex = 0;
  private menuScale = 1;
  private gridScale = 1;

  constructor() {
    super({ key: 'QuestBoardScene' });
  }

  init(data: QuestBoardSceneData): void {
    this.onCloseCallback = data.onClose ?? null;
    this.worldStamp = data.worldStamp ?? '';
    this.sectorSupply = data.sectorSupply ?? null;
    this.changed = false;
    this.resolved = false;
    this.focusedIndex = 0;
    this.cargoNotice = '';
  }

  create(): void {
    this.menuScale = resolveMenuFontScale(
      this.scale.width, this.scale.height, getSettingsManager().getUiScale(),
    );
    this.cards = [];
    this.activateHandlers = [];
    this.soundManager = new SoundManager(this);
    this.input.setTopOnly(true);

    this.menuOverlay = createMenuOverlay(this, { dim: 0.7, drifterCount: 4 });
    this.overlayUpdateHandler = (time, delta) => {
      this.menuOverlay?.update(delta);
      this.leaveButton?.tickIdle(time / 1000);
    };
    this.events.on('update', this.overlayUpdateHandler);

    this.titleText = makeDisplayText(this, this.scale.width / 2, scaledInt(this.menuScale, 72), 'QUEST BOARD', {
      fontSize: scaledInt(this.menuScale, 44),
      color: ACCENT_COLORS_STR.teal,
      strokeWidth: scaledInt(this.menuScale, 6),
      letterSpacing: 3 * this.menuScale,
    });
    this.titleText.setDepth(1);
    fitTextWidth(this.titleText, this.scale.width - 24);

    this.subtitleText = makeBodyText(this, this.scale.width / 2, scaledInt(this.menuScale, 118),
      'Take on a contract, or set one aside for later', {
        fontSize: scaledInt(this.menuScale, 20),
        color: TEXT_COLORS.muted,
      });
    this.subtitleText.setDepth(1);

    this.statusText = makeBodyText(this, this.scale.width / 2, scaledInt(this.menuScale, 150), '', {
      fontSize: scaledInt(this.menuScale, 18),
      color: ACCENT_COLORS_STR.gold,
    });
    this.statusText.setDepth(1);

    this.leaveButton = createMenuButton({
      scene: this,
      x: this.scale.width / 2,
      y: this.scale.height - scaledInt(this.menuScale, 44),
      width: scaledInt(this.menuScale, 220),
      height: scaledInt(this.menuScale, 48),
      label: 'LEAVE',
      variant: 'neutral',
      onActivate: () => this.leave(),
    });
    this.leaveButton.container.setDepth(2);
    this.leaveButton.card.hitZone.on('pointerup', () => this.leave());

    this.rebuild();

    this.events.once('shutdown', this.shutdown, this);
  }

  /** Re-reads the store and re-renders every card from it. The single render path: an accept and
   *  a set-aside differ only in which manager call ran before it. */
  private rebuild(): void {
    this.navigator?.destroy();
    this.navigator = null;
    this.contentContainer?.destroy();
    this.cards = [];
    this.activateHandlers = [];
    this.contentContainer = this.add.container(0, 0);

    // The board no longer hands the crate over: it stands beside the board and is flown into
    // (FEAT-CARGO-PICKUP-ENTITY), so loading is a place rather than a menu side effect. This
    // read is what names it on the card header; nothing here writes.
    const cargo = getExpeditionQuestCargoStatus(this.worldStamp);
    // The board assigns an escort drone on the same terms it hands over a crate, and for the
    // same reason it is not a second card action: the card's action slot is SET ASIDE's.
    const drones = assignExpeditionQuestDrone();
    if (drones.assigned.length > 0) {
      this.changed = true;
      for (const row of drones.assigned) getDiscoveryManager().noteObjectiveUpdated(row.questId);
    }
    const labelsOf = (rows: readonly { itemId: string }[]): string =>
      rows.map((row) => cargoLabelOf(row.itemId)).join(', ');
    const droneLabelsOf = (rows: readonly { droneId: string }[]): string =>
      rows.map((row) => droneLabelOf(row.droneId)).join(', ');
    const notices: string[] = [];
    if (cargo.pending.length > 0) notices.push(`CARGO WAITING OUTSIDE · ${labelsOf(cargo.pending)}`);
    else if (cargo.aboard.length > 0) notices.push(`CARGO ABOARD · ${labelsOf(cargo.aboard)}`);
    if (drones.assigned.length > 0) {
      notices.push(`DRONE ASSIGNED · ${droneLabelsOf(drones.assigned)}`);
    } else if (drones.active.length > 0) {
      notices.push(`DRONE UNDER WAY · ${droneLabelsOf(drones.active)}`);
    }
    this.cargoNotice = notices.join('   ');
    this.subtitleText?.setText(this.cargoNotice !== ''
      ? this.cargoNotice
      : 'Take on a contract, or set one aside for later');
    if (this.subtitleText) {
      this.subtitleText.setScale(1);
      fitTextWidth(this.subtitleText, this.scale.width - 24);
    }

    this.entries = getQuestBoardEntries(this.sectorSupply);
    const activeCount = this.entries.filter((entry) => entry.status === 'active').length;
    this.statusText?.setText(
      `ACCEPTED ${activeCount} / ${ACTIVE_EXPEDITION_QUEST_LIMIT}`
      + (activeCount >= ACTIVE_EXPEDITION_QUEST_LIMIT ? ' (set one aside to take another)' : ''),
    );
    if (this.statusText) {
      this.statusText.setScale(1);
      fitTextWidth(this.statusText, this.scale.width - 24);
    }

    const layout = this.computeGridLayout(this.entries.length);
    this.gridScale = layout.scale;
    this.entries.forEach((entry, index) => {
      const position = layout.positionAt(index);
      this.renderCard(entry, index, position.x, position.y);
    });

    const items: NavigableItem[] = this.entries.map((_entry, index) => ({
      onFocus: () => {
        this.focusedIndex = index;
        this.cards[index]?.setFocusState(true);
      },
      onBlur: () => this.cards[index]?.setFocusState(false),
      onActivate: () => this.activateHandlers[index]?.(),
    }));
    if (this.leaveButton) {
      const leave = this.leaveButton;
      items.push({
        onFocus: () => leave.setFocusState(true),
        onBlur: () => leave.setFocusState(false),
        onActivate: () => this.leave(),
      });
    }
    this.navigator = new MenuNavigator({
      scene: this,
      items,
      columns: layout.columns,
      wrap: true,
      initialIndex: Math.min(this.focusedIndex, Math.max(0, items.length - 1)),
      onCancel: () => this.leave(),
    });
  }

  /** Re-place the header and footer on the live canvas, then re-render the board into it. */
  handleResize(): void {
    if (this.resolved) return;

    this.menuOverlay?.destroy();
    this.menuOverlay = createMenuOverlay(this, { dim: 0.7, drifterCount: 4 });

    this.menuScale = resolveMenuFontScale(
      this.scale.width, this.scale.height, getSettingsManager().getUiScale(),
    );

    const centerX = this.scale.width / 2;
    if (this.titleText) {
      this.titleText.setX(centerX);
      this.titleText.setScale(1);
      fitTextWidth(this.titleText, this.scale.width - 24);
    }
    this.subtitleText?.setX(centerX);
    this.statusText?.setX(centerX);
    this.leaveButton?.container.setPosition(
      centerX, this.scale.height - scaledInt(this.menuScale, 44),
    );

    this.rebuild();
  }

  private computeGridLayout(count: number) {
    const grid = computeCardGridInBand({
      count,
      cardWidth: CARD_WIDTH,
      cardHeight: CARD_HEIGHT,
      cardSpacing: CARD_SPACING,
      maxColumns: MAX_COLUMNS,
      canvasWidth: this.scale.width,
      canvasHeight: this.scale.height,
      edgeMargin: 48,
      topReserve: HEADER_RESERVE,
      bottomReserve: FOOTER_RESERVE,
      menuScale: this.menuScale,
      anchorOffset: 48,
    });
    return {
      columns: grid.columns,
      scale: grid.scale,
      positionAt: (index: number) => ({
        x: grid.firstColumnX + (index % grid.columns) * grid.columnPitch,
        y: grid.firstRowY + Math.floor(index / grid.columns) * grid.rowPitch,
      }),
    };
  }

  private renderCard(entry: QuestBoardEntry, index: number, x: number, y: number): void {
    const accent = entry.status === 'active' ? ACCENT_COLORS.safe
      : entry.status === 'complete' ? ACCENT_COLORS.neutral
      : ACCENT_COLORS.teal;
    const body = entry.status === 'active' ? BODY_COLORS.safe
      : entry.status === 'complete' ? BODY_COLORS.neutral
      : BODY_COLORS.teal;

    const card = createMenuCard(this, {
      x, y, width: CARD_WIDTH, height: CARD_HEIGHT,
      pulseSeed: index * 0.8,
      bodyFillColor: body,
      accentColor: accent,
      bannerHeight: 42,
      borderWidth: 3,
      borderColor: accent,
      cornerRadius: 8,
      interactive: entry.status !== 'complete',
    });
    card.container.setScale(this.gridScale);
    card.container.setDepth(2);
    if (entry.status === 'complete') card.container.setAlpha(COMPLETE_CARD_ALPHA);
    this.contentContainer!.add(card.container);
    this.cards.push(card);

    card.frame.add(makeDisplayText(this, 0, card.bannerTopY + 21, entry.name.toUpperCase(), {
      fontSize: 15,
      color: TEXT_COLORS.heading,
      letterSpacing: 1,
    }));

    const iconY = -CARD_HEIGHT / 2 + 88;
    const iconBackground = this.add.circle(0, iconY, 30, 0x000000, 0.35);
    iconBackground.setStrokeStyle(2, accent);
    card.frame.add(iconBackground);
    card.frame.add(createIcon(this, { x: 0, y: iconY, iconKey: entry.icon, size: 38 }));

    card.frame.add(makeBodyText(this, 0, iconY + 44, `STEP ${entry.stepNumber}/${entry.stepCount}`, {
      fontSize: 12,
      color: TEXT_COLORS.muted,
    }));

    card.frame.add(makeBodyText(this, 0, iconY + 76, entry.stepDescription, {
      fontSize: 13,
      color: TEXT_COLORS.body,
      wordWrapWidth: CARD_WIDTH - 28,
    }));

    const progressLabel = entry.status === 'complete'
      ? 'CHAIN COMPLETE'
      : `${Math.floor(entry.progress)} / ${entry.target}  ·  ${entry.goldRemaining} G`
        + (entry.relicOnCompletion ? ' + RELIC' : '') + ' LEFT';
    card.frame.add(makeBodyText(this, 0, CARD_HEIGHT / 2 - 56, progressLabel, {
      fontSize: 12,
      color: entry.status === 'complete' ? TEXT_COLORS.muted : ACCENT_COLORS_STR.gold,
    }));

    if (entry.status === 'complete') {
      this.activateHandlers[index] = () => this.soundManager.playError();
      return;
    }

    const actionLabel = entry.status === 'active' ? 'SET ASIDE'
      : entry.acceptable ? 'ACCEPT'
      : 'BOARD FULL';
    card.frame.add(makeDisplayText(this, 0, CARD_HEIGHT / 2 - 26, actionLabel, {
      fontSize: 14,
      color: entry.status === 'active' ? ACCENT_COLORS_STR.safe
        : entry.acceptable ? ACCENT_COLORS_STR.teal
        : TEXT_COLORS.muted,
      letterSpacing: 2,
    }));

    const activate = () => this.toggle(entry);
    this.activateHandlers[index] = activate;
    card.hitZone.on('pointerover', () => card.setHoverState(true));
    card.hitZone.on('pointerout', () => card.setHoverState(false));
    card.hitZone.on('pointerup', () => {
      this.focusedIndex = index;
      activate();
    });
  }

  private toggle(entry: QuestBoardEntry): void {
    if (this.resolved) return;
    const accepting = entry.status !== 'active';
    const applied = accepting
      ? acceptExpeditionQuest(entry.questId)
      : setExpeditionQuestAside(entry.questId);
    if (!applied) {
      this.soundManager.playError();
      return;
    }
    if (accepting) getDiscoveryManager().noteObjectiveUpdated(entry.questId);
    this.changed = true;
    this.soundManager.playUIClick();
    this.rebuild();
  }

  private leave(): void {
    if (this.resolved) return;
    this.resolved = true;
    this.soundManager.playUIClick();
    this.tweens.add({
      targets: this.children.list,
      alpha: 0,
      duration: 120,
      onComplete: () => {
        this.onCloseCallback?.(this.changed);
        this.scene.stop();
      },
    });
  }

  shutdown(): void {
    if (this.overlayUpdateHandler) {
      this.events.off('update', this.overlayUpdateHandler);
      this.overlayUpdateHandler = null;
    }
    this.menuOverlay?.destroy();
    this.menuOverlay = null;
    this.navigator?.destroy();
    this.navigator = null;
    this.contentContainer?.destroy();
    this.contentContainer = null;
    this.cards = [];
    this.activateHandlers = [];
    this.leaveButton?.destroy();
    this.leaveButton = null;
    this.statusText = null;
    this.subtitleText = null;
    this.tweens.killAll();
  }
}
