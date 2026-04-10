import Phaser from 'phaser';
import { defineQuery, IWorld } from 'bitecs';
import { EnemyTag, StatusEffect, Transform, EnemyType } from '../ecs/components';
import { getSprite } from '../ecs/systems/SpriteSystem';
import { VisualQuality } from './GlowGraphics';

// Colors matching the status effect damage number colors
const BURN_OVERLAY_COLOR = 0xff6622;
const FREEZE_OVERLAY_COLOR = 0x88ccff;
const POISON_OVERLAY_COLOR = 0x66ff66;

// Query for enemies with status effects
const statusVisualQuery = defineQuery([EnemyTag, StatusEffect, Transform]);

/**
 * Pooled overlay object for status effect visuals.
 */
interface StatusOverlay {
  graphics: Phaser.GameObjects.Graphics;
  inUse: boolean;
}

/**
 * StatusEffectVisualManager renders burn/freeze/poison visual overlays on enemies.
 * Uses object pooling for performance with many simultaneous status effects.
 */
// Reusable set to avoid per-frame allocation
const activeEntityIdsBuffer = new Set<number>();

export class StatusEffectVisualManager {
  private world: IWorld | null = null;
  private overlayPool: StatusOverlay[] = [];
  private activeOverlays: Map<number, StatusOverlay> = new Map();
  private quality: VisualQuality = 'high';
  private globalTime: number = 0;

  // Track last-drawn state per entity to skip redundant redraws
  private lastDrawnState: Map<number, number> = new Map(); // entityId -> packed state

  private static readonly POOL_SIZE = 60;

  constructor(scene: Phaser.Scene) {
    // Pre-allocate overlay pool
    for (let i = 0; i < StatusEffectVisualManager.POOL_SIZE; i++) {
      const graphics = scene.add.graphics();
      graphics.setDepth(11); // Just above enemy sprites (depth 10)
      graphics.setVisible(false);
      this.overlayPool.push({ graphics, inUse: false });
    }
  }

  setWorld(world: IWorld): void {
    this.world = world;
  }

  setQuality(quality: VisualQuality): void {
    this.quality = quality;
  }

  update(deltaSeconds: number): void {
    if (!this.world) return;

    this.globalTime += deltaSeconds;

    const entities = statusVisualQuery(this.world);
    activeEntityIdsBuffer.clear();

    for (let i = 0; i < entities.length; i++) {
      const entityId = entities[i];

      const hasBurn = StatusEffect.burnDuration[entityId] > 0;
      const hasFreeze = StatusEffect.freezeDuration[entityId] > 0;
      const poisonStacks = StatusEffect.poisonStacks[entityId];
      const hasPoison = poisonStacks > 0;

      if (!hasBurn && !hasFreeze && !hasPoison) continue;

      // Get the enemy sprite to position the overlay
      const sprite = getSprite(entityId);
      if (!sprite) continue;

      activeEntityIdsBuffer.add(entityId);

      // Get or allocate overlay
      let overlay = this.activeOverlays.get(entityId);
      if (!overlay) {
        const acquired = this.acquireOverlay(entityId);
        if (!acquired) continue; // Pool exhausted
        overlay = acquired;
      }

      const enemySize = (EnemyType.size[entityId] || 1) * 10;
      const overlayGraphics = overlay.graphics;

      // Always update position (cheap)
      overlayGraphics.setPosition(Transform.x[entityId], Transform.y[entityId]);
      overlayGraphics.setVisible(true);

      // Pack state to detect changes: burn(1bit) | freeze(1bit) | poisonStacks(8bits) | size(16bits)
      const packedState = ((hasBurn ? 1 : 0) << 25) | ((hasFreeze ? 1 : 0) << 24) | ((poisonStacks & 0xff) << 16) | (enemySize & 0xffff);
      const lastState = this.lastDrawnState.get(entityId);

      // Only redraw when status effect state changes
      if (packedState !== lastState) {
        this.lastDrawnState.set(entityId, packedState);
        overlayGraphics.clear();

        if (hasFreeze) {
          this.drawFreezeOverlay(overlayGraphics, enemySize);
        }
        if (hasBurn) {
          this.drawBurnOverlay(overlayGraphics, enemySize);
        }
        if (hasPoison) {
          this.drawPoisonOverlay(overlayGraphics, enemySize, poisonStacks);
        }
      }
    }

    // Release overlays for entities no longer affected
    for (const [entityId, overlay] of this.activeOverlays) {
      if (!activeEntityIdsBuffer.has(entityId)) {
        this.lastDrawnState.delete(entityId);
        this.releaseOverlay(entityId, overlay);
      }
    }
  }

  /**
   * Burn: flickering orange glow that oscillates in alpha.
   */
  private drawBurnOverlay(graphics: Phaser.GameObjects.Graphics, enemySize: number): void {
    const flickerAlpha = 0.15 + Math.sin(this.globalTime * 8) * 0.1;
    graphics.fillStyle(BURN_OVERLAY_COLOR, flickerAlpha);
    graphics.fillCircle(0, 0, enemySize * 1.2);

    // Small flame tips (high quality only)
    if (this.quality === 'high' || this.quality === 'medium') {
      const flameCount = 3;
      for (let i = 0; i < flameCount; i++) {
        const angle = (i / flameCount) * Math.PI * 2 + this.globalTime * 3;
        const tipX = Math.cos(angle) * enemySize * 0.6;
        const tipY = Math.sin(angle) * enemySize * 0.6 - enemySize * 0.3;
        graphics.fillStyle(BURN_OVERLAY_COLOR, flickerAlpha * 0.8);
        graphics.fillCircle(tipX, tipY, enemySize * 0.25);
      }
    }
  }

  /**
   * Freeze: static cyan tint with ice crystal accents.
   */
  private drawFreezeOverlay(graphics: Phaser.GameObjects.Graphics, enemySize: number): void {
    // Solid cyan overlay (frozen = rigid, no pulsing)
    graphics.fillStyle(FREEZE_OVERLAY_COLOR, 0.35);
    graphics.fillCircle(0, 0, enemySize * 1.1);

    // Ice crystal lines (high quality only)
    if (this.quality === 'high') {
      graphics.lineStyle(1.5, 0xffffff, 0.4);
      const crystalCount = 4;
      for (let i = 0; i < crystalCount; i++) {
        const angle = (i / crystalCount) * Math.PI * 2;
        const innerRadius = enemySize * 0.3;
        const outerRadius = enemySize * 1.0;
        graphics.lineBetween(
          Math.cos(angle) * innerRadius,
          Math.sin(angle) * innerRadius,
          Math.cos(angle) * outerRadius,
          Math.sin(angle) * outerRadius
        );
      }
    }
  }

  /**
   * Poison: pulsing green overlay that intensifies with stacks.
   */
  private drawPoisonOverlay(graphics: Phaser.GameObjects.Graphics, enemySize: number, stacks: number): void {
    const stackIntensity = Math.min(1, stacks / 5); // Brighter with more stacks
    const pulseAlpha = (0.1 + stackIntensity * 0.15) + Math.sin(this.globalTime * 4) * 0.05;
    graphics.fillStyle(POISON_OVERLAY_COLOR, pulseAlpha);
    graphics.fillCircle(0, 0, enemySize * 1.15);

    // Drip bubbles (high/medium quality)
    if (this.quality !== 'low') {
      const bubbleCount = Math.min(stacks, 3);
      for (let i = 0; i < bubbleCount; i++) {
        const bubblePhase = this.globalTime * 2 + i * 2.1;
        const bubbleY = (bubblePhase % 1.0) * enemySize * 0.8;
        const bubbleX = Math.sin(i * 1.7) * enemySize * 0.4;
        const bubbleAlpha = 0.3 * (1 - (bubblePhase % 1.0)); // Fades as it falls
        graphics.fillStyle(POISON_OVERLAY_COLOR, bubbleAlpha);
        graphics.fillCircle(bubbleX, bubbleY, 2);
      }
    }
  }

  private acquireOverlay(entityId: number): StatusOverlay | null {
    for (const overlay of this.overlayPool) {
      if (!overlay.inUse) {
        overlay.inUse = true;
        this.activeOverlays.set(entityId, overlay);
        return overlay;
      }
    }
    return null;
  }

  private releaseOverlay(entityId: number, overlay: StatusOverlay): void {
    overlay.inUse = false;
    overlay.graphics.clear();
    overlay.graphics.setVisible(false);
    this.activeOverlays.delete(entityId);
  }

  /**
   * Force-release overlay for a specific entity (on death).
   */
  unregisterEnemy(entityId: number): void {
    const overlay = this.activeOverlays.get(entityId);
    if (overlay) {
      this.releaseOverlay(entityId, overlay);
    }
  }

  destroy(): void {
    for (const overlay of this.overlayPool) {
      overlay.graphics.destroy();
    }
    this.overlayPool = [];
    this.activeOverlays.clear();
  }
}
