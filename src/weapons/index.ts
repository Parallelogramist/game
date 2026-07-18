// Weapon System Exports
export { BaseWeapon } from './BaseWeapon';
export type { WeaponContext, WeaponStats } from './BaseWeapon';
export { WeaponManager } from './WeaponManager';

// Individual Weapons
export { ProjectileWeapon } from './ProjectileWeapon';
export { KatanaWeapon } from './KatanaWeapon';
export { OrbitingBladesWeapon } from './OrbitingBladesWeapon';
export { AuraWeapon } from './AuraWeapon';
export { ChainLightningWeapon } from './ChainLightningWeapon';
export { HomingMissileWeapon } from './HomingMissileWeapon';
export { FrostNovaWeapon } from './FrostNovaWeapon';
export { LaserBeamWeapon } from './LaserBeamWeapon';
export { MeteorWeapon } from './MeteorWeapon';
export { FlamethrowerWeapon } from './FlamethrowerWeapon';
export { RicochetWeapon } from './RicochetWeapon';
export { GroundSpikeWeapon } from './GroundSpikeWeapon';
export { DroneWeapon } from './DroneWeapon';
export { ShurikenWeapon } from './ShurikenWeapon';
export { BoomerangWeapon } from './BoomerangWeapon';
export { SentryWeapon } from './SentryWeapon';
export { SingularityWeapon } from './SingularityWeapon';
export { GuardianWeapon } from './GuardianWeapon';
export { WakeWeapon } from './WakeWeapon';
export { PulseWeapon } from './PulseWeapon';
export { MineWeapon } from './MineWeapon';
export { SweepBeamWeapon } from './SweepBeamWeapon';
export { StormWeapon } from './StormWeapon';
export { RailgunWeapon } from './RailgunWeapon';
export { ScattergunWeapon } from './ScattergunWeapon';
export { FocusBeamWeapon } from './FocusBeamWeapon';
export { GrenadeWeapon } from './GrenadeWeapon';
export { ReaperWeapon } from './ReaperWeapon';

// Weapon factory for creating weapons by ID
import { BaseWeapon } from './BaseWeapon';
import { ProjectileWeapon } from './ProjectileWeapon';
import { KatanaWeapon } from './KatanaWeapon';
import { OrbitingBladesWeapon } from './OrbitingBladesWeapon';
import { AuraWeapon } from './AuraWeapon';
import { ChainLightningWeapon } from './ChainLightningWeapon';
import { HomingMissileWeapon } from './HomingMissileWeapon';
import { FrostNovaWeapon } from './FrostNovaWeapon';
import { LaserBeamWeapon } from './LaserBeamWeapon';
import { MeteorWeapon } from './MeteorWeapon';
import { FlamethrowerWeapon } from './FlamethrowerWeapon';
import { RicochetWeapon } from './RicochetWeapon';
import { GroundSpikeWeapon } from './GroundSpikeWeapon';
import { DroneWeapon } from './DroneWeapon';
import { ShurikenWeapon } from './ShurikenWeapon';
import { BoomerangWeapon } from './BoomerangWeapon';
import { SentryWeapon } from './SentryWeapon';
import { SingularityWeapon } from './SingularityWeapon';
import { GuardianWeapon } from './GuardianWeapon';
import { WakeWeapon } from './WakeWeapon';
import { PulseWeapon } from './PulseWeapon';
import { MineWeapon } from './MineWeapon';
import { SweepBeamWeapon } from './SweepBeamWeapon';
import { StormWeapon } from './StormWeapon';
import { RailgunWeapon } from './RailgunWeapon';
import { ScattergunWeapon } from './ScattergunWeapon';
import { FocusBeamWeapon } from './FocusBeamWeapon';
import { GrenadeWeapon } from './GrenadeWeapon';
import { ReaperWeapon } from './ReaperWeapon';

/**
 * All available weapon types and their constructors.
 */
export const WeaponRegistry: Record<string, () => BaseWeapon> = {
  projectile: () => new ProjectileWeapon(),
  katana: () => new KatanaWeapon(),
  orbiting_blades: () => new OrbitingBladesWeapon(),
  aura: () => new AuraWeapon(),
  chain_lightning: () => new ChainLightningWeapon(),
  homing_missile: () => new HomingMissileWeapon(),
  frost_nova: () => new FrostNovaWeapon(),
  laser_beam: () => new LaserBeamWeapon(),
  meteor: () => new MeteorWeapon(),
  flamethrower: () => new FlamethrowerWeapon(),
  ricochet: () => new RicochetWeapon(),
  ground_spike: () => new GroundSpikeWeapon(),
  drone: () => new DroneWeapon(),
  shuriken: () => new ShurikenWeapon(),
  boomerang: () => new BoomerangWeapon(),
  sentry: () => new SentryWeapon(),
  singularity: () => new SingularityWeapon(),
  guardian: () => new GuardianWeapon(),
  wake: () => new WakeWeapon(),
  pulse: () => new PulseWeapon(),
  mine: () => new MineWeapon(),
  sweep_beam: () => new SweepBeamWeapon(),
  storm: () => new StormWeapon(),
  railgun: () => new RailgunWeapon(),
  scatter: () => new ScattergunWeapon(),
  focus: () => new FocusBeamWeapon(),
  grenade: () => new GrenadeWeapon(),
  reaper: () => new ReaperWeapon(),
};

/**
 * Create a weapon by its ID.
 */
export function createWeapon(weaponId: string): BaseWeapon | null {
  const factory = WeaponRegistry[weaponId];
  return factory ? factory() : null;
}

/**
 * Get list of all weapon IDs.
 */
export function getAllWeaponIds(): string[] {
  return Object.keys(WeaponRegistry);
}

/**
 * Weapon metadata for upgrade screen.
 */
export interface WeaponInfo {
  id: string;
  name: string;
  icon: string;
  description: string;
}

/**
 * Get metadata for all weapons.
 */
export function getWeaponInfoList(): WeaponInfo[] {
  return Object.entries(WeaponRegistry).map(([id, factory]) => {
    const weapon = factory();
    return {
      id,
      name: weapon.name,
      icon: weapon.icon,
      description: weapon.description,
    };
  });
}
