/**
 * Stage / Biome definitions.
 *
 * Each stage defines the visual palette (grid colors + ambient tint),
 * gameplay modifiers (spawn multipliers, reward bonuses), and unlock gating.
 *
 * Stages are selectable from BootScene. The default stage is always available;
 * others unlock via HiddenUnlockManager conditions or world level progression.
 */

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

  // Gameplay modifiers
  enemyHealthMultiplier: number;
  enemyDamageMultiplier: number;
  xpMultiplier: number;
  goldMultiplier: number;

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
    description: 'Shimmering crystal grid. +20% XP gain, tougher enemies.',
    gridLineColor: 0x6644aa,
    gridPulseColor: 0x8855cc,
    gridWarpHighlightColor: 0xcc88ff,
    ambientOverlayColor: 0x4422aa,
    ambientOverlayAlpha: 0.06,
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
];

export function getStageById(stageId: string): StageDefinition | undefined {
  return STAGES.find((stage) => stage.id === stageId);
}

export function getDefaultStage(): StageDefinition {
  return STAGES[0];
}
