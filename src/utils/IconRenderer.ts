/**
 * Icon Renderer Utility
 *
 * Provides helper functions for loading and creating icon sprites
 * from the game-icons.net sprite atlas.
 *
 * Icons are from game-icons.net (CC BY 3.0 - Attribution required)
 */

import Phaser from 'phaser';
import { getIconFrame } from './IconMap';

/** The key used for the icon sprite atlas in Phaser's texture manager */
export const ICON_ATLAS_KEY = 'game-icons';

/** Base size of icons in the atlas (pixels) */
const ATLAS_ICON_SIZE = 64;

/**
 * Preload the icon sprite atlas.
 * Call this in your BootScene's preload() method.
 */
export function preloadIcons(scene: Phaser.Scene): void {
  scene.load.atlas(
    ICON_ATLAS_KEY,
    'icons/game-icons.png',
    'icons/game-icons.json'
  );
}

/**
 * Configuration options for creating an icon.
 */
export interface IconConfig {
  /** X position */
  x: number;
  /** Y position */
  y: number;
  /** Semantic icon key (e.g., 'sword', 'heart') or direct frame name */
  iconKey: string;
  /** Target display size in pixels (default: 32) */
  size?: number;
  /** Tint color as hex number (default: no tint / white) */
  tint?: number;
  /** Opacity from 0 to 1 (default: 1) */
  alpha?: number;
  /** Origin point (default: { x: 0.5, y: 0.5 } for center) */
  origin?: { x: number; y: number };
  /** Depth/layer for rendering order */
  depth?: number;
}

/**
 * Create an icon image from the sprite atlas.
 *
 * @example
 * // Create a 48px sword icon at center of screen
 * const icon = createIcon(this, {
 *   x: 640,
 *   y: 360,
 *   iconKey: 'sword',
 *   size: 48,
 *   tint: 0xffcc00, // Gold tint
 * });
 *
 * @param scene - The Phaser scene to add the icon to
 * @param config - Icon configuration options
 * @returns The created Phaser.GameObjects.Image
 */
export function createIcon(
  scene: Phaser.Scene,
  config: IconConfig
): Phaser.GameObjects.Image {
  const {
    x,
    y,
    iconKey,
    size = 32,
    tint,
    alpha = 1,
    origin = { x: 0.5, y: 0.5 },
    depth,
  } = config;

  // Resolve semantic key to frame name
  const frameName = getIconFrame(iconKey);

  // Create the image
  const icon = scene.add.image(x, y, ICON_ATLAS_KEY, frameName);

  // Scale to target size (atlas icons are 64x64)
  const scale = size / ATLAS_ICON_SIZE;
  icon.setScale(scale);

  // Set origin
  icon.setOrigin(origin.x, origin.y);

  // Set alpha
  icon.setAlpha(alpha);

  // Apply tint if specified
  if (tint !== undefined) {
    icon.setTint(tint);
  }

  // Set depth if specified
  if (depth !== undefined) {
    icon.setDepth(depth);
  }

  return icon;
}

/**
 * Update an existing icon's frame.
 * Useful for toggling icons (e.g., mute/unmute).
 *
 * @param icon - The icon image to update
 * @param iconKey - New semantic icon key or frame name
 */
export function setIconFrame(
  icon: Phaser.GameObjects.Image,
  iconKey: string
): void {
  const frameName = getIconFrame(iconKey);
  icon.setFrame(frameName);
}

/**
 * Create an interactive icon button.
 *
 * @param scene - The Phaser scene
 * @param config - Icon configuration
 * @param onClick - Callback when clicked
 * @returns The created icon with interactive behavior
 */
export function createIconButton(
  scene: Phaser.Scene,
  config: IconConfig,
  onClick: () => void
): Phaser.GameObjects.Image {
  const icon = createIcon(scene, config);

  icon.setInteractive({ useHandCursor: true });

  // Hover effects
  icon.on('pointerover', () => {
    icon.setScale(icon.scaleX * 1.15);
  });

  icon.on('pointerout', () => {
    const targetSize = config.size ?? 32;
    const scale = targetSize / ATLAS_ICON_SIZE;
    icon.setScale(scale);
  });

  // Click handler
  icon.on('pointerdown', onClick);

  return icon;
}

/**
 * Create a tooltip for an icon.
 * Shows text when hovering over the icon.
 *
 * @param scene - The Phaser scene
 * @param icon - The icon to attach tooltip to
 * @param text - Tooltip text to display
 * @param offsetY - Vertical offset from icon (default: -30)
 */
export function addIconTooltip(
  scene: Phaser.Scene,
  icon: Phaser.GameObjects.Image,
  text: string,
  offsetY: number = -30
): void {
  const tooltip = scene.add
    .text(icon.x, icon.y + offsetY, text, {
      fontSize: '12px',
      color: '#ffffff',
      backgroundColor: '#333333',
      padding: { x: 6, y: 4 },
    })
    .setOrigin(0.5)
    .setDepth((icon.depth || 0) + 1)
    .setVisible(false);

  icon.setInteractive();

  icon.on('pointerover', () => {
    tooltip.setVisible(true);
    tooltip.setPosition(icon.x, icon.y + offsetY);
  });

  icon.on('pointerout', () => {
    tooltip.setVisible(false);
  });
}

/**
 * Common icon tint colors for consistent styling.
 */
export const ICON_TINTS = {
  /** Default white (no tint) */
  DEFAULT: 0xffffff,
  /** Disabled/locked state */
  DISABLED: 0x666666,
  /** Selected/active state */
  ACTIVE: 0xffcc00,
  /** Weapon upgrade */
  WEAPON: 0xffaa66,
  /** Stat upgrade */
  STAT: 0x88aaff,
  /** Health/defense */
  HEALTH: 0xff6666,
  /** Gold/currency */
  GOLD: 0xffdd44,
  /** Elemental fire */
  FIRE: 0xff6622,
  /** Elemental ice */
  ICE: 0x66ccff,
  /** Elemental lightning */
  LIGHTNING: 0xffff66,
  /** Elemental poison */
  POISON: 0x66ff66,
} as const;
