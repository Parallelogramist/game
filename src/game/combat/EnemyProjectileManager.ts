import Phaser from 'phaser';
import { getSettingsManager } from '../../settings';
import { inflateRect, type WorldRect } from '../../world/worldSpace';
import type { WorldMap } from '../../world/worldTypes';
import { beamReachFraction, projectileBlocked } from '../../world/weaponWallBehavior';
import {
  stepEnemyProjectile,
  type EnemyProjectileState,
  type EnemyProjectileStepWorld,
} from './enemyProjectileStep';

/** Half-width of the boss beam's damage band, in world px. */
const LASER_HIT_HALF_WIDTH = 25;

export interface EnemyProjectileManagerOptions {
  worldMap: () => WorldMap | null;
  viewRect: () => WorldRect;
  /** Null while there is no player entity. */
  playerPosition: () => { x: number; y: number } | null;
  /** The live escort drone, or null outside the expedition. Re-read per projectile, because a
   *  drone killed by one shot must not still be hit by the next one in the same frame. */
  escortDronePosition: () => { x: number; y: number } | null;
  damagePlayer: (amount: number, sourceLabel: string) => void;
  damageEscortDrone: (damage: number, hitX: number, hitY: number, travelAngle: number) => void;
  /** The player's i-frame gate, which the boss beam honours and enemy bullets do not
   *  (BUG-ENEMY-FIRE-IFRAMES). */
  playerDamageReady: () => boolean;
  shakeCamera: (durationMs: number, intensity: number) => void;
}

interface LiveEnemyProjectile extends EnemyProjectileState {
  sprite: Phaser.GameObjects.Arc;
}

interface ActiveLaser {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  lifetime: number;
}

/**
 * Owns every hostile shot in the world: the shooter/sniper bullets and the boss hitscan beams.
 */
export class EnemyProjectileManager {
  private scene: Phaser.Scene;
  private options: EnemyProjectileManagerOptions;
  private projectiles: LiveEnemyProjectile[] = [];
  private lasers: ActiveLaser[] = [];
  private laserGraphics: Phaser.GameObjects.Graphics | null = null;

  constructor(scene: Phaser.Scene, options: EnemyProjectileManagerOptions) {
    this.scene = scene;
    this.options = options;
  }

  spawn(x: number, y: number, angle: number, speed: number, damage: number): void {
    // Enemy projectiles use a distinct signature: saturated crimson core with a
    // warm-gold ring. Ring color lies outside the player weapon palette (cyan /
    // violet / blue) so the player can recognize incoming threats even in dense
    // combat where orange fire weapons are active.
    const sprite = this.scene.add.circle(x, y, 8, 0xff2233);
    sprite.setStrokeStyle(3, 0xffcc66);
    sprite.setDepth(5);

    this.projectiles.push({
      sprite,
      x,
      y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      damage,
      lifetime: 4,
    });
  }

  update(deltaTime: number): void {
    const worldMap = this.options.worldMap();
    const world: EnemyProjectileStepWorld = {
      despawnRect: inflateRect(this.options.viewRect(), 20),
      isBlocked: (x, y) => projectileBlocked(worldMap, x, y),
      playerPosition: this.options.playerPosition(),
      escortDronePosition: null,
    };

    // Reverse iteration with swap-and-pop for O(1) removal.
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const projectile = this.projectiles[i];
      world.escortDronePosition = this.options.escortDronePosition();

      const outcome = stepEnemyProjectile(projectile, deltaTime, world);
      if (outcome === 'alive') {
        projectile.sprite.x = projectile.x;
        projectile.sprite.y = projectile.y;
        continue;
      }

      if (outcome === 'hitPlayer') {
        this.options.damagePlayer(projectile.damage, 'Enemy Fire');
      } else if (outcome === 'hitEscortDrone') {
        this.options.damageEscortDrone(
          projectile.damage,
          projectile.x,
          projectile.y,
          Math.atan2(projectile.vy, projectile.vx),
        );
      }

      projectile.sprite.destroy();
      const lastIndex = this.projectiles.length - 1;
      if (i < lastIndex) {
        this.projectiles[i] = this.projectiles[lastIndex];
      }
      this.projectiles.pop();
    }
  }

  fireLaser(x1: number, y1: number, x2: number, y2: number, damage: number): void {
    // Every boss beam reaches the world through this one callback, so clipping here covers the
    // renderer and the player hit test at once. A boss standing inside rock yields a zero-length
    // beam until FEAT-WORLDGEN-NAV stops enemies phasing through walls, which is the honest
    // reading: a laser fired from inside a wall does not come out of it.
    const reachFraction = beamReachFraction(this.options.worldMap(), x1, y1, x2, y2);
    const beamEndX = x1 + (x2 - x1) * reachFraction;
    const beamEndY = y1 + (y2 - y1) * reachFraction;

    this.lasers.push({ x1, y1, x2: beamEndX, y2: beamEndY, lifetime: 0.1 });

    const player = this.options.playerPosition();
    if (player && this.options.playerDamageReady()) {
      const beamDx = beamEndX - x1;
      const beamDy = beamEndY - y1;
      const beamLength = Math.sqrt(beamDx * beamDx + beamDy * beamDy);
      if (beamLength > 0) {
        const along = Math.max(0, Math.min(1,
          ((player.x - x1) * beamDx + (player.y - y1) * beamDy) / (beamLength * beamLength)));
        const closestX = x1 + along * beamDx;
        const closestY = y1 + along * beamDy;
        const distance = Math.sqrt((player.x - closestX) ** 2 + (player.y - closestY) ** 2);

        if (distance < LASER_HIT_HALF_WIDTH) {
          this.options.damagePlayer(damage, 'Laser Beam');

          if (getSettingsManager().isScreenShakeEnabled()) {
            this.options.shakeCamera(150, 0.008);
          }
        }
      }
    }

    // Ungated on purpose, unlike the ground-blast path: a volley fires once per charge cycle, so a
    // drone inside two crossing beams eating both is what standing in a laser grid means.
    const drone = this.options.escortDronePosition();
    const laneDx = beamEndX - x1;
    const laneDy = beamEndY - y1;
    const laneLengthSquared = laneDx * laneDx + laneDy * laneDy;
    if (drone && laneLengthSquared > 0) {
      const droneAlong = Math.max(0, Math.min(1,
        ((drone.x - x1) * laneDx + (drone.y - y1) * laneDy) / laneLengthSquared));
      const droneClosestX = x1 + droneAlong * laneDx;
      const droneClosestY = y1 + droneAlong * laneDy;
      const droneGapX = drone.x - droneClosestX;
      const droneGapY = drone.y - droneClosestY;
      if (droneGapX * droneGapX + droneGapY * droneGapY < LASER_HIT_HALF_WIDTH * LASER_HIT_HALF_WIDTH) {
        this.options.damageEscortDrone(damage, droneClosestX, droneClosestY, Math.atan2(laneDy, laneDx));
      }
    }
  }

  updateLasers(deltaTime: number): void {
    this.lasers = this.lasers.filter(laser => {
      laser.lifetime -= deltaTime;
      return laser.lifetime > 0;
    });

    if (!this.laserGraphics) {
      this.laserGraphics = this.scene.add.graphics();
      this.laserGraphics.setDepth(50);
    }

    this.laserGraphics.clear();

    for (const laser of this.lasers) {
      this.laserGraphics.lineStyle(12, 0xff4400, 0.3);
      this.laserGraphics.lineBetween(laser.x1, laser.y1, laser.x2, laser.y2);

      this.laserGraphics.lineStyle(4, 0xff8800, 1);
      this.laserGraphics.lineBetween(laser.x1, laser.y1, laser.x2, laser.y2);

      this.laserGraphics.lineStyle(2, 0xffffff, 1);
      this.laserGraphics.lineBetween(laser.x1, laser.y1, laser.x2, laser.y2);
    }
  }

  /** Drops everything in flight without tearing down the pooled graphics: a new run reuses it. */
  clear(): void {
    for (const projectile of this.projectiles) {
      projectile.sprite.destroy();
    }
    this.projectiles.length = 0;
    this.lasers.length = 0;
  }

  destroy(): void {
    this.clear();
    if (this.laserGraphics) {
      this.laserGraphics.destroy();
      this.laserGraphics = null;
    }
  }
}
