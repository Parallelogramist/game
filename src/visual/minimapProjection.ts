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

export type MinimapBlipKind = 'enemy' | 'elite' | 'miniboss' | 'boss' | 'pickup' | 'secret';

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
  // The breakable amber (WORLD_GEOMETRY_COLORS.breakable.stroke), the same colour the ambient
  // shimmer uses, so a scanned cache reads as the thing the radar had been hinting at.
  secret: { color: 0xcc8833, radius: 3, priority: 2 },
  elite: { color: 0xff44ff, radius: 2.5, priority: 3 },
  miniboss: { color: 0xffaa00, radius: 3.5, priority: 4 },
  boss: { color: 0xff2222, radius: 4.5, priority: 5 },
};

/** Resolve the draw style for a blip kind; unknown kinds degrade to plain enemy. */
export function blipStyle(kind: MinimapBlipKind): MinimapBlipStyle {
  return BLIP_STYLES[kind] ?? BLIP_STYLES.enemy;
}

/**
 * World-space radius (px) inside which an unfound secret pings the radar. One 1280x720
 * viewport's half-width, so the hint leads the world-space reveal ramp (a cache's 300px
 * sense radius) by a full screen instead of arriving with it.
 */
export const SECRET_PING_RADIUS = 640;

/**
 * Ambient hint strength for the nearest unfound secret: 0 when nothing is in range, rising
 * to 1 on top of it. Inside the radius the ramp starts at a floor rather than at zero, so
 * the far edge is faint but actually visible, then climbs quadratically: the radar says
 * "something is in this room" long before it says "you are standing on it". Non-finite
 * distances and a degenerate radius read as nothing in range, so the radar can never draw a
 * NaN shimmer.
 */
export function secretPingIntensity(
  distance: number,
  radius: number = SECRET_PING_RADIUS
): number {
  if (!Number.isFinite(distance) || !(radius > 0)) return 0;
  if (distance >= radius) return 0;
  const closeness = 1 - Math.max(0, distance) / radius;
  return 0.25 + 0.75 * closeness * closeness;
}
