/**
 * PlayerSpaceship - Tron-style procedurally-drawn neon spaceship that evolves as the player levels up
 *
 * Features:
 * - 5 evolution tiers: Scout → Fighter → Striker → Warbird → Apex
 * - Dark hull defined by bright neon edge lines (Tron: Legacy aesthetic)
 * - Circuit trace patterns increase in density per tier
 * - Energy channels with animated light pulse (tier 3+)
 * - Hexagonal cockpit with internal crosshairs (tier 3+)
 * - Multi-layer neon glow with edge bloom, quality-scaled
 * - Animated engine thrust (blue/cyan/white palette)
 * - Combo tier color shifts, low-HP danger red, invulnerability blink
 * - Level-up flash + scale pulse, evolution animation
 * - Energy pods (tier 4+) and energy corona (tier 5)
 */

import Phaser from 'phaser';
import { NeonColorPair, lightenColor, darkenColor, getGlowAlphas, getGlowRadiusMultipliers } from './NeonColors';
import { VisualQuality } from './GlowGraphics';

export interface SpaceshipConfig {
  baseRadius: number;
  neonColor: NeonColorPair;
  quality: VisualQuality;
}

export interface EvolutionResult {
  evolved: boolean;
  tierName: string;
}

// --- Geometry types ---

interface Point2D {
  x: number;
  y: number;
}

interface CircuitTrace {
  path: Point2D[];
  width: number;
  alpha: number;
}

interface EnergyChannel {
  path: Point2D[];
  width: number;
  baseAlpha: number;
}

interface WingEdgeSegment {
  from: Point2D;
  to: Point2D;
}

// --- Evolution tier definition ---

interface EvolutionTier {
  name: string;
  minLevel: number;
  hullOutline: Point2D[];
  cockpit: Point2D[];
  cockpitHasCrosshairs: boolean;
  engineNozzles: Point2D[];
  engineNozzleRadius: number;
  wingTipAccents: Point2D[];
  wingTipAccentRadius: number;
  energyPods: Point2D[];
  energyPodRadius: number;
  circuitTraces: CircuitTrace[];
  energyChannels: EnergyChannel[];
  wingEdgeSegments: WingEdgeSegment[];
  hasEnergyPulse: boolean;
  hasEnergyCorona: boolean;
  coronaScale: number;
  coronaAlphaBase: number;
}

// --- Evolution Tier Data ---

const EVOLUTION_TIERS: EvolutionTier[] = [
  // --- Tier 1: Scout (Levels 1-4) ---
  // Clean angular arrowhead with faceted nose and split tail
  {
    name: 'Scout',
    minLevel: 1,
    hullOutline: [
      { x: 22, y: 0 },
      { x: 14, y: -3 },
      { x: 6, y: -5 },
      { x: -2, y: -5.5 },
      { x: -14, y: -11 },
      { x: -10, y: -7.5 },
      { x: -7, y: -4 },
      { x: -10, y: -1.5 },
      { x: -12, y: 0 },
      { x: -10, y: 1.5 },
      { x: -7, y: 4 },
      { x: -10, y: 7.5 },
      { x: -14, y: 11 },
      { x: -2, y: 5.5 },
      { x: 6, y: 5 },
      { x: 14, y: 3 },
    ],
    cockpit: [
      { x: 12, y: 0 },
      { x: 7, y: -2 },
      { x: 2, y: -2 },
      { x: -1, y: 0 },
      { x: 2, y: 2 },
      { x: 7, y: 2 },
    ],
    cockpitHasCrosshairs: false,
    engineNozzles: [{ x: -9, y: 0 }],
    engineNozzleRadius: 2.0,
    wingTipAccents: [],
    wingTipAccentRadius: 0,
    energyPods: [],
    energyPodRadius: 0,
    circuitTraces: [
      { path: [{ x: 2, y: -3 }, { x: -4, y: -3 }, { x: -7, y: -5.5 }], width: 0.6, alpha: 0.3 },
      { path: [{ x: 2, y: 3 }, { x: -4, y: 3 }, { x: -7, y: 5.5 }], width: 0.6, alpha: 0.3 },
    ],
    energyChannels: [
      { path: [{ x: 8, y: 0 }, { x: -7, y: 0 }], width: 1.2, baseAlpha: 0.5 },
    ],
    wingEdgeSegments: [],
    hasEnergyPulse: false,
    hasEnergyCorona: false,
    coronaScale: 1,
    coronaAlphaBase: 0,
  },

  // --- Tier 2: Fighter (Levels 5-9) ---
  // Wider wings with angular intake scoops, dual engines
  {
    name: 'Fighter',
    minLevel: 5,
    hullOutline: [
      { x: 26, y: 0 },
      { x: 16, y: -4 },
      { x: 8, y: -5 },
      { x: 3, y: -6 },
      { x: -3, y: -6.5 },
      { x: -8, y: -13 },
      { x: -18, y: -16 },
      { x: -14, y: -11 },
      { x: -9, y: -5 },
      { x: -12, y: -2 },
      { x: -14, y: 0 },
      { x: -12, y: 2 },
      { x: -9, y: 5 },
      { x: -14, y: 11 },
      { x: -18, y: 16 },
      { x: -8, y: 13 },
      { x: -3, y: 6.5 },
      { x: 3, y: 6 },
      { x: 8, y: 5 },
      { x: 16, y: 4 },
    ],
    cockpit: [
      { x: 14, y: 0 },
      { x: 9, y: -2.5 },
      { x: 3, y: -2.5 },
      { x: 0, y: 0 },
      { x: 3, y: 2.5 },
      { x: 9, y: 2.5 },
    ],
    cockpitHasCrosshairs: false,
    engineNozzles: [
      { x: -11, y: -5 },
      { x: -11, y: 5 },
    ],
    engineNozzleRadius: 2.2,
    wingTipAccents: [
      { x: -18, y: -16 },
      { x: -18, y: 16 },
    ],
    wingTipAccentRadius: 1.0,
    energyPods: [],
    energyPodRadius: 0,
    circuitTraces: [
      { path: [{ x: 3, y: -4.5 }, { x: -3, y: -4.5 }, { x: -6, y: -9 }], width: 0.6, alpha: 0.3 },
      { path: [{ x: 3, y: 4.5 }, { x: -3, y: 4.5 }, { x: -6, y: 9 }], width: 0.6, alpha: 0.3 },
      { path: [{ x: 7, y: -3.5 }, { x: 5, y: -5 }], width: 0.5, alpha: 0.25 },
      { path: [{ x: 7, y: 3.5 }, { x: 5, y: 5 }], width: 0.5, alpha: 0.25 },
    ],
    energyChannels: [
      { path: [{ x: 10, y: 0 }, { x: 0, y: 0 }, { x: -8, y: -5 }], width: 1.2, baseAlpha: 0.5 },
      { path: [{ x: 10, y: 0 }, { x: 0, y: 0 }, { x: -8, y: 5 }], width: 1.2, baseAlpha: 0.5 },
    ],
    wingEdgeSegments: [
      { from: { x: 0, y: -6 }, to: { x: -6, y: -11 } },
      { from: { x: 0, y: 6 }, to: { x: -6, y: 11 } },
    ],
    hasEnergyPulse: false,
    hasEnergyCorona: false,
    coronaScale: 1,
    coronaAlphaBase: 0,
  },

  // --- Tier 3: Striker (Levels 10-19) ---
  // Forward-swept razor wings, needle nose, triple engines
  {
    name: 'Striker',
    minLevel: 10,
    hullOutline: [
      { x: 28, y: 0 },
      { x: 18, y: -4 },
      { x: 10, y: -5 },
      { x: 5, y: -6.5 },
      { x: 0, y: -7 },
      { x: -5, y: -7.5 },
      { x: -3, y: -13 },
      { x: -10, y: -17 },
      { x: -20, y: -20 },
      { x: -16, y: -14 },
      { x: -14, y: -11 },
      { x: -10, y: -6 },
      { x: -14, y: -2.5 },
      { x: -16, y: 0 },
      { x: -14, y: 2.5 },
      { x: -10, y: 6 },
      { x: -14, y: 11 },
      { x: -16, y: 14 },
      { x: -20, y: 20 },
      { x: -10, y: 17 },
      { x: -3, y: 13 },
      { x: -5, y: 7.5 },
      { x: 0, y: 7 },
      { x: 5, y: 6.5 },
      { x: 10, y: 5 },
      { x: 18, y: 4 },
    ],
    cockpit: [
      { x: 16, y: 0 },
      { x: 10, y: -3 },
      { x: 3, y: -3 },
      { x: -1, y: 0 },
      { x: 3, y: 3 },
      { x: 10, y: 3 },
    ],
    cockpitHasCrosshairs: true,
    engineNozzles: [
      { x: -13, y: 0 },
      { x: -14, y: 6 },
      { x: -14, y: -6 },
    ],
    engineNozzleRadius: 2.5,
    wingTipAccents: [
      { x: -20, y: -20 },
      { x: -20, y: 20 },
    ],
    wingTipAccentRadius: 1.5,
    energyPods: [],
    energyPodRadius: 0,
    circuitTraces: [
      { path: [{ x: 4, y: -5 }, { x: -2, y: -5 }, { x: -2, y: -10 }, { x: -8, y: -10 }], width: 0.6, alpha: 0.35 },
      { path: [{ x: 4, y: 5 }, { x: -2, y: 5 }, { x: -2, y: 10 }, { x: -8, y: 10 }], width: 0.6, alpha: 0.35 },
      { path: [{ x: 8, y: -4 }, { x: 3, y: -5.5 }], width: 0.5, alpha: 0.3 },
      { path: [{ x: 8, y: 4 }, { x: 3, y: 5.5 }], width: 0.5, alpha: 0.3 },
      { path: [{ x: -6, y: -8 }, { x: -12, y: -13 }], width: 0.5, alpha: 0.25 },
      { path: [{ x: -6, y: 8 }, { x: -12, y: 13 }], width: 0.5, alpha: 0.25 },
    ],
    energyChannels: [
      { path: [{ x: 12, y: 0 }, { x: -2, y: 0 }, { x: -11, y: 0 }], width: 1.3, baseAlpha: 0.55 },
      { path: [{ x: 4, y: -4 }, { x: -4, y: -5.5 }, { x: -12, y: -6 }], width: 1.0, baseAlpha: 0.45 },
      { path: [{ x: 4, y: 4 }, { x: -4, y: 5.5 }, { x: -12, y: 6 }], width: 1.0, baseAlpha: 0.45 },
    ],
    wingEdgeSegments: [
      { from: { x: -1, y: -7.5 }, to: { x: -3, y: -11 } },
      { from: { x: -5, y: -13 }, to: { x: -10, y: -16.5 } },
      { from: { x: -1, y: 7.5 }, to: { x: -3, y: 11 } },
      { from: { x: -5, y: 13 }, to: { x: -10, y: 16.5 } },
    ],
    hasEnergyPulse: true,
    hasEnergyCorona: false,
    coronaScale: 1,
    coronaAlphaBase: 0,
  },

  // --- Tier 4: Warbird (Levels 20-34) ---
  // Double-faceted wings, deep angular intakes, energy pods
  {
    name: 'Warbird',
    minLevel: 20,
    hullOutline: [
      { x: 30, y: 0 },
      { x: 20, y: -5 },
      { x: 12, y: -5.5 },
      { x: 6, y: -7 },
      { x: 1, y: -7.5 },
      { x: -4, y: -8 },
      { x: -2, y: -14 },
      { x: -8, y: -18 },
      { x: -14, y: -21 },
      { x: -22, y: -24 },
      { x: -18, y: -17 },
      { x: -16, y: -13 },
      { x: -12, y: -7 },
      { x: -16, y: -3 },
      { x: -18, y: 0 },
      { x: -16, y: 3 },
      { x: -12, y: 7 },
      { x: -16, y: 13 },
      { x: -18, y: 17 },
      { x: -22, y: 24 },
      { x: -14, y: 21 },
      { x: -8, y: 18 },
      { x: -2, y: 14 },
      { x: -4, y: 8 },
      { x: 1, y: 7.5 },
      { x: 6, y: 7 },
      { x: 12, y: 5.5 },
      { x: 20, y: 5 },
    ],
    cockpit: [
      { x: 18, y: 0 },
      { x: 12, y: -3.5 },
      { x: 4, y: -3.5 },
      { x: -1, y: 0 },
      { x: 4, y: 3.5 },
      { x: 12, y: 3.5 },
    ],
    cockpitHasCrosshairs: true,
    engineNozzles: [
      { x: -15, y: 0 },
      { x: -16, y: 7 },
      { x: -16, y: -7 },
    ],
    engineNozzleRadius: 3.0,
    wingTipAccents: [
      { x: -22, y: -24 },
      { x: -22, y: 24 },
    ],
    wingTipAccentRadius: 2.0,
    energyPods: [
      { x: -6, y: -15 },
      { x: -6, y: 15 },
    ],
    energyPodRadius: 2.0,
    circuitTraces: [
      { path: [{ x: 4, y: -5.5 }, { x: -2, y: -5.5 }, { x: -2, y: -11 }, { x: -8, y: -11 }], width: 0.6, alpha: 0.35 },
      { path: [{ x: 4, y: 5.5 }, { x: -2, y: 5.5 }, { x: -2, y: 11 }, { x: -8, y: 11 }], width: 0.6, alpha: 0.35 },
      { path: [{ x: -4, y: -8 }, { x: -5, y: -11.5 }, { x: -6, y: -15 }], width: 0.7, alpha: 0.4 },
      { path: [{ x: -4, y: 8 }, { x: -5, y: 11.5 }, { x: -6, y: 15 }], width: 0.7, alpha: 0.4 },
      { path: [{ x: 10, y: -4 }, { x: 4, y: -6 }], width: 0.5, alpha: 0.3 },
      { path: [{ x: 10, y: 4 }, { x: 4, y: 6 }], width: 0.5, alpha: 0.3 },
      { path: [{ x: -6, y: -10 }, { x: -12, y: -15 }], width: 0.5, alpha: 0.25 },
      { path: [{ x: -6, y: 10 }, { x: -12, y: 15 }], width: 0.5, alpha: 0.25 },
      { path: [{ x: 8, y: -2 }, { x: -4, y: -2 }], width: 0.4, alpha: 0.2 },
      { path: [{ x: 8, y: 2 }, { x: -4, y: 2 }], width: 0.4, alpha: 0.2 },
    ],
    energyChannels: [
      { path: [{ x: 14, y: 0 }, { x: -4, y: 0 }, { x: -13, y: 0 }], width: 1.4, baseAlpha: 0.55 },
      { path: [{ x: 6, y: -5 }, { x: -2, y: -6.5 }, { x: -14, y: -7 }], width: 1.1, baseAlpha: 0.45 },
      { path: [{ x: 6, y: 5 }, { x: -2, y: 6.5 }, { x: -14, y: 7 }], width: 1.1, baseAlpha: 0.45 },
    ],
    wingEdgeSegments: [
      { from: { x: 0, y: -8 }, to: { x: -2, y: -12 } },
      { from: { x: -4, y: -14.5 }, to: { x: -8, y: -17.5 } },
      { from: { x: -10, y: -19 }, to: { x: -16, y: -22 } },
      { from: { x: 0, y: 8 }, to: { x: -2, y: 12 } },
      { from: { x: -4, y: 14.5 }, to: { x: -8, y: 17.5 } },
      { from: { x: -10, y: 19 }, to: { x: -16, y: 22 } },
    ],
    hasEnergyPulse: true,
    hasEnergyCorona: false,
    coronaScale: 1,
    coronaAlphaBase: 0,
  },

  // --- Tier 5: Apex (Levels 35+) ---
  // Maximum complexity: blade extensions in hull, 5 engines, energy corona
  {
    name: 'Apex',
    minLevel: 35,
    hullOutline: [
      { x: 32, y: 0 },
      { x: 22, y: -5.5 },
      { x: 14, y: -6 },
      { x: 8, y: -7.5 },
      { x: 2, y: -8 },
      { x: -4, y: -8.5 },
      { x: -1, y: -15 },
      { x: -8, y: -19 },
      { x: -14, y: -22 },
      { x: -22, y: -25 },
      { x: -27, y: -28 },
      { x: -24, y: -24 },
      { x: -20, y: -18 },
      { x: -16, y: -14 },
      { x: -14, y: -8 },
      { x: -18, y: -3 },
      { x: -20, y: 0 },
      { x: -18, y: 3 },
      { x: -14, y: 8 },
      { x: -16, y: 14 },
      { x: -20, y: 18 },
      { x: -24, y: 24 },
      { x: -27, y: 28 },
      { x: -22, y: 25 },
      { x: -14, y: 22 },
      { x: -8, y: 19 },
      { x: -1, y: 15 },
      { x: -4, y: 8.5 },
      { x: 2, y: 8 },
      { x: 8, y: 7.5 },
      { x: 14, y: 6 },
      { x: 22, y: 5.5 },
    ],
    cockpit: [
      { x: 20, y: 0 },
      { x: 13, y: -4 },
      { x: 4, y: -4 },
      { x: -2, y: 0 },
      { x: 4, y: 4 },
      { x: 13, y: 4 },
    ],
    cockpitHasCrosshairs: true,
    engineNozzles: [
      { x: -17, y: 0 },
      { x: -18, y: 7 },
      { x: -18, y: -7 },
      { x: -16, y: 3 },
      { x: -16, y: -3 },
    ],
    engineNozzleRadius: 3.0,
    wingTipAccents: [
      { x: -27, y: -28 },
      { x: -27, y: 28 },
    ],
    wingTipAccentRadius: 2.5,
    energyPods: [
      { x: -8, y: -17 },
      { x: -8, y: 17 },
    ],
    energyPodRadius: 2.5,
    circuitTraces: [
      // Wing circuit grid
      { path: [{ x: 6, y: -6 }, { x: 0, y: -6 }, { x: 0, y: -12 }, { x: -6, y: -12 }], width: 0.6, alpha: 0.35 },
      { path: [{ x: 6, y: 6 }, { x: 0, y: 6 }, { x: 0, y: 12 }, { x: -6, y: 12 }], width: 0.6, alpha: 0.35 },
      // Pod connections
      { path: [{ x: -4, y: -8.5 }, { x: -6, y: -12.5 }, { x: -8, y: -17 }], width: 0.7, alpha: 0.4 },
      { path: [{ x: -4, y: 8.5 }, { x: -6, y: 12.5 }, { x: -8, y: 17 }], width: 0.7, alpha: 0.4 },
      // Blade extension traces
      { path: [{ x: -20, y: -19 }, { x: -24, y: -24 }, { x: -27, y: -28 }], width: 0.8, alpha: 0.5 },
      { path: [{ x: -20, y: 19 }, { x: -24, y: 24 }, { x: -27, y: 28 }], width: 0.8, alpha: 0.5 },
      // Intake traces
      { path: [{ x: 12, y: -5 }, { x: 6, y: -6.5 }], width: 0.5, alpha: 0.3 },
      { path: [{ x: 12, y: 5 }, { x: 6, y: 6.5 }], width: 0.5, alpha: 0.3 },
      // Cross-links
      { path: [{ x: -6, y: -8 }, { x: -6, y: -12 }], width: 0.5, alpha: 0.25 },
      { path: [{ x: -6, y: 8 }, { x: -6, y: 12 }], width: 0.5, alpha: 0.25 },
      // Double fuselage parallels
      { path: [{ x: 10, y: -2.5 }, { x: -6, y: -2.5 }], width: 0.4, alpha: 0.2 },
      { path: [{ x: 10, y: 2.5 }, { x: -6, y: 2.5 }], width: 0.4, alpha: 0.2 },
    ],
    energyChannels: [
      { path: [{ x: 16, y: 0 }, { x: -6, y: 0 }, { x: -15, y: 0 }], width: 1.5, baseAlpha: 0.6 },
      { path: [{ x: 8, y: -6 }, { x: -2, y: -7 }, { x: -16, y: -7 }], width: 1.2, baseAlpha: 0.5 },
      { path: [{ x: 8, y: 6 }, { x: -2, y: 7 }, { x: -16, y: 7 }], width: 1.2, baseAlpha: 0.5 },
      { path: [{ x: 4, y: -3 }, { x: -6, y: -3 }, { x: -14, y: -3 }], width: 0.9, baseAlpha: 0.4 },
      { path: [{ x: 4, y: 3 }, { x: -6, y: 3 }, { x: -14, y: 3 }], width: 0.9, baseAlpha: 0.4 },
    ],
    wingEdgeSegments: [
      { from: { x: 0, y: -8.5 }, to: { x: -1, y: -13 } },
      { from: { x: -3, y: -15.5 }, to: { x: -8, y: -18.5 } },
      { from: { x: -10, y: -20 }, to: { x: -16, y: -23 } },
      { from: { x: -19, y: -24 }, to: { x: -24, y: -26 } },
      { from: { x: 0, y: 8.5 }, to: { x: -1, y: 13 } },
      { from: { x: -3, y: 15.5 }, to: { x: -8, y: 18.5 } },
      { from: { x: -10, y: 20 }, to: { x: -16, y: 23 } },
      { from: { x: -19, y: 24 }, to: { x: -24, y: 26 } },
    ],
    hasEnergyPulse: true,
    hasEnergyCorona: true,
    coronaScale: 1.6,
    coronaAlphaBase: 0.06,
  },
];

function getTierForLevel(level: number): number {
  for (let i = EVOLUTION_TIERS.length - 1; i >= 0; i--) {
    if (level >= EVOLUTION_TIERS[i].minLevel) return i;
  }
  return 0;
}

export class PlayerSpaceship {
  private scene: Phaser.Scene;
  private container: Phaser.GameObjects.Container;
  private config: SpaceshipConfig;

  // Animated layers (in container, redrawn every frame)
  private thrustGraphics: Phaser.GameObjects.Graphics;
  private overlayGraphics: Phaser.GameObjects.Graphics;

  // Static drawing surfaces (offscreen, used to compose into cached RT)
  private glowGraphics: Phaser.GameObjects.Graphics;
  private hullGraphics: Phaser.GameObjects.Graphics;
  private detailGraphics: Phaser.GameObjects.Graphics;

  // GPU-cached composite of hull + glow + details (replaces 3 live Graphics in render pipeline)
  private cachedStaticImage: Phaser.GameObjects.Image;
  private cachedStaticTextureKey: string;
  private static readonly CACHE_SIZE = 200;  // Encompasses largest tier + corona + glow

  // Evolution state
  private currentTierIndex: number = 0;
  private pendingTierIndex: number = -1;
  private evolutionAnimTimer: number = 0;
  private isEvolving: boolean = false;
  private energyPodPulsePhase: number = 0;
  private coronaPulsePhase: number = 0;

  // Rotation state
  private currentAngle: number = 0;
  private targetAngle: number = 0;
  private hasInitialDirection: boolean = false;

  // Movement state
  private smoothedSpeed: number = 0;
  private movementBlend: number = 0;
  private globalTime: number = 0;

  // Thrust flame animation
  private thrustFlickerPhase1: number = Math.random() * Math.PI * 2;
  private thrustFlickerPhase2: number = Math.random() * Math.PI * 2;
  private thrustFlickerPhase3: number = Math.random() * Math.PI * 2;

  // Energy pulse animation
  private energyPulsePhase: number = 0;

  // Color state
  private dangerLevel: number = 0;
  private comboBlend: number = 0;
  private comboColor: number = 0xffffff;

  // Invulnerability
  private isInvulnerable: boolean = false;
  private invulnerabilityFlickerPhase: number = 0;

  // Level-up flash
  private levelUpFlashTimer: number = 0;
  private flashDuration: number = PlayerSpaceship.FLASH_DURATION;

  // Ship scale (base 1.0, pulses on level-up)
  private shipScale: number = 1.0;
  private targetShipScale: number = 1.0;

  // Cached computed hull color
  private lastHullColor: number = 0;
  private hullDirty: boolean = true;

  // --- Constants ---
  private static readonly MAX_SPEED = 300;
  private static readonly ROTATION_SPEED = 14.0;
  private static readonly MOVEMENT_SPEED_THRESHOLD = 10;
  private static readonly MOVEMENT_BLEND_UP = 5.0;
  private static readonly MOVEMENT_BLEND_DOWN = 2.5;

  // Thrust animation
  private static readonly THRUST_MIN_LENGTH = 5;
  private static readonly THRUST_MAX_LENGTH = 32;
  private static readonly THRUST_FLICKER_SPEED_1 = 20.0;
  private static readonly THRUST_FLICKER_SPEED_2 = 31.0;
  private static readonly THRUST_FLICKER_SPEED_3 = 13.5;
  private static readonly THRUST_WIDTH = 3.5;

  // Level-up flash
  private static readonly FLASH_DURATION = 0.35;
  private static readonly SCALE_PULSE_AMOUNT = 0.2;

  // Evolution animation
  private static readonly EVOLUTION_ANIM_DURATION = 0.6;
  private static readonly EVOLUTION_SWAP_TIME = 0.3;
  private static readonly EVOLUTION_SCALE_PULSE = 0.35;
  private static readonly EVOLUTION_FLASH_DURATION = 0.6;

  // Danger color
  private static readonly DANGER_COLOR = 0xff4444;

  // Combo tier colors and blend intensities
  private static readonly COMBO_TIER_COLORS: Record<string, number> = {
    none: 0xffffff,
    warm: 0xffdd44,
    hot: 0xffaa00,
    blazing: 0xff6622,
    inferno: 0xff2244,
  };
  private static readonly COMBO_TIER_BLEND: Record<string, number> = {
    none: 0, warm: 0.08, hot: 0.15, blazing: 0.25, inferno: 0.4,
  };

  // Speed warmth
  private static readonly SPEED_WARMTH_COLOR = 0xffeedd;
  private static readonly SPEED_WARMTH_AMOUNT = 0.08;

  // Idle hover
  private static readonly HOVER_AMPLITUDE = 0.8;
  private static readonly HOVER_SPEED = 2.5;

  // Energy pulse
  private static readonly ENERGY_PULSE_SPEED = 0.8;

  constructor(scene: Phaser.Scene, x: number, y: number, config: SpaceshipConfig, startingLevel: number = 1) {
    this.scene = scene;
    this.config = { ...config };
    this.container = scene.add.container(x, y);
    this.container.setDepth(10);

    // Set initial evolution tier based on starting level (handles save restoration)
    this.currentTierIndex = getTierForLevel(startingLevel);

    // Animated layers (added to container, redrawn every frame)
    this.thrustGraphics = scene.add.graphics();
    this.overlayGraphics = scene.add.graphics();

    // Static drawing surfaces (offscreen, NOT in container — used to compose cached texture)
    this.glowGraphics = scene.add.graphics();
    this.hullGraphics = scene.add.graphics();
    this.detailGraphics = scene.add.graphics();
    this.glowGraphics.setVisible(false);
    this.hullGraphics.setVisible(false);
    this.detailGraphics.setVisible(false);

    // GPU-cached composite image replaces 3 Graphics in the render pipeline
    this.cachedStaticTextureKey = `player_ship_${Date.now()}`;
    this.cachedStaticImage = scene.add.image(0, 0, '__DEFAULT');
    this.cachedStaticImage.setVisible(false); // Hidden until first cache build

    // Container draw order: thrust (back) → cached hull/glow/details → overlay (front)
    this.container.add(this.thrustGraphics);
    this.container.add(this.cachedStaticImage);
    this.container.add(this.overlayGraphics);

    this.lastHullColor = config.neonColor.core;

    // Initial draw + cache to RenderTexture
    this.rebuildStaticCache();
  }

  private get tier(): EvolutionTier {
    return EVOLUTION_TIERS[this.currentTierIndex];
  }

  /**
   * Main update - called every frame with player velocity
   */
  public update(velocityX: number, velocityY: number, deltaSeconds: number): void {
    const dt = Math.min(deltaSeconds, 0.05);
    this.globalTime += dt;

    // --- Speed tracking (frame-rate independent exponential decay) ---
    const currentSpeed = Math.sqrt(velocityX * velocityX + velocityY * velocityY);
    const smoothFactor = 1 - Math.exp(-10 * dt);
    this.smoothedSpeed = Phaser.Math.Linear(this.smoothedSpeed, currentSpeed, smoothFactor);
    const normalizedSpeed = Math.min(this.smoothedSpeed / PlayerSpaceship.MAX_SPEED, 1);

    // --- Movement blend (asymmetric ramp) ---
    const targetMovementBlend = currentSpeed > PlayerSpaceship.MOVEMENT_SPEED_THRESHOLD ? 1 : 0;
    if (targetMovementBlend > this.movementBlend) {
      this.movementBlend = Math.min(1, this.movementBlend + dt * PlayerSpaceship.MOVEMENT_BLEND_UP);
    } else {
      this.movementBlend = Math.max(0, this.movementBlend - dt * PlayerSpaceship.MOVEMENT_BLEND_DOWN);
    }

    // --- Rotation toward movement direction ---
    if (currentSpeed > PlayerSpaceship.MOVEMENT_SPEED_THRESHOLD) {
      this.targetAngle = Math.atan2(velocityY, velocityX);
      this.hasInitialDirection = true;
    }

    if (this.hasInitialDirection) {
      let angleDiff = this.targetAngle - this.currentAngle;
      while (angleDiff > Math.PI) angleDiff -= Math.PI * 2;
      while (angleDiff < -Math.PI) angleDiff += Math.PI * 2;

      const rotationFactor = 1 - Math.exp(-PlayerSpaceship.ROTATION_SPEED * dt);
      this.currentAngle += angleDiff * rotationFactor;

      while (this.currentAngle > Math.PI) this.currentAngle -= Math.PI * 2;
      while (this.currentAngle < -Math.PI) this.currentAngle += Math.PI * 2;
    }

    // --- Evolution animation ---
    if (this.isEvolving) {
      this.evolutionAnimTimer -= dt;
      const remaining = this.evolutionAnimTimer;
      const elapsed = PlayerSpaceship.EVOLUTION_ANIM_DURATION - remaining;

      // At the midpoint, swap to new tier
      if (elapsed >= PlayerSpaceship.EVOLUTION_SWAP_TIME && this.pendingTierIndex >= 0) {
        this.currentTierIndex = this.pendingTierIndex;
        this.pendingTierIndex = -1;
        this.hullDirty = true;
      }

      // End of animation
      if (remaining <= 0) {
        this.isEvolving = false;
        this.evolutionAnimTimer = 0;
      }
    }

    // --- Level-up flash decay ---
    if (this.levelUpFlashTimer > 0) {
      this.levelUpFlashTimer = Math.max(0, this.levelUpFlashTimer - dt);
      this.hullDirty = true;
    }

    // --- Scale pulse recovery ---
    if (this.shipScale !== this.targetShipScale) {
      this.shipScale = Phaser.Math.Linear(this.shipScale, this.targetShipScale, dt * 6);
      if (Math.abs(this.shipScale - this.targetShipScale) < 0.001) {
        this.shipScale = this.targetShipScale;
      }
    }

    // --- Thrust flicker ---
    this.thrustFlickerPhase1 += dt * PlayerSpaceship.THRUST_FLICKER_SPEED_1;
    this.thrustFlickerPhase2 += dt * PlayerSpaceship.THRUST_FLICKER_SPEED_2;
    this.thrustFlickerPhase3 += dt * PlayerSpaceship.THRUST_FLICKER_SPEED_3;

    // --- Energy pod, corona, and pulse animation ---
    this.energyPodPulsePhase += dt * 3.0;
    this.coronaPulsePhase += dt * 1.5;
    this.energyPulsePhase = (this.energyPulsePhase + dt * PlayerSpaceship.ENERGY_PULSE_SPEED) % 1.0;

    // --- Invulnerability flicker ---
    if (this.isInvulnerable) {
      this.invulnerabilityFlickerPhase += dt * 10;
      const flickerAlpha = Math.sin(this.invulnerabilityFlickerPhase * Math.PI * 2) > 0 ? 1.0 : 0.3;
      this.container.setAlpha(flickerAlpha);
    }

    // --- Compute hull color (threshold to avoid constant cache rebuilds) ---
    const hullColor = this.computeHullColor(normalizedSpeed);
    if (this.hullDirty || (hullColor !== this.lastHullColor && this.colorDistanceExceedsThreshold(hullColor, this.lastHullColor))) {
      this.lastHullColor = hullColor;
      this.hullDirty = false;
      this.rebuildStaticCache();
    }

    // --- Idle hover bob ---
    const hoverOffset = this.movementBlend < 0.5
      ? Math.sin(this.globalTime * PlayerSpaceship.HOVER_SPEED) * PlayerSpaceship.HOVER_AMPLITUDE * (1 - this.movementBlend * 2)
      : 0;

    // --- Apply rotation and scale to container children ---
    const scale = this.shipScale;
    const rotation = this.currentAngle;

    this.cachedStaticImage.setRotation(rotation);
    this.cachedStaticImage.setScale(scale);
    this.cachedStaticImage.setY(hoverOffset);
    this.thrustGraphics.setRotation(rotation);
    this.thrustGraphics.setScale(scale);
    this.thrustGraphics.setY(hoverOffset);
    this.overlayGraphics.setRotation(rotation);
    this.overlayGraphics.setScale(scale);
    this.overlayGraphics.setY(hoverOffset);

    // --- Redraw per-frame animated layers ---
    this.drawThrust(normalizedSpeed);
    this.drawOverlay();
  }

  /**
   * Compute the current hull color accounting for base color, combo, danger, warmth, and flash
   */
  private computeHullColor(normalizedSpeed: number): number {
    let color = this.config.neonColor.core;

    // Speed warmth shift
    if (normalizedSpeed > 0.1) {
      color = this.lerpColor(color, PlayerSpaceship.SPEED_WARMTH_COLOR,
        normalizedSpeed * PlayerSpaceship.SPEED_WARMTH_AMOUNT);
    }

    // Combo color shift
    if (this.comboBlend > 0) {
      color = this.lerpColor(color, this.comboColor, this.comboBlend);
    }

    // Danger color shift
    if (this.dangerLevel > 0) {
      color = this.lerpColor(color, PlayerSpaceship.DANGER_COLOR, this.dangerLevel * 0.5);
    }

    // Level-up / evolution flash (white overlay)
    if (this.levelUpFlashTimer > 0) {
      const flashProgress = this.levelUpFlashTimer / this.flashDuration;
      color = this.lerpColor(color, 0xffffff, flashProgress * 0.7);
    }

    return color;
  }

  /**
   * Check if two colors differ by more than a threshold per channel.
   * Avoids constant cache rebuilds from tiny speed-warmth blending changes.
   */
  private colorDistanceExceedsThreshold(colorA: number, colorB: number): boolean {
    const threshold = 6; // per-channel difference threshold (out of 255)
    const rA = (colorA >> 16) & 0xff, rB = (colorB >> 16) & 0xff;
    if (Math.abs(rA - rB) > threshold) return true;
    const gA = (colorA >> 8) & 0xff, gB = (colorB >> 8) & 0xff;
    if (Math.abs(gA - gB) > threshold) return true;
    const bA = colorA & 0xff, bB = colorB & 0xff;
    return Math.abs(bA - bB) > threshold;
  }

  // ==============================
  //  Hull Drawing (dark fill + bright edges)
  // ==============================

  private drawHull(): void {
    const graphics = this.hullGraphics;
    graphics.clear();

    const currentTier = this.tier;
    const hullColor = this.lastHullColor;
    const darkHullColor = darkenColor(hullColor, 0.85);
    const edgeBloomColor = lightenColor(hullColor, 0.3);
    const cockpitDarkColor = darkenColor(hullColor, 0.9);
    const nozzleDarkColor = darkenColor(hullColor, 0.8);

    // Dark hull fill
    graphics.fillStyle(darkHullColor, 0.95);
    this.drawHullPath(graphics, currentTier.hullOutline);
    graphics.fillPath();

    // Bright neon edge stroke (the defining Tron line)
    graphics.lineStyle(2.0, hullColor, 1.0);
    this.drawHullPath(graphics, currentTier.hullOutline);
    graphics.strokePath();

    // Soft edge bloom stroke (wider, dimmer)
    graphics.lineStyle(4.0, edgeBloomColor, 0.2);
    this.drawHullPath(graphics, currentTier.hullOutline);
    graphics.strokePath();

    // --- Hexagonal cockpit ---
    const cockpit = currentTier.cockpit;

    // Dark cockpit fill
    graphics.fillStyle(cockpitDarkColor, 0.9);
    graphics.beginPath();
    graphics.moveTo(cockpit[0].x, cockpit[0].y);
    for (let i = 1; i < cockpit.length; i++) {
      graphics.lineTo(cockpit[i].x, cockpit[i].y);
    }
    graphics.closePath();
    graphics.fillPath();

    // Cockpit edge stroke
    graphics.lineStyle(1.2, hullColor, 0.9);
    graphics.beginPath();
    graphics.moveTo(cockpit[0].x, cockpit[0].y);
    for (let i = 1; i < cockpit.length; i++) {
      graphics.lineTo(cockpit[i].x, cockpit[i].y);
    }
    graphics.closePath();
    graphics.strokePath();

    // Cockpit center power indicator
    const cockpitCenterX = (cockpit[0].x + cockpit[3].x) / 2;
    graphics.fillStyle(0xffffff, 0.85);
    graphics.fillCircle(cockpitCenterX, 0, 1.5);

    // Cockpit crosshairs (tier 3+)
    if (currentTier.cockpitHasCrosshairs) {
      const crosshairColor = lightenColor(hullColor, 0.4);
      graphics.lineStyle(0.5, crosshairColor, 0.4);
      // Horizontal crosshair
      graphics.beginPath();
      graphics.moveTo(cockpit[3].x + 2, 0);
      graphics.lineTo(cockpit[0].x - 2, 0);
      graphics.strokePath();
      // Vertical crosshair
      const cockpitMidX = cockpitCenterX;
      const cockpitHalfHeight = Math.abs(cockpit[1].y) - 0.5;
      graphics.beginPath();
      graphics.moveTo(cockpitMidX, -cockpitHalfHeight);
      graphics.lineTo(cockpitMidX, cockpitHalfHeight);
      graphics.strokePath();
    }

    // --- Engine nozzles (dark circles with bright edge rings) ---
    for (const nozzle of currentTier.engineNozzles) {
      graphics.fillStyle(nozzleDarkColor, 0.8);
      graphics.fillCircle(nozzle.x, nozzle.y, currentTier.engineNozzleRadius);
      graphics.lineStyle(0.8, hullColor, 0.7);
      graphics.strokeCircle(nozzle.x, nozzle.y, currentTier.engineNozzleRadius);
    }
  }

  /**
   * Draw hull outline path from array of vertices
   */
  private drawHullPath(graphics: Phaser.GameObjects.Graphics, hull: Point2D[]): void {
    if (hull.length === 0) return;
    graphics.beginPath();
    graphics.moveTo(hull[0].x, hull[0].y);
    for (let i = 1; i < hull.length; i++) {
      graphics.lineTo(hull[i].x, hull[i].y);
    }
    graphics.closePath();
  }

  /**
   * Draw hull path scaled from center (for glow layers)
   */
  private drawScaledHullPath(graphics: Phaser.GameObjects.Graphics, hull: Point2D[], scale: number): void {
    if (hull.length === 0) return;
    graphics.beginPath();
    graphics.moveTo(hull[0].x * scale, hull[0].y * scale);
    for (let i = 1; i < hull.length; i++) {
      graphics.lineTo(hull[i].x * scale, hull[i].y * scale);
    }
    graphics.closePath();
  }

  // ==============================
  //  Detail Drawing (circuit traces, wing edge segments)
  // ==============================

  private drawDetails(): void {
    const graphics = this.detailGraphics;
    graphics.clear();

    const currentTier = this.tier;
    const hullColor = this.lastHullColor;
    const accentColor = lightenColor(hullColor, 0.6);
    const traceGlowColor = lightenColor(hullColor, 0.4);
    const isLowQuality = this.config.quality === 'low';

    // --- Circuit traces (bright neon lines on dark hull) ---
    for (const trace of currentTier.circuitTraces) {
      if (trace.path.length < 2) continue;

      // Glow pass (wider, dimmer) - skip on low quality
      if (!isLowQuality) {
        graphics.lineStyle(trace.width + 2.0, traceGlowColor, trace.alpha * 0.2);
        graphics.beginPath();
        graphics.moveTo(trace.path[0].x, trace.path[0].y);
        for (let i = 1; i < trace.path.length; i++) {
          graphics.lineTo(trace.path[i].x, trace.path[i].y);
        }
        graphics.strokePath();
      }

      // Core pass (narrow, bright)
      graphics.lineStyle(trace.width, accentColor, trace.alpha);
      graphics.beginPath();
      graphics.moveTo(trace.path[0].x, trace.path[0].y);
      for (let i = 1; i < trace.path.length; i++) {
        graphics.lineTo(trace.path[i].x, trace.path[i].y);
      }
      graphics.strokePath();

      // Endpoint dots (circuit board pad aesthetic)
      const startPoint = trace.path[0];
      const endPoint = trace.path[trace.path.length - 1];
      graphics.fillStyle(accentColor, trace.alpha * 0.8);
      graphics.fillCircle(startPoint.x, startPoint.y, 0.8);
      graphics.fillCircle(endPoint.x, endPoint.y, 0.8);
    }

    // --- Energy channels (thicker power conduits) ---
    for (const channel of currentTier.energyChannels) {
      if (channel.path.length < 2) continue;

      // Glow pass
      if (!isLowQuality) {
        graphics.lineStyle(channel.width + 3.0, traceGlowColor, channel.baseAlpha * 0.15);
        graphics.beginPath();
        graphics.moveTo(channel.path[0].x, channel.path[0].y);
        for (let i = 1; i < channel.path.length; i++) {
          graphics.lineTo(channel.path[i].x, channel.path[i].y);
        }
        graphics.strokePath();
      }

      // Core pass
      graphics.lineStyle(channel.width, accentColor, channel.baseAlpha);
      graphics.beginPath();
      graphics.moveTo(channel.path[0].x, channel.path[0].y);
      for (let i = 1; i < channel.path.length; i++) {
        graphics.lineTo(channel.path[i].x, channel.path[i].y);
      }
      graphics.strokePath();
    }

    // --- Wing edge segments (dashed glow lines along leading edges) ---
    for (const segment of currentTier.wingEdgeSegments) {
      if (!isLowQuality) {
        graphics.lineStyle(2.5, traceGlowColor, 0.15);
        graphics.beginPath();
        graphics.moveTo(segment.from.x, segment.from.y);
        graphics.lineTo(segment.to.x, segment.to.y);
        graphics.strokePath();
      }

      graphics.lineStyle(1.0, accentColor, 0.6);
      graphics.beginPath();
      graphics.moveTo(segment.from.x, segment.from.y);
      graphics.lineTo(segment.to.x, segment.to.y);
      graphics.strokePath();
    }

    // --- Wing-tip accents (bright dots with glow halo) ---
    for (const accent of currentTier.wingTipAccents) {
      graphics.fillStyle(accentColor, 0.9);
      graphics.fillCircle(accent.x, accent.y, currentTier.wingTipAccentRadius);
      graphics.fillStyle(accentColor, 0.3);
      graphics.fillCircle(accent.x, accent.y, currentTier.wingTipAccentRadius + 2);
    }
  }

  // ==============================
  //  Static Layer Cache (hull + glow + details → RenderTexture)
  // ==============================

  /**
   * Redraws hull, glow, and details into offscreen Graphics, then composites
   * them into a single RenderTexture displayed as an Image sprite.
   * Called only when hull color changes (not every frame).
   */
  private rebuildStaticCache(): void {
    // Draw to offscreen Graphics surfaces
    this.drawHull();
    this.drawGlow();
    this.drawDetails();

    const cacheSize = PlayerSpaceship.CACHE_SIZE;
    const halfSize = cacheSize / 2;

    // Composite all three layers into a RenderTexture
    const renderTexture = this.scene.add.renderTexture(0, 0, cacheSize, cacheSize);
    renderTexture.setVisible(false);
    renderTexture.draw(this.glowGraphics, halfSize, halfSize);
    renderTexture.draw(this.hullGraphics, halfSize, halfSize);
    renderTexture.draw(this.detailGraphics, halfSize, halfSize);

    // Replace cached texture
    if (this.scene.textures.exists(this.cachedStaticTextureKey)) {
      this.scene.textures.remove(this.cachedStaticTextureKey);
    }
    renderTexture.saveTexture(this.cachedStaticTextureKey);
    renderTexture.destroy();

    // Update display Image
    this.cachedStaticImage.setTexture(this.cachedStaticTextureKey);
    this.cachedStaticImage.setOrigin(0.5, 0.5);
    if (!this.cachedStaticImage.visible) {
      this.cachedStaticImage.setVisible(true);
    }
  }

  // ==============================
  //  Glow Drawing (hull aura + edge bloom)
  // ==============================

  private drawGlow(): void {
    const graphics = this.glowGraphics;
    graphics.clear();

    const currentTier = this.tier;
    const alphas = getGlowAlphas(this.config.quality);
    const multipliers = getGlowRadiusMultipliers(this.config.quality);
    const glowColor = lightenColor(this.lastHullColor, 0.35);

    // Draw glow layers from outermost to innermost (hull-shaped fills)
    for (let layerIndex = 0; layerIndex < alphas.length; layerIndex++) {
      const scale = multipliers[layerIndex];
      graphics.fillStyle(glowColor, alphas[layerIndex]);
      this.drawScaledHullPath(graphics, currentTier.hullOutline, scale);
      graphics.fillPath();
    }

    // Edge bloom strokes (neon bleed on hull edges)
    const edgeGlowLayers = this.config.quality === 'low' ? 1 : this.config.quality === 'medium' ? 2 : 3;
    for (let i = 0; i < edgeGlowLayers; i++) {
      const width = 6 - i * 1.5;
      const alpha = 0.06 + i * 0.04;
      graphics.lineStyle(width, glowColor, alpha);
      this.drawHullPath(graphics, currentTier.hullOutline);
      graphics.strokePath();
    }

    // --- Tier 5: Energy corona (pulsing outer aura) ---
    if (currentTier.hasEnergyCorona) {
      const coronaPulse = currentTier.coronaAlphaBase +
        Math.sin(this.coronaPulsePhase) * 0.02;
      const coronaLayers = 3;
      for (let i = 0; i < coronaLayers; i++) {
        const layerScale = currentTier.coronaScale - i * 0.15;
        const layerAlpha = coronaPulse * (1 - i * 0.25);
        graphics.fillStyle(glowColor, Math.max(0.01, layerAlpha));
        this.drawScaledHullPath(graphics, currentTier.hullOutline, layerScale);
        graphics.fillPath();
      }
    }
  }

  // ==============================
  //  Thrust Drawing (engine flames) - per frame
  // ==============================

  private drawThrust(normalizedSpeed: number): void {
    const graphics = this.thrustGraphics;
    graphics.clear();

    const currentTier = this.tier;

    // Multi-frequency flicker for organic fire look
    const flicker1 = Math.sin(this.thrustFlickerPhase1) * 0.25;
    const flicker2 = Math.sin(this.thrustFlickerPhase2) * 0.18;
    const flicker3 = Math.sin(this.thrustFlickerPhase3) * 0.12;
    const flickerTotal = 1 + flicker1 + flicker2 + flicker3;

    // Thrust intensity based on movement
    const thrustIntensity = 0.12 + this.movementBlend * 0.88;
    const baseLength = (PlayerSpaceship.THRUST_MIN_LENGTH +
      (PlayerSpaceship.THRUST_MAX_LENGTH - PlayerSpaceship.THRUST_MIN_LENGTH) * thrustIntensity) * flickerTotal;

    const thrustWidth = PlayerSpaceship.THRUST_WIDTH * (0.6 + thrustIntensity * 0.4);
    const thrustAlpha = 0.3 + thrustIntensity * 0.7;

    // Tron thrust color: stays blue/cyan/white (not orange)
    const baseGlow = this.config.neonColor.glow;
    const hotCyanColor = 0xaaddff;
    const thrustColor = normalizedSpeed > 0.4
      ? this.lerpColor(baseGlow, hotCyanColor, Math.min(1, (normalizedSpeed - 0.4) * 1.2))
      : baseGlow;

    // Draw each engine nozzle's flame
    const nozzles = currentTier.engineNozzles;
    for (let nozzleIndex = 0; nozzleIndex < nozzles.length; nozzleIndex++) {
      const nozzle = nozzles[nozzleIndex];
      // Per-nozzle flicker variation
      const nozzlePhaseOffset = nozzleIndex * 1.2;
      const nozzleFlicker = 1 + Math.sin(this.thrustFlickerPhase1 + nozzlePhaseOffset) * 0.12;
      // First nozzle is slightly longer; inner nozzles (index 3+) are shorter
      const lengthMultiplier = nozzleIndex === 0 ? 1.15 : nozzleIndex >= 3 ? 0.85 : 1.0;
      const length = baseLength * nozzleFlicker * lengthMultiplier;

      // Outer glow (wide, dim)
      graphics.fillStyle(thrustColor, thrustAlpha * 0.25);
      this.drawFlamePath(graphics, nozzle.x, nozzle.y, length * 1.4, thrustWidth * 2.0);
      graphics.fillPath();

      // Mid layer
      graphics.fillStyle(thrustColor, thrustAlpha * 0.55);
      this.drawFlamePath(graphics, nozzle.x, nozzle.y, length, thrustWidth);
      graphics.fillPath();

      // Hot core (white)
      graphics.fillStyle(0xffffff, thrustAlpha * 0.75);
      this.drawFlamePath(graphics, nozzle.x, nozzle.y, length * 0.45, thrustWidth * 0.45);
      graphics.fillPath();
    }
  }

  /**
   * Draw a single flame triangle (tapered, extending backward from nozzle)
   */
  private drawFlamePath(
    graphics: Phaser.GameObjects.Graphics,
    originX: number, originY: number,
    length: number, width: number
  ): void {
    const halfWidth = width / 2;
    graphics.beginPath();
    graphics.moveTo(originX, originY - halfWidth);       // Top of nozzle
    graphics.lineTo(originX - length, originY);           // Flame tip
    graphics.lineTo(originX, originY + halfWidth);        // Bottom of nozzle
    graphics.closePath();
  }

  // ==============================
  //  Overlay Drawing (energy pods + pulse) - per frame, on top of hull
  // ==============================

  private drawOverlay(): void {
    const graphics = this.overlayGraphics;
    graphics.clear();

    const currentTier = this.tier;

    // --- Energy pods (pulsing glow orbs on wings) ---
    if (currentTier.energyPods.length > 0) {
      const podPulseAlpha = 0.6 + Math.sin(this.energyPodPulsePhase) * 0.25;
      const accentColor = lightenColor(this.lastHullColor, 0.6);
      const podGlowRadius = currentTier.energyPodRadius + 2.5;

      for (let podIndex = 0; podIndex < currentTier.energyPods.length; podIndex++) {
        const pod = currentTier.energyPods[podIndex];
        const podPhaseOffset = podIndex * 1.5;
        const podAlpha = podPulseAlpha + Math.sin(this.energyPodPulsePhase + podPhaseOffset) * 0.1;

        // Pod glow halo
        graphics.fillStyle(accentColor, podAlpha * 0.3);
        graphics.fillCircle(pod.x, pod.y, podGlowRadius);
        // Pod core
        graphics.fillStyle(accentColor, podAlpha);
        graphics.fillCircle(pod.x, pod.y, currentTier.energyPodRadius);
        // Bright center
        graphics.fillStyle(0xffffff, podAlpha * 0.7);
        graphics.fillCircle(pod.x, pod.y, currentTier.energyPodRadius * 0.4);
      }
    }

    // --- Energy pulse animation (tier 3+) ---
    if (currentTier.hasEnergyPulse && this.config.quality !== 'low') {
      this.drawEnergyPulse(graphics);
    }
  }

  /**
   * Draw animated energy pulse traveling along energy channels
   */
  private drawEnergyPulse(graphics: Phaser.GameObjects.Graphics): void {
    const currentTier = this.tier;
    const accentColor = lightenColor(this.lastHullColor, 0.7);
    const pulsePosition = this.energyPulsePhase;

    for (const channel of currentTier.energyChannels) {
      if (channel.path.length < 2) continue;

      const totalLength = this.getPathLength(channel.path);
      const pulseDistance = pulsePosition * totalLength;
      const pulsePoint = this.getPointAlongPath(channel.path, pulseDistance);

      // Bright pulse dot
      graphics.fillStyle(accentColor, 0.9);
      graphics.fillCircle(pulsePoint.x, pulsePoint.y, 2.0);

      // Wider glow around pulse (high quality only)
      if (this.config.quality === 'high') {
        graphics.fillStyle(accentColor, 0.25);
        graphics.fillCircle(pulsePoint.x, pulsePoint.y, 5.0);
      }
    }
  }

  // ==============================
  //  Path utilities for energy pulse
  // ==============================

  private getPathLength(path: Point2D[]): number {
    let totalLength = 0;
    for (let i = 1; i < path.length; i++) {
      const deltaX = path[i].x - path[i - 1].x;
      const deltaY = path[i].y - path[i - 1].y;
      totalLength += Math.sqrt(deltaX * deltaX + deltaY * deltaY);
    }
    return totalLength;
  }

  private getPointAlongPath(path: Point2D[], distance: number): Point2D {
    let accumulatedLength = 0;
    for (let i = 1; i < path.length; i++) {
      const deltaX = path[i].x - path[i - 1].x;
      const deltaY = path[i].y - path[i - 1].y;
      const segmentLength = Math.sqrt(deltaX * deltaX + deltaY * deltaY);
      if (accumulatedLength + segmentLength >= distance) {
        const interpolation = segmentLength > 0 ? (distance - accumulatedLength) / segmentLength : 0;
        return {
          x: path[i - 1].x + deltaX * interpolation,
          y: path[i - 1].y + deltaY * interpolation,
        };
      }
      accumulatedLength += segmentLength;
    }
    return path[path.length - 1];
  }

  // ==============================
  //  Public API
  // ==============================

  public onLevelUp(newLevel: number): EvolutionResult {
    const newTierIndex = getTierForLevel(newLevel);
    // Compare against pending tier if mid-evolution, otherwise current tier
    const effectiveTier = this.pendingTierIndex >= 0 ? this.pendingTierIndex : this.currentTierIndex;
    const evolved = newTierIndex !== effectiveTier;

    if (evolved) {
      // Evolution: bigger flash, bigger pulse, tier swap via animation
      this.pendingTierIndex = newTierIndex;
      this.isEvolving = true;
      this.evolutionAnimTimer = PlayerSpaceship.EVOLUTION_ANIM_DURATION;
      this.flashDuration = PlayerSpaceship.EVOLUTION_FLASH_DURATION;
      this.levelUpFlashTimer = PlayerSpaceship.EVOLUTION_FLASH_DURATION;
      this.shipScale = 1.0 + PlayerSpaceship.EVOLUTION_SCALE_PULSE;
      this.targetShipScale = 1.0;
      this.hullDirty = true;
    } else if (!this.isEvolving) {
      // Normal level-up: standard flash + pulse (skip if evolution animation is playing)
      this.flashDuration = PlayerSpaceship.FLASH_DURATION;
      this.levelUpFlashTimer = PlayerSpaceship.FLASH_DURATION;
      this.shipScale = 1.0 + PlayerSpaceship.SCALE_PULSE_AMOUNT;
      this.targetShipScale = 1.0;
      this.hullDirty = true;
    }

    return {
      evolved,
      tierName: EVOLUTION_TIERS[newTierIndex].name,
    };
  }

  public getTierName(): string {
    return this.tier.name;
  }

  public getCurrentTier(): number {
    return this.currentTierIndex;
  }

  public getContainer(): Phaser.GameObjects.Container {
    return this.container;
  }

  public setQuality(quality: VisualQuality): void {
    if (quality === this.config.quality) return;
    this.config.quality = quality;
    this.hullDirty = true;
  }

  public setDangerLevel(level: number): void {
    const clamped = Math.max(0, Math.min(1, level));
    if (clamped !== this.dangerLevel) {
      this.dangerLevel = clamped;
      this.hullDirty = true;
    }
  }

  public setComboTier(tier: string): void {
    const targetColor = PlayerSpaceship.COMBO_TIER_COLORS[tier] ?? 0xffffff;
    const targetBlend = PlayerSpaceship.COMBO_TIER_BLEND[tier] ?? 0;

    if (targetColor !== this.comboColor || targetBlend !== this.comboBlend) {
      this.comboColor = targetColor;
      this.comboBlend = targetBlend;
      this.hullDirty = true;
    }
  }

  public setInvulnerable(active: boolean): void {
    if (this.isInvulnerable === active) return;
    this.isInvulnerable = active;
    if (!active) {
      this.container.setAlpha(1);
      this.invulnerabilityFlickerPhase = 0;
    }
  }

  public destroy(): void {
    // Clean up offscreen drawing surfaces
    this.glowGraphics.destroy();
    this.hullGraphics.destroy();
    this.detailGraphics.destroy();
    // Clean up cached texture
    if (this.scene.textures.exists(this.cachedStaticTextureKey)) {
      this.scene.textures.remove(this.cachedStaticTextureKey);
    }
    this.container.destroy();
  }

  // ==============================
  //  Utilities
  // ==============================

  private lerpColor(color1: number, color2: number, interpolationFactor: number): number {
    const red1 = (color1 >> 16) & 0xff;
    const green1 = (color1 >> 8) & 0xff;
    const blue1 = color1 & 0xff;

    const red2 = (color2 >> 16) & 0xff;
    const green2 = (color2 >> 8) & 0xff;
    const blue2 = color2 & 0xff;

    const blendedRed = Math.round(red1 + (red2 - red1) * interpolationFactor);
    const blendedGreen = Math.round(green1 + (green2 - green1) * interpolationFactor);
    const blendedBlue = Math.round(blue1 + (blue2 - blue1) * interpolationFactor);

    return (blendedRed << 16) | (blendedGreen << 8) | blendedBlue;
  }

  /**
   * Flash the ship white for a brief moment (death/impact effect).
   */
  playDeathFlash(durationMs: number): void {
    const scene = this.container.scene;
    const bounds = this.container.getBounds();
    const flashOverlay = scene.add.rectangle(
      this.container.x, this.container.y,
      bounds.width + 20, bounds.height + 20,
      0xffffff, 0.9
    );
    flashOverlay.setDepth(this.container.depth + 1);
    scene.tweens.add({
      targets: flashOverlay,
      alpha: 0,
      duration: durationMs,
      ease: 'Power2',
      onComplete: () => flashOverlay.destroy(),
    });
  }

  /**
   * Hide the ship and return its world position (for death explosion).
   */
  explode(): { x: number; y: number } {
    const worldPosition = { x: this.container.x, y: this.container.y };
    this.container.setVisible(false);
    return worldPosition;
  }
}
