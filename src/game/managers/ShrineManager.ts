import Phaser from 'phaser';
import type { ToastConfig } from '../../achievements/AchievementTypes';
import { pickInteriorPoint } from '../../world/spawnRing';
import type { WorldRect } from '../../world/worldSpace';

// Field shrine archetypes — walk-in altars that auto-trigger on touch. Distinct
// from the random "Shrine of Sacrifice" event: these are placed objects the
// player chooses to seek out, each a small risk/reward or boon.
export type ShrineType = 'cleanse' | 'power' | 'fortune' | 'sacrifice' | 'market';

export const SHRINE_DEFS: { type: ShrineType; color: number; label: string }[] = [
  { type: 'cleanse', color: 0x66ff99, label: 'Font of Cleansing' },
  { type: 'power', color: 0xff8833, label: 'Altar of Power' },
  { type: 'fortune', color: 0xffd24a, label: 'Shrine of Fortune' },
  { type: 'sacrifice', color: 0xff4466, label: 'Blood Altar' },
  { type: 'market', color: 0x39e6d8, label: 'The Black Market' },
];

const SHRINE_INTERVAL = 38;
const MAX_SHRINES = 2;
/** The fresh-run timer, shorter than the steady interval so the first altar lands early. */
const SHRINE_FIRST_INTERVAL = 25;
const SHRINE_TOUCH_RADIUS = 36;
/** A timed spawn re-rolls its point while it lands nearer than this to the ship. */
const SHRINE_PLAYER_CLEARANCE = 160;
const SHRINE_SPAWN_ATTEMPTS = 5;
const SHRINE_VIEW_PADDING = 90;

interface ActiveShrine {
  type: ShrineType;
  graphics: Phaser.GameObjects.Graphics;
  x: number;
  y: number;
}

/** The `shrineState` run-save block. Shape-frozen: existing saves must keep loading. */
export interface ShrineSaveState {
  shrines: { type: string; x: number; y: number }[];
  spawnTimer: number;
}

export interface ShrineDeps {
  gameTime(): number;
  /** The active world mode's live view rect: where a timed spawn may land. */
  viewRect(): WorldRect;
  /** PRACTICE is a sandbox with no run payout, so selling real banked gold there would be a
   *  pure trap: it drops the market from the spawn pool. */
  practiceMode(): boolean;
  showToast(config: ToastConfig): void;
  /** Applies the altar's effect on touch. Stays in the scene: it spends healPlayer,
   *  applyTimedStatBuff, grantRelicChoice, spawnRandomConsumable, openMarket, the ECS Health
   *  component and syncStatsToPlayer, so moving it would pull a dozen scene systems in here. */
  trigger(type: ShrineType, x: number, y: number): void;
}

/**
 * Field shrines: the walk-in altars. Mode-agnostic (an arena run spawns them too) and paced by a
 * timer into the view rect rather than keyed to a sector, which is why this is a plain manager and
 * not a FieldPoiManager. Expedition additionally places them at POI slots through the public
 * `addShrine`, and they are the one field object carrying run-save state.
 */
export class ShrineManager {
  private shrines: ActiveShrine[] = [];
  private spawnTimer = SHRINE_FIRST_INTERVAL;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly deps: ShrineDeps,
  ) {}

  /** Per-frame update: paces spawning and auto-triggers a shrine when the player walks into it.
   *  The scene calls this only while a player entity exists, which is what the old playerId
   *  guard at the top of updateShrines meant. */
  update(deltaSeconds: number, playerX: number, playerY: number): void {
    if (this.shrines.length < MAX_SHRINES) {
      this.spawnTimer -= deltaSeconds;
      if (this.spawnTimer <= 0) {
        this.spawnShrine(playerX, playerY);
        this.spawnTimer = SHRINE_INTERVAL;
      }
    }

    if (this.shrines.length === 0) return;
    const pulse = 1 + Math.sin(this.deps.gameTime() * 3) * 0.12;

    for (let i = this.shrines.length - 1; i >= 0; i--) {
      const shrine = this.shrines[i];
      shrine.graphics.setScale(pulse);
      const dx = playerX - shrine.x;
      const dy = playerY - shrine.y;
      if (dx * dx + dy * dy < SHRINE_TOUCH_RADIUS * SHRINE_TOUCH_RADIUS) {
        this.deps.trigger(shrine.type, shrine.x, shrine.y);
        shrine.graphics.destroy();
        this.shrines.splice(i, 1);
      }
    }
  }

  /**
   * Creates the shrine graphics at a fixed position and registers it. Public because three paths
   * place altars: the timed spawner, the run-save restore, and expedition's POI slots
   * (`spawnPoiContent`), the last of which is why it must stay reachable from the scene.
   */
  addShrine(type: ShrineType, x: number, y: number): void {
    const def = SHRINE_DEFS.find(d => d.type === type)!;
    const graphics = this.scene.add.graphics();
    graphics.setPosition(x, y);
    drawShrine(graphics, def.color);
    graphics.setDepth(4);
    this.shrines.push({ type, graphics, x, y });
  }

  /**
   * Whether an altar is still standing at exactly this point. Exact equality is the identity
   * here: a shrine never moves, and a restored altar is re-added from the same coordinates
   * `serialize()` wrote, so the live and the saved doubles are the same value.
   */
  hasShrineAt(x: number, y: number): boolean {
    return this.shrines.some(shrine => shrine.x === x && shrine.y === y);
  }

  /**
   * Removes an untouched altar WITHOUT triggering it: the expedition's POI retire pass hands a
   * departed room's altar back to the generator. Deliberately does not touch `spawnTimer`, so
   * the timed spawner resumes from where the cap froze it rather than paying an extra altar.
   */
  removeShrineAt(x: number, y: number): boolean {
    const index = this.shrines.findIndex(shrine => shrine.x === x && shrine.y === y);
    if (index === -1) return false;
    this.shrines[index].graphics.destroy();
    this.shrines.splice(index, 1);
    return true;
  }

  clear(): void {
    for (const shrine of this.shrines) shrine.graphics.destroy();
    this.shrines = [];
    this.spawnTimer = SHRINE_FIRST_INTERVAL;
  }

  serialize(): ShrineSaveState {
    return {
      shrines: this.shrines.map(shrine => ({ type: shrine.type, x: shrine.x, y: shrine.y })),
      spawnTimer: this.spawnTimer,
    };
  }

  /** Re-draws the saved altars at their positions so a mid-run refresh neither despawns them nor
   *  restarts the spawn clock. The type is validated against SHRINE_DEFS to guard against a
   *  corrupted save. The caller has already run `clear()`, so this only adds. */
  restore(state: ShrineSaveState): void {
    for (const saved of state.shrines) {
      if (SHRINE_DEFS.some(def => def.type === saved.type)) {
        this.addShrine(saved.type as ShrineType, saved.x, saved.y);
      }
    }
    this.spawnTimer = state.spawnTimer;
  }

  /** Spawns a random shrine within the play area, away from the player. */
  private spawnShrine(playerX: number, playerY: number): void {
    const pool = this.deps.practiceMode()
      ? SHRINE_DEFS.filter(def => def.type !== 'market')
      : SHRINE_DEFS;
    const def = pool[Math.floor(Math.random() * pool.length)];
    let x = 0;
    let y = 0;
    // A few attempts to land clear of the player.
    for (let attempt = 0; attempt < SHRINE_SPAWN_ATTEMPTS; attempt++) {
      ({ x, y } = pickInteriorPoint(this.deps.viewRect(), SHRINE_VIEW_PADDING, Math.random));
      const dx = x - playerX;
      const dy = y - playerY;
      if (dx * dx + dy * dy > SHRINE_PLAYER_CLEARANCE * SHRINE_PLAYER_CLEARANCE) break;
    }

    this.addShrine(def.type, x, y);

    this.deps.showToast({
      tier: 'ambient',
      title: def.label,
      description: 'A shrine has appeared — walk into it.',
      icon: 'star',
      color: def.color,
      duration: 2600,
    });
  }
}

/** Draws a glowing diamond altar with an inner glyph. */
function drawShrine(graphics: Phaser.GameObjects.Graphics, color: number): void {
  graphics.fillStyle(color, 0.15);
  graphics.fillCircle(0, 0, 26);
  graphics.lineStyle(3, color, 0.95);
  const diamond = [
    new Phaser.Geom.Point(0, -22),
    new Phaser.Geom.Point(16, 0),
    new Phaser.Geom.Point(0, 22),
    new Phaser.Geom.Point(-16, 0),
  ];
  graphics.strokePoints(diamond, true);
  graphics.fillStyle(color, 0.85);
  graphics.fillCircle(0, 0, 6);
}
