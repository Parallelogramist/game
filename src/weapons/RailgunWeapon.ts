import { BaseWeapon, WeaponContext, WeaponStats } from './BaseWeapon';
import { Transform, Health } from '../ecs/components';
import { DepthLayers } from '../visual/DepthLayers';
import { VisualQuality } from '../visual/GlowGraphics';

const LANCE_POOL_SIZE = 6;
const LANCE_OVERSHOOT = 120;   // px the lance extends past the locked target
const MIN_LANCE_LEN = 360;     // px minimum lance length (skewers a line even up close)
const FLASH_SECONDS = 0.16;    // how long a lance + impact glow is drawn
const KNOCKBACK = 30;
const KILLSHOT_MULT = 2;       // mastery (Killshot): toughest target takes double damage
const NEON = 0x66e0ff;         // hot cyan energy lance
const EVOLVED_NEON = 0xbff2ff;

interface Lance {
  sx: number; sy: number;   // ship end
  ex: number; ey: number;   // far end
  impactX: number;          // locked-target point (where the impact glow blooms)
  impactY: number;
  age: number;              // seconds since spawn
  active: boolean;
}

/**
 * RailgunWeapon ("Railgun") — the arsenal's only *toughest-target single-strike*. Each
 * cooldown it locks the enemy with the highest current HP anywhere on the field and fires
 * an instant piercing rail lance from the ship through it: the locked target always takes
 * the full hit (double under Killshot mastery), and the lance skewers a limited number of
 * enemies along its line. Unlike Laser Beam (a cursor-aimed, continuously-ticking beam)
 * this is auto-targeted at the toughest enemy and fires a discrete heavy burst on
 * cooldown — the arsenal's first dedicated boss/elite focus tool. Damage is applied
 * instantly in attack(); the pooled Lance objects are purely the visual, advanced and
 * redrawn each frame into one shared Graphics (the self-drawing pattern of the recent
 * weapons, so no projectile-atlas frame is required). The line hit-test is trivial and
 * stays inline — no separate pure module or unit test.
 *
 * Mastery ("Killshot"): the locked (toughest) target takes double damage.
 * Evolution ("Annihilator", via piercing): harder, wider, overpenetrating lance.
 */
export class RailgunWeapon extends BaseWeapon {
  private lances: Lance[] = [];
  private lanceGraphics: Phaser.GameObjects.Graphics | null = null;
  private currentQuality: VisualQuality = 'high';
  private poolInitialized = false;

  constructor() {
    const baseStats: WeaponStats = {
      damage: 48,
      cooldown: 1.5,
      range: 18,     // lance HALF-WIDTH (px) — scaled by the universal Range stat
      count: 1,      // unused — always one lance per attack
      piercing: 2,   // enemies pierced beyond the locked target (+1 every 2 levels)
      size: 1,       // scales lance line thickness
      speed: 0,      // unused — the lance is instant (scalesProjectileSpeed stays false)
      duration: 0,   // unused — flash lifetime is the fixed FLASH_SECONDS const
    };

    super(
      'railgun',
      'Railgun',
      'telescope',
      'Locks the toughest enemy and skewers it with a piercing rail lance',
      10,
      baseStats,
      'Killshot',
      'The toughest enemy struck takes double damage'
    );

    // Fire the first lance ~0.4s in rather than leaving a Railgun starting weapon idle
    // for a full 1.5s (mirrors Storm/Pulse).
    this.lastFired = -(baseStats.cooldown - 0.4);
  }

  private initPool(scene: Phaser.Scene): void {
    if (this.poolInitialized) return;
    this.poolInitialized = true;

    this.lanceGraphics = scene.add.graphics();
    this.lanceGraphics.setDepth(DepthLayers.METEOR);

    for (let i = 0; i < LANCE_POOL_SIZE; i++) {
      this.lances.push({
        sx: 0, sy: 0, ex: 0, ey: 0, impactX: 0, impactY: 0, age: 0, active: false,
      });
    }
  }

  protected attack(ctx: WeaponContext): void {
    this.initPool(ctx.scene);

    const enemies = ctx.getEnemies();
    if (enemies.length === 0) return;

    // Lock the toughest live enemy (highest current HP).
    let targetId = -1;
    let bestHealth = -Infinity;
    for (const enemyId of enemies) {
      const health = Health.current[enemyId];
      if (health <= 0) continue;
      if (health > bestHealth) {
        bestHealth = health;
        targetId = enemyId;
      }
    }
    if (targetId < 0) return;

    const shipX = ctx.playerX;
    const shipY = ctx.playerY;
    const targetX = Transform.x[targetId];
    const targetY = Transform.y[targetId];

    const deltaX = targetX - shipX;
    const deltaY = targetY - shipY;
    const targetDistance = Math.hypot(deltaX, deltaY) || 1;
    const dirX = deltaX / targetDistance;
    const dirY = deltaY / targetDistance;
    const lanceLength = Math.max(targetDistance + LANCE_OVERSHOOT, MIN_LANCE_LEN);
    const endX = shipX + dirX * lanceLength;
    const endY = shipY + dirY * lanceLength;

    const halfWidth = this.stats.range;
    const mastered = this.isMastered();

    // Locked target always takes the full (Killshot-doubled) hit.
    ctx.damageEnemy(targetId, this.stats.damage * (mastered ? KILLSHOT_MULT : 1), KNOCKBACK);

    // Pierce: fill the remaining slots with the nearest-along-the-line enemies.
    const maxPierce = this.stats.piercing;
    if (maxPierce > 0) {
      const pierced: { id: number; projection: number }[] = [];
      for (const enemyId of enemies) {
        if (enemyId === targetId) continue;
        if (Health.current[enemyId] <= 0) continue;
        const offsetX = Transform.x[enemyId] - shipX;
        const offsetY = Transform.y[enemyId] - shipY;
        const projection = offsetX * dirX + offsetY * dirY;
        if (projection < 0 || projection > lanceLength) continue;
        const perpX = offsetX - projection * dirX;
        const perpY = offsetY - projection * dirY;
        if (perpX * perpX + perpY * perpY > halfWidth * halfWidth) continue;
        pierced.push({ id: enemyId, projection });
      }
      pierced.sort((a, b) => a.projection - b.projection);
      const hitCount = Math.min(maxPierce, pierced.length);
      for (let i = 0; i < hitCount; i++) {
        ctx.damageEnemy(pierced[i].id, this.stats.damage, KNOCKBACK);
      }
    }

    ctx.effectsManager.playHitSparks(targetX, targetY, Math.atan2(dirY, dirX));
    this.spawnLance(shipX, shipY, endX, endY, targetX, targetY);
    ctx.soundManager.playHit();
  }

  private spawnLance(
    sx: number, sy: number, ex: number, ey: number, impactX: number, impactY: number
  ): void {
    const lance = this.acquireLance();
    lance.sx = sx; lance.sy = sy;
    lance.ex = ex; lance.ey = ey;
    lance.impactX = impactX;
    lance.impactY = impactY;
    lance.age = 0;
    lance.active = true;
  }

  /** First inactive lance, else recycle the oldest (largest age). */
  private acquireLance(): Lance {
    for (const lance of this.lances) {
      if (!lance.active) return lance;
    }
    let oldest = this.lances[0];
    for (const lance of this.lances) {
      if (lance.age > oldest.age) oldest = lance;
    }
    return oldest;
  }

  protected updateEffects(ctx: WeaponContext): void {
    this.initPool(ctx.scene);
    this.currentQuality = ctx.visualQuality;

    const gfx = this.lanceGraphics;
    if (gfx) gfx.clear();

    const evolved = this.isEvolved;
    const color = evolved ? EVOLVED_NEON : NEON;

    for (const lance of this.lances) {
      if (!lance.active) continue;

      lance.age += ctx.deltaTime;
      if (lance.age >= FLASH_SECONDS) {
        lance.active = false;
        continue;
      }

      if (gfx) this.drawLance(gfx, lance, color, evolved);
    }
  }

  private drawLance(
    gfx: Phaser.GameObjects.Graphics,
    lance: Lance,
    color: number,
    evolved: boolean
  ): void {
    const fade = 1 - lance.age / FLASH_SECONDS;
    const alpha = 0.25 + 0.75 * fade;
    const width = (evolved ? 4 : 3) * this.stats.size;

    gfx.lineStyle(width, color, alpha);
    gfx.beginPath();
    gfx.moveTo(lance.sx, lance.sy);
    gfx.lineTo(lance.ex, lance.ey);
    gfx.strokePath();

    if (this.currentQuality !== 'low') {
      gfx.lineStyle(1.5, 0xffffff, alpha * 0.85);
      gfx.beginPath();
      gfx.moveTo(lance.sx, lance.sy);
      gfx.lineTo(lance.ex, lance.ey);
      gfx.strokePath();

      gfx.fillStyle(0xffffff, alpha * 0.5);
      gfx.fillCircle(lance.sx, lance.sy, 5 * this.stats.size);
    }

    const glowRadius = (evolved ? 16 : 12) * this.stats.size * (0.5 + 0.5 * fade);
    gfx.fillStyle(color, alpha * 0.35);
    gfx.fillCircle(lance.impactX, lance.impactY, glowRadius);
    gfx.fillStyle(0xffffff, alpha * 0.55);
    gfx.fillCircle(lance.impactX, lance.impactY, glowRadius * 0.4);
  }

  public destroy(): void {
    if (this.lanceGraphics) {
      this.lanceGraphics.destroy();
      this.lanceGraphics = null;
    }
    this.lances = [];
    this.poolInitialized = false;
    super.destroy();
  }
}
