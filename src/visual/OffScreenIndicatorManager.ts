import Phaser from 'phaser';
import { defineQuery, IWorld } from 'bitecs';
import { EnemyTag, Transform, EnemyType } from '../ecs/components';
import { ENEMY_COLORS } from './NeonColors';
import { getSettingsManager } from '../settings';

// Query for all enemies
const enemyQuery = defineQuery([EnemyTag, Transform, EnemyType]);

// Pre-computed arrow triangle (pointing right, rotated later)
const ARROW_HALF_WIDTH = 5;
const ARROW_LENGTH = 12;

// Edge margin — how far from screen edge to place arrows
const EDGE_MARGIN = 20;

// Maximum simultaneous indicators
const MAX_INDICATORS = 12;

// Only show indicators for enemies with xpValue >= this threshold
// (bosses/minibosses always shown, regular enemies only when close to edge)
const MINIBOSS_XP_THRESHOLD = 30;
const BOSS_XP_THRESHOLD = 1000;
const EDGE_PROXIMITY = 200; // Show regular enemies within this distance of edge

interface IndicatorArrow {
  graphics: Phaser.GameObjects.Graphics;
  inUse: boolean;
}

/**
 * OffScreenIndicatorManager shows directional arrows at screen edges
 * pointing toward off-screen threats. Bosses/minibosses always shown;
 * regular enemies shown when clustered near the edge.
 */
export class OffScreenIndicatorManager {
  private scene: Phaser.Scene;
  private world: IWorld | null = null;
  private arrowPool: IndicatorArrow[] = [];
  private globalTime: number = 0;

  constructor(scene: Phaser.Scene) {
    this.scene = scene;

    // Pre-allocate arrow pool
    for (let i = 0; i < MAX_INDICATORS; i++) {
      const graphics = scene.add.graphics();
      graphics.setScrollFactor(0);
      graphics.setDepth(1900); // Below HUD (2000) but above gameplay
      graphics.setVisible(false);
      this.arrowPool.push({ graphics, inUse: false });
    }
  }

  setWorld(world: IWorld): void {
    this.world = world;
  }

  update(deltaSeconds: number): void {
    if (!this.world) return;
    this.globalTime += deltaSeconds;

    // Reset all arrows
    for (const arrow of this.arrowPool) {
      arrow.inUse = false;
      arrow.graphics.setVisible(false);
    }

    const camera = this.scene.cameras.main;
    const viewLeft = camera.worldView.x;
    const viewTop = camera.worldView.y;
    const viewRight = viewLeft + camera.worldView.width;
    const viewBottom = viewTop + camera.worldView.height;

    // Screen center (for direction calculation)
    const screenCenterX = camera.worldView.width / 2;
    const screenCenterY = camera.worldView.height / 2;

    const entities = enemyQuery(this.world);

    // Collect off-screen threats, prioritized by danger
    interface OffScreenEnemy {
      worldX: number;
      worldY: number;
      xpValue: number;
      color: number;
      distance: number;
    }
    const offScreenEnemies: OffScreenEnemy[] = [];

    for (let i = 0; i < entities.length; i++) {
      const entityId = entities[i];
      const worldX = Transform.x[entityId];
      const worldY = Transform.y[entityId];

      // Skip on-screen enemies
      if (worldX >= viewLeft && worldX <= viewRight &&
          worldY >= viewTop && worldY <= viewBottom) {
        continue;
      }

      const xpValue = EnemyType.xpValue[entityId] || 1;
      const distFromEdgeX = Math.max(0, viewLeft - worldX, worldX - viewRight);
      const distFromEdgeY = Math.max(0, viewTop - worldY, worldY - viewBottom);
      const distFromEdge = Math.sqrt(distFromEdgeX * distFromEdgeX + distFromEdgeY * distFromEdgeY);

      // Always show bosses/minibosses; regular enemies only if close to edge
      if (xpValue >= MINIBOSS_XP_THRESHOLD || distFromEdge < EDGE_PROXIMITY) {
        // Determine color based on enemy type
        let arrowColor: number;
        if (xpValue >= BOSS_XP_THRESHOLD) {
          arrowColor = ENEMY_COLORS.boss.core;
        } else if (xpValue >= MINIBOSS_XP_THRESHOLD) {
          arrowColor = ENEMY_COLORS.miniboss.core;
        } else {
          arrowColor = 0xff4444; // Generic enemy red
        }

        offScreenEnemies.push({
          worldX, worldY, xpValue,
          color: arrowColor,
          distance: distFromEdge,
        });
      }
    }

    // Sort by priority: bosses first, then by proximity
    offScreenEnemies.sort((a, b) => {
      if (a.xpValue >= BOSS_XP_THRESHOLD && b.xpValue < BOSS_XP_THRESHOLD) return -1;
      if (b.xpValue >= BOSS_XP_THRESHOLD && a.xpValue < BOSS_XP_THRESHOLD) return 1;
      if (a.xpValue >= MINIBOSS_XP_THRESHOLD && b.xpValue < MINIBOSS_XP_THRESHOLD) return -1;
      if (b.xpValue >= MINIBOSS_XP_THRESHOLD && a.xpValue < MINIBOSS_XP_THRESHOLD) return 1;
      return a.distance - b.distance;
    });

    // Draw up to MAX_INDICATORS arrows
    const count = Math.min(offScreenEnemies.length, MAX_INDICATORS);
    const isReducedMotion = getSettingsManager().isReducedMotionEnabled();

    for (let i = 0; i < count; i++) {
      const enemy = offScreenEnemies[i];
      const arrow = this.arrowPool[i];
      arrow.inUse = true;

      // Direction from screen center to enemy (in world space)
      const directionX = enemy.worldX - (viewLeft + screenCenterX);
      const directionY = enemy.worldY - (viewTop + screenCenterY);
      const angle = Math.atan2(directionY, directionX);

      // Place arrow at screen edge
      const halfWidth = camera.worldView.width / 2;
      const halfHeight = camera.worldView.height / 2;

      // Ray-box intersection to find edge point
      let edgeX: number, edgeY: number;
      const cosAngle = Math.cos(angle);
      const sinAngle = Math.sin(angle);

      const scaleX = cosAngle !== 0 ? Math.abs((halfWidth - EDGE_MARGIN) / cosAngle) : Infinity;
      const scaleY = sinAngle !== 0 ? Math.abs((halfHeight - EDGE_MARGIN) / sinAngle) : Infinity;
      const edgeScale = Math.min(scaleX, scaleY);

      edgeX = screenCenterX + cosAngle * edgeScale;
      edgeY = screenCenterY + sinAngle * edgeScale;

      // Clamp to screen bounds
      edgeX = Math.max(EDGE_MARGIN, Math.min(camera.worldView.width - EDGE_MARGIN, edgeX));
      edgeY = Math.max(EDGE_MARGIN, Math.min(camera.worldView.height - EDGE_MARGIN, edgeY));

      // Size based on threat level
      const isBoss = enemy.xpValue >= BOSS_XP_THRESHOLD;
      const isMiniboss = enemy.xpValue >= MINIBOSS_XP_THRESHOLD;
      const arrowScale = isBoss ? 1.8 : isMiniboss ? 1.3 : 0.8;

      // Alpha based on distance (closer = brighter)
      const maxAlphaDistance = 400;
      const distanceAlpha = Math.max(0.3, 1 - enemy.distance / maxAlphaDistance);

      // Pulse for bosses/minibosses
      let pulseMultiplier = 1.0;
      if (!isReducedMotion && (isBoss || isMiniboss)) {
        pulseMultiplier = 0.7 + Math.sin(this.globalTime * 4) * 0.3;
      }

      // Draw arrow
      const arrowGraphics = arrow.graphics;
      arrowGraphics.clear();
      arrowGraphics.setPosition(edgeX, edgeY);
      arrowGraphics.setRotation(angle);
      arrowGraphics.setVisible(true);

      const finalAlpha = distanceAlpha * pulseMultiplier;

      // Arrow triangle
      arrowGraphics.fillStyle(enemy.color, finalAlpha);
      arrowGraphics.fillTriangle(
        ARROW_LENGTH * arrowScale, 0,
        -ARROW_HALF_WIDTH * arrowScale, -ARROW_HALF_WIDTH * arrowScale,
        -ARROW_HALF_WIDTH * arrowScale, ARROW_HALF_WIDTH * arrowScale
      );

      // White outline for visibility
      arrowGraphics.lineStyle(1, 0xffffff, finalAlpha * 0.5);
      arrowGraphics.strokeTriangle(
        ARROW_LENGTH * arrowScale, 0,
        -ARROW_HALF_WIDTH * arrowScale, -ARROW_HALF_WIDTH * arrowScale,
        -ARROW_HALF_WIDTH * arrowScale, ARROW_HALF_WIDTH * arrowScale
      );
    }
  }

  destroy(): void {
    for (const arrow of this.arrowPool) {
      arrow.graphics.destroy();
    }
    this.arrowPool = [];
  }
}
