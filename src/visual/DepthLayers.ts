/**
 * Named depth layer constants for consistent z-ordering across all systems.
 * Higher values render on top.
 *
 * Two bands, two exports:
 *   - `DepthLayers` — world-space gameplay content (grid, trails, entities,
 *     effects, text).
 *   - `OverlayDepths` — screen-space overlays: atmosphere/flash bands that
 *     sit above the field but below UI, then the UI stack itself (HUD,
 *     minimap, tooltips, menus, transitions).
 *
 * Anything that must NEVER be tinted, warped, or occluded by gameplay
 * atmosphere belongs at OverlayDepths.JOYSTICK or above; full-screen
 * gameplay overlays belong in the LIGHTING–SCREEN_FLASH band.
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
} as const;

/**
 * Screen-space overlay depth bands. Single source of truth — modules alias
 * these locally (e.g. `const HUD_DEPTH = OverlayDepths.HUD;`) rather than
 * inventing their own numbers; small `+ n` offsets within a band stay at the
 * call site.
 */
export const OverlayDepths = {
  LIGHTING: 500,          // LightingSystem darkness overlay (atmosphere — never over UI)
  DANGER_VIGNETTE: 850,   // low-HP danger vignette
  SCREEN_FLASH: 950,      // full-screen impact/hit flashes (Juice/Effects managers)
  JOYSTICK: 999,          // virtual joystick — bottom of the UI stack
  TOUCH_BUTTONS: 999,     // touch action buttons — same band as joystick
  HUD: 1000,              // HUD bars/text/pills and toasts
  HUD_OVERLAY: 1100,      // HUD warnings / notifications / coach marks (GameScene)
  MINIMAP: 1895,          // minimap
  OFFSCREEN_ARROWS: 1900, // off-screen enemy indicator arrows
  INTRO_BACKDROP: 1990,   // world-intro overlay backdrop
  INTRO_TEXT: 1991,       // world-intro overlay text/graphics
  TOOLTIP: 2000,          // tooltips
  DEATH_DARKEN: 2050,     // death-sequence darken (dims everything below game-over UI)
  PAUSE_MENU: 2100,       // pause menu / end-of-run overlays (top-most UI)
  DEBUG: 2500,            // dev-only debug overlays
  TRANSITION: 3000,       // scene-transition sweeps/dims — cover every UI layer
} as const;
