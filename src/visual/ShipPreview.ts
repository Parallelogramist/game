/**
 * ShipPreview — a menu-side hangar view of a ship: the real in-run
 * PlayerSpaceship graphic (same neon palette, same hull geometry), idling
 * nose-up and CYCLING through its evolution tiers so the player can see the
 * whole Scout→…→apex evolution arc before committing to a ship. A caption
 * under the hull names the tier currently shown.
 *
 * Owned by menu scenes (WeaponSelectScene ship step): call update(delta)
 * from the scene's update loop, setShip() when focus moves between ships,
 * destroy() on teardown/step change.
 */

import Phaser from 'phaser';
import { PlayerSpaceship, getEvolutionTierInfo } from './PlayerSpaceship';
import { SHIP_NEON_PALETTES } from './NeonColors';
import { ShipCharacter } from '../data/ShipCharacters';
import { makeBodyText } from './DisplayText';
import { TEXT_COLORS } from './MenuStyle';

/** Dwell per evolution tier before morphing to the next. */
const TIER_CYCLE_MS = 1700;

export class ShipPreview {
  private scene: Phaser.Scene;
  private readonly x: number;
  private readonly y: number;
  private readonly shipScale: number;
  private spaceship: PlayerSpaceship | null = null;
  private tierLabel: Phaser.GameObjects.Text;
  private tierIndex = 0;
  private cycleTimer = 0;
  private readonly tiers: readonly { name: string; minLevel: number }[];
  private destroyed = false;
  private currentShipId: string | null = null;

  constructor(scene: Phaser.Scene, x: number, y: number, shipScale: number = 1.6) {
    this.scene = scene;
    this.x = x;
    this.y = y;
    this.shipScale = shipScale;
    this.tiers = getEvolutionTierInfo();
    this.tierLabel = makeBodyText(scene, x, y + 58 * (shipScale / 1.6), '', {
      fontSize: 11,
      color: TEXT_COLORS.muted,
    });
    this.tierLabel.setLetterSpacing(2);
    this.tierLabel.setDepth(20);
  }

  /**
   * Swap the previewed ship — rebuilds the hull in the ship's palette.
   * No-op for the already-shown ship so hover/focus churn (which can fire
   * several times per card entry) doesn't rebuild the hull or reset the
   * evolution cycle.
   */
  setShip(ship: ShipCharacter): void {
    if (this.destroyed || this.currentShipId === ship.id) return;
    this.currentShipId = ship.id;
    this.spaceship?.destroy();
    this.tierIndex = 0;
    this.cycleTimer = 0;
    this.spaceship = new PlayerSpaceship(
      this.scene,
      this.x,
      this.y,
      {
        baseRadius: 16,
        neonColor: SHIP_NEON_PALETTES[ship.neonColorId] ?? SHIP_NEON_PALETTES.cyan,
        quality: 'high',
        hullId: ship.hullId,
      },
      this.tiers[0].minLevel,
    );
    const container = this.spaceship.getContainer();
    // The hull is authored nose-+x; menus read better nose-up.
    container.setRotation(-Math.PI / 2);
    container.setScale(this.shipScale);
    container.setDepth(20);
    this.updateTierLabel();
  }

  /** Drive the idle animation + the evolution cycle. Delta in ms. */
  update(delta: number): void {
    if (this.destroyed || !this.spaceship) return;
    this.spaceship.update(0, 0, delta * 0.001);
    this.cycleTimer += delta;
    if (this.cycleTimer >= TIER_CYCLE_MS) {
      this.cycleTimer = 0;
      // Wraps back to tier 0 through the same morph animation — onLevelUp's
      // tier swap is index-agnostic (pendingTierIndex may go down).
      this.tierIndex = (this.tierIndex + 1) % this.tiers.length;
      this.spaceship.onLevelUp(this.tiers[this.tierIndex].minLevel);
      this.updateTierLabel();
    }
  }

  private updateTierLabel(): void {
    // Named from OUR cycle index — the spaceship's own getTierName lags
    // behind while the evolution morph animation is still playing.
    this.tierLabel.setText(this.tiers[this.tierIndex].name.toUpperCase());
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.spaceship?.destroy();
    this.spaceship = null;
    this.tierLabel.destroy();
  }
}
