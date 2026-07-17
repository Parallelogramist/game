import { BaseWeapon, WeaponContext, WeaponStats } from './BaseWeapon';
import { Transform } from '../ecs/components';
import { getEnemySpatialHash } from '../utils/SpatialHash';
import { DepthLayers } from '../visual/DepthLayers';
import { VisualQuality } from '../visual/GlowGraphics';

const RING_POOL_SIZE = 16;
const BAND_HALF_WIDTH = 16;   // px collision half-band around a ring's wavefront (× size)
const RING_SPACING = 26;      // px concentric gap between rings in one pulse (× size)
const KNOCKBACK = 60;
const EVOLVED_KNOCKBACK = 110;
const STUN_SECONDS = 0.4;     // mastery (Concussion Wave): brief stun on ring contact
const NEON = 0x59f2d6;        // aqua shock ring
const EVOLVED_NEON = 0x9df9ff;

interface Ring {
  ox: number;                 // anchored origin — the ring does NOT follow the player
  oy: number;
  radius: number;
  maxRadius: number;
  bandHalfWidth: number;
  damage: number;
  knockback: number;
  hitIds: Set<number>;        // each enemy is struck once per ring
  active: boolean;
}

/**
 * PulseWeapon ("Pulse Cannon") — the arsenal's only *traveling wavefront*. Each
 * cooldown fires a burst of concentric rings anchored at the ship's position; a
 * ring expands outward and damages every enemy its wavefront sweeps over, once,
 * then dies at max range. Unlike the static aura (constant tick zone) or the
 * instant frost-nova burst, damage lands as the ring passes — a rhythmic
 * crowd-clear that rewards being surrounded and needs no aim.
 *
 * Ring lifecycle, collision and the visual are all owned here and drawn into a
 * single shared Graphics (the self-drawing pattern of the other recent weapons,
 * so no projectile-atlas frame is required). The ring math (advance, cull, band
 * hit-test) is trivial and stays inline — no separate pure module or unit test.
 *
 * Mastery ("Concussion Wave"): enemies a ring strikes are briefly stunned.
 * Evolution ("Resonance Cascade", via multishot): more, wider, harder rings.
 */
export class PulseWeapon extends BaseWeapon {
  // `speed` is the ring's outward expansion velocity, so the global
  // projectile-speed (Velocity) multiplier applies to it.
  protected scalesProjectileSpeed = true;

  private rings: Ring[] = [];
  private ringGraphics: Phaser.GameObjects.Graphics | null = null;
  private currentQuality: VisualQuality = 'high';
  private poolInitialized = false;

  constructor() {
    const baseStats: WeaponStats = {
      damage: 16,
      cooldown: 2.2,
      range: 200,     // max ring radius (px) — scaled by the universal Range stat
      count: 1,       // concentric rings per pulse (+1 every 2 weapon levels via base formula)
      piercing: 0,    // unused — a ring hits every enemy its wavefront crosses, once
      size: 1,        // scales ring band width, concentric spacing, and line thickness
      speed: 560,     // ring expansion px/s
      duration: 0,    // unused (ring life is derived from range / speed)
    };

    super(
      'pulse',
      'Pulse Cannon',
      'pulse',
      'Emits expanding shockwave rings that sweep outward',
      10,
      baseStats,
      'Concussion Wave',
      'Enemies struck by a pulse ring are briefly stunned'
    );

    // The pulse cadence is slow, so fire the first pulse ~0.5s in rather than
    // leaving a Pulse starting weapon idle for a full 2.2s (mirrors Sentry).
    this.lastFired = -(baseStats.cooldown - 0.5);
  }

  private initPool(scene: Phaser.Scene): void {
    if (this.poolInitialized) return;
    this.poolInitialized = true;

    this.ringGraphics = scene.add.graphics();
    this.ringGraphics.setDepth(DepthLayers.GROUND_EFFECTS);

    for (let i = 0; i < RING_POOL_SIZE; i++) {
      this.rings.push({
        ox: 0, oy: 0, radius: 0, maxRadius: 0, bandHalfWidth: 0,
        damage: 0, knockback: 0, hitIds: new Set(), active: false,
      });
    }
  }

  protected attack(ctx: WeaponContext): void {
    this.initPool(ctx.scene);

    const ringCount = this.stats.count + (this.isMastered() ? 1 : 0);
    const band = BAND_HALF_WIDTH * this.stats.size;
    const spacing = RING_SPACING * this.stats.size;
    const knockback = this.isEvolved ? EVOLVED_KNOCKBACK : KNOCKBACK;

    for (let i = 0; i < ringCount; i++) {
      const ring = this.acquireRing();
      ring.ox = ctx.playerX;
      ring.oy = ctx.playerY;
      ring.radius = i * spacing;          // concentric — inner rings lead the wave
      ring.maxRadius = this.stats.range;
      ring.bandHalfWidth = band;
      ring.damage = this.stats.damage;
      ring.knockback = knockback;
      ring.hitIds.clear();
      ring.active = true;
    }

    ctx.soundManager.playHit();
  }

  /** First inactive ring, else recycle the one closest to expiring (widest radius). */
  private acquireRing(): Ring {
    for (const ring of this.rings) {
      if (!ring.active) return ring;
    }
    let widest = this.rings[0];
    for (const ring of this.rings) {
      if (ring.radius > widest.radius) widest = ring;
    }
    return widest;
  }

  protected updateEffects(ctx: WeaponContext): void {
    this.initPool(ctx.scene);
    this.currentQuality = ctx.visualQuality;

    const gfx = this.ringGraphics;
    if (gfx) gfx.clear();

    const spatialHash = getEnemySpatialHash();
    const evolved = this.isEvolved;
    const color = evolved ? EVOLVED_NEON : NEON;
    const mastered = this.isMastered();

    for (const ring of this.rings) {
      if (!ring.active) continue;

      ring.radius += this.stats.speed * ctx.deltaTime;

      if (ring.radius - ring.bandHalfWidth > ring.maxRadius) {
        ring.active = false;
        continue;
      }

      const nearby = spatialHash.queryPotential(ring.ox, ring.oy, ring.radius + ring.bandHalfWidth + 6);
      for (const enemy of nearby) {
        if (ring.hitIds.has(enemy.id)) continue;
        const dx = Transform.x[enemy.id] - ring.ox;
        const dy = Transform.y[enemy.id] - ring.oy;
        const dist = Math.hypot(dx, dy);
        if (Math.abs(dist - ring.radius) > ring.bandHalfWidth) continue;

        ctx.damageEnemy(enemy.id, ring.damage, ring.knockback);
        if (mastered) ctx.stunEnemy(enemy.id, STUN_SECONDS);
        ctx.effectsManager.playHitSparks(Transform.x[enemy.id], Transform.y[enemy.id], Math.atan2(dy, dx));
        ring.hitIds.add(enemy.id);
      }

      if (gfx) this.drawRing(gfx, ring, color, evolved);
    }
  }

  private drawRing(gfx: Phaser.GameObjects.Graphics, ring: Ring, color: number, evolved: boolean): void {
    const fade = Math.max(0, Math.min(1, 1 - ring.radius / ring.maxRadius));
    const alpha = 0.15 + 0.7 * fade;
    const width = (evolved ? 3.5 : 2.5) * this.stats.size * (0.6 + 0.4 * fade);

    gfx.lineStyle(width, color, alpha);
    gfx.strokeCircle(ring.ox, ring.oy, ring.radius);

    if (this.currentQuality !== 'low') {
      gfx.lineStyle(1, 0xffffff, alpha * 0.6);
      gfx.strokeCircle(ring.ox, ring.oy, ring.radius);
    }
  }

  public destroy(): void {
    if (this.ringGraphics) {
      this.ringGraphics.destroy();
      this.ringGraphics = null;
    }
    this.rings = [];
    this.poolInitialized = false;
    super.destroy();
  }
}
