import { BaseWeapon, WeaponContext, WeaponStats } from './BaseWeapon';
import { Transform } from '../ecs/components';
import { getJuiceManager } from '../effects/JuiceManager';
import { WEAPON_COLORS } from '../visual/NeonColors';
import { DepthLayers } from '../visual/DepthLayers';
import { VisualQuality } from '../visual/GlowGraphics';

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
  debrisSpawned?: boolean;       // Track if eruption debris has been spawned
  spikeSeeds?: number[];         // Random seeds for consistent jagged spike shapes
}

/**
 * GroundSpikeWeapon erupts spikes from the ground at enemy positions.
 * Has a brief warning phase before damage, rewarding observant players.
 */
export class GroundSpikeWeapon extends BaseWeapon {
  private spikes: GroundSpike[] = [];
  private currentQuality: VisualQuality = 'high';

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
    this.windUpFraction = 0.2;
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
      const distSq = dx * dx + dy * dy;

      if (distSq <= this.stats.range * this.stats.range) {
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
    graphics.setDepth(DepthLayers.GROUND_SPIKE_WARNING);

    // Generate random seeds for consistent jagged spike shapes
    const spikeCount = isAftershock ? 4 : 5;
    const spikeSeeds: number[] = [];
    for (let seedIndex = 0; seedIndex < spikeCount + 1; seedIndex++) {
      spikeSeeds.push(Math.random());
    }

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
      spikeSeeds,
    });
  }

  protected updateEffects(ctx: WeaponContext): void {
    this.currentQuality = ctx.visualQuality;

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
      const warningColor = spike.isAftershock ? 0xffaa44 : WEAPON_COLORS.spike.core;
      const warningStroke = spike.isAftershock ? 0xcc8833 : WEAPON_COLORS.spike.glow;
      const spikeColor = spike.isAftershock ? 0xffaa44 : WEAPON_COLORS.spike.core;
      const spikeCenterColor = spike.isAftershock ? 0xffcc66 : WEAPON_COLORS.spikeCenter.core;

      if (spike.phase === 'warning') {
        // Warning circle grows
        const adjustedWarningDuration = spike.isAftershock ? warningDuration * 0.6 : warningDuration;
        const warningProgress = Math.min(1, elapsed / adjustedWarningDuration);
        const radius = adjustedRadius * warningProgress;

        // High quality: heat glow underpass behind cracks
        if (this.currentQuality === 'high') {
          spike.graphics.fillStyle(warningColor, 0.15);
          spike.graphics.fillCircle(0, 0, warningProgress * adjustedRadius * 0.5);
        }

        spike.graphics.fillStyle(warningColor, 0.3);
        spike.graphics.fillCircle(0, 0, radius);
        spike.graphics.lineStyle(2, warningStroke, 0.5);
        spike.graphics.strokeCircle(0, 0, radius);

        // Warning ground cracks — quality-dependent count and detail
        const crackCount = this.currentQuality === 'high' ? 8 : this.currentQuality === 'medium' ? 6 : 5;
        const segmentCount = this.currentQuality === 'high' ? 5 : this.currentQuality === 'medium' ? 4 : 3;
        const jitterAmount = this.currentQuality === 'medium' ? 7 : 6;

        spike.graphics.lineStyle(1, warningStroke, 0.4 + warningProgress * 0.4);
        for (let crackIndex = 0; crackIndex < crackCount; crackIndex++) {
          const crackAngle = (crackIndex / crackCount) * Math.PI * 2;
          const crackLength = adjustedRadius * warningProgress;
          const segmentLength = crackLength / segmentCount;

          spike.graphics.beginPath();
          spike.graphics.moveTo(0, 0);

          let crackCurrentX = 0;
          let crackCurrentY = 0;
          for (let segmentIndex = 0; segmentIndex < segmentCount; segmentIndex++) {
            const perpOffset = (Math.random() - 0.5) * jitterAmount;
            crackCurrentX += Math.cos(crackAngle) * segmentLength + Math.cos(crackAngle + Math.PI * 0.5) * perpOffset;
            crackCurrentY += Math.sin(crackAngle) * segmentLength + Math.sin(crackAngle + Math.PI * 0.5) * perpOffset;
            spike.graphics.lineTo(crackCurrentX, crackCurrentY);

            // High quality: 50% branching at segment 3
            if (this.currentQuality === 'high' && segmentIndex === 2 && Math.random() < 0.5) {
              const branchAngle = crackAngle + (Math.random() - 0.5) * 1.2;
              const branchLength = segmentLength * 0.6;
              const branchEndX = crackCurrentX + Math.cos(branchAngle) * branchLength;
              const branchEndY = crackCurrentY + Math.sin(branchAngle) * branchLength;
              spike.graphics.lineTo(branchEndX, branchEndY);
              // Move back to continue main crack
              spike.graphics.moveTo(crackCurrentX, crackCurrentY);
            }
          }
          spike.graphics.strokePath();
        }

        // High quality: jittering pebble dots
        if (this.currentQuality === 'high') {
          spike.graphics.fillStyle(warningColor, 0.6);
          for (let pebbleIndex = 0; pebbleIndex < 4; pebbleIndex++) {
            const pebbleAngle = (pebbleIndex / 4) * Math.PI * 2 + 0.7;
            const pebbleDistance = adjustedRadius * warningProgress * 0.6;
            const pebbleX = Math.cos(pebbleAngle) * pebbleDistance + (Math.random() * 2 - 1);
            const pebbleY = Math.sin(pebbleAngle) * pebbleDistance + (Math.random() * 2 - 1);
            spike.graphics.fillCircle(pebbleX, pebbleY, 1.5);
          }
        }

      } else if (spike.phase === 'active') {
        // Eruption debris and screen shake on first active frame
        if (!spike.debrisSpawned) {
          spike.debrisSpawned = true;
          getJuiceManager().screenShake(0.002, 60);

          // Eruption pop: scale overshoot at medium/high
          if (this.currentQuality !== 'low') {
            spike.graphics.setScale(1.15);
            ctx.scene.tweens.add({
              targets: spike.graphics,
              scaleX: 1.0,
              scaleY: 1.0,
              duration: 80,
            });
          }

          if (this.currentQuality === 'high') {
            // High: 6 irregular rock chunks + 4 dust puffs
            for (let chunkIndex = 0; chunkIndex < 6; chunkIndex++) {
              const chunkOffsetX = (Math.random() - 0.5) * adjustedRadius;
              const chunkGraphics = ctx.scene.add.graphics();
              chunkGraphics.setPosition(spike.x + chunkOffsetX, spike.y);
              chunkGraphics.setDepth(DepthLayers.GROUND_SPIKE_DEBRIS);
              chunkGraphics.fillStyle(spikeColor, 0.9);
              chunkGraphics.beginPath();
              const chunkSize = 3 + Math.random() * 3;
              chunkGraphics.moveTo(-chunkSize, -chunkSize * 0.5);
              chunkGraphics.lineTo(chunkSize * 0.7, -chunkSize);
              chunkGraphics.lineTo(chunkSize, chunkSize * 0.3);
              chunkGraphics.lineTo(-chunkSize * 0.5, chunkSize * 0.8);
              chunkGraphics.closePath();
              chunkGraphics.fillPath();
              ctx.scene.tweens.add({
                targets: chunkGraphics,
                y: spike.y - 25 - Math.random() * 25,
                x: spike.x + chunkOffsetX + (Math.random() - 0.5) * 50,
                alpha: 0,
                angle: Math.random() * 360,
                duration: 350,
                onComplete: () => chunkGraphics.destroy(),
              });
            }

            // 4 expanding dust puff circles
            for (let dustIndex = 0; dustIndex < 4; dustIndex++) {
              const dustOffsetX = (Math.random() - 0.5) * adjustedRadius;
              const dustPuff = ctx.scene.add.circle(spike.x + dustOffsetX, spike.y, 3, spikeColor, 0.4);
              dustPuff.setDepth(DepthLayers.GROUND_SPIKE_DEBRIS);
              ctx.scene.tweens.add({
                targets: dustPuff,
                scaleX: 3,
                scaleY: 3,
                alpha: 0,
                duration: 300,
                onComplete: () => dustPuff.destroy(),
              });
            }
          } else {
            // Low/Medium: 4 small debris circles flying upward
            for (let debrisIndex = 0; debrisIndex < 4; debrisIndex++) {
              const debrisOffsetX = (Math.random() - 0.5) * adjustedRadius;
              const debrisCircle = ctx.scene.add.circle(spike.x + debrisOffsetX, spike.y, 2, spikeColor, 0.8);
              debrisCircle.setDepth(DepthLayers.GROUND_SPIKE_DEBRIS);

              // Medium: slightly wider horizontal spread
              const horizontalSpread = this.currentQuality === 'medium' ? 50 : 40;
              ctx.scene.tweens.add({
                targets: debrisCircle,
                y: spike.y - 30 - Math.random() * 20,
                x: spike.x + debrisOffsetX + (Math.random() - 0.5) * horizontalSpread,
                alpha: 0,
                duration: 300,
                onComplete: () => debrisCircle.destroy(),
              });
            }
          }
        }

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

          spike.graphics.fillStyle(spikeColor, 1);
          spike.graphics.beginPath();

          if (this.currentQuality === 'low') {
            // Low: simple triangles
            const spikeWidth = spike.isAftershock ? 4 : 6;
            spike.graphics.moveTo(baseX - spikeWidth, baseY);
            spike.graphics.lineTo(baseX, baseY - spikeHeight);
            spike.graphics.lineTo(baseX + spikeWidth, baseY);
          } else {
            // Medium/High: 6-vertex jagged asymmetric polygon
            const seed = spike.spikeSeeds?.[i] ?? 0.5;
            const asymmetry = (seed - 0.5) * 0.4;
            const spikeWidth = (spike.isAftershock ? 4 : 6) * (1 + asymmetry);

            spike.graphics.moveTo(baseX - spikeWidth, baseY);
            spike.graphics.lineTo(baseX - spikeWidth * 0.6, baseY - spikeHeight * 0.4);
            spike.graphics.lineTo(baseX + asymmetry * 3, baseY - spikeHeight);
            spike.graphics.lineTo(baseX + spikeWidth * 0.7, baseY - spikeHeight * 0.5);
            spike.graphics.lineTo(baseX + spikeWidth, baseY - spikeHeight * 0.15);
            spike.graphics.lineTo(baseX + spikeWidth * 0.8, baseY);
          }

          spike.graphics.closePath();
          spike.graphics.fillPath();

          spike.graphics.lineStyle(2, 0xffffff, 1); // White outline
          spike.graphics.strokePath();
        }

        // Central spike
        const centerWidth = spike.isAftershock ? 6 : 8;
        spike.graphics.fillStyle(spikeCenterColor, 1);
        spike.graphics.beginPath();

        if (this.currentQuality === 'low') {
          // Low: simple triangle for center
          spike.graphics.moveTo(-centerWidth, 0);
          spike.graphics.lineTo(0, -spikeHeight * 1.3);
          spike.graphics.lineTo(centerWidth, 0);
        } else {
          // Medium/High: jagged center spike
          const centerSeed = spike.spikeSeeds?.[spikeCount] ?? 0.5;
          const centerAsymmetry = (centerSeed - 0.5) * 0.3;
          spike.graphics.moveTo(-centerWidth, 0);
          spike.graphics.lineTo(-centerWidth * 0.5, -spikeHeight * 0.5);
          spike.graphics.lineTo(centerAsymmetry * 4, -spikeHeight * 1.3);
          spike.graphics.lineTo(centerWidth * 0.6, -spikeHeight * 0.6);
          spike.graphics.lineTo(centerWidth, -spikeHeight * 0.1);
          spike.graphics.lineTo(centerWidth * 0.7, 0);
        }

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
          const distSq = dx * dx + dy * dy;
          const hitRange = adjustedRadius + 12;

          if (distSq < hitRange * hitRange) {
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

        // High quality: fade tremor during first 30% of fade
        if (this.currentQuality === 'high') {
          if (fadeProgress < 0.3) {
            spike.graphics.setPosition(
              spike.x + (Math.random() - 0.5) * 2,
              spike.y + (Math.random() - 0.5) * 2
            );
          } else {
            spike.graphics.setPosition(spike.x, spike.y);
          }
        }

        const spikeCountFade = spike.isAftershock ? 4 : 5;
        for (let i = 0; i < spikeCountFade; i++) {
          const angle = (i / spikeCountFade) * Math.PI * 2;
          const distance = adjustedRadius * 0.6;

          const baseX = Math.cos(angle) * distance;
          const baseY = Math.sin(angle) * distance;

          spike.graphics.fillStyle(spikeColor, 1 - fadeProgress);
          spike.graphics.beginPath();

          if (this.currentQuality === 'low') {
            // Low: simple triangles
            const spikeWidth = spike.isAftershock ? 4 : 6;
            spike.graphics.moveTo(baseX - spikeWidth, baseY);
            spike.graphics.lineTo(baseX, baseY - spikeHeight);
            spike.graphics.lineTo(baseX + spikeWidth, baseY);
          } else {
            // Medium/High: jagged polygon matching active phase shape
            const seed = spike.spikeSeeds?.[i] ?? 0.5;
            const asymmetry = (seed - 0.5) * 0.4;
            const spikeWidth = (spike.isAftershock ? 4 : 6) * (1 + asymmetry);

            spike.graphics.moveTo(baseX - spikeWidth, baseY);
            spike.graphics.lineTo(baseX - spikeWidth * 0.6, baseY - spikeHeight * 0.4);
            spike.graphics.lineTo(baseX + asymmetry * 3, baseY - spikeHeight);
            spike.graphics.lineTo(baseX + spikeWidth * 0.7, baseY - spikeHeight * 0.5);
            spike.graphics.lineTo(baseX + spikeWidth, baseY - spikeHeight * 0.15);
            spike.graphics.lineTo(baseX + spikeWidth * 0.8, baseY);
          }

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
    if (this.currentQuality === 'high') {
      // High: double shockwave with radial connecting lines
      const outerRing = ctx.scene.add.graphics();
      outerRing.setPosition(originX, originY);
      outerRing.setDepth(DepthLayers.ORBIT_RING);
      outerRing.lineStyle(2, 0xffaa44, 0.6);
      outerRing.strokeCircle(0, 0, 10);

      const innerRing = ctx.scene.add.graphics();
      innerRing.setPosition(originX, originY);
      innerRing.setDepth(DepthLayers.ORBIT_RING);
      innerRing.lineStyle(2, 0xffcc66, 0.5);
      innerRing.strokeCircle(0, 0, 8);

      // Outer ring expands
      ctx.scene.tweens.add({
        targets: outerRing,
        scaleX: 5,
        scaleY: 5,
        alpha: 0,
        duration: 300,
        onComplete: () => outerRing.destroy(),
      });

      // Inner ring expands with slight delay
      ctx.scene.tweens.add({
        targets: innerRing,
        scaleX: 3.5,
        scaleY: 3.5,
        alpha: 0,
        duration: 300,
        delay: 40,
        onComplete: () => innerRing.destroy(),
      });

      // 8 radial connecting lines between rings
      const radialLines = ctx.scene.add.graphics();
      radialLines.setPosition(originX, originY);
      radialLines.setDepth(DepthLayers.ORBIT_RING);
      radialLines.lineStyle(1, 0xffaa44, 0.4);
      for (let lineIndex = 0; lineIndex < 8; lineIndex++) {
        const lineAngle = (lineIndex / 8) * Math.PI * 2;
        const innerRadius = 8;
        const outerRadius = 10;
        radialLines.beginPath();
        radialLines.moveTo(Math.cos(lineAngle) * innerRadius, Math.sin(lineAngle) * innerRadius);
        radialLines.lineTo(Math.cos(lineAngle) * outerRadius, Math.sin(lineAngle) * outerRadius);
        radialLines.strokePath();
      }
      ctx.scene.tweens.add({
        targets: radialLines,
        scaleX: 5,
        scaleY: 5,
        alpha: 0,
        duration: 300,
        onComplete: () => radialLines.destroy(),
      });
    } else {
      // Low/Medium: single expanding circle
      const shockwave = ctx.scene.add.circle(originX, originY, 10, 0xffaa44, 0.5);
      shockwave.setDepth(DepthLayers.ORBIT_RING);
      ctx.scene.tweens.add({
        targets: shockwave,
        scaleX: 5,
        scaleY: 5,
        alpha: 0,
        duration: 300,
        onComplete: () => shockwave.destroy(),
      });
    }
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
