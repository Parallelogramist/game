import { BaseWeapon, WeaponContext, WeaponStats } from './BaseWeapon';
import { Transform } from '../ecs/components';
import { getEnemySpatialHash } from '../utils/SpatialHash';
import { getJuiceManager } from '../effects/JuiceManager';
import { DepthLayers } from '../visual/DepthLayers';
import { VisualQuality } from '../visual/GlowGraphics';
import {
  createGuardianState,
  tickGuardian,
  tryTrigger,
  computeRetaliationDamage,
  type GuardianState,
} from './guardianLogic';

const SHARD_POOL_SIZE = 48;
const SHARD_SPEED = 460;             // px/sec outward
const SHARD_MAX_TRAVEL = 300;        // px before a shard is culled (the nova radius)
const HIT_FRACTION = 0.6;            // fraction of the provoking hit added per shard
const MAX_BONUS_MULTIPLE = 1.5;      // bonus caps at 1.5× base damage
const SHARD_KNOCKBACK = 90;
const EVOLVED_KNOCKBACK = 200;       // Aegis shoves the swarm off you harder
const EVOLVED_STUN = 250;            // ms — Aegis shards briefly freeze what they hit
const MASTERY_INVULN = 0.5;          // seconds of i-frames granted on a Bulwark retaliation

const CORE = 0xffbb33;               // amber retaliation
const EVOLVED_CORE = 0x66ffee;       // Aegis: a cold defensive shield tint

interface Shard {
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
 * GuardianWeapon — the arsenal's only *reactive* weapon. Every other weapon fires
 * on a fixed cooldown timer that ticks no matter what the enemy does; the Guardian
 * fires only when the PLAYER takes a hit, retaliating with a radial nova of shards
 * that erupts from the player and knocks the swarm back. It rewards aggressive,
 * face-tank play (armor / thorns builds) instead of pure kiting — the more you
 * take the fight to the horde, the more it fires.
 *
 * The trigger gating (an internal cooldown so a multi-hit swarm can't
 * chain-detonate the orb) and the hit-scaled damage formula live in the pure,
 * unit-tested `guardianLogic` module. This class owns the pooled shards, their
 * collision, and the visual; GameScene routes player-damage events in via
 * WeaponManager.notifyPlayerDamaged → onPlayerDamaged.
 *
 * Mastery ("Bulwark"): each retaliation grants a brief shield of invulnerability.
 * Evolution ("Aegis", via vitality): a wider, harder nova whose shards knock back
 * far harder and briefly freeze what they strike.
 */
export class GuardianWeapon extends BaseWeapon {
  private trigger: GuardianState = createGuardianState();
  private shards: Shard[] = [];
  private shardGraphics: Phaser.GameObjects.Graphics | null = null;
  private currentQuality: VisualQuality = 'high';
  private poolInitialized = false;

  constructor() {
    const baseStats: WeaponStats = {
      damage: 16,
      cooldown: 1.5,   // internal retaliation cooldown (NOT a fire timer — see update())
      range: 300,      // unused directly; the nova radius is SHARD_MAX_TRAVEL
      count: 8,        // shards per nova (+1 every 2 levels)
      piercing: 2,
      size: 1,
      speed: 1,        // unused — shard speed is the fixed SHARD_SPEED
      duration: 1,     // unused
    };

    super(
      'guardian',
      'Guardian',
      'guardian',
      'A reactive orb that retaliates with a radial nova when you take damage',
      10,
      baseStats,
      'Bulwark',
      'Each retaliation grants a brief shield of invulnerability'
    );
  }

  private initPool(scene: Phaser.Scene): void {
    if (this.poolInitialized) return;
    this.poolInitialized = true;

    this.shardGraphics = scene.add.graphics();
    this.shardGraphics.setDepth(DepthLayers.PROJECTILES);

    for (let i = 0; i < SHARD_POOL_SIZE; i++) {
      this.shards.push({
        x: 0, y: 0, prevX: 0, prevY: 0,
        velocityX: 0, velocityY: 0,
        travelled: 0, damage: 0, piercing: 0,
        hitIds: new Set(),
        active: false,
      });
    }
  }

  /**
   * The Guardian is reactive, not timed: it must never fire on the cooldown clock.
   * Override update() to skip BaseWeapon's cooldown→attack machinery entirely and
   * only run the per-frame effects (cooldown tick + shard animation). attack() is
   * therefore never called; retaliation is driven by onPlayerDamaged().
   */
  public update(ctx: WeaponContext): void {
    this.updateEffects(ctx);
  }

  protected attack(_ctx: WeaponContext): void {
    // Intentionally empty — the Guardian never fires on a cooldown timer.
  }

  /**
   * Called by WeaponManager when the player takes real damage. Fires a radial
   * nova if the internal cooldown has elapsed. Returns the seconds of bonus
   * invulnerability to grant the player (the Bulwark mastery), or 0.
   */
  public onPlayerDamaged(ctx: WeaponContext, hitDamage: number): number {
    this.initPool(ctx.scene);

    const attempt = tryTrigger(this.trigger, this.stats.cooldown);
    this.trigger = attempt.state;
    if (!attempt.triggered) return 0;

    this.fireNova(ctx, hitDamage);
    return this.isMastered() ? MASTERY_INVULN : 0;
  }

  private fireNova(ctx: WeaponContext, hitDamage: number): void {
    const shardDamage = computeRetaliationDamage(
      this.stats.damage,
      hitDamage,
      HIT_FRACTION,
      MAX_BONUS_MULTIPLE
    );
    const count = Math.max(1, Math.round(this.stats.count));
    const baseAngle = Math.random() * Math.PI * 2; // vary so consecutive novas don't perfectly overlap

    for (let i = 0; i < count; i++) {
      const angle = baseAngle + (i / count) * Math.PI * 2;
      this.launchShard(ctx.playerX, ctx.playerY, angle, shardDamage);
    }

    this.drawBurst(ctx, ctx.playerX, ctx.playerY);
    getJuiceManager().screenShake(this.currentQuality === 'high' ? 0.004 : 0.002, 140);
    ctx.soundManager.playHit();
  }

  private launchShard(x: number, y: number, angle: number, damage: number): void {
    const shard = this.shards.find((s) => !s.active) ?? this.shards[0];
    if (!shard) return;

    const muzzle = 12 * this.stats.size;
    shard.x = x + Math.cos(angle) * muzzle;
    shard.y = y + Math.sin(angle) * muzzle;
    shard.prevX = shard.x;
    shard.prevY = shard.y;
    shard.velocityX = Math.cos(angle) * SHARD_SPEED;
    shard.velocityY = Math.sin(angle) * SHARD_SPEED;
    shard.travelled = 0;
    shard.damage = damage;
    shard.piercing = this.stats.piercing;
    shard.hitIds.clear();
    shard.active = true;
  }

  protected updateEffects(ctx: WeaponContext): void {
    this.initPool(ctx.scene);
    this.currentQuality = ctx.visualQuality;
    this.trigger = tickGuardian(this.trigger, ctx.deltaTime);

    if (this.shardGraphics) this.shardGraphics.clear();
    this.updateShards(ctx);
  }

  private updateShards(ctx: WeaponContext): void {
    const gfx = this.shardGraphics;
    const spatialHash = getEnemySpatialHash();
    const width = ctx.scene.scale.width;
    const height = ctx.scene.scale.height;
    const evolved = this.isEvolved;
    const color = evolved ? EVOLVED_CORE : CORE;
    const knockback = evolved ? EVOLVED_KNOCKBACK : SHARD_KNOCKBACK;
    const maxTravel = SHARD_MAX_TRAVEL * this.stats.size;
    const collisionRadius = (evolved ? 15 : 11) * this.stats.size;
    const collisionRadiusSq = collisionRadius * collisionRadius;

    for (const shard of this.shards) {
      if (!shard.active) continue;

      shard.prevX = shard.x;
      shard.prevY = shard.y;
      const stepX = shard.velocityX * ctx.deltaTime;
      const stepY = shard.velocityY * ctx.deltaTime;
      shard.x += stepX;
      shard.y += stepY;
      shard.travelled += Math.hypot(stepX, stepY);

      if (
        shard.travelled > maxTravel ||
        shard.x < -50 || shard.x > width + 50 ||
        shard.y < -50 || shard.y > height + 50
      ) {
        shard.active = false;
        continue;
      }

      const nearby = spatialHash.queryPotential(shard.x, shard.y, collisionRadius + 6);
      for (const enemy of nearby) {
        if (shard.hitIds.has(enemy.id)) continue;
        const dx = Transform.x[enemy.id] - shard.x;
        const dy = Transform.y[enemy.id] - shard.y;
        if (dx * dx + dy * dy >= collisionRadiusSq) continue;

        ctx.damageEnemy(enemy.id, shard.damage, knockback);
        if (evolved) ctx.stunEnemy(enemy.id, EVOLVED_STUN);
        ctx.effectsManager.playHitSparks(shard.x, shard.y, Math.atan2(shard.velocityY, shard.velocityX));
        shard.hitIds.add(enemy.id);
        if (shard.hitIds.size > shard.piercing) {
          shard.active = false;
          break;
        }
      }
      if (!shard.active) continue;

      if (gfx) {
        // Fade toward the rim so the nova reads as spending itself outward.
        const fade = 1 - Math.min(1, shard.travelled / maxTravel) * 0.6;
        gfx.lineStyle(evolved ? 3.5 : 2.5, color, 0.85 * fade);
        gfx.lineBetween(shard.prevX, shard.prevY, shard.x, shard.y);
        gfx.fillStyle(0xffffff, 0.9 * fade);
        gfx.fillCircle(shard.x, shard.y, evolved ? 2.5 : 2);
      }
    }
  }

  private drawBurst(ctx: WeaponContext, x: number, y: number): void {
    const color = this.isEvolved ? EVOLVED_CORE : CORE;

    const flash = ctx.scene.add.circle(x, y, 14 * this.stats.size, 0xffffff, 0.85);
    flash.setDepth(DepthLayers.PROJECTILES);
    ctx.scene.tweens.add({
      targets: flash,
      scaleX: 2.4,
      scaleY: 2.4,
      alpha: 0,
      duration: 160,
      onComplete: () => flash.destroy(),
    });

    const ring = ctx.scene.add.circle(x, y, 18 * this.stats.size, color, 0);
    ring.setStrokeStyle(3, color, 0.9);
    ring.setDepth(DepthLayers.PROJECTILES);
    ctx.scene.tweens.add({
      targets: ring,
      scaleX: 3,
      scaleY: 3,
      alpha: 0,
      duration: 260,
      ease: 'Cubic.easeOut',
      onComplete: () => ring.destroy(),
    });
  }

  protected recalculateStats(): void {
    super.recalculateStats();
    // The orb re-arms a touch faster as it levels, so it retaliates more often.
    this.stats.cooldown = Math.max(0.9, this.baseStats.cooldown - (this.level - 1) * 0.08);
  }

  public destroy(): void {
    if (this.shardGraphics) {
      this.shardGraphics.destroy();
      this.shardGraphics = null;
    }
    this.shards = [];
    this.poolInitialized = false;
    super.destroy();
  }
}
