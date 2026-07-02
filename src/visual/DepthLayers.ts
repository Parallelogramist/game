/**
 * Named depth layer constants for consistent z-ordering across all systems.
 * Higher values render on top.
 *
 * ── Full-screen depth bands (all systems must respect these) ─────────────
 *   0–151      world-space gameplay (grid, trails, entities, effects, text)
 *   500        LightingSystem darkness overlay (atmosphere — never over UI)
 *   850        low-HP danger vignette
 *   950        full-screen impact/hit flashes (Juice/Effects managers)
 *   999–1000   joystick, touch buttons, HUD, toasts
 *   1040–1100  HUD warnings / notifications / coach marks (GameScene)
 *   1895–1900  minimap, off-screen enemy arrows
 *   1990–1991  intro overlay backdrop + text
 *   2000       tooltips
 *   2050       death-sequence darken (dims everything below game-over UI)
 *   2100+      pause menu / end-of-run overlays (top-most UI)
 *   2500       dev-only debug overlays
 *
 * Anything that must NEVER be tinted, warped, or occluded by gameplay
 * atmosphere belongs at 999 or above; full-screen gameplay overlays belong
 * in the 500–950 band.
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
  ATTACK_TELEGRAPH: 7,
  FROST_NOVA_RING: 8,
  FROST_NOVA_CRYSTAL: 9,
  PROJECTILES: 10,
  SLASH: 10,
  GROUND_SPIKE_DEBRIS: 10,
  SHATTER: 10,
  FINISHING_BLOW: 11,
  LASER: 13,
  METEOR: 20,
  IMPACT_CALLOUTS: 85,
  UI_OVERLAY: 100,
  TRANSITION: 1000,
} as const;
