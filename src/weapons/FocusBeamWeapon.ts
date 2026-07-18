import { BaseWeapon, WeaponContext, WeaponStats } from './BaseWeapon';
import { Transform, Health } from '../ecs/components';
import { DepthLayers } from '../visual/DepthLayers';
import { VisualQuality } from '../visual/GlowGraphics';

const BEAM_POOL_SIZE = 6;           // hard cap on simultaneous beams
const TICK_INTERVAL = 0.2;          // seconds between damage ticks per beam
const RAMP_TIME = 2.5;              // seconds of continuous lock to reach full heat
const RAMP_MIN = 0.6;               // damage multiplier at a fresh lock
const RAMP_MAX = 2.2;               // damage multiplier at full heat
const LOCK_HYSTERESIS = 1.15;       // keep a lock until the target exceeds range × this
const MELT_SPLASH_RADIUS = 70;      // mastery: cleave radius at full heat (× size)
const MELT_SPLASH_FRACTION = 0.5;   // mastery: fraction of tick damage dealt to splashed enemies
const NEON = 0xc060ff;              // fusion violet (distinct from cyan/gold/red beams)
const EVOLVED_NEON = 0xe89bff;

interface Beam {
  targetId: number;    // -1 when unlocked
  lockElapsed: number; // seconds locked continuously to the current target
  tickTimer: number;   // accumulates toward TICK_INTERVAL
}

/**
 * FocusBeamWeapon ("Focus Beam") — the arsenal's only *sustained ramping lock-on beam*.
 * Always-on (no cooldown): each frame every beam locks the nearest live enemy in range and
 * burns hotter the longer it stays connected to the SAME target, snapping to a new target
 * the instant the current one dies or leaves range. A hold-to-melt anti-elite/boss DPS tool,
 * the inverse of the arsenal's aim-free crowd-clear. Unlike Laser (cursor-aimed, fixed),
 * Railgun (a discrete burst on the toughest enemy), Sweep (a rotating full beam) or
 * Flamethrower (a cone DoT), it maintains a lock and its damage ramps with connection time.
 *
 * Stat repurposing: `damage` is the per-TICK base damage (before ramp), not per second;
 * `range` is beam reach; `count` is the number of simultaneous beams/locks (from multishot +
 * the evolution — NOT from weapon level, so leveling boosts heat, not focus). `cooldown`,
 * `piercing`, `speed`, `duration` are unused. Damage is applied on a fixed tick (mirrors
 * Aura/Wake DoT cadence) so a continuous beam doesn't spam the damage pipeline every frame.
 * Deliberately silent per tick (no per-tick SFX/sparks — the growing impact glow is the
 * contact feedback), matching Wake.
 *
 * Mastery ("Meltdown"): a fully-heated beam cleaves its tick damage to enemies around the
 * target. Evolution ("Fusion Lance", via might): harder, longer, thicker, and +1 lock.
 */
export class FocusBeamWeapon extends BaseWeapon {
  private beams: Beam[] = [];
  private gfx: Phaser.GameObjects.Graphics | null = null;
  private currentQuality: VisualQuality = 'high';
  private poolInitialized = false;

  constructor() {
    const baseStats: WeaponStats = {
      damage: 8,     // per-TICK base damage before ramp — NOT per second (see class doc)
      cooldown: 0,   // unused — the beam is continuous (update() skips the cooldown loop)
      range: 340,    // beam reach (px) — scaled by the universal Reach stat
      count: 1,      // simultaneous locked beams (+ multishot / evolution; NOT per weapon level)
      piercing: 0,   // unused
      size: 1,       // scales beam thickness + mastery splash radius
      speed: 0,      // unused
      duration: 0,   // unused
    };

    super(
      'focus',
      'Focus Beam',
      'focus',
      'A sustained beam that locks the nearest enemy and burns hotter the longer it holds',
      10,
      baseStats,
      'Meltdown',
      'A fully-heated beam splashes its damage to enemies around the target',
    );
  }

  private initPool(scene: Phaser.Scene): void {
    if (this.poolInitialized) return;
    this.poolInitialized = true;

    this.gfx = scene.add.graphics();
    this.gfx.setDepth(DepthLayers.METEOR);

    for (let i = 0; i < BEAM_POOL_SIZE; i++) {
      this.beams.push({ targetId: -1, lockElapsed: 0, tickTimer: 0 });
    }
  }

  /** Continuous weapon: bypass BaseWeapon's cooldown→attack machinery entirely. */
  public update(ctx: WeaponContext): void {
    this.updateEffects(ctx);
  }

  protected attack(_ctx: WeaponContext): void {
    // Never called — update() skips the cooldown loop.
  }

  protected recalculateStats(): void {
    super.recalculateStats();
    // Leveling boosts damage/heat, not beam count. Extra beams come only from multishot
    // (externalBonusCount) and the evolution's additive count bonus.
    this.stats.count = this.baseStats.count + this.externalBonusCount;
  }

  protected updateEffects(ctx: WeaponContext): void {
    this.initPool(ctx.scene);
    this.currentQuality = ctx.visualQuality;

    const gfx = this.gfx;
    if (gfx) gfx.clear();

    const enemies = ctx.getEnemies();
    const liveEnemies = new Set<number>();
    for (const id of enemies) {
      if (Health.current[id] > 0) liveEnemies.add(id);
    }

    const activeBeams = Math.max(1, Math.min(BEAM_POOL_SIZE, this.stats.count));
    const range = this.stats.range;
    const keepRange = range * LOCK_HYSTERESIS;
    const keepRangeSq = keepRange * keepRange;
    const acquireRangeSq = range * range;

    // 1) Retire beams above the active count; validate remaining locks.
    for (let i = 0; i < this.beams.length; i++) {
      const beam = this.beams[i];
      if (i >= activeBeams) {
        beam.targetId = -1;
        beam.lockElapsed = 0;
        beam.tickTimer = 0;
        continue;
      }
      if (beam.targetId >= 0) {
        const stillValid =
          liveEnemies.has(beam.targetId) && this.distSq(ctx, beam.targetId) <= keepRangeSq;
        if (!stillValid) {
          beam.targetId = -1;
          beam.lockElapsed = 0;
          beam.tickTimer = 0;
        }
      }
    }

    // 2) Acquire a target for each unlocked active beam — nearest live enemy not already
    //    held by another beam (falls back to nearest if every enemy is already held).
    const held = new Set<number>();
    for (let i = 0; i < activeBeams; i++) {
      if (this.beams[i].targetId >= 0) held.add(this.beams[i].targetId);
    }
    for (let i = 0; i < activeBeams; i++) {
      const beam = this.beams[i];
      if (beam.targetId >= 0) continue;
      const target = this.acquireTarget(ctx, liveEnemies, held, acquireRangeSq);
      if (target >= 0) {
        beam.targetId = target;
        beam.lockElapsed = 0;
        beam.tickTimer = 0;
        held.add(target);
      }
    }

    // 3) Ramp, tick damage, and draw each active locked beam.
    const evolved = this.isEvolved;
    const color = evolved ? EVOLVED_NEON : NEON;
    const mastered = this.isMastered();
    for (let i = 0; i < activeBeams; i++) {
      const beam = this.beams[i];
      if (beam.targetId < 0) continue;

      beam.lockElapsed += ctx.deltaTime;
      const rampT = Math.min(beam.lockElapsed / RAMP_TIME, 1);
      const rampMult = RAMP_MIN + (RAMP_MAX - RAMP_MIN) * rampT;

      beam.tickTimer += ctx.deltaTime;
      if (beam.tickTimer >= TICK_INTERVAL) {
        beam.tickTimer -= TICK_INTERVAL;
        this.tickDamage(ctx, beam.targetId, rampMult, rampT, mastered, liveEnemies);
      }

      if (gfx) this.drawBeam(gfx, ctx, beam.targetId, color, rampT, evolved);
    }
  }

  private distSq(ctx: WeaponContext, enemyId: number): number {
    const dx = Transform.x[enemyId] - ctx.playerX;
    const dy = Transform.y[enemyId] - ctx.playerY;
    return dx * dx + dy * dy;
  }

  private acquireTarget(
    ctx: WeaponContext,
    liveEnemies: Set<number>,
    held: Set<number>,
    acquireRangeSq: number,
  ): number {
    let bestUnheld = -1;
    let bestUnheldDist = Infinity;
    let bestAny = -1;
    let bestAnyDist = Infinity;
    for (const id of liveEnemies) {
      const d = this.distSq(ctx, id);
      if (d > acquireRangeSq) continue;
      if (d < bestAnyDist) {
        bestAnyDist = d;
        bestAny = id;
      }
      if (!held.has(id) && d < bestUnheldDist) {
        bestUnheldDist = d;
        bestUnheld = id;
      }
    }
    return bestUnheld >= 0 ? bestUnheld : bestAny;
  }

  private tickDamage(
    ctx: WeaponContext,
    target: number,
    rampMult: number,
    rampT: number,
    mastered: boolean,
    liveEnemies: Set<number>,
  ): void {
    const tickDamage = this.stats.damage * rampMult;
    ctx.damageEnemy(target, tickDamage, 0);

    // Mastery ("Meltdown"): a fully-heated beam cleaves to nearby enemies.
    if (mastered && rampT >= 1) {
      const splashRadius = MELT_SPLASH_RADIUS * this.stats.size;
      const splashSq = splashRadius * splashRadius;
      const splashDamage = tickDamage * MELT_SPLASH_FRACTION;
      const tx = Transform.x[target];
      const ty = Transform.y[target];
      for (const id of liveEnemies) {
        if (id === target) continue;
        const dx = Transform.x[id] - tx;
        const dy = Transform.y[id] - ty;
        if (dx * dx + dy * dy <= splashSq) ctx.damageEnemy(id, splashDamage, 0);
      }
    }
  }

  private drawBeam(
    gfx: Phaser.GameObjects.Graphics,
    ctx: WeaponContext,
    target: number,
    color: number,
    rampT: number,
    evolved: boolean,
  ): void {
    const tx = Transform.x[target];
    const ty = Transform.y[target];
    const width = (evolved ? 3 : 2) * this.stats.size * (0.7 + 0.9 * rampT);
    const alpha = 0.45 + 0.5 * rampT;

    gfx.lineStyle(width, color, alpha);
    gfx.beginPath();
    gfx.moveTo(ctx.playerX, ctx.playerY);
    gfx.lineTo(tx, ty);
    gfx.strokePath();

    if (this.currentQuality !== 'low') {
      gfx.lineStyle(Math.max(1, width * 0.4), 0xffffff, alpha * 0.8);
      gfx.beginPath();
      gfx.moveTo(ctx.playerX, ctx.playerY);
      gfx.lineTo(tx, ty);
      gfx.strokePath();
    }

    const glow = (evolved ? 7 : 5) * this.stats.size * (0.6 + 0.8 * rampT);
    gfx.fillStyle(color, 0.3 + 0.5 * rampT);
    gfx.fillCircle(tx, ty, glow);
    if (this.currentQuality === 'high') {
      gfx.fillStyle(0xffffff, 0.4 + 0.4 * rampT);
      gfx.fillCircle(tx, ty, glow * 0.45);
    }
  }

  public destroy(): void {
    if (this.gfx) {
      this.gfx.destroy();
      this.gfx = null;
    }
    this.beams = [];
    this.poolInitialized = false;
    super.destroy();
  }
}
