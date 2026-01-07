import { BaseWeapon, WeaponContext, WeaponStats } from './BaseWeapon';
import { Transform } from '../ecs/components';

interface GroundSpike {
  graphics: Phaser.GameObjects.Graphics;
  x: number;
  y: number;
  lifetime: number;
  phase: 'warning' | 'active' | 'fading';
  hitEnemies: Set<number>;
  damage: number;
  isAftershock?: boolean;        // Mastery: Seismic Cascade - aftershock spikes
  triggeredAftershock?: boolean; // Mastery: Track if this spike triggered its aftershock
}

/**
 * GroundSpikeWeapon erupts spikes from the ground at enemy positions.
 * Has a brief warning phase before damage, rewarding observant players.
 */
export class GroundSpikeWeapon extends BaseWeapon {
  private spikes: GroundSpike[] = [];

  constructor() {
    const baseStats: WeaponStats = {
      damage: 25,
      cooldown: 1.8,
      range: 400,
      count: 3,          // Spikes per attack
      piercing: 999,
      size: 1,
      speed: 1,
      duration: 0.8,     // Total spike duration
    };

    super(
      'ground_spike',
      'Ground Spikes',
      'spikes',
      'Spikes erupt beneath enemies',
      10,
      baseStats,
      'Seismic Cascade',
      'Hitting 2+ enemies triggers aftershock spikes at 60% damage'
    );
  }

  protected attack(ctx: WeaponContext): void {
    const enemies = ctx.getEnemies();
    if (enemies.length === 0) return;

    // Target random enemies within range
    const validTargets: number[] = [];
    for (const enemyId of enemies) {
      const ex = Transform.x[enemyId];
      const ey = Transform.y[enemyId];
      const dx = ex - ctx.playerX;
      const dy = ey - ctx.playerY;
      const dist = Math.sqrt(dx * dx + dy * dy);

      if (dist <= this.stats.range) {
        validTargets.push(enemyId);
      }
    }

    if (validTargets.length === 0) return;

    // Spawn spikes at random target positions
    const shuffled = [...validTargets].sort(() => Math.random() - 0.5);
    const targetCount = Math.min(this.stats.count, shuffled.length);

    for (let i = 0; i < targetCount; i++) {
      const targetId = shuffled[i];
      const x = Transform.x[targetId];
      const y = Transform.y[targetId];

      // Add slight offset for visual variety
      const offsetX = (Math.random() - 0.5) * 30;
      const offsetY = (Math.random() - 0.5) * 30;

      this.createSpike(ctx, x + offsetX, y + offsetY);
    }
  }

  private createSpike(
    ctx: WeaponContext,
    x: number,
    y: number,
    isAftershock: boolean = false,
    aftershockDamage?: number
  ): void {
    const graphics = ctx.scene.add.graphics();
    graphics.setDepth(2);

    this.spikes.push({
      graphics,
      x,
      y,
      lifetime: isAftershock ? this.stats.duration * 0.7 : this.stats.duration, // Faster for aftershocks
      phase: 'warning',
      hitEnemies: new Set(),
      damage: aftershockDamage ?? this.stats.damage,
      isAftershock,
      triggeredAftershock: false,
    });
  }

  protected updateEffects(ctx: WeaponContext): void {
    const toRemove: GroundSpike[] = [];
    const warningDuration = 0.3;
    const activeDuration = 0.3;

    for (const spike of this.spikes) {
      spike.lifetime -= ctx.deltaTime;

      if (spike.lifetime <= 0) {
        toRemove.push(spike);
        continue;
      }

      const elapsed = this.stats.duration - spike.lifetime;
      const spikeRadius = 25 * this.stats.size;

      // Update phase
      if (elapsed < warningDuration) {
        spike.phase = 'warning';
      } else if (elapsed < warningDuration + activeDuration) {
        spike.phase = 'active';
      } else {
        spike.phase = 'fading';
      }

      // Draw based on phase
      spike.graphics.clear();
      spike.graphics.setPosition(spike.x, spike.y);

      // Aftershock spikes are smaller
      const sizeMultiplier = spike.isAftershock ? 0.7 : 1;
      const adjustedRadius = spikeRadius * sizeMultiplier;

      // Aftershock spikes use orange/gold colors
      const warningColor = spike.isAftershock ? 0xffaa44 : 0x4488ff;
      const warningStroke = spike.isAftershock ? 0xcc8833 : 0x2266dd;
      const spikeColor = spike.isAftershock ? 0xffaa44 : 0x4488ff;
      const spikeCenterColor = spike.isAftershock ? 0xffcc66 : 0x66aaff;

      if (spike.phase === 'warning') {
        // Warning circle grows
        const adjustedWarningDuration = spike.isAftershock ? warningDuration * 0.6 : warningDuration;
        const warningProgress = Math.min(1, elapsed / adjustedWarningDuration);
        const radius = adjustedRadius * warningProgress;

        spike.graphics.fillStyle(warningColor, 0.3);
        spike.graphics.fillCircle(0, 0, radius);
        spike.graphics.lineStyle(2, warningStroke, 0.5);
        spike.graphics.strokeCircle(0, 0, radius);

      } else if (spike.phase === 'active') {
        // Spikes erupt!
        const activeProgress = (elapsed - warningDuration) / activeDuration;
        const spikeHeight = 40 * this.stats.size * sizeMultiplier * (1 - activeProgress * 0.3);

        // Draw multiple spike shapes
        const spikeCount = spike.isAftershock ? 4 : 5;
        for (let i = 0; i < spikeCount; i++) {
          const angle = (i / spikeCount) * Math.PI * 2;
          const distance = adjustedRadius * 0.6;

          const baseX = Math.cos(angle) * distance;
          const baseY = Math.sin(angle) * distance;

          const spikeWidth = spike.isAftershock ? 4 : 6;
          spike.graphics.fillStyle(spikeColor, 1);
          spike.graphics.beginPath();
          spike.graphics.moveTo(baseX - spikeWidth, baseY);
          spike.graphics.lineTo(baseX, baseY - spikeHeight);
          spike.graphics.lineTo(baseX + spikeWidth, baseY);
          spike.graphics.closePath();
          spike.graphics.fillPath();

          spike.graphics.lineStyle(2, 0xffffff, 1); // White outline
          spike.graphics.strokePath();
        }

        // Central spike
        const centerWidth = spike.isAftershock ? 6 : 8;
        spike.graphics.fillStyle(spikeCenterColor, 1);
        spike.graphics.beginPath();
        spike.graphics.moveTo(-centerWidth, 0);
        spike.graphics.lineTo(0, -spikeHeight * 1.3);
        spike.graphics.lineTo(centerWidth, 0);
        spike.graphics.closePath();
        spike.graphics.fillPath();

        // Hit enemies in range
        const enemies = ctx.getEnemies();
        for (const enemyId of enemies) {
          if (spike.hitEnemies.has(enemyId)) continue;

          const ex = Transform.x[enemyId];
          const ey = Transform.y[enemyId];
          const dx = ex - spike.x;
          const dy = ey - spike.y;
          const dist = Math.sqrt(dx * dx + dy * dy);

          if (dist < adjustedRadius + 12) {
            ctx.damageEnemy(enemyId, spike.damage, spike.isAftershock ? 80 : 120);
            spike.hitEnemies.add(enemyId);
          }
        }

        // Mastery: Seismic Cascade - trigger aftershock when 2+ enemies hit
        if (this.isMastered() && !spike.isAftershock && !spike.triggeredAftershock) {
          if (spike.hitEnemies.size >= 2) {
            spike.triggeredAftershock = true;
            this.triggerAftershock(ctx, spike.x, spike.y);
          }
        }

      } else {
        // Fading - spikes retract
        const fadeProgress = (elapsed - warningDuration - activeDuration) /
          (this.stats.duration - warningDuration - activeDuration);
        const spikeHeight = 40 * this.stats.size * sizeMultiplier * (1 - fadeProgress);

        const spikeCountFade = spike.isAftershock ? 4 : 5;
        for (let i = 0; i < spikeCountFade; i++) {
          const angle = (i / spikeCountFade) * Math.PI * 2;
          const distance = adjustedRadius * 0.6;

          const baseX = Math.cos(angle) * distance;
          const baseY = Math.sin(angle) * distance;

          const spikeWidth = spike.isAftershock ? 4 : 6;
          spike.graphics.fillStyle(spikeColor, 1 - fadeProgress);
          spike.graphics.beginPath();
          spike.graphics.moveTo(baseX - spikeWidth, baseY);
          spike.graphics.lineTo(baseX, baseY - spikeHeight);
          spike.graphics.lineTo(baseX + spikeWidth, baseY);
          spike.graphics.closePath();
          spike.graphics.fillPath();
        }
      }
    }

    // Clean up
    for (const spike of toRemove) {
      const index = this.spikes.indexOf(spike);
      if (index !== -1) this.spikes.splice(index, 1);
      spike.graphics.destroy();
    }
  }

  /**
   * Mastery: Seismic Cascade - spawn 2-3 smaller aftershock spikes around the original.
   * Aftershocks deal 60% damage and are smaller/faster.
   */
  private triggerAftershock(ctx: WeaponContext, originX: number, originY: number): void {
    const aftershockCount = 2 + Math.floor(Math.random() * 2); // 2-3 spikes
    const aftershockDamage = this.stats.damage * 0.6; // 60% damage
    const spreadRadius = 50 + Math.random() * 30; // Random spread

    for (let i = 0; i < aftershockCount; i++) {
      const angle = (i / aftershockCount) * Math.PI * 2 + Math.random() * 0.5;
      const distance = spreadRadius * (0.7 + Math.random() * 0.3);

      const spawnX = originX + Math.cos(angle) * distance;
      const spawnY = originY + Math.sin(angle) * distance;

      // Slight delay before spawning aftershock
      ctx.scene.time.delayedCall(100 + i * 80, () => {
        this.createSpike(ctx, spawnX, spawnY, true, aftershockDamage);
      });
    }

    // Visual effect for aftershock trigger
    const shockwave = ctx.scene.add.circle(originX, originY, 10, 0xffaa44, 0.5);
    shockwave.setDepth(3);
    ctx.scene.tweens.add({
      targets: shockwave,
      scaleX: 5,
      scaleY: 5,
      alpha: 0,
      duration: 300,
      onComplete: () => shockwave.destroy(),
    });
  }

  protected recalculateStats(): void {
    super.recalculateStats();
    this.stats.count = this.baseStats.count + Math.floor((this.level - 1) / 2) + this.externalBonusCount;
    this.stats.size = 1 + (this.level - 1) * 0.15;
    this.stats.cooldown = Math.max(0.8, this.baseStats.cooldown - (this.level - 1) * 0.1);
  }

  public destroy(): void {
    for (const spike of this.spikes) {
      spike.graphics.destroy();
    }
    this.spikes = [];
    super.destroy();
  }
}
