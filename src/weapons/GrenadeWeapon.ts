import { BaseWeapon, WeaponContext, WeaponStats } from './BaseWeapon';
import { Transform, Health } from '../ecs/components';
import { getEnemySpatialHash } from '../utils/SpatialHash';
import { getJuiceManager } from '../effects/JuiceManager';
import { DepthLayers } from '../visual/DepthLayers';
import type { VisualQuality } from '../visual/GlowGraphics';

const GRENADE_POOL_SIZE = 32;
const ARC_HEIGHT = 95;            // px peak of the parabolic lob (visual only)
const BLAST_RADIUS_BASE = 60;     // detonation radius (px) — scaled by size
const KNOCKBACK = 220;
const MIN_TRAVEL_TIME = 0.14;     // s floor so a point-blank lob still arcs
const FALLOFF = 0.5;              // edge-of-blast keeps (1 - FALLOFF) of the damage
// Mastery ("Cluster Payload"): each primary blast scatters bomblets.
const BOMBLET_COUNT = 3;
const BOMBLET_DAMAGE_FRACTION = 0.4;
const BOMBLET_RADIUS_FRACTION = 0.6;
const BOMBLET_SCATTER = 75;       // px max landing offset from the primary impact
const BOMBLET_TRAVEL = 0.28;      // s bomblet flight time
const BODY_COLOR = 0xffab40;      // warm amber (distinct from blue/violet/cyan peers)
const EVOLVED_BODY_COLOR = 0xffd27a;
const BLAST_CORE = 0xffe0a0;
const BLAST_MID = 0xff7020;

interface Grenade {
  startX: number;
  startY: number;
  targetX: number;
  targetY: number;
  elapsed: number;      // seconds since launch
  travelTime: number;   // total flight time
  damage: number;
  blastRadius: number;
  isBomblet: boolean;   // bomblets never spawn further bomblets (recursion guard)
  active: boolean;
}

/**
 * GrenadeWeapon ("Grenade Launcher") — the arsenal's only *lobbed, arcing,
 * traveling explosive*. Each cooldown it fires grenades that fly from the ship in
 * a visible parabola to enemies in range and burst in an AOE on impact (radial
 * damage with distance falloff + knockback). Unlike Meteor (a top-down sky-drop
 * telegraphed onto the densest cluster), Mine (a stationary placed trap), or
 * Scattergun (instant hitscan pellets), the grenade is a ship-fired projectile
 * you can watch arc across the field, detonating on arrival with no telegraph.
 *
 * Stat mapping: `damage` is per-grenade blast damage (before falloff); `range` is
 * the targeting/lob reach (scaled by the universal Reach stat); `speed` is the
 * lob travel speed (scalesProjectileSpeed = true); `size` scales blast radius and
 * the grenade visual; `count` is grenades per volley. `cooldown` is the fire
 * cadence. `piercing`/`duration` are unused. Grenades are advanced and drawn each
 * frame into one shared Graphics (self-drawing pattern of the recent weapons — no
 * projectile-atlas frame); the explosion is a one-shot tweened burst (Meteor idiom).
 *
 * Mastery ("Cluster Payload"): each primary blast scatters bomblets that lob a
 * short distance out and burst for a fraction of the damage over a smaller radius.
 * Evolution ("Carpet Bomber", via might): heavier grenades, more per volley, over
 * a wider blast.
 */
export class GrenadeWeapon extends BaseWeapon {
  // `speed` is the lob velocity, so the global projectile-speed multiplier applies.
  protected scalesProjectileSpeed = true;
  private grenades: Grenade[] = [];
  private gfx: Phaser.GameObjects.Graphics | null = null;
  private currentQuality: VisualQuality = 'high';
  private poolInitialized = false;

  constructor() {
    const baseStats: WeaponStats = {
      damage: 30,
      cooldown: 1.5,
      range: 360,    // targeting/lob reach (px) — scaled by the universal Reach stat
      count: 1,      // grenades per volley (+1 every 3 weapon levels; see recalculateStats)
      piercing: 999, // unused — a blast hits every enemy in its radius, once
      size: 1,       // scales blast radius + grenade visual
      speed: 460,    // lob travel speed (px/s) — scalesProjectileSpeed applies
      duration: 0,   // unused
    };

    super(
      'grenade',
      'Grenade Launcher',
      'grenade',
      'Lobs arcing grenades that burst on impact',
      10,
      baseStats,
      'Cluster Payload',
      'Each blast scatters bomblets that burst around the impact',
    );

    // Fire the first volley ~0.4s in rather than leaving a Grenade starting weapon
    // idle for a full 1.5s (mirrors Storm/Pulse).
    this.lastFired = -(baseStats.cooldown - 0.4);
  }

  private initPool(scene: Phaser.Scene): void {
    if (this.poolInitialized) return;
    this.poolInitialized = true;

    this.gfx = scene.add.graphics();
    this.gfx.setDepth(DepthLayers.PROJECTILES);

    for (let i = 0; i < GRENADE_POOL_SIZE; i++) {
      this.grenades.push({
        startX: 0, startY: 0, targetX: 0, targetY: 0,
        elapsed: 0, travelTime: 0, damage: 0, blastRadius: 0,
        isBomblet: false, active: false,
      });
    }
  }

  protected recalculateStats(): void {
    super.recalculateStats();
    // Grenade count grows slowly (+1 per 3 levels, not the base +1 per 2) so an
    // AOE explosive doesn't blanket the whole field; evolution/multishot add on top.
    this.stats.count = this.baseStats.count + Math.floor((this.level - 1) / 3) + this.externalBonusCount;
  }

  protected attack(ctx: WeaponContext): void {
    this.initPool(ctx.scene);

    const enemies = ctx.getEnemies();
    if (enemies.length === 0) return;

    const rangeSq = this.stats.range * this.stats.range;
    const candidates: number[] = [];
    let nearest = -1;
    let nearestSq = Infinity;
    for (const id of enemies) {
      if (Health.current[id] <= 0) continue;
      const dx = Transform.x[id] - ctx.playerX;
      const dy = Transform.y[id] - ctx.playerY;
      const distSq = dx * dx + dy * dy;
      if (distSq > rangeSq) continue;
      candidates.push(id);
      if (distSq < nearestSq) {
        nearestSq = distSq;
        nearest = id;
      }
    }
    if (candidates.length === 0) return;

    const blastRadius = BLAST_RADIUS_BASE * this.stats.size;
    for (let i = 0; i < this.stats.count; i++) {
      const targetId = i === 0 ? nearest : candidates[Math.floor(Math.random() * candidates.length)];
      const jitter = i === 0 ? 0 : 26; // spread extra grenades so they don't stack
      const landX = Transform.x[targetId] + (Math.random() - 0.5) * 2 * jitter;
      const landY = Transform.y[targetId] + (Math.random() - 0.5) * 2 * jitter;
      this.launchGrenade(ctx.playerX, ctx.playerY, landX, landY, this.stats.damage, blastRadius, false);
    }

    ctx.soundManager.playHit();
  }

  private launchGrenade(
    startX: number, startY: number,
    targetX: number, targetY: number,
    damage: number, blastRadius: number, isBomblet: boolean,
  ): void {
    const grenade = this.acquireGrenade();
    const dist = Math.hypot(targetX - startX, targetY - startY);
    grenade.startX = startX;
    grenade.startY = startY;
    grenade.targetX = targetX;
    grenade.targetY = targetY;
    grenade.elapsed = 0;
    grenade.travelTime = isBomblet ? BOMBLET_TRAVEL : Math.max(MIN_TRAVEL_TIME, dist / this.stats.speed);
    grenade.damage = damage;
    grenade.blastRadius = blastRadius;
    grenade.isBomblet = isBomblet;
    grenade.active = true;
  }

  /** First inactive grenade, else recycle the one nearest to landing (largest elapsed). */
  private acquireGrenade(): Grenade {
    for (const grenade of this.grenades) {
      if (!grenade.active) return grenade;
    }
    let oldest = this.grenades[0];
    for (const grenade of this.grenades) {
      if (grenade.elapsed > oldest.elapsed) oldest = grenade;
    }
    return oldest;
  }

  protected updateEffects(ctx: WeaponContext): void {
    this.initPool(ctx.scene);
    this.currentQuality = ctx.visualQuality;

    const gfx = this.gfx;
    if (gfx) gfx.clear();

    const evolved = this.isEvolved;
    const bodyColor = evolved ? EVOLVED_BODY_COLOR : BODY_COLOR;

    for (const grenade of this.grenades) {
      if (!grenade.active) continue;

      grenade.elapsed += ctx.deltaTime;
      const t = Math.min(grenade.elapsed / grenade.travelTime, 1);

      if (t >= 1) {
        this.detonate(ctx, grenade.targetX, grenade.targetY, grenade.damage, grenade.blastRadius, grenade.isBomblet);
        grenade.active = false;
        continue;
      }

      const x = grenade.startX + (grenade.targetX - grenade.startX) * t;
      const y = grenade.startY + (grenade.targetY - grenade.startY) * t;
      const height = ARC_HEIGHT * 4 * t * (1 - t); // parabola, peaks at t = 0.5
      if (gfx) this.drawGrenade(gfx, x, y, height, t, bodyColor);
    }
  }

  private drawGrenade(
    gfx: Phaser.GameObjects.Graphics,
    x: number, y: number, height: number, t: number, bodyColor: number,
  ): void {
    const bodyRadius = 6 * this.stats.size;
    const heightFrac = height / ARC_HEIGHT; // 0 at ground, ~1 at apex

    // Ground shadow (shrinks + fades as the grenade rises)
    gfx.fillStyle(0x000000, 0.28 * (1 - heightFrac * 0.7));
    gfx.fillEllipse(x, y, bodyRadius * 2.2 * (1 - heightFrac * 0.4), bodyRadius * 1.0 * (1 - heightFrac * 0.4));

    // Grenade body (lifted by the arc height)
    const by = y - height;
    gfx.fillStyle(bodyColor, 0.95);
    gfx.fillCircle(x, by, bodyRadius);

    if (this.currentQuality !== 'low') {
      // Highlight + a small fuse spark that pulses along the flight
      gfx.fillStyle(0xffffff, 0.7);
      gfx.fillCircle(x - bodyRadius * 0.3, by - bodyRadius * 0.3, bodyRadius * 0.35);
      const sparkPulse = 0.5 + 0.5 * Math.sin(t * Math.PI * 12);
      gfx.fillStyle(0xffef9f, 0.5 + 0.5 * sparkPulse);
      gfx.fillCircle(x, by - bodyRadius - 2, 1.6 + sparkPulse * 1.4);
    }
  }

  private detonate(
    ctx: WeaponContext,
    x: number, y: number, damage: number, radius: number, isBomblet: boolean,
  ): void {
    const spatialHash = getEnemySpatialHash();
    const radiusSq = radius * radius;
    const invRadius = 1 / radius;
    const nearby = spatialHash.queryPotential(x, y, radius + 6);
    for (const enemy of nearby) {
      const id = enemy.id;
      if (Health.current[id] <= 0) continue;
      const dx = Transform.x[id] - x;
      const dy = Transform.y[id] - y;
      const distSq = dx * dx + dy * dy;
      if (distSq > radiusSq) continue;
      const dist = Math.sqrt(distSq);
      const falloff = 1 - (dist * invRadius) * FALLOFF;
      ctx.damageEnemy(id, damage * falloff, KNOCKBACK);
    }

    this.createExplosion(ctx, x, y, radius);
    ctx.effectsManager.playHitSparks(x, y, -Math.PI / 2);

    // Screen shake for the primary grenade only — not each bomblet — to avoid shake spam.
    if (!isBomblet) {
      getJuiceManager().screenShake(this.currentQuality === 'high' ? 0.005 : 0.0035, 160);
    }

    // Mastery ("Cluster Payload"): a primary blast scatters bomblets outward.
    if (this.isMastered() && !isBomblet) {
      const bombletDamage = damage * BOMBLET_DAMAGE_FRACTION;
      const bombletRadius = radius * BOMBLET_RADIUS_FRACTION;
      for (let b = 0; b < BOMBLET_COUNT; b++) {
        const angle = (b / BOMBLET_COUNT) * Math.PI * 2 + Math.random() * 0.5;
        const dropDist = BOMBLET_SCATTER * (0.5 + Math.random() * 0.5);
        const bx = x + Math.cos(angle) * dropDist;
        const by = y + Math.sin(angle) * dropDist;
        this.launchGrenade(x, y, bx, by, bombletDamage, bombletRadius, true);
      }
    }
  }

  /** One-shot amber burst: flash + expanding filled core + stroke ring (Meteor idiom, lean). */
  private createExplosion(ctx: WeaponContext, x: number, y: number, radius: number): void {
    const quality = this.currentQuality;

    const flash = ctx.scene.add.circle(x, y, radius * 0.35, 0xffffff, 1);
    flash.setDepth(16);
    ctx.scene.tweens.add({
      targets: flash,
      scaleX: 2.4, scaleY: 2.4, alpha: 0,
      duration: 90,
      onComplete: () => flash.destroy(),
    });

    const core = ctx.scene.add.circle(x, y, radius * 0.4, BLAST_MID, 0.85);
    core.setDepth(15);
    ctx.scene.tweens.add({
      targets: core,
      scaleX: 2.5, scaleY: 2.5, alpha: 0,
      duration: 320,
      ease: 'Cubic.easeOut',
      onComplete: () => core.destroy(),
    });

    const ring = ctx.scene.add.circle(x, y, radius * 0.5, BLAST_CORE, 0.12);
    ring.setStrokeStyle(quality === 'high' ? 6 : 4, BODY_COLOR, 1);
    ring.setDepth(14);
    ctx.scene.tweens.add({
      targets: ring,
      scaleX: quality === 'high' ? 2.2 : 1.9, scaleY: quality === 'high' ? 2.2 : 1.9, alpha: 0,
      duration: 300,
      onComplete: () => ring.destroy(),
    });

    if (quality !== 'low') {
      const debrisCount = quality === 'high' ? 8 : 5;
      for (let d = 0; d < debrisCount; d++) {
        const angle = (d / debrisCount) * Math.PI * 2 + Math.random() * 0.5;
        const dist = radius * (0.5 + Math.random() * 0.5);
        const debris = ctx.scene.add.circle(x, y, 3, BODY_COLOR);
        debris.setDepth(16);
        ctx.scene.tweens.add({
          targets: debris,
          x: x + Math.cos(angle) * dist,
          y: y + Math.sin(angle) * dist - 12,
          alpha: 0,
          duration: 320 + Math.random() * 160,
          onComplete: () => debris.destroy(),
        });
      }
    }
  }

  public destroy(): void {
    if (this.gfx) {
      this.gfx.destroy();
      this.gfx = null;
    }
    this.grenades = [];
    this.poolInitialized = false;
    super.destroy();
  }
}
