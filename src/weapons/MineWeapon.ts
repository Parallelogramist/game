import { BaseWeapon, WeaponContext, WeaponStats } from './BaseWeapon';
import { Transform } from '../ecs/components';
import { getEnemySpatialHash } from '../utils/SpatialHash';
import { DepthLayers } from '../visual/DepthLayers';
import { VisualQuality } from '../visual/GlowGraphics';

const MINE_POOL_SIZE = 24;             // max concurrent mines on the field
const ARM_DELAY = 0.35;                // seconds before a placed mine can trigger
const DETONATION_FLASH_SECONDS = 0.22; // post-blast visual flash lifetime
const TRIGGER_RADIUS = 46;             // px proximity trigger (× size)
const SCATTER_RADIUS = 34;             // px random scatter around the player for extra mines (× size)
const KNOCKBACK = 130;
const EVOLVED_KNOCKBACK = 200;
const NEON = 0xffb037;                 // amber warning
const EVOLVED_NEON = 0xff5a3c;         // hot cluster orange-red

interface Mine {
  x: number;
  y: number;
  age: number;                // seconds since placement
  armed: boolean;
  blastRadius: number;        // AOE radius captured at placement (scales with Reach)
  triggerRadius: number;      // proximity trigger distance
  damage: number;
  knockback: number;
  lifetime: number;           // auto-detonates once age reaches this
  detonating: boolean;        // playing the post-blast flash
  detonateTimer: number;
  active: boolean;
}

/**
 * MineWeapon ("Proximity Mines") — the arsenal's only *trap*. Every other weapon
 * fires from, orbits, deploys a shooter at, or emits from the player; a mine is
 * placed and left to wait. Each cooldown seeds a set of mines at and around the
 * ship; a mine arms after a short delay, then detonates in an AOE burst the moment
 * an enemy strays into its trigger radius (or auto-detonates at end of life),
 * hitting every enemy in the blast once. This rewards area denial the rest of the
 * arsenal lacks: salt a chokepoint, then kite the horde back across it.
 *
 * Placement, trigger, blast and the visual are all owned here and drawn into a
 * single shared Graphics (the self-drawing pattern of the other recent weapons,
 * so no projectile-atlas frame is required). The math is trivial and stays inline.
 *
 * Mastery ("Minefield"): every deployment lays one extra mine (mirrors Sentry's
 * two-turret mastery — faster field coverage).
 * Evolution ("Cluster Mines", via Might): bigger, harder, wider saturation blasts.
 */
export class MineWeapon extends BaseWeapon {
  // `duration` is the mine's on-field lifetime — longer is better.
  protected scalesEffectDuration = true;

  private mines: Mine[] = [];
  private mineGraphics: Phaser.GameObjects.Graphics | null = null;
  private currentQuality: VisualQuality = 'high';
  private poolInitialized = false;

  constructor() {
    const baseStats: WeaponStats = {
      damage: 30,
      cooldown: 2.8,
      range: 88,     // blast radius (px) — scaled by the universal Reach stat
      count: 1,      // mines placed per deployment (+1 every 2 weapon levels via base formula)
      piercing: 0,   // unused — a detonation hits every enemy in the blast, once
      size: 1,       // scales mine body, trigger radius, blast line thickness
      speed: 0,      // unused — mines are stationary
      duration: 8,   // mine lifetime seconds before it auto-detonates
    };

    super(
      'mine',
      'Proximity Mines',
      'mine',
      'Seeds proximity mines that arm, then blast enemies that stray too close',
      10,
      baseStats,
      'Minefield',
      'Every deployment lays an extra mine'
    );

    // The deploy cadence is slow, so fire the first placement ~0.5s in rather than
    // leaving a Mine starting weapon idle for a full 2.8s (mirrors Pulse/Sentry).
    this.lastFired = -(baseStats.cooldown - 0.5);
  }

  private initPool(scene: Phaser.Scene): void {
    if (this.poolInitialized) return;
    this.poolInitialized = true;

    this.mineGraphics = scene.add.graphics();
    this.mineGraphics.setDepth(DepthLayers.GROUND_EFFECTS);

    for (let i = 0; i < MINE_POOL_SIZE; i++) {
      this.mines.push({
        x: 0, y: 0, age: 0, armed: false,
        blastRadius: 0, triggerRadius: 0, damage: 0, knockback: 0,
        lifetime: 0, detonating: false, detonateTimer: 0, active: false,
      });
    }
  }

  protected attack(ctx: WeaponContext): void {
    this.initPool(ctx.scene);

    const mineCount = this.stats.count + (this.isMastered() ? 1 : 0);
    const scatter = SCATTER_RADIUS * this.stats.size;
    const knockback = this.isEvolved ? EVOLVED_KNOCKBACK : KNOCKBACK;

    for (let i = 0; i < mineCount; i++) {
      const mine = this.acquireMine();
      if (i === 0) {
        mine.x = ctx.playerX;
        mine.y = ctx.playerY;
      } else {
        const angle = Math.random() * Math.PI * 2;
        const dist = scatter * (0.4 + 0.6 * Math.random());
        mine.x = ctx.playerX + Math.cos(angle) * dist;
        mine.y = ctx.playerY + Math.sin(angle) * dist;
      }
      mine.age = 0;
      mine.armed = false;
      mine.blastRadius = this.stats.range;
      mine.triggerRadius = TRIGGER_RADIUS * this.stats.size;
      mine.damage = this.stats.damage;
      mine.knockback = knockback;
      mine.lifetime = this.stats.duration;
      mine.detonating = false;
      mine.detonateTimer = 0;
      mine.active = true;
    }

    ctx.soundManager.playHit();
  }

  /** First inactive mine, else recycle the oldest active one (largest age). */
  private acquireMine(): Mine {
    for (const mine of this.mines) {
      if (!mine.active) return mine;
    }
    let oldest = this.mines[0];
    for (const mine of this.mines) {
      if (mine.age > oldest.age) oldest = mine;
    }
    return oldest;
  }

  protected updateEffects(ctx: WeaponContext): void {
    this.initPool(ctx.scene);
    this.currentQuality = ctx.visualQuality;

    const gfx = this.mineGraphics;
    if (gfx) gfx.clear();

    const spatialHash = getEnemySpatialHash();
    const evolved = this.isEvolved;
    const color = evolved ? EVOLVED_NEON : NEON;

    for (const mine of this.mines) {
      if (!mine.active) continue;

      if (mine.detonating) {
        mine.detonateTimer += ctx.deltaTime;
        if (mine.detonateTimer >= DETONATION_FLASH_SECONDS) {
          mine.active = false;
          continue;
        }
        if (gfx) this.drawDetonation(gfx, mine, color);
        continue;
      }

      mine.age += ctx.deltaTime;
      if (!mine.armed && mine.age >= ARM_DELAY) mine.armed = true;

      let shouldDetonate = false;
      if (mine.armed) {
        if (mine.age >= mine.lifetime) {
          shouldDetonate = true;
        } else {
          const triggerSq = mine.triggerRadius * mine.triggerRadius;
          const nearby = spatialHash.queryPotential(mine.x, mine.y, mine.triggerRadius + 6);
          for (const enemy of nearby) {
            const dx = Transform.x[enemy.id] - mine.x;
            const dy = Transform.y[enemy.id] - mine.y;
            if (dx * dx + dy * dy <= triggerSq) { shouldDetonate = true; break; }
          }
        }
      }

      if (shouldDetonate) {
        this.detonate(ctx, mine, spatialHash);
        if (gfx) this.drawDetonation(gfx, mine, color);
        continue;
      }

      if (gfx) this.drawMine(gfx, mine, color, evolved);
    }
  }

  private detonate(
    ctx: WeaponContext,
    mine: Mine,
    spatialHash: ReturnType<typeof getEnemySpatialHash>
  ): void {
    const blastSq = mine.blastRadius * mine.blastRadius;
    const nearby = spatialHash.queryPotential(mine.x, mine.y, mine.blastRadius + 6);
    for (const enemy of nearby) {
      const dx = Transform.x[enemy.id] - mine.x;
      const dy = Transform.y[enemy.id] - mine.y;
      if (dx * dx + dy * dy > blastSq) continue;
      ctx.damageEnemy(enemy.id, mine.damage, mine.knockback);
      ctx.effectsManager.playHitSparks(Transform.x[enemy.id], Transform.y[enemy.id], Math.atan2(dy, dx));
    }
    mine.detonating = true;
    mine.detonateTimer = 0;
    ctx.soundManager.playHit();
  }

  private strokeDiamond(gfx: Phaser.GameObjects.Graphics, x: number, y: number, r: number): void {
    gfx.beginPath();
    gfx.moveTo(x, y - r);
    gfx.lineTo(x + r, y);
    gfx.lineTo(x, y + r);
    gfx.lineTo(x - r, y);
    gfx.closePath();
    gfx.strokePath();
  }

  private drawMine(gfx: Phaser.GameObjects.Graphics, mine: Mine, color: number, evolved: boolean): void {
    const size = (evolved ? 9 : 8) * this.stats.size;

    if (!mine.armed) {
      const armT = mine.age / ARM_DELAY;
      gfx.lineStyle(1.5, color, 0.3);
      this.strokeDiamond(gfx, mine.x, mine.y, size);
      gfx.lineStyle(1.5, color, 0.35 * (1 - armT));
      gfx.strokeCircle(mine.x, mine.y, size + (1 - armT) * 16);
      return;
    }

    const remaining = Math.max(0, 1 - mine.age / mine.lifetime);
    const blinkSpeed = 5 + (1 - remaining) * 16;   // blink quickens toward expiry
    const pulse = 0.5 + 0.5 * Math.sin(mine.age * blinkSpeed);

    gfx.lineStyle(2, color, 0.75);
    this.strokeDiamond(gfx, mine.x, mine.y, size);

    gfx.fillStyle(color, 0.35 + 0.55 * pulse);
    gfx.fillCircle(mine.x, mine.y, 2.6);

    if (this.currentQuality !== 'low') {
      gfx.lineStyle(1, color, 0.08);
      gfx.strokeCircle(mine.x, mine.y, mine.triggerRadius);
    }
  }

  private drawDetonation(gfx: Phaser.GameObjects.Graphics, mine: Mine, color: number): void {
    const t = mine.detonateTimer / DETONATION_FLASH_SECONDS; // 0 -> 1
    const r = mine.blastRadius * (0.4 + 0.6 * t);
    const alpha = 0.85 * (1 - t);

    gfx.lineStyle(3.5 * this.stats.size, color, alpha);
    gfx.strokeCircle(mine.x, mine.y, r);

    if (this.currentQuality !== 'low') {
      gfx.fillStyle(color, 0.18 * (1 - t));
      gfx.fillCircle(mine.x, mine.y, r * 0.92);
    }
    if (this.currentQuality === 'high') {
      gfx.lineStyle(1.5, 0xffffff, alpha * 0.8);
      gfx.strokeCircle(mine.x, mine.y, r * 0.7);
    }
  }

  public destroy(): void {
    if (this.mineGraphics) {
      this.mineGraphics.destroy();
      this.mineGraphics = null;
    }
    this.mines = [];
    this.poolInitialized = false;
    super.destroy();
  }
}
