import Phaser from 'phaser';
import { SECTOR_HEIGHT, SECTOR_WIDTH } from '../../world/worldSpace';
import { PoiKind, TILE_SIZE } from '../../world/worldTypes';
import type { WorldMap } from '../../world/worldTypes';
import type { FieldPoiContact, FieldPoiManager } from './FieldPoiManager';

/** The quest-anchor cyan poiGlyphs.ts draws the board with; kept identical on purpose. */
const QUEST_BOARD_COLOR = 0x66ddff;
const QUEST_BOARD_OPEN_RADIUS = 48;
/** Wider than the open radius: the ship has to actually leave the board before it re-opens. */
const QUEST_BOARD_REARM_RADIUS = 110;

interface ActiveQuestBoard {
  poiId: string;
  graphics: Phaser.GameObjects.Graphics;
  x: number;
  y: number;
  engaged: boolean;
}

export interface QuestBoardDeps {
  gameTime(): number;
  /** Opens the objective board over a paused run. Stays in the scene: it owns `isPaused`, the
   *  overlay latch a second reader also tests, and the deferred orientation relayout. */
  openBoard(): void;
}

/**
 * Walk-in quest boards for the sector the ship is in, the AbilityVaultManager shape. The board is
 * the QuestGiver slot's consumer; it holds no per-profile state of its own, so nothing about it
 * reaches the run save. `engaged` is the re-open latch: a board is never consumed, so without it
 * the ship would still be inside the open radius the frame the overlay closes.
 */
export class QuestBoardManager implements FieldPoiManager {
  private boards: ActiveQuestBoard[] = [];
  private sectorKey: string | null = null;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly deps: QuestBoardDeps,
  ) {}

  /** Live radar contacts. The array is the manager's own — read it, never mutate it. */
  contacts(): ReadonlyArray<FieldPoiContact> {
    return this.boards;
  }

  /** One board per QuestGiver slot: that is the vault's own precedent, so the chart's glyph and
   *  the world's object agree slot for slot. */
  sync(map: WorldMap, playerX: number, playerY: number): void {
    const key = `${Math.floor(playerX / SECTOR_WIDTH)},${Math.floor(playerY / SECTOR_HEIGHT)}`;
    if (key === this.sectorKey) return;
    this.sectorKey = key;
    this.destroyBoards();

    const sector = map.sectors.get(key);
    if (!sector) return;
    for (const slot of sector.poiSlots) {
      if (slot.kind !== PoiKind.QuestGiver) continue;
      this.addBoard(
        slot.id,
        sector.sx * SECTOR_WIDTH + slot.tileX * TILE_SIZE + TILE_SIZE / 2,
        sector.sy * SECTOR_HEIGHT + slot.tileY * TILE_SIZE + TILE_SIZE / 2,
      );
    }
  }

  /** Pulse and walk-in test, the AbilityVaultManager shape. A board is never consumed, so it
   *  latches instead of splicing: it re-arms only once the ship has left the re-arm radius. */
  update(playerX: number, playerY: number): void {
    if (this.boards.length === 0) return;
    const pulse = 1 + Math.sin(this.deps.gameTime() * 1.8) * 0.06;
    for (const board of this.boards) {
      board.graphics.setScale(pulse);
      const dx = playerX - board.x;
      const dy = playerY - board.y;
      const distanceSq = dx * dx + dy * dy;
      if (board.engaged) {
        if (distanceSq > QUEST_BOARD_REARM_RADIUS * QUEST_BOARD_REARM_RADIUS) board.engaged = false;
        continue;
      }
      if (distanceSq < QUEST_BOARD_OPEN_RADIUS * QUEST_BOARD_OPEN_RADIUS) {
        board.engaged = true;
        this.deps.openBoard();
        return;
      }
    }
  }

  clear(): void {
    this.destroyBoards();
    this.sectorKey = null;
  }

  private addBoard(poiId: string, x: number, y: number): void {
    const graphics = this.scene.add.graphics();
    graphics.setPosition(x, y);
    graphics.setDepth(4);
    drawQuestBoard(graphics);
    this.boards.push({ poiId, graphics, x, y, engaged: false });
  }

  private destroyBoards(): void {
    for (const board of this.boards) board.graphics.destroy();
    this.boards = [];
  }
}

/** A standing notice board in the quest-anchor cyan the chart glyph and the map legend use, so
 *  the room and the chart name the same thing. */
function drawQuestBoard(graphics: Phaser.GameObjects.Graphics): void {
  const color = QUEST_BOARD_COLOR;
  graphics.clear();
  graphics.fillStyle(color, 0.15);
  graphics.fillCircle(0, 0, 28);
  graphics.lineStyle(3, color, 0.95);
  graphics.strokeRect(-20, -24, 40, 30);
  graphics.lineBetween(-11, 6, -11, 22);
  graphics.lineBetween(11, 6, 11, 22);
  graphics.fillStyle(color, 0.85);
  graphics.fillRect(-13, -17, 26, 4);
  graphics.fillRect(-13, -9, 17, 4);
}
