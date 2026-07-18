import { BaseWeapon, WeaponContext, WeaponStats } from './BaseWeapon';
import { Transform } from '../ecs/components';
import { getEnemySpatialHash } from '../utils/SpatialHash';
import { DepthLayers } from '../visual/DepthLayers';
import { HitCooldownTracker } from './WeaponUtils';
import { VisualQuality } from '../visual/GlowGraphics';

const ORB_COLOR = 0x66aaff;         // steel-blue orbs
const EVOLVED_ORB_COLOR = 0xff7733; // hot "devastator" orange
const BASE_KNOCKBACK = 220;
const EVOLVED_KNOCKBACK = 320;
const ORB_HIT_RADIUS = 16;          // px, scaled by size — orb sweep hit radius
const ENEMY_PAD = 14;               // enemy body radius pad for the hit query

/**
 * FlailWeapon ("Wrecking Orbs") — the arsenal's second orbital, and a deliberate
 * counterpoint to Orbiting Blades. Blades are many small, fast, low-damage cutters
 * hugging the hull; the flail is a *pair of heavy orbs swung on long tethers* — few,
 * slow, hard-hitting, reaching far past the ship. Each orb grinds any enemy it sweeps
 * for big damage and a heavy shove (per-enemy hit cooldown), so the wide orbit becomes
 * a rotating wall that clears breathing room. Fills the orbital mastery category
 * (previously Orbiting Blades alone).
 *
 * Self-drawn into a single Graphics (orbit ring + tethers + orbs), matching the recent
 * self-drawing weapons (Mine/Pulse/Wake) — no per-orb Container, no atlas frame.
 *
 * Mastery ("Twin Comets"): adds a third orb and orbs hit 40% harder.
 * Evolution ("Devastator Orbs", via Reach): a wider, heavier, larger orbit.
 */
export class FlailWeapon extends BaseWeapon {
  private orbAngles: number[] = [];
  private orbitRadius = 110;
  private rotationSpeed = 1.6;
  private hitCooldowns = new HitCooldownTracker();
  private graphics: Phaser.GameObjects.Graphics | null = null;
  private currentQuality: VisualQuality = 'high';

  constructor() {
    const baseStats: WeaponStats = {
      damage: 26,
      cooldown: 0.5,   // per-enemy hit cooldown (orbital convention, see OrbitingBlades)
      range: 110,      // orbit radius (scaled by the universal Reach stat)
      count: 2,        // orb count (+1 every 2 weapon levels)
      piercing: 999,   // sweeps through everything it touches
      size: 1,         // orb body + hit radius
      speed: 1.6,      // rotation speed (rad/s)
      duration: 999,   // persistent
    };

    super(
      'flail',
      'Wrecking Orbs',
      'flail',
      'Heavy orbs orbit far out, grinding and hurling back all they sweep',
      10,
      baseStats,
      'Twin Comets',
      'Adds a third orb and orbs hit 40% harder',
    );

    this.orbitRadius = baseStats.range;
    this.rotationSpeed = baseStats.speed;
  }

  protected attack(_ctx: WeaponContext): void {
    // Continuous orbital — all damage is dealt in updateEffects.
  }

  protected updateEffects(ctx: WeaponContext): void {
    this.currentQuality = ctx.visualQuality;
    this.ensureOrbCount();

    if (!this.graphics) {
      this.graphics = ctx.scene.add.graphics();
      this.graphics.setDepth(DepthLayers.BLADE);
    }
    const gfx = this.graphics;
    gfx.clear();

    const evolved = this.isEvolved;
    const color = evolved ? EVOLVED_ORB_COLOR : ORB_COLOR;
    const knockback = evolved ? EVOLVED_KNOCKBACK : BASE_KNOCKBACK;
    const damage = this.stats.damage * (this.isMastered() ? 1.4 : 1);
    const hitRadius = ORB_HIT_RADIUS * this.stats.size;
    const orbBody = (evolved ? 11 : 9) * this.stats.size;
    const spatialHash = getEnemySpatialHash();
    const currentTime = ctx.gameTime;

    // Faint orbit ring (skip on low quality).
    if (this.currentQuality !== 'low') {
      gfx.lineStyle(1, color, 0.08);
      gfx.strokeCircle(ctx.playerX, ctx.playerY, this.orbitRadius);
    }

    const hitRange = hitRadius + ENEMY_PAD;
    for (let orbIndex = 0; orbIndex < this.orbAngles.length; orbIndex++) {
      this.orbAngles[orbIndex] += this.rotationSpeed * ctx.deltaTime;
      const angle = this.orbAngles[orbIndex];
      const orbX = ctx.playerX + Math.cos(angle) * this.orbitRadius;
      const orbY = ctx.playerY + Math.sin(angle) * this.orbitRadius;

      // Tether line player -> orb.
      gfx.lineStyle(2 * this.stats.size, color, 0.5);
      gfx.beginPath();
      gfx.moveTo(ctx.playerX, ctx.playerY);
      gfx.lineTo(orbX, orbY);
      gfx.strokePath();

      // Orb body + glow + white core.
      if (this.currentQuality !== 'low') {
        gfx.fillStyle(color, 0.25);
        gfx.fillCircle(orbX, orbY, orbBody + 5);
      }
      gfx.fillStyle(color, 0.9);
      gfx.fillCircle(orbX, orbY, orbBody);
      gfx.fillStyle(0xffffff, 0.9);
      gfx.fillCircle(orbX, orbY, orbBody * 0.35);

      // Sweep collision (per-enemy hit cooldown, so a lingering enemy is re-hit on cadence).
      const nearby = spatialHash.queryPotential(orbX, orbY, hitRange);
      for (const enemy of nearby) {
        if (!this.hitCooldowns.canHit(enemy.id, currentTime, this.stats.cooldown)) continue;
        const dx = Transform.x[enemy.id] - orbX;
        const dy = Transform.y[enemy.id] - orbY;
        if (dx * dx + dy * dy > hitRange * hitRange) continue;
        ctx.damageEnemy(enemy.id, damage, knockback);
        this.hitCooldowns.recordHit(enemy.id, currentTime);
        ctx.effectsManager.playHitSparks(orbX, orbY, angle);
      }
    }

    if (Math.random() < 0.01) this.hitCooldowns.cleanup(currentTime, 5);
  }

  /** Keep the orb-angle array sized to count (+1 when mastered), evenly spaced. */
  private ensureOrbCount(): void {
    const target = this.stats.count + (this.isMastered() ? 1 : 0);
    const changed = this.orbAngles.length !== target;
    while (this.orbAngles.length < target) this.orbAngles.push(0);
    while (this.orbAngles.length > target) this.orbAngles.pop();
    if (changed && this.orbAngles.length > 0) {
      const base = this.orbAngles[0];
      const step = (Math.PI * 2) / this.orbAngles.length;
      for (let i = 0; i < this.orbAngles.length; i++) this.orbAngles[i] = base + step * i;
    }
  }

  protected recalculateStats(): void {
    super.recalculateStats();
    // More orbs / faster spin / wider orbit at higher levels (mirrors OrbitingBlades).
    this.stats.count = this.baseStats.count + Math.floor((this.level - 1) / 2) + this.externalBonusCount;
    this.stats.speed = this.baseStats.speed + (this.level - 1) * 0.2;
    this.stats.range = this.baseStats.range + (this.level - 1) * 10;
    this.orbitRadius = this.stats.range;
    this.rotationSpeed = this.stats.speed;
  }

  protected applyExternalScaling(): void {
    super.applyExternalScaling();
    // Re-derive cached orbit fields from post-scaling stats so the universal Reach
    // (range) multiplier actually reaches the orbit radius.
    this.orbitRadius = this.stats.range;
    this.rotationSpeed = this.stats.speed;
  }

  public destroy(): void {
    if (this.graphics) {
      this.graphics.destroy();
      this.graphics = null;
    }
    this.orbAngles = [];
    this.hitCooldowns.clear();
    super.destroy();
  }
}
