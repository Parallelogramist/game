import { BaseWeapon, WeaponContext, WeaponStats } from './BaseWeapon';
import { Transform } from '../ecs/components';
import { getEnemySpatialHash } from '../utils/SpatialHash';
import { DepthLayers } from '../visual/DepthLayers';
import { VisualQuality } from '../visual/GlowGraphics';

const STRIKE_POOL_SIZE = 24;
const BOLT_HEIGHT = 170;      // px the bolt descends from above its impact point
const BOLT_SEGMENTS = 6;      // jag segments per bolt polyline
const BOLT_JITTER = 12;       // px max horizontal jag offset per segment
const FLASH_SECONDS = 0.18;   // how long a bolt + impact glow is drawn
const KNOCKBACK = 40;
const STUN_SECONDS = 0.4;     // mastery (Thunderclap): brief stun on strike
const NEON = 0x9fd0ff;        // pale electric blue
const EVOLVED_NEON = 0xe6f4ff;

interface Strike {
  points: number[];   // flat [x0,y0,x1,y1,...] top -> impact, jagged
  impactX: number;
  impactY: number;
  radius: number;     // splash radius at spawn (drives the impact-glow size)
  age: number;        // seconds since spawn
  active: boolean;
}

/**
 * StormWeapon ("Storm Caller") — the arsenal's only *global random-strike*. Each
 * cooldown calls down a volley of lightning bolts on random enemies anywhere on the
 * field, each zapping a small area around where it lands. Unlike Meteor (which
 * telegraphs a slow, heavy bomb onto the densest cluster within player range), Storm
 * strikes instantly, fast, and everywhere — reaching the scattered stragglers that the
 * ship-centric weapons never touch. Damage is applied instantly in attack(); the
 * pooled Strike objects are purely the visual, advanced and redrawn each frame into a
 * single shared Graphics (the self-drawing pattern of the other recent weapons, so no
 * projectile-atlas frame is required). The splash hit-test is trivial and stays inline
 * — no separate pure module or unit test.
 *
 * Mastery ("Thunderclap"): enemies a bolt strikes are briefly stunned.
 * Evolution ("Maelstrom", via multishot): more, harder bolts over a wider blast.
 */
export class StormWeapon extends BaseWeapon {
  private strikes: Strike[] = [];
  private boltGraphics: Phaser.GameObjects.Graphics | null = null;
  private currentQuality: VisualQuality = 'high';
  private poolInitialized = false;

  constructor() {
    const baseStats: WeaponStats = {
      damage: 18,
      cooldown: 1.6,
      range: 44,     // per-bolt splash radius (px) — scaled by the universal Range stat
      count: 1,      // bolts per volley (+1 every 2 weapon levels via base formula -> 5 at Lv10)
      piercing: 0,   // unused — a bolt hits every enemy in its splash, once
      size: 1,       // scales splash radius and bolt line thickness
      speed: 0,      // unused — strikes are instant (scalesProjectileSpeed stays false)
      duration: 0,   // unused — flash lifetime is the fixed FLASH_SECONDS const
    };

    super(
      'storm',
      'Storm Caller',
      'storm',
      'Calls down lightning on enemies anywhere on the field',
      10,
      baseStats,
      'Thunderclap',
      'Enemies struck by a lightning bolt are briefly stunned'
    );

    // Fire the first volley ~0.4s in rather than leaving a Storm starting weapon idle
    // for a full 1.6s (mirrors Pulse).
    this.lastFired = -(baseStats.cooldown - 0.4);
  }

  private initPool(scene: Phaser.Scene): void {
    if (this.poolInitialized) return;
    this.poolInitialized = true;

    this.boltGraphics = scene.add.graphics();
    this.boltGraphics.setDepth(DepthLayers.METEOR);

    for (let i = 0; i < STRIKE_POOL_SIZE; i++) {
      this.strikes.push({
        points: [], impactX: 0, impactY: 0, radius: 0, age: 0, active: false,
      });
    }
  }

  protected attack(ctx: WeaponContext): void {
    this.initPool(ctx.scene);

    const enemies = ctx.getEnemies();
    if (enemies.length === 0) return;

    const boltCount = this.stats.count;
    const splash = this.stats.range;
    const mastered = this.isMastered();
    const spatialHash = getEnemySpatialHash();

    for (let boltIndex = 0; boltIndex < boltCount; boltIndex++) {
      const targetId = enemies[Math.floor(Math.random() * enemies.length)];
      const impactX = Transform.x[targetId];
      const impactY = Transform.y[targetId];

      const nearby = spatialHash.queryPotential(impactX, impactY, splash + 6);
      for (const enemy of nearby) {
        const dx = Transform.x[enemy.id] - impactX;
        const dy = Transform.y[enemy.id] - impactY;
        if (dx * dx + dy * dy > splash * splash) continue;
        ctx.damageEnemy(enemy.id, this.stats.damage, KNOCKBACK);
        if (mastered) ctx.stunEnemy(enemy.id, STUN_SECONDS);
      }

      ctx.effectsManager.playHitSparks(impactX, impactY, -Math.PI / 2);
      this.spawnStrike(impactX, impactY, splash);
    }

    ctx.soundManager.playHit();
  }

  private spawnStrike(impactX: number, impactY: number, radius: number): void {
    const strike = this.acquireStrike();
    strike.impactX = impactX;
    strike.impactY = impactY;
    strike.radius = radius;
    strike.age = 0;
    strike.active = true;

    // Jagged bolt from BOLT_HEIGHT above the impact down to it; no jitter at the tip
    // so the bolt visually lands exactly on the strike point.
    strike.points.length = 0;
    for (let seg = 0; seg <= BOLT_SEGMENTS; seg++) {
      const t = seg / BOLT_SEGMENTS;
      const y = impactY - BOLT_HEIGHT * (1 - t);
      const jitter = seg === BOLT_SEGMENTS ? 0 : (Math.random() - 0.5) * 2 * BOLT_JITTER;
      strike.points.push(impactX + jitter, y);
    }
  }

  /** First inactive strike, else recycle the oldest (largest age). */
  private acquireStrike(): Strike {
    for (const strike of this.strikes) {
      if (!strike.active) return strike;
    }
    let oldest = this.strikes[0];
    for (const strike of this.strikes) {
      if (strike.age > oldest.age) oldest = strike;
    }
    return oldest;
  }

  protected updateEffects(ctx: WeaponContext): void {
    this.initPool(ctx.scene);
    this.currentQuality = ctx.visualQuality;

    const gfx = this.boltGraphics;
    if (gfx) gfx.clear();

    const evolved = this.isEvolved;
    const color = evolved ? EVOLVED_NEON : NEON;

    for (const strike of this.strikes) {
      if (!strike.active) continue;

      strike.age += ctx.deltaTime;
      if (strike.age >= FLASH_SECONDS) {
        strike.active = false;
        continue;
      }

      if (gfx) this.drawStrike(gfx, strike, color, evolved);
    }
  }

  private drawStrike(
    gfx: Phaser.GameObjects.Graphics,
    strike: Strike,
    color: number,
    evolved: boolean
  ): void {
    const fade = 1 - strike.age / FLASH_SECONDS;
    const alpha = 0.25 + 0.75 * fade;
    const width = (evolved ? 3.5 : 2.5) * this.stats.size;

    gfx.lineStyle(width, color, alpha);
    gfx.beginPath();
    gfx.moveTo(strike.points[0], strike.points[1]);
    for (let p = 2; p < strike.points.length; p += 2) {
      gfx.lineTo(strike.points[p], strike.points[p + 1]);
    }
    gfx.strokePath();

    if (this.currentQuality !== 'low') {
      gfx.lineStyle(1, 0xffffff, alpha * 0.8);
      gfx.beginPath();
      gfx.moveTo(strike.points[0], strike.points[1]);
      for (let p = 2; p < strike.points.length; p += 2) {
        gfx.lineTo(strike.points[p], strike.points[p + 1]);
      }
      gfx.strokePath();
    }

    const glowRadius = strike.radius * (0.5 + 0.5 * fade);
    gfx.fillStyle(color, alpha * 0.35);
    gfx.fillCircle(strike.impactX, strike.impactY, glowRadius);
    gfx.fillStyle(0xffffff, alpha * 0.5);
    gfx.fillCircle(strike.impactX, strike.impactY, glowRadius * 0.35);
  }

  public destroy(): void {
    if (this.boltGraphics) {
      this.boltGraphics.destroy();
      this.boltGraphics = null;
    }
    this.strikes = [];
    this.poolInitialized = false;
    super.destroy();
  }
}
