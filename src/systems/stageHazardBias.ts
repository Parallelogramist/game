/**
 * stageHazardBias: which hazards a stage's ground grows, as data.
 *
 * Pure and Phaser-free so the two modules that need it can share one table: HazardZoneSystem
 * rolls against it, and regionSignature states it on the sector banner. It lived in
 * HazardZoneSystem until FEAT-REGION-SIGNATURE-HAZARDS; that module's first import is Phaser,
 * which a Node-env test of the describer cannot load.
 *
 * Each stage leans its hazard spawner toward a signature hazard type so the biomes feel
 * mechanically different from the default "random hazards" mix. Weights are applied
 * multiplicatively *on top of* the base weights in pickHazardType — 2.0 doubles odds, 0.5 halves
 * them. A weight of 0 disables the type entirely for that stage.
 */

export type HazardType = 'burn' | 'ice' | 'void' | 'energy';

export interface StageHazardBias {
  readonly weightMultipliers: Readonly<Record<HazardType, number>>;
  readonly spawnIntervalMultiplier: number;
}

export const DEFAULT_STAGE_BIAS: StageHazardBias = {
  weightMultipliers: { burn: 1.0, ice: 1.0, void: 1.0, energy: 1.0 },
  spawnIntervalMultiplier: 1.0,
};

export const STAGE_HAZARD_BIASES: Record<string, StageHazardBias> = {
  stage_deep_void: DEFAULT_STAGE_BIAS,
  // Inferno: scorched cosmos leans HEAVILY into burn zones, with rare energy
  // pockets and suppressed ice (the heat won't sustain it).
  stage_inferno: {
    weightMultipliers: { burn: 3.0, ice: 0.2, void: 0.5, energy: 1.2 },
    spawnIntervalMultiplier: 0.8,
  },
  // Crystal Caves: ice dominates, void present (rifts in the crystal), energy
  // rare, burn suppressed.
  stage_crystal_caves: {
    weightMultipliers: { burn: 0.3, ice: 3.0, void: 1.4, energy: 0.5 },
    spawnIntervalMultiplier: 0.9,
  },
  // Endless Void: void + energy dominate, with burn/ice suppressed. Hazards
  // spawn more frequently to match the escalating endgame pressure.
  stage_endless_void: {
    weightMultipliers: { burn: 0.5, ice: 0.5, void: 3.0, energy: 2.0 },
    spawnIntervalMultiplier: 0.7,
  },
  // Ion Field: charged plains where energy zones dominate, void present as the
  // storm's eye, burn/ice suppressed. Hazards spawn a touch faster.
  stage_ion_field: {
    weightMultipliers: { burn: 0.5, ice: 0.5, void: 0.8, energy: 3.2 },
    spawnIntervalMultiplier: 0.85,
  },
  // Verdant Rot: decaying void rifts dominate (the rot pulls things in), energy
  // steady, burn/ice suppressed by the damp rot.
  stage_verdant_rot: {
    weightMultipliers: { burn: 0.6, ice: 0.4, void: 3.0, energy: 1.0 },
    spawnIntervalMultiplier: 0.9,
  },
  // Molten Vault: burn zones dominate with live energy arcing off the ore, ice
  // all but gone, void rare. Hazards spawn faster to press the gold gamble.
  stage_molten_vault: {
    weightMultipliers: { burn: 2.5, ice: 0.3, void: 0.6, energy: 1.5 },
    spawnIntervalMultiplier: 0.85,
  },
};

/** Iteration order for the signature scan. It is exactly the key order of regionSignature's
 *  HAZARD_SIGNATURE_NAMES, so extracting this scan out of that module cannot change which
 *  hazard a tie names. */
const HAZARD_TYPES: readonly HazardType[] = ['burn', 'energy', 'ice', 'void'];

/** The one hazard a region grows more of than default ground, or null when it grows none.
 *  Null for stage_deep_void (unbiased on purpose) and for any unknown stage id. */
export function signatureHazardType(stageId: string): HazardType | null {
  const bias = STAGE_HAZARD_BIASES[stageId];
  if (bias === undefined) return null;
  let strongest: HazardType | null = null;
  for (const hazardType of HAZARD_TYPES) {
    const multiplier = bias.weightMultipliers[hazardType];
    if (multiplier <= 1) continue;
    if (strongest === null || multiplier > bias.weightMultipliers[strongest]) {
      strongest = hazardType;
    }
  }
  return strongest;
}
