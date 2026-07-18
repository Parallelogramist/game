import { BaseWeapon, WeaponContext, WeaponStats } from './BaseWeapon';
import { Transform, Health, EnemyAI } from '../ecs/components';
import { DepthLayers } from '../visual/DepthLayers';
import { VisualQuality } from '../visual/GlowGraphics';

// Reap eligibility: aiType < 50 is regular / elite / spawned. Minibosses (50-56)
// and bosses (100-112) sit at/above this floor and are NEVER reaped — they only take
// the chip hit. Destructible crates carry no EnemyAI (aiType reads 0 < 50); reaping a
// low-HP crate just triggers its normal destructible death path (loot + burst), which
// is exactly what any weapon does to a crate — harmless.
const AI_TYPE_MINIBOSS_FLOOR = 50;

const REAP_THRESHOLD = 0.2;            // reap regular/elite foes at/below 20% max HP
const REAP_THRESHOLD_MASTERED = 0.33;  // mastery "Grim Harvest" raises the cull line
const REAP_THRESHOLD_EVOLVED = 0.45;   // evolution "Deathbringer" reaps nearly half-HP crowds
const REAP_OVERKILL = 500;             // added over remaining HP to guarantee the kill
                                       // through enemy armor (a small FLAT subtraction)
const KNOCKBACK = 120;
const SWEEP_SECONDS = 0.24;            // how long the scythe crescent is drawn
const NEON = 0xff2e5e;                 // crimson reaper (distinct from cyan/gold/violet peers)
const EVOLVED_NEON = 0xff6a94;

/**
 * ReaperWeapon ("Reaper") — the arsenal's first EXECUTION weapon. Each cooldown it
 * sweeps a scythe crescent around the ship and, for every enemy within reach (the
 * universal Range stat is the radius), applies damage instantly in attack(): a modest
 * chip to everything, but a GUARANTEED KILL ("reap") to any regular/elite enemy left
 * at or below reapThreshold() of its max HP. The identity is the cull, not DPS — it
 * finishes the wounded stragglers the rest of the arsenal chips down. Minibosses and
 * bosses (aiType >= 50) are never reaped, only chipped, so the weapon is fair against
 * the intended-hard content with no per-boss tuning. Both damage paths route through
 * the shared ctx.damageEnemy pipeline — no core combat change. The reap "kill" is a
 * lethal damageEnemy call (remaining HP + REAP_OVERKILL), so it credits combo / XP /
 * gold / ultimate charge through the normal death path like any other kill.
 *
 * Instant hit + self-drawn crescent, mirroring ScattergunWeapon (no projectile-atlas
 * frame). The radial hit-test stays inline — no separate pure module or unit test.
 *
 * Mastery ("Grim Harvest"): reaps from a higher share of health (20% -> 33%).
 * Evolution ("Deathbringer", via reach): a wider, faster scythe that reaps to 45%.
 */
export class ReaperWeapon extends BaseWeapon {
  private sweepGraphics: Phaser.GameObjects.Graphics | null = null;
  private sweepAge = SWEEP_SECONDS;   // >= SWEEP_SECONDS ⇒ nothing to draw yet
  private sweepX = 0;
  private sweepY = 0;
  private sweepBaseAngle = 0;
  private sweepRadius = 130;
  private currentQuality: VisualQuality = 'high';
  private poolInitialized = false;

  constructor() {
    const baseStats: WeaponStats = {
      damage: 12,
      cooldown: 1.5,
      range: 130,   // reap radius (px) — scaled by the universal Range stat
      count: 1,     // unused — the sweep is radial (hits every enemy in reach)
      piercing: 0,  // unused — no pass-through, it hits all in reach
      size: 1,      // scales the crescent thickness
      speed: 0,     // unused — the strike is instant
      duration: 0,  // unused — the sweep lifetime is the fixed SWEEP_SECONDS const
    };

    super(
      'reaper',
      'Reaper',
      'skull-bones',
      'Sweeps a scythe that chips the crowd and reaps any weakened foe outright',
      10,
      baseStats,
      'Grim Harvest',
      'Reaps foes from a higher share of their remaining health'
    );

    // Fire the first sweep ~0.4s in rather than idling a full cooldown when the
    // Reaper is the starting weapon (mirrors Scattergun/Storm/Railgun).
    this.lastFired = -(baseStats.cooldown - 0.4);
  }

  private initPool(scene: Phaser.Scene): void {
    if (this.poolInitialized) return;
    this.poolInitialized = true;

    this.sweepGraphics = scene.add.graphics();
    this.sweepGraphics.setDepth(DepthLayers.SLASH);
  }

  /** Current reap ceiling: base, or raised by mastery / evolution. */
  private reapThreshold(): number {
    if (this.isEvolved) return REAP_THRESHOLD_EVOLVED;
    if (this.isMastered()) return REAP_THRESHOLD_MASTERED;
    return REAP_THRESHOLD;
  }

  protected attack(ctx: WeaponContext): void {
    this.initPool(ctx.scene);

    const enemies = ctx.getEnemies();

    const shipX = ctx.playerX;
    const shipY = ctx.playerY;
    const radius = this.stats.range;
    const radiusSq = radius * radius;
    const threshold = this.reapThreshold();

    let anyHit = false;
    let sparkX = 0;
    let sparkY = 0;
    let firstHitAngle = 0;

    for (const enemyId of enemies) {
      if (Health.current[enemyId] <= 0) continue;
      const offsetX = Transform.x[enemyId] - shipX;
      const offsetY = Transform.y[enemyId] - shipY;
      if (offsetX * offsetX + offsetY * offsetY > radiusSq) continue;

      const reapable =
        EnemyAI.aiType[enemyId] < AI_TYPE_MINIBOSS_FLOOR &&
        Health.current[enemyId] <= Health.max[enemyId] * threshold;

      if (reapable) {
        // Guaranteed lethal: remaining HP + overkill clears any flat armor.
        ctx.damageEnemy(enemyId, Health.current[enemyId] + REAP_OVERKILL, KNOCKBACK);
      } else {
        ctx.damageEnemy(enemyId, this.stats.damage, KNOCKBACK);
      }

      if (!anyHit) {
        anyHit = true;
        sparkX = Transform.x[enemyId];
        sparkY = Transform.y[enemyId];
        firstHitAngle = Math.atan2(offsetY, offsetX);
      }
    }

    // Kick off the crescent sweep visual, oriented toward the first foe struck.
    this.sweepX = shipX;
    this.sweepY = shipY;
    this.sweepRadius = radius;
    this.sweepBaseAngle = anyHit ? firstHitAngle : 0;
    this.sweepAge = 0;

    if (anyHit) {
      ctx.effectsManager.playHitSparks(sparkX, sparkY, firstHitAngle);
      ctx.soundManager.playHit();
    }
  }

  protected updateEffects(ctx: WeaponContext): void {
    this.initPool(ctx.scene);
    this.currentQuality = ctx.visualQuality;

    const gfx = this.sweepGraphics;
    if (!gfx) return;
    gfx.clear();
    if (this.sweepAge >= SWEEP_SECONDS) return;

    this.sweepAge += ctx.deltaTime;
    const progress = Math.min(1, this.sweepAge / SWEEP_SECONDS);
    const fade = 1 - progress;
    const evolved = this.isEvolved;
    const color = evolved ? EVOLVED_NEON : NEON;

    // The scythe crescent unfurls ~270 degrees around the player over the flash window.
    const sweptArc = Math.PI * 1.5;
    const startAngle = this.sweepBaseAngle - sweptArc / 2;
    const leadingAngle = startAngle + sweptArc * progress;
    const thickness = (evolved ? 5 : 3.5) * this.stats.size;

    // The cut already carved — a fading crescent stroke.
    gfx.lineStyle(thickness, color, 0.2 + 0.4 * fade);
    gfx.beginPath();
    gfx.arc(this.sweepX, this.sweepY, this.sweepRadius, startAngle, leadingAngle, false);
    gfx.strokePath();

    // The bright blade tip riding the leading edge.
    if (this.currentQuality !== 'low') {
      const tipX = this.sweepX + Math.cos(leadingAngle) * this.sweepRadius;
      const tipY = this.sweepY + Math.sin(leadingAngle) * this.sweepRadius;
      gfx.fillStyle(color, 0.4 * fade);
      gfx.fillCircle(tipX, tipY, thickness * 2.2);
      gfx.fillStyle(0xffffff, 0.2 + 0.7 * fade);
      gfx.fillCircle(tipX, tipY, thickness * 1.1);
    }
  }

  public destroy(): void {
    if (this.sweepGraphics) {
      this.sweepGraphics.destroy();
      this.sweepGraphics = null;
    }
    this.poolInitialized = false;
    super.destroy();
  }
}
