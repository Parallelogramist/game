import { BaseWeapon, WeaponContext, WeaponStats } from './BaseWeapon';
import { Transform, Velocity } from '../ecs/components';

/**
 * AuraWeapon creates a damaging field around the player.
 * Deals continuous damage to all enemies within range.
 * Low damage but constant - great for swarms.
 */
export class AuraWeapon extends BaseWeapon {
  private auraGraphics: Phaser.GameObjects.Graphics | null = null;
  private pulsePhase: number = 0;
  private hitCooldowns: Map<number, number> = new Map();

  // Mastery: Consecrated Ground
  private stillnessTimer: number = 0;
  private isConsecrated: boolean = false;
  private consecratedRegenAccumulator: number = 0;
  private readonly CONSECRATION_THRESHOLD = 1.5; // Seconds standing still
  private readonly CONSECRATION_REGEN_RATE = 2;  // HP per second
  private readonly CONSECRATION_SLOW = 0.3;      // 30% slow

  constructor() {
    const baseStats: WeaponStats = {
      damage: 5,
      cooldown: 0.5,      // Damage tick rate
      range: 80,          // Aura radius
      count: 1,
      piercing: 999,
      size: 1,
      speed: 1,
      duration: 999,
    };

    super(
      'aura',
      'Spirit Guardians',
      'holy-aura',
      'Damages nearby enemies',
      10,
      baseStats,
      'Consecrated Ground',
      'Standing still 1.5s: +100% damage, +2 HP/s regen, 30% enemy slow'
    );
  }

  protected attack(_ctx: WeaponContext): void {
    // Aura doesn't have discrete attacks, uses tick damage
  }

  protected updateEffects(ctx: WeaponContext): void {
    const currentTime = ctx.gameTime;
    const radius = this.stats.range * this.stats.size;

    // Mastery: Consecrated Ground - check if player is standing still
    let damageMultiplier = 1;
    if (this.isMastered()) {
      this.updateConsecratedState(ctx);
      if (this.isConsecrated) {
        damageMultiplier = 2; // +100% damage
      }
    }

    // Ensure aura visual exists
    this.ensureAuraVisual(ctx);

    // Update aura position and pulse
    if (this.auraGraphics) {
      this.auraGraphics.setPosition(ctx.playerX, ctx.playerY);

      // Pulse effect (faster when consecrated)
      const pulseSpeed = this.isConsecrated ? 5 : 3;
      this.pulsePhase += ctx.deltaTime * pulseSpeed;
      const pulseScale = 1 + Math.sin(this.pulsePhase) * 0.05;
      this.auraGraphics.setScale(pulseScale);

      // Redraw with current radius and consecrated state
      this.drawAura(radius);
    }

    // Deal damage to enemies in range
    const enemies = ctx.getEnemies();
    for (const enemyId of enemies) {
      const lastHit = this.hitCooldowns.get(enemyId) || 0;
      if (currentTime - lastHit < this.stats.cooldown) continue;

      const ex = Transform.x[enemyId];
      const ey = Transform.y[enemyId];
      const dx = ex - ctx.playerX;
      const dy = ey - ctx.playerY;
      const dist = Math.sqrt(dx * dx + dy * dy);

      if (dist <= radius) {
        const finalDamage = this.stats.damage * damageMultiplier;
        ctx.damageEnemy(enemyId, finalDamage, 50); // Light knockback
        this.hitCooldowns.set(enemyId, currentTime);

        // Mastery: Slow enemies when consecrated
        if (this.isConsecrated) {
          this.applyConsecratedSlow(enemyId);
        }

        // Small effect at enemy position (golden sparkles when consecrated)
        if (Math.random() < 0.3) {
          ctx.effectsManager.playXPSparkle(ex, ey);
        }
      }
    }

    // Clean up old cooldowns occasionally
    if (Math.random() < 0.01) {
      for (const [enemyId, time] of this.hitCooldowns) {
        if (currentTime - time > 5) {
          this.hitCooldowns.delete(enemyId);
        }
      }
    }
  }

  /**
   * Mastery: Check if player is standing still and update consecration state.
   */
  private updateConsecratedState(ctx: WeaponContext): void {
    // Check player velocity (near zero = standing still)
    const playerVelX = Velocity.x[ctx.playerId] || 0;
    const playerVelY = Velocity.y[ctx.playerId] || 0;
    const speed = Math.sqrt(playerVelX * playerVelX + playerVelY * playerVelY);

    const isStandingStill = speed < 5; // Small threshold for "still"

    if (isStandingStill) {
      this.stillnessTimer += ctx.deltaTime;

      if (this.stillnessTimer >= this.CONSECRATION_THRESHOLD) {
        if (!this.isConsecrated) {
          this.isConsecrated = true;
          // Flash effect when activating
          this.playConsecratedActivation(ctx);
        }

        // Apply regen while consecrated
        this.consecratedRegenAccumulator += this.CONSECRATION_REGEN_RATE * ctx.deltaTime;
        if (this.consecratedRegenAccumulator >= 1) {
          const healAmount = Math.floor(this.consecratedRegenAccumulator);
          ctx.healPlayer(healAmount);
          this.consecratedRegenAccumulator -= healAmount;
        }
      }
    } else {
      // Moving - reset consecration
      this.stillnessTimer = 0;
      this.isConsecrated = false;
      this.consecratedRegenAccumulator = 0;
    }
  }

  /**
   * Mastery: Apply 30% slow to enemies in the consecrated aura.
   */
  private applyConsecratedSlow(enemyId: number): void {
    // Reduce velocity by 30% (applied each tick, enemies naturally recover between ticks)
    Velocity.x[enemyId] *= (1 - this.CONSECRATION_SLOW);
    Velocity.y[enemyId] *= (1 - this.CONSECRATION_SLOW);
  }

  /**
   * Visual flash when consecrated ground activates.
   */
  private playConsecratedActivation(ctx: WeaponContext): void {
    const flash = ctx.scene.add.graphics();
    flash.setDepth(2);
    flash.setPosition(ctx.playerX, ctx.playerY);

    const radius = this.stats.range * this.stats.size;
    flash.fillStyle(0xffd700, 0.6);
    flash.fillCircle(0, 0, radius);

    ctx.scene.tweens.add({
      targets: flash,
      alpha: 0,
      scaleX: 1.3,
      scaleY: 1.3,
      duration: 300,
      onComplete: () => flash.destroy(),
    });
  }

  private ensureAuraVisual(ctx: WeaponContext): void {
    if (!this.auraGraphics) {
      this.auraGraphics = ctx.scene.add.graphics();
      this.auraGraphics.setDepth(1); // Below player
    }
  }

  private drawAura(radius: number): void {
    if (!this.auraGraphics) return;

    this.auraGraphics.clear();

    // Colors change when consecrated (gold instead of blue)
    const outerColor = this.isConsecrated ? 0xffd700 : 0x88aaff;
    const midColor = this.isConsecrated ? 0xffec8b : 0x6699ff;
    const coreColor = this.isConsecrated ? 0xffffcc : 0xaaccff;
    const ringColor = this.isConsecrated ? 0xffd700 : 0x4488ff;
    const detailColor = this.isConsecrated ? 0xffec8b : 0x88aaff;

    // Outer glow
    this.auraGraphics.fillStyle(outerColor, this.isConsecrated ? 0.15 : 0.1);
    this.auraGraphics.fillCircle(0, 0, radius);

    // Inner ring
    this.auraGraphics.fillStyle(midColor, this.isConsecrated ? 0.2 : 0.15);
    this.auraGraphics.fillCircle(0, 0, radius * 0.7);

    // Core
    this.auraGraphics.fillStyle(coreColor, this.isConsecrated ? 0.15 : 0.1);
    this.auraGraphics.fillCircle(0, 0, radius * 0.4);

    // Pulsing ring outline
    const pulseAlpha = 0.4 + Math.sin(this.pulsePhase * 2) * 0.2;
    this.auraGraphics.lineStyle(this.isConsecrated ? 3 : 2, ringColor, pulseAlpha);
    this.auraGraphics.strokeCircle(0, 0, radius);

    // Inner detail rings
    this.auraGraphics.lineStyle(1, detailColor, this.isConsecrated ? 0.3 : 0.2);
    this.auraGraphics.strokeCircle(0, 0, radius * 0.5);

    // Extra consecrated visual: radiant cross pattern
    if (this.isConsecrated) {
      const crossLength = radius * 0.6;
      const crossAlpha = 0.2 + Math.sin(this.pulsePhase * 3) * 0.1;
      this.auraGraphics.lineStyle(2, 0xffffff, crossAlpha);
      this.auraGraphics.beginPath();
      this.auraGraphics.moveTo(-crossLength, 0);
      this.auraGraphics.lineTo(crossLength, 0);
      this.auraGraphics.moveTo(0, -crossLength);
      this.auraGraphics.lineTo(0, crossLength);
      this.auraGraphics.strokePath();
    }
  }

  protected recalculateStats(): void {
    super.recalculateStats();
    // Aura grows with level
    this.stats.range = this.baseStats.range + (this.level - 1) * 15;
    // Faster tick rate
    this.stats.cooldown = this.baseStats.cooldown * Math.pow(0.85, this.level - 1);
    // More damage
    this.stats.damage = this.baseStats.damage * (1 + (this.level - 1) * 0.25);
  }

  public destroy(): void {
    if (this.auraGraphics) {
      this.auraGraphics.destroy();
      this.auraGraphics = null;
    }
    this.hitCooldowns.clear();
    super.destroy();
  }
}
