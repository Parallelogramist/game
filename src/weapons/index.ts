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
