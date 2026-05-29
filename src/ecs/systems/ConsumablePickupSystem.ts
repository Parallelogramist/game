import { defineQuery, removeEntity, addEntity, addComponent, IWorld } from 'bitecs';
import { Transform, Consumable, ConsumablePickupTag, PlayerTag, SpriteRef } from '../components';
import { getSprite, unregisterSprite, registerSprite } from './SpriteSystem';
import { EffectsManager } from '../../effects/EffectsManager';

/**
 * Floor consumables — rare battlefield power-ups dropped by enemies, chests,
 * destructibles and bounties. Mirrors the HealthPickup / MagnetPickup module
 * pattern: module-level scene/effects/sound refs, a query-driven update that
 * magnetizes pickups toward the player and fires a collect callback so
 * GameScene (which owns the weapon/meta managers) applies the actual effect.
 */
export enum ConsumableKind {
  BOMB = 1,    // Screen-clearing area damage burst
  FREEZE = 2,  // Briefly freezes every on-screen enemy
  VACUUM = 3,  // Magnetizes all gems / health pickups
  GOLD = 4,    // Instant gold cache
}

const consumableQuery = defineQuery([Transform, Consumable, ConsumablePickupTag]);
const playerQuery = defineQuery([Transform, PlayerTag]);

// Consumables magnetize from a touch farther than health so the player can
// reliably grab a deliberate power-up, but still has to move toward it.
const MAGNET_RANGE = 80;
const MAGNET_SPEED = 240;
const COLLECT_RANGE = 28;

type ConsumableCollectCallback = (kind: ConsumableKind, x: number, y: number, value: number) => void;
let onConsumableCollectCallback: ConsumableCollectCallback | null = null;

let sceneReference: Phaser.Scene | null = null;
let effectsManager: EffectsManager | null = null;

export function setConsumablePickupSystemScene(scene: Phaser.Scene): void {
  sceneReference = scene;
}

export function setConsumablePickupEffectsManager(manager: EffectsManager): void {
  effectsManager = manager;
}

/** Register a callback invoked when a consumable is collected. */
export function setConsumableCollectCallback(callback: ConsumableCollectCallback): void {
  onConsumableCollectCallback = callback;
}

/** Per-kind neon colors used for the pickup visual + collection burst. */
const KIND_COLOR: Record<number, number> = {
  [ConsumableKind.BOMB]: 0xff7733,
  [ConsumableKind.FREEZE]: 0x55ccff,
  [ConsumableKind.VACUUM]: 0xbb66ff,
  [ConsumableKind.GOLD]: 0xffd24a,
};

/** Draws a small distinct neon glyph for each consumable kind. */
function drawConsumableVisual(graphics: Phaser.GameObjects.Graphics, kind: ConsumableKind): void {
  const color = KIND_COLOR[kind] ?? 0xffffff;
  // Shared glowing disc backdrop so consumables read as "special".
  graphics.fillStyle(color, 0.18);
  graphics.fillCircle(0, 0, 16);
  graphics.lineStyle(2, color, 0.9);
  graphics.strokeCircle(0, 0, 12);

  switch (kind) {
    case ConsumableKind.BOMB: {
      // Solid core + fuse spark.
      graphics.fillStyle(0x331100, 1);
      graphics.fillCircle(0, 1, 7);
      graphics.lineStyle(2, color, 1);
      graphics.strokeCircle(0, 1, 7);
      graphics.fillStyle(0xffee88, 1);
      graphics.fillCircle(4, -7, 2.5);
      break;
    }
    case ConsumableKind.FREEZE: {
      // Six-spoke snowflake.
      graphics.lineStyle(2, 0xffffff, 1);
      for (let spoke = 0; spoke < 6; spoke++) {
        const angle = (spoke / 6) * Math.PI * 2;
        graphics.beginPath();
        graphics.moveTo(0, 0);
        graphics.lineTo(Math.cos(angle) * 9, Math.sin(angle) * 9);
        graphics.strokePath();
      }
      break;
    }
    case ConsumableKind.VACUUM: {
      // Inward spiral arcs.
      graphics.lineStyle(2, 0xffffff, 0.95);
      for (let ring = 0; ring < 3; ring++) {
        graphics.strokeCircle(0, 0, 3 + ring * 3);
      }
      break;
    }
    case ConsumableKind.GOLD: {
      // Eight-point star coin.
      graphics.fillStyle(0xfff4c0, 1);
      const starPoints: Phaser.Geom.Point[] = [];
      for (let tip = 0; tip < 8; tip++) {
        const radius = tip % 2 === 0 ? 9 : 4;
        const angle = (tip / 8) * Math.PI * 2 - Math.PI / 2;
        starPoints.push(new Phaser.Geom.Point(Math.cos(angle) * radius, Math.sin(angle) * radius));
      }
      graphics.fillPoints(starPoints, true);
      break;
    }
  }
}

/** Spawns a consumable pickup at a position. `value` is the GOLD payload. */
export function spawnConsumablePickup(
  world: IWorld,
  positionX: number,
  positionY: number,
  kind: ConsumableKind,
  value: number = 0,
): number {
  const pickupId = addEntity(world);

  addComponent(world, Transform, pickupId);
  addComponent(world, Consumable, pickupId);
  addComponent(world, ConsumablePickupTag, pickupId);
  addComponent(world, SpriteRef, pickupId);

  Transform.x[pickupId] = positionX;
  Transform.y[pickupId] = positionY;
  Transform.rotation[pickupId] = 0;

  Consumable.kind[pickupId] = kind;
  Consumable.magnetized[pickupId] = 0;
  Consumable.value[pickupId] = value;

  if (sceneReference) {
    const graphics = sceneReference.add.graphics();
    graphics.setPosition(positionX, positionY);
    drawConsumableVisual(graphics, kind);
    registerSprite(pickupId, graphics);
  }

  return pickupId;
}

/** Per-frame: magnetize consumables toward the player and collect on contact. */
export function consumablePickupSystem(world: IWorld, deltaTime: number, gameTime: number = 0): IWorld {
  const pickups = consumableQuery(world);
  const players = playerQuery(world);
  if (players.length === 0) return world;

  const playerId = players[0];
  const playerX = Transform.x[playerId];
  const playerY = Transform.y[playerId];

  const pickupsToRemove: number[] = [];
  const collectRangeSq = COLLECT_RANGE * COLLECT_RANGE;
  const magnetRangeSq = MAGNET_RANGE * MAGNET_RANGE;

  for (let i = 0; i < pickups.length; i++) {
    const pickupId = pickups[i];
    const pickupX = Transform.x[pickupId];
    const pickupY = Transform.y[pickupId];

    const directionX = playerX - pickupX;
    const directionY = playerY - pickupY;
    const distanceSq = directionX * directionX + directionY * directionY;

    if (distanceSq < collectRangeSq) {
      pickupsToRemove.push(pickupId);
      const kind = Consumable.kind[pickupId] as ConsumableKind;
      if (effectsManager) {
        effectsManager.playDeathBurst(pickupX, pickupY, KIND_COLOR[kind] ?? 0xffffff);
      }
      if (onConsumableCollectCallback) {
        onConsumableCollectCallback(kind, pickupX, pickupY, Consumable.value[pickupId]);
      }
      continue;
    }

    if (distanceSq < magnetRangeSq || Consumable.magnetized[pickupId] === 1) {
      Consumable.magnetized[pickupId] = 1;
      const distance = Math.sqrt(distanceSq);
      if (distance < 0.01) continue;
      Transform.x[pickupId] += (directionX / distance) * MAGNET_SPEED * deltaTime;
      Transform.y[pickupId] += (directionY / distance) * MAGNET_SPEED * deltaTime;
    }

    // Bob + pulse so consumables stand out from gems.
    const sprite = getSprite(pickupId);
    if (sprite) {
      const pulse = 1.0 + Math.sin(gameTime * 4) * 0.12;
      sprite.setScale(pulse);
    }
  }

  for (const pickupId of pickupsToRemove) {
    const sprite = getSprite(pickupId);
    if (sprite) {
      sprite.destroy();
      unregisterSprite(pickupId);
    }
    removeEntity(world, pickupId);
  }

  return world;
}

/** Resets module-level state for a fresh run. */
export function resetConsumablePickupSystem(): void {
  onConsumableCollectCallback = null;
  sceneReference = null;
  effectsManager = null;
}
