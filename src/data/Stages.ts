/**
 * Stage / Biome definitions.
 *
 * Each stage defines the visual palette (grid colors + ambient tint),
 * gameplay modifiers (spawn multipliers, reward bonuses), and unlock gating.
 *
 * Stages are selectable from BootScene. The default stage is always available;
 * others unlock via HiddenUnlockManager conditions or world level progression.
 */

/** The lighting system's ambient darkness with no region boost applied: what every stage
 *  shipped with before regions could dim a room. LightingSystem reads this same constant,
 *  so the baseline cannot drift between the table and the renderer. */
export const BASE_AMBIENT_DARKNESS = 0.35;

/** The floor a region's drift factor is clamped to. A rate of 0 is a ship that never reaches
 *  any speed and never stops, so the table is not allowed to author one. */
export const MIN_STAGE_DRIFT_FACTOR = 0.2;

export interface StageDefinition {
  id: string;
  name: string;
  description: string;

  // Visual palette
  gridLineColor: number;
  gridPulseColor: number;
  gridWarpHighlightColor: number;
  ambientOverlayColor: number; // 0 means no overlay
  ambientOverlayAlpha: number;
  /** Extra ambient darkness this region adds on top of BASE_AMBIENT_DARKNESS, 0 to 1.
   *  Absent means the region is lit exactly as every stage always was. */
  ambientDarknessBoost?: number;

  // Gameplay modifiers
  enemyHealthMultiplier: number;
  enemyDamageMultiplier: number;
  xpMultiplier: number;
  goldMultiplier: number;
  /** How much of the shipped velocity-approach rate the ship keeps while this region is
   *  active, MIN_STAGE_DRIFT_FACTOR to 1. Below 1 the ship takes longer to reach top speed and
   *  coasts further after the stick is released; top speed itself never moves. Absent means the
   *  region handles exactly as every stage always did. */
  driftFactor?: number;

  // Optional unlock gate. Missing = always available.
  // Format: 'hidden:<conditionId>' | 'worldLevel:<n>'
  unlockRequirement?: string;
}

export const STAGES: readonly StageDefinition[] = [
  {
    id: 'stage_deep_void',
    name: 'Deep Void',
    description: 'The familiar expanse. Standard enemies, standard rewards.',
    gridLineColor: 0x0066aa,
    gridPulseColor: 0x0099dd,
    gridWarpHighlightColor: 0x00ccff,
    ambientOverlayColor: 0x000000,
    ambientOverlayAlpha: 0,
    enemyHealthMultiplier: 1.0,
    enemyDamageMultiplier: 1.0,
    xpMultiplier: 1.0,
    goldMultiplier: 1.0,
  },
  {
    id: 'stage_inferno',
    name: 'Inferno',
    description: 'Burning red cosmos. +15% enemy damage, +25% gold.',
    gridLineColor: 0xaa3300,
    gridPulseColor: 0xdd5511,
    gridWarpHighlightColor: 0xffaa44,
    ambientOverlayColor: 0xff4400,
    ambientOverlayAlpha: 0.05,
    enemyHealthMultiplier: 1.0,
    enemyDamageMultiplier: 1.15,
    xpMultiplier: 1.0,
    goldMultiplier: 1.25,
    unlockRequirement: 'worldLevel:2',
  },
  {
    id: 'stage_crystal_caves',
    name: 'Crystal Caves',
    description: 'A shimmering crystal grid where almost no light reaches. +20% XP gain, tougher enemies.',
    gridLineColor: 0x6644aa,
    gridPulseColor: 0x8855cc,
    gridWarpHighlightColor: 0xcc88ff,
    ambientOverlayColor: 0x4422aa,
    ambientOverlayAlpha: 0.06,
    ambientDarknessBoost: 0.28,
    enemyHealthMultiplier: 1.2,
    enemyDamageMultiplier: 1.0,
    xpMultiplier: 1.2,
    goldMultiplier: 1.0,
    unlockRequirement: 'hidden:unlock_world_traveler',
  },
  {
    id: 'stage_endless_void',
    name: 'Endless Void',
    description: 'Time bends. +50% combat intensity, +50% rewards.',
    gridLineColor: 0x220066,
    gridPulseColor: 0x440099,
    gridWarpHighlightColor: 0x8844ff,
    ambientOverlayColor: 0x330066,
    ambientOverlayAlpha: 0.12,
    enemyHealthMultiplier: 1.25,
    enemyDamageMultiplier: 1.25,
    xpMultiplier: 1.5,
    goldMultiplier: 1.5,
    unlockRequirement: 'hidden:unlock_long_run',
  },
  {
    id: 'stage_ion_field',
    name: 'Ion Field',
    description: 'Crackling ion plains where thrusters lose their grip. +20% enemy damage, +15% XP.',
    gridLineColor: 0x008899,
    gridPulseColor: 0x00ccdd,
    gridWarpHighlightColor: 0x66ffff,
    ambientOverlayColor: 0x003344,
    ambientOverlayAlpha: 0.06,
    enemyHealthMultiplier: 1.0,
    enemyDamageMultiplier: 1.2,
    xpMultiplier: 1.15,
    goldMultiplier: 1.1,
    driftFactor: 0.45,
    unlockRequirement: 'worldLevel:3',
  },
  {
    id: 'stage_verdant_rot',
    name: 'Verdant Rot',
    description: 'A rotting green expanse. Enemies grow hardier. +30% enemy health, +25% XP.',
    gridLineColor: 0x336611,
    gridPulseColor: 0x66aa22,
    gridWarpHighlightColor: 0xaaff44,
    ambientOverlayColor: 0x223300,
    ambientOverlayAlpha: 0.08,
    enemyHealthMultiplier: 1.3,
    enemyDamageMultiplier: 1.0,
    xpMultiplier: 1.25,
    goldMultiplier: 1.05,
    unlockRequirement: 'worldLevel:3',
  },
  {
    id: 'stage_molten_vault',
    name: 'Molten Vault',
    description: 'A molten treasure-field. Riches at a price. +15% enemy health, +20% damage, +50% gold.',
    gridLineColor: 0xaa7700,
    gridPulseColor: 0xddaa22,
    gridWarpHighlightColor: 0xffdd66,
    ambientOverlayColor: 0x442200,
    ambientOverlayAlpha: 0.07,
    enemyHealthMultiplier: 1.15,
    enemyDamageMultiplier: 1.2,
    xpMultiplier: 1.0,
    goldMultiplier: 1.5,
    unlockRequirement: 'worldLevel:4',
  },
];

export function getStageById(stageId: string): StageDefinition | undefined {
  return STAGES.find((stage) => stage.id === stageId);
}

export function getDefaultStage(): StageDefinition {
  return STAGES[0];
}

/** What the lighting system's ambient darkness should be while this stage is the active
 *  region. Clamped so an authoring mistake can dim a room but never black it out. */
export function resolveStageAmbientDarkness(stage: StageDefinition): number {
  return Math.min(1, BASE_AMBIENT_DARKNESS + Math.max(0, stage.ambientDarknessBoost ?? 0));
}

/** How fast the player's velocity chases its input while this stage is the active region.
 *  Clamped so an authoring mistake can make a region slippery but never immobile, and a
 *  non-finite value falls back to the shipped handling rather than poisoning Velocity. */
export function resolveStageDriftFactor(stage: StageDefinition): number {
  const authored = stage.driftFactor ?? 1;
  if (!Number.isFinite(authored)) return 1;
  return Math.min(1, Math.max(MIN_STAGE_DRIFT_FACTOR, authored));
}
