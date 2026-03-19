/**
 * Named depth layer constants for consistent z-ordering across all systems.
 * Higher values render on top.
 */
export const DepthLayers = {
  GRID_BACKGROUND: 0,
  GROUND_EFFECTS: 1,
  AURA: 1,
  GROUND_SPIKE_WARNING: 2,
  ORBIT_RING: 3,
  FROST_INDICATOR: 3,
  TRAIL: 4,
  BLADE: 5,
  BLADE_HIT: 6,
  FROST_NOVA_RING: 8,
  FROST_NOVA_CRYSTAL: 9,
  PROJECTILES: 10,
  SLASH: 10,
  GROUND_SPIKE_DEBRIS: 10,
  SHATTER: 10,
  FINISHING_BLOW: 11,
  LASER: 13,
  METEOR: 20,
  UI_OVERLAY: 100,
  TRANSITION: 1000,
} as const;
