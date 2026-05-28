import Phaser from 'phaser';
import { IWorld } from 'bitecs';
import { Transform, EnemyType } from '../ecs/components';
import { getEnemyIds } from '../ecs/FrameCache';
import { ENEMY_COLORS } from './NeonColors';
import { getSettingsManager } from '../settings';

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

// Priority key = tier * TIER_WEIGHT + distFromEdge. Lower = shown first.
// TIER_WEIGHT dwarfs any possible distance so tier always dominates ordering.
const TIER_WEIGHT = 1e7;

interface IndicatorArrow {
  graphics: Phaser.GameObjects.Graphics;
  inUse: boolean;
}

// Reusable candidate slot — pooled so the per-frame scan allocates nothing.
interface OffScreenCandidate {
  worldX: number;
  worldY: number;
  xpValue: number;
  color: number;
  distance: number;
  priority: number;
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
  // Fixed-size, pre-allocated buffer holding the current best candidates in
  // ascending-priority order. Reused every frame — never re-allocated.
  private candidates: OffScreenCandidate[] = [];
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

      // Pre-allocate the matching candidate slot.
      this.candidates.push({
        worldX: 0, worldY: 0, xpValue: 0, color: 0, distance: 0, priority: 0,
      });
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

    // Reuse the shared per-frame enemy query (CLAUDE.md: query once per frame).
    const enemyIds = getEnemyIds();
    const candidates = this.candidates;
    let candidateCount = 0;

    // Collect the highest-priority off-screen threats via bounded insertion into
    // the fixed buffer — no per-frame array allocation and no full sort.
    for (let i = 0; i < enemyIds.length; i++) {
      const entityId = enemyIds[i];
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
      if (xpValue < MINIBOSS_XP_THRESHOLD && distFromEdge >= EDGE_PROXIMITY) {
        continue;
      }

      // Tier + color by threat (boss = 0 = highest priority).
      let tier: number;
      let arrowColor: number;
      if (xpValue >= BOSS_XP_THRESHOLD) {
        tier = 0;
        arrowColor = ENEMY_COLORS.boss.core;
      } else if (xpValue >= MINIBOSS_XP_THRESHOLD) {
        tier = 1;
        arrowColor = ENEMY_COLORS.miniboss.core;
      } else {
        tier = 2;
        arrowColor = 0xff4444; // Generic enemy red
      }
      const priority = tier * TIER_WEIGHT + distFromEdge;

      // Bounded insertion sort: keep the MAX_INDICATORS lowest-priority entries.
      const full = candidateCount === MAX_INDICATORS;
      if (full && priority >= candidates[candidateCount - 1].priority) {
        continue; // Not better than the current worst kept candidate.
      }
      // Start at the append slot (or reuse the worst slot when full) and shift
      // any higher-priority entries right to open the insertion point.
      let insertAt = full ? candidateCount - 1 : candidateCount;
      while (insertAt > 0 && candidates[insertAt - 1].priority > priority) {
        const dst = candidates[insertAt];
        const src = candidates[insertAt - 1];
        dst.worldX = src.worldX;
        dst.worldY = src.worldY;
        dst.xpValue = src.xpValue;
        dst.color = src.color;
        dst.distance = src.distance;
        dst.priority = src.priority;
        insertAt--;
      }
      const slot = candidates[insertAt];
      slot.worldX = worldX;
      slot.worldY = worldY;
      slot.xpValue = xpValue;
      slot.color = arrowColor;
      slot.distance = distFromEdge;
      slot.priority = priority;
      if (!full) candidateCount++;
    }

    // Draw the kept candidates (already ordered by priority).
    const count = candidateCount;
    const isReducedMotion = getSettingsManager().isReducedMotionEnabled();

    for (let i = 0; i < count; i++) {
      const enemy = candidates[i];
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

      // Draw arrow — Balatro cel-style: thick black ink silhouette pre-pass,
      // colored fill on top, thin highlight stroke for sparkle.
      const arrowGraphics = arrow.graphics;
      arrowGraphics.clear();
      arrowGraphics.setPosition(edgeX, edgeY);
      arrowGraphics.setRotation(angle);
      arrowGraphics.setVisible(true);

      const finalAlpha = distanceAlpha * pulseMultiplier;
      const tipX = ARROW_LENGTH * arrowScale;
      const baseX = -ARROW_HALF_WIDTH * arrowScale;
      const baseHalfY = ARROW_HALF_WIDTH * arrowScale;
      const inkExpand = 1.35; // Outline grows the silhouette outward.
      const inkTipX = tipX * inkExpand;
      const inkBaseX = baseX * inkExpand - 1;
      const inkBaseHalfY = baseHalfY * inkExpand + 1;

      // Black ink silhouette (chunky outline).
      arrowGraphics.fillStyle(0x000000, finalAlpha);
      arrowGraphics.fillTriangle(inkTipX, 0, inkBaseX, -inkBaseHalfY, inkBaseX, inkBaseHalfY);

      // Colored fill on top.
      arrowGraphics.fillStyle(enemy.color, finalAlpha);
      arrowGraphics.fillTriangle(tipX, 0, baseX, -baseHalfY, baseX, baseHalfY);

      // Bright highlight stripe along the leading edge — Balatro top-stripe feel.
      arrowGraphics.lineStyle(1.5, 0xffffff, finalAlpha * 0.7);
      arrowGraphics.beginPath();
      arrowGraphics.moveTo(tipX * 0.85, -baseHalfY * 0.55);
      arrowGraphics.lineTo(tipX * 0.95, 0);
      arrowGraphics.strokePath();
    }
  }

  destroy(): void {
    for (const arrow of this.arrowPool) {
      arrow.graphics.destroy();
    }
    this.arrowPool = [];
  }
}
