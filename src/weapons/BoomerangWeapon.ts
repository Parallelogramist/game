import { BaseWeapon, WeaponContext, WeaponStats } from './BaseWeapon';
import { Transform } from '../ecs/components';
import { getEnemySpatialHash } from '../utils/SpatialHash';
import { DepthLayers } from '../visual/DepthLayers';
import { VisualQuality } from '../visual/GlowGraphics';
import { findNearestEnemy } from './WeaponUtils';
import {
  createBoomerangState,
  stepBoomerang,
  type BoomerangParams,
  type BoomerangState,
} from './boomerangMotion';

const POOL_SIZE = 32;
const CATCH_RADIUS = 22;
const HIT_COOLDOWN = 0.35; // seconds before the same enemy can be struck again
const RETURN_SPEED_FACTOR = 1.2; // return leg is a touch faster so it reliably catches up

interface Glaive {
  motion: BoomerangState;
  damage: number;
  /** Remaining safety lifetime (seconds) — retires a glaive that can never reach a teleported player. */
  lifetime: number;
  hitCount: Map<number, number>;
  hitCooldown: Map<number, number>;
  active: boolean;
}

/**
 * BoomerangWeapon — the only weapon whose projectile returns. Each glaive carves
 * out to `range` (decelerating to an apex), then homes back to the player's
 * current position, damaging enemies on BOTH legs (a single enemy can be struck
 * on the way out and again on the way back, up to `piercing` total hits). The
 * out-and-back trajectory rewards positioning: the return path sweeps the lane
 * you retreat through.
 *
 * Trajectory math lives in the pure, unit-tested `boomerangMotion` module; this
 * class owns pooling, collision, and the spinning-glaive visual (drawn into one
 * shared Graphics so no projectile-atlas frame is needed).
 *
 * Mastery ("Twin Glaives"): every throw also fires a mirrored volley in the
 * opposite direction, carving both sides of the player at once.
 */
export class BoomerangWeapon extends BaseWeapon {
  // `speed` is the outbound launch velocity, so the global projectile-speed multiplier applies.
  protected scalesProjectileSpeed = true;
  // `duration` here is a safety lifetime cap, NOT a "longer is better" effect — leave it unscaled.
  protected scalesEffectDuration = false;

  private pool: Glaive[] = [];
  private effectsGraphics: Phaser.GameObjects.Graphics | null = null;
  private currentQuality: VisualQuality = 'high';
  private poolInitialized = false;

  constructor() {
    const baseStats: WeaponStats = {
      damage: 17,
      cooldown: 1.4,
      range: 280,
      count: 1,
      piercing: 2,
      size: 1,
      speed: 340,
      duration: 4,
    };

    super(
      'boomerang',
      'Boomerang Glaive',
      'boomerang',
      'Hurls a glaive that carves out and homes back',
      10,
      baseStats,
      'Twin Glaives',
      'Every throw also fires a mirrored volley behind you'
    );
  }

  private initPool(scene: Phaser.Scene): void {
    if (this.poolInitialized) return;
    this.poolInitialized = true;

    this.effectsGraphics = scene.add.graphics();
    this.effectsGraphics.setDepth(DepthLayers.PROJECTILES);

    for (let i = 0; i < POOL_SIZE; i++) {
      this.pool.push({
        motion: createBoomerangState(0, 0, 0),
        damage: 0,
        lifetime: 0,
        hitCount: new Map(),
        hitCooldown: new Map(),
        active: false,
      });
    }
  }

  private acquireGlaive(): Glaive | null {
    for (const glaive of this.pool) {
      if (!glaive.active) return glaive;
    }
    // Pool exhausted — reuse the oldest by simply taking the first (rare; cap is generous).
    return this.pool.length > 0 ? this.pool[0] : null;
  }

  /** Current outbound/return tuning derived from live stats. */
  private buildParams(): BoomerangParams {
    const outboundSpeed = Math.max(1, this.stats.speed);
    // Apex distance == range: maxDist = outboundSpeed * outboundDuration / 2.
    const outboundDuration = (2 * this.stats.range) / outboundSpeed;
    return {
      outboundDuration,
      outboundSpeed,
      returnSpeed: outboundSpeed * RETURN_SPEED_FACTOR,
      catchRadius: CATCH_RADIUS,
    };
  }

  protected attack(ctx: WeaponContext): void {
    this.initPool(ctx.scene);

    const enemies = ctx.getEnemies();
    if (enemies.length === 0) return;

    const nearestId = findNearestEnemy(ctx, ctx.playerX, ctx.playerY, this.stats.range * 1.4);
    const baseAngle = nearestId !== -1
      ? Math.atan2(Transform.y[nearestId] - ctx.playerY, Transform.x[nearestId] - ctx.playerX)
      : Math.random() * Math.PI * 2;

    this.throwVolley(ctx, baseAngle);
    // Twin Glaives mastery: a mirrored volley carves the opposite side too.
    if (this.isMastered()) {
      this.throwVolley(ctx, baseAngle + Math.PI);
    }

    ctx.soundManager.playHit();
  }

  private throwVolley(ctx: WeaponContext, baseAngle: number): void {
    const count = Math.max(1, this.stats.count);
    const spread = Math.PI / 5;
    for (let i = 0; i < count; i++) {
      let angle = baseAngle;
      if (count > 1) {
        angle = baseAngle - spread / 2 + (spread / (count - 1)) * i;
      }
      this.spawnGlaive(ctx, angle);
    }
  }

  private spawnGlaive(ctx: WeaponContext, angle: number): void {
    const glaive = this.acquireGlaive();
    if (!glaive) return;

    glaive.motion = createBoomerangState(ctx.playerX, ctx.playerY, angle);
    glaive.damage = this.stats.damage;
    glaive.lifetime = this.safetyLifetime();
    glaive.hitCount.clear();
    glaive.hitCooldown.clear();
    glaive.active = true;
  }

  /**
   * Backstop lifetime (seconds) — derived from the actual round-trip so a glaive
   * is never culled mid-return on long-range/evolved builds (where the outbound
   * leg alone, 2·range/speed, can exceed a flat constant). It only ever fires for
   * a glaive that cannot reach the player at all (e.g. an extreme knock); normal
   * throws are retired by being caught well before this.
   */
  private safetyLifetime(): number {
    const params = this.buildParams();
    // Outbound + a generous return estimate (apex distance + slack for player movement).
    const returnTime = (this.stats.range + 240) / params.returnSpeed;
    return params.outboundDuration + returnTime + 2;
  }

  protected updateEffects(ctx: WeaponContext): void {
    this.initPool(ctx.scene);
    this.currentQuality = ctx.visualQuality;

    if (this.effectsGraphics) {
      this.effectsGraphics.clear();
    }

    const params = this.buildParams();
    const spatialHash = getEnemySpatialHash();
    const baseSize = 14 * this.stats.size;
    const collisionRadius = baseSize + 12;
    const collisionRadiusSq = collisionRadius * collisionRadius;

    for (const glaive of this.pool) {
      if (!glaive.active) continue;

      glaive.lifetime -= ctx.deltaTime;
      if (glaive.lifetime <= 0) {
        glaive.active = false;
        continue;
      }

      const result = stepBoomerang(glaive.motion, params, ctx.playerX, ctx.playerY, ctx.deltaTime);
      glaive.motion = result.state;
      if (result.caught) {
        glaive.active = false;
        continue;
      }

      this.drawGlaive(ctx, glaive, baseSize);
      this.checkGlaiveCollisions(ctx, glaive, spatialHash, collisionRadius, collisionRadiusSq);
    }
  }

  private drawGlaive(ctx: WeaponContext, glaive: Glaive, size: number): void {
    const gfx = this.effectsGraphics;
    if (!gfx) return;

    const { x, y } = glaive.motion;
    const spin = ctx.gameTime * 16;
    // Brighter, whiter blades on the return leg so the leg you're carving reads clearly.
    const returning = glaive.motion.phase === 'returning';
    const bladeColor = returning ? 0xbbeeff : 0x66ddff;

    // Two crossed blades forming a 4-point glaive, rotating by spin.
    gfx.lineStyle(3, bladeColor, 0.95);
    for (let arm = 0; arm < 2; arm++) {
      const a = spin + arm * (Math.PI / 2);
      gfx.lineBetween(
        x + Math.cos(a) * size,
        y + Math.sin(a) * size,
        x - Math.cos(a) * size,
        y - Math.sin(a) * size
      );
    }

    if (this.currentQuality === 'high') {
      // Faint blur ring + bright core for a sense of whirling speed.
      gfx.lineStyle(2, bladeColor, 0.25);
      gfx.strokeCircle(x, y, size * 0.85);
      gfx.fillStyle(0xffffff, 0.9);
      gfx.fillCircle(x, y, 2.5);
    }
  }

  private checkGlaiveCollisions(
    ctx: WeaponContext,
    glaive: Glaive,
    spatialHash: ReturnType<typeof getEnemySpatialHash>,
    collisionRadius: number,
    collisionRadiusSq: number
  ): void {
    const { x, y } = glaive.motion;
    const nearbyEnemies = spatialHash.queryPotential(x, y, collisionRadius + 5);

    for (const enemy of nearbyEnemies) {
      const enemyId = enemy.id;

      const lastHit = glaive.hitCooldown.get(enemyId) ?? -Infinity;
      if (ctx.gameTime - lastHit < HIT_COOLDOWN) continue;

      const hits = glaive.hitCount.get(enemyId) ?? 0;
      if (hits >= this.stats.piercing) continue;

      const dx = Transform.x[enemyId] - x;
      const dy = Transform.y[enemyId] - y;
      if (dx * dx + dy * dy >= collisionRadiusSq) continue;

      ctx.damageEnemy(enemyId, glaive.damage, 90);
      glaive.hitCount.set(enemyId, hits + 1);
      glaive.hitCooldown.set(enemyId, ctx.gameTime);
      ctx.effectsManager.playHitSparks(x, y, glaive.motion.angle);
    }
  }

  protected recalculateStats(): void {
    super.recalculateStats();
    // A little more reach in the throw arm as the weapon levels (range stat still
    // governs apex distance; this just makes higher levels feel snappier).
    this.stats.speed = this.baseStats.speed + (this.level - 1) * 12;
  }

  public destroy(): void {
    if (this.effectsGraphics) {
      this.effectsGraphics.destroy();
      this.effectsGraphics = null;
    }
    this.pool = [];
    this.poolInitialized = false;
    super.destroy();
  }
}
