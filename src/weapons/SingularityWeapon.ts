import { BaseWeapon, WeaponContext, WeaponStats } from './BaseWeapon';
import { Transform, EnemyType } from '../ecs/components';
import { getEnemySpatialHash } from '../utils/SpatialHash';
import { getJuiceManager } from '../effects/JuiceManager';
import { spawnHazardZone } from '../systems/HazardZoneSystem';
import { DepthLayers } from '../visual/DepthLayers';
import { VisualQuality } from '../visual/GlowGraphics';
import {
  createSingularityState,
  stepSingularity,
  computePullDisplacement,
  type SingularityParams,
  type SingularityState,
} from './singularityLogic';

const WELL_POOL_SIZE = 6;          // max concurrent gravity wells
const TRAVEL_TIME = 0.35;          // seconds for the lob to land
const PULL_RADIUS_BASE = 150;      // px radius of influence (× size)
const PULL_STRENGTH = 300;         // inward tug speed (px/sec) at full strength
const MAX_TUG_PER_FRAME = 6;       // cap on per-frame displacement → a tug, not a teleport
const BLAST_FRACTION = 0.95;       // collapse blast radius as a fraction of pull radius
const COLLAPSE_KNOCKBACK = 140;    // outward burst on collapse
const LINGER_DURATION = 3;         // seconds the mastery void field persists
const DOT_INTERVAL = 0.35;         // Black Hole (evolved) damage-over-time tick
const DOT_FRACTION = 0.3;          // evolved DOT per tick as a fraction of collapse damage

// Bosses shrug off the well entirely; minibosses are only partly displaced — an
// anti-swarm weapon must not fling a boss across the arena. Collapse damage still
// applies to everyone; only the positional pull is resisted.
const MINIBOSS_PULL_RESIST = 0.3;
const MINIBOSS_XP = 30;
const BOSS_XP = 1000;

// Void palette, shared with the `void` hazard so the well reads as the same force.
const CORE = 0xaa44ff;
const GLOW = 0xcc88ff;
const EVOLVED_CORE = 0xff66dd;     // Black Hole: brighter, hotter accretion
const EVOLVED_GLOW = 0xffaaff;

interface Well {
  motion: SingularityState;
  dotTimer: number;
  active: boolean;
}

/**
 * SingularityWeapon — the arsenal's only *crowd-control-by-displacement* weapon.
 *
 * Every other weapon damages or kills enemies where they stand; the Singularity
 * repositions them. A cast lobs a gravity well onto the nearest enemy cluster;
 * for a short window the well yanks nearby enemies toward its core (capped so it
 * reads as a steady tug), clumping the horde, then collapses in an area burst.
 * The clump is the point: it makes every other AOE weapon land harder, rewarding
 * combo builds.
 *
 * The lifecycle (travel → pull → collapse) and the per-enemy pull math live in
 * the pure, unit-tested `singularityLogic` module; this class owns lob targeting,
 * the ECS Transform writes that move enemies, the collapse damage, and the visual.
 *
 * Mastery ("Event Horizon"): each collapse leaves a lingering void field that
 * keeps enemies clumped for a few seconds.
 * Evolution ("Black Hole", via reach): a wider well that also burns enemies with
 * damage-over-time for the whole pull, on top of the collapse.
 */
export class SingularityWeapon extends BaseWeapon {
  // `duration` is the pull hold time — a "longer is better" lifetime, so it
  // scales with the player's effect-duration stat.
  protected scalesEffectDuration = true;

  private wells: Well[] = [];
  private bodyGraphics: Phaser.GameObjects.Graphics | null = null;
  private currentQuality: VisualQuality = 'high';
  private poolInitialized = false;

  constructor() {
    const baseStats: WeaponStats = {
      damage: 34,
      cooldown: 4.5,
      range: 340,   // how far out a cluster can be targeted
      count: 1,     // wells per cast (+1 every 2 levels)
      piercing: 1,  // unused — the collapse is an area burst
      size: 1,      // scales pull + blast radius
      speed: 1,     // unused — travel is time-based, not velocity-based
      duration: 1.6, // pull hold time (seconds)
    };

    super(
      'singularity',
      'Singularity',
      'singularity',
      'Lobs a gravity well that pulls enemies together, then collapses',
      10,
      baseStats,
      'Event Horizon',
      'Each collapse leaves a lingering gravity field'
    );
  }

  private pullRadius(): number {
    return PULL_RADIUS_BASE * this.stats.size;
  }

  private initPool(scene: Phaser.Scene): void {
    if (this.poolInitialized) return;
    this.poolInitialized = true;

    this.bodyGraphics = scene.add.graphics();
    this.bodyGraphics.setDepth(DepthLayers.PROJECTILES);

    for (let i = 0; i < WELL_POOL_SIZE; i++) {
      this.wells.push({ motion: createSingularityState(0, 0, 0, 0), dotTimer: 0, active: false });
    }
  }

  protected attack(ctx: WeaponContext): void {
    this.initPool(ctx.scene);

    const spatialHash = getEnemySpatialHash();
    const candidates = spatialHash.query(ctx.playerX, ctx.playerY, this.stats.range);
    if (candidates.length === 0) return; // nothing to clump — save the well (mirrors Meteor)

    for (let i = 0; i < this.stats.count; i++) {
      // Spread multiple wells across different targets in the cluster.
      const target = candidates[(i * 7 + Math.floor(Math.random() * candidates.length)) % candidates.length];
      const jitterX = (Math.random() - 0.5) * 30;
      const jitterY = (Math.random() - 0.5) * 30;
      this.deployWell(ctx.playerX, ctx.playerY, target.x + jitterX, target.y + jitterY);
    }

    ctx.soundManager.playHit();
  }

  private deployWell(startX: number, startY: number, targetX: number, targetY: number): void {
    let slot: Well | null | undefined = this.wells.find((w) => !w.active);
    if (!slot) slot = this.oldestActive();
    if (!slot) return;

    slot.motion = createSingularityState(startX, startY, targetX, targetY);
    slot.dotTimer = DOT_INTERVAL;
    slot.active = true;
  }

  private oldestActive(): Well | null {
    let oldest: Well | null = null;
    for (const well of this.wells) {
      if (!well.active) continue;
      // Fallback when the pool is exhausted: retire the well furthest through its
      // current phase (closest to collapsing anyway).
      if (!oldest || well.motion.timer > oldest.motion.timer) oldest = well;
    }
    return oldest;
  }

  protected updateEffects(ctx: WeaponContext): void {
    this.initPool(ctx.scene);
    this.currentQuality = ctx.visualQuality;
    if (this.bodyGraphics) this.bodyGraphics.clear();

    const params: SingularityParams = {
      travelTime: TRAVEL_TIME,
      pullDuration: this.stats.duration,
      pullRadius: this.pullRadius(),
      pullStrength: PULL_STRENGTH,
      maxTugPerFrame: MAX_TUG_PER_FRAME,
    };

    for (const well of this.wells) {
      if (!well.active) continue;

      const step = stepSingularity(well.motion, params, ctx.deltaTime);
      well.motion = step.state;

      if (step.collapsed) {
        this.collapse(ctx, well);
        well.active = false;
        continue;
      }

      if (well.motion.phase === 'pull') {
        this.applyPull(ctx, well, params);
        if (this.isEvolved) this.applyDamageOverTime(ctx, well, params);
      }

      this.drawWell(well, params);
    }
  }

  private applyPull(ctx: WeaponContext, well: Well, params: SingularityParams): void {
    const spatialHash = getEnemySpatialHash();
    const candidates = spatialHash.query(well.motion.x, well.motion.y, params.pullRadius + 8);
    for (const candidate of candidates) {
      if (candidate.id === ctx.playerId) continue;
      const xpValue = EnemyType.xpValue[candidate.id] || 0;
      const resist = xpValue >= BOSS_XP ? 0 : xpValue >= MINIBOSS_XP ? MINIBOSS_PULL_RESIST : 1;
      if (resist === 0) continue;

      const enemyX = Transform.x[candidate.id];
      const enemyY = Transform.y[candidate.id];
      const { dx, dy } = computePullDisplacement(well.motion.x, well.motion.y, enemyX, enemyY, params, ctx.deltaTime);
      Transform.x[candidate.id] = enemyX + dx * resist;
      Transform.y[candidate.id] = enemyY + dy * resist;
    }
  }

  private applyDamageOverTime(ctx: WeaponContext, well: Well, params: SingularityParams): void {
    well.dotTimer -= ctx.deltaTime;
    if (well.dotTimer > 0) return;
    well.dotTimer += DOT_INTERVAL;

    const spatialHash = getEnemySpatialHash();
    const radiusSq = params.pullRadius * params.pullRadius;
    const dotDamage = this.stats.damage * DOT_FRACTION;
    for (const candidate of spatialHash.query(well.motion.x, well.motion.y, params.pullRadius)) {
      if (candidate.id === ctx.playerId) continue;
      const dx = Transform.x[candidate.id] - well.motion.x;
      const dy = Transform.y[candidate.id] - well.motion.y;
      if (dx * dx + dy * dy > radiusSq) continue;
      ctx.damageEnemy(candidate.id, dotDamage, 0);
    }
  }

  private collapse(ctx: WeaponContext, well: Well): void {
    const centerX = well.motion.x;
    const centerY = well.motion.y;
    const blastRadius = this.pullRadius() * BLAST_FRACTION;
    const radiusSq = blastRadius * blastRadius;
    const inverseRadius = 1 / blastRadius;

    for (const enemyId of ctx.getEnemies()) {
      const dx = Transform.x[enemyId] - centerX;
      const dy = Transform.y[enemyId] - centerY;
      const distSq = dx * dx + dy * dy;
      if (distSq > radiusSq) continue;
      const falloff = 1 - (Math.sqrt(distSq) * inverseRadius) * 0.4; // 1.0 core → 0.6 rim
      ctx.damageEnemy(enemyId, this.stats.damage * falloff, COLLAPSE_KNOCKBACK);
    }

    this.drawCollapse(ctx, centerX, centerY, blastRadius);
    getJuiceManager().screenShake(this.currentQuality === 'high' ? 0.005 : 0.003, 200);
    ctx.soundManager.playHit();

    // Mastery: leave a lingering void field that keeps the horde clumped.
    if (this.isMastered()) {
      spawnHazardZone(centerX, centerY, blastRadius, 'void', LINGER_DURATION);
    }
  }

  private drawWell(well: Well, params: SingularityParams): void {
    const gfx = this.bodyGraphics;
    if (!gfx) return;

    const { x, y, phase, timer } = well.motion;
    const core = this.isEvolved ? EVOLVED_CORE : CORE;
    const glow = this.isEvolved ? EVOLVED_GLOW : GLOW;

    if (phase === 'travel') {
      // A small dark orb streaking to its target.
      const size = 6 * this.stats.size;
      gfx.fillStyle(core, 0.85);
      gfx.fillCircle(x, y, size);
      gfx.fillStyle(0x000000, 0.5);
      gfx.fillCircle(x, y, size * 0.5);
      return;
    }

    // Pull phase: dark core + swirling accretion + faint influence ring.
    const intensity = params.pullDuration > 0 ? Math.min(1, timer / params.pullDuration) : 1;
    const coreRadius = (10 + 6 * intensity) * this.stats.size;

    // Influence ring at the pull radius so the player reads its reach.
    if (this.currentQuality !== 'low') {
      gfx.lineStyle(1.5, glow, 0.18 + 0.12 * intensity);
      gfx.strokeCircle(x, y, params.pullRadius);
    }

    // Accretion arcs spiralling inward, spinning faster as the collapse nears.
    const spin = timer * (3 + 4 * intensity);
    const armCount = this.currentQuality === 'low' ? 2 : 3;
    for (let arm = 0; arm < armCount; arm++) {
      const baseAngle = spin + (arm / armCount) * Math.PI * 2;
      gfx.lineStyle(2, glow, 0.5 + 0.3 * intensity);
      gfx.beginPath();
      for (let segment = 0; segment <= 6; segment++) {
        const t = segment / 6;
        const radius = coreRadius + t * (params.pullRadius * 0.55);
        const angle = baseAngle - t * 2.2; // trailing spiral
        const px = x + Math.cos(angle) * radius;
        const py = y + Math.sin(angle) * radius;
        if (segment === 0) gfx.moveTo(px, py); else gfx.lineTo(px, py);
      }
      gfx.strokePath();
    }

    // Glowing rim + black core.
    gfx.fillStyle(glow, 0.35 + 0.25 * intensity);
    gfx.fillCircle(x, y, coreRadius);
    gfx.fillStyle(core, 0.9);
    gfx.fillCircle(x, y, coreRadius * 0.7);
    gfx.fillStyle(0x000000, 0.85);
    gfx.fillCircle(x, y, coreRadius * 0.45);
  }

  private drawCollapse(ctx: WeaponContext, x: number, y: number, blastRadius: number): void {
    const core = this.isEvolved ? EVOLVED_CORE : CORE;

    // Bright implosion flash.
    const flash = ctx.scene.add.circle(x, y, blastRadius * 0.5, 0xffffff, 0.9);
    flash.setDepth(DepthLayers.PROJECTILES);
    ctx.scene.tweens.add({
      targets: flash,
      scaleX: 0.1,
      scaleY: 0.1,
      alpha: 0,
      duration: 90,
      onComplete: () => flash.destroy(),
    });

    // Expanding shockwave ring.
    const ring = ctx.scene.add.circle(x, y, blastRadius * 0.4, core, 0);
    ring.setStrokeStyle(4, core, 0.9);
    ring.setDepth(DepthLayers.PROJECTILES);
    ctx.scene.tweens.add({
      targets: ring,
      scaleX: 2.4,
      scaleY: 2.4,
      alpha: 0,
      duration: 300,
      ease: 'Cubic.easeOut',
      onComplete: () => ring.destroy(),
    });

    ctx.effectsManager.playHitSparks(x, y, 0);
  }

  protected recalculateStats(): void {
    super.recalculateStats();
    // Cool down a touch faster as it levels so the wells refresh sooner.
    this.stats.cooldown = Math.max(2.6, this.baseStats.cooldown - (this.level - 1) * 0.16);
  }

  public destroy(): void {
    if (this.bodyGraphics) {
      this.bodyGraphics.destroy();
      this.bodyGraphics = null;
    }
    this.wells = [];
    this.poolInitialized = false;
    super.destroy();
  }
}
