import { BaseWeapon, WeaponContext, WeaponStats } from './BaseWeapon';
import { Transform } from '../ecs/components';
import { getEnemySpatialHash } from '../utils/SpatialHash';
import { DepthLayers } from '../visual/DepthLayers';
import { VisualQuality } from '../visual/GlowGraphics';
import { findNearestEnemy } from './WeaponUtils';
import { PROJECTILE_ATLAS_KEY, getShurikenFrame } from '../visual/ProjectileAtlasRenderer';

const POOL_SIZE = 30;

interface Shuriken {
  sprite: Phaser.GameObjects.Image | null;
  x: number;
  y: number;
  baseAngle: number;
  spiralPhase: number;
  lifetime: number;
  damage: number;
  hitEnemies: Map<number, number>;
  hitCooldown: Map<number, number>;
  isCyclone: boolean;
  pullRadius: number;
  active: boolean;
}

/**
 * ShurikenWeapon fires spinning projectiles that travel in spiral patterns.
 *
 * PERF: Shuriken bodies are atlas Images rotated via setRotation (free).
 * Cyclone effects and afterimages on shared effectsGraphics.
 */
export class ShurikenWeapon extends BaseWeapon {
  private pool: Shuriken[] = [];
  private effectsGraphics: Phaser.GameObjects.Graphics | null = null;
  private spinSpeed: number = 15;
  private spiralAmplitude: number = 30;
  private spiralFrequency: number = 8;
  private currentQuality: VisualQuality = 'high';
  private poolInitialized: boolean = false;

  constructor() {
    const baseStats: WeaponStats = {
      damage: 12,
      cooldown: 1.0,
      range: 300,
      count: 2,
      piercing: 2,
      size: 1,
      speed: 200,
      duration: 3,
    };

    super(
      'shuriken',
      'Spiral Shuriken',
      'shuriken',
      'Spinning spiral projectiles',
      10,
      baseStats,
      'Cyclone Convergence',
      'Two nearby shurikens merge into a Cyclone (250% damage, pulls enemies)'
    );
  }

  private initPool(scene: Phaser.Scene): void {
    if (this.poolInitialized) return;
    this.poolInitialized = true;

    this.effectsGraphics = scene.add.graphics();
    this.effectsGraphics.setDepth(DepthLayers.PROJECTILES - 1);

    for (let i = 0; i < POOL_SIZE; i++) {
      const sprite = scene.add.image(0, 0, PROJECTILE_ATLAS_KEY, getShurikenFrame(false, 'high'));
      sprite.setDepth(DepthLayers.PROJECTILES);
      sprite.setVisible(false);
      sprite.setActive(false);

      this.pool.push({
        sprite,
        x: 0, y: 0, baseAngle: 0, spiralPhase: 0,
        lifetime: 0, damage: 0,
        hitEnemies: new Map(), hitCooldown: new Map(),
        isCyclone: false, pullRadius: 0,
        active: false,
      });
    }
  }

  private acquireShuriken(ctx: WeaponContext): Shuriken | null {
    this.initPool(ctx.scene);
    for (const shuriken of this.pool) {
      if (!shuriken.active) return shuriken;
    }
    for (const shuriken of this.pool) {
      if (shuriken.active) {
        this.deactivateShuriken(shuriken);
        return shuriken;
      }
    }
    return null;
  }

  private deactivateShuriken(shuriken: Shuriken): void {
    shuriken.active = false;
    if (shuriken.sprite) {
      shuriken.sprite.setVisible(false);
      shuriken.sprite.setActive(false);
    }
  }

  protected attack(ctx: WeaponContext): void {
    const enemies = ctx.getEnemies();
    if (enemies.length === 0) return;

    const nearestId = findNearestEnemy(ctx, ctx.playerX, ctx.playerY, this.stats.range);
    const baseAngle = nearestId !== -1 ?
      Math.atan2(Transform.y[nearestId] - ctx.playerY, Transform.x[nearestId] - ctx.playerX) :
      Math.random() * Math.PI * 2;

    for (let i = 0; i < this.stats.count; i++) {
      let angle = baseAngle;
      if (this.stats.count > 1) {
        const spread = Math.PI / 3;
        angle = baseAngle - spread / 2 + (spread / (this.stats.count - 1)) * i;
      }

      this.createShuriken(ctx, angle, false, this.stats.damage, this.stats.duration, 0);
    }

    ctx.soundManager.playHit();
  }

  private createShuriken(
    ctx: WeaponContext, angle: number, isCyclone: boolean,
    damage: number, lifetime: number, pullRadius: number,
  ): void {
    const shuriken = this.acquireShuriken(ctx);
    if (!shuriken) return;

    shuriken.x = ctx.playerX;
    shuriken.y = ctx.playerY;
    shuriken.baseAngle = angle;
    shuriken.spiralPhase = 0;
    shuriken.lifetime = lifetime;
    shuriken.damage = damage;
    shuriken.hitEnemies.clear();
    shuriken.hitCooldown.clear();
    shuriken.isCyclone = isCyclone;
    shuriken.pullRadius = pullRadius;
    shuriken.active = true;

    if (shuriken.sprite) {
      shuriken.sprite.setFrame(getShurikenFrame(isCyclone, ctx.visualQuality));
      shuriken.sprite.setPosition(ctx.playerX, ctx.playerY);
      shuriken.sprite.setVisible(true);
      shuriken.sprite.setActive(true);
      shuriken.sprite.setScale(1);
    }
  }

  protected updateEffects(ctx: WeaponContext): void {
    this.initPool(ctx.scene);
    this.currentQuality = ctx.visualQuality;

    // Mastery merge check
    if (this.isMastered()) {
      this.checkForMerge(ctx);
    }

    const spatialHash = getEnemySpatialHash();

    // Clear shared effects graphics once per frame
    if (this.effectsGraphics) {
      this.effectsGraphics.clear();
    }

    for (const shuriken of this.pool) {
      if (!shuriken.active) continue;

      shuriken.lifetime -= ctx.deltaTime;
      if (shuriken.lifetime <= 0) {
        this.deactivateShuriken(shuriken);
        continue;
      }

      // Update spiral phase
      shuriken.spiralPhase += this.spiralFrequency * ctx.deltaTime;

      // Calculate movement
      const perpAngle = shuriken.baseAngle + Math.PI / 2;
      const baseVelX = Math.cos(shuriken.baseAngle) * this.stats.speed;
      const baseVelY = Math.sin(shuriken.baseAngle) * this.stats.speed;
      const spiralVelX = Math.cos(perpAngle) * Math.cos(shuriken.spiralPhase) * this.spiralAmplitude * 3;
      const spiralVelY = Math.sin(perpAngle) * Math.cos(shuriken.spiralPhase) * this.spiralAmplitude * 3;

      const speedMultiplier = shuriken.isCyclone ? 0.5 : 1;
      shuriken.x += (baseVelX + spiralVelX) * ctx.deltaTime * speedMultiplier;
      shuriken.y += (baseVelY + spiralVelY) * ctx.deltaTime * speedMultiplier;

      // Cyclone pull
      if (shuriken.isCyclone && shuriken.pullRadius > 0) {
        this.applyCyclonePull(ctx, shuriken, spatialHash);
      }

      // Update sprite position + spin rotation
      const baseSize = 12 * this.stats.size;
      const size = shuriken.isCyclone ? baseSize * 2 : baseSize;
      const currentSpinSpeed = shuriken.isCyclone ? this.spinSpeed * 2 : this.spinSpeed;
      const spinAngle = ctx.gameTime * currentSpinSpeed;

      if (shuriken.sprite) {
        shuriken.sprite.setPosition(shuriken.x, shuriken.y);
        shuriken.sprite.setRotation(spinAngle);
        // Scale cyclone sprites up
        const scaleFactor = shuriken.isCyclone ? 2 : 1;
        shuriken.sprite.setScale(scaleFactor);
      }

      // Draw cyclone effects on shared graphics
      if (shuriken.isCyclone && this.effectsGraphics) {
        if (this.currentQuality === 'high') {
          // Spiral arm lines
          const spiralArmAlpha = 0.3 + Math.sin(ctx.gameTime * 8) * 0.1;
          this.effectsGraphics.lineStyle(2, 0xffdd44, spiralArmAlpha);
          for (let arm = 0; arm < 3; arm++) {
            const armBaseAngle = ctx.gameTime * -currentSpinSpeed * 0.3 + (arm * Math.PI * 2 / 3);
            this.effectsGraphics.beginPath();
            for (let step = 0; step <= 12; step++) {
              const normalizedStep = step / 12;
              const spiralRadius = size * (0.5 + normalizedStep * 0.9);
              const spiralAngleStep = armBaseAngle + normalizedStep * Math.PI * 1.5;
              const spiralX = shuriken.x + Math.cos(spiralAngleStep) * spiralRadius;
              const spiralY = shuriken.y + Math.sin(spiralAngleStep) * spiralRadius;
              if (step === 0) {
                this.effectsGraphics.moveTo(spiralX, spiralY);
              } else {
                this.effectsGraphics.lineTo(spiralX, spiralY);
              }
            }
            this.effectsGraphics.strokePath();
          }
        } else {
          // Low/Medium: double stroked circles
          const windRing = 0.3 + Math.sin(ctx.gameTime * 8) * 0.1;
          this.effectsGraphics.lineStyle(3, 0xffdd44, windRing);
          this.effectsGraphics.strokeCircle(shuriken.x, shuriken.y, size * 1.3);
          this.effectsGraphics.lineStyle(2, 0xffaa22, windRing * 0.6);
          this.effectsGraphics.strokeCircle(shuriken.x, shuriken.y, size * 1.5);
        }

        // Orbiting particle dots
        const particleDotCount = 5;
        const particleOrbitAngle = ctx.gameTime * -currentSpinSpeed * 0.7;
        const particleOrbitRadius = size * 1.1;
        this.effectsGraphics.fillStyle(0xffdd44, 0.6);
        for (let dotIndex = 0; dotIndex < particleDotCount; dotIndex++) {
          const dotAngle = particleOrbitAngle + (dotIndex * Math.PI * 2 / particleDotCount);
          this.effectsGraphics.fillCircle(
            shuriken.x + Math.cos(dotAngle) * particleOrbitRadius,
            shuriken.y + Math.sin(dotAngle) * particleOrbitRadius,
            2
          );
        }
      }

      // Draw afterimage on shared graphics (non-cyclone, medium/high only)
      if (!shuriken.isCyclone && this.effectsGraphics) {
        const bladeColor = 0x4488ff;
        const bladeCount = 4;

        if (this.currentQuality === 'high') {
          const smearAngle = 0.5;
          this.effectsGraphics.fillStyle(bladeColor, 0.12);
          for (let i = 0; i < bladeCount; i++) {
            const bladeAngle = spinAngle + (i * Math.PI * 2 / bladeCount);
            const smearStartAngle = bladeAngle - smearAngle;
            const smearSteps = 8;
            this.effectsGraphics.beginPath();
            this.effectsGraphics.moveTo(shuriken.x, shuriken.y);
            for (let step = 0; step <= smearSteps; step++) {
              const interpolatedAngle = smearStartAngle + (smearAngle * step / smearSteps);
              this.effectsGraphics.lineTo(
                shuriken.x + Math.cos(interpolatedAngle) * size,
                shuriken.y + Math.sin(interpolatedAngle) * size
              );
            }
            this.effectsGraphics.closePath();
            this.effectsGraphics.fillPath();
          }
        } else if (this.currentQuality === 'medium') {
          const ghostSpin = spinAngle - 0.3;
          this.effectsGraphics.fillStyle(bladeColor, 0.15);
          for (let bladePair = 0; bladePair < 2; bladePair++) {
            const ghostPointAngle = ghostSpin + (bladePair * Math.PI);
            this.effectsGraphics.beginPath();
            this.effectsGraphics.moveTo(shuriken.x, shuriken.y);
            this.effectsGraphics.lineTo(
              shuriken.x + Math.cos(ghostPointAngle - 0.3) * size * 0.4,
              shuriken.y + Math.sin(ghostPointAngle - 0.3) * size * 0.4
            );
            this.effectsGraphics.lineTo(
              shuriken.x + Math.cos(ghostPointAngle) * size,
              shuriken.y + Math.sin(ghostPointAngle) * size
            );
            this.effectsGraphics.lineTo(
              shuriken.x + Math.cos(ghostPointAngle + 0.3) * size * 0.4,
              shuriken.y + Math.sin(ghostPointAngle + 0.3) * size * 0.4
            );
            this.effectsGraphics.closePath();
            this.effectsGraphics.fillPath();
          }
        }
      }

      // Check bounds
      if (shuriken.x < -50 || shuriken.x > ctx.scene.scale.width + 50 ||
          shuriken.y < -50 || shuriken.y > ctx.scene.scale.height + 50) {
        this.deactivateShuriken(shuriken);
        continue;
      }

      // Collision check
      const collisionRadius = size + 12;
      const collisionRadiusSq = collisionRadius * collisionRadius;
      const nearbyEnemies = spatialHash.queryPotential(shuriken.x, shuriken.y, collisionRadius + 5);

      for (const enemy of nearbyEnemies) {
        const enemyId = enemy.id;
        const lastHit = shuriken.hitCooldown.get(enemyId) || 0;
        if (ctx.gameTime - lastHit < 0.3) continue;

        const hitCount = shuriken.hitEnemies.get(enemyId) ?? 0;
        if (hitCount >= this.stats.piercing) continue;

        const ex = Transform.x[enemyId];
        const ey = Transform.y[enemyId];
        const dx = ex - shuriken.x;
        const dy = ey - shuriken.y;
        const distSq = dx * dx + dy * dy;

        if (distSq < collisionRadiusSq) {
          ctx.damageEnemy(enemyId, shuriken.damage, 100);
          shuriken.hitEnemies.set(enemyId, hitCount + 1);
          shuriken.hitCooldown.set(enemyId, ctx.gameTime);
          ctx.effectsManager.playHitSparks(shuriken.x, shuriken.y, shuriken.baseAngle);

          // On-hit spark lines (30% chance)
          if (Math.random() < 0.3) {
            const sparkGraphics = ctx.scene.add.graphics();
            sparkGraphics.setPosition(shuriken.x, shuriken.y);
            sparkGraphics.setDepth(12);
            sparkGraphics.lineStyle(1.5, 0xffffff, 0.8);

            if (this.currentQuality === 'high') {
              const slashLength = 20;
              for (let slashIdx = 0; slashIdx < 2; slashIdx++) {
                const slashAngle = spinAngle + (slashIdx * Math.PI / 2);
                sparkGraphics.lineBetween(
                  Math.cos(slashAngle) * -slashLength * 0.5,
                  Math.sin(slashAngle) * -slashLength * 0.5,
                  Math.cos(slashAngle) * slashLength * 0.5,
                  Math.sin(slashAngle) * slashLength * 0.5
                );
              }
            } else {
              const sparkLineCount = 2 + Math.floor(Math.random() * 2);
              const sparkLength = 20;
              for (let sparkIdx = 0; sparkIdx < sparkLineCount; sparkIdx++) {
                const sparkAngle = Math.random() * Math.PI * 2;
                sparkGraphics.lineBetween(0, 0, Math.cos(sparkAngle) * sparkLength, Math.sin(sparkAngle) * sparkLength);
              }
            }

            ctx.scene.tweens.add({
              targets: sparkGraphics,
              scaleX: 2, scaleY: 2, alpha: 0,
              duration: 150,
              onComplete: () => sparkGraphics.destroy(),
            });
          }
        }
      }
    }
  }

  private checkForMerge(ctx: WeaponContext): void {
    const mergeDistanceSq = 20 * 20;
    const toMerge: [Shuriken, Shuriken][] = [];
    const alreadyMerging = new Set<Shuriken>();

    const activeShurikens = this.pool.filter(s => s.active && !s.isCyclone);

    for (let i = 0; i < activeShurikens.length; i++) {
      const s1 = activeShurikens[i];
      if (alreadyMerging.has(s1)) continue;

      for (let j = i + 1; j < activeShurikens.length; j++) {
        const s2 = activeShurikens[j];
        if (alreadyMerging.has(s2)) continue;

        const dx = s1.x - s2.x;
        const dy = s1.y - s2.y;
        const distSq = dx * dx + dy * dy;
        if (distSq < mergeDistanceSq) {
          toMerge.push([s1, s2]);
          alreadyMerging.add(s1);
          alreadyMerging.add(s2);
          break;
        }
      }
    }

    for (const [s1, s2] of toMerge) {
      this.mergeToCyclone(ctx, s1, s2);
    }
  }

  private mergeToCyclone(ctx: WeaponContext, s1: Shuriken, s2: Shuriken): void {
    const mergeX = (s1.x + s2.x) / 2;
    const mergeY = (s1.y + s2.y) / 2;
    const avgAngle = (s1.baseAngle + s2.baseAngle) / 2;

    this.deactivateShuriken(s1);
    this.deactivateShuriken(s2);

    // Merge visual effect
    const mergeEffect = ctx.scene.add.circle(mergeX, mergeY, 10, 0xffffff, 0.8);
    mergeEffect.setDepth(12);
    ctx.scene.tweens.add({
      targets: mergeEffect,
      scaleX: 3, scaleY: 3, alpha: 0,
      duration: 200,
      onComplete: () => mergeEffect.destroy(),
    });

    // Create cyclone — need to set position manually since createShuriken uses ctx.playerX/Y
    const cyclone = this.acquireShuriken(ctx);
    if (!cyclone) return;

    cyclone.x = mergeX;
    cyclone.y = mergeY;
    cyclone.baseAngle = avgAngle;
    cyclone.spiralPhase = 0;
    cyclone.lifetime = 5;
    cyclone.damage = this.stats.damage * 2.5;
    cyclone.hitEnemies.clear();
    cyclone.hitCooldown.clear();
    cyclone.isCyclone = true;
    cyclone.pullRadius = 80;
    cyclone.active = true;

    if (cyclone.sprite) {
      cyclone.sprite.setFrame(getShurikenFrame(true, this.currentQuality));
      cyclone.sprite.setPosition(mergeX, mergeY);
      cyclone.sprite.setVisible(true);
      cyclone.sprite.setActive(true);
      cyclone.sprite.setScale(2);
    }
  }

  private applyCyclonePull(
    ctx: WeaponContext,
    cyclone: Shuriken,
    spatialHash: ReturnType<typeof getEnemySpatialHash>
  ): void {
    const pullStrength = 80;
    const pullRadius = cyclone.pullRadius;
    const pullRadiusSq = pullRadius * pullRadius;

    const nearbyEnemies = spatialHash.queryPotential(cyclone.x, cyclone.y, pullRadius + 5);

    for (const enemy of nearbyEnemies) {
      const enemyId = enemy.id;
      const ex = Transform.x[enemyId];
      const ey = Transform.y[enemyId];
      const dx = cyclone.x - ex;
      const dy = cyclone.y - ey;
      const distSq = dx * dx + dy * dy;

      if (distSq > 0 && distSq < pullRadiusSq) {
        const dist = Math.sqrt(distSq);
        const pullFactor = (1 - dist / pullRadius) * pullStrength * ctx.deltaTime;
        Transform.x[enemyId] += (dx / dist) * pullFactor;
        Transform.y[enemyId] += (dy / dist) * pullFactor;
      }
    }
  }

  protected recalculateStats(): void {
    super.recalculateStats();
    this.stats.count = this.baseStats.count + Math.floor((this.level - 1) / 2) + this.externalBonusCount;
    this.stats.piercing = this.baseStats.piercing + Math.floor(this.level / 3) + this.externalBonusPiercing;
    this.spiralAmplitude = 30 + (this.level - 1) * 5;
    this.stats.speed = this.baseStats.speed + (this.level - 1) * 20;
  }

  public destroy(): void {
    for (const shuriken of this.pool) {
      if (shuriken.sprite) {
        shuriken.sprite.destroy();
        shuriken.sprite = null;
      }
    }
    this.pool = [];
    this.poolInitialized = false;
    if (this.effectsGraphics) {
      this.effectsGraphics.destroy();
      this.effectsGraphics = null;
    }
    super.destroy();
  }
}
