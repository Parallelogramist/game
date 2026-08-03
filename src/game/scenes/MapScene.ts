import Phaser from 'phaser';
import { getDiscoveryManager } from '../../expedition/DiscoveryManager';
import { getCurrentExpeditionSeasonIndex } from '../../expedition/ExpeditionSeasonStore';
import { buildSecretLead, findSealedLeadSectors,
  leadSectorDistance } from '../../expedition/secretHints';
import type { SecretLead } from '../../expedition/secretHints';
import { getActiveQuestHazardObjectives, getActiveQuestMarkers, getQuestBoardEntries,
  getActiveQuestStepViews } from '../../meta/ExpeditionQuestManager';
import { questWorldStamp } from '../../systems/QuestProgress';
import { GAMEPAD_BUTTON_A, GAMEPAD_BUTTON_B, GAMEPAD_BUTTON_LB, GAMEPAD_BUTTON_RB,
  GAMEPAD_BUTTON_RT, GAMEPAD_BUTTON_SELECT, GAMEPAD_BUTTON_START,
  GAMEPAD_BUTTON_X, GAMEPAD_BUTTON_Y, GAMEPAD_DPAD_DOWN, GAMEPAD_DPAD_LEFT,
  GAMEPAD_DPAD_RIGHT, GAMEPAD_DPAD_UP, GamepadManager } from '../../input/GamepadManager';
import {
  COLLECTED_ALPHA, LEGEND_GLYPH_SIZE, SectorMapRenderer,
  drawCollectedCheck, drawGateGlyph, drawGateLockRing, drawNewRouteRing, drawObjectivePin,
  drawLeadBadge, drawObjectiveUpdatedBadge, drawAmbushNestGlyph, drawPoiGlyph, drawSectorMark,
  drawGridBandBadge, drawSectorNoteDot, drawSortieBadge, drawStirBadge, drawVaultChartBadge,
  drawVaultGuardRing,
} from '../../visual/SectorMapRenderer';
import { getSectorMarks, getSectorNotes, setSectorMark,
  setSectorNote } from '../../expedition/WorldProfileStore';
import { MAX_SECTOR_NOTE_LENGTH, SECTOR_MARKS, SECTOR_MARK_CYCLE,
  nextSectorMarkKind, sanitizeSectorNote } from '../../expedition/sectorMarks';
import type { SectorMarkKind } from '../../expedition/sectorMarks';
import { showCodeEntryOverlay } from '../../ui/CodeEntryOverlay';
import { gateGlyphFor } from '../../expedition/gateGlyphs';
import { setPendingExpeditionLaunch, setPlannedSortie } from '../../expedition/pendingLaunch';
import { buildSectorDetail, type PoiHazardKind } from '../../expedition/sectorDetail';
import { describeSectorCourse, plotSectorCourse } from '../../expedition/sectorRoute';
import type { SectorCourse } from '../../expedition/sectorRoute';
import { wardenBossNameForWorld } from '../../expedition/wardenIdentity';
import { buildHazardPins, buildQuestPins, updatedPinSectorKeys } from '../../expedition/questPins';
import type { QuestPin } from '../../expedition/questPins';
import { planMapOpenReveal, sampleMapOpenReveal } from '../../expedition/mapReveal';
import type { MapRevealPlan } from '../../expedition/mapReveal';
import { getSettingsManager } from '../../settings';
import { buildLockoutRows } from '../../expedition/lockouts';
import type { LockoutQuestState, LockoutRow, LockoutTravel } from '../../expedition/lockouts';
import { HAZARD_NEST_GLYPH, poiGlyphFor } from '../../expedition/poiGlyphs';
import { makeBodyText, makeDisplayText } from '../../visual/DisplayText';
import { TEXT_COLORS } from '../../visual/MenuStyle';
import { getAchievementManager } from '../../achievements';
import { createMenuButton } from '../../visual/MenuButton';
import type { MenuButton } from '../../visual/MenuButton';
import { transitionToScene } from '../../utils/SceneTransition';
import {
  MAP_ZOOM_LEVELS, centerViewOn, clampMapView, gridBoundsOfCells, mapPointToSector,
  nextSectorInDirection, snapZoomLevel,
} from '../../visual/mapProjection';
import type { GridBounds, GridCell, MapCursorDirection,
  MapViewTransform } from '../../visual/mapProjection';
import { buildSectorSupply } from '../../world/sectorTags';
import { sectorKey, sectorOfWorldPoint } from '../../world/worldSpace';
import { EdgeKind, PoiKind } from '../../world/worldTypes';
import type { WorldMap } from '../../world/worldTypes';
import type { GameScene } from './GameScene';

export interface MapSceneData {
  /** 'GameScene' is the in-run overlay: this scene holds the pause and resumes it on close.
   *  'BootScene' is the between-runs survey started from the GAME MODES submenu, where there is
   *  no run to pause, no ship flying and no recall to fire. */
  returnTo: 'GameScene' | 'BootScene';
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
  /** Rooms this expedition's ambient bloom grew fresh hazard ground in. Passed in rather than
   *  re-derived here for the same reason ownedAbilityIds is: GameScene already owns it, and
   *  re-deriving would need the profile store, which is a SecureStorage decrypt. */
  bloomedSectors: readonly string[];
  /** Rooms this expedition's ambient shift changed the shape of. Passed in for the same reason
   *  bloomedSectors is: GameScene already owns it, and re-deriving would need the profile store,
   *  which is a SecureStorage decrypt. */
  shiftedSectors: readonly string[];
  /** False while a boss seal holds the room. Passed in because only GameScene knows: a recall
   *  out of a sealed fight would strand the lock. */
  recallAvailable: boolean;
  /** True when a recall left an anchor this run. Passed in for the same reason recallAvailable is:
   *  only GameScene knows, and reading it here would be a second source of truth. In browse mode
   *  there is no run and BootScene answers it from the world profile's field anchor, which is the
   *  same fact one screen earlier: this profile has a sortie in hand for this world. */
  sortieAvailable: boolean;
  /** The room a sortie would return to: GameScene's `sortieAnchor` as a sector key in a run, and
   *  the profile's field anchor between runs. Passed in rather than read here for the same reason
   *  sortieAvailable is: reading the store here would be a second source of truth and a
   *  SecureStorage decrypt. Null exactly when sortieAvailable is false. */
  sortieAnchorSectorKey: string | null;
}

/** Panel-space pixels per second at zoom 1; scaled by zoom so the pan feels constant. */
const PAN_SPEED = 420;
const HEADER_HEIGHT = 76;
const FOOTER_HEIGHT = 44;
/** Exactly the keys create() captures. Cleared and re-armed around the note field, because a
 *  captured key is preventDefault-ed before the DOM input can ever see it, so W, A, S and D would
 *  silently refuse to type. */
const MAP_KEY_CAPTURES = 'W,A,S,D,UP,DOWN,LEFT,RIGHT,SPACE,SHIFT,TAB';
/** Rows the LEADS panel draws before it collapses the rest into a count. */
const MAX_LEAD_ROWS = 4;
/** Rows the LOCKED OUT panel draws before it collapses the rest into a count. Same cap and
 *  same reason as MAX_LEAD_ROWS: the left column shares one screen with the chart. */
const MAX_LOCKOUT_ROWS = 4;
/** One, against the detail bar's two: a lockout row already carries up to three count clauses
 *  before it reaches the trip, on a 12 px line in a 340 px panel. */
const MAX_LOCKOUT_REQUIREMENTS = 1;
const LEGEND_COLUMN_WIDTH = 196;
const LEGEND_ROW_HEIGHT = 20;
/** The header strip: also the whole height of the folded panel, and the toggle's hit target. */
const LEGEND_HEADER_HEIGHT = 36;
const LEGEND_BOTTOM_PAD = 8;
/** Fixed so the legend and the chart can be laid out once, at create time, against a bar
 *  whose height never depends on which sector happens to be focused. */
const DETAIL_BAR_HEIGHT = 104;
/** How far a click or a hover may miss a cell and still focus it: about half a cell at the
 *  0.5 zoom, where cells are 32x18. */
const CURSOR_HIT_SLOP = 16;
const RECALL_BUTTON_WIDTH = 176;
const RECALL_BUTTON_HEIGHT = 32;
const NOTE_BUTTON_WIDTH = 120;
/** Gap between the two footer buttons, matching the 20 px margin's visual rhythm at a smaller
 *  scale so the pair reads as one group rather than as two strays. */
const FOOTER_BUTTON_GAP = 12;

/** The trip the panel is about to send the player on, as the chart measures it: hops over
 *  charted rooms, and what is shut on the way, never a straight line across a world of walls. */
function travelClause(label: string, travel: LockoutTravel): string {
  switch (travel.kind) {
    case 'here':
      return `${label} IN THIS SECTOR`;
    case 'none':
      return `${label} NO CHARTED COURSE`;
    case 'hops':
      return `${label} ${travel.hops} HOP${travel.hops === 1 ? '' : 'S'}`;
    case 'blocked': {
      const hops = `${label} ${travel.hops} HOP${travel.hops === 1 ? '' : 'S'}`;
      if (travel.requirements.length === 0) return `${hops} · WAY SHUT`;
      const named = travel.requirements.slice(0, MAX_LOCKOUT_REQUIREMENTS);
      const unnamed = travel.requirements.length - named.length;
      const more = unnamed > 0 ? ` +${unnamed}` : '';
      return `${hops} · NEEDS ${named.join(', ').toUpperCase()}${more}`;
    }
  }
}

/** A zero clause is omitted rather than printed as "0 DOORS": a row exists only because
 *  something is nonzero. The last clause is always where to go and earn it, which is the only
 *  number on the line the player can act on. */
function describeLockoutRow(row: LockoutRow): string {
  const clauses: string[] = [];
  if (row.doors > 0) clauses.push(`${row.doors} DOOR${row.doors === 1 ? '' : 'S'}`);
  if (row.sites > 0) clauses.push(`${row.sites} SITE${row.sites === 1 ? '' : 'S'}`);
  if (row.shortcuts > 0) {
    clauses.push(`${row.shortcuts} SHORTCUT${row.shortcuts === 1 ? '' : 'S'}`);
  }
  const source = row.source;
  switch (source.kind) {
    case 'vault':
      clauses.push(travelClause(
        source.guardCleared ? 'UNSEALED VAULT' : 'GUARDED VAULT', source.travel));
      break;
    case 'questActive':
      clauses.push(`ACTIVE STEP ${source.stepNumber}/${source.stepCount}`);
      break;
    case 'questBoard':
      clauses.push(travelClause('BOARD', source.travel));
      break;
    case 'questSlotsFull':
      clauses.push('ALL OBJECTIVE SLOTS FULL');
      break;
    case 'wardenArena':
      clauses.push(travelClause('ARENA', source.travel));
      break;
    case 'unfound':
      clauses.push(
        row.kind === 'ability' ? 'VAULT NOT CHARTED'
          : row.kind === 'warden' ? 'ARENA NOT CHARTED'
            : 'NO BOARD CHARTED');
      break;
  }
  return clauses.join('  ·  ');
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
  private legendCollapsed = false;
  private legendObjects: Phaser.GameObjects.GameObject[] = [];
  private legendBounds: Phaser.Geom.Rectangle | null = null;
  private legendHeaderBounds: Phaser.Geom.Rectangle | null = null;
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
  private lockouts: LockoutRow[] = [];
  private hintedSectorKeys: ReadonlySet<string> = new Set();
  private sealedLeadSectorKeys: ReadonlySet<string> = new Set();
  private questPins: QuestPin[] = [];
  private objectiveSectorKeys: ReadonlySet<string> = new Set();
  private updatedObjectiveQuestIds: ReadonlySet<string> = new Set();
  private updatedObjectiveSectorKeys: ReadonlySet<string> = new Set();
  private hazardSectorKinds: ReadonlyMap<string, PoiHazardKind> = new Map();
  private spentNestSectorKeys: ReadonlySet<string> = new Set();
  private bloomedSectorKeys: ReadonlySet<string> = new Set();
  private shiftedSectorKeys: ReadonlySet<string> = new Set();
  /** The union the chart's destination lane draws. Built once in init() rather than per redraw:
   *  neither source set can change while the chart is open. */
  private stirredSectorKeys: ReadonlySet<string> = new Set();
  private newlyPassableEdgeIds: ReadonlySet<string> = new Set();
  private revealPlan: MapRevealPlan | null = null;
  private revealElapsedMs = 0;
  private knownCells: GridCell[] = [];
  private focusedCell: GridCell | null = null;
  private course: SectorCourse = { kind: 'none' };
  private markedSectorKinds: Map<string, SectorMarkKind> = new Map();
  private sectorNotes: Map<string, string> = new Map();
  private noteOverlayTeardown: (() => void) | null = null;
  private recallButton: MenuButton | null = null;
  private noteButton: MenuButton | null = null;
  private launchButton: MenuButton | null = null;
  /** RT may already be held when the map opens (the ship auto-fires), and a fresh GamepadManager
   *  reads a held button as a first press. Exactly the zoomOutArmed guard LB needs, for exactly
   *  the same reason: without it the note field opens by itself on the frame the chart appears. */
  private noteKeyArmed = false;
  private recallState: 'ready' | 'locked' | 'home' | 'sortie' = 'ready';
  private sortieAvailable = false;
  private sortieAnchorSectorKey: string | null = null;
  private browsing = false;
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
    this.browsing = data.returnTo === 'BootScene';
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
    this.bloomedSectorKeys = new Set(data.bloomedSectors ?? []);
    this.shiftedSectorKeys = new Set(data.shiftedSectors ?? []);
    this.stirredSectorKeys = new Set([...this.bloomedSectorKeys, ...this.shiftedSectorKeys]);
    this.recallState = data.recallAvailable === false ? 'locked' : 'ready';
    this.sortieAvailable = data.sortieAvailable === true;
    this.sortieAnchorSectorKey = data.sortieAnchorSectorKey;
    this.closed = false;
    this.zoomOutArmed = false;
    this.noteKeyArmed = false;
    this.dragPointerId = -1;
  }

  create(): void {
    this.input.setTopOnly(true);
    const width = this.scale.width;
    const height = this.scale.height;

    this.add.rectangle(0, 0, width, height, 0x05080f, this.browsing ? 1 : 0.94)
      .setOrigin(0, 0);

    const discovery = getDiscoveryManager();
    // Doc 03 section 7 moment 6's "until first viewed": snapshot first, then clear, so the
    // rings survive every pan and zoom of THIS open and appear on no later one.
    this.newlyPassableEdgeIds = new Set(discovery.getNewlyPassableEdgeIds());
    discovery.clearNewlyPassableEdges();
    this.updatedObjectiveQuestIds = new Set(discovery.getUpdatedObjectiveQuestIds());
    discovery.clearUpdatedObjectives();
    // Moments 3 and 4 follow moment 6's snapshot-then-clear rule, so the replay plays on exactly
    // one open. Reduced motion clears the overlays too: a skipped replay must be dropped, never
    // queued up to ambush a later open.
    const bloomSecretIds = [...discovery.getNewlyFoundSecretIds()];
    const chartedSectorKeys = [...discovery.getNewlyChartedSectorKeys()];
    discovery.clearMapOpenReveal();
    this.revealElapsedMs = 0;
    this.revealPlan = null;
    if (!getSettingsManager().isReducedMotionEnabled()) {
      const plan = planMapOpenReveal(this.mapData, chartedSectorKeys, bloomSecretIds);
      if (plan.durationMs > 0) this.revealPlan = plan;
    }
    makeDisplayText(this, width / 2, 40, 'WORLD MAP', {
      fontSize: 38, letterSpacing: 3,
    }).setDepth(2);
    const completionPercent = discovery.getCompletionPercent();
    const bestCompletionPercent =
      getAchievementManager().getLifetimeStats().bestWorldCompletionPercent;
    // Omitted while this world IS the record: "34%  ·  BEST 34%" reads as noise, and on the
    // first world that is every open until something is banked.
    const bestClause = bestCompletionPercent > completionPercent
      ? `  ·  BEST ${bestCompletionPercent}%`
      : '';
    makeBodyText(this, width / 2, 72,
      `WORLD ${getCurrentExpeditionSeasonIndex()}`
      + `  ·  ${discovery.getVisitedSectorCount()} / ${discovery.getKnowableSectorCount()}`
      + ` SECTORS`
      + `  ·  ${completionPercent}%${bestClause}`,
      { fontSize: 18, color: TEXT_COLORS.muted, wordWrapWidth: width - 40 }).setDepth(2);
    const footerButtonsWidth = RECALL_BUTTON_WIDTH + FOOTER_BUTTON_GAP + NOTE_BUTTON_WIDTH;
    const hintWidth = Math.max(120, width - 40 - footerButtonsWidth);
    makeBodyText(this, 20 + hintWidth / 2, height - 26,
      'WASD / ARROWS PAN   ·   +/- ZOOM   ·   C CENTRE   ·   TAB LEGEND'
      + '   ·   TAP A SECTOR   ·   P MARK   ·   N / RT NOTE'
      + (this.browsing ? '   ·   L LAUNCH' : '   ·   R RECALL / SORTIE')
      + '   ·   M / ESC CLOSE',
      { fontSize: 14, color: TEXT_COLORS.muted, wordWrapWidth: hintWidth }).setDepth(2);
    const shipCell = sectorOfWorldPoint(this.playerWorldX, this.playerWorldY);
    this.questPins = [
      ...buildQuestPins({
        map: this.mapData,
        markers: getActiveQuestMarkers(questWorldStamp(this.mapData)),
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
    this.updatedObjectiveSectorKeys = updatedPinSectorKeys(
      this.questPins, this.updatedObjectiveQuestIds,
    );
    const leadsPanelY = this.renderObjectivesPanel();
    this.leads = discovery.getHintedSecretIds()
      .map(secretId => buildSecretLead(this.mapData, secretId))
      .filter((lead): lead is SecretLead => lead !== null)
      .sort((a, b) => leadSectorDistance(a, shipCell) - leadSectorDistance(b, shipCell)
        || (a.secretId < b.secretId ? -1 : a.secretId > b.secretId ? 1 : 0));
    this.hintedSectorKeys = new Set(this.leads.map(lead => lead.sectorKey));
    this.sealedLeadSectorKeys = findSealedLeadSectors(
      this.leads, (abilityId) => this.ownedAbilityIds.has(abilityId));
    const supply = buildSectorSupply(this.mapData);
    const stepViewByQuestId = new Map(
      getActiveQuestStepViews(questWorldStamp(this.mapData), supply)
        .map(view => [view.questId, view]));
    const boardEntryByQuestId = new Map(
      getQuestBoardEntries(supply).map(entry => [entry.questId, entry]));
    const questStateOf = (questId: string): LockoutQuestState => {
      const view = stepViewByQuestId.get(questId);
      if (view) {
        return { kind: 'active', stepNumber: view.stepNumber, stepCount: view.stepCount };
      }
      const entry = boardEntryByQuestId.get(questId);
      if (!entry) return { kind: 'unoffered' };
      // buildQuestBoardEntries sets acceptable = available AND under the 3-quest cap, and a
      // completed chain never reaches here because holdsQuestKey already dropped the row.
      return entry.acceptable ? { kind: 'acceptable' } : { kind: 'slotsFull' };
    };
    this.lockouts = buildLockoutRows({
      map: this.mapData,
      sectorFlagsOf: (key) => discovery.getSectorFlags(key),
      edgeFlagsOf: (edgeId) => discovery.getEdgeFlags(edgeId),
      poiFlagsOf: (poiId) => discovery.getPoiFlags(poiId),
      secretFlagsOf: (secretId) => discovery.getSecretFlags(secretId),
      holdsAbility: (abilityId) => this.ownedAbilityIds.has(abilityId),
      holdsQuestKey: (keyId) => this.earnedQuestKeyIds.has(keyId),
      questStateOf,
      shipCell,
    });
    const routesPanelY = this.renderLeadsPanel(leadsPanelY);
    this.renderRoutesPanel(routesPanelY);
    this.legendCollapsed = getSettingsManager().isMapLegendCollapsed();
    this.renderLegendPanel();

    this.graphics = this.add.graphics();
    this.graphics.setDepth(1);
    this.mapRenderer = new SectorMapRenderer(this.graphics);
    this.markedSectorKinds = getSectorMarks(this.mapData.seed, this.mapData.worldGenVersion);
    this.sectorNotes = getSectorNotes(this.mapData.seed, this.mapData.worldGenVersion);

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
    if (this.browsing) this.createLaunchButton();
    else this.createRecallButton();
    this.createNoteButton();
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
        if (this.noteOverlayTeardown) return;
        const key = event.key;
        if (key === 'm' || key === 'M' || key === 'Escape') { this.close(); return; }
        if (key === 'Tab') { this.toggleLegend(); return; }
        if (key === 'r' || key === 'R') { this.recall(); return; }
        if (key === 'l' || key === 'L') { this.launch(); return; }
        if (key === 'p' || key === 'P') { this.cycleMark(); return; }
        if (key === 'n' || key === 'N') { this.editNote(); return; }
        if (key === 'c' || key === 'C') { this.centreOnShip(); return; }
        if (key === '+' || key === '=') { this.stepZoom(1); return; }
        if (key === '-' || key === '_') this.stepZoom(-1);
      };
      keyboard.on('keydown', this.keydownHandler);
      keyboard.addCapture('TAB');
    }

    this.wheelHandler = (_pointer, _over, _deltaX, deltaY) => {
      this.stepZoom(deltaY < 0 ? 1 : -1);
    };
    this.input.on('wheel', this.wheelHandler);

    this.pointerDownHandler = (pointer) => {
      if (this.legendHeaderBounds?.contains(pointer.x, pointer.y)) {
        this.toggleLegend();
        return;
      }
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
    const views = getActiveQuestStepViews(
      questWorldStamp(this.mapData), buildSectorSupply(this.mapData));
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
      const updated = this.updatedObjectiveQuestIds.has(view.questId) ? '   · UPDATED' : '';
      const heading = makeBodyText(this, panelX + 14, cursorY,
        `${view.questName}  ·  STEP ${view.stepNumber}/${view.stepCount}${updated}`,
        { fontSize: 15, align: 'left', wordWrapWidth: textWidth })
        .setOrigin(0, 0).setDepth(4);
      cursorY += heading.height + 2;
      const pinned = pinnedByQuestId.has(view.questId)
        ? (pinnedByQuestId.get(view.questId) !== null
          ? '   · PINNED ON THE CHART'
          : '   · NOT YET CHARTED')
        : '';
      const note = view.note ? `   · ${view.note}` : '';
      const detail = makeBodyText(this, panelX + 14, cursorY,
        `${view.stepDescription}   ${view.progress}/${view.target}${note}${pinned}`,
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
  private renderLeadsPanel(panelY: number): number {
    if (this.leads.length === 0) return panelY;

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
        [lead.fragment.text, lead.riddle, lead.sigils, lead.wall, lead.gap]
          .filter(Boolean).join('  '),
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
    return cursorY + 14;
  }

  /**
   * Doc 03 section 4.5 rule 4, answered world-wide: what the profile still cannot open, how
   * much each missing thing would open, and where to go and earn each one. Drawn under LEADS,
   * and absent entirely for a profile that is locked out of nothing.
   */
  private renderRoutesPanel(panelY: number): void {
    if (this.lockouts.length === 0) return;

    const panelX = 24;
    const panelWidth = Math.min(340, this.scale.width - 48);
    const textWidth = panelWidth - 28;

    makeBodyText(this, panelX + 14, panelY + 12, 'LOCKED OUT',
      { fontSize: 14, color: TEXT_COLORS.muted, align: 'left' })
      .setOrigin(0, 0).setDepth(4);

    let cursorY = panelY + 34;
    for (const row of this.lockouts.slice(0, MAX_LOCKOUT_ROWS)) {
      const heading = makeBodyText(this, panelX + 14, cursorY, row.name.toUpperCase(),
        { fontSize: 15, align: 'left', wordWrapWidth: textWidth })
        .setOrigin(0, 0).setDepth(4);
      cursorY += heading.height + 2;
      const detail = makeBodyText(this, panelX + 14, cursorY, describeLockoutRow(row),
        { fontSize: 12, color: TEXT_COLORS.muted, align: 'left', wordWrapWidth: textWidth })
        .setOrigin(0, 0).setDepth(4);
      cursorY += detail.height + 12;
    }
    if (this.lockouts.length > MAX_LOCKOUT_ROWS) {
      const more = makeBodyText(this, panelX + 14, cursorY,
        `+${this.lockouts.length - MAX_LOCKOUT_ROWS} MORE`,
        { fontSize: 12, color: TEXT_COLORS.muted, align: 'left' })
        .setOrigin(0, 0).setDepth(4);
      cursorY += more.height + 12;
    }

    this.add.rectangle(panelX, panelY, panelWidth, cursorY - panelY + 2, 0x0a1018, 0.9)
      .setOrigin(0, 0).setDepth(3).setStrokeStyle(1, 0x2b3a4d, 0.9);
  }

  /**
   * Generated from the two glyph tables so the legend cannot drift from what the renderer
   * draws. Rebuilt on every fold, which is cheap and is what keeps the two states identical.
   */
  private legendRows(): Array<{
    label: string;
    draw: (graphics: Phaser.GameObjects.Graphics, x: number, y: number) => void;
  }> {
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
    rows.push({
      label: 'Lead here',
      draw: (graphics, x, y) => drawLeadBadge(graphics, x, y, LEGEND_GLYPH_SIZE, false),
    });
    rows.push({
      label: 'Lead sealed',
      draw: (graphics, x, y) => drawLeadBadge(graphics, x, y, LEGEND_GLYPH_SIZE, true),
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
    rows.push({
      label: 'Objective moved',
      draw: (graphics, x, y) => {
        drawObjectivePin(graphics, x, y - LEGEND_GLYPH_SIZE, LEGEND_GLYPH_SIZE * 1.2);
        drawObjectiveUpdatedBadge(graphics, x, y - LEGEND_GLYPH_SIZE, LEGEND_GLYPH_SIZE * 1.2);
      },
    });
    rows.push({
      label: 'Sortie lands here',
      draw: (graphics, x, y) => drawSortieBadge(graphics, x, y, LEGEND_GLYPH_SIZE),
    });
    rows.push({
      label: 'Changed this run',
      draw: (graphics, x, y) => drawStirBadge(graphics, x, y, LEGEND_GLYPH_SIZE),
    });
    rows.push({
      label: 'Sealed shortcut',
      draw: (graphics, x, y) => drawGridBandBadge(graphics, x, y, LEGEND_GLYPH_SIZE),
    });
    rows.push({
      label: 'Region vault',
      draw: (graphics, x, y) => drawVaultChartBadge(graphics, x, y, LEGEND_GLYPH_SIZE),
    });
    for (const kind of SECTOR_MARK_CYCLE) {
      rows.push({
        label: `${SECTOR_MARKS[kind].label} (yours)`,
        draw: (graphics, x, y) => drawSectorMark(graphics, kind, x, y, LEGEND_GLYPH_SIZE),
      });
    }
    rows.push({
      label: 'Note (yours)',
      draw: (graphics, x, y) => {
        drawSectorMark(graphics, SECTOR_MARK_CYCLE[0], x, y, LEGEND_GLYPH_SIZE);
        drawSectorNoteDot(graphics, x, y, LEGEND_GLYPH_SIZE);
      },
    });

    return rows;
  }

  /**
   * The map's own glyph vocabulary, down the right-hand edge. Top-anchored and rebuilt on every
   * fold, so the header strip, which is also the toggle's hit target, never moves. Rows reflow
   * into columns rather than being dropped: the panel's whole value is that it lists everything
   * the renderer can draw.
   */
  private renderLegendPanel(): void {
    for (const object of this.legendObjects) object.destroy();
    this.legendObjects = [];

    const rows = this.legendRows();
    const panelY = HEADER_HEIGHT + 12;
    const bandHeight =
      this.scale.height - FOOTER_HEIGHT - DETAIL_BAR_HEIGHT - 24 - panelY;

    let panelWidth = LEGEND_COLUMN_WIDTH;
    let panelHeight = LEGEND_HEADER_HEIGHT;
    let perColumn = 0;
    if (!this.legendCollapsed) {
      const rowsPerColumn = Math.max(1, Math.floor(
        (bandHeight - LEGEND_HEADER_HEIGHT - LEGEND_BOTTOM_PAD) / LEGEND_ROW_HEIGHT));
      const columnsThatFit = Math.max(1,
        Math.floor((this.scale.width - 48) / LEGEND_COLUMN_WIDTH));
      const columns = Math.min(columnsThatFit, Math.ceil(rows.length / rowsPerColumn));
      perColumn = Math.ceil(rows.length / columns);
      panelWidth = columns * LEGEND_COLUMN_WIDTH;
      panelHeight = LEGEND_HEADER_HEIGHT + perColumn * LEGEND_ROW_HEIGHT + LEGEND_BOTTOM_PAD;
    }
    const panelX = this.scale.width - 24 - panelWidth;

    this.legendObjects.push(
      this.add.rectangle(panelX, panelY, panelWidth, panelHeight, 0x0a1018, 0.9)
        .setOrigin(0, 0).setDepth(3).setStrokeStyle(1, 0x2b3a4d, 0.9),
      makeBodyText(this, panelX + 14, panelY + 10,
        this.legendCollapsed ? 'LEGEND  [+]' : 'LEGEND  [-]',
        { fontSize: 14, color: TEXT_COLORS.muted, align: 'left' })
        .setOrigin(0, 0).setDepth(5),
    );
    this.legendBounds = new Phaser.Geom.Rectangle(panelX, panelY, panelWidth, panelHeight);
    this.legendHeaderBounds =
      new Phaser.Geom.Rectangle(panelX, panelY, panelWidth, LEGEND_HEADER_HEIGHT);
    if (this.legendCollapsed) return;

    const graphics = this.add.graphics();
    graphics.setDepth(4);
    this.legendObjects.push(graphics);
    rows.forEach((row, index) => {
      const columnX = panelX + Math.floor(index / perColumn) * LEGEND_COLUMN_WIDTH;
      const rowY = panelY + LEGEND_HEADER_HEIGHT + (index % perColumn) * LEGEND_ROW_HEIGHT;
      row.draw(graphics, columnX + 22, rowY + 8);
      this.legendObjects.push(
        makeBodyText(this, columnX + 40, rowY, row.label.toUpperCase(),
          { fontSize: 12, color: TEXT_COLORS.muted, align: 'left' })
          .setOrigin(0, 0).setDepth(5));
    });
  }

  private toggleLegend(): void {
    this.legendCollapsed = !this.legendCollapsed;
    getSettingsManager().setMapLegendCollapsed(this.legendCollapsed);
    this.renderLegendPanel();
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

  /**
   * The recall action. It lives in the footer rather than beside the chart because every
   * other edge of this screen is already spoken for: objectives and leads top-left, legend
   * right, detail bar along the bottom.
   */
  private createRecallButton(): void {
    const shipSector = sectorOfWorldPoint(this.playerWorldX, this.playerWorldY);
    if (this.recallState === 'ready' && sectorKey(shipSector) === this.mapData.startKey) {
      // The one button the hangar used to kill outright: standing home with a recall behind you,
      // it is the way back out.
      this.recallState = this.sortieAvailable ? 'sortie' : 'home';
    }
    const live = this.recallState === 'ready' || this.recallState === 'sortie';
    const label = this.recallState === 'locked' ? 'ROOM SEALED'
      : this.recallState === 'home' ? 'AT THE HANGAR'
      : this.recallState === 'sortie' ? 'SORTIE'
      : 'RECALL';

    this.recallButton = createMenuButton({
      scene: this,
      x: this.scale.width - 20 - RECALL_BUTTON_WIDTH / 2,
      y: this.scale.height - FOOTER_HEIGHT / 2,
      width: RECALL_BUTTON_WIDTH,
      height: RECALL_BUTTON_HEIGHT,
      label,
      variant: live ? 'primary' : 'neutral',
      onActivate: () => this.recall(),
    });
    this.recallButton.container.setDepth(6);
    this.recallButton.card.hitZone.on('pointerover', () =>
      this.recallButton?.setHoverState(true));
    this.recallButton.card.hitZone.on('pointerout', () =>
      this.recallButton?.setHoverState(false));
    if (!live) this.recallButton.setEnabled(false);
    this.refreshSortieLabel();
  }

  /** The between-runs action, in the slot RECALL holds during a run: same width, same position,
   *  same footer rhythm, because it is the same question one screen earlier ("go", from here). It
   *  is never disabled: a profile always has a current expedition world, which is the world the
   *  chart behind this button is drawn from. */
  private createLaunchButton(): void {
    this.launchButton = createMenuButton({
      scene: this,
      x: this.scale.width - 20 - RECALL_BUTTON_WIDTH / 2,
      y: this.scale.height - FOOTER_HEIGHT / 2,
      width: RECALL_BUTTON_WIDTH,
      height: RECALL_BUTTON_HEIGHT,
      label: 'LAUNCH',
      variant: 'primary',
      onActivate: () => this.launch(),
    });
    this.launchButton.container.setDepth(6);
    this.launchButton.card.hitZone.on('pointerover', () =>
      this.launchButton?.setHoverState(true));
    this.launchButton.card.hitZone.on('pointerout', () =>
      this.launchButton?.setHoverState(false));
    this.refreshSortieLabel();
  }

  /** The touch and mouse opener for the note field, left of the action button. Disabled rather than hidden
   *  while nothing is focused, so the footer never reflows and the affordance is legible before
   *  the player has tapped a sector: the label says what the chart can do, the state says what it
   *  can do right now. */
  private createNoteButton(): void {
    this.noteButton = createMenuButton({
      scene: this,
      x: this.scale.width - 20
        - (RECALL_BUTTON_WIDTH + FOOTER_BUTTON_GAP)
        - NOTE_BUTTON_WIDTH / 2,
      y: this.scale.height - FOOTER_HEIGHT / 2,
      width: NOTE_BUTTON_WIDTH,
      height: RECALL_BUTTON_HEIGHT,
      label: 'NOTE',
      variant: 'neutral',
      onActivate: () => this.editNote(),
    });
    this.noteButton.container.setDepth(6);
    this.noteButton.card.hitZone.on('pointerover', () => this.noteButton?.setHoverState(true));
    this.noteButton.card.hitZone.on('pointerout', () => this.noteButton?.setHoverState(false));
    this.noteButton.setEnabled(this.focusedCell !== null);
  }

  /** Resumes the run first, then starts the channel on the live scene: the channel is ticked
   *  from GameScene.update, which does not run while this scene holds the pause. One method for
   *  both directions, because one button, one key and one gamepad face fire it. */
  private recall(): void {
    if (this.closed) return;
    if (this.browsing) return;
    if (this.recallState !== 'ready' && this.recallState !== 'sortie') return;
    const isSortie = this.recallState === 'sortie';
    const destinationKey = this.sortieDestinationKey() ?? undefined;
    const gameScene = this.scene.get('GameScene') as GameScene | undefined;
    this.close();
    if (isSortie) gameScene?.beginExpeditionSortie(destinationKey);
    else gameScene?.beginExpeditionRecall();
  }

  /** Hands the launch to BootScene rather than starting the run here: BootScene owns the
   *  save-loss confirmation, the clear-save and the sweep into the funnel that every other
   *  launch in the game goes through, and a second entry point into that flow is exactly what
   *  this feature was held back on.
   *  The focused room rides along as the fresh run's sortie destination, and a launch with nothing
   *  legal focused deliberately writes null rather than leaving an older pick armed. */
  private launch(): void {
    if (this.closed) return;
    if (!this.browsing) return;
    const destination = this.sortieDestinationKey();
    setPlannedSortie(destination === null ? null : {
      worldSeed: this.mapData.seed,
      worldGenVersion: this.mapData.worldGenVersion,
      sectorKey: destination,
    });
    setPendingExpeditionLaunch();
    this.close({ launching: true });
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
      bloomedSectorKeys: this.bloomedSectorKeys,
      shiftedSectorKeys: this.shiftedSectorKeys,
      wardenName: wardenBossNameForWorld(this.mapData.seed, this.mapData.worldGenVersion),
    }) : null;

    const shipSectorKey = sectorKey(sectorOfWorldPoint(this.playerWorldX, this.playerWorldY));
    this.course = this.focusedCell ? plotSectorCourse({
      map: this.mapData,
      fromSectorKey: shipSectorKey,
      toSectorKey: `${this.focusedCell.gridX},${this.focusedCell.gridY}`,
      sectorFlagsOf: (key) => discovery.getSectorFlags(key),
      edgeFlagsOf: (edgeId) => discovery.getEdgeFlags(edgeId),
      holdsAbility: (abilityId) => this.ownedAbilityIds.has(abilityId),
      holdsQuestKey: (keyId) => this.earnedQuestKeyIds.has(keyId),
    }) : { kind: 'none' };

    if (!detail) {
      this.detailHeadlineText.setText('NO SECTOR SELECTED');
      this.detailDoorsText.setText(
        'HOVER OR TAP A CHARTED SECTOR, OR PUSH THE D-PAD, TO READ WHAT IT HOLDS');
      this.detailRewardsText.setText('');
      this.refreshSortieLabel();
      return;
    }
    const markKind = this.markedSectorKinds.get(detail.sectorKey);
    const note = this.sectorNotes.get(detail.sectorKey);
    const markClause = markKind
      ? `   ·   MARKED ${SECTOR_MARKS[markKind].label.toUpperCase()}`
        + (note ? `   ·   "${note}"` : '')
      : '';
    const courseClause = `   ·   ${describeSectorCourse(this.course).toUpperCase()}`;
    this.detailHeadlineText.setText(
      `${detail.headline.toUpperCase()}   ·   ${detail.place.toUpperCase()}`
      + `   ·   SECTOR ${detail.sectorKey}${courseClause}${markClause}`);
    this.detailDoorsText.setText(detail.doors.length > 0
      ? `DOORS   ${detail.doors.join('     ').toUpperCase()}`
      : 'DOORS   NONE CHARTED HERE YET');
    this.detailRewardsText.setText(detail.rewards.length > 0
      ? `HOLDS   ${detail.rewards.join('     ').toUpperCase()}`
      : 'HOLDS   NOTHING THE CHART KNOWS OF');
    this.refreshSortieLabel();
  }

  /**
   * The focused room becomes the SORTIE's destination whenever the chart says the ship could fly
   * there right now. `plotted` and nothing else: `blocked` is a door this profile cannot open and
   * jumping past it would skip an ability gate, `here` is the hangar the ship is already in, and
   * `none` is a room the chart cannot connect. The boss arena is refused for the reason the field
   * anchor refuses to record it, so the ship is never one press from a sealed fight.
   * Browse mode reaches the same three refusals for free: the survey's course is plotted from the
   * hangar, so the hangar itself answers `here` and an unreachable room answers `none` or
   * `blocked`.
   */
  private sortieDestinationKey(): string | null {
    // Two permits for one rule, because the two modes learn the same fact differently: in a run
    // the footer only reads SORTIE once an anchor exists, and between runs BootScene has already
    // asked the profile the same question. Neither mode may pick a destination without one.
    const permitted = this.browsing ? this.sortieAvailable : this.recallState === 'sortie';
    if (!permitted) return null;
    if (this.focusedCell === null) return null;
    if (this.course.kind !== 'plotted') return null;
    const key = `${this.focusedCell.gridX},${this.focusedCell.gridY}`;
    return key === this.mapData.bossArenaKey ? null : key;
  }

  /**
   * Where a sortie lands if it is fired right now, which is what the chart badges: the focused
   * room whenever sortieDestinationKey offers one, and the anchor already held otherwise. Routed
   * through that one method rather than re-deriving the permits, so the badge and the footer
   * button can never name two different rooms for one jump.
   */
  private sortieLandingKey(): string | null {
    if (this.sortieAnchorSectorKey === null) return null;
    return this.sortieDestinationKey() ?? this.sortieAnchorSectorKey;
  }

  private refreshSortieLabel(): void {
    const destination = this.sortieDestinationKey();
    if (this.browsing) {
      this.launchButton?.setLabel(
        destination === null ? 'LAUNCH' : `LAUNCH · ${destination}`);
      return;
    }
    if (this.recallButton === null || this.recallState !== 'sortie') return;
    this.recallButton.setLabel(destination === null ? 'SORTIE' : `SORTIE ${destination}`);
  }

  update(_time: number, delta: number): void {
    if (this.closed) return;
    if (this.noteOverlayTeardown) return;
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
      if (!this.noteKeyArmed && !pad.isDown(GAMEPAD_BUTTON_RT)) this.noteKeyArmed = true;
      if (pad.justPressed(GAMEPAD_BUTTON_RB)) this.stepZoom(1);
      if (this.zoomOutArmed && pad.justPressed(GAMEPAD_BUTTON_LB)) this.stepZoom(-1);
      if (pad.justPressed(GAMEPAD_BUTTON_Y)) this.centreOnShip();
      if (pad.justPressed(GAMEPAD_BUTTON_SELECT)) { this.toggleLegend(); return; }
      if (pad.justPressed(GAMEPAD_DPAD_UP)) this.moveCursor('up');
      if (pad.justPressed(GAMEPAD_DPAD_DOWN)) this.moveCursor('down');
      if (pad.justPressed(GAMEPAD_DPAD_LEFT)) this.moveCursor('left');
      if (pad.justPressed(GAMEPAD_DPAD_RIGHT)) this.moveCursor('right');
      if (pad.justPressed(GAMEPAD_BUTTON_A)) this.cycleMark();
      if (this.noteKeyArmed && pad.justPressed(GAMEPAD_BUTTON_RT)) {
        this.editNote();
        return;
      }
      if (pad.justPressed(GAMEPAD_BUTTON_X)) {
        if (this.browsing) this.launch();
        else this.recall();
        return;
      }
      if (pad.justPressed(GAMEPAD_BUTTON_B) || pad.justPressed(GAMEPAD_BUTTON_START)) {
        this.close();
        return;
      }
    }

    if (panX !== 0 || panY !== 0) {
      const speed = PAN_SPEED * this.view.scale * seconds;
      this.panBy(panX * speed, panY * speed);
    }
    if (this.revealPlan) {
      this.revealElapsedMs += delta;
      // Nulled the frame it finishes, and viewDirty is still raised, so the last draw of the
      // replay is the ordinary full-alpha chart rather than a cell frozen at 0.99.
      if (this.revealElapsedMs >= this.revealPlan.durationMs) this.revealPlan = null;
      this.viewDirty = true;
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
    if (this.legendBounds?.contains(pointer.x, pointer.y)) return;
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
    this.noteButton?.setEnabled(true);
  }

  /** One press walks none → come back → danger → unsolved → none on the focused sector. The
   *  write is refused rather than shown when the store could not keep it, so the chart never
   *  displays a mark a refresh would lose. */
  private cycleMark(): void {
    if (!this.focusedCell) return;
    const key = sectorKey({ col: this.focusedCell.gridX, row: this.focusedCell.gridY });
    const next = nextSectorMarkKind(this.markedSectorKinds.get(key) ?? null);
    if (!setSectorMark(this.mapData.seed, this.mapData.worldGenVersion, key, next)) return;
    if (next === null) {
      this.markedSectorKinds.delete(key);
      this.sectorNotes.delete(key);
    } else this.markedSectorKinds.set(key, next);
    this.refreshDetail();
    this.viewDirty = true;
  }

  /** The typed half of a mark. The field is DOM over the canvas (the CodeEntryOverlay idiom), so
   *  two things must stand down or the typing lands on the map instead of in the field: this
   *  scene's own keydown handler and gamepad block, gated on noteOverlayTeardown, and the WASD /
   *  cursor-key captures, which preventDefault those keys before any DOM input sees them. */
  private editNote(): void {
    if (!this.focusedCell || this.closed || this.noteOverlayTeardown) return;
    const key = sectorKey({ col: this.focusedCell.gridX, row: this.focusedCell.gridY });
    const existingKind = this.markedSectorKinds.get(key) ?? null;
    const keyboard = this.input.keyboard;
    keyboard?.clearCaptures();
    const finish = (): void => {
      this.noteOverlayTeardown = null;
      keyboard?.addCapture(MAP_KEY_CAPTURES);
      this.refreshDetail();
      this.viewDirty = true;
    };
    this.noteOverlayTeardown = showCodeEntryOverlay<string | null>({
      title: 'NOTE ON THIS SECTOR',
      body: `Sector ${key}. Up to ${MAX_SECTOR_NOTE_LENGTH} characters.`
        + ' Save an empty note to clear it.',
      placeholder: this.sectorNotes.get(key) ?? 'tether door here',
      submitLabel: 'SAVE NOTE',
      autocapitalize: 'off',
      decode: (typed) => ({ ok: true, value: sanitizeSectorNote(typed) }),
      onSubmit: (note) => {
        this.saveNote(key, existingKind, note);
        finish();
      },
      onClose: finish,
    });
  }

  /** A note needs a carrier on the chart, so writing one onto an unmarked sector places the first
   *  cycle kind; the store owns the other half, where removing a mark removes its note. Refused
   *  writes are not shown, on cycleMark's rule. */
  private saveNote(
    sector: string, existingKind: SectorMarkKind | null, note: string | null,
  ): void {
    if (note !== null && existingKind === null) {
      const carrier = SECTOR_MARK_CYCLE[0];
      if (!setSectorMark(this.mapData.seed, this.mapData.worldGenVersion, sector, carrier)) return;
      this.markedSectorKinds.set(sector, carrier);
    }
    if (!setSectorNote(this.mapData.seed, this.mapData.worldGenVersion, sector, note)) return;
    if (note === null) this.sectorNotes.delete(sector);
    else this.sectorNotes.set(sector, note);
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
    const course = this.course;
    this.mapRenderer.draw({
      map: this.mapData,
      view: this.view,
      panelWidth: this.scale.width,
      panelHeight: this.scale.height,
      sectorFlagsOf: (key) => discovery.getSectorFlags(key),
      edgeFlagsOf: (edgeId) => discovery.getEdgeFlags(edgeId),
      objectiveSectorKeys: this.objectiveSectorKeys,
      markedSectorKinds: this.markedSectorKinds,
      notedSectorKeys: new Set(this.sectorNotes.keys()),
      updatedObjectiveSectorKeys: this.updatedObjectiveSectorKeys,
      hintedSectorKeys: this.hintedSectorKeys,
      sealedLeadSectorKeys: this.sealedLeadSectorKeys,
      newlyPassableEdgeIds: this.newlyPassableEdgeIds,
      courseSectorKeys: course.kind === 'plotted' || course.kind === 'blocked'
        ? course.sectorKeys : [],
      courseBlocked: course.kind === 'blocked',
      sortieSectorKey: this.sortieLandingKey(),
      stirredSectorKeys: this.stirredSectorKeys,
      mapOpenReveal: this.revealPlan
        ? sampleMapOpenReveal(this.revealPlan, this.revealElapsedMs)
        : null,
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

  private close(options: { launching?: boolean } = {}): void {
    if (this.closed) return;
    this.closed = true;
    if (this.browsing) {
      // LAUNCH is the one browse exit that does NOT reopen GAME MODES: BootScene raises the
      // save-loss confirmation the moment it arrives, and stacking that dialog on a just-reopened
      // submenu overlay is an interaction neither surface has ever been asked to hold.
      if (options.launching) {
        transitionToScene(this, 'BootScene', { relayout: false });
        return;
      }
      // Back to the submenu that opened it rather than to the deck row: SURVEY is one of three
      // world tiles and a player comparing them should not have to reopen GAME MODES between each.
      transitionToScene(this, 'BootScene', { relayout: true, openSubmenu: 'GAME MODES' });
      return;
    }
    const gameScene = this.scene.get('GameScene') as GameScene | undefined;
    // Clears isPaused BEFORE the resume: GameScene's resume handler opens the pause menu
    // whenever it comes back still paused (the settings return flow).
    gameScene?.closeExpeditionMap?.();
    this.scene.resume('GameScene');
    this.scene.stop();
  }

  shutdown(): void {
    if (this.noteOverlayTeardown) {
      this.noteOverlayTeardown();
      this.noteOverlayTeardown = null;
      this.input.keyboard?.addCapture(MAP_KEY_CAPTURES);
    }
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
    this.recallButton?.destroy();
    this.recallButton = null;
    this.launchButton?.destroy();
    this.launchButton = null;
    this.noteButton?.destroy();
    this.noteButton = null;
    this.gamepadManager?.destroy();
    this.gamepadManager = null;
    this.legendObjects = [];
    this.legendBounds = null;
    this.legendHeaderBounds = null;
    this.tweens.killAll();
  }
}
