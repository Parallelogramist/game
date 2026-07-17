import { BaseWeapon, WeaponContext, WeaponStats } from './BaseWeapon';
import { Transform } from '../ecs/components';
import { DepthLayers } from '../visual/DepthLayers';
import { VisualQuality } from '../visual/GlowGraphics';
import { HitCooldownTracker } from './WeaponUtils';
import { isEnemyInBeam } from './sweepBeamLogic';

const ROTATION_SPEED = 2.4;        // rad/sec — a full sweep every ~2.6s (readable, not dizzying)
const EVOLVED_ROTATION_MULT = 1.4; // Corona scythes faster
const HALF_WIDTH_BASE = 16;        // px half-width (× size); full beam width = 2×
const MASTERY_WIDTH_MULT = 1.35;   // Solar Flare widens the sweep
const KNOCKBACK = 40;              // light radial shove (a beam is not a blast)
const EVOLVED_KNOCKBACK = 90;
const SPARK_CHANCE = 0.25;         // hit-spark probability per damaging tick
const CLEANUP_CHANCE = 0.01;       // amortized cooldown-map pruning (mirrors Aura)
const CLEANUP_MAX_AGE = 5;
const CORE = 0x66ddff;             // cyan beam core
const EDGE = 0xffffff;             // hot white centerline
const EVOLVED_CORE = 0xffdd55;     // corona gold

/**
 * SweepBeamWeapon ("Arc Sweep") — a continuous beam anchored at the ship that rotates
 * around the player, dealing tick damage to every enemy its line crosses. The arsenal's
 * only *rotating line*: laser is a cursor-aimed burst, aura is a full zone, orbiting
 * blades are discrete points, pulse is expanding rings. Aim-free coverage that scales
 * with spoke count.
 *
 * Damage model mirrors Aura: `attack()` is a no-op, `updateEffects()` does per-frame
 * tick damage gated per-enemy by `stats.cooldown` (the tick interval). The beam(s) and
 * all visuals are self-drawn into one shared Graphics (no projectile-atlas frame).
 *
 * Mastery ("Solar Flare"): +1 beam spoke and a 35% wider sweep.
 * Evolution ("Corona", via Haste): more/wider/faster/harder spokes.
 */
export class SweepBeamWeapon extends BaseWeapon {
  private angle = 0;
  private beamGraphics: Phaser.GameObjects.Graphics | null = null;
  private hitCooldowns = new HitCooldownTracker();
  private currentQuality: VisualQuality = 'high';

  constructor() {
    const baseStats: WeaponStats = {
      damage: 8,
      cooldown: 0.35,   // per-enemy damage tick interval (like Aura), not a fire gate
      range: 190,       // beam length (px) — scaled by the universal Reach stat
      count: 1,         // rotating spokes (+1 every 2 weapon levels via base formula)
      piercing: 999,    // unused — a beam hits every enemy on its line
      size: 1,          // scales beam width
      speed: 0,         // unused — rotation speed is a fixed constant
      duration: 999,    // unused — the beam is continuous
    };

    super(
      'sweep_beam',
      'Arc Sweep',
      'sweep_beam',
      'A radiant beam sweeps around your ship, searing everything it crosses',
      10,
      baseStats,
      'Solar Flare',
      'Adds a beam and widens the sweep',
    );
  }

  private ensureGraphics(scene: Phaser.Scene): void {
    if (this.beamGraphics) return;
    this.beamGraphics = scene.add.graphics();
    this.beamGraphics.setDepth(DepthLayers.GROUND_EFFECTS);
  }

  protected attack(_ctx: WeaponContext): void {
    // Continuous weapon — no discrete attack; damage is dealt per-frame in updateEffects.
  }

  protected updateEffects(ctx: WeaponContext): void {
    this.ensureGraphics(ctx.scene);
    this.currentQuality = ctx.visualQuality;

    const evolved = this.isEvolved;
    const rotMult = evolved ? EVOLVED_ROTATION_MULT : 1;
    this.angle += ROTATION_SPEED * rotMult * ctx.deltaTime;
    if (this.angle > Math.PI * 2) this.angle -= Math.PI * 2;

    const spokes = Math.max(1, this.stats.count + (this.isMastered() ? 1 : 0));
    const length = this.stats.range;
    const halfWidth = HALF_WIDTH_BASE * this.stats.size * (this.isMastered() ? MASTERY_WIDTH_MULT : 1);
    const knockback = evolved ? EVOLVED_KNOCKBACK : KNOCKBACK;
    const step = (Math.PI * 2) / spokes;
    const time = ctx.gameTime;

    const enemies = ctx.getEnemies();
    for (let k = 0; k < spokes; k++) {
      const spokeAngle = this.angle + k * step;
      const cos = Math.cos(spokeAngle);
      const sin = Math.sin(spokeAngle);
      for (const enemyId of enemies) {
        const ex = Transform.x[enemyId];
        const ey = Transform.y[enemyId];
        if (!isEnemyInBeam(ex, ey, ctx.playerX, ctx.playerY, cos, sin, length, halfWidth)) continue;
        if (!this.hitCooldowns.canHit(enemyId, time, this.stats.cooldown)) continue;
        ctx.damageEnemy(enemyId, this.stats.damage, knockback);
        this.hitCooldowns.recordHit(enemyId, time);
        if (Math.random() < SPARK_CHANCE) ctx.effectsManager.playHitSparks(ex, ey, spokeAngle);
      }
    }

    this.drawBeams(ctx, spokes, step, length, halfWidth, evolved);

    if (Math.random() < CLEANUP_CHANCE) this.hitCooldowns.cleanup(time, CLEANUP_MAX_AGE);
  }

  private drawBeams(
    ctx: WeaponContext,
    spokes: number,
    step: number,
    length: number,
    halfWidth: number,
    evolved: boolean,
  ): void {
    const gfx = this.beamGraphics;
    if (!gfx) return;
    gfx.clear();

    const color = evolved ? EVOLVED_CORE : CORE;
    const px = ctx.playerX;
    const py = ctx.playerY;
    const lowQuality = this.currentQuality === 'low';

    for (let k = 0; k < spokes; k++) {
      const spokeAngle = this.angle + k * step;
      const ex = px + Math.cos(spokeAngle) * length;
      const ey = py + Math.sin(spokeAngle) * length;

      if (!lowQuality) {
        gfx.lineStyle(halfWidth * 2, color, 0.08);
        gfx.lineBetween(px, py, ex, ey);
      }
      gfx.lineStyle(halfWidth, color, 0.22);
      gfx.lineBetween(px, py, ex, ey);
      gfx.lineStyle(3, EDGE, 0.85);
      gfx.lineBetween(px, py, ex, ey);
      gfx.fillStyle(EDGE, 0.9);
      gfx.fillCircle(ex, ey, 3);
    }
  }

  public destroy(): void {
    if (this.beamGraphics) {
      this.beamGraphics.destroy();
      this.beamGraphics = null;
    }
    this.hitCooldowns.clear();
    super.destroy();
  }
}
