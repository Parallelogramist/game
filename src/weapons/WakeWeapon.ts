import { BaseWeapon, WeaponContext, WeaponStats } from './BaseWeapon';
import { Transform, Velocity, Health } from '../ecs/components';
import { getEnemySpatialHash } from '../utils/SpatialHash';
import { DepthLayers } from '../visual/DepthLayers';
import { VisualQuality } from '../visual/GlowGraphics';
import { createWakeEmitter, stepWakeEmitter, type WakeEmitterState } from './wakeLogic';

const SEGMENT_POOL_SIZE = 128;      // hard cap on live segments; oldest retires first
const SEGMENT_SPACING = 26;         // px travelled between segment drops
const DAMAGE_PASS_INTERVAL = 0.25;  // seconds between collision sweeps
const LANE_CAP = 3;                 // max parallel ribbons; count beyond this widens segments
const LANE_GAP_FACTOR = 1.5;        // lane offset = segment radius × this
const EXTRA_COUNT_RADIUS_BONUS = 0.12;
const MASTERY_SLOW_FACTOR = 0.75;   // Undertow: enemies in the wake move at 75% speed
const SLOW_DURATION = 0.6;          // refreshed every damage pass while an enemy stands in the wake
const EVOLVED_LIFETIME_MULT = 1.35; // Slipstream wake lingers longer (duration isn't an evolution stat)
const CAUSTIC = 0x7dff66;
const EVOLVED_NEON = 0xb0ffe8;

interface WakeSegment {
  x: number;
  y: number;
  age: number;
  active: boolean;
}

/**
 * WakeWeapon — the arsenal's only *movement-driven* weapon. Every other weapon
 * fires on a clock (or, Guardian, when the player is hit); the Wake's output is
 * a function of distance travelled. Moving lays a lingering caustic ribbon along
 * the ship's path; enemies standing in a live segment take ticking damage. Stand
 * still and the wake stops growing — sprint and you paint the arena. That rewards
 * mobility/kiting builds, the inverse of Guardian's face-tank identity.
 *
 * Stat repurposing (see update()): `cooldown` is the per-enemy re-hit interval,
 * not a fire timer; `range` is the segment radius; `count` adds parallel ribbon
 * lanes (capped at 3, overflow widens segments); `duration` is segment lifetime.
 * Collision runs as a 4 Hz sweep over the segment pool, not per frame — the
 * re-hit gate makes finer sampling pointless.
 *
 * Distance-gated emission lives in the pure, unit-tested `wakeLogic` module.
 * Mastery ("Undertow"): the wake also slows enemies caught in it by 25%.
 * Evolution ("Slipstream", via swiftness): wider, longer-lived, deadlier wake.
 */
export class WakeWeapon extends BaseWeapon {
  // `duration` is the segment lifetime — longer is better.
  protected scalesEffectDuration = true;

  private emitter: WakeEmitterState = createWakeEmitter();
  private segments: WakeSegment[] = [];
  private gfx: Phaser.GameObjects.Graphics | null = null;
  private currentQuality: VisualQuality = 'high';
  private poolInitialized = false;
  private damagePassTimer = 0;
  private perpX = 0;
  private perpY = 1;
  private lastHitAt: Map<number, number> = new Map();
  private slowed: Map<number, { originalSpeed: number; expireTime: number }> = new Map();

  constructor() {
    const baseStats: WeaponStats = {
      damage: 8,
      cooldown: 0.55,  // per-enemy re-hit interval — NOT a fire timer (see update())
      range: 22,       // segment radius px
      count: 1,        // parallel ribbon lanes (capped at LANE_CAP, then widens)
      piercing: 0,     // unused — a zone doesn't pierce
      size: 1,
      speed: 0,        // unused
      duration: 2.4,   // segment lifetime seconds
    };

    super(
      'wake',
      'Caustic Wake',
      'wake',
      'Leaves a caustic burning trail behind your ship',
      10,
      baseStats,
      'Undertow',
      'The wake slows enemies caught in it by 25%'
    );
  }

  /**
   * Bypass BaseWeapon's cooldown→attack machinery entirely: the wake is driven
   * by movement, and `cooldown` is repurposed as the per-enemy re-hit interval.
   */
  public update(ctx: WeaponContext): void {
    this.updateEffects(ctx);
  }

  protected attack(_ctx: WeaponContext): void {
    // Never called — update() skips the cooldown loop.
  }

  private initPool(scene: Phaser.Scene): void {
    if (this.poolInitialized) return;
    this.poolInitialized = true;

    this.gfx = scene.add.graphics();
    this.gfx.setDepth(DepthLayers.GROUND_EFFECTS);

    for (let i = 0; i < SEGMENT_POOL_SIZE; i++) {
      this.segments.push({ x: 0, y: 0, age: 0, active: false });
    }
  }

  private segmentRadius(): number {
    const widen = 1 + EXTRA_COUNT_RADIUS_BONUS * Math.max(0, this.stats.count - LANE_CAP);
    return this.stats.range * this.stats.size * widen;
  }

  protected updateEffects(ctx: WeaponContext): void {
    this.initPool(ctx.scene);
    this.currentQuality = ctx.visualQuality;
    if (this.gfx) this.gfx.clear();

    const lifetime = this.stats.duration * (this.isEvolved ? EVOLVED_LIFETIME_MULT : 1);
    const radius = this.segmentRadius();

    // Lane offsets run perpendicular to this frame's travel; hold the last
    // direction while standing still (no segments are emitted then anyway).
    if (this.emitter.initialized) {
      const moveX = ctx.playerX - this.emitter.lastX;
      const moveY = ctx.playerY - this.emitter.lastY;
      const moveLen = Math.hypot(moveX, moveY);
      if (moveLen > 0.0001) {
        this.perpX = -moveY / moveLen;
        this.perpY = moveX / moveLen;
      }
    }

    const step = stepWakeEmitter(this.emitter, ctx.playerX, ctx.playerY, SEGMENT_SPACING);
    this.emitter = step.state;

    const lanes = Math.min(LANE_CAP, this.stats.count);
    for (const point of step.emitPoints) {
      for (let lane = 0; lane < lanes; lane++) {
        const side = lane === 0 ? 0 : lane === 1 ? 1 : -1;
        const gap = radius * LANE_GAP_FACTOR * side;
        this.spawnSegment(point.x + this.perpX * gap, point.y + this.perpY * gap);
      }
    }

    for (const segment of this.segments) {
      if (!segment.active) continue;
      segment.age += ctx.deltaTime;
      if (segment.age >= lifetime) segment.active = false;
    }

    this.damagePassTimer += ctx.deltaTime;
    if (this.damagePassTimer >= DAMAGE_PASS_INTERVAL) {
      this.damagePassTimer = 0;
      this.runDamagePass(ctx, radius);
    }

    this.expireSlows(ctx);
    this.drawSegments(lifetime, radius);
  }

  private spawnSegment(x: number, y: number): void {
    let slot = this.segments.find((segment) => !segment.active);
    if (!slot) {
      for (const segment of this.segments) {
        if (!slot || segment.age > slot.age) slot = segment;
      }
    }
    if (!slot) return;
    slot.x = x;
    slot.y = y;
    slot.age = 0;
    slot.active = true;
  }

  private runDamagePass(ctx: WeaponContext, radius: number): void {
    const spatialHash = getEnemySpatialHash();
    const hitRadiusSq = (radius + 6) * (radius + 6);

    for (const segment of this.segments) {
      if (!segment.active) continue;
      const nearby = spatialHash.queryPotential(segment.x, segment.y, radius + 10);
      for (const enemy of nearby) {
        const dx = Transform.x[enemy.id] - segment.x;
        const dy = Transform.y[enemy.id] - segment.y;
        if (dx * dx + dy * dy >= hitRadiusSq) continue;

        if (this.isMastered()) this.applySlow(ctx, enemy.id);

        const lastHit = this.lastHitAt.get(enemy.id);
        if (lastHit !== undefined && ctx.gameTime - lastHit < this.stats.cooldown) continue;
        this.lastHitAt.set(enemy.id, ctx.gameTime);
        ctx.damageEnemy(enemy.id, this.stats.damage, 0);
      }
    }

    // Bound the re-hit map across a long run.
    if (this.lastHitAt.size > 512) {
      for (const [enemyId, hitTime] of this.lastHitAt) {
        if (ctx.gameTime - hitTime > 5) this.lastHitAt.delete(enemyId);
      }
    }
  }

  private applySlow(ctx: WeaponContext, enemyId: number): void {
    const existing = this.slowed.get(enemyId);
    if (existing) {
      existing.expireTime = ctx.gameTime + SLOW_DURATION;
      return;
    }
    const originalSpeed = Velocity.speed[enemyId];
    Velocity.speed[enemyId] = originalSpeed * MASTERY_SLOW_FACTOR;
    this.slowed.set(enemyId, { originalSpeed, expireTime: ctx.gameTime + SLOW_DURATION });
  }

  private expireSlows(ctx: WeaponContext): void {
    if (this.slowed.size === 0) return;
    const toRemove: number[] = [];
    for (const [enemyId, data] of this.slowed) {
      if (Health.current[enemyId] <= 0) {
        toRemove.push(enemyId);
        continue;
      }
      if (ctx.gameTime >= data.expireTime) {
        Velocity.speed[enemyId] = data.originalSpeed;
        toRemove.push(enemyId);
      }
    }
    for (const enemyId of toRemove) this.slowed.delete(enemyId);
  }

  private drawSegments(lifetime: number, radius: number): void {
    const gfx = this.gfx;
    if (!gfx) return;
    const color = this.isEvolved ? EVOLVED_NEON : CAUSTIC;
    const lowQuality = this.currentQuality === 'low';

    for (const segment of this.segments) {
      if (!segment.active) continue;
      const life = 1 - segment.age / lifetime;
      gfx.fillStyle(color, 0.06 + 0.2 * life);
      gfx.fillCircle(segment.x, segment.y, radius);
      if (!lowQuality) {
        gfx.fillStyle(0xffffff, 0.1 * life);
        gfx.fillCircle(segment.x, segment.y, radius * 0.4);
      }
    }
  }

  protected recalculateStats(): void {
    super.recalculateStats();
    this.stats.cooldown = Math.max(0.25, this.stats.cooldown);
  }

  public destroy(): void {
    if (this.gfx) {
      this.gfx.destroy();
      this.gfx = null;
    }
    this.segments = [];
    this.lastHitAt.clear();
    this.slowed.clear();
    this.emitter = createWakeEmitter();
    this.poolInitialized = false;
    super.destroy();
  }
}
