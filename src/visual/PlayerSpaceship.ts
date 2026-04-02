/**
 * PlayerSpaceship - A procedurally-drawn neon spaceship that evolves as the player levels up
 *
 * Features:
 * - 5 evolution tiers: Scout → Fighter → Striker → Warbird → Apex
 * - Each tier has unique hull geometry, engine count, and visual details
 * - Smooth evolution transition animation (flash + shape swap)
 * - Multi-layer neon glow with quality scaling (high/medium/low)
 * - Animated engine thrust that scales with movement speed
 * - Combo tier color shifts, low-HP danger red, invulnerability blink
 * - Level-up flash + scale pulse
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

// --- Evolution Tier Data ---

interface HullVertexSet {
  nose: { x: number; y: number };
  upperCheek: { x: number; y: number };
  rightWingRoot: { x: number; y: number };
  rightWingTip: { x: number; y: number };
  rightWingTrail: { x: number; y: number };
  rightBodyJoin: { x: number; y: number };
  tailNotch: { x: number; y: number };
  leftBodyJoin: { x: number; y: number };
  leftWingTrail: { x: number; y: number };
  leftWingTip: { x: number; y: number };
  leftWingRoot: { x: number; y: number };
  lowerCheek: { x: number; y: number };
}

interface CockpitVertexSet {
  front: { x: number; y: number };
  right: { x: number; y: number };
  back: { x: number; y: number };
  left: { x: number; y: number };
}

interface WingBladeExtension {
  fromX: number; fromY: number;
  toX: number; toY: number;
}

interface EvolutionTier {
  name: string;
  minLevel: number;
  hull: HullVertexSet;
  cockpit: CockpitVertexSet;
  engineNozzles: { x: number; y: number }[];
  wingTipAccents: { x: number; y: number }[];
  energyPods: { x: number; y: number }[];
  wingBladeExtensions: WingBladeExtension[];
  engineNozzleRadius: number;
  wingTipAccentRadius: number;
  energyPodRadius: number;
  hasWingEdgeGlow: boolean;
  hasTrailingEdgeAccent: boolean;
  hasEnergyCorona: boolean;
  coronaScale: number;
  coronaAlphaBase: number;
}

const EVOLUTION_TIERS: EvolutionTier[] = [
  // --- Tier 1: Scout (Levels 1-4) ---
  {
    name: 'Scout',
    minLevel: 1,
    hull: {
      nose:           { x:  20, y:   0 },
      upperCheek:     { x:  10, y:  -3 },
      rightWingRoot:  { x:  -1, y:  -4 },
      rightWingTip:   { x: -12, y: -10 },
      rightWingTrail: { x: -10, y:  -7 },
      rightBodyJoin:  { x:  -6, y:  -3 },
      tailNotch:      { x:  -8, y:   0 },
      leftBodyJoin:   { x:  -6, y:   3 },
      leftWingTrail:  { x: -10, y:   7 },
      leftWingTip:    { x: -12, y:  10 },
      leftWingRoot:   { x:  -1, y:   4 },
      lowerCheek:     { x:  10, y:   3 },
    },
    cockpit: {
      front: { x: 12, y:  0 },
      right: { x:  3, y:  2 },
      back:  { x: -1, y:  0 },
      left:  { x:  3, y: -2 },
    },
    engineNozzles: [
      { x: -7, y: 0 },
    ],
    wingTipAccents: [],
    energyPods: [],
    wingBladeExtensions: [],
    engineNozzleRadius: 2.0,
    wingTipAccentRadius: 0,
    energyPodRadius: 0,
    hasWingEdgeGlow: false,
    hasTrailingEdgeAccent: false,
    hasEnergyCorona: false,
    coronaScale: 1,
    coronaAlphaBase: 0,
  },

  // --- Tier 2: Fighter (Levels 5-9) ---
  {
    name: 'Fighter',
    minLevel: 5,
    hull: {
      nose:           { x:  24, y:   0 },
      upperCheek:     { x:  12, y:  -4 },
      rightWingRoot:  { x:  -2, y:  -5 },
      rightWingTip:   { x: -16, y: -14 },
      rightWingTrail: { x: -12, y: -10 },
      rightBodyJoin:  { x:  -7, y:  -4 },
      tailNotch:      { x: -10, y:   0 },
      leftBodyJoin:   { x:  -7, y:   4 },
      leftWingTrail:  { x: -12, y:  10 },
      leftWingTip:    { x: -16, y:  14 },
      leftWingRoot:   { x:  -2, y:   5 },
      lowerCheek:     { x:  12, y:   4 },
    },
    cockpit: {
      front: { x: 14, y:  0 },
      right: { x:  4, y:  2.5 },
      back:  { x: -2, y:  0 },
      left:  { x:  4, y: -2.5 },
    },
    engineNozzles: [
      { x: -9, y: -5 },
      { x: -9, y:  5 },
    ],
    wingTipAccents: [
      { x: -16, y: -14 },
      { x: -16, y:  14 },
    ],
    energyPods: [],
    wingBladeExtensions: [],
    engineNozzleRadius: 2.2,
    wingTipAccentRadius: 1.0,
    energyPodRadius: 0,
    hasWingEdgeGlow: false,
    hasTrailingEdgeAccent: false,
    hasEnergyCorona: false,
    coronaScale: 1,
    coronaAlphaBase: 0,
  },

  // --- Tier 3: Striker (Levels 10-19) ---
  {
    name: 'Striker',
    minLevel: 10,
    hull: {
      nose:           { x:  26, y:   0 },
      upperCheek:     { x:  12, y:  -4 },
      rightWingRoot:  { x:  -2, y:  -6 },
      rightWingTip:   { x: -18, y: -18 },
      rightWingTrail: { x: -14, y: -12 },
      rightBodyJoin:  { x:  -8, y:  -5 },
      tailNotch:      { x: -12, y:   0 },
      leftBodyJoin:   { x:  -8, y:   5 },
      leftWingTrail:  { x: -14, y:  12 },
      leftWingTip:    { x: -18, y:  18 },
      leftWingRoot:   { x:  -2, y:   6 },
      lowerCheek:     { x:  12, y:   4 },
    },
    cockpit: {
      front: { x: 16, y:  0 },
      right: { x:  4, y:  3 },
      back:  { x: -2, y:  0 },
      left:  { x:  4, y: -3 },
    },
    engineNozzles: [
      { x: -10, y:  0 },
      { x: -11, y:  6 },
      { x: -11, y: -6 },
    ],
    wingTipAccents: [
      { x: -18, y: -18 },
      { x: -18, y:  18 },
    ],
    energyPods: [],
    wingBladeExtensions: [],
    engineNozzleRadius: 2.5,
    wingTipAccentRadius: 1.5,
    energyPodRadius: 0,
    hasWingEdgeGlow: true,
    hasTrailingEdgeAccent: false,
    hasEnergyCorona: false,
    coronaScale: 1,
    coronaAlphaBase: 0,
  },

  // --- Tier 4: Warbird (Levels 20-34) ---
  {
    name: 'Warbird',
    minLevel: 20,
    hull: {
      nose:           { x:  28, y:   0 },
      upperCheek:     { x:  14, y:  -5 },
      rightWingRoot:  { x:  -2, y:  -7 },
      rightWingTip:   { x: -20, y: -22 },
      rightWingTrail: { x: -16, y: -15 },
      rightBodyJoin:  { x: -10, y:  -6 },
      tailNotch:      { x: -14, y:   0 },
      leftBodyJoin:   { x: -10, y:   6 },
      leftWingTrail:  { x: -16, y:  15 },
      leftWingTip:    { x: -20, y:  22 },
      leftWingRoot:   { x:  -2, y:   7 },
      lowerCheek:     { x:  14, y:   5 },
    },
    cockpit: {
      front: { x: 18, y:  0 },
      right: { x:  5, y:  3.5 },
      back:  { x: -2, y:  0 },
      left:  { x:  5, y: -3.5 },
    },
    engineNozzles: [
      { x: -12, y:  0 },
      { x: -13, y:  7 },
      { x: -13, y: -7 },
    ],
    wingTipAccents: [
      { x: -20, y: -22 },
      { x: -20, y:  22 },
    ],
    energyPods: [
      { x: -8, y: -14 },
      { x: -8, y:  14 },
    ],
    wingBladeExtensions: [],
    engineNozzleRadius: 3.0,
    wingTipAccentRadius: 2.0,
    energyPodRadius: 2.0,
    hasWingEdgeGlow: true,
    hasTrailingEdgeAccent: true,
    hasEnergyCorona: false,
    coronaScale: 1,
    coronaAlphaBase: 0,
  },

  // --- Tier 5: Apex (Levels 35+) ---
  {
    name: 'Apex',
    minLevel: 35,
    hull: {
      nose:           { x:  30, y:   0 },
      upperCheek:     { x:  16, y:  -6 },
      rightWingRoot:  { x:  -3, y:  -8 },
      rightWingTip:   { x: -22, y: -24 },
      rightWingTrail: { x: -18, y: -16 },
      rightBodyJoin:  { x: -12, y:  -7 },
      tailNotch:      { x: -16, y:   0 },
      leftBodyJoin:   { x: -12, y:   7 },
      leftWingTrail:  { x: -18, y:  16 },
      leftWingTip:    { x: -22, y:  24 },
      leftWingRoot:   { x:  -3, y:   8 },
      lowerCheek:     { x:  16, y:   6 },
    },
    cockpit: {
      front: { x: 20, y:  0 },
      right: { x:  6, y:  4 },
      back:  { x: -3, y:  0 },
      left:  { x:  6, y: -4 },
    },
    engineNozzles: [
      { x: -14, y:  0 },
      { x: -15, y:  7 },
      { x: -15, y: -7 },
      { x: -13, y:  3 },
      { x: -13, y: -3 },
    ],
    wingTipAccents: [
      { x: -22, y: -24 },
      { x: -22, y:  24 },
    ],
    energyPods: [
      { x: -10, y: -16 },
      { x: -10, y:  16 },
    ],
    wingBladeExtensions: [
      { fromX: -22, fromY: -24, toX: -26, toY: -28 },
      { fromX: -22, fromY:  24, toX: -26, toY:  28 },
    ],
    engineNozzleRadius: 3.0,
    wingTipAccentRadius: 2.5,
    energyPodRadius: 2.5,
    hasWingEdgeGlow: true,
    hasTrailingEdgeAccent: true,
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
  private container: Phaser.GameObjects.Container;
  private config: SpaceshipConfig;

  // Graphics layers (children of container, drawn in order)
  private glowGraphics: Phaser.GameObjects.Graphics;
  private hullGraphics: Phaser.GameObjects.Graphics;
  private thrustGraphics: Phaser.GameObjects.Graphics;
  private detailGraphics: Phaser.GameObjects.Graphics;

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
  private static readonly SPEED_WARMTH_AMOUNT = 0.12;

  // Idle hover
  private static readonly HOVER_AMPLITUDE = 0.8;
  private static readonly HOVER_SPEED = 2.5;

  constructor(scene: Phaser.Scene, x: number, y: number, config: SpaceshipConfig, startingLevel: number = 1) {
    this.config = { ...config };
    this.container = scene.add.container(x, y);
    this.container.setDepth(10);

    // Set initial evolution tier based on starting level (handles save restoration)
    this.currentTierIndex = getTierForLevel(startingLevel);

    // Create graphics layers in draw order (back to front)
    this.thrustGraphics = scene.add.graphics();
    this.glowGraphics = scene.add.graphics();
    this.hullGraphics = scene.add.graphics();
    this.detailGraphics = scene.add.graphics();

    this.container.add(this.thrustGraphics);
    this.container.add(this.glowGraphics);
    this.container.add(this.hullGraphics);
    this.container.add(this.detailGraphics);

    this.lastHullColor = config.neonColor.core;

    // Initial draw
    this.drawHull();
    this.drawGlow();
    this.drawDetails();
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

    // --- Energy pod and corona pulse ---
    this.energyPodPulsePhase += dt * 3.0;
    this.coronaPulsePhase += dt * 1.5;

    // --- Invulnerability flicker ---
    if (this.isInvulnerable) {
      this.invulnerabilityFlickerPhase += dt * 10;
      const flickerAlpha = Math.sin(this.invulnerabilityFlickerPhase * Math.PI * 2) > 0 ? 1.0 : 0.3;
      this.container.setAlpha(flickerAlpha);
    }

    // --- Compute hull color ---
    const hullColor = this.computeHullColor(normalizedSpeed);
    if (hullColor !== this.lastHullColor || this.hullDirty) {
      this.lastHullColor = hullColor;
      this.hullDirty = false;
      this.drawHull();
      this.drawGlow();
      this.drawDetails();
    }

    // --- Idle hover bob ---
    const hoverOffset = this.movementBlend < 0.5
      ? Math.sin(this.globalTime * PlayerSpaceship.HOVER_SPEED) * PlayerSpaceship.HOVER_AMPLITUDE * (1 - this.movementBlend * 2)
      : 0;

    // --- Apply rotation and scale to all child graphics ---
    const scale = this.shipScale;
    const rotation = this.currentAngle;

    this.hullGraphics.setRotation(rotation);
    this.hullGraphics.setScale(scale);
    this.hullGraphics.setY(hoverOffset);
    this.glowGraphics.setRotation(rotation);
    this.glowGraphics.setScale(scale);
    this.glowGraphics.setY(hoverOffset);
    this.thrustGraphics.setRotation(rotation);
    this.thrustGraphics.setScale(scale);
    this.thrustGraphics.setY(hoverOffset);
    this.detailGraphics.setRotation(rotation);
    this.detailGraphics.setScale(scale);
    this.detailGraphics.setY(hoverOffset);

    // --- Redraw thrust every frame (animated) ---
    this.drawThrust(normalizedSpeed);
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
   * Draw the ship hull using current tier geometry
   */
  private drawHull(): void {
    const graphics = this.hullGraphics;
    graphics.clear();

    const currentTier = this.tier;
    const hullColor = this.lastHullColor;
    const highlightColor = lightenColor(hullColor, 0.5);
    const darkColor = darkenColor(hullColor, 0.3);

    // Main hull fill
    graphics.fillStyle(hullColor, 1);
    this.drawHullPath(graphics, currentTier.hull);
    graphics.fillPath();

    // Hull edge stroke (bright neon outline)
    graphics.lineStyle(1.5, lightenColor(hullColor, 0.7), 0.9);
    this.drawHullPath(graphics, currentTier.hull);
    graphics.strokePath();

    // Cockpit canopy (bright highlight)
    const cockpit = currentTier.cockpit;
    graphics.fillStyle(highlightColor, 0.9);
    graphics.beginPath();
    graphics.moveTo(cockpit.front.x, cockpit.front.y);
    graphics.lineTo(cockpit.right.x, cockpit.right.y);
    graphics.lineTo(cockpit.back.x, cockpit.back.y);
    graphics.lineTo(cockpit.left.x, cockpit.left.y);
    graphics.closePath();
    graphics.fillPath();

    // Cockpit bright center dot
    const cockpitCenterX = (cockpit.front.x + cockpit.back.x) / 2;
    graphics.fillStyle(0xffffff, 0.8);
    graphics.fillCircle(cockpitCenterX, 0, 1.5);

    // Engine nozzle rims
    for (const nozzle of currentTier.engineNozzles) {
      graphics.fillStyle(darkColor, 0.8);
      graphics.fillCircle(nozzle.x, nozzle.y, currentTier.engineNozzleRadius);
      graphics.lineStyle(0.7, lightenColor(hullColor, 0.3), 0.6);
      graphics.strokeCircle(nozzle.x, nozzle.y, currentTier.engineNozzleRadius);
    }
  }

  /**
   * Draw the hull outline path using given vertex set
   */
  private drawHullPath(graphics: Phaser.GameObjects.Graphics, hull: HullVertexSet): void {
    graphics.beginPath();
    graphics.moveTo(hull.nose.x, hull.nose.y);
    graphics.lineTo(hull.upperCheek.x, hull.upperCheek.y);
    graphics.lineTo(hull.rightWingRoot.x, hull.rightWingRoot.y);
    graphics.lineTo(hull.rightWingTip.x, hull.rightWingTip.y);
    graphics.lineTo(hull.rightWingTrail.x, hull.rightWingTrail.y);
    graphics.lineTo(hull.rightBodyJoin.x, hull.rightBodyJoin.y);
    graphics.lineTo(hull.tailNotch.x, hull.tailNotch.y);
    graphics.lineTo(hull.leftBodyJoin.x, hull.leftBodyJoin.y);
    graphics.lineTo(hull.leftWingTrail.x, hull.leftWingTrail.y);
    graphics.lineTo(hull.leftWingTip.x, hull.leftWingTip.y);
    graphics.lineTo(hull.leftWingRoot.x, hull.leftWingRoot.y);
    graphics.lineTo(hull.lowerCheek.x, hull.lowerCheek.y);
    graphics.closePath();
  }

  /**
   * Draw hull detail lines (panel seams, wing accents, tier-specific features)
   */
  private drawDetails(): void {
    const graphics = this.detailGraphics;
    graphics.clear();

    const currentTier = this.tier;
    const hullColor = this.lastHullColor;
    const darkColor = darkenColor(hullColor, 0.25);
    const accentColor = lightenColor(hullColor, 0.6);
    const hull = currentTier.hull;

    // Wing panel lines (dark seams for depth)
    graphics.lineStyle(0.8, darkColor, 0.5);
    // Right wing seam
    graphics.beginPath();
    graphics.moveTo(hull.upperCheek.x * 0.5, hull.upperCheek.y);
    graphics.lineTo(hull.rightWingTrail.x, hull.rightWingTrail.y);
    graphics.strokePath();
    // Left wing seam
    graphics.beginPath();
    graphics.moveTo(hull.lowerCheek.x * 0.5, hull.lowerCheek.y);
    graphics.lineTo(hull.leftWingTrail.x, hull.leftWingTrail.y);
    graphics.strokePath();

    // Fuselage center line
    graphics.lineStyle(0.6, darkColor, 0.3);
    graphics.beginPath();
    graphics.moveTo(hull.nose.x - 6, 0);
    graphics.lineTo(hull.rightBodyJoin.x, 0);
    graphics.strokePath();

    // Wing-tip energy accents (bright dots)
    for (const accent of currentTier.wingTipAccents) {
      graphics.fillStyle(accentColor, 0.9);
      graphics.fillCircle(accent.x, accent.y, currentTier.wingTipAccentRadius);
      // Small glow around tip
      graphics.fillStyle(accentColor, 0.3);
      graphics.fillCircle(accent.x, accent.y, currentTier.wingTipAccentRadius + 2);
    }

    // Nose accent line
    graphics.lineStyle(0.8, accentColor, 0.4);
    graphics.beginPath();
    graphics.moveTo(hull.nose.x - 4, 0);
    graphics.lineTo(hull.nose.x, 0);
    graphics.strokePath();

    // --- Tier 3+: Wing edge glow strips ---
    if (currentTier.hasWingEdgeGlow) {
      graphics.lineStyle(1.0, accentColor, 0.25);
      // Right wing leading edge
      graphics.beginPath();
      graphics.moveTo(hull.upperCheek.x, hull.upperCheek.y);
      graphics.lineTo(hull.rightWingRoot.x, hull.rightWingRoot.y);
      graphics.lineTo(hull.rightWingTip.x, hull.rightWingTip.y);
      graphics.strokePath();
      // Left wing leading edge
      graphics.beginPath();
      graphics.moveTo(hull.lowerCheek.x, hull.lowerCheek.y);
      graphics.lineTo(hull.leftWingRoot.x, hull.leftWingRoot.y);
      graphics.lineTo(hull.leftWingTip.x, hull.leftWingTip.y);
      graphics.strokePath();
    }

    // --- Tier 4+: Trailing edge accent ---
    if (currentTier.hasTrailingEdgeAccent) {
      graphics.lineStyle(0.8, accentColor, 0.35);
      // Right wing trailing edge
      graphics.beginPath();
      graphics.moveTo(hull.rightWingTip.x, hull.rightWingTip.y);
      graphics.lineTo(hull.rightWingTrail.x, hull.rightWingTrail.y);
      graphics.strokePath();
      // Left wing trailing edge
      graphics.beginPath();
      graphics.moveTo(hull.leftWingTip.x, hull.leftWingTip.y);
      graphics.lineTo(hull.leftWingTrail.x, hull.leftWingTrail.y);
      graphics.strokePath();
    }

    // --- Tier 5: Wing blade extensions ---
    for (const blade of currentTier.wingBladeExtensions) {
      graphics.lineStyle(1.5, accentColor, 0.7);
      graphics.beginPath();
      graphics.moveTo(blade.fromX, blade.fromY);
      graphics.lineTo(blade.toX, blade.toY);
      graphics.strokePath();
      // Blade tip glow dot
      graphics.fillStyle(accentColor, 0.6);
      graphics.fillCircle(blade.toX, blade.toY, 1.5);
    }
  }

  /**
   * Draw neon glow layers behind the hull
   */
  private drawGlow(): void {
    const graphics = this.glowGraphics;
    graphics.clear();

    const currentTier = this.tier;
    const alphas = getGlowAlphas(this.config.quality);
    const multipliers = getGlowRadiusMultipliers(this.config.quality);
    const glowColor = lightenColor(this.lastHullColor, 0.35);

    // Draw glow layers from outermost to innermost
    for (let layerIndex = 0; layerIndex < alphas.length; layerIndex++) {
      const scale = multipliers[layerIndex];
      graphics.fillStyle(glowColor, alphas[layerIndex]);
      this.drawScaledHullPath(graphics, currentTier.hull, scale);
      graphics.fillPath();
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
        this.drawScaledHullPath(graphics, currentTier.hull, layerScale);
        graphics.fillPath();
      }
    }
  }

  /**
   * Draw hull path scaled from center (for glow layers)
   */
  private drawScaledHullPath(graphics: Phaser.GameObjects.Graphics, hull: HullVertexSet, scale: number): void {
    graphics.beginPath();
    graphics.moveTo(hull.nose.x * scale, hull.nose.y * scale);
    graphics.lineTo(hull.upperCheek.x * scale, hull.upperCheek.y * scale);
    graphics.lineTo(hull.rightWingRoot.x * scale, hull.rightWingRoot.y * scale);
    graphics.lineTo(hull.rightWingTip.x * scale, hull.rightWingTip.y * scale);
    graphics.lineTo(hull.rightWingTrail.x * scale, hull.rightWingTrail.y * scale);
    graphics.lineTo(hull.rightBodyJoin.x * scale, hull.rightBodyJoin.y * scale);
    graphics.lineTo(hull.tailNotch.x * scale, hull.tailNotch.y * scale);
    graphics.lineTo(hull.leftBodyJoin.x * scale, hull.leftBodyJoin.y * scale);
    graphics.lineTo(hull.leftWingTrail.x * scale, hull.leftWingTrail.y * scale);
    graphics.lineTo(hull.leftWingTip.x * scale, hull.leftWingTip.y * scale);
    graphics.lineTo(hull.leftWingRoot.x * scale, hull.leftWingRoot.y * scale);
    graphics.lineTo(hull.lowerCheek.x * scale, hull.lowerCheek.y * scale);
    graphics.closePath();
  }

  /**
   * Draw engine thrust flames and energy pods (called every frame for animation)
   */
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

    // Thrust color shifts from blue to orange/white at high speed
    const baseGlow = this.config.neonColor.glow;
    const hotColor = 0xff8844;
    const thrustColor = normalizedSpeed > 0.4
      ? this.lerpColor(baseGlow, hotColor, (normalizedSpeed - 0.4) * 1.2)
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

    // --- Energy pods (drawn on thrust layer for free per-frame animation) ---
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

  // --- Public API ---

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
    this.container.destroy();
  }

  // --- Utility ---

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
}
