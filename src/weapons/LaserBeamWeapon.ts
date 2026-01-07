import { BaseWeapon, WeaponContext, WeaponStats } from './BaseWeapon';
import { Transform } from '../ecs/components';

/**
 * LaserBeamWeapon fires a piercing beam that damages all enemies in a line.
 * High damage, pierces everything, but narrow and directional.
 */
export class LaserBeamWeapon extends BaseWeapon {
  private beamGraphics: Phaser.GameObjects.Graphics | null = null;

  // Mastery: Prismatic Convergence - track refracted beams
  private refractedBeamCount: number = 0;
  private readonly MAX_REFRACTED_BEAMS = 5;

  // OPTIMIZATION: Pre-allocated array for hit positions
  private hitPositionsTemp: { id: number; x: number; y: number }[] = [];

  constructor() {
    const baseStats: WeaponStats = {
      damage: 30,
      cooldown: 1.5,
      range: 600,         // Beam length
      count: 1,           // Number of beams
      piercing: 999,
      size: 1,            // Beam width multiplier
      speed: 1,
      duration: 0.15,     // Visual duration
    };

    super(
      'laser_beam',
      'Laser Beam',
      'laser',
      'Piercing energy beam',
      10,
      baseStats,
      'Prismatic Convergence',
      'Each enemy hit spawns a 40% damage refracted beam (max 5)'
    );
  }

  protected attack(ctx: WeaponContext): void {
    const enemies = ctx.getEnemies();
    if (enemies.length === 0) return;

    // Reset refracted beam counter for this attack cycle
    this.refractedBeamCount = 0;

    // Find targets for each beam
    for (let b = 0; b < this.stats.count; b++) {
      // Find a random enemy to target
      let targetId = -1;
      // OPTIMIZATION: Use squared distance for comparisons
      let targetDistSq = Infinity;

      // For first beam, target nearest. For others, spread out
      if (b === 0) {
        for (const enemyId of enemies) {
          const ex = Transform.x[enemyId];
          const ey = Transform.y[enemyId];
          const dx = ex - ctx.playerX;
          const dy = ey - ctx.playerY;
          const distSq = dx * dx + dy * dy;

          if (distSq < targetDistSq) {
            targetDistSq = distSq;
            targetId = enemyId;
          }
        }
      } else {
        // Random enemy for additional beams
        targetId = enemies[Math.floor(Math.random() * enemies.length)];
      }

      if (targetId === -1) continue;

      const targetX = Transform.x[targetId];
      const targetY = Transform.y[targetId];
      const angle = Math.atan2(targetY - ctx.playerY, targetX - ctx.playerX);

      // Calculate beam end point
      const endX = ctx.playerX + Math.cos(angle) * this.stats.range;
      const endY = ctx.playerY + Math.sin(angle) * this.stats.range;

      // Fire beam and hit all enemies along it
      this.fireBeam(ctx, ctx.playerX, ctx.playerY, endX, endY, angle, this.stats.damage, false);
    }
  }

  private fireBeam(
    ctx: WeaponContext,
    startX: number,
    startY: number,
    endX: number,
    endY: number,
    beamAngle: number,
    damage: number,
    isRefracted: boolean
  ): void {
    const beamWidth = isRefracted ? 8 * this.stats.size : 12 * this.stats.size;
    const hitEnemies = new Set<number>();
    // OPTIMIZATION: Reuse pre-allocated array for main beams
    if (!isRefracted) {
      this.hitPositionsTemp.length = 0;
    }

    // Check all enemies along the beam
    const enemies = ctx.getEnemies();
    for (const enemyId of enemies) {
      const ex = Transform.x[enemyId];
      const ey = Transform.y[enemyId];

      // Calculate distance from enemy to beam line
      const dist = this.pointToLineDistance(ex, ey, startX, startY, endX, endY);

      if (dist <= beamWidth + 12) { // 12 = enemy radius
        ctx.damageEnemy(enemyId, damage, 50);
        hitEnemies.add(enemyId);
        // Only track positions for main beams (for refraction)
        if (!isRefracted) {
          this.hitPositionsTemp.push({ id: enemyId, x: ex, y: ey });
        }
      }
    }

    // Visual beam (different color for refracted)
    this.drawBeam(ctx, startX, startY, endX, endY, beamWidth, isRefracted);

    // Hit sparks along beam
    for (const enemyId of hitEnemies) {
      const ex = Transform.x[enemyId];
      const ey = Transform.y[enemyId];
      ctx.effectsManager.playHitSparks(ex, ey, beamAngle);
    }

    if (hitEnemies.size > 0) {
      ctx.soundManager.playHit();
    }

    // Mastery: Prismatic Convergence - spawn refracted beams from hit enemies
    if (this.isMastered() && !isRefracted && this.hitPositionsTemp.length > 0) {
      this.spawnRefractedBeams(ctx, this.hitPositionsTemp, hitEnemies);
    }
  }

  /**
   * Mastery: Prismatic Convergence - spawn refracted beams from hit enemy positions.
   * Each beam targets the nearest unhit enemy (max 5 total refracted beams).
   */
  private spawnRefractedBeams(
    ctx: WeaponContext,
    hitPositions: { id: number; x: number; y: number }[],
    alreadyHit: Set<number>
  ): void {
    const enemies = ctx.getEnemies();
    const refractedDamage = this.stats.damage * 0.4; // 40% damage
    const usedTargets = new Set<number>(alreadyHit);

    // OPTIMIZATION: Pre-compute squared max range
    const maxRefractRangeSq = 200 * 200; // 40000

    for (const hitPos of hitPositions) {
      if (this.refractedBeamCount >= this.MAX_REFRACTED_BEAMS) break;

      // Find nearest unhit enemy from this hit position
      let nearestId = -1;
      // OPTIMIZATION: Use squared distance for comparisons
      let nearestDistSq = maxRefractRangeSq;

      for (const enemyId of enemies) {
        if (usedTargets.has(enemyId)) continue;

        const ex = Transform.x[enemyId];
        const ey = Transform.y[enemyId];
        const dx = ex - hitPos.x;
        const dy = ey - hitPos.y;
        const distSq = dx * dx + dy * dy;

        if (distSq < nearestDistSq) {
          nearestDistSq = distSq;
          nearestId = enemyId;
        }
      }

      if (nearestId !== -1) {
        usedTargets.add(nearestId);
        this.refractedBeamCount++;

        const targetX = Transform.x[nearestId];
        const targetY = Transform.y[nearestId];
        const angle = Math.atan2(targetY - hitPos.y, targetX - hitPos.x);

        // Shorter range for refracted beams
        const refractRange = 150;
        const endX = hitPos.x + Math.cos(angle) * refractRange;
        const endY = hitPos.y + Math.sin(angle) * refractRange;

        // Fire the refracted beam (won't chain further due to isRefracted=true)
        this.fireBeam(ctx, hitPos.x, hitPos.y, endX, endY, angle, refractedDamage, true);
      }
    }
  }

  private pointToLineDistance(
    px: number,
    py: number,
    x1: number,
    y1: number,
    x2: number,
    y2: number
  ): number {
    const dx = x2 - x1;
    const dy = y2 - y1;
    const lengthSq = dx * dx + dy * dy;

    if (lengthSq === 0) return Math.sqrt((px - x1) ** 2 + (py - y1) ** 2);

    // Project point onto line
    let t = ((px - x1) * dx + (py - y1) * dy) / lengthSq;
    t = Math.max(0, Math.min(1, t));

    const projX = x1 + t * dx;
    const projY = y1 + t * dy;

    return Math.sqrt((px - projX) ** 2 + (py - projY) ** 2);
  }

  private drawBeam(
    ctx: WeaponContext,
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    width: number,
    isRefracted: boolean = false
  ): void {
    // For main beams, clean up old graphics
    // For refracted beams, create new graphics (they run simultaneously)
    const graphics = ctx.scene.add.graphics();
    graphics.setDepth(isRefracted ? 11 : 12);

    if (!isRefracted) {
      if (this.beamGraphics) {
        this.beamGraphics.destroy();
      }
      this.beamGraphics = graphics;
    }

    // Refracted beams use prismatic colors (rainbow effect)
    const outerColor = isRefracted ? 0xff66aa : 0x2266dd;  // Magenta/Pink for refracted
    const mainColor = isRefracted ? 0xffaa66 : 0x4488ff;   // Orange for refracted
    const coreColor = 0xffffff;

    // Outer glow
    graphics.lineStyle(width * 2, outerColor, 0.3);
    graphics.beginPath();
    graphics.moveTo(x1, y1);
    graphics.lineTo(x2, y2);
    graphics.strokePath();

    // Main beam
    graphics.lineStyle(width, mainColor, 0.8);
    graphics.beginPath();
    graphics.moveTo(x1, y1);
    graphics.lineTo(x2, y2);
    graphics.strokePath();

    // Core - white
    graphics.lineStyle(width / 3, coreColor, 1);
    graphics.beginPath();
    graphics.moveTo(x1, y1);
    graphics.lineTo(x2, y2);
    graphics.strokePath();

    // Start flash (smaller for refracted)
    graphics.fillStyle(coreColor, isRefracted ? 0.6 : 0.8);
    graphics.fillCircle(x1, y1, isRefracted ? width * 0.7 : width);

    // Fade out
    ctx.scene.tweens.add({
      targets: graphics,
      alpha: 0,
      duration: this.stats.duration * 1000 * (isRefracted ? 0.8 : 1),
      onComplete: () => {
        graphics.destroy();
        if (!isRefracted && this.beamGraphics === graphics) {
          this.beamGraphics = null;
        }
      },
    });
  }

  protected recalculateStats(): void {
    super.recalculateStats();
    this.stats.count = 1 + Math.floor((this.level - 1) / 3) + this.externalBonusCount; // Extra beam every 3 levels
    this.stats.size = 1 + (this.level - 1) * 0.15;
  }

  public destroy(): void {
    if (this.beamGraphics) {
      this.beamGraphics.destroy();
      this.beamGraphics = null;
    }
    super.destroy();
  }
}
