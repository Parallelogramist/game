import { BaseWeapon, WeaponContext, WeaponStats } from './BaseWeapon';
import { Transform } from '../ecs/components';
import { getJuiceManager } from '../effects/JuiceManager';
import { WEAPON_COLORS } from '../visual/NeonColors';
import { DepthLayers } from '../visual/DepthLayers';
import type { VisualQuality } from '../visual/GlowGraphics';

interface SlashArc {
  centerX: number;
  centerY: number;
  angle: number;       // rotation of the arc
  length: number;      // tip-to-tip length
  curvature: number;   // how much the arc bows outward
  thickness: number;   // max thickness at the midpoint
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

    // Play sound and screen shake scaled by enemy count
    if (hitCount > 0) {
      ctx.soundManager.playHit();
      getJuiceManager().screenShake(0.002 + hitCount * 0.0005, 80);

      // Directional impact wave — semicircular arc expanding in slash direction
      const impactWaveGraphics = ctx.scene.add.graphics();
      impactWaveGraphics.setDepth(DepthLayers.SLASH);
      impactWaveGraphics.setPosition(ctx.playerX, ctx.playerY);

      const slashAngle = this.lastDirection > 0 ? 0 : Math.PI;
      const arcStartAngle = slashAngle - Math.PI * 0.5;
      const arcEndAngle = slashAngle + Math.PI * 0.5;

      impactWaveGraphics.lineStyle(3, WEAPON_COLORS.blade.core, 0.6);
      impactWaveGraphics.beginPath();
      impactWaveGraphics.arc(0, 0, 40, arcStartAngle, arcEndAngle, false);
      impactWaveGraphics.strokePath();

      impactWaveGraphics.lineStyle(1, 0xffffff, 0.8);
      impactWaveGraphics.beginPath();
      impactWaveGraphics.arc(0, 0, 40, arcStartAngle, arcEndAngle, false);
      impactWaveGraphics.strokePath();

      ctx.scene.tweens.add({
        targets: impactWaveGraphics,
        scaleX: 3,
        scaleY: 3,
        alpha: 0,
        duration: 150,
        ease: 'Quad.easeOut',
        onComplete: () => impactWaveGraphics.destroy(),
      });
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
      const distSq = dx * dx + dy * dy;

      if (distSq <= finishingRange * finishingRange) {
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
    finishGraphics.setDepth(DepthLayers.FINISHING_BLOW);
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

  /**
   * Draws a single crescent-shaped slash arc onto a Graphics object.
   * The shape is two quadratic bezier curves forming a lens that tapers to points.
   * Quality controls bezier segment count and layer complexity.
   */
  private drawSlashArc(
    graphics: Phaser.GameObjects.Graphics,
    arc: SlashArc,
    sweepProgress: number,
    alpha: number,
    quality: VisualQuality
  ): void {
    const bezierSegments = quality === 'high' ? 12 : quality === 'medium' ? 8 : 5;
    const innerControlMultiplier = quality === 'high' ? 0.15 : 0.3;

    const halfLen = arc.length * 0.5;
    const cosA = Math.cos(arc.angle);
    const sinA = Math.sin(arc.angle);

    // Tip points along the slash line
    const tipStartX = arc.centerX - cosA * halfLen;
    const tipStartY = arc.centerY - sinA * halfLen;
    const tipEndX = arc.centerX + cosA * halfLen;
    const tipEndY = arc.centerY + sinA * halfLen;

    // Animated end position based on sweep progress
    const currentEndX = tipStartX + (tipEndX - tipStartX) * sweepProgress;
    const currentEndY = tipStartY + (tipEndY - tipStartY) * sweepProgress;

    // Perpendicular direction for the curve bow
    const perpX = -sinA;
    const perpY = cosA;

    // Midpoint of the visible portion
    const midX = (tipStartX + currentEndX) * 0.5;
    const midY = (tipStartY + currentEndY) * 0.5;

    // Control points for the two bezier curves (outer and inner arcs)
    const outerControlX = midX + perpX * arc.curvature;
    const outerControlY = midY + perpY * arc.curvature;
    const innerControlX = midX - perpX * arc.curvature * innerControlMultiplier;
    const innerControlY = midY - perpY * arc.curvature * innerControlMultiplier;

    if (quality === 'low') {
      // Low: 2 layers — main fill + core
      // -- Main filled crescent shape --
      graphics.fillStyle(WEAPON_COLORS.blade.core, alpha * 0.4);
      graphics.beginPath();
      graphics.moveTo(tipStartX, tipStartY);
      this.quadBezierTo(graphics, tipStartX, tipStartY, outerControlX, outerControlY, currentEndX, currentEndY, bezierSegments);
      this.quadBezierTo(graphics, currentEndX, currentEndY, innerControlX, innerControlY, tipStartX, tipStartY, bezierSegments);
      graphics.closePath();
      graphics.fillPath();

      // -- White-hot core (thin filled sliver) --
      const coreOuterControlX = midX + perpX * arc.curvature * 0.55;
      const coreOuterControlY = midY + perpY * arc.curvature * 0.55;
      const coreInnerControlX = midX + perpX * arc.curvature * 0.35;
      const coreInnerControlY = midY + perpY * arc.curvature * 0.35;

      graphics.fillStyle(0xffffff, alpha * 0.9);
      graphics.beginPath();
      graphics.moveTo(tipStartX, tipStartY);
      this.quadBezierTo(graphics, tipStartX, tipStartY, coreOuterControlX, coreOuterControlY, currentEndX, currentEndY, bezierSegments);
      this.quadBezierTo(graphics, currentEndX, currentEndY, coreInnerControlX, coreInnerControlY, tipStartX, tipStartY, bezierSegments);
      graphics.closePath();
      graphics.fillPath();
    } else if (quality === 'medium') {
      // Medium: 3 layers — glow + fill + core
      // -- Outer glow --
      const glowScale = 1.6;
      const glowOuterControlX = midX + perpX * arc.curvature * glowScale;
      const glowOuterControlY = midY + perpY * arc.curvature * glowScale;
      const glowInnerControlX = midX - perpX * arc.curvature * 0.5;
      const glowInnerControlY = midY - perpY * arc.curvature * 0.5;

      graphics.fillStyle(WEAPON_COLORS.blade.core, alpha * 0.15);
      graphics.beginPath();
      graphics.moveTo(tipStartX, tipStartY);
      this.quadBezierTo(graphics, tipStartX, tipStartY, glowOuterControlX, glowOuterControlY, currentEndX, currentEndY, bezierSegments);
      this.quadBezierTo(graphics, currentEndX, currentEndY, glowInnerControlX, glowInnerControlY, tipStartX, tipStartY, bezierSegments);
      graphics.closePath();
      graphics.fillPath();

      // -- Main filled crescent shape --
      graphics.fillStyle(WEAPON_COLORS.blade.core, alpha * 0.4);
      graphics.beginPath();
      graphics.moveTo(tipStartX, tipStartY);
      this.quadBezierTo(graphics, tipStartX, tipStartY, outerControlX, outerControlY, currentEndX, currentEndY, bezierSegments);
      this.quadBezierTo(graphics, currentEndX, currentEndY, innerControlX, innerControlY, tipStartX, tipStartY, bezierSegments);
      graphics.closePath();
      graphics.fillPath();

      // -- White-hot core --
      const coreOuterControlX = midX + perpX * arc.curvature * 0.55;
      const coreOuterControlY = midY + perpY * arc.curvature * 0.55;
      const coreInnerControlX = midX + perpX * arc.curvature * 0.35;
      const coreInnerControlY = midY + perpY * arc.curvature * 0.35;

      graphics.fillStyle(0xffffff, alpha * 0.9);
      graphics.beginPath();
      graphics.moveTo(tipStartX, tipStartY);
      this.quadBezierTo(graphics, tipStartX, tipStartY, coreOuterControlX, coreOuterControlY, currentEndX, currentEndY, bezierSegments);
      this.quadBezierTo(graphics, currentEndX, currentEndY, coreInnerControlX, coreInnerControlY, tipStartX, tipStartY, bezierSegments);
      graphics.closePath();
      graphics.fillPath();

    } else {
      // High: 5 layers — outer glow + glow + fill + bright edge + white-hot core + white cutting-edge line

      // -- Layer 1: Outer glow (widest, faintest) --
      const outerGlowScale = 2.0;
      const outerGlowOuterControlX = midX + perpX * arc.curvature * outerGlowScale;
      const outerGlowOuterControlY = midY + perpY * arc.curvature * outerGlowScale;
      const outerGlowInnerControlX = midX - perpX * arc.curvature * 0.6;
      const outerGlowInnerControlY = midY - perpY * arc.curvature * 0.6;

      graphics.fillStyle(WEAPON_COLORS.blade.core, alpha * 0.08);
      graphics.beginPath();
      graphics.moveTo(tipStartX, tipStartY);
      this.quadBezierTo(graphics, tipStartX, tipStartY, outerGlowOuterControlX, outerGlowOuterControlY, currentEndX, currentEndY, bezierSegments);
      this.quadBezierTo(graphics, currentEndX, currentEndY, outerGlowInnerControlX, outerGlowInnerControlY, tipStartX, tipStartY, bezierSegments);
      graphics.closePath();
      graphics.fillPath();

      // -- Layer 2: Glow --
      const glowScale = 1.6;
      const glowOuterControlX = midX + perpX * arc.curvature * glowScale;
      const glowOuterControlY = midY + perpY * arc.curvature * glowScale;
      const glowInnerControlX = midX - perpX * arc.curvature * 0.5;
      const glowInnerControlY = midY - perpY * arc.curvature * 0.5;

      graphics.fillStyle(WEAPON_COLORS.blade.core, alpha * 0.15);
      graphics.beginPath();
      graphics.moveTo(tipStartX, tipStartY);
      this.quadBezierTo(graphics, tipStartX, tipStartY, glowOuterControlX, glowOuterControlY, currentEndX, currentEndY, bezierSegments);
      this.quadBezierTo(graphics, currentEndX, currentEndY, glowInnerControlX, glowInnerControlY, tipStartX, tipStartY, bezierSegments);
      graphics.closePath();
      graphics.fillPath();

      // -- Layer 3: Main filled crescent shape --
      graphics.fillStyle(WEAPON_COLORS.blade.core, alpha * 0.4);
      graphics.beginPath();
      graphics.moveTo(tipStartX, tipStartY);
      this.quadBezierTo(graphics, tipStartX, tipStartY, outerControlX, outerControlY, currentEndX, currentEndY, bezierSegments);
      this.quadBezierTo(graphics, currentEndX, currentEndY, innerControlX, innerControlY, tipStartX, tipStartY, bezierSegments);
      graphics.closePath();
      graphics.fillPath();

      // -- Layer 4: Bright edge (thin filled crescent along outer arc) --
      const brightEdgeOuterControlX = midX + perpX * arc.curvature * 1.06;
      const brightEdgeOuterControlY = midY + perpY * arc.curvature * 1.06;
      const brightEdgeInnerControlX = midX + perpX * arc.curvature * 0.98;
      const brightEdgeInnerControlY = midY + perpY * arc.curvature * 0.98;

      graphics.fillStyle(WEAPON_COLORS.bladeGlow.core, alpha * 0.8);
      graphics.beginPath();
      graphics.moveTo(tipStartX, tipStartY);
      this.quadBezierTo(graphics, tipStartX, tipStartY, brightEdgeOuterControlX, brightEdgeOuterControlY, currentEndX, currentEndY, bezierSegments);
      this.quadBezierTo(graphics, currentEndX, currentEndY, brightEdgeInnerControlX, brightEdgeInnerControlY, tipStartX, tipStartY, bezierSegments);
      graphics.closePath();
      graphics.fillPath();

      // -- Layer 5: White-hot core (thin filled sliver) --
      const coreOuterControlX = midX + perpX * arc.curvature * 0.55;
      const coreOuterControlY = midY + perpY * arc.curvature * 0.55;
      const coreInnerControlX = midX + perpX * arc.curvature * 0.35;
      const coreInnerControlY = midY + perpY * arc.curvature * 0.35;

      graphics.fillStyle(0xffffff, alpha * 0.9);
      graphics.beginPath();
      graphics.moveTo(tipStartX, tipStartY);
      this.quadBezierTo(graphics, tipStartX, tipStartY, coreOuterControlX, coreOuterControlY, currentEndX, currentEndY, bezierSegments);
      this.quadBezierTo(graphics, currentEndX, currentEndY, coreInnerControlX, coreInnerControlY, tipStartX, tipStartY, bezierSegments);
      graphics.closePath();
      graphics.fillPath();

      // -- White cutting-edge line (ultra-thin filled crescent along outer bezier) --
      const cuttingEdgeOuterControlX = midX + perpX * arc.curvature * 1.03;
      const cuttingEdgeOuterControlY = midY + perpY * arc.curvature * 1.03;
      const cuttingEdgeInnerControlX = midX + perpX * arc.curvature * 0.99;
      const cuttingEdgeInnerControlY = midY + perpY * arc.curvature * 0.99;

      graphics.fillStyle(0xffffff, alpha * 0.95);
      graphics.beginPath();
      graphics.moveTo(tipStartX, tipStartY);
      this.quadBezierTo(graphics, tipStartX, tipStartY, cuttingEdgeOuterControlX, cuttingEdgeOuterControlY, currentEndX, currentEndY, bezierSegments);
      this.quadBezierTo(graphics, currentEndX, currentEndY, cuttingEdgeInnerControlX, cuttingEdgeInnerControlY, tipStartX, tipStartY, bezierSegments);
      graphics.closePath();
      graphics.fillPath();

    }
  }

  /**
   * Approximates a quadratic bezier using line segments on a Phaser Graphics path.
   */
  private quadBezierTo(
    graphics: Phaser.GameObjects.Graphics,
    fromX: number, fromY: number,
    controlX: number, controlY: number,
    toX: number, toY: number,
    segments: number = 12
  ): void {
    for (let step = 1; step <= segments; step++) {
      const t = step / segments;
      const invT = 1 - t;
      const pointX = invT * invT * fromX + 2 * invT * t * controlX + t * t * toX;
      const pointY = invT * invT * fromY + 2 * invT * t * controlY + t * t * toY;
      graphics.lineTo(pointX, pointY);
    }
  }

  private createSlashVisual(ctx: WeaponContext, direction: number): void {
    // Clean up previous slash
    if (this.slashGraphics) {
      this.slashGraphics.destroy();
    }

    const currentQuality = ctx.visualQuality;
    const slashWidth = this.stats.range * this.stats.size;
    const slashHeight = 80 * this.stats.size;
    const slashCount = this.stats.count;

    this.slashGraphics = ctx.scene.add.graphics();
    this.slashGraphics.setDepth(DepthLayers.SLASH);

    // Center of the slash zone
    const zoneCenterX = ctx.playerX + (direction * slashWidth * 0.5);
    const zoneCenterY = ctx.playerY;

    // Generate crescent-shaped slash arcs with varied angles
    const slashArcs: SlashArc[] = [];

    for (let i = 0; i < slashCount; i++) {
      // Random angle variety for crisscross pattern
      const angleVariety = Math.random();
      let angle: number;

      if (angleVariety < 0.3) {
        // Near-horizontal arcs
        angle = (Math.random() - 0.5) * 0.5;
      } else if (angleVariety < 0.6) {
        // Diagonal arcs
        angle = (Math.random() - 0.5) * 2;
      } else {
        // Steep / near-vertical arcs
        angle = (Math.random() > 0.5 ? 1 : -1) * (1 + Math.random() * 0.5);
      }

      // Offset within the slash zone
      const offsetX = (Math.random() - 0.5) * slashWidth * 0.6;
      const offsetY = (Math.random() - 0.5) * slashHeight * 0.6;

      const arcLength = slashWidth * (0.5 + Math.random() * 0.5);
      // Curvature: how far the arc bows outward (randomize direction)
      const curveBow = (15 + Math.random() * 20) * this.stats.size * (Math.random() > 0.5 ? 1 : -1);

      slashArcs.push({
        centerX: zoneCenterX + offsetX,
        centerY: zoneCenterY + offsetY,
        angle: direction > 0 ? angle : angle + Math.PI,
        length: arcLength,
        curvature: curveBow,
        thickness: 6 * this.stats.size,
        delay: i * 15,
      });
    }

    // Draw all arcs with staggered sweep animation
    const drawArcs = (progress: number) => {
      if (!this.slashGraphics) return;
      this.slashGraphics.clear();

      for (let i = 0; i < slashArcs.length; i++) {
        const arc = slashArcs[i];
        const sweepProgress = Math.min(1, Math.max(0, (progress * slashCount - i) / 1.5));

        if (sweepProgress <= 0) continue;

        const arcAlpha = Math.min(1, sweepProgress * 1.5);
        this.drawSlashArc(this.slashGraphics!, arc, sweepProgress, arcAlpha, currentQuality);
      }
    };

    drawArcs(0);

    // Animate: draw phase → hold → fade
    const duration = this.stats.duration * 1000;
    const drawPhase = duration * 0.4;
    const holdPhase = duration * 0.2;
    const fadePhase = duration * 0.4;

    ctx.scene.tweens.addCounter({
      from: 0,
      to: 1,
      duration: drawPhase,
      ease: 'Cubic.easeOut',
      onUpdate: (tween) => {
        drawArcs(tween.getValue() ?? 0);
      },
    });

    // Lingering thin cut marks (curved remnants)
    const cutMarkCount = Math.min(3, slashCount);
    for (let i = 0; i < cutMarkCount; i++) {
      const cutMarkGraphics = ctx.scene.add.graphics();
      cutMarkGraphics.setDepth(9);

      const markCenterX = zoneCenterX + (Math.random() - 0.5) * slashWidth * 0.6;
      const markCenterY = zoneCenterY + (Math.random() - 0.5) * slashHeight * 0.4;
      const markAngle = (Math.random() - 0.5) * 2.0;
      const markLength = 15 + Math.random() * 25;
      const markCurve = (5 + Math.random() * 8) * (Math.random() > 0.5 ? 1 : -1);
      const markCos = Math.cos(markAngle);
      const markSin = Math.sin(markAngle);

      const markStartX = markCenterX - markCos * markLength * 0.5;
      const markStartY = markCenterY - markSin * markLength * 0.5;
      const markEndX = markCenterX + markCos * markLength * 0.5;
      const markEndY = markCenterY + markSin * markLength * 0.5;
      const markCtrlX = markCenterX + (-markSin) * markCurve;
      const markCtrlY = markCenterY + markCos * markCurve;

      const cutMarkPerpX = -markSin;
      const cutMarkPerpY = markCos;

      if (currentQuality === 'high') {
        // Outer glow crescent (replaces 2px stroke)
        const glowOuterCtrlX = markCtrlX + cutMarkPerpX * 1.5;
        const glowOuterCtrlY = markCtrlY + cutMarkPerpY * 1.5;
        const glowInnerCtrlX = markCtrlX - cutMarkPerpX * 1.5;
        const glowInnerCtrlY = markCtrlY - cutMarkPerpY * 1.5;

        cutMarkGraphics.fillStyle(WEAPON_COLORS.blade.core, 0.3);
        cutMarkGraphics.beginPath();
        cutMarkGraphics.moveTo(markStartX, markStartY);
        this.quadBezierTo(cutMarkGraphics, markStartX, markStartY, glowOuterCtrlX, glowOuterCtrlY, markEndX, markEndY, 8);
        this.quadBezierTo(cutMarkGraphics, markEndX, markEndY, glowInnerCtrlX, glowInnerCtrlY, markStartX, markStartY, 8);
        cutMarkGraphics.closePath();
        cutMarkGraphics.fillPath();

        // White core crescent (replaces 1px stroke)
        const coreOuterCtrlX = markCtrlX + cutMarkPerpX * 0.75;
        const coreOuterCtrlY = markCtrlY + cutMarkPerpY * 0.75;
        const coreInnerCtrlX = markCtrlX - cutMarkPerpX * 0.75;
        const coreInnerCtrlY = markCtrlY - cutMarkPerpY * 0.75;

        cutMarkGraphics.fillStyle(0xffffff, 0.4);
        cutMarkGraphics.beginPath();
        cutMarkGraphics.moveTo(markStartX, markStartY);
        this.quadBezierTo(cutMarkGraphics, markStartX, markStartY, coreOuterCtrlX, coreOuterCtrlY, markEndX, markEndY, 8);
        this.quadBezierTo(cutMarkGraphics, markEndX, markEndY, coreInnerCtrlX, coreInnerCtrlY, markStartX, markStartY, 8);
        cutMarkGraphics.closePath();
        cutMarkGraphics.fillPath();
      } else {
        // Low/medium: single thin crescent (replaces 1px stroke)
        const cutCoreOuterCtrlX = markCtrlX + cutMarkPerpX * 0.75;
        const cutCoreOuterCtrlY = markCtrlY + cutMarkPerpY * 0.75;
        const cutCoreInnerCtrlX = markCtrlX - cutMarkPerpX * 0.75;
        const cutCoreInnerCtrlY = markCtrlY - cutMarkPerpY * 0.75;

        cutMarkGraphics.fillStyle(0xffffff, 0.4);
        cutMarkGraphics.beginPath();
        cutMarkGraphics.moveTo(markStartX, markStartY);
        this.quadBezierTo(cutMarkGraphics, markStartX, markStartY, cutCoreOuterCtrlX, cutCoreOuterCtrlY, markEndX, markEndY, 8);
        this.quadBezierTo(cutMarkGraphics, markEndX, markEndY, cutCoreInnerCtrlX, cutCoreInnerCtrlY, markStartX, markStartY, 8);
        cutMarkGraphics.closePath();
        cutMarkGraphics.fillPath();
      }

      ctx.scene.time.delayedCall(300, () => cutMarkGraphics.destroy());
    }

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
