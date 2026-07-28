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
 *   projectileBlocked() from its own loop.
 * - Bounces (the one exception that needs the resolver, not this predicate): Ricochet, which
 *   calls resolveCircleMove directly for the reflection axis. Wrapping that here would add a
 *   pass-through with nothing to say.
 * - Emanates (ignores geometry entirely): auras, novas, pulses, storms, meteors, ground
 *   spikes, mines, wake, singularity, chain-lightning jumps, orbitals, melee arcs, and every
 *   splash radius including detonateArea. Small radii clipped by walls punish the player
 *   unpredictably and a per-target line-of-sight check would sit on the hottest damage path.
 * - Grenade is a lob, not a traveller: it interpolates to a target point with an arc height
 *   and never samples a tile in flight, so it sails over a wall and needs nothing here.
 * - Hitscan lines (beams, Scattergun pellets, Railgun, the Machine's laser) are clipped by
 *   FEAT-BARRIER-BEAMS, which owns raycastSolid.
 *
 * Phaser-free like the rest of src/world/: nothing here may import Phaser, src/game/,
 * src/systems/ or the ECS.
 */

import { MoverKind, isSolidAtWorld } from './staticCollision';
import type { WorldMap } from './worldTypes';

/**
 * Has a travelling projectile reached something that stops it? A mode with no geometry
 * passes null and nothing is ever blocked, which is what leaves arena mode the arithmetic
 * it was before walls existed.
 */
export function projectileBlocked(world: WorldMap | null, x: number, y: number): boolean {
  return world !== null && isSolidAtWorld(world, x, y, MoverKind.Projectile);
}
