/**
 * Custom procedural drawings for each enemy type.
 * Each drawing is rendered once to a cached texture — zero per-frame cost.
 *
 * Visual design principles:
 * - Unique silhouette per enemy (most visible distinguisher at game speed)
 * - Bold internal details (eyes, symbols, armor lines) for larger enemies
 * - Neon glow aesthetic matching the player spaceship
 * - "Forward" direction: +X for circle/square/diamond, -Y for triangle enemies
 */

import Phaser from 'phaser';
import { NeonColorPair, getGlowAlphas, getGlowRadiusMultipliers } from './NeonColors';
import { VisualQuality, createCachedGlowingShape } from './GlowGraphics';

// =====================================================================
// TYPES
// =====================================================================

type EnemyDrawFn = (
  g: Phaser.GameObjects.Graphics,
  s: number,
  neon: NeonColorPair,
  quality: VisualQuality
) => void;

type EnemyShape = 'circle' | 'square' | 'triangle' | 'diamond' | 'hexagon';

// =====================================================================
// PRE-COMPUTED GEOMETRY
// =====================================================================

const HEX_UNIT: readonly { cos: number; sin: number }[] = (() => {
  const pts: { cos: number; sin: number }[] = [];
  for (let i = 0; i < 6; i++) {
    const angle = (Math.PI / 3) * i - Math.PI / 2;
    pts.push({ cos: Math.cos(angle), sin: Math.sin(angle) });
  }
  return pts;
})();

// =====================================================================
// GLOW HELPERS — draw blurry glow layers using base shape
// =====================================================================

function circleGlow(g: Phaser.GameObjects.Graphics, s: number, neon: NeonColorPair, quality: VisualQuality): void {
  const alphas = getGlowAlphas(quality);
  const mults = getGlowRadiusMultipliers(quality);
  for (let i = 0; i < alphas.length; i++) {
    g.fillStyle(neon.glow, alphas[i]);
    g.fillCircle(0, 0, s * mults[i]);
  }
}

function squareGlow(g: Phaser.GameObjects.Graphics, s: number, neon: NeonColorPair, quality: VisualQuality): void {
  const alphas = getGlowAlphas(quality);
  const mults = getGlowRadiusMultipliers(quality);
  for (let i = 0; i < alphas.length; i++) {
    const r = s * mults[i];
    g.fillStyle(neon.glow, alphas[i]);
    g.fillRect(-r, -r, r * 2, r * 2);
  }
}

function triangleGlow(g: Phaser.GameObjects.Graphics, s: number, neon: NeonColorPair, quality: VisualQuality): void {
  const alphas = getGlowAlphas(quality);
  const mults = getGlowRadiusMultipliers(quality);
  for (let i = 0; i < alphas.length; i++) {
    const m = s * mults[i];
    const h = m * 1.5;
    g.fillStyle(neon.glow, alphas[i]);
    g.beginPath();
    g.moveTo(0, -h * 0.5);
    g.lineTo(m, h * 0.5);
    g.lineTo(-m, h * 0.5);
    g.closePath();
    g.fillPath();
  }
}

function diamondGlow(g: Phaser.GameObjects.Graphics, s: number, neon: NeonColorPair, quality: VisualQuality): void {
  const alphas = getGlowAlphas(quality);
  const mults = getGlowRadiusMultipliers(quality);
  for (let i = 0; i < alphas.length; i++) {
    const r = s * mults[i];
    g.fillStyle(neon.glow, alphas[i]);
    g.beginPath();
    g.moveTo(0, -r);
    g.lineTo(r, 0);
    g.lineTo(0, r);
    g.lineTo(-r, 0);
    g.closePath();
    g.fillPath();
  }
}

function hexGlow(g: Phaser.GameObjects.Graphics, s: number, neon: NeonColorPair, quality: VisualQuality): void {
  const alphas = getGlowAlphas(quality);
  const mults = getGlowRadiusMultipliers(quality);
  for (let i = 0; i < alphas.length; i++) {
    const r = s * mults[i];
    g.fillStyle(neon.glow, alphas[i]);
    hexPath(g, r);
    g.fillPath();
  }
}

// =====================================================================
// PATH HELPERS
// =====================================================================

function hexPath(g: Phaser.GameObjects.Graphics, radius: number): void {
  g.beginPath();
  for (let i = 0; i < 6; i++) {
    const px = HEX_UNIT[i].cos * radius;
    const py = HEX_UNIT[i].sin * radius;
    if (i === 0) g.moveTo(px, py); else g.lineTo(px, py);
  }
  g.closePath();
}

function diamondPath(g: Phaser.GameObjects.Graphics, s: number): void {
  g.beginPath();
  g.moveTo(0, -s);
  g.lineTo(s, 0);
  g.lineTo(0, s);
  g.lineTo(-s, 0);
  g.closePath();
}

// Fill a path + stroke a white outline — used by many shape-based enemy bodies.
// Caller must build the path first (e.g. via diamondPath/hexPath), then call
// this helper. It reuses the same path via fill/stroke without rebuilding.
function fillAndOutlineDiamond(
  g: Phaser.GameObjects.Graphics,
  s: number,
  neon: NeonColorPair,
  strokeWidth: number = 2,
  strokeAlpha: number = 0.85
): void {
  g.fillStyle(neon.core, 1);
  diamondPath(g, s);
  g.fillPath();
  g.lineStyle(strokeWidth, 0xffffff, strokeAlpha);
  diamondPath(g, s);
  g.strokePath();
}

function fillAndOutlineHex(
  g: Phaser.GameObjects.Graphics,
  s: number,
  neon: NeonColorPair,
  strokeWidth: number = 2,
  strokeAlpha: number = 0.85
): void {
  g.fillStyle(neon.core, 1);
  hexPath(g, s);
  g.fillPath();
  g.lineStyle(strokeWidth, 0xffffff, strokeAlpha);
  hexPath(g, s);
  g.strokePath();
}

// =====================================================================
// BASIC ENEMIES
// =====================================================================

/** Shambler — blocky body with menacing eye dots */
function drawShambler(g: Phaser.GameObjects.Graphics, s: number, neon: NeonColorPair, quality: VisualQuality): void {
  squareGlow(g, s, neon, quality);
  g.fillStyle(neon.core, 1);
  g.fillRect(-s, -s, s * 2, s * 2);
  g.lineStyle(2, 0xffffff, 0.85);
  g.strokeRect(-s, -s, s * 2, s * 2);
  // Eyes (centered, visible from any rotation)
  const eyeR = Math.max(1.5, s * 0.18);
  g.fillStyle(0xffffff, 0.95);
  g.fillCircle(-s * 0.35, -s * 0.2, eyeR);
  g.fillCircle(s * 0.35, -s * 0.2, eyeR);
}

/** Zigzag Runner — swept-back chevron/arrow with engine thrust glow, looks fast */
function drawZigzag(g: Phaser.GameObjects.Graphics, s: number, neon: NeonColorPair, quality: VisualQuality): void {
  triangleGlow(g, s, neon, quality);

  // Baked engine thrust glow behind the tail. Static (texture is cached + shared across
  // instances); the speed-reactive wash is the motion trail added in GameScene.updateTrails.
  if (quality !== 'low') {
    const thrustColor = 0xff8833;
    g.fillStyle(thrustColor, 0.20);
    g.fillTriangle(-s * 0.38, s * 0.5, s * 0.38, s * 0.5, 0, s * 0.95);
    g.fillStyle(thrustColor, 0.42);
    g.fillTriangle(-s * 0.2, s * 0.45, s * 0.2, s * 0.45, 0, s * 0.8);
  }

  // Chevron core (nose at top = forward for triangles)
  g.fillStyle(neon.core, 1);
  g.beginPath();
  g.moveTo(0, -s * 1.1);        // sharp nose
  g.lineTo(s * 0.85, s * 0.65); // right wingtip
  g.lineTo(s * 0.15, s * 0.15); // right notch
  g.lineTo(0, s * 0.45);        // tail center
  g.lineTo(-s * 0.15, s * 0.15);
  g.lineTo(-s * 0.85, s * 0.65);
  g.closePath();
  g.fillPath();

  // Double outline: crisp white edge + faint neon halo for definition
  g.lineStyle(2.5, 0xffffff, 0.9);
  g.strokePath();
  if (quality !== 'low') {
    g.lineStyle(1, neon.glow, 0.5);
    g.strokePath();
  }
}

/** Dasher — elongated diamond with central speed streak */
function drawDasher(g: Phaser.GameObjects.Graphics, s: number, neon: NeonColorPair, quality: VisualQuality): void {
  diamondGlow(g, s, neon, quality);
  const h = s * 1.25;
  const w = s * 0.65;
  g.fillStyle(neon.core, 1);
  g.beginPath();
  g.moveTo(0, -h);
  g.lineTo(w, 0);
  g.lineTo(0, h);
  g.lineTo(-w, 0);
  g.closePath();
  g.fillPath();
  g.lineStyle(2, 0xffffff, 0.85);
  g.strokePath();
  // Speed line
  g.lineStyle(1.5, 0xffffff, 0.45);
  g.beginPath();
  g.moveTo(0, -h * 0.55);
  g.lineTo(0, h * 0.55);
  g.strokePath();
}

/** Circler — ring / donut with hollow center */
function drawCircler(g: Phaser.GameObjects.Graphics, s: number, neon: NeonColorPair, quality: VisualQuality): void {
  circleGlow(g, s, neon, quality);
  g.fillStyle(neon.core, 1);
  g.fillCircle(0, 0, s);
  g.lineStyle(2, 0xffffff, 0.85);
  g.strokeCircle(0, 0, s);
  // Hollow center
  g.fillStyle(0x000000, 0.7);
  g.fillCircle(0, 0, s * 0.4);
  g.lineStyle(1, 0xffffff, 0.45);
  g.strokeCircle(0, 0, s * 0.4);
}

/** Tiny Swarm — small 4-pointed star */
function drawSwarm(g: Phaser.GameObjects.Graphics, s: number, neon: NeonColorPair, quality: VisualQuality): void {
  circleGlow(g, s, neon, quality);
  const inner = s * 0.35;
  g.fillStyle(neon.core, 1);
  g.beginPath();
  g.moveTo(0, -s);
  g.lineTo(inner, -inner);
  g.lineTo(s, 0);
  g.lineTo(inner, inner);
  g.lineTo(0, s);
  g.lineTo(-inner, inner);
  g.lineTo(-s, 0);
  g.lineTo(-inner, -inner);
  g.closePath();
  g.fillPath();
  g.lineStyle(1.5, 0xffffff, 0.85);
  g.strokePath();
}

/** Exploder — sea-mine: circle with radial spikes + warning center dot */
function drawExploder(g: Phaser.GameObjects.Graphics, s: number, neon: NeonColorPair, quality: VisualQuality): void {
  circleGlow(g, s, neon, quality);
  // Alternating outer/inner radii creates star/mine shape
  const outerR = s;
  const innerR = s * 0.6;
  const spikeCount = 6;
  g.fillStyle(neon.core, 1);
  g.beginPath();
  for (let i = 0; i < spikeCount * 2; i++) {
    const angle = (Math.PI / spikeCount) * i - Math.PI / 2;
    const r = i % 2 === 0 ? outerR : innerR;
    const px = Math.cos(angle) * r;
    const py = Math.sin(angle) * r;
    if (i === 0) g.moveTo(px, py); else g.lineTo(px, py);
  }
  g.closePath();
  g.fillPath();
  g.lineStyle(2, 0xffffff, 0.85);
  g.strokePath();
  // Warning dot
  g.fillStyle(0xffffff, 0.7);
  g.fillCircle(0, 0, Math.max(1.5, s * 0.15));
}

/** Lurker — wide flat predator triangle with slit eyes */
function drawLurker(g: Phaser.GameObjects.Graphics, s: number, neon: NeonColorPair, quality: VisualQuality): void {
  triangleGlow(g, s, neon, quality);
  // Wide, flat triangle (nose at top = forward)
  g.fillStyle(neon.core, 1);
  g.beginPath();
  g.moveTo(0, -s * 0.65);
  g.lineTo(s * 1.1, s * 0.6);
  g.lineTo(-s * 1.1, s * 0.6);
  g.closePath();
  g.fillPath();
  g.lineStyle(2, 0xffffff, 0.85);
  g.strokePath();
  // Slit eyes
  if (s >= 7) {
    g.lineStyle(Math.max(1, s * 0.12), 0xffffff, 0.9);
    g.beginPath();
    g.moveTo(-s * 0.4, s * 0.05);
    g.lineTo(-s * 0.15, s * 0.05);
    g.strokePath();
    g.beginPath();
    g.moveTo(s * 0.15, s * 0.05);
    g.lineTo(s * 0.4, s * 0.05);
    g.strokePath();
  }
}

// =====================================================================
// ELITE ENEMIES
// =====================================================================

/** Tank — heavy double-bordered square with corner rivets */
function drawTank(g: Phaser.GameObjects.Graphics, s: number, neon: NeonColorPair, quality: VisualQuality): void {
  squareGlow(g, s, neon, quality);
  g.fillStyle(neon.core, 1);
  g.fillRect(-s, -s, s * 2, s * 2);
  g.lineStyle(2.5, 0xffffff, 0.85);
  g.strokeRect(-s, -s, s * 2, s * 2);
  // Inner armor plate
  const inner = s * 0.6;
  g.lineStyle(2, 0xffffff, 0.45);
  g.strokeRect(-inner, -inner, inner * 2, inner * 2);
  // Corner rivets
  if (s >= 12) {
    const rivetR = Math.max(1.5, s * 0.1);
    const offset = s * 0.75;
    g.fillStyle(0xffffff, 0.55);
    g.fillCircle(-offset, -offset, rivetR);
    g.fillCircle(offset, -offset, rivetR);
    g.fillCircle(-offset, offset, rivetR);
    g.fillCircle(offset, offset, rivetR);
  }
}

/** Splitter — hexagon with zigzag crack down the middle */
function drawSplitter(g: Phaser.GameObjects.Graphics, s: number, neon: NeonColorPair, quality: VisualQuality): void {
  hexGlow(g, s, neon, quality);
  fillAndOutlineHex(g, s, neon);
  // Zigzag crack
  g.lineStyle(Math.max(1.5, s * 0.1), 0xffffff, 0.65);
  g.beginPath();
  g.moveTo(0, -s * 0.8);
  g.lineTo(s * 0.15, -s * 0.3);
  g.lineTo(-s * 0.1, 0);
  g.lineTo(s * 0.15, s * 0.3);
  g.lineTo(0, s * 0.8);
  g.strokePath();
}

/** Splitter Mini — angular shard fragment */
function drawSplitterMini(g: Phaser.GameObjects.Graphics, s: number, neon: NeonColorPair, quality: VisualQuality): void {
  hexGlow(g, s, neon, quality);
  g.fillStyle(neon.core, 1);
  g.beginPath();
  g.moveTo(s * 0.1, -s);
  g.lineTo(s * 0.8, -s * 0.2);
  g.lineTo(s * 0.5, s * 0.7);
  g.lineTo(-s * 0.3, s * 0.85);
  g.lineTo(-s * 0.7, s * 0.1);
  g.lineTo(-s * 0.35, -s * 0.5);
  g.closePath();
  g.fillPath();
  g.lineStyle(2, 0xffffff, 0.85);
  g.strokePath();
}

/** Shooter — square body with gun barrel pointing forward (+X) */
function drawShooter(g: Phaser.GameObjects.Graphics, s: number, neon: NeonColorPair, quality: VisualQuality): void {
  squareGlow(g, s, neon, quality);
  // Body (slightly shorter horizontally to make room for barrel)
  g.fillStyle(neon.core, 1);
  g.fillRect(-s, -s, s * 1.7, s * 2);
  g.lineStyle(2, 0xffffff, 0.85);
  g.strokeRect(-s, -s, s * 1.7, s * 2);
  // Barrel pointing right (+X = forward)
  const barrelWidth = s * 0.3;
  const barrelLength = s * 0.75;
  g.fillStyle(neon.core, 1);
  g.fillRect(s * 0.7, -barrelWidth, barrelLength, barrelWidth * 2);
  g.lineStyle(2, 0xffffff, 0.85);
  g.strokeRect(s * 0.7, -barrelWidth, barrelLength, barrelWidth * 2);
  // Muzzle dot
  g.fillStyle(0xffffff, 0.75);
  g.fillCircle(s * 0.7 + barrelLength, 0, Math.max(1.5, barrelWidth * 0.45));
}

/** Sniper — very elongated thin triangle with crosshair scope */
function drawSniper(g: Phaser.GameObjects.Graphics, s: number, neon: NeonColorPair, quality: VisualQuality): void {
  triangleGlow(g, s, neon, quality);
  // Elongated thin triangle (nose at top = forward)
  g.fillStyle(neon.core, 1);
  g.beginPath();
  g.moveTo(0, -s * 1.45);
  g.lineTo(s * 0.45, s * 0.5);
  g.lineTo(-s * 0.45, s * 0.5);
  g.closePath();
  g.fillPath();
  g.lineStyle(2, 0xffffff, 0.85);
  g.strokePath();
  // Crosshair scope near tip
  if (s >= 6) {
    const scopeY = -s * 0.5;
    const scopeR = Math.max(2, s * 0.18);
    g.lineStyle(1.5, 0xffffff, 0.65);
    g.strokeCircle(0, scopeY, scopeR);
    g.beginPath();
    g.moveTo(0, scopeY - scopeR * 1.4);
    g.lineTo(0, scopeY + scopeR * 1.4);
    g.strokePath();
    g.beginPath();
    g.moveTo(-scopeR * 1.4, scopeY);
    g.lineTo(scopeR * 1.4, scopeY);
    g.strokePath();
  }
}

/** Healer — diamond with glowing + cross symbol */
function drawHealer(g: Phaser.GameObjects.Graphics, s: number, neon: NeonColorPair, quality: VisualQuality): void {
  diamondGlow(g, s, neon, quality);
  fillAndOutlineDiamond(g, s, neon);
  // + cross
  const crossThick = Math.max(1.5, s * 0.14);
  const crossLen = s * 0.45;
  g.fillStyle(0xffffff, 0.85);
  g.fillRect(-crossThick, -crossLen, crossThick * 2, crossLen * 2);
  g.fillRect(-crossLen, -crossThick, crossLen * 2, crossThick * 2);
}

/** Shielded — circle with 3 floating arc shield segments */
function drawShielded(g: Phaser.GameObjects.Graphics, s: number, neon: NeonColorPair, quality: VisualQuality): void {
  circleGlow(g, s, neon, quality);
  // Inner body
  const bodyR = s * 0.75;
  g.fillStyle(neon.core, 1);
  g.fillCircle(0, 0, bodyR);
  g.lineStyle(2, 0xffffff, 0.85);
  g.strokeCircle(0, 0, bodyR);
  // 3 shield arc segments
  const arcR = s * 1.0;
  g.lineStyle(Math.max(2, s * 0.12), 0xffffff, 0.6);
  for (let i = 0; i < 3; i++) {
    const startAngle = (Math.PI * 2 / 3) * i;
    g.beginPath();
    g.arc(0, 0, arcR, startAngle, startAngle + Math.PI * 0.45, false);
    g.strokePath();
  }
}

/** Teleporter — hollow diamond frame with bright center void */
function drawTeleporter(g: Phaser.GameObjects.Graphics, s: number, neon: NeonColorPair, quality: VisualQuality): void {
  diamondGlow(g, s, neon, quality);
  // Translucent fill
  g.fillStyle(neon.core, 0.25);
  diamondPath(g, s);
  g.fillPath();
  // Thick neon outline
  g.lineStyle(Math.max(2.5, s * 0.15), neon.core, 1);
  diamondPath(g, s);
  g.strokePath();
  g.lineStyle(1.5, 0xffffff, 0.85);
  diamondPath(g, s);
  g.strokePath();
  // Bright center void
  g.fillStyle(0xffffff, 0.7);
  g.fillCircle(0, 0, Math.max(2, s * 0.2));
}

/** Giant — massive armored square with X braces and corner spikes */
function drawGiant(g: Phaser.GameObjects.Graphics, s: number, neon: NeonColorPair, quality: VisualQuality): void {
  squareGlow(g, s, neon, quality);
  g.fillStyle(neon.core, 1);
  g.fillRect(-s, -s, s * 2, s * 2);
  g.lineStyle(3, 0xffffff, 0.85);
  g.strokeRect(-s, -s, s * 2, s * 2);
  // X cross braces
  g.lineStyle(2, 0xffffff, 0.35);
  g.beginPath();
  g.moveTo(-s * 0.8, -s * 0.8);
  g.lineTo(s * 0.8, s * 0.8);
  g.strokePath();
  g.beginPath();
  g.moveTo(s * 0.8, -s * 0.8);
  g.lineTo(-s * 0.8, s * 0.8);
  g.strokePath();
  // Corner spikes
  const spike = s * 0.22;
  g.fillStyle(neon.core, 1);
  g.fillRect(-s - spike * 0.5, -s - spike * 0.5, spike, spike);
  g.fillRect(s - spike * 0.5, -s - spike * 0.5, spike, spike);
  g.fillRect(-s - spike * 0.5, s - spike * 0.5, spike, spike);
  g.fillRect(s - spike * 0.5, s - spike * 0.5, spike, spike);
  // Menacing center eye
  g.fillStyle(0xffffff, 0.7);
  g.fillCircle(0, 0, Math.max(2, s * 0.12));
}

/** Warden — hexagon sentinel with concentric zone ring */
function drawWarden(g: Phaser.GameObjects.Graphics, s: number, neon: NeonColorPair, quality: VisualQuality): void {
  hexGlow(g, s, neon, quality);
  fillAndOutlineHex(g, s, neon);
  // Zone ring
  g.lineStyle(1.5, 0xffffff, 0.35);
  g.strokeCircle(0, 0, s * 1.25);
  // Inner hex pattern
  g.lineStyle(1.5, 0xffffff, 0.3);
  hexPath(g, s * 0.45);
  g.strokePath();
  // Center dot
  g.fillStyle(0xffffff, 0.6);
  g.fillCircle(0, 0, Math.max(1.5, s * 0.12));
}

/** Wraith — narrow diamond with trailing ghost wisps */
function drawWraith(g: Phaser.GameObjects.Graphics, s: number, neon: NeonColorPair, quality: VisualQuality): void {
  diamondGlow(g, s, neon, quality);
  // Narrow tall diamond
  g.fillStyle(neon.core, 1);
  g.beginPath();
  g.moveTo(0, -s);
  g.lineTo(s * 0.55, 0);
  g.lineTo(0, s);
  g.lineTo(-s * 0.55, 0);
  g.closePath();
  g.fillPath();
  g.lineStyle(2, 0xffffff, 0.85);
  g.strokePath();
  // Trailing wisps (left = behind for diamond enemies)
  g.lineStyle(Math.max(1.5, s * 0.1), neon.glow, 0.45);
  g.beginPath();
  g.moveTo(-s * 0.5, -s * 0.2);
  g.lineTo(-s * 1.15, -s * 0.15);
  g.strokePath();
  g.beginPath();
  g.moveTo(-s * 0.55, 0);
  g.lineTo(-s * 1.25, 0.05);
  g.strokePath();
  g.beginPath();
  g.moveTo(-s * 0.5, s * 0.2);
  g.lineTo(-s * 1.15, s * 0.15);
  g.strokePath();
}

/** Rallier — triangle emitting radiating signal lines */
function drawRallier(g: Phaser.GameObjects.Graphics, s: number, neon: NeonColorPair, quality: VisualQuality): void {
  triangleGlow(g, s, neon, quality);
  const triH = s * 1.2;
  g.fillStyle(neon.core, 1);
  g.beginPath();
  g.moveTo(0, -triH * 0.5);
  g.lineTo(s, triH * 0.5);
  g.lineTo(-s, triH * 0.5);
  g.closePath();
  g.fillPath();
  g.lineStyle(2, 0xffffff, 0.85);
  g.strokePath();
  // 3 radiating signal rays
  g.lineStyle(Math.max(1, s * 0.08), 0xffffff, 0.45);
  const rayInner = s * 0.75;
  const rayLen = s * 0.45;
  for (let i = 0; i < 3; i++) {
    const angle = -Math.PI / 2 + (Math.PI * 2 / 3) * i;
    g.beginPath();
    g.moveTo(Math.cos(angle) * rayInner, Math.sin(angle) * rayInner);
    g.lineTo(Math.cos(angle) * (rayInner + rayLen), Math.sin(angle) * (rayInner + rayLen));
    g.strokePath();
  }
}

// =====================================================================
// SPAWNED-ONLY ENEMIES
// =====================================================================

/** Ghost — translucent circle body with trailing tail */
function drawGhost(g: Phaser.GameObjects.Graphics, s: number, neon: NeonColorPair, quality: VisualQuality): void {
  circleGlow(g, s, neon, quality);
  const bodyR = s * 0.65;
  // Body (translucent for ghostly feel)
  g.fillStyle(neon.core, 0.6);
  g.fillCircle(s * 0.05, 0, bodyR);
  // Wavy tail trailing left (-X = behind)
  g.beginPath();
  g.moveTo(-bodyR * 0.7, -s * 0.4);
  g.lineTo(-s * 0.9, -s * 0.25);
  g.lineTo(-s * 0.7, 0);
  g.lineTo(-s * 0.95, s * 0.25);
  g.lineTo(-bodyR * 0.7, s * 0.4);
  g.lineTo(-bodyR * 0.3, 0);
  g.closePath();
  g.fillPath();
  // Outline
  g.lineStyle(1.5, 0xffffff, 0.5);
  g.strokeCircle(s * 0.05, 0, bodyR);
  // Eyes
  const eyeR = Math.max(1.2, s * 0.1);
  g.fillStyle(0xffffff, 0.9);
  g.fillCircle(s * 0.15, -s * 0.12, eyeR);
  g.fillCircle(s * 0.15, s * 0.12, eyeR);
}

/** Turret — square with cross-shaped barrel mount (multi-directional) */
function drawTurret(g: Phaser.GameObjects.Graphics, s: number, neon: NeonColorPair, quality: VisualQuality): void {
  squareGlow(g, s, neon, quality);
  // Central body (smaller square)
  const bodyS = s * 0.65;
  g.fillStyle(neon.core, 1);
  g.fillRect(-bodyS, -bodyS, bodyS * 2, bodyS * 2);
  g.lineStyle(2, 0xffffff, 0.85);
  g.strokeRect(-bodyS, -bodyS, bodyS * 2, bodyS * 2);
  // Cross barrels extending in 4 directions
  const barrelW = s * 0.18;
  g.fillStyle(neon.core, 1);
  g.fillRect(-barrelW, -s, barrelW * 2, s * 2);   // vertical
  g.fillRect(-s, -barrelW, s * 2, barrelW * 2);   // horizontal
  g.lineStyle(1.5, 0xffffff, 0.65);
  g.strokeRect(-barrelW, -s, barrelW * 2, s * 2);
  g.strokeRect(-s, -barrelW, s * 2, barrelW * 2);
}

// =====================================================================
// MINIBOSSES
// =====================================================================

/** The Glutton — large circle with jagged maw facing forward (+X) */
function drawGlutton(g: Phaser.GameObjects.Graphics, s: number, neon: NeonColorPair, quality: VisualQuality): void {
  circleGlow(g, s, neon, quality);
  g.fillStyle(neon.core, 1);
  g.fillCircle(0, 0, s);
  g.lineStyle(2.5, 0xffffff, 0.85);
  g.strokeCircle(0, 0, s);
  // Dark mouth opening (right side = forward)
  g.fillStyle(0x000000, 0.8);
  g.beginPath();
  g.moveTo(s * 0.25, -s * 0.4);
  g.lineTo(s * 1.0, 0);
  g.lineTo(s * 0.25, s * 0.4);
  g.closePath();
  g.fillPath();
  // Jagged teeth in mouth
  g.lineStyle(Math.max(1.5, s * 0.06), 0xffffff, 0.9);
  g.beginPath();
  g.moveTo(s * 0.3, -s * 0.35);
  g.lineTo(s * 0.55, -s * 0.18);
  g.lineTo(s * 0.4, 0);
  g.lineTo(s * 0.55, s * 0.18);
  g.lineTo(s * 0.3, s * 0.35);
  g.strokePath();
  // Hungry eye
  g.fillStyle(0xffffff, 0.9);
  g.fillCircle(-s * 0.25, -s * 0.25, Math.max(2, s * 0.12));
}

/** Swarm Mother — hexagonal hive with egg dots inside */
function drawSwarmMother(g: Phaser.GameObjects.Graphics, s: number, neon: NeonColorPair, quality: VisualQuality): void {
  hexGlow(g, s, neon, quality);
  fillAndOutlineHex(g, s, neon, 2.5);
  // Inner honeycomb hex
  g.lineStyle(1.5, 0xffffff, 0.3);
  hexPath(g, s * 0.55);
  g.strokePath();
  // Egg dots
  const eggR = Math.max(2, s * 0.11);
  g.fillStyle(0xffffff, 0.5);
  g.fillCircle(0, 0, eggR);
  g.fillCircle(-s * 0.32, -s * 0.2, eggR);
  g.fillCircle(s * 0.32, -s * 0.2, eggR);
  g.fillCircle(-s * 0.2, s * 0.32, eggR);
  g.fillCircle(s * 0.2, s * 0.32, eggR);
}

/** The Charger — aggressive triangle with massive forward horn */
function drawCharger(g: Phaser.GameObjects.Graphics, s: number, neon: NeonColorPair, quality: VisualQuality): void {
  triangleGlow(g, s, neon, quality);
  // Wide aggressive body
  g.fillStyle(neon.core, 1);
  g.beginPath();
  g.moveTo(0, -s * 0.75);
  g.lineTo(s * 1.1, s * 0.8);
  g.lineTo(-s * 1.1, s * 0.8);
  g.closePath();
  g.fillPath();
  g.lineStyle(3, 0xffffff, 0.85);
  g.strokePath();
  // Extended horn/spike from nose
  g.fillStyle(neon.core, 1);
  g.beginPath();
  g.moveTo(0, -s * 1.5);      // horn tip
  g.lineTo(s * 0.15, -s * 0.75);
  g.lineTo(-s * 0.15, -s * 0.75);
  g.closePath();
  g.fillPath();
  g.lineStyle(2, 0xffffff, 0.85);
  g.strokePath();
  // Angry eyes
  const eyeR = Math.max(2, s * 0.09);
  g.fillStyle(0xffffff, 0.9);
  g.fillCircle(-s * 0.35, s * 0.15, eyeR);
  g.fillCircle(s * 0.35, s * 0.15, eyeR);
}

/** Necromancer — diamond with skull-like face (eye sockets + jaw) */
function drawNecromancer(g: Phaser.GameObjects.Graphics, s: number, neon: NeonColorPair, quality: VisualQuality): void {
  diamondGlow(g, s, neon, quality);
  fillAndOutlineDiamond(g, s, neon, 2.5);
  // Eye sockets (dark hollows with bright pupils)
  const socketR = Math.max(2.5, s * 0.14);
  g.fillStyle(0x000000, 0.65);
  g.fillCircle(-s * 0.25, -s * 0.2, socketR);
  g.fillCircle(s * 0.25, -s * 0.2, socketR);
  g.fillStyle(0xffffff, 0.85);
  g.fillCircle(-s * 0.25, -s * 0.2, socketR * 0.45);
  g.fillCircle(s * 0.25, -s * 0.2, socketR * 0.45);
  // Jaw line
  g.lineStyle(Math.max(1.5, s * 0.06), 0xffffff, 0.45);
  g.beginPath();
  g.moveTo(-s * 0.2, s * 0.15);
  g.lineTo(0, s * 0.3);
  g.lineTo(s * 0.2, s * 0.15);
  g.strokePath();
}

/** Twin Alpha — diamond with linking arc on right side */
function drawTwinA(g: Phaser.GameObjects.Graphics, s: number, neon: NeonColorPair, quality: VisualQuality): void {
  diamondGlow(g, s, neon, quality);
  fillAndOutlineDiamond(g, s, neon);
  // Linking arc (right side)
  g.lineStyle(2, 0xffffff, 0.55);
  g.beginPath();
  g.arc(0, 0, s * 1.1, -Math.PI * 0.3, Math.PI * 0.3, false);
  g.strokePath();
  // Center eye
  g.fillStyle(0xffffff, 0.8);
  g.fillCircle(0, 0, Math.max(2, s * 0.12));
}

/** Twin Beta — diamond with linking arc on left side */
function drawTwinB(g: Phaser.GameObjects.Graphics, s: number, neon: NeonColorPair, quality: VisualQuality): void {
  diamondGlow(g, s, neon, quality);
  fillAndOutlineDiamond(g, s, neon);
  // Linking arc (left side)
  g.lineStyle(2, 0xffffff, 0.55);
  g.beginPath();
  g.arc(0, 0, s * 1.1, Math.PI * 0.7, Math.PI * 1.3, false);
  g.strokePath();
  // Center eye
  g.fillStyle(0xffffff, 0.8);
  g.fillCircle(0, 0, Math.max(2, s * 0.12));
}

/** The Bombard — hexagonal siege platform with a forward mortar barrel + shell ports */
function drawBombard(g: Phaser.GameObjects.Graphics, s: number, neon: NeonColorPair, quality: VisualQuality): void {
  hexGlow(g, s, neon, quality);
  fillAndOutlineHex(g, s, neon, 2.5);
  // Mortar barrel — thick stub pointing forward (+x = toward the player)
  g.fillStyle(0x222222, 0.9);
  g.fillRect(s * 0.2, -s * 0.28, s * 1.05, s * 0.56);
  g.lineStyle(2.5, 0xffffff, 0.8);
  g.strokeRect(s * 0.2, -s * 0.28, s * 1.05, s * 0.56);
  // Muzzle ring at the barrel mouth
  g.lineStyle(Math.max(1.5, s * 0.08), neon.core, 0.9);
  g.strokeCircle(s * 1.25, 0, s * 0.22);
  // Shell loader ports (rear)
  const portR = Math.max(2, s * 0.13);
  g.fillStyle(0xffffff, 0.55);
  g.fillCircle(-s * 0.35, -s * 0.3, portR);
  g.fillCircle(-s * 0.35, s * 0.3, portR);
  g.fillCircle(-s * 0.5, 0, portR);
}

// =====================================================================
// BOSSES
// =====================================================================

/** The Horde King — massive crowned square with royal insignia */
function drawHordeKing(g: Phaser.GameObjects.Graphics, s: number, neon: NeonColorPair, quality: VisualQuality): void {
  squareGlow(g, s, neon, quality);
  g.fillStyle(neon.core, 1);
  g.fillRect(-s, -s, s * 2, s * 2);
  g.lineStyle(3, 0xffffff, 0.85);
  g.strokeRect(-s, -s, s * 2, s * 2);
  // Crown — 3 points along top edge
  const crownH = s * 0.45;
  g.fillStyle(neon.core, 1);
  g.beginPath();
  g.moveTo(-s * 0.8, -s);
  g.lineTo(-s * 0.5, -s - crownH * 0.6);
  g.lineTo(-s * 0.2, -s);
  g.lineTo(0, -s - crownH);
  g.lineTo(s * 0.2, -s);
  g.lineTo(s * 0.5, -s - crownH * 0.6);
  g.lineTo(s * 0.8, -s);
  g.closePath();
  g.fillPath();
  g.lineStyle(2.5, 0xffffff, 0.85);
  g.strokePath();
  // Royal X pattern
  g.lineStyle(2, 0xffffff, 0.3);
  g.beginPath();
  g.moveTo(-s * 0.65, -s * 0.65);
  g.lineTo(s * 0.65, s * 0.65);
  g.strokePath();
  g.beginPath();
  g.moveTo(s * 0.65, -s * 0.65);
  g.lineTo(-s * 0.65, s * 0.65);
  g.strokePath();
  // Center gem
  g.fillStyle(0xffffff, 0.8);
  g.fillCircle(0, 0, Math.max(3, s * 0.1));
  // Crown tip gems
  g.fillStyle(0xffffff, 0.7);
  g.fillCircle(0, -s - crownH, Math.max(2, s * 0.06));
  g.fillCircle(-s * 0.5, -s - crownH * 0.6, Math.max(2, s * 0.05));
  g.fillCircle(s * 0.5, -s - crownH * 0.6, Math.max(2, s * 0.05));
}

/** Void Wyrm — concentric portal rings with dark void center + tendrils */
function drawVoidWyrm(g: Phaser.GameObjects.Graphics, s: number, neon: NeonColorPair, quality: VisualQuality): void {
  circleGlow(g, s, neon, quality);
  // Outer ring
  g.fillStyle(neon.core, 1);
  g.fillCircle(0, 0, s);
  g.lineStyle(2.5, 0xffffff, 0.85);
  g.strokeCircle(0, 0, s);
  // Middle ring
  g.fillStyle(neon.core, 0.65);
  g.fillCircle(0, 0, s * 0.65);
  g.lineStyle(2, 0xffffff, 0.55);
  g.strokeCircle(0, 0, s * 0.65);
  // Dark void center
  g.fillStyle(0x000000, 0.8);
  g.fillCircle(0, 0, s * 0.33);
  g.lineStyle(1.5, neon.glow, 0.65);
  g.strokeCircle(0, 0, s * 0.33);
  // 4 tendrils extending outward from diagonal corners
  g.lineStyle(Math.max(2, s * 0.06), neon.glow, 0.55);
  for (let i = 0; i < 4; i++) {
    const angle = (Math.PI / 2) * i + Math.PI / 4;
    const startR = s * 0.88;
    const endR = s * 1.3;
    g.beginPath();
    g.moveTo(Math.cos(angle) * startR, Math.sin(angle) * startR);
    g.lineTo(Math.cos(angle + 0.2) * endR, Math.sin(angle + 0.2) * endR);
    g.strokePath();
  }
}

/** The Machine — gear-toothed hexagon with internal machinery */
function drawTheMachine(g: Phaser.GameObjects.Graphics, s: number, neon: NeonColorPair, quality: VisualQuality): void {
  hexGlow(g, s, neon, quality);
  // Gear-tooth silhouette: 12 points alternating outer/inner radius
  g.fillStyle(neon.core, 1);
  g.beginPath();
  for (let i = 0; i < 12; i++) {
    const angle = (Math.PI / 6) * i - Math.PI / 2;
    const r = i % 2 === 0 ? s : s * 0.82;
    const px = Math.cos(angle) * r;
    const py = Math.sin(angle) * r;
    if (i === 0) g.moveTo(px, py); else g.lineTo(px, py);
  }
  g.closePath();
  g.fillPath();
  g.lineStyle(3, 0xffffff, 0.85);
  g.strokePath();
  // Internal cross (machinery)
  g.lineStyle(2, 0xffffff, 0.35);
  g.beginPath();
  g.moveTo(0, -s * 0.6);
  g.lineTo(0, s * 0.6);
  g.strokePath();
  g.beginPath();
  g.moveTo(-s * 0.6, 0);
  g.lineTo(s * 0.6, 0);
  g.strokePath();
  // Central gear ring
  g.lineStyle(2, 0xffffff, 0.55);
  g.strokeCircle(0, 0, s * 0.25);
  // Center eye
  g.fillStyle(0xffffff, 0.7);
  g.fillCircle(0, 0, Math.max(2.5, s * 0.08));
}

/** The Bastion — bastioned fortress walls, battlements, central mortar tube */
function drawBastion(g: Phaser.GameObjects.Graphics, s: number, neon: NeonColorPair, quality: VisualQuality): void {
  squareGlow(g, s, neon, quality);
  // Fortress silhouette: wide walls flaring to corner bastions (octagonal keep)
  const wallHalfWidth = s;
  const bastionReach = s * 1.18;
  g.fillStyle(neon.core, 1);
  g.beginPath();
  g.moveTo(-bastionReach, -s * 0.55);
  g.lineTo(-wallHalfWidth * 0.55, -s);
  g.lineTo(wallHalfWidth * 0.55, -s);
  g.lineTo(bastionReach, -s * 0.55);
  g.lineTo(bastionReach, s * 0.55);
  g.lineTo(wallHalfWidth * 0.55, s);
  g.lineTo(-wallHalfWidth * 0.55, s);
  g.lineTo(-bastionReach, s * 0.55);
  g.closePath();
  g.fillPath();
  g.lineStyle(3, 0xffffff, 0.85);
  g.strokePath();
  // Battlements: crenellated notches along the forward (+X) wall
  g.fillStyle(0x000000, 0.45);
  for (let i = -1; i <= 1; i++) {
    g.fillRect(bastionReach - s * 0.16, i * s * 0.34 - s * 0.09, s * 0.16, s * 0.18);
  }
  // Inner keep ring
  g.lineStyle(2, 0xffffff, 0.4);
  g.strokeCircle(0, 0, s * 0.55);
  // Central mortar tube aimed forward (+X), with dark muzzle
  g.fillStyle(neon.core, 1);
  g.fillRect(0, -s * 0.16, s * 0.85, s * 0.32);
  g.lineStyle(2, 0xffffff, 0.7);
  g.strokeRect(0, -s * 0.16, s * 0.85, s * 0.32);
  g.fillStyle(0x000000, 0.8);
  g.fillCircle(s * 0.85, 0, s * 0.14);
  g.lineStyle(1.5, neon.glow, 0.8);
  g.strokeCircle(s * 0.85, 0, s * 0.14);
  // Shell racks: paired dots on the rear walls
  g.fillStyle(0xffffff, 0.6);
  g.fillCircle(-s * 0.6, -s * 0.45, Math.max(2, s * 0.07));
  g.fillCircle(-s * 0.6, s * 0.45, Math.max(2, s * 0.07));
  // Command eye
  g.fillStyle(0xffffff, 0.8);
  g.fillCircle(0, 0, Math.max(3, s * 0.1));
}

/** The Legion — swarm-lord: a membrane blob of clustered cells, forward eye cluster */
function drawLegion(g: Phaser.GameObjects.Graphics, s: number, neon: NeonColorPair, quality: VisualQuality): void {
  circleGlow(g, s, neon, quality);
  // Outer membrane
  g.fillStyle(neon.core, 1);
  g.fillCircle(0, 0, s);
  g.lineStyle(3, 0xffffff, 0.85);
  g.strokeCircle(0, 0, s);
  // Cell lobes — the fragments it will split into, visible under the skin
  g.lineStyle(2, 0xffffff, 0.4);
  for (let i = 0; i < 6; i++) {
    const angle = (Math.PI / 3) * i;
    g.strokeCircle(Math.cos(angle) * s * 0.55, Math.sin(angle) * s * 0.55, s * 0.34);
  }
  g.strokeCircle(0, 0, s * 0.36);
  // Forward eye cluster (+X): one large + two small
  g.fillStyle(0xffffff, 0.9);
  g.fillCircle(s * 0.45, 0, Math.max(3, s * 0.12));
  g.fillStyle(0xffffff, 0.65);
  g.fillCircle(s * 0.28, -s * 0.28, Math.max(2, s * 0.07));
  g.fillCircle(s * 0.28, s * 0.28, Math.max(2, s * 0.07));
}

/** Legion fragment/mote — a torn-off cell cluster (shared drawer; s conveys the tier) */
function drawLegionFragment(g: Phaser.GameObjects.Graphics, s: number, neon: NeonColorPair, quality: VisualQuality): void {
  circleGlow(g, s, neon, quality);
  g.fillStyle(neon.core, 1);
  g.fillCircle(0, 0, s * 0.85);
  // Two trailing lobes (-X) — reads as a blob torn off the parent
  g.fillCircle(-s * 0.55, -s * 0.4, s * 0.42);
  g.fillCircle(-s * 0.55, s * 0.4, s * 0.42);
  g.lineStyle(2.5, 0xffffff, 0.85);
  g.strokeCircle(0, 0, s * 0.85);
  // Single forward eye
  g.fillStyle(0xffffff, 0.9);
  g.fillCircle(s * 0.3, 0, Math.max(2.5, s * 0.14));
}

/** The Pulsar — collapsed star: radiating energy spokes around a bright core */
function drawPulsar(
  g: Phaser.GameObjects.Graphics,
  s: number,
  neon: NeonColorPair,
  quality: VisualQuality
): void {
  circleGlow(g, s, neon, quality);
  const spokeCount = 6;
  // Radiating spokes (thin triangles from the core outward)
  g.fillStyle(neon.core, 1);
  for (let i = 0; i < spokeCount; i++) {
    const angle = (Math.PI * 2 / spokeCount) * i;
    const tipX = Math.cos(angle) * s * 1.15;
    const tipY = Math.sin(angle) * s * 1.15;
    g.beginPath();
    g.moveTo(Math.cos(angle + 0.16) * s * 0.35, Math.sin(angle + 0.16) * s * 0.35);
    g.lineTo(tipX, tipY);
    g.lineTo(Math.cos(angle - 0.16) * s * 0.35, Math.sin(angle - 0.16) * s * 0.35);
    g.closePath();
    g.fillPath();
  }
  // Core disc
  g.fillStyle(neon.core, 1);
  g.fillCircle(0, 0, s * 0.5);
  g.lineStyle(3, 0xffffff, 0.9);
  g.strokeCircle(0, 0, s * 0.5);
  // Event-horizon accent ring
  g.lineStyle(2, neon.glow, 0.7);
  g.strokeCircle(0, 0, s * 0.78);
  // Bright center
  g.fillStyle(0xffffff, 0.95);
  g.fillCircle(0, 0, Math.max(3, s * 0.2));
  // Spoke-tip nodes (skip on low quality)
  if (quality !== 'low') {
    g.fillStyle(0xffffff, 0.8);
    for (let i = 0; i < spokeCount; i++) {
      const angle = (Math.PI * 2 / spokeCount) * i;
      g.fillCircle(Math.cos(angle) * s * 1.15, Math.sin(angle) * s * 1.15, Math.max(2, s * 0.09));
    }
  }
}

/** The Obelisk — a looming energy monolith emitting horizontal scan-lines */
function drawObelisk(
  g: Phaser.GameObjects.Graphics,
  s: number,
  neon: NeonColorPair,
  quality: VisualQuality,
): void {
  squareGlow(g, s, neon, quality);
  const halfWidth = s * 0.55;
  const halfHeight = s * 1.05;
  // Monolith body: a tall slab with a chamfered top.
  g.fillStyle(neon.core, 1);
  g.beginPath();
  g.moveTo(0, -halfHeight);
  g.lineTo(halfWidth, -halfHeight * 0.55);
  g.lineTo(halfWidth, halfHeight);
  g.lineTo(-halfWidth, halfHeight);
  g.lineTo(-halfWidth, -halfHeight * 0.55);
  g.closePath();
  g.fillPath();
  g.lineStyle(2.5, 0xffffff, 0.9);
  g.strokePath();
  // Horizontal scan-lines (the walls it projects).
  g.lineStyle(2, neon.glow, 0.8);
  for (const lineY of [-halfHeight * 0.3, 0, halfHeight * 0.35]) {
    g.beginPath();
    g.moveTo(-halfWidth, lineY);
    g.lineTo(halfWidth, lineY);
    g.strokePath();
  }
  // Bright energy core.
  g.fillStyle(0xffffff, 0.95);
  g.fillCircle(0, 0, Math.max(3, s * 0.22));
  // Side emitter nodes (skip on low quality).
  if (quality !== 'low') {
    g.fillStyle(0xffffff, 0.8);
    g.fillCircle(-halfWidth, 0, Math.max(2, s * 0.1));
    g.fillCircle(halfWidth, 0, Math.max(2, s * 0.1));
  }
}

/** The Helix — a spinning energy core with two curved spiral arms of nodes */
function drawHelix(
  g: Phaser.GameObjects.Graphics,
  s: number,
  neon: NeonColorPair,
  quality: VisualQuality,
): void {
  circleGlow(g, s, neon, quality);
  // Two spiral arms of shrinking nodes curling outward.
  const arms = 2;
  const dotsPerArm = quality === 'low' ? 4 : 7;
  g.fillStyle(neon.core, 1);
  for (let arm = 0; arm < arms; arm++) {
    const armOffset = (Math.PI * 2 / arms) * arm;
    for (let k = 0; k < dotsPerArm; k++) {
      const radius = s * (0.35 + k * 0.16);
      const angle = armOffset + k * 0.55;
      const dotRadius = Math.max(1.5, s * (0.16 - k * 0.015));
      g.fillCircle(Math.cos(angle) * radius, Math.sin(angle) * radius, dotRadius);
    }
  }
  // Core disc + event-horizon accent ring.
  g.fillStyle(neon.core, 1);
  g.fillCircle(0, 0, s * 0.42);
  g.lineStyle(3, 0xffffff, 0.9);
  g.strokeCircle(0, 0, s * 0.42);
  g.lineStyle(2, neon.glow, 0.7);
  g.strokeCircle(0, 0, s * 0.82);
  // Bright center.
  g.fillStyle(0xffffff, 0.95);
  g.fillCircle(0, 0, Math.max(3, s * 0.2));
}

// =====================================================================
// DRAWER REGISTRY
// =====================================================================

const ENEMY_DRAWERS: Record<string, EnemyDrawFn> = {
  // Basic
  basic: drawShambler,
  zigzag: drawZigzag,
  dasher: drawDasher,
  circler: drawCircler,
  swarm: drawSwarm,
  exploder: drawExploder,
  lurker: drawLurker,
  // Elite
  tank: drawTank,
  splitter: drawSplitter,
  splitter_mini: drawSplitterMini,
  shooter: drawShooter,
  sniper: drawSniper,
  healer: drawHealer,
  shielded: drawShielded,
  teleporter: drawTeleporter,
  giant: drawGiant,
  warden: drawWarden,
  wraith: drawWraith,
  rallier: drawRallier,
  // Spawned-only
  ghost: drawGhost,
  turret: drawTurret,
  // Minibosses
  glutton: drawGlutton,
  swarm_mother: drawSwarmMother,
  charger: drawCharger,
  necromancer: drawNecromancer,
  twin_a: drawTwinA,
  twin_b: drawTwinB,
  bombard: drawBombard,
  // Bosses
  horde_king: drawHordeKing,
  void_wyrm: drawVoidWyrm,
  the_machine: drawTheMachine,
  the_bastion: drawBastion,
  the_legion: drawLegion,
  the_pulsar: drawPulsar,
  the_obelisk: drawObelisk,
  the_helix: drawHelix,
  legion_fragment: drawLegionFragment,
  legion_mote: drawLegionFragment,
};

// =====================================================================
// TEXTURE CACHE
// =====================================================================

const enemyTextureCache = new Map<string, string>();
let enemyTextureCacheId = 0;

/**
 * Creates a cached enemy visual with custom procedural drawing.
 * Falls back to generic glow shape if no custom drawer exists.
 */
export function createCachedEnemyVisual(
  scene: Phaser.Scene,
  x: number,
  y: number,
  enemyTypeId: string,
  size: number,
  baseShape: EnemyShape,
  neonColor: NeonColorPair,
  quality: VisualQuality,
): Phaser.GameObjects.Container {
  const drawFn = ENEMY_DRAWERS[enemyTypeId];
  if (!drawFn) {
    return createCachedGlowingShape(scene, x, y, size, baseShape, neonColor, quality);
  }

  const cacheKey = `ev_${enemyTypeId}_${size}_${quality}`;
  let textureKey = enemyTextureCache.get(cacheKey);

  if (!textureKey || !scene.textures.exists(textureKey)) {
    // Draw into temp container
    const tempContainer = scene.add.container(0, 0);
    const graphics = scene.add.graphics();
    drawFn(graphics, size, neonColor, quality);
    tempContainer.add(graphics);

    // Generous padding — details may extend beyond base shape
    const padding = size * 1.8 + 12;
    const texWidth = Math.ceil(padding * 2);
    const texHeight = Math.ceil(padding * 2);

    textureKey = `enemy_vis_${enemyTextureCacheId++}`;
    const renderTexture = scene.add.renderTexture(0, 0, texWidth, texHeight);
    renderTexture.draw(tempContainer, padding, padding);
    renderTexture.saveTexture(textureKey);
    renderTexture.destroy();
    tempContainer.destroy();

    enemyTextureCache.set(cacheKey, textureKey);
  }

  const container = scene.add.container(x, y);
  const image = scene.add.image(0, 0, textureKey);
  container.add(image);
  return container;
}

/**
 * Reset enemy texture cache — call on scene shutdown or quality change.
 */
export function resetEnemyTextureCache(scene: Phaser.Scene): void {
  for (const textureKey of enemyTextureCache.values()) {
    if (scene.textures.exists(textureKey)) {
      scene.textures.remove(textureKey);
    }
  }
  enemyTextureCache.clear();
  enemyTextureCacheId = 0;
}
