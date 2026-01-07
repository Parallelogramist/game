import { BaseWeapon, WeaponContext, WeaponStats } from './BaseWeapon';
import { Transform } from '../ecs/components';
import { getEnemySpatialHash } from '../utils/SpatialHash';

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
  private hitCooldowns: Map<number, number> = new Map(); // enemyId -> lastHitTime

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
    // Ensure we have the right number of blades
    this.ensureBladeCount(ctx);

    // Mastery: Blade Storm cooldown management
    if (this.isMastered()) {
      this.updateBladeStorm(ctx);
    }

    // Update blade positions
    const currentTime = ctx.gameTime;

    for (let i = 0; i < this.blades.length; i++) {
      // Update angle
      this.bladeAngles[i] += this.rotationSpeed * ctx.deltaTime;

      // Calculate position - modified during Blade Storm
      const angle = this.bladeAngles[i];
      let currentRadius = this.orbitRadius;

      if (this.isBladeStormActive) {
        currentRadius = this.bladeStormRadii[i] || this.orbitRadius;
      }

      const x = ctx.playerX + Math.cos(angle) * currentRadius;
      const y = ctx.playerY + Math.sin(angle) * currentRadius;

      // Update blade position
      this.blades[i].setPosition(x, y);

      // Set blade rotation to always point radially outward (tip away from player)
      // The blade is drawn with tip at -Y, so add π/2 to make tip point along radius
      const radialAngle = angle + Math.PI / 2;
      this.blades[i].setRotation(radialAngle);

      // Update axial spin for coin-flip effect on hilt
      const axialSpinSpeed = 12; // rad/s - ultra-fast hilt spinning
      this.bladeSpinAngles[i] += axialSpinSpeed * ctx.deltaTime;

      // Apply coin-flip effect: scaleX oscillates from -1 to 1
      // This simulates the hilt spinning around the blade's length axis
      const hiltScaleX = Math.cos(this.bladeSpinAngles[i]);
      if (this.bladeHilts[i]) {
        this.bladeHilts[i].setScale(hiltScaleX, 1);
      }

      // Check collision with nearby enemies using spatial hash
      const spatialHash = getEnemySpatialHash();
      const bladeHitRadius = 20 * this.stats.size;
      const queryRadius = bladeHitRadius + 15; // Blade radius + enemy radius

      const nearbyEnemies = spatialHash.queryPotential(x, y, queryRadius);

      for (const enemy of nearbyEnemies) {
        const enemyId = enemy.id;

        // During Blade Storm outward phase, use per-blade hit tracking (pierce all)
        if (this.isBladeStormActive && this.bladeStormPhase === 'outward') {
          if (this.bladeStormHitEnemies[i]?.has(enemyId)) continue;
        } else {
          // Normal cooldown check
          const lastHit = this.hitCooldowns.get(enemyId) || 0;
          if (currentTime - lastHit < this.stats.cooldown) continue;
        }

        const ex = Transform.x[enemyId];
        const ey = Transform.y[enemyId];
        const dx = ex - x;
        const dy = ey - y;
        const dist = Math.sqrt(dx * dx + dy * dy);

        if (dist < bladeHitRadius + 12) {
          // Hit! 300% damage during Blade Storm outward phase
          const stormDamage = (this.isBladeStormActive && this.bladeStormPhase === 'outward')
            ? this.stats.damage * 3
            : this.stats.damage;

          ctx.damageEnemy(enemyId, stormDamage, this.isBladeStormActive ? 300 : 150);

          if (this.isBladeStormActive && this.bladeStormPhase === 'outward') {
            this.bladeStormHitEnemies[i]?.add(enemyId);
          } else {
            this.hitCooldowns.set(enemyId, currentTime);
          }

          // Spark effect (golden during storm)
          ctx.effectsManager.playHitSparks(x, y, angle);
        }
      }
    }

    // Clean up old cooldowns
    if (Math.random() < 0.01) {
      for (const [enemyId, time] of this.hitCooldowns) {
        if (currentTime - time > 5) {
          this.hitCooldowns.delete(enemyId);
        }
      }
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
    container.setDepth(5);

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

    // Blade graphics (triangle) - stays fixed
    const bladeGraphics = ctx.scene.add.graphics();
    bladeGraphics.fillStyle(0x4488ff, 1);
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
    bladeGraphics.lineStyle(3, 0x66aaff, 0.4);
    bladeGraphics.strokePath();

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
    this.hitCooldowns.clear();
    super.destroy();
  }
}
