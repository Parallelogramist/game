import { BaseWeapon, WeaponContext, WeaponStats } from './BaseWeapon';
import { Transform, Health } from '../ecs/components';
import { DepthLayers } from '../visual/DepthLayers';
import { VisualQuality } from '../visual/GlowGraphics';

const STREAK_POOL_SIZE = 32;
const SPREAD_RAD = 0.9;          // total fan angle of the pellet spread (~52°)
const ANGLE_JITTER = 0.05;       // small per-pellet random angular wobble for feel
const PELLET_HALF_WIDTH = 14;    // px perpendicular reach of each pellet ray (× size)
const KNOCKBACK = 45;
const POINT_BLANK_RANGE = 90;    // mastery: hits closer than this are amplified
const POINT_BLANK_MULT = 1.6;    // mastery (Point Blank) close-range damage bonus
const FLASH_SECONDS = 0.14;      // how long a pellet streak + muzzle flash is drawn
const NEON = 0xffcf7a;           // warm muzzle-gold (distinct from cyan/blue peers)
const EVOLVED_NEON = 0xffe6c2;

interface Streak {
  sx: number; sy: number;   // muzzle end (ship)
  ex: number; ey: number;   // pellet far end
  age: number;              // seconds since spawn
  active: boolean;
}

/**
 * ScattergunWeapon ("Scattergun") — the arsenal's only *directional spread burst*.
 * Each cooldown it aims at the nearest live enemy and fires a tight fan of instant
 * hitscan pellet-rays across a spread arc: a short-reach, wide-cone crowd shredder
 * that overlaps a single enemy at point-blank and melts it, but falls off with
 * distance. Unlike ProjectileWeapon (one auto-aim long shot), ShurikenWeapon (a
 * spiral in every direction) or FlamethrowerWeapon (a continuous DoT cone), it fires
 * a discrete pellet fan and applies damage instantly in attack(); the pooled Streak
 * objects are purely the visual, redrawn each frame into one shared Graphics (the
 * self-drawing pattern of the recent weapons, so no projectile-atlas frame is
 * required). The per-pellet line hit-test mirrors Railgun's and stays inline — no
 * separate pure module or unit test.
 *
 * Mastery ("Point Blank"): enemies struck within POINT_BLANK_RANGE take extra damage.
 * Evolution ("Devastator", via multishot): more, harder pellets over a longer, wider cone.
 */
export class ScattergunWeapon extends BaseWeapon {
  private streaks: Streak[] = [];
  private streakGraphics: Phaser.GameObjects.Graphics | null = null;
  private muzzleX = 0;
  private muzzleY = 0;
  private muzzleAge = FLASH_SECONDS;   // >= FLASH_SECONDS ⇒ no muzzle flash drawn yet
  private currentQuality: VisualQuality = 'high';
  private poolInitialized = false;

  constructor() {
    const baseStats: WeaponStats = {
      damage: 9,
      cooldown: 1.2,
      range: 240,    // pellet ray LENGTH (px) — scaled by the universal Range stat
      count: 5,      // pellets per shot (+1 every 2 weapon levels -> 9 at Lv10)
      piercing: 0,   // extra enemies each pellet skewers beyond the first (+1 every 2 levels)
      size: 1,       // scales pellet half-width + streak thickness
      speed: 0,      // unused — pellets are instant (scalesProjectileSpeed stays false)
      duration: 0,   // unused — flash lifetime is the fixed FLASH_SECONDS const
    };

    super(
      'scatter',
      'Scattergun',
      'scatter',
      'Fires a point-blank fan of pellets that shreds the cluster in front of you',
      10,
      baseStats,
      'Point Blank',
      'Enemies struck at close range take extra damage'
    );

    // Fire the first volley ~0.4s in rather than leaving a Scattergun starting
    // weapon idle for a full cooldown (mirrors Storm/Railgun).
    this.lastFired = -(baseStats.cooldown - 0.4);
  }

  private initPool(scene: Phaser.Scene): void {
    if (this.poolInitialized) return;
    this.poolInitialized = true;

    this.streakGraphics = scene.add.graphics();
    this.streakGraphics.setDepth(DepthLayers.METEOR);

    for (let i = 0; i < STREAK_POOL_SIZE; i++) {
      this.streaks.push({ sx: 0, sy: 0, ex: 0, ey: 0, age: 0, active: false });
    }
  }

  protected attack(ctx: WeaponContext): void {
    this.initPool(ctx.scene);

    const enemies = ctx.getEnemies();
    if (enemies.length === 0) return;

    const shipX = ctx.playerX;
    const shipY = ctx.playerY;

    // Aim at the nearest live enemy.
    let nearestId = -1;
    let bestDistSq = Infinity;
    for (const enemyId of enemies) {
      if (Health.current[enemyId] <= 0) continue;
      const dx = Transform.x[enemyId] - shipX;
      const dy = Transform.y[enemyId] - shipY;
      const distSq = dx * dx + dy * dy;
      if (distSq < bestDistSq) {
        bestDistSq = distSq;
        nearestId = enemyId;
      }
    }
    if (nearestId < 0) return;

    const aimAngle = Math.atan2(Transform.y[nearestId] - shipY, Transform.x[nearestId] - shipX);
    const pelletCount = Math.max(1, this.stats.count);
    const pelletLength = this.stats.range;
    const halfWidth = PELLET_HALF_WIDTH * this.stats.size;
    const maxHitsPerPellet = 1 + this.stats.piercing;
    const mastered = this.isMastered();

    let anyHit = false;
    let sparkX = 0;
    let sparkY = 0;

    for (let p = 0; p < pelletCount; p++) {
      const spread = pelletCount === 1 ? 0.5 : p / (pelletCount - 1);
      const jitter = (Math.random() - 0.5) * 2 * ANGLE_JITTER;
      const angle = aimAngle - SPREAD_RAD / 2 + SPREAD_RAD * spread + jitter;
      const dirX = Math.cos(angle);
      const dirY = Math.sin(angle);
      const endX = shipX + dirX * pelletLength;
      const endY = shipY + dirY * pelletLength;

      // Enemies along this pellet ray, ordered by distance from the ship.
      const hits: { id: number; projection: number }[] = [];
      for (const enemyId of enemies) {
        if (Health.current[enemyId] <= 0) continue;
        const offsetX = Transform.x[enemyId] - shipX;
        const offsetY = Transform.y[enemyId] - shipY;
        const projection = offsetX * dirX + offsetY * dirY;
        if (projection < 0 || projection > pelletLength) continue;
        const perpX = offsetX - projection * dirX;
        const perpY = offsetY - projection * dirY;
        if (perpX * perpX + perpY * perpY > halfWidth * halfWidth) continue;
        hits.push({ id: enemyId, projection });
      }
      hits.sort((a, b) => a.projection - b.projection);

      const hitCount = Math.min(maxHitsPerPellet, hits.length);
      for (let h = 0; h < hitCount; h++) {
        const closeUp = mastered && hits[h].projection < POINT_BLANK_RANGE;
        ctx.damageEnemy(hits[h].id, this.stats.damage * (closeUp ? POINT_BLANK_MULT : 1), KNOCKBACK);
        if (!anyHit) {
          anyHit = true;
          sparkX = Transform.x[hits[h].id];
          sparkY = Transform.y[hits[h].id];
        }
      }

      this.spawnStreak(shipX, shipY, endX, endY);
    }

    this.muzzleX = shipX;
    this.muzzleY = shipY;
    this.muzzleAge = 0;

    if (anyHit) ctx.effectsManager.playHitSparks(sparkX, sparkY, aimAngle);
    ctx.soundManager.playHit();
  }

  private spawnStreak(sx: number, sy: number, ex: number, ey: number): void {
    const streak = this.acquireStreak();
    streak.sx = sx; streak.sy = sy;
    streak.ex = ex; streak.ey = ey;
    streak.age = 0;
    streak.active = true;
  }

  /** First inactive streak, else recycle the oldest (largest age). */
  private acquireStreak(): Streak {
    for (const streak of this.streaks) {
      if (!streak.active) return streak;
    }
    let oldest = this.streaks[0];
    for (const streak of this.streaks) {
      if (streak.age > oldest.age) oldest = streak;
    }
    return oldest;
  }

  protected updateEffects(ctx: WeaponContext): void {
    this.initPool(ctx.scene);
    this.currentQuality = ctx.visualQuality;

    const gfx = this.streakGraphics;
    if (!gfx) return;
    gfx.clear();

    const evolved = this.isEvolved;
    const color = evolved ? EVOLVED_NEON : NEON;

    if (this.muzzleAge < FLASH_SECONDS) {
      this.muzzleAge += ctx.deltaTime;
      const fade = Math.max(0, 1 - this.muzzleAge / FLASH_SECONDS);
      const radius = (evolved ? 20 : 15) * this.stats.size * (0.6 + 0.4 * fade);
      gfx.fillStyle(color, 0.4 * fade);
      gfx.fillCircle(this.muzzleX, this.muzzleY, radius);
      gfx.fillStyle(0xffffff, 0.5 * fade);
      gfx.fillCircle(this.muzzleX, this.muzzleY, radius * 0.4);
    }

    for (const streak of this.streaks) {
      if (!streak.active) continue;
      streak.age += ctx.deltaTime;
      if (streak.age >= FLASH_SECONDS) {
        streak.active = false;
        continue;
      }
      this.drawStreak(gfx, streak, color, evolved);
    }
  }

  private drawStreak(
    gfx: Phaser.GameObjects.Graphics,
    streak: Streak,
    color: number,
    evolved: boolean
  ): void {
    const fade = 1 - streak.age / FLASH_SECONDS;
    const alpha = 0.2 + 0.7 * fade;
    const width = (evolved ? 3 : 2) * this.stats.size;

    gfx.lineStyle(width, color, alpha);
    gfx.beginPath();
    gfx.moveTo(streak.sx, streak.sy);
    gfx.lineTo(streak.ex, streak.ey);
    gfx.strokePath();

    if (this.currentQuality !== 'low') {
      gfx.fillStyle(0xffffff, alpha * 0.7);
      gfx.fillCircle(streak.ex, streak.ey, width * 0.9);
    }
  }

  public destroy(): void {
    if (this.streakGraphics) {
      this.streakGraphics.destroy();
      this.streakGraphics = null;
    }
    this.streaks = [];
    this.poolInitialized = false;
    super.destroy();
  }
}
