import { BaseWeapon, WeaponContext, WeaponStats } from './BaseWeapon';
import { Transform } from '../ecs/components';
import { getEnemySpatialHash } from '../utils/SpatialHash';
import { WEAPON_COLORS } from '../visual/NeonColors';
import { DepthLayers } from '../visual/DepthLayers';
import { HitCooldownTracker } from './WeaponUtils';
import { VisualQuality } from '../visual/GlowGraphics';

/**
 * OrbitingBladesWeapon creates blades that continuously orbit the player.
 * Deals damage on contact. Great for close-range protection.
 */
export class OrbitingBladesWeapon extends BaseWeapon {
  private blades: Phaser.GameObjects.Container[] = [];
  private bladeAngles: number[] = [];
  private bladeSpinAngles: number[] = []; // Axial spin for coin-flip effect on hilt
  private bladeHilts: Phaser.GameObjects.Graphics[] = []; // Separate hilt graphics for scaling
  private rotationSpeed: number = 2; // Radians per second
  private orbitRadius: number = 60;
  private hitCooldowns = new HitCooldownTracker();
  private trailGraphics: Phaser.GameObjects.Graphics | null = null;
  private orbitRingGraphics: Phaser.GameObjects.Graphics | null = null;
  private previousAngles: number[][] = []; // previousAngles[bladeIndex][historyIndex]

  private currentQuality: VisualQuality = 'high';
  private ringPulsePhase: number = 0;

  // Mastery: Blade Storm
  private bladeStormCooldown: number = 0;
  private readonly BLADE_STORM_COOLDOWN = 10; // seconds
  private readonly BLADE_STORM_DURATION = 2;  // seconds for outward flight
  private isBladeStormActive: boolean = false;
  private bladeStormTimer: number = 0;
  private bladeStormPhase: 'outward' | 'returning' = 'outward';
  private bladeStormRadii: number[] = [];     // Current radius per blade during storm
  private bladeStormHitEnemies: Set<number>[] = []; // Track which enemies each blade hit

  constructor() {
    const baseStats: WeaponStats = {
      damage: 15,
      cooldown: 0.3,     // Hit cooldown per enemy
      range: 60,         // Orbit radius
      count: 2,          // Number of blades
      piercing: 999,
      size: 1,
      speed: 2,          // Rotation speed
      duration: 999,
    };

    super(
      'orbiting_blades',
      'Orbiting Blades',
      'orbiting-blades',
      'Blades circle around you',
      10,
      baseStats,
      'Blade Storm',
      'Every 10s, launch blades outward for 300% damage, then return'
    );

    this.orbitRadius = baseStats.range;
    this.rotationSpeed = baseStats.speed;
  }

  protected attack(_ctx: WeaponContext): void {
    // Orbiting blades don't have a traditional "attack"
    // They deal damage continuously in updateEffects
  }

  protected updateEffects(ctx: WeaponContext): void {
    this.currentQuality = ctx.visualQuality;

    // Ensure we have the right number of blades
    this.ensureBladeCount(ctx);

    // Mastery: Blade Storm cooldown management
    if (this.isMastered()) {
      this.updateBladeStorm(ctx);
    }

    // Ensure previousAngles array matches blade count
    while (this.previousAngles.length < this.blades.length) {
      this.previousAngles.push([]);
    }
    while (this.previousAngles.length > this.blades.length) {
      this.previousAngles.pop();
    }

    // Record current angles before updating (for trail)
    const maxTrailHistory = this.currentQuality === 'low' ? 3 : 5;
    for (let bladeIndex = 0; bladeIndex < this.blades.length; bladeIndex++) {
      this.previousAngles[bladeIndex].unshift(this.bladeAngles[bladeIndex]);
      if (this.previousAngles[bladeIndex].length > maxTrailHistory) {
        this.previousAngles[bladeIndex].length = maxTrailHistory;
      }
    }

    // Ensure trailGraphics and orbitRingGraphics exist
    if (!this.trailGraphics) {
      this.trailGraphics = ctx.scene.add.graphics();
      this.trailGraphics.setDepth(DepthLayers.TRAIL);
    }
    if (!this.orbitRingGraphics) {
      this.orbitRingGraphics = ctx.scene.add.graphics();
      this.orbitRingGraphics.setDepth(DepthLayers.ORBIT_RING);
    }

    // Clear trail and orbit ring each frame for redrawing
    this.trailGraphics.clear();
    this.orbitRingGraphics.clear();

    // Update blade positions
    const currentTime = ctx.gameTime;
    let hitFlashesThisFrame = 0;

    for (let bladeIndex = 0; bladeIndex < this.blades.length; bladeIndex++) {
      // Update angle
      this.bladeAngles[bladeIndex] += this.rotationSpeed * ctx.deltaTime;

      // Calculate position - modified during Blade Storm
      const angle = this.bladeAngles[bladeIndex];
      let currentRadius = this.orbitRadius;

      if (this.isBladeStormActive) {
        currentRadius = this.bladeStormRadii[bladeIndex] || this.orbitRadius;
      }

      const bladeX = ctx.playerX + Math.cos(angle) * currentRadius;
      const bladeY = ctx.playerY + Math.sin(angle) * currentRadius;

      // Update blade position
      this.blades[bladeIndex].setPosition(bladeX, bladeY);

      // Set blade rotation to always point radially outward (tip away from player)
      // The blade is drawn with tip at -Y, so add π/2 to make tip point along radius
      const radialAngle = angle + Math.PI / 2;
      this.blades[bladeIndex].setRotation(radialAngle);

      // Update axial spin for coin-flip effect on hilt
      const axialSpinSpeed = 12; // rad/s - ultra-fast hilt spinning
      this.bladeSpinAngles[bladeIndex] += axialSpinSpeed * ctx.deltaTime;

      // Apply coin-flip effect: scaleX oscillates from -1 to 1
      // This simulates the hilt spinning around the blade's length axis
      const hiltScaleX = Math.cos(this.bladeSpinAngles[bladeIndex]);
      if (this.bladeHilts[bladeIndex]) {
        this.bladeHilts[bladeIndex].setScale(hiltScaleX, 1);
      }

      // Draw blade motion trail
      const bladeScale = this.stats.size;
      const trailBladeWidth = 10 * bladeScale;

      if (this.currentQuality === 'low') {
        // Low: 2 afterimage triangles (simplified)
        const trailAlphas = [0.15, 0.08];
        const trailBladeLength = 20 * bladeScale;
        const trailCount = Math.min(2, this.previousAngles[bladeIndex].length);

        for (let historyIndex = 0; historyIndex < trailCount; historyIndex++) {
          const prevAngle = this.previousAngles[bladeIndex][historyIndex];
          const trailRadius = this.isBladeStormActive
            ? (this.bladeStormRadii[bladeIndex] || this.orbitRadius)
            : this.orbitRadius;
          const trailX = ctx.playerX + Math.cos(prevAngle) * trailRadius;
          const trailY = ctx.playerY + Math.sin(prevAngle) * trailRadius;
          const trailRotation = prevAngle + Math.PI / 2;

          this.trailGraphics.fillStyle(WEAPON_COLORS.orbit.core, trailAlphas[historyIndex]);
          const tipX = trailX + Math.cos(trailRotation - Math.PI / 2) * trailBladeLength;
          const tipY = trailY + Math.sin(trailRotation - Math.PI / 2) * trailBladeLength;
          const rightBaseX = trailX + Math.cos(trailRotation) * (trailBladeWidth / 2);
          const rightBaseY = trailY + Math.sin(trailRotation) * (trailBladeWidth / 2);
          const leftBaseX = trailX - Math.cos(trailRotation) * (trailBladeWidth / 2);
          const leftBaseY = trailY - Math.sin(trailRotation) * (trailBladeWidth / 2);

          this.trailGraphics.fillTriangle(tipX, tipY, rightBaseX, rightBaseY, leftBaseX, leftBaseY);
        }
      } else {
        // Medium/High: filled arc wedge trail (ribbon-like sweep)
        const oldestAngle = this.previousAngles[bladeIndex][this.previousAngles[bladeIndex].length - 1] || angle;
        const arcSegments = this.currentQuality === 'high' ? 8 : 4;
        const angleSpan = angle - oldestAngle;

        this.trailGraphics.fillStyle(WEAPON_COLORS.orbit.core, 0.1);
        this.trailGraphics.beginPath();

        // Inner arc (closer to player)
        for (let arcStep = 0; arcStep <= arcSegments; arcStep++) {
          const interpolation = arcStep / arcSegments;
          const arcAngle = oldestAngle + angleSpan * interpolation;
          const innerRadius = currentRadius - trailBladeWidth * 0.3;
          const innerArcX = ctx.playerX + Math.cos(arcAngle) * innerRadius;
          const innerArcY = ctx.playerY + Math.sin(arcAngle) * innerRadius;
          if (arcStep === 0) {
            this.trailGraphics.moveTo(innerArcX, innerArcY);
          } else {
            this.trailGraphics.lineTo(innerArcX, innerArcY);
          }
        }

        // Outer arc (further from player) - reverse direction
        for (let arcStep = arcSegments; arcStep >= 0; arcStep--) {
          const interpolation = arcStep / arcSegments;
          const arcAngle = oldestAngle + angleSpan * interpolation;
          const outerRadius = currentRadius + trailBladeWidth * 0.3;
          const outerArcX = ctx.playerX + Math.cos(arcAngle) * outerRadius;
          const outerArcY = ctx.playerY + Math.sin(arcAngle) * outerRadius;
          this.trailGraphics.lineTo(outerArcX, outerArcY);
        }

        this.trailGraphics.closePath();
        this.trailGraphics.fillPath();
      }

      // Blade Storm spiral trail (high quality only)
      if (this.currentQuality === 'high' && this.isBladeStormActive && this.previousAngles[bladeIndex].length > 0) {
        const prevStormAngle = this.previousAngles[bladeIndex][0];
        const prevStormRadius = this.bladeStormRadii[bladeIndex] || this.orbitRadius;
        const prevStormX = ctx.playerX + Math.cos(prevStormAngle) * prevStormRadius;
        const prevStormY = ctx.playerY + Math.sin(prevStormAngle) * prevStormRadius;

        this.trailGraphics.lineStyle(2, 0xffd700, 0.3);
        this.trailGraphics.beginPath();
        this.trailGraphics.moveTo(prevStormX, prevStormY);
        this.trailGraphics.lineTo(bladeX, bladeY);
        this.trailGraphics.strokePath();
      }

      // Check collision with nearby enemies using spatial hash
      const spatialHash = getEnemySpatialHash();
      const bladeHitRadius = 20 * this.stats.size;
      const queryRadius = bladeHitRadius + 15; // Blade radius + enemy radius

      const nearbyEnemies = spatialHash.queryPotential(bladeX, bladeY, queryRadius);

      for (const enemy of nearbyEnemies) {
        const enemyId = enemy.id;

        // During Blade Storm outward phase, use per-blade hit tracking (pierce all)
        if (this.isBladeStormActive && this.bladeStormPhase === 'outward') {
          if (this.bladeStormHitEnemies[bladeIndex]?.has(enemyId)) continue;
        } else {
          // Normal cooldown check
          if (!this.hitCooldowns.canHit(enemyId, currentTime, this.stats.cooldown)) continue;
        }

        const enemyX = Transform.x[enemyId];
        const enemyY = Transform.y[enemyId];
        const dx = enemyX - bladeX;
        const dy = enemyY - bladeY;
        const distSq = dx * dx + dy * dy;
        const hitRange = bladeHitRadius + 12;

        if (distSq < hitRange * hitRange) {
          // Hit! 300% damage during Blade Storm outward phase
          const stormDamage = (this.isBladeStormActive && this.bladeStormPhase === 'outward')
            ? this.stats.damage * 3
            : this.stats.damage;

          ctx.damageEnemy(enemyId, stormDamage, this.isBladeStormActive ? 300 : 150);

          if (this.isBladeStormActive && this.bladeStormPhase === 'outward') {
            this.bladeStormHitEnemies[bladeIndex]?.add(enemyId);
          } else {
            this.hitCooldowns.recordHit(enemyId, currentTime);
          }

          // Spark effect (golden during storm)
          ctx.effectsManager.playHitSparks(bladeX, bladeY, angle);

          // Hit flash on contact (cap at 3 per frame)
          if (hitFlashesThisFrame < 3) {
            const contactFlash = ctx.scene.add.circle(bladeX, bladeY, 8, WEAPON_COLORS.orbitHit.core, 0.7);
            contactFlash.setDepth(DepthLayers.BLADE_HIT);
            ctx.scene.tweens.add({
              targets: contactFlash,
              scaleX: 2,
              scaleY: 2,
              alpha: 0,
              duration: 80,
              onComplete: () => contactFlash.destroy(),
            });
            hitFlashesThisFrame++;
          }
        }
      }
    }

    // Draw faint dashed orbit ring
    const dashCount = 16;
    const dashArcAngle = (Math.PI * 2 / dashCount) * 0.67; // ~15 degrees per dash
    const gapArcAngle = (Math.PI * 2 / dashCount) * 0.33;  // ~7.5 degrees gap

    if (this.currentQuality === 'high') {
      // High: energy flow ring with pulsing alpha per segment
      this.ringPulsePhase += ctx.deltaTime * 3;

      for (let dashIndex = 0; dashIndex < dashCount; dashIndex++) {
        const segmentAlpha = 0.05 + Math.sin(this.ringPulsePhase + dashIndex * 0.4) * 0.05;
        this.orbitRingGraphics.lineStyle(1, WEAPON_COLORS.orbit.core, segmentAlpha);

        const dashStartAngle = dashIndex * (dashArcAngle + gapArcAngle);
        const ringArcSegments = 4;
        this.orbitRingGraphics.beginPath();
        for (let arcStep = 0; arcStep <= ringArcSegments; arcStep++) {
          const arcAngle = dashStartAngle + (dashArcAngle * arcStep / ringArcSegments);
          const arcX = ctx.playerX + Math.cos(arcAngle) * this.orbitRadius;
          const arcY = ctx.playerY + Math.sin(arcAngle) * this.orbitRadius;
          if (arcStep === 0) {
            this.orbitRingGraphics.moveTo(arcX, arcY);
          } else {
            this.orbitRingGraphics.lineTo(arcX, arcY);
          }
        }
        this.orbitRingGraphics.strokePath();
      }
    } else {
      // Low/Medium: static dashed arcs
      this.orbitRingGraphics.lineStyle(1, WEAPON_COLORS.orbit.core, 0.08);

      for (let dashIndex = 0; dashIndex < dashCount; dashIndex++) {
        const dashStartAngle = dashIndex * (dashArcAngle + gapArcAngle);
        const ringArcSegments = 4;
        this.orbitRingGraphics.beginPath();
        for (let arcStep = 0; arcStep <= ringArcSegments; arcStep++) {
          const arcAngle = dashStartAngle + (dashArcAngle * arcStep / ringArcSegments);
          const arcX = ctx.playerX + Math.cos(arcAngle) * this.orbitRadius;
          const arcY = ctx.playerY + Math.sin(arcAngle) * this.orbitRadius;
          if (arcStep === 0) {
            this.orbitRingGraphics.moveTo(arcX, arcY);
          } else {
            this.orbitRingGraphics.lineTo(arcX, arcY);
          }
        }
        this.orbitRingGraphics.strokePath();
      }
    }

    // Clean up old cooldowns
    if (Math.random() < 0.01) {
      this.hitCooldowns.cleanup(currentTime, 5);
    }
  }

  /**
   * Mastery: Blade Storm - launch blades outward every 10s for 300% damage.
   */
  private updateBladeStorm(ctx: WeaponContext): void {
    if (!this.isBladeStormActive) {
      // Cooldown management
      this.bladeStormCooldown -= ctx.deltaTime;
      if (this.bladeStormCooldown <= 0) {
        this.activateBladeStorm(ctx);
      }
    } else {
      // Storm is active
      this.bladeStormTimer -= ctx.deltaTime;

      if (this.bladeStormPhase === 'outward') {
        // Blades expand outward
        const maxRadius = this.orbitRadius * 4;
        const progress = 1 - (this.bladeStormTimer / this.BLADE_STORM_DURATION);

        for (let i = 0; i < this.blades.length; i++) {
          // Spiral outward with slight offset per blade
          const spiralOffset = (i / this.blades.length) * 0.5;
          this.bladeStormRadii[i] = this.orbitRadius + (maxRadius - this.orbitRadius) * (progress + spiralOffset);

          // Also spin faster during storm
          this.bladeAngles[i] += this.rotationSpeed * 2 * ctx.deltaTime;
        }

        if (this.bladeStormTimer <= 0) {
          // Switch to returning phase
          this.bladeStormPhase = 'returning';
          this.bladeStormTimer = this.BLADE_STORM_DURATION * 0.5; // Return faster
        }
      } else {
        // Returning phase
        const returnProgress = 1 - (this.bladeStormTimer / (this.BLADE_STORM_DURATION * 0.5));

        for (let i = 0; i < this.blades.length; i++) {
          const maxRadius = this.orbitRadius * 4;
          this.bladeStormRadii[i] = maxRadius - (maxRadius - this.orbitRadius) * returnProgress;
        }

        if (this.bladeStormTimer <= 0) {
          this.deactivateBladeStorm();
        }
      }
    }
  }

  /**
   * Start the Blade Storm.
   */
  private activateBladeStorm(ctx: WeaponContext): void {
    this.isBladeStormActive = true;
    this.bladeStormTimer = this.BLADE_STORM_DURATION;
    this.bladeStormPhase = 'outward';
    this.bladeStormRadii = this.blades.map(() => this.orbitRadius);
    this.bladeStormHitEnemies = this.blades.map(() => new Set<number>());

    // Visual: flash blades gold
    for (const blade of this.blades) {
      const graphics = blade.first as Phaser.GameObjects.Graphics;
      if (graphics) {
        // Add golden glow effect
        const glow = ctx.scene.add.graphics();
        glow.fillStyle(0xffd700, 0.6);
        glow.fillCircle(0, 0, 30 * this.stats.size);
        blade.addAt(glow, 0);

        ctx.scene.tweens.add({
          targets: glow,
          alpha: 0,
          scaleX: 2,
          scaleY: 2,
          duration: 300,
          onComplete: () => glow.destroy(),
        });
      }
    }
  }

  /**
   * End the Blade Storm.
   */
  private deactivateBladeStorm(): void {
    this.isBladeStormActive = false;
    this.bladeStormCooldown = this.BLADE_STORM_COOLDOWN;
    this.bladeStormRadii = [];
    this.bladeStormHitEnemies = [];
  }

  private ensureBladeCount(ctx: WeaponContext): void {
    const targetCount = this.stats.count;

    // Add blades if needed
    while (this.blades.length < targetCount) {
      const { container, hilt } = this.createBlade(ctx);
      this.blades.push(container);
      this.bladeHilts.push(hilt);

      // Distribute blades evenly
      const angle = (2 * Math.PI / targetCount) * this.blades.length;
      this.bladeAngles.push(angle);
      this.bladeSpinAngles.push(0); // Initialize axial spin rotation
    }

    // Remove excess blades
    while (this.blades.length > targetCount) {
      const blade = this.blades.pop();
      blade?.destroy();
      this.bladeHilts.pop(); // Hilt is destroyed with container
      this.bladeAngles.pop();
      this.bladeSpinAngles.pop();
    }
  }

  private createBlade(ctx: WeaponContext): { container: Phaser.GameObjects.Container; hilt: Phaser.GameObjects.Graphics } {
    const container = ctx.scene.add.container(ctx.playerX, ctx.playerY);
    container.setDepth(DepthLayers.BLADE);

    const scale = this.stats.size;
    const bladeLength = 20 * scale;
    const bladeWidth = 10 * scale;
    const crossguardWidth = 14 * scale;
    const crossguardHeight = 3 * scale;
    const handleWidth = 4 * scale;
    const handleLength = 8 * scale;

    // Vertical offset to center the dagger around its visual center
    const centerOffset = 2 * scale;

    // Create separate graphics for blade and hilt (for independent scaling)
    const bladeGraphics = ctx.scene.add.graphics();

    if (this.currentQuality === 'low') {
      // Low: simple triangle blade
      bladeGraphics.fillStyle(WEAPON_COLORS.orbit.core, 1);
      bladeGraphics.beginPath();
      bladeGraphics.moveTo(0, -bladeLength - centerOffset);  // Tip
      bladeGraphics.lineTo(bladeWidth / 2, -centerOffset);   // Right base
      bladeGraphics.lineTo(-bladeWidth / 2, -centerOffset);  // Left base
      bladeGraphics.closePath();
      bladeGraphics.fillPath();

      // Blade outline - white
      bladeGraphics.lineStyle(2, 0xffffff, 1);
      bladeGraphics.strokePath();

      // Blade glow
      bladeGraphics.lineStyle(3, WEAPON_COLORS.orbit.glow, 0.4);
      bladeGraphics.strokePath();
    } else {
      // Medium/High: 7-vertex sword silhouette
      const tipY = -bladeLength - centerOffset;
      const shoulderY = -bladeLength * 0.65 - centerOffset;
      const fullerY = -bladeLength * 0.3 - centerOffset;
      const baseY = -centerOffset;

      bladeGraphics.fillStyle(WEAPON_COLORS.orbit.core, 1);
      bladeGraphics.beginPath();
      bladeGraphics.moveTo(0, tipY);                           // tip
      bladeGraphics.lineTo(bladeWidth * 0.4, shoulderY);       // right shoulder
      bladeGraphics.lineTo(bladeWidth * 0.35, fullerY);        // right fuller (narrowing)
      bladeGraphics.lineTo(bladeWidth * 0.5, baseY);           // right base (wider at guard)
      bladeGraphics.lineTo(-bladeWidth * 0.5, baseY);          // left base
      bladeGraphics.lineTo(-bladeWidth * 0.35, fullerY);       // left fuller
      bladeGraphics.lineTo(-bladeWidth * 0.4, shoulderY);      // left shoulder
      bladeGraphics.closePath();
      bladeGraphics.fillPath();

      // Blade outline - white
      bladeGraphics.lineStyle(2, 0xffffff, 1);
      bladeGraphics.strokePath();

      // Blade glow
      bladeGraphics.lineStyle(3, WEAPON_COLORS.orbit.glow, 0.4);
      bladeGraphics.strokePath();

      // High quality: center blood-groove line from tip to base
      if (this.currentQuality === 'high') {
        bladeGraphics.lineStyle(1, 0x1a1a4e, 0.4);
        bladeGraphics.beginPath();
        bladeGraphics.moveTo(0, tipY);
        bladeGraphics.lineTo(0, baseY);
        bladeGraphics.strokePath();
      }
    }

    // Hilt graphics (crossguard + handle) - will scale X for coin-flip effect
    const hiltGraphics = ctx.scene.add.graphics();

    // Draw crossguard (horizontal rectangle) - darker blue
    hiltGraphics.fillStyle(0x3366cc, 1);
    hiltGraphics.fillRect(-crossguardWidth / 2, -centerOffset, crossguardWidth, crossguardHeight);
    hiltGraphics.lineStyle(1, 0xffffff, 0.8);
    hiltGraphics.strokeRect(-crossguardWidth / 2, -centerOffset, crossguardWidth, crossguardHeight);

    // Draw handle (vertical rectangle) - dark blue/purple
    hiltGraphics.fillStyle(0x2244aa, 1);
    hiltGraphics.fillRect(-handleWidth / 2, crossguardHeight - centerOffset, handleWidth, handleLength);
    hiltGraphics.lineStyle(1, 0x88aaff, 0.6);
    hiltGraphics.strokeRect(-handleWidth / 2, crossguardHeight - centerOffset, handleWidth, handleLength);

    // Add both to container (hilt first so blade renders on top)
    container.add(hiltGraphics);
    container.add(bladeGraphics);

    return { container, hilt: hiltGraphics };
  }

  protected recalculateStats(): void {
    super.recalculateStats();
    // More blades at higher levels
    this.stats.count = this.baseStats.count + Math.floor((this.level - 1) / 2) + this.externalBonusCount;
    // Faster rotation
    this.stats.speed = this.baseStats.speed + (this.level - 1) * 0.3;
    // Larger orbit
    this.stats.range = this.baseStats.range + (this.level - 1) * 8;

    this.orbitRadius = this.stats.range;
    this.rotationSpeed = this.stats.speed;
  }

  public destroy(): void {
    for (const blade of this.blades) {
      blade.destroy();
    }
    this.blades = [];
    this.bladeHilts = []; // Hilts are destroyed with containers
    this.bladeAngles = [];
    this.bladeSpinAngles = [];
    this.previousAngles = [];
    if (this.trailGraphics) {
      this.trailGraphics.destroy();
      this.trailGraphics = null;
    }
    if (this.orbitRingGraphics) {
      this.orbitRingGraphics.destroy();
      this.orbitRingGraphics = null;
    }
    this.hitCooldowns.clear();
    super.destroy();
  }
}
