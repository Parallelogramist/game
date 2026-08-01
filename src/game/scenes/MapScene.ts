import Phaser from 'phaser';
import { getDiscoveryManager } from '../../expedition/DiscoveryManager';
import { buildSecretLead } from '../../expedition/secretHints';
import type { SecretLead } from '../../expedition/secretHints';
import { getActiveQuestHazardObjectives, getActiveQuestMarkers,
  getActiveQuestStepViews } from '../../meta/ExpeditionQuestManager';
import { GAMEPAD_BUTTON_B, GAMEPAD_BUTTON_LB, GAMEPAD_BUTTON_RB, GAMEPAD_BUTTON_START,
  GAMEPAD_BUTTON_Y, GAMEPAD_DPAD_DOWN, GAMEPAD_DPAD_LEFT, GAMEPAD_DPAD_RIGHT, GAMEPAD_DPAD_UP,
  GamepadManager } from '../../input/GamepadManager';
import {
  COLLECTED_ALPHA, LEGEND_GLYPH_SIZE, SectorMapRenderer,
  drawCollectedCheck, drawGateGlyph, drawGateLockRing, drawNewRouteRing, drawObjectivePin,
  drawAmbushNestGlyph, drawPoiGlyph, drawVaultGuardRing,
} from '../../visual/SectorMapRenderer';
import { gateGlyphFor } from '../../expedition/gateGlyphs';
import { buildSectorDetail, type PoiHazardKind } from '../../expedition/sectorDetail';
import { buildHazardPins, buildQuestPins } from '../../expedition/questPins';
import type { QuestPin } from '../../expedition/questPins';
import { HAZARD_NEST_GLYPH, poiGlyphFor } from '../../expedition/poiGlyphs';
import { makeBodyText, makeDisplayText } from '../../visual/DisplayText';
import { TEXT_COLORS } from '../../visual/MenuStyle';
import {
  MAP_ZOOM_LEVELS, centerViewOn, clampMapView, gridBoundsOfCells, mapPointToSector,
  nextSectorInDirection, snapZoomLevel,
} from '../../visual/mapProjection';
import type { GridBounds, GridCell, MapCursorDirection,
  MapViewTransform } from '../../visual/mapProjection';
import { sectorOfWorldPoint } from '../../world/worldSpace';
import { EdgeKind, PoiKind } from '../../world/worldTypes';
import type { WorldMap } from '../../world/worldTypes';
import type { GameScene } from './GameScene';

export interface MapSceneData {
  returnTo: 'GameScene';
  map: WorldMap;
  playerWorldX: number;
  playerWorldY: number;
  playerFacing: number;
  /** Passed in rather than read from the store here: GameScene already caches it for the
   *  run, and reading the real store is a SecureStorage decrypt. */
  ownedAbilityIds: readonly string[];
  earnedQuestKeyIds: readonly string[];
  /** Sectors holding a dormant ambush nest or nemesis lair. Passed in rather than read here for
   *  the same reason ownedAbilityIds is: it is run-scoped state GameScene already owns. */
  hazardSectors: readonly { sectorKey: string; kind: PoiHazardKind }[];
  /** Rooms whose permanent hive this run has already taken. Run-scoped like hazardSectors, and
   *  for the same reason it is passed in rather than read here. */
  spentNestSectorKeys: readonly string[];
}

/** Panel-space pixels per second at zoom 1; scaled by zoom so the pan feels constant. */
const PAN_SPEED = 420;
const HEADER_HEIGHT = 76;
const FOOTER_HEIGHT = 44;
/** Rows the LEADS panel draws before it collapses the rest into a count. */
const MAX_LEAD_ROWS = 4;
/** Fixed so the legend and the chart can be laid out once, at create time, against a bar
 *  whose height never depends on which sector happens to be focused. */
const DETAIL_BAR_HEIGHT = 104;
/** How far a click or a hover may miss a cell and still focus it: about half a cell at the
 *  0.5 zoom, where cells are 32x18. */
const CURSOR_HIT_SLOP = 16;

function leadDistance(lead: SecretLead, ship: { col: number; row: number }): number {
  const [sx, sy] = lead.sectorKey.split(',').map(Number);
  return Math.max(Math.abs(sx - ship.col), Math.abs(sy - ship.row));
}

export class MapScene extends Phaser.Scene {
  private mapData!: WorldMap;
  private playerWorldX = 0;
  private playerWorldY = 0;
  private playerFacing = 0;
  private ownedAbilityIds: ReadonlySet<string> = new Set();
  private earnedQuestKeyIds: ReadonlySet<string> = new Set();

  private graphics!: Phaser.GameObjects.Graphics;
  private mapRenderer!: SectorMapRenderer;
  private gamepadManager: GamepadManager | null = null;
  private view: MapViewTransform = { originX: 0, originY: 0, scale: 1 };
  private bounds: GridBounds = { minGX: 0, minGY: 0, maxGX: 0, maxGY: 0 };
  private zoomIndex = 1;
  private viewDirty = true;
  private closed = false;
  /** LB opened this scene, so it is still held on frame 1 and would read as a fresh press. */
  private zoomOutArmed = false;
  private dragPointerId = -1;
  private dragLastX = 0;
  private dragLastY = 0;
  private leads: SecretLead[] = [];
  private hintedSectorKeys: ReadonlySet<string> = new Set();
  private questPins: QuestPin[] = [];
  private objectiveSectorKeys: ReadonlySet<string> = new Set();
  private hazardSectorKinds: ReadonlyMap<string, PoiHazardKind> = new Map();
  private spentNestSectorKeys: ReadonlySet<string> = new Set();
  private newlyPassableEdgeIds: ReadonlySet<string> = new Set();
  private knownCells: GridCell[] = [];
  private focusedCell: GridCell | null = null;
  private detailHeadlineText!: Phaser.GameObjects.Text;
  private detailDoorsText!: Phaser.GameObjects.Text;
  private detailRewardsText!: Phaser.GameObjects.Text;

  private panKeys!: Record<'up' | 'down' | 'left' | 'right', Phaser.Input.Keyboard.Key[]>;
  private keydownHandler: ((event: KeyboardEvent) => void) | null = null;
  private wheelHandler: ((pointer: Phaser.Input.Pointer, over: unknown,
    deltaX: number, deltaY: number) => void) | null = null;
  private pointerDownHandler: ((pointer: Phaser.Input.Pointer) => void) | null = null;
  private pointerMoveHandler: ((pointer: Phaser.Input.Pointer) => void) | null = null;
  private pointerUpHandler: ((pointer: Phaser.Input.Pointer) => void) | null = null;

  constructor() {
    super({ key: 'MapScene' });
  }

  init(data: MapSceneData): void {
    this.mapData = data.map;
    this.playerWorldX = data.playerWorldX;
    this.playerWorldY = data.playerWorldY;
    this.playerFacing = data.playerFacing;
    this.ownedAbilityIds = new Set(data.ownedAbilityIds ?? []);
    this.earnedQuestKeyIds = new Set(data.earnedQuestKeyIds ?? []);
    this.hazardSectorKinds = new Map(
      (data.hazardSectors ?? []).map(entry => [entry.sectorKey, entry.kind]),
    );
    this.spentNestSectorKeys = new Set(data.spentNestSectorKeys ?? []);
    this.closed = false;
    this.zoomOutArmed = false;
    this.dragPointerId = -1;
  }

  create(): void {
    this.input.setTopOnly(true);
    const width = this.scale.width;
    const height = this.scale.height;

    this.add.rectangle(0, 0, width, height, 0x05080f, 0.94).setOrigin(0, 0);

    const discovery = getDiscoveryManager();
    // Doc 03 section 7 moment 6's "until first viewed": snapshot first, then clear, so the
    // rings survive every pan and zoom of THIS open and appear on no later one.
    this.newlyPassableEdgeIds = new Set(discovery.getNewlyPassableEdgeIds());
    discovery.clearNewlyPassableEdges();
    makeDisplayText(this, width / 2, 40, 'WORLD MAP', {
      fontSize: 38, letterSpacing: 3,
    }).setDepth(2);
    makeBodyText(this, width / 2, 72,
      `${discovery.getVisitedSectorCount()} / ${discovery.getKnowableSectorCount()}`
      + ` SECTORS EXPLORED`
      + `  ·  ${discovery.getCompletionPercent()}%`,
      { fontSize: 18, color: TEXT_COLORS.muted }).setDepth(2);
    makeBodyText(this, width / 2, height - 26,
      'WASD / ARROWS PAN   ·   +/- ZOOM   ·   C CENTRE'
      + '   ·   HOVER OR TAP A SECTOR TO INSPECT   ·   M / ESC CLOSE',
      { fontSize: 14, color: TEXT_COLORS.muted }).setDepth(2);
    const shipCell = sectorOfWorldPoint(this.playerWorldX, this.playerWorldY);
    this.questPins = [
      ...buildQuestPins({
        map: this.mapData,
        markers: getActiveQuestMarkers(),
        sectorFlagsOf: (key) => discovery.getSectorFlags(key),
        shipCell,
      }),
      ...buildHazardPins({
        map: this.mapData,
        objectives: getActiveQuestHazardObjectives(),
        sectorFlagsOf: (key) => discovery.getSectorFlags(key),
        poiFlagsOf: (poiId) => discovery.getPoiFlags(poiId),
        spentNestSectorKeys: this.spentNestSectorKeys,
        shipCell,
      }),
    ];
    this.objectiveSectorKeys = new Set(
      this.questPins
        .map(pin => pin.sectorKey)
        .filter((key): key is string => key !== null),
    );
    const leadsPanelY = this.renderObjectivesPanel();
    this.leads = discovery.getHintedSecretIds()
      .map(secretId => buildSecretLead(this.mapData, secretId))
      .filter((lead): lead is SecretLead => lead !== null)
      .sort((a, b) => leadDistance(a, shipCell) - leadDistance(b, shipCell)
        || (a.secretId < b.secretId ? -1 : a.secretId > b.secretId ? 1 : 0));
    this.hintedSectorKeys = new Set(this.leads.map(lead => lead.sectorKey));
    this.renderLeadsPanel(leadsPanelY);
    this.renderLegendPanel();

    this.graphics = this.add.graphics();
    this.graphics.setDepth(1);
    this.mapRenderer = new SectorMapRenderer(this.graphics);

    this.knownCells = [];
    for (const sector of this.mapData.sectors.values()) {
      if (discovery.getSectorFlags(sector.key) !== 0) {
        this.knownCells.push({ gridX: sector.sx, gridY: sector.sy });
      }
    }
    const shipSector = sectorOfWorldPoint(this.playerWorldX, this.playerWorldY);
    if (this.knownCells.length === 0) {
      this.knownCells.push({ gridX: shipSector.col, gridY: shipSector.row });
    }
    this.bounds = gridBoundsOfCells(this.knownCells)
      ?? { minGX: shipSector.col, minGY: shipSector.row,
           maxGX: shipSector.col, maxGY: shipSector.row };

    this.zoomIndex = 1;
    this.setView(centerViewOn(
      shipSector.col, shipSector.row, MAP_ZOOM_LEVELS[this.zoomIndex],
      this.panelWidth(), this.panelHeight(),
    ));

    this.renderDetailBar();
    this.focusedCell = this.knownCells.find(
      cell => cell.gridX === shipSector.col && cell.gridY === shipSector.row,
    ) ?? this.knownCells[0] ?? null;
    this.refreshDetail();

    const keyboard = this.input.keyboard;
    this.panKeys = {
      up: [], down: [], left: [], right: [],
    };
    if (keyboard) {
      const cursors = keyboard.createCursorKeys();
      this.panKeys.up = [cursors.up, keyboard.addKey('W')];
      this.panKeys.down = [cursors.down, keyboard.addKey('S')];
      this.panKeys.left = [cursors.left, keyboard.addKey('A')];
      this.panKeys.right = [cursors.right, keyboard.addKey('D')];
      this.keydownHandler = (event: KeyboardEvent) => {
        const key = event.key;
        if (key === 'm' || key === 'M' || key === 'Escape') { this.close(); return; }
        if (key === 'c' || key === 'C') { this.centreOnShip(); return; }
        if (key === '+' || key === '=') { this.stepZoom(1); return; }
        if (key === '-' || key === '_') this.stepZoom(-1);
      };
      keyboard.on('keydown', this.keydownHandler);
    }

    this.wheelHandler = (_pointer, _over, _deltaX, deltaY) => {
      this.stepZoom(deltaY < 0 ? 1 : -1);
    };
    this.input.on('wheel', this.wheelHandler);

    this.pointerDownHandler = (pointer) => {
      this.dragPointerId = pointer.id;
      this.dragLastX = pointer.x;
      this.dragLastY = pointer.y;
      this.focusFromPointer(pointer);
    };
    this.pointerMoveHandler = (pointer) => {
      if (pointer.id !== this.dragPointerId || !pointer.isDown) {
        // Mouse hover: doc 03 section 4.5 rule 3 accepts cursor, tap OR hover, and hover is
        // the one path that costs no key, no button and no touch target.
        this.focusFromPointer(pointer);
        return;
      }
      this.panBy(pointer.x - this.dragLastX, pointer.y - this.dragLastY);
      this.dragLastX = pointer.x;
      this.dragLastY = pointer.y;
    };
    this.pointerUpHandler = (pointer) => {
      if (pointer.id === this.dragPointerId) this.dragPointerId = -1;
    };
    this.input.on('pointerdown', this.pointerDownHandler);
    this.input.on('pointermove', this.pointerMoveHandler);
    this.input.on('pointerup', this.pointerUpHandler);

    this.gamepadManager = new GamepadManager(this);

    this.events.once('shutdown', this.shutdown, this);
    this.redraw();
  }

  /**
   * Active objectives, top-left, below the header. Text is laid out first and the backing
   * plate sized from the measured heights, so a description that wraps on a narrow screen
   * cannot spill outside the panel.
   */
  private renderObjectivesPanel(): number {
    const views = getActiveQuestStepViews();
    if (views.length === 0) return HEADER_HEIGHT + 12;

    const panelX = 24;
    const panelY = HEADER_HEIGHT + 12;
    const panelWidth = Math.min(340, this.scale.width - 48);
    const textWidth = panelWidth - 28;
    const pinnedByQuestId = new Map(this.questPins.map(pin => [pin.questId, pin.sectorKey]));

    makeBodyText(this, panelX + 14, panelY + 12, 'OBJECTIVES',
      { fontSize: 14, color: TEXT_COLORS.muted, align: 'left' })
      .setOrigin(0, 0).setDepth(4);

    let cursorY = panelY + 34;
    for (const view of views) {
      const heading = makeBodyText(this, panelX + 14, cursorY,
        `${view.questName}  ·  STEP ${view.stepNumber}/${view.stepCount}`,
        { fontSize: 15, align: 'left', wordWrapWidth: textWidth })
        .setOrigin(0, 0).setDepth(4);
      cursorY += heading.height + 2;
      const pinned = pinnedByQuestId.has(view.questId)
        ? (pinnedByQuestId.get(view.questId) !== null
          ? '   · PINNED ON THE CHART'
          : '   · NOT YET CHARTED')
        : '';
      const detail = makeBodyText(this, panelX + 14, cursorY,
        `${view.stepDescription}   ${view.progress}/${view.target}${pinned}`,
        { fontSize: 12, color: TEXT_COLORS.muted, align: 'left', wordWrapWidth: textWidth })
        .setOrigin(0, 0).setDepth(4);
      cursorY += detail.height + 12;
    }

    this.add.rectangle(panelX, panelY, panelWidth, cursorY - panelY + 2, 0x0a1018, 0.9)
      .setOrigin(0, 0).setDepth(3).setStrokeStyle(1, 0x2b3a4d, 0.9);
    return cursorY + 14;
  }

  /**
   * Open leads, stacked under the objectives panel: a lore fragment named a sector and this is
   * where the player reads it back once the toast is gone. Same layout shape as the objectives
   * panel, so the two read as one column.
   */
  private renderLeadsPanel(panelY: number): void {
    if (this.leads.length === 0) return;

    const panelX = 24;
    const panelWidth = Math.min(340, this.scale.width - 48);
    const textWidth = panelWidth - 28;

    makeBodyText(this, panelX + 14, panelY + 12, 'LEADS',
      { fontSize: 14, color: TEXT_COLORS.muted, align: 'left' })
      .setOrigin(0, 0).setDepth(4);

    let cursorY = panelY + 34;
    for (const lead of this.leads.slice(0, MAX_LEAD_ROWS)) {
      const heading = makeBodyText(this, panelX + 14, cursorY, lead.fragment.title.toUpperCase(),
        { fontSize: 15, align: 'left', wordWrapWidth: textWidth })
        .setOrigin(0, 0).setDepth(4);
      cursorY += heading.height + 2;
      const detail = makeBodyText(this, panelX + 14, cursorY,
        lead.sigils
          ? `${lead.fragment.text}  ${lead.riddle}  ${lead.sigils}`
          : `${lead.fragment.text}  ${lead.riddle}`,
        { fontSize: 12, color: TEXT_COLORS.muted, align: 'left', wordWrapWidth: textWidth })
        .setOrigin(0, 0).setDepth(4);
      cursorY += detail.height + 12;
    }
    if (this.leads.length > MAX_LEAD_ROWS) {
      const more = makeBodyText(this, panelX + 14, cursorY,
        `+${this.leads.length - MAX_LEAD_ROWS} MORE`,
        { fontSize: 12, color: TEXT_COLORS.muted, align: 'left' })
        .setOrigin(0, 0).setDepth(4);
      cursorY += more.height + 12;
    }

    this.add.rectangle(panelX, panelY, panelWidth, cursorY - panelY + 2, 0x0a1018, 0.9)
      .setOrigin(0, 0).setDepth(3).setStrokeStyle(1, 0x2b3a4d, 0.9);
  }

  /**
   * The map's own glyph vocabulary, generated from the two glyph tables so it cannot drift
   * from what the renderer draws. Always visible rather than the TAB-toggled panel doc 03
   * section 4.5 specifies: a toggle would need a keyboard key, a gamepad button and a touch
   * target, which is three input paths for 196 px of screen the left-hand panels already
   * overlay anyway.
   */
  private renderLegendPanel(): void {
    const rows: Array<{
      label: string;
      draw: (graphics: Phaser.GameObjects.Graphics, x: number, y: number) => void;
    }> = [];
    for (const kind of [PoiKind.AbilityPowerUp, PoiKind.Treasure,
      PoiKind.Shrine, PoiKind.Secret, PoiKind.QuestGiver]) {
      rows.push({
        label: poiGlyphFor(kind).label,
        draw: (graphics, x, y) => drawPoiGlyph(graphics, kind, x, y, LEGEND_GLYPH_SIZE, 1),
      });
    }
    rows.push({
      label: HAZARD_NEST_GLYPH.label,
      draw: (graphics, x, y) => drawAmbushNestGlyph(graphics, x, y, LEGEND_GLYPH_SIZE, 1),
    });
    rows.push({
      label: 'Guard still standing',
      draw: (graphics, x, y) => {
        drawPoiGlyph(graphics, PoiKind.AbilityPowerUp, x, y, LEGEND_GLYPH_SIZE, 1);
        drawVaultGuardRing(graphics, x, y, LEGEND_GLYPH_SIZE);
      },
    });
    rows.push({
      label: 'Already claimed',
      draw: (graphics, x, y) => {
        drawPoiGlyph(graphics, PoiKind.AbilityPowerUp, x, y, LEGEND_GLYPH_SIZE, COLLECTED_ALPHA);
        drawCollectedCheck(graphics, x, y, LEGEND_GLYPH_SIZE);
      },
    });
    for (const kind of [EdgeKind.Open, EdgeKind.AbilityDoor, EdgeKind.KeyDoor,
      EdgeKind.Breakable, EdgeKind.OneWay]) {
      rows.push({
        label: gateGlyphFor(kind).label,
        draw: (graphics, x, y) =>
          drawGateGlyph(graphics, kind, x, y, false, LEGEND_GLYPH_SIZE),
      });
    }
    rows.push({
      label: 'Still sealed',
      draw: (graphics, x, y) => {
        drawGateGlyph(graphics, EdgeKind.AbilityDoor, x, y, false, LEGEND_GLYPH_SIZE);
        drawGateLockRing(graphics, EdgeKind.AbilityDoor, x, y, LEGEND_GLYPH_SIZE);
      },
    });
    rows.push({
      label: 'Newly opened',
      draw: (graphics, x, y) => {
        drawGateGlyph(graphics, EdgeKind.AbilityDoor, x, y, false, LEGEND_GLYPH_SIZE);
        drawNewRouteRing(graphics, x, y, LEGEND_GLYPH_SIZE);
      },
    });
    rows.push({
      label: 'Objective',
      draw: (graphics, x, y) =>
        drawObjectivePin(graphics, x, y - LEGEND_GLYPH_SIZE, LEGEND_GLYPH_SIZE * 1.2),
    });

    const rowHeight = 20;
    const panelWidth = 196;
    const panelHeight = 36 + rows.length * rowHeight + 8;
    const panelX = this.scale.width - 24 - panelWidth;
    const panelY = Math.max(HEADER_HEIGHT + 12,
      this.scale.height - FOOTER_HEIGHT - DETAIL_BAR_HEIGHT - 24 - panelHeight);

    this.add.rectangle(panelX, panelY, panelWidth, panelHeight, 0x0a1018, 0.9)
      .setOrigin(0, 0).setDepth(3).setStrokeStyle(1, 0x2b3a4d, 0.9);
    makeBodyText(this, panelX + 14, panelY + 10, 'LEGEND',
      { fontSize: 14, color: TEXT_COLORS.muted, align: 'left' })
      .setOrigin(0, 0).setDepth(5);

    const graphics = this.add.graphics();
    graphics.setDepth(4);
    let rowY = panelY + 36;
    for (const row of rows) {
      row.draw(graphics, panelX + 22, rowY + 8);
      makeBodyText(this, panelX + 40, rowY, row.label.toUpperCase(),
        { fontSize: 12, color: TEXT_COLORS.muted, align: 'left' })
        .setOrigin(0, 0).setDepth(5);
      rowY += rowHeight;
    }
  }

  /**
   * The readout. Three Text objects created once and re-set on focus change: rebuilding them
   * per focus would churn GameObjects on every D-pad tap and every mouse move across the
   * chart.
   */
  private renderDetailBar(): void {
    const barX = 24;
    const barWidth = this.scale.width - 48;
    const barY = this.scale.height - FOOTER_HEIGHT - DETAIL_BAR_HEIGHT;
    const textWidth = barWidth - 28;

    this.add.rectangle(barX, barY, barWidth, DETAIL_BAR_HEIGHT, 0x0a1018, 0.92)
      .setOrigin(0, 0).setDepth(3).setStrokeStyle(1, 0x2b3a4d, 0.9);
    this.detailHeadlineText = makeBodyText(this, barX + 14, barY + 12, '',
      { fontSize: 17, align: 'left', wordWrapWidth: textWidth })
      .setOrigin(0, 0).setDepth(4);
    this.detailDoorsText = makeBodyText(this, barX + 14, barY + 40, '',
      { fontSize: 13, color: TEXT_COLORS.muted, align: 'left', wordWrapWidth: textWidth })
      .setOrigin(0, 0).setDepth(4);
    this.detailRewardsText = makeBodyText(this, barX + 14, barY + 74, '',
      { fontSize: 13, color: TEXT_COLORS.muted, align: 'left', wordWrapWidth: textWidth })
      .setOrigin(0, 0).setDepth(4);
  }

  private refreshDetail(): void {
    const discovery = getDiscoveryManager();
    const detail = this.focusedCell ? buildSectorDetail({
      map: this.mapData,
      gridX: this.focusedCell.gridX,
      gridY: this.focusedCell.gridY,
      sectorFlagsOf: (key) => discovery.getSectorFlags(key),
      edgeFlagsOf: (edgeId) => discovery.getEdgeFlags(edgeId),
      poiFlagsOf: (poiId) => discovery.getPoiFlags(poiId),
      secretFlagsOf: (secretId) => discovery.getSecretFlags(secretId),
      holdsAbility: (abilityId) => this.ownedAbilityIds.has(abilityId),
      holdsQuestKey: (keyId) => this.earnedQuestKeyIds.has(keyId),
      objectiveSectorKeys: this.objectiveSectorKeys,
      hintedSectorKeys: this.hintedSectorKeys,
      hazardSectorKinds: this.hazardSectorKinds,
    }) : null;

    if (!detail) {
      this.detailHeadlineText.setText('NO SECTOR SELECTED');
      this.detailDoorsText.setText(
        'HOVER OR TAP A CHARTED SECTOR, OR PUSH THE D-PAD, TO READ WHAT IT HOLDS');
      this.detailRewardsText.setText('');
      return;
    }
    this.detailHeadlineText.setText(
      `${detail.headline.toUpperCase()}   ·   ${detail.place.toUpperCase()}`
      + `   ·   SECTOR ${detail.sectorKey}`);
    this.detailDoorsText.setText(detail.doors.length > 0
      ? `DOORS   ${detail.doors.join('     ').toUpperCase()}`
      : 'DOORS   NONE CHARTED HERE YET');
    this.detailRewardsText.setText(detail.rewards.length > 0
      ? `HOLDS   ${detail.rewards.join('     ').toUpperCase()}`
      : 'HOLDS   NOTHING THE CHART KNOWS OF');
  }

  update(_time: number, delta: number): void {
    if (this.closed) return;
    const seconds = delta * 0.001;

    let panX = 0;
    let panY = 0;
    if (this.isAnyDown(this.panKeys.left)) panX += 1;
    if (this.isAnyDown(this.panKeys.right)) panX -= 1;
    if (this.isAnyDown(this.panKeys.up)) panY += 1;
    if (this.isAnyDown(this.panKeys.down)) panY -= 1;

    const pad = this.gamepadManager;
    if (pad) {
      pad.update();
      const stick = pad.getLeftStick();
      panX -= stick.x;
      panY -= stick.y;
      if (!this.zoomOutArmed && !pad.isDown(GAMEPAD_BUTTON_LB)) this.zoomOutArmed = true;
      if (pad.justPressed(GAMEPAD_BUTTON_RB)) this.stepZoom(1);
      if (this.zoomOutArmed && pad.justPressed(GAMEPAD_BUTTON_LB)) this.stepZoom(-1);
      if (pad.justPressed(GAMEPAD_BUTTON_Y)) this.centreOnShip();
      if (pad.justPressed(GAMEPAD_DPAD_UP)) this.moveCursor('up');
      if (pad.justPressed(GAMEPAD_DPAD_DOWN)) this.moveCursor('down');
      if (pad.justPressed(GAMEPAD_DPAD_LEFT)) this.moveCursor('left');
      if (pad.justPressed(GAMEPAD_DPAD_RIGHT)) this.moveCursor('right');
      if (pad.justPressed(GAMEPAD_BUTTON_B) || pad.justPressed(GAMEPAD_BUTTON_START)) {
        this.close();
        return;
      }
    }

    if (panX !== 0 || panY !== 0) {
      const speed = PAN_SPEED * this.view.scale * seconds;
      this.panBy(panX * speed, panY * speed);
    }
    if (this.viewDirty) this.redraw();
  }

  private isAnyDown(keys: Phaser.Input.Keyboard.Key[]): boolean {
    return keys.some(key => key.isDown);
  }

  private panelWidth(): number { return this.scale.width; }

  private panelHeight(): number {
    return this.scale.height - HEADER_HEIGHT - FOOTER_HEIGHT - DETAIL_BAR_HEIGHT;
  }

  private panBy(deltaX: number, deltaY: number): void {
    this.setView({
      originX: this.view.originX + deltaX,
      originY: this.view.originY + deltaY,
      scale: this.view.scale,
    });
  }

  private stepZoom(direction: number): void {
    const next = Math.min(MAP_ZOOM_LEVELS.length - 1, Math.max(0, this.zoomIndex + direction));
    if (next === this.zoomIndex) return;
    const scale = MAP_ZOOM_LEVELS[next];
    // Zoom about the panel centre so the sector being read stays under the eye.
    const centreX = this.panelWidth() / 2;
    const centreY = this.panelHeight() / 2 + HEADER_HEIGHT;
    const ratio = scale / this.view.scale;
    this.zoomIndex = next;
    this.setView({
      originX: centreX - (centreX - this.view.originX) * ratio,
      originY: centreY - (centreY - this.view.originY) * ratio,
      scale,
    });
  }

  private centreOnShip(): void {
    const shipSector = sectorOfWorldPoint(this.playerWorldX, this.playerWorldY);
    this.setView(centerViewOn(
      shipSector.col, shipSector.row, MAP_ZOOM_LEVELS[this.zoomIndex],
      this.panelWidth(), this.panelHeight(),
    ));
    this.setFocus({ gridX: shipSector.col, gridY: shipSector.row });
  }

  private focusFromPointer(pointer: Phaser.Input.Pointer): void {
    if (pointer.y < HEADER_HEIGHT) return;
    if (pointer.y > this.scale.height - FOOTER_HEIGHT - DETAIL_BAR_HEIGHT) return;
    const cell = mapPointToSector(
      pointer.x, pointer.y, this.view, CURSOR_HIT_SLOP, this.knownCells,
    );
    if (cell) this.setFocus(cell);
  }

  private moveCursor(direction: MapCursorDirection): void {
    if (!this.focusedCell) {
      if (this.knownCells.length > 0) this.setFocus(this.knownCells[0]);
      return;
    }
    const next = nextSectorInDirection(
      this.focusedCell.gridX, this.focusedCell.gridY, direction, this.knownCells,
    );
    if (next) this.setFocus(next);
  }

  private setFocus(cell: GridCell): void {
    if (this.focusedCell
      && this.focusedCell.gridX === cell.gridX
      && this.focusedCell.gridY === cell.gridY) return;
    this.focusedCell = cell;
    this.refreshDetail();
    this.viewDirty = true;
  }

  /** Every view mutation funnels through the pure clamp: the scene never clamps itself. */
  private setView(candidate: MapViewTransform): void {
    const clamped = clampMapView(candidate, this.bounds, this.panelWidth(), this.panelHeight());
    this.view = {
      originX: clamped.originX,
      originY: clamped.originY + HEADER_HEIGHT,
      scale: clamped.scale,
    };
    this.zoomIndex = MAP_ZOOM_LEVELS.indexOf(
      snapZoomLevel(clamped.scale) as (typeof MAP_ZOOM_LEVELS)[number],
    );
    if (this.zoomIndex < 0) this.zoomIndex = 1;
    this.viewDirty = true;
  }

  private redraw(): void {
    const discovery = getDiscoveryManager();
    this.mapRenderer.draw({
      map: this.mapData,
      view: this.view,
      panelWidth: this.scale.width,
      panelHeight: this.scale.height,
      sectorFlagsOf: (key) => discovery.getSectorFlags(key),
      edgeFlagsOf: (edgeId) => discovery.getEdgeFlags(edgeId),
      objectiveSectorKeys: this.objectiveSectorKeys,
      hintedSectorKeys: this.hintedSectorKeys,
      newlyPassableEdgeIds: this.newlyPassableEdgeIds,
      focusedCell: this.focusedCell,
      poiFlagsOf: (poiId) => discovery.getPoiFlags(poiId),
      secretFlagsOf: (secretId) => discovery.getSecretFlags(secretId),
      holdsAbility: (abilityId) => this.ownedAbilityIds.has(abilityId),
      holdsQuestKey: (keyId) => this.earnedQuestKeyIds.has(keyId),
      playerWorldX: this.playerWorldX,
      playerWorldY: this.playerWorldY,
      playerFacing: this.playerFacing,
    });
    this.viewDirty = false;
  }

  private close(): void {
    if (this.closed) return;
    this.closed = true;
    const gameScene = this.scene.get('GameScene') as GameScene | undefined;
    // Clears isPaused BEFORE the resume: GameScene's resume handler opens the pause menu
    // whenever it comes back still paused (the settings return flow).
    gameScene?.closeExpeditionMap?.();
    this.scene.resume('GameScene');
    this.scene.stop();
  }

  shutdown(): void {
    if (this.keydownHandler) {
      this.input.keyboard?.off('keydown', this.keydownHandler);
      this.keydownHandler = null;
    }
    if (this.wheelHandler) { this.input.off('wheel', this.wheelHandler); this.wheelHandler = null; }
    if (this.pointerDownHandler) {
      this.input.off('pointerdown', this.pointerDownHandler);
      this.pointerDownHandler = null;
    }
    if (this.pointerMoveHandler) {
      this.input.off('pointermove', this.pointerMoveHandler);
      this.pointerMoveHandler = null;
    }
    if (this.pointerUpHandler) {
      this.input.off('pointerup', this.pointerUpHandler);
      this.pointerUpHandler = null;
    }
    this.gamepadManager?.destroy();
    this.gamepadManager = null;
    this.tweens.killAll();
  }
}
