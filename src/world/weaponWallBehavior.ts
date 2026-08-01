/**
 * weaponWallBehavior: whether a weapon's damage is stopped by the world's static geometry.
 *
 * Doc 02 section 7 gives every weapon one of three archetypes. As built in this repo they map
 * like this, and the mapping lives here as prose rather than as an id-keyed table because
 * there is no shared projectile path to consult one: every weapon integrates its own pool in
 * its own updateEffects, so the behaviour is already declared exactly once, at the only place
 * that can act on it. A parallel table would be a second source of truth that nothing reads.
 *
 * - Travels (stopped by a solid tile): Energy Darts, Shuriken, Drone bolts, Sentry bolts,
 *   Guardian shards, Homing Missiles, Boomerang glaives, and all enemy fire. Each calls
 *   projectileBlocked() from its own loop. Player travellers call playerProjectileBlocked,
 *   which also chips a breakable barrier; enemy fire calls projectileBlocked, which never does.
 * - Bounces (the one exception that needs the resolver, not this predicate): Ricochet, which
 *   calls resolveCircleMove directly for the reflection axis and reports its own contact impact
 *   from the axis the resolver flagged, since only the caller knows which way the ball was
 *   travelling when it was turned around.
 * - Emanates (ignores geometry entirely): auras, novas, pulses, storms, meteors, ground
 *   spikes, mines, wake, singularity, chain-lightning jumps, flamethrower cones, orbitals,
 *   melee arcs, and every splash radius including detonateArea. Small radii clipped by walls
 *   punish the player unpredictably and a per-target line-of-sight check would sit on the
 *   hottest damage path.
 * - Grenade is a lob, not a traveller: it interpolates to a target point with an arc height
 *   and never samples a tile in flight, so it sails over a wall and needs nothing here.
 * - Hitscan lines (instant, no travel time): clipped at the first solid tile via
 *   beamReachFraction(), and by playerBeamReachFraction() for a player line, which also chips
 *   the breakable barrier it stopped at, rate limited per barrier because a swept line is a
 *   per-frame query rather than one projectile. Arc Sweep clips each spoke, Laser Beam clips
 *   its main and refracted endpoints, Scattergun clips each pellet ray, and the Machine's boss
 *   laser clips at GameScene.handleLaserBeam, the one choke point every boss beam goes through,
 *   on the plain fraction because it is enemy fire. Focus Beam is
 *   a lock-on rather than a swept line, so clipping has no meaning for it: it uses the same
 *   primitive as a line-of-sight test instead, and refuses to hold or take a lock through rock.
 *   Railgun is the declared pierce exception and is realised by not clipping it.
 * - Target ACQUISITION is a separate question from damage delivery, and it is answered in
 *   src/weapons/WeaponUtils.ts rather than here: findNearestVisibleEnemy,
 *   findNearestVisibleInHash and pickVisibleRandomEnemy all gate a candidate on
 *   beamReachFraction() >= 1 before a weapon will aim at it. The eight weapons whose shot
 *   rock can stop (Energy Darts, Shuriken, Boomerang, Laser Beam, Scattergun, Homing
 *   Missile, Drone, Sentry) acquire through them, so they hold fire or re-roll instead of
 *   spending a shot on a target behind a wall. Emanate, lob, bounce and pierce weapons keep
 *   acquiring the plain nearest enemy, because geometry does not stop their damage. Focus
 *   Beam keeps its own inline scan: it also has to drop a lock the frame a wall interposes.
 *
 * Phaser-free like the rest of src/world/: nothing here may import Phaser, src/game/,
 * src/systems/ or the ECS.
 */

import { MoverKind, isSolidAtWorld, raycastSolid } from './staticCollision';
import { reportPlayerContactImpact, reportPlayerImpact } from './barrierState';
import type { WorldMap } from './worldTypes';

/**
 * Has a travelling projectile reached something that stops it? A mode with no geometry
 * passes null and nothing is ever blocked, which is what leaves arena mode the arithmetic
 * it was before walls existed.
 */
export function projectileBlocked(world: WorldMap | null, x: number, y: number): boolean {
  return world !== null && isSolidAtWorld(world, x, y, MoverKind.Projectile);
}

/**
 * The same test for a PLAYER projectile, which additionally lands one impact on whatever
 * breakable barrier stopped it. Enemy fire keeps calling projectileBlocked: doc 02 section
 * 4's table has enemy projectiles stopping at a destructible without damaging it, and the
 * two callers are one GameScene loop and the boss laser.
 */
export function playerProjectileBlocked(world: WorldMap | null, x: number, y: number): boolean {
  if (world === null) return false;
  if (!isSolidAtWorld(world, x, y, MoverKind.Projectile)) return false;
  reportPlayerImpact(world, x, y);
  return true;
}

/**
 * Fraction of a requested hitscan line that survives the world's geometry: 1 when the whole
 * segment is clear, 0 when its origin is already inside rock. A mode with no geometry passes
 * null and always gets 1, which is what leaves arena mode the arithmetic it was before walls
 * existed. Callers scale their own endpoint and reach by it rather than being handed a point,
 * because a swept beam needs the length for its hit test and a drawn beam needs the endpoint.
 */
export function beamReachFraction(
  world: WorldMap | null, x1: number, y1: number, x2: number, y2: number,
): number {
  if (world === null) return 1;
  return raycastSolid(world, x1, y1, x2, y2, MoverKind.Projectile);
}

/** World px past the entry point a beam's impact is probed at, so it lands inside the blocking
 *  tile rather than on its boundary. TILE_SIZE is 40, so this cannot reach the next tile. */
const BEAM_IMPACT_PROBE_PX = 1;

/**
 * The same fraction as beamReachFraction, for a PLAYER hitscan line, which additionally lands
 * one rate-limited contact impact on whatever breakable barrier stopped it. A fraction of 0
 * reports nothing: the origin is already inside rock, so no part of the line ever existed.
 * Enemy hitscan (the boss laser) keeps calling beamReachFraction, on doc 02 section 4's rule
 * that enemy fire stops at a destructible without damaging it.
 */
export function playerBeamReachFraction(
  world: WorldMap | null, x1: number, y1: number, x2: number, y2: number, nowSeconds: number,
): number {
  if (world === null) return 1;
  const fraction = raycastSolid(world, x1, y1, x2, y2, MoverKind.Projectile);
  if (fraction <= 0 || fraction >= 1) return fraction;
  const dx = x2 - x1;
  const dy = y2 - y1;
  const length = Math.sqrt(dx * dx + dy * dy);
  if (length === 0) return fraction;
  const probe = fraction + BEAM_IMPACT_PROBE_PX / length;
  reportPlayerContactImpact(world, x1 + dx * probe, y1 + dy * probe, nowSeconds);
  return fraction;
}
