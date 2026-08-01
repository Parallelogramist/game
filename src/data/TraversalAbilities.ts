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
    description: 'Rubble seams collapse under a planted charge as the ship closes on them.',
    icon: 'bomb',
    barrierTypeId: 'barrier_cracked_wall',
    guardTier: 'elite',
  },
  {
    id: 'ability_magno_tether',
    name: 'Magno-Tether',
    description: 'Void gaps stop being walls: the tether reels the ship across.',
    icon: 'chain',
    barrierTypeId: 'barrier_void_gap',
    synergyUpgradeId: 'sprintLevel',
    guardTier: 'elite',
  },
  {
    id: 'ability_phase_cloak',
    name: 'Phase Cloak',
    description: 'Security grids part for the cloak, and stay dark once passed.',
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

export interface VaultGuardMember {
  /** ENEMY_TYPES key. */
  readonly typeId: string;
  readonly count: number;
}

/**
 * The placed pack each vault spawns, by its ability's guardTier (doc 04 section 2, Claim flow).
 *
 * No member may be boss-tier. handleEnemyDeath runs the victory path on any death with
 * xpValue >= 1000, so a boss in a side room would end the run from a vault; the decryptor's
 * 'boss' tier is therefore a MINIBOSS-tier anchor (`stalker`, xpValue 300) plus a heavier
 * escort, not an xpValue-1000 spawn. referentialIntegrity.test.ts pins both halves of that.
 */
export const VAULT_GUARD_PACKS: Record<
  TraversalAbilityDefinition['guardTier'], readonly VaultGuardMember[]
> = {
  elite: [
    { typeId: 'warden', count: 2 },
    { typeId: 'shielded', count: 1 },
    { typeId: 'tank', count: 1 },
  ],
  boss: [
    { typeId: 'stalker', count: 1 },
    { typeId: 'warden', count: 2 },
    { typeId: 'shielded', count: 2 },
  ],
};

/**
 * How far the decryptor's sweep reaches before luck widens it, in edge-hops. Two is the
 * neighbourhood a player could have charted by flying one room in each direction and coming
 * back, so the ability pays immediately without handing over the map.
 */
export const SCAN_PULSE_BASE_GRAPH_RADIUS = 2;
export const SCAN_PULSE_MAX_GRAPH_RADIUS = 4;

/** luckLevel is the decryptor's synergy hook (doc 04 section 2, "ping range scales"): one extra
 *  hop per two purchased levels, so that upgrade's maxLevel of 5 tops the sweep out at 4. */
export function scanPulseGraphRadius(luckLevel: number): number {
  const purchasedLevels = Number.isFinite(luckLevel) ? Math.max(0, Math.floor(luckLevel)) : 0;
  return Math.min(
    SCAN_PULSE_MAX_GRAPH_RADIUS,
    SCAN_PULSE_BASE_GRAPH_RADIUS + Math.floor(purchasedLevels / 2),
  );
}

export function getTraversalAbility(id: string): TraversalAbilityDefinition | undefined {
  return TRAVERSAL_ABILITIES.find((ability) => ability.id === id);
}

/** Vault depth of an ability, or -1 if unknown. Array position is the only order. */
export function traversalAbilityIndex(id: string): number {
  return TRAVERSAL_ABILITIES.findIndex((ability) => ability.id === id);
}

/**
 * Abilities whose catalog `description` names a system that exists in code. The claim toast
 * prints `description` only for these; every other ability still opens its doors and does
 * nothing else, and a toast must not promise a capability the player will not receive.
 */
export const IMPLEMENTED_TRAVERSAL_ABILITY_IDS: ReadonlySet<TraversalAbilityId> = new Set([
  'ability_blink_drive',
  'ability_breach_charges',
  'ability_magno_tether',
  'ability_phase_cloak',
  'ability_thermal_ward',
  'ability_signal_decryptor',
]);
