/**
 * minimapProjection — pure math for the tactical minimap / threat radar.
 *
 * The radar is player-centered: every tracked entity's world-space offset from
 * the player is projected into a small radar disc. Entities beyond the radar's
 * world range clamp to the rim (direction preserved) so distant bosses and
 * off-screen swarms still register at the radar edge.
 *
 * Phaser-free so the projection + classification can be unit-tested without a
 * live scene. MinimapManager owns the drawing; this owns the maths.
 */

/**
 * World-space radius (px) that maps to the radar's rim. An entity exactly this
 * far from the player sits on the rim; anything farther clamps to it. Tuned to
 * comfortably cover off-screen threats on the 1280×720 viewport.
 */
export const MINIMAP_WORLD_RANGE = 900;

/** XP thresholds mirror OffScreenIndicatorManager so tiers agree across the HUD. */
export const MINIMAP_MINIBOSS_XP = 30;
export const MINIMAP_BOSS_XP = 1000;

export type MinimapBlipKind = 'enemy' | 'elite' | 'miniboss' | 'boss' | 'pickup';

export interface MinimapProjection {
  /** Radar-local x offset from center, in px (right = +). */
  x: number;
  /** Radar-local y offset from center, in px (down = +). */
  y: number;
  /** True when the entity was beyond worldRange and clamped to the rim. */
  atRim: boolean;
}

/**
 * Project a world-space delta (entity position − player position) into a
 * radar-local offset. Non-finite inputs and degenerate radii collapse to the
 * center so the radar can never draw a NaN blip.
 */
export function projectToRadar(
  deltaX: number,
  deltaY: number,
  radarRadius: number,
  worldRange: number = MINIMAP_WORLD_RANGE
): MinimapProjection {
  if (!Number.isFinite(deltaX) || !Number.isFinite(deltaY)) {
    return { x: 0, y: 0, atRim: false };
  }
  if (!(radarRadius > 0) || !(worldRange > 0)) {
    return { x: 0, y: 0, atRim: false };
  }

  const scale = radarRadius / worldRange;
  const scaledX = deltaX * scale;
  const scaledY = deltaY * scale;
  const scaledDistance = Math.hypot(scaledX, scaledY);

  if (scaledDistance > radarRadius) {
    const clampFactor = radarRadius / scaledDistance;
    return { x: scaledX * clampFactor, y: scaledY * clampFactor, atRim: true };
  }
  return { x: scaledX, y: scaledY, atRim: false };
}

/**
 * Classify an enemy into a radar blip kind from its XP value and elite flag.
 * Tier (boss/miniboss) always wins; the elite flag only promotes low-XP
 * regular enemies (affixed bosses keep their boss blip — tier wins).
 */
export function classifyEnemyKind(xpValue: number, isElite: boolean): MinimapBlipKind {
  if (xpValue >= MINIMAP_BOSS_XP) return 'boss';
  if (xpValue >= MINIMAP_MINIBOSS_XP) return 'miniboss';
  if (isElite) return 'elite';
  return 'enemy';
}

export interface MinimapBlipStyle {
  /** Fill color (0xRRGGBB). */
  color: number;
  /** Blip radius in px (before HUD scaling). */
  radius: number;
  /** Higher draws on top — bosses paint over the enemy swarm. */
  priority: number;
}

// Threat tier raises both the blip size and the draw priority so the eye lands
// on the biggest threats first even amid a dense radar.
const BLIP_STYLES: Record<MinimapBlipKind, MinimapBlipStyle> = {
  enemy: { color: 0xff4444, radius: 1.5, priority: 0 },
  pickup: { color: 0xffd700, radius: 2.5, priority: 1 },
  elite: { color: 0xff44ff, radius: 2.5, priority: 2 },
  miniboss: { color: 0xffaa00, radius: 3.5, priority: 3 },
  boss: { color: 0xff2222, radius: 4.5, priority: 4 },
};

/** Resolve the draw style for a blip kind; unknown kinds degrade to plain enemy. */
export function blipStyle(kind: MinimapBlipKind): MinimapBlipStyle {
  return BLIP_STYLES[kind] ?? BLIP_STYLES.enemy;
}
