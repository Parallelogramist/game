import { BaseWeapon, WeaponContext, WeaponStats } from './BaseWeapon';
import { Transform } from '../ecs/components';

interface SlashLine {
  startX: number;
  startY: number;
  endX: number;
  endY: number;
  delay: number;
}

/**
 * KatanaWeapon creates multiple crisscrossing blade cuts in front of the player.
 * High damage, wide area, but only hits in one direction.
 * Visual shows rapid slashes at random angles like a master swordsman.
 */
export class KatanaWeapon extends BaseWeapon {
  private lastDirection: number = 1; // 1 = right, -1 = left
  private slashGraphics: Phaser.GameObjects.Graphics | null = null;

  constructor() {
    const baseStats: WeaponStats = {
      damage: 25,
      cooldown: 1.2,
      range: 120,
      count: 5,      // Number of slash lines
      piercing: 999, // Hits all enemies in area
      size: 1,
      speed: 1,
      duration: 0.2, // Slash visual duration
    };

    super(
      'katana',
      'Katana',
      'katana',
      'Rapid crisscrossing blade cuts',
      10,
      baseStats,
      'Iai: Thousand Cuts',
      'Hitting 8+ enemies triggers a 360° Finishing Blow at 200% damage'
    );
  }

  protected attack(ctx: WeaponContext): void {
    const enemies = ctx.getEnemies();
    if (enemies.length === 0) {
      // Still swing, just no enemies to hit
      this.createSlashVisual(ctx, this.lastDirection);
      return;
    }

    // Find nearest enemy to determine direction
    let nearestId = -1;
    let nearestDist = Infinity;

    for (const enemyId of enemies) {
      const ex = Transform.x[enemyId];
      const ey = Transform.y[enemyId];
      const dx = ex - ctx.playerX;
      const dy = ey - ctx.playerY;
      const dist = Math.sqrt(dx * dx + dy * dy);

      if (dist < nearestDist) {
        nearestDist = dist;
        nearestId = enemyId;
      }
    }

    // Determine slash direction based on nearest enemy
    if (nearestId !== -1) {
      const ex = Transform.x[nearestId];
      this.lastDirection = ex > ctx.playerX ? 1 : -1;
    }

    // Create visual
    this.createSlashVisual(ctx, this.lastDirection);

    // Hit all enemies in the slash zone
    const slashWidth = this.stats.range * this.stats.size;
    const slashHeight = 80 * this.stats.size;

    let hitCount = 0;
    for (const enemyId of enemies) {
      const ex = Transform.x[enemyId];
      const ey = Transform.y[enemyId];

      // Check if enemy is in the slash zone
      const dx = ex - ctx.playerX;
      const dy = ey - ctx.playerY;

      // Must be in correct direction
      if (this.lastDirection > 0 && dx < 0) continue;
      if (this.lastDirection < 0 && dx > 0) continue;

      // Check distance
      const absDx = Math.abs(dx);
      const absDy = Math.abs(dy);

      if (absDx <= slashWidth && absDy <= slashHeight / 2) {
        ctx.damageEnemy(enemyId, this.stats.damage, 300);
        hitCount++;
      }
    }

    // Play sound
    if (hitCount > 0) {
      ctx.soundManager.playHit();
    }

    // Iai: Thousand Cuts mastery - hitting 8+ enemies triggers 360° Finishing Blow
    if (this.isMastered() && hitCount >= 8) {
      this.triggerFinishingBlow(ctx);
    }
  }

  /**
   * Mastery ability: Iai: Thousand Cuts
   * A devastating 360-degree slash that hits all enemies within range at 200% damage.
   */
  private triggerFinishingBlow(ctx: WeaponContext): void {
    const enemies = ctx.getEnemies();
    const finishingRange = this.stats.range * 1.5;
    const finishingDamage = this.stats.damage * 2; // 200% damage

    // Hit ALL enemies in 360° radius
    let finishingHits = 0;
    for (const enemyId of enemies) {
      const ex = Transform.x[enemyId];
      const ey = Transform.y[enemyId];
      const dx = ex - ctx.playerX;
      const dy = ey - ctx.playerY;
      const dist = Math.sqrt(dx * dx + dy * dy);

      if (dist <= finishingRange) {
        ctx.damageEnemy(enemyId, finishingDamage, 500);
        finishingHits++;
      }
    }

    // Create the Finishing Blow visual
    this.createFinishingBlowVisual(ctx, finishingRange);

    if (finishingHits > 0) {
      ctx.soundManager.playHit();
    }
  }

  /**
   * Creates a dramatic 360° slash visual for the Finishing Blow.
   */
  private createFinishingBlowVisual(ctx: WeaponContext, range: number): void {
    const finishGraphics = ctx.scene.add.graphics();
    finishGraphics.setDepth(11);
    finishGraphics.setPosition(ctx.playerX, ctx.playerY);

    // Animation: expanding ring of slashes
    const slashCount = 12;
    const duration = 400;

    ctx.scene.tweens.addCounter({
      from: 0,
      to: 1,
      duration: duration,
      ease: 'Quad.easeOut',
      onUpdate: (tween) => {
        const progress = tween.getValue() ?? 0;
        finishGraphics.clear();

        // Draw expanding circular slashes
        for (let i = 0; i < slashCount; i++) {
          const angle = (i / slashCount) * Math.PI * 2;
          const innerRadius = range * progress * 0.3;
          const outerRadius = range * progress;
          const slashAlpha = 1 - progress * 0.7;

          const innerX = Math.cos(angle) * innerRadius;
          const innerY = Math.sin(angle) * innerRadius;
          const outerX = Math.cos(angle) * outerRadius;
          const outerY = Math.sin(angle) * outerRadius;

          // Golden outer glow for mastery
          finishGraphics.lineStyle(10, 0xffd700, slashAlpha * 0.4);
          finishGraphics.beginPath();
          finishGraphics.moveTo(innerX, innerY);
          finishGraphics.lineTo(outerX, outerY);
          finishGraphics.strokePath();

          // White core
          finishGraphics.lineStyle(4, 0xffffff, slashAlpha);
          finishGraphics.beginPath();
          finishGraphics.moveTo(innerX, innerY);
          finishGraphics.lineTo(outerX, outerY);
          finishGraphics.strokePath();
        }

        // Central burst
        const burstRadius = 20 * (1 - progress);
        finishGraphics.fillStyle(0xffffff, 1 - progress);
        finishGraphics.fillCircle(0, 0, burstRadius);

        // Outer ring
        finishGraphics.lineStyle(3, 0xffd700, (1 - progress) * 0.8);
        finishGraphics.strokeCircle(0, 0, range * progress);
      },
      onComplete: () => {
        finishGraphics.destroy();
      },
    });
  }

  private createSlashVisual(ctx: WeaponContext, direction: number): void {
    // Clean up previous slash
    if (this.slashGraphics) {
      this.slashGraphics.destroy();
    }

    const slashWidth = this.stats.range * this.stats.size;
    const slashHeight = 80 * this.stats.size;
    const slashCount = this.stats.count;

    // Create graphics for all slashes
    this.slashGraphics = ctx.scene.add.graphics();
    this.slashGraphics.setDepth(10);

    // Center of the slash zone
    const centerX = ctx.playerX + (direction * slashWidth * 0.5);
    const centerY = ctx.playerY;

    // Generate random crisscrossing slash lines
    const slashes: SlashLine[] = [];

    for (let i = 0; i < slashCount; i++) {
      // Random angle for variety (-60 to 60 degrees from horizontal, with some vertical)
      const angleVariety = Math.random();
      let angle: number;

      if (angleVariety < 0.3) {
        // Mostly horizontal slashes
        angle = (Math.random() - 0.5) * 0.5; // -15 to 15 degrees
      } else if (angleVariety < 0.6) {
        // Diagonal slashes
        angle = (Math.random() - 0.5) * 2; // -60 to 60 degrees
      } else {
        // Steep diagonal / near vertical
        angle = (Math.random() > 0.5 ? 1 : -1) * (1 + Math.random() * 0.5); // 60-90 degrees
      }

      // Random position within the slash zone
      const offsetX = (Math.random() - 0.5) * slashWidth * 0.6;
      const offsetY = (Math.random() - 0.5) * slashHeight * 0.6;

      // Slash length varies
      const length = slashWidth * (0.5 + Math.random() * 0.5);

      // Calculate start and end points
      const slashCenterX = centerX + offsetX;
      const slashCenterY = centerY + offsetY;

      const halfLength = length / 2;
      const cosAngle = Math.cos(angle);
      const sinAngle = Math.sin(angle);

      slashes.push({
        startX: slashCenterX - cosAngle * halfLength * direction,
        startY: slashCenterY - sinAngle * halfLength,
        endX: slashCenterX + cosAngle * halfLength * direction,
        endY: slashCenterY + sinAngle * halfLength,
        delay: i * 15, // Stagger the appearance slightly
      });
    }

    // Draw all slashes with staggered timing
    const drawSlashes = (progress: number) => {
      if (!this.slashGraphics) return;
      this.slashGraphics.clear();

      for (let i = 0; i < slashes.length; i++) {
        const slash = slashes[i];
        const slashProgress = Math.min(1, Math.max(0, (progress * slashCount - i) / 1.5));

        if (slashProgress <= 0) continue;

        // Animate the slash drawing from start to end
        const currentEndX = slash.startX + (slash.endX - slash.startX) * slashProgress;
        const currentEndY = slash.startY + (slash.endY - slash.startY) * slashProgress;

        // Outer glow (blue)
        this.slashGraphics.lineStyle(8, 0x4488ff, 0.3 * slashProgress);
        this.slashGraphics.beginPath();
        this.slashGraphics.moveTo(slash.startX, slash.startY);
        this.slashGraphics.lineTo(currentEndX, currentEndY);
        this.slashGraphics.strokePath();

        // Middle glow (light blue)
        this.slashGraphics.lineStyle(4, 0x66aaff, 0.6 * slashProgress);
        this.slashGraphics.beginPath();
        this.slashGraphics.moveTo(slash.startX, slash.startY);
        this.slashGraphics.lineTo(currentEndX, currentEndY);
        this.slashGraphics.strokePath();

        // Core line (white)
        this.slashGraphics.lineStyle(2, 0xffffff, 1 * slashProgress);
        this.slashGraphics.beginPath();
        this.slashGraphics.moveTo(slash.startX, slash.startY);
        this.slashGraphics.lineTo(currentEndX, currentEndY);
        this.slashGraphics.strokePath();

        // Add small spark at the tip of each slash
        if (slashProgress > 0.8) {
          const sparkSize = 3 * this.stats.size;
          this.slashGraphics.fillStyle(0xffffff, slashProgress);
          this.slashGraphics.fillCircle(currentEndX, currentEndY, sparkSize);
        }
      }
    };

    // Initial draw
    drawSlashes(0);

    // Animate slashes appearing then fading
    const duration = this.stats.duration * 1000;
    const drawPhase = duration * 0.4; // 40% for drawing
    const holdPhase = duration * 0.2; // 20% hold
    const fadePhase = duration * 0.4; // 40% for fading

    // Drawing phase
    ctx.scene.tweens.addCounter({
      from: 0,
      to: 1,
      duration: drawPhase,
      onUpdate: (tween) => {
        drawSlashes(tween.getValue() ?? 0);
      },
    });

    // Fade phase (after draw + hold)
    ctx.scene.time.delayedCall(drawPhase + holdPhase, () => {
      if (!this.slashGraphics) return;

      ctx.scene.tweens.add({
        targets: this.slashGraphics,
        alpha: 0,
        duration: fadePhase,
        onComplete: () => {
          if (this.slashGraphics) {
            this.slashGraphics.destroy();
            this.slashGraphics = null;
          }
        },
      });
    });
  }

  protected recalculateStats(): void {
    super.recalculateStats();
    // Katana gets more slashes and bigger area at higher levels
    this.stats.count = this.baseStats.count + Math.floor((this.level - 1) * 0.8) + this.externalBonusCount;
    this.stats.size = 1 + (this.level - 1) * 0.15;
    this.stats.cooldown = this.baseStats.cooldown * Math.pow(0.88, this.level - 1);
  }

  public destroy(): void {
    if (this.slashGraphics) {
      this.slashGraphics.destroy();
      this.slashGraphics = null;
    }
    super.destroy();
  }
}
