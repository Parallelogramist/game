import Phaser from 'phaser';
import { defineQuery, IWorld } from 'bitecs';
import { EnemyTag, EnemyAffix, Transform, EnemyType, Health } from '../ecs/components';
import { getSprite } from '../ecs/systems/SpriteSystem';
import { VisualQuality } from './GlowGraphics';
import { AFFIX_META, EnemyAffixType } from '../data/Affixes';

/**
 * Renders elite markers for affixed enemies: a pulsing colored ring, a floating
 * mini health bar, and a small affix label. Pooled per the
 * StatusEffectVisualManager pattern. This is the only place "elite" enemies get
 * a health bar (regular enemies don't), so it doubles as the elite HP readout.
 */
const eliteQuery = defineQuery([EnemyTag, EnemyAffix, Transform, Health]);

interface EliteMarker {
  ring: Phaser.GameObjects.Graphics;
  bar: Phaser.GameObjects.Graphics;
  label: Phaser.GameObjects.Text;
  inUse: boolean;
}

const activeEliteIds = new Set<number>();

export class EliteAffixVisualManager {
  private world: IWorld | null = null;
  private pool: EliteMarker[] = [];
  private active: Map<number, EliteMarker> = new Map();
  private quality: VisualQuality = 'high';
  private globalTime: number = 0;

  private static readonly POOL_SIZE = 48;

  constructor(scene: Phaser.Scene) {
    for (let i = 0; i < EliteAffixVisualManager.POOL_SIZE; i++) {
      const ring = scene.add.graphics();
      ring.setDepth(11);
      ring.setVisible(false);
      const bar = scene.add.graphics();
      bar.setDepth(12);
      bar.setVisible(false);
      const label = scene.add.text(0, 0, '', {
        fontSize: '9px',
        fontFamily: 'monospace',
        color: '#ffffff',
      });
      label.setOrigin(0.5, 1);
      label.setDepth(12);
      label.setVisible(false);
      this.pool.push({ ring, bar, label, inUse: false });
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

    const entities = eliteQuery(this.world);
    activeEliteIds.clear();

    const showLabel = this.quality !== 'low';

    for (let i = 0; i < entities.length; i++) {
      const entityId = entities[i];
      const affixType = EnemyAffix.affixType[entityId] as EnemyAffixType;
      if (affixType === EnemyAffixType.NONE) continue;
      const sprite = getSprite(entityId);
      if (!sprite) continue;

      activeEliteIds.add(entityId);

      let marker = this.active.get(entityId);
      if (!marker) {
        const acquired = this.acquire(entityId);
        if (!acquired) continue; // pool exhausted
        marker = acquired;
        // Label text only changes on (re)acquire.
        const meta = AFFIX_META[affixType];
        marker.label.setText(meta.label);
        marker.label.setColor(`#${meta.color.toString(16).padStart(6, '0')}`);
      }

      const meta = AFFIX_META[affixType];
      const x = Transform.x[entityId];
      const y = Transform.y[entityId];
      const radius = (EnemyType.size[entityId] || 1) * 11 + 4;

      // Pulsing ring.
      const pulse = 0.55 + Math.sin(this.globalTime * 4 + entityId) * 0.25;
      marker.ring.clear();
      marker.ring.setPosition(x, y);
      marker.ring.setVisible(true);
      marker.ring.lineStyle(2, meta.color, pulse);
      marker.ring.strokeCircle(0, 0, radius);

      // Floating mini HP bar above the enemy.
      const hpFrac = Math.max(0, Math.min(1, Health.current[entityId] / (Health.max[entityId] || 1)));
      const barWidth = 22;
      const barY = -radius - 8;
      marker.bar.clear();
      marker.bar.setPosition(x, y);
      marker.bar.setVisible(true);
      marker.bar.fillStyle(0x000000, 0.6);
      marker.bar.fillRect(-barWidth / 2 - 1, barY - 1, barWidth + 2, 5);
      marker.bar.fillStyle(meta.color, 0.95);
      marker.bar.fillRect(-barWidth / 2, barY, barWidth * hpFrac, 3);

      // Label.
      if (showLabel) {
        marker.label.setVisible(true);
        marker.label.setPosition(x, y + barY - 3);
      } else {
        marker.label.setVisible(false);
      }
    }

    // Release markers for enemies no longer elite/alive.
    for (const [entityId, marker] of this.active) {
      if (!activeEliteIds.has(entityId)) {
        this.release(entityId, marker);
      }
    }
  }

  private acquire(entityId: number): EliteMarker | null {
    for (const marker of this.pool) {
      if (!marker.inUse) {
        marker.inUse = true;
        this.active.set(entityId, marker);
        return marker;
      }
    }
    return null;
  }

  private release(entityId: number, marker: EliteMarker): void {
    marker.inUse = false;
    marker.ring.clear();
    marker.ring.setVisible(false);
    marker.bar.clear();
    marker.bar.setVisible(false);
    marker.label.setVisible(false);
    this.active.delete(entityId);
  }

  /** Force-release a marker when its enemy dies. */
  unregisterEnemy(entityId: number): void {
    const marker = this.active.get(entityId);
    if (marker) this.release(entityId, marker);
  }

  destroy(): void {
    for (const marker of this.pool) {
      marker.ring.destroy();
      marker.bar.destroy();
      marker.label.destroy();
    }
    this.pool = [];
    this.active.clear();
  }
}
