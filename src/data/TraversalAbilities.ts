/**
 * Traversal abilities — the permanent, profile-level ship systems earned only at
 * generator-placed ability vaults in the expedition world.
 *
 * Deliberately NOT the `dashLevel` / `phaseLevel` / `sprintLevel` shop upgrades:
 * worldgen proves a world solvable by knowing exactly which keys a profile can hold at
 * each graph depth, and a gold-purchasable key would make that proof impossible. They
 * are also never granted stats — the permanent power a player takes out of the map is
 * reach, not DPS, which is why this definition has no numeric stat field at all.
 */

export type TraversalAbilityId =
  | 'ability_blink_drive'
  | 'ability_breach_charges'
  | 'ability_magno_tether'
  | 'ability_phase_cloak'
  | 'ability_thermal_ward'
  | 'ability_signal_decryptor';

/** The barrier flavour each ability opens, from doc 02's taxonomy (section 4). */
export type BarrierTypeId =
  | 'barrier_flicker_screen'
  | 'barrier_cracked_wall'
  | 'barrier_void_gap'
  | 'barrier_security_grid'
  | 'barrier_hazard_field'
  | 'barrier_ciphered_door';

export interface TraversalAbilityDefinition {
  readonly id: TraversalAbilityId;
  readonly name: string;
  readonly description: string;
  /** Semantic IconMap key. */
  readonly icon: string;
  readonly barrierTypeId: BarrierTypeId;
  /** PERMANENT_UPGRADES id whose purchased levels improve this earned ability. */
  readonly synergyUpgradeId?: string;
  /** Encounter tier guarding this ability's vault. */
  readonly guardTier: 'elite' | 'boss';
}

export const TRAVERSAL_ABILITIES: readonly TraversalAbilityDefinition[] = [
  {
    id: 'ability_blink_drive',
    name: 'Blink Drive',
    description: 'Short-range blink on a cooldown, with brief invulnerability.',
    icon: 'bolt',
    barrierTypeId: 'barrier_flicker_screen',
    synergyUpgradeId: 'dashLevel',
    guardTier: 'elite',
  },
  {
    id: 'ability_breach_charges',
    name: 'Breach Charges',
    description: 'Deployable charge that blows open rubble seams and false walls.',
    icon: 'bomb',
    barrierTypeId: 'barrier_cracked_wall',
    guardTier: 'elite',
  },
  {
    id: 'ability_magno_tether',
    name: 'Magno-Tether',
    description: 'Reel across void gaps between anchor pylons.',
    icon: 'chain',
    barrierTypeId: 'barrier_void_gap',
    synergyUpgradeId: 'sprintLevel',
    guardTier: 'elite',
  },
  {
    id: 'ability_phase_cloak',
    name: 'Phase Cloak',
    description: 'Hold to pass through security grids and enemy bodies.',
    icon: 'ghost',
    barrierTypeId: 'barrier_security_grid',
    synergyUpgradeId: 'phaseLevel',
    guardTier: 'elite',
  },
  {
    id: 'ability_thermal_ward',
    name: 'Thermal Ward',
    description: 'Hazard sectors stop draining the hull.',
    icon: 'holy-aura',
    barrierTypeId: 'barrier_hazard_field',
    synergyUpgradeId: 'slowResistLevel',
    guardTier: 'elite',
  },
  {
    id: 'ability_signal_decryptor',
    name: 'Signal Decryptor',
    description: 'Ciphered doors open on touch; a ping surfaces nearby secrets.',
    icon: 'radar',
    barrierTypeId: 'barrier_ciphered_door',
    synergyUpgradeId: 'luckLevel',
    guardTier: 'boss',
  },
];

/**
 * The generation input doc 02 consumes as `WorldGenInputs.abilityGateOrder`. Array
 * position IS acquisition order and vault depth, so reordering TRAVERSAL_ABILITIES
 * changes every generated world and requires a `WORLDGEN_VERSION` bump.
 */
export const TRAVERSAL_ABILITY_GATE_ORDER: readonly TraversalAbilityId[] =
  TRAVERSAL_ABILITIES.map((ability) => ability.id);

export function getTraversalAbility(id: string): TraversalAbilityDefinition | undefined {
  return TRAVERSAL_ABILITIES.find((ability) => ability.id === id);
}

/** Vault depth of an ability, or -1 if unknown. Array position is the only order. */
export function traversalAbilityIndex(id: string): number {
  return TRAVERSAL_ABILITIES.findIndex((ability) => ability.id === id);
}
