import { BaseWeapon, WeaponContext, WeaponStats } from './BaseWeapon';
import { Transform } from '../ecs/components';
import { getEnemySpatialHash } from '../utils/SpatialHash';
import { DepthLayers } from '../visual/DepthLayers';
import { VisualQuality } from '../visual/GlowGraphics';
import {
  createSentryState,
  stepSentry,
  type SentryParams,
  type SentryState,
} from './sentryLogic';

const SENTRY_POOL_SIZE = 8;         // max concurrent turrets (count caps below this)
const PROJECTILE_POOL_SIZE = 48;
const FIRE_INTERVAL = 0.5;          // seconds between a turret's shots
const PROJECTILE_MAX_TRAVEL = 900;  // px before a bolt is culled
const NEON = 0x66ddff;              // player-cyan — the turret enemy's language, inverted to friendly
const RAIL_NEON = 0xaaf0ff;         // brighter rail tint for the Rail Sentry evolution

interface Sentry {
  motion: SentryState;
  aimAngle: number;
  active: boolean;
}

interface SentryProjectile {
  x: number;
  y: number;
  prevX: number;
  prevY: number;
  velocityX: number;
  velocityY: number;
  travelled: number;
  damage: number;
  piercing: number;
  hitIds: Set<number>;
  active: boolean;
}

/**
 * SentryWeapon — the arsenal's only *deployed* weapon. Every other weapon fires
 * from, orbits, or returns to the player; a sentry placement drops a stationary
 * auto-firing turret at the player's current position and leaves it there. Each
 * turret independently targets the nearest enemy in range and fires bolts until
 * it expires. This rewards positional play the rest of the arsenal lacks: anchor
 * a chokepoint, build a gun line, then kite the horde back through it.
 *
 * Lifecycle + fire cadence live in the pure, unit-tested `sentryLogic` module;
 * this class owns placement, targeting, pooled projectiles, and the turret visual
 * (drawn into shared Graphics, so no projectile-atlas frame is needed).
 *
 * Mastery ("Overclock Array"): every placement deploys TWO turrets flanking the
 * player, doubling how fast the gun line builds.
 * Evolution ("Rail Sentry", via piercing): longer-range turrets firing heavy
 * piercing rail bolts (stat multipliers) rendered as a bright lance.
 */
export class SentryWeapon extends BaseWeapon {
  // `speed` is the bolt velocity, so the global projectile-speed multiplier applies.
  protected scalesProjectileSpeed = true;
  // `duration` is the turret's deployed lifetime — longer is better.
  protected scalesEffectDuration = true;

  private sentries: Sentry[] = [];
  private projectiles: SentryProjectile[] = [];
  private bodyGraphics: Phaser.GameObjects.Graphics | null = null;
  private boltGraphics: Phaser.GameObjects.Graphics | null = null;
  private currentQuality: VisualQuality = 'high';
  private poolInitialized = false;

  constructor() {
    const baseStats: WeaponStats = {
      damage: 13,
      cooldown: 3.5,   // seconds between deployments
      range: 240,
      count: 1,        // max concurrent turrets (+1 every 2 levels)
      piercing: 1,
      size: 1,
      speed: 420,
      duration: 6,     // turret lifetime seconds
    };

    super(
      'sentry',
      'Sentry Turret',
      'sentry',
      'Deploys a stationary auto-firing turret',
      10,
      baseStats,
      'Overclock Array',
      'Every deployment drops two turrets flanking you'
    );

    // The deploy cadence is slow (a turret lasts seconds), so the default
    // "wait a full cooldown before the first attack" would leave a Sentry
    // starting weapon idle for ~3.5s. Offset lastFired so the first turret
    // drops ~0.5s in; the slow rolling-line cadence resumes after that.
    this.lastFired = -(baseStats.cooldown - 0.5);
  }

  private initPool(scene: Phaser.Scene): void {
    if (this.poolInitialized) return;
    this.poolInitialized = true;

    this.bodyGraphics = scene.add.graphics();
    this.bodyGraphics.setDepth(DepthLayers.BLADE);
    this.boltGraphics = scene.add.graphics();
    this.boltGraphics.setDepth(DepthLayers.PROJECTILES);

    for (let i = 0; i < SENTRY_POOL_SIZE; i++) {
      this.sentries.push({ motion: createSentryState(0, 0), aimAngle: 0, active: false });
    }
    for (let i = 0; i < PROJECTILE_POOL_SIZE; i++) {
      this.projectiles.push({
        x: 0, y: 0, prevX: 0, prevY: 0,
        velocityX: 0, velocityY: 0,
        travelled: 0, damage: 0, piercing: 0,
        hitIds: new Set(),
        active: false,
      });
    }
  }

  protected attack(ctx: WeaponContext): void {
    this.initPool(ctx.scene);

    if (this.isMastered()) {
      // Two turrets flank the player, offset perpendicular to its facing.
      const offset = 26;
      this.deploySentry(ctx.playerX - offset, ctx.playerY);
      this.deploySentry(ctx.playerX + offset, ctx.playerY);
    } else {
      this.deploySentry(ctx.playerX, ctx.playerY);
    }

    ctx.soundManager.playHit();
  }

  private deploySentry(x: number, y: number): void {
    this.enforceMaxCount(this.stats.count - 1);

    let slot: Sentry | null | undefined = this.sentries.find((s) => !s.active);
    if (!slot) slot = this.oldestActive();
    if (!slot) return;

    slot.motion = createSentryState(x, y);
    slot.aimAngle = 0;
    slot.active = true;
  }

  /** Retire the oldest turrets until at most `max` remain active. */
  private enforceMaxCount(max: number): void {
    let activeCount = 0;
    for (const sentry of this.sentries) if (sentry.active) activeCount++;
    while (activeCount > Math.max(0, max)) {
      const oldest = this.oldestActive();
      if (!oldest) break;
      oldest.active = false;
      activeCount--;
    }
  }

  private oldestActive(): Sentry | null {
    let oldest: Sentry | null = null;
    for (const sentry of this.sentries) {
      if (!sentry.active) continue;
      if (!oldest || sentry.motion.age > oldest.motion.age) oldest = sentry;
    }
    return oldest;
  }

  protected updateEffects(ctx: WeaponContext): void {
    this.initPool(ctx.scene);
    this.currentQuality = ctx.visualQuality;

    if (this.bodyGraphics) this.bodyGraphics.clear();
    if (this.boltGraphics) this.boltGraphics.clear();

    const params: SentryParams = { lifetime: this.stats.duration, fireInterval: FIRE_INTERVAL };
    const spatialHash = getEnemySpatialHash();

    for (const sentry of this.sentries) {
      if (!sentry.active) continue;

      const target = spatialHash.findNearest(sentry.motion.x, sentry.motion.y, this.stats.range);
      const step = stepSentry(sentry.motion, params, ctx.deltaTime, target !== null);
      sentry.motion = step.state;

      if (step.expired) {
        sentry.active = false;
        continue;
      }

      if (target) {
        sentry.aimAngle = Math.atan2(
          Transform.y[target.id] - sentry.motion.y,
          Transform.x[target.id] - sentry.motion.x
        );
        if (step.fired) this.fireBolt(ctx, sentry, sentry.aimAngle);
      } else {
        sentry.aimAngle += ctx.deltaTime * 0.6; // idle sweep
      }

      this.drawSentry(sentry, params.lifetime);
    }

    this.updateProjectiles(ctx, spatialHash);
  }

  private fireBolt(ctx: WeaponContext, sentry: Sentry, angle: number): void {
    const proj = this.projectiles.find((p) => !p.active) ?? this.projectiles[0];
    if (!proj) return;

    const muzzle = 16 * this.stats.size;
    proj.x = sentry.motion.x + Math.cos(angle) * muzzle;
    proj.y = sentry.motion.y + Math.sin(angle) * muzzle;
    proj.prevX = proj.x;
    proj.prevY = proj.y;
    proj.velocityX = Math.cos(angle) * this.stats.speed;
    proj.velocityY = Math.sin(angle) * this.stats.speed;
    proj.travelled = 0;
    proj.damage = this.stats.damage;
    proj.piercing = this.stats.piercing;
    proj.hitIds.clear();
    proj.active = true;

    // Muzzle flash
    const flash = ctx.scene.add.circle(proj.x, proj.y, 5 * this.stats.size, this.isEvolved ? RAIL_NEON : NEON, 0.6);
    flash.setDepth(DepthLayers.PROJECTILES);
    ctx.scene.tweens.add({
      targets: flash,
      alpha: 0,
      scaleX: 2.2,
      scaleY: 2.2,
      duration: 90,
      onComplete: () => flash.destroy(),
    });
  }

  private updateProjectiles(ctx: WeaponContext, spatialHash: ReturnType<typeof getEnemySpatialHash>): void {
    const gfx = this.boltGraphics;
    const width = ctx.scene.scale.width;
    const height = ctx.scene.scale.height;
    const rail = this.isEvolved;
    const boltColor = rail ? RAIL_NEON : NEON;
    const collisionRadius = (rail ? 16 : 12) * this.stats.size;
    const collisionRadiusSq = collisionRadius * collisionRadius;

    for (const proj of this.projectiles) {
      if (!proj.active) continue;

      proj.prevX = proj.x;
      proj.prevY = proj.y;
      const stepX = proj.velocityX * ctx.deltaTime;
      const stepY = proj.velocityY * ctx.deltaTime;
      proj.x += stepX;
      proj.y += stepY;
      proj.travelled += Math.hypot(stepX, stepY);

      if (
        proj.travelled > PROJECTILE_MAX_TRAVEL ||
        proj.x < -50 || proj.x > width + 50 ||
        proj.y < -50 || proj.y > height + 50
      ) {
        proj.active = false;
        continue;
      }

      const nearby = spatialHash.queryPotential(proj.x, proj.y, collisionRadius + 6);
      for (const enemy of nearby) {
        if (proj.hitIds.has(enemy.id)) continue;
        const dx = Transform.x[enemy.id] - proj.x;
        const dy = Transform.y[enemy.id] - proj.y;
        if (dx * dx + dy * dy >= collisionRadiusSq) continue;

        ctx.damageEnemy(enemy.id, proj.damage, rail ? 120 : 70);
        ctx.effectsManager.playHitSparks(proj.x, proj.y, Math.atan2(proj.velocityY, proj.velocityX));
        proj.hitIds.add(enemy.id);
        if (proj.hitIds.size > proj.piercing) {
          proj.active = false;
          break;
        }
      }
      if (!proj.active) continue;

      if (gfx) {
        if (rail) {
          gfx.lineStyle(4, boltColor, 0.85);
          gfx.lineBetween(proj.prevX, proj.prevY, proj.x, proj.y);
          gfx.lineStyle(1.5, 0xffffff, 0.9);
          gfx.lineBetween(proj.prevX, proj.prevY, proj.x, proj.y);
        } else {
          gfx.lineStyle(2.5, boltColor, 0.8);
          gfx.lineBetween(proj.prevX, proj.prevY, proj.x, proj.y);
          gfx.fillStyle(0xffffff, 0.9);
          gfx.fillCircle(proj.x, proj.y, 2);
        }
      }
    }
  }

  private drawSentry(sentry: Sentry, lifetime: number): void {
    const gfx = this.bodyGraphics;
    if (!gfx) return;

    const { x, y } = sentry.motion;
    const size = 11 * this.stats.size;
    const rail = this.isEvolved;
    const color = rail ? RAIL_NEON : NEON;

    // Fade the base as the turret nears expiry so its remaining uptime reads.
    const remaining = 1 - sentry.motion.age / lifetime;
    const alpha = 0.55 + 0.45 * Math.max(0, Math.min(1, remaining));

    // Hex base — the turret enemy's mount, in friendly neon.
    gfx.lineStyle(2, color, alpha);
    gfx.beginPath();
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2 + Math.PI / 6;
      const px = x + Math.cos(a) * size;
      const py = y + Math.sin(a) * size;
      if (i === 0) gfx.moveTo(px, py); else gfx.lineTo(px, py);
    }
    gfx.closePath();
    gfx.strokePath();

    if (this.currentQuality !== 'low') {
      gfx.fillStyle(color, 0.12 * alpha);
      gfx.fillCircle(x, y, size * 0.8);
    }

    // Barrel pointing at the current target (or idle-sweeping).
    const cos = Math.cos(sentry.aimAngle);
    const sin = Math.sin(sentry.aimAngle);
    const barrelLen = size * (rail ? 1.9 : 1.5);
    gfx.lineStyle(rail ? 4 : 3, color, alpha);
    gfx.lineBetween(x, y, x + cos * barrelLen, y + sin * barrelLen);

    // Core.
    gfx.fillStyle(0xffffff, 0.85 * alpha);
    gfx.fillCircle(x, y, 2.5);

    // Fresh-deploy ping.
    if (this.currentQuality === 'high' && sentry.motion.age < 0.3) {
      const ping = 1 - sentry.motion.age / 0.3;
      gfx.lineStyle(2, color, 0.5 * ping);
      gfx.strokeCircle(x, y, size + (1 - ping) * 18);
    }
  }

  protected recalculateStats(): void {
    super.recalculateStats();
    // Deploy a touch faster as the weapon levels so the gun line refreshes sooner.
    this.stats.cooldown = Math.max(1.6, this.baseStats.cooldown - (this.level - 1) * 0.18);
  }

  public destroy(): void {
    if (this.bodyGraphics) {
      this.bodyGraphics.destroy();
      this.bodyGraphics = null;
    }
    if (this.boltGraphics) {
      this.boltGraphics.destroy();
      this.boltGraphics = null;
    }
    this.sentries = [];
    this.projectiles = [];
    this.poolInitialized = false;
    super.destroy();
  }
}
