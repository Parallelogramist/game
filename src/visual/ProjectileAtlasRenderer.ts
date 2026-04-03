/**
 * Pre-renders projectile shapes into texture atlases for GPU-batched rendering.
 *
 * Instead of each projectile being a separate Phaser.GameObjects.Graphics (which
 * forces a WebGL batch flush per object), projectiles become Image sprites using
 * frames from a shared atlas. This allows hundreds of projectiles to batch into
 * a single draw call.
 *
 * Pattern follows Gem3DRenderer.generateGemAtlases().
 */

// ============================================================================
// Atlas Keys
// ============================================================================

export const PROJECTILE_ATLAS_KEY = '__projectile_atlas__';

// ============================================================================
// Frame Layout
// ============================================================================

// ProjectileWeapon: 4 soul colors × 3 quality = 12 frames (rows 0-2, cols 0-3)
// RicochetWeapon:   2 colors (normal, echo) × 3 quality = 6 frames (rows 0-2, cols 4-5)
// HomingMissile:    2 types (missile, bomblet) × 3 quality = 6 frames (rows 0-2, cols 6-7)
// ShurikenWeapon:   2 types (normal 4-blade, cyclone 6-blade) × 3 quality = 6 frames (rows 0-2, cols 8-9)
// DroneProjectile:  2 colors (normal, synced) × 3 quality = 6 frames (rows 0-2, cols 10-11)
// DroneBody:        1 variant × 3 quality = 3 frames (rows 0-2, col 12)
// Total: 39 frames

const FRAME_SIZE = 64;
const PADDING = 4;
const PADDED_SIZE = FRAME_SIZE + PADDING * 2;

// Quality row indices
const ROW_LOW = 0;
const ROW_MEDIUM = 1;
const ROW_HIGH = 2;
const ROW_COUNT = 3;

// Column assignments
const COL_PROJ_BLUE = 0;
// Cols 1-3 are soul color variants (purple, gold, white) addressed via COL_PROJ_BLUE + colorIdx
const COL_RICOCHET_NORMAL = 4;
const COL_RICOCHET_ECHO = 5;
const COL_MISSILE_MAIN = 6;
const COL_MISSILE_BOMBLET = 7;
const COL_SHURIKEN_NORMAL = 8;
const COL_SHURIKEN_CYCLONE = 9;
const COL_DRONE_PROJ_NORMAL = 10;
const COL_DRONE_PROJ_SYNCED = 11;
const COL_DRONE_BODY = 12;
const COL_COUNT = 13;

// ============================================================================
// Frame Index Helpers (exported for weapon code)
// ============================================================================

type QualityIndex = 0 | 1 | 2;

function qualityToRow(quality: string): QualityIndex {
  if (quality === 'low') return ROW_LOW as QualityIndex;
  if (quality === 'medium') return ROW_MEDIUM as QualityIndex;
  return ROW_HIGH as QualityIndex;
}

function frameIndex(row: number, col: number): number {
  return row * COL_COUNT + col;
}

/** ProjectileWeapon frame: soul color 0-3 × quality */
export function getProjectileFrame(soulKills: number, quality: string): number {
  const colorCol = Math.min(soulKills, 3);
  return frameIndex(qualityToRow(quality), COL_PROJ_BLUE + colorCol);
}

/** RicochetWeapon frame: isEcho × quality */
export function getRicochetFrame(isEcho: boolean, quality: string): number {
  return frameIndex(qualityToRow(quality), isEcho ? COL_RICOCHET_ECHO : COL_RICOCHET_NORMAL);
}

/** HomingMissileWeapon frame: isBomblet × quality */
export function getMissileFrame(isBomblet: boolean, quality: string): number {
  return frameIndex(qualityToRow(quality), isBomblet ? COL_MISSILE_BOMBLET : COL_MISSILE_MAIN);
}

/** ShurikenWeapon frame: isCyclone × quality */
export function getShurikenFrame(isCyclone: boolean, quality: string): number {
  return frameIndex(qualityToRow(quality), isCyclone ? COL_SHURIKEN_CYCLONE : COL_SHURIKEN_NORMAL);
}

/** DroneWeapon projectile frame: isSynchronized × quality */
export function getDroneProjectileFrame(isSynchronized: boolean, quality: string): number {
  return frameIndex(qualityToRow(quality), isSynchronized ? COL_DRONE_PROJ_SYNCED : COL_DRONE_PROJ_NORMAL);
}

/** DroneWeapon body frame: quality */
export function getDroneBodyFrame(quality: string): number {
  return frameIndex(qualityToRow(quality), COL_DRONE_BODY);
}

// ============================================================================
// Shape Drawing Functions
// ============================================================================

function drawProjectileShape(
  g: Phaser.GameObjects.Graphics,
  quality: string,
  fillColor: number,
  _trailColor: number,
): void {
  const size = 3; // base size (stats.size * 0.25 + piercing * 0.5 at base)
  const length = size * 4;
  const width = size * 2;

  // Glow halo
  g.fillStyle(fillColor, 0.25);
  g.fillCircle(0, 0, size * 3);

  if (quality === 'low') {
    // 4-vertex diamond pointing right (angle=0)
    g.fillStyle(fillColor, 1);
    g.beginPath();
    g.moveTo(length, 0);       // front
    g.lineTo(0, width);        // right (screen-down)
    g.lineTo(-length * 0.5, 0); // back
    g.lineTo(0, -width);       // left (screen-up)
    g.closePath();
    g.fillPath();

    g.lineStyle(1, 0xffffff, 0.8);
    g.beginPath();
    g.moveTo(length, 0);
    g.lineTo(0, width);
    g.lineTo(-length * 0.5, 0);
    g.lineTo(0, -width);
    g.closePath();
    g.strokePath();
  } else {
    // 7-vertex energy bolt pointing right
    const rightShoulderX = 0;
    const rightShoulderY = width * 1.2;
    const rightRearX = -length * 0.5;
    const rightRearY = width * 0.5;
    const notchX = -length * 0.15;
    const notchY = 0;
    const leftRearX = -length * 0.5;
    const leftRearY = -width * 0.5;
    const leftShoulderX = 0;
    const leftShoulderY = -width * 1.2;

    g.fillStyle(fillColor, 1);
    g.beginPath();
    g.moveTo(length, 0);
    g.lineTo(rightShoulderX, rightShoulderY);
    g.lineTo(rightRearX, rightRearY);
    g.lineTo(notchX, notchY);
    g.lineTo(leftRearX, leftRearY);
    g.lineTo(leftShoulderX, leftShoulderY);
    g.closePath();
    g.fillPath();

    g.lineStyle(1, 0xffffff, 0.8);
    g.beginPath();
    g.moveTo(length, 0);
    g.lineTo(rightShoulderX, rightShoulderY);
    g.lineTo(rightRearX, rightRearY);
    g.lineTo(notchX, notchY);
    g.lineTo(leftRearX, leftRearY);
    g.lineTo(leftShoulderX, leftShoulderY);
    g.closePath();
    g.strokePath();

    if (quality === 'high') {
      g.lineStyle(1, 0xffffff, 0.8);
      g.lineBetween(length, 0, notchX, notchY);
    }
  }
}

function drawRicochetShape(
  g: Phaser.GameObjects.Graphics,
  quality: string,
  isEcho: boolean,
): void {
  const ballSize = 8;
  const ballColor = isEcho ? 0xffdd44 : 0x4488ff;
  // Draw at 1:1 aspect ratio (stretch applied at runtime via setScale)
  const ellipseW = ballSize * 2;
  const ellipseH = ballSize * 2;

  if (quality === 'low') {
    g.fillStyle(ballColor, 1);
    g.fillEllipse(0, 0, ellipseW, ellipseH);
    g.lineStyle(2, 0xffffff, 1);
    g.strokeEllipse(0, 0, ellipseW, ellipseH);
  } else if (isEcho) {
    g.lineStyle(2, ballColor, 0.4);
    g.strokeEllipse(0, 0, ellipseW * 1.3, ellipseH * 1.3);
    g.lineStyle(2, ballColor, 0.8);
    g.strokeEllipse(0, 0, ellipseW, ellipseH);
  } else if (quality === 'medium') {
    g.fillStyle(ballColor, 0.3);
    g.fillEllipse(0, 0, ellipseW * 1.3, ellipseH * 1.3);
    g.fillStyle(ballColor, 1);
    g.fillEllipse(0, 0, ellipseW, ellipseH);
    g.lineStyle(2, 0xffffff, 1);
    g.strokeEllipse(0, 0, ellipseW, ellipseH);
    g.fillStyle(0xffffff, 0.8);
    g.fillCircle(0, 0, ballSize * 0.3);
  } else {
    // high
    g.fillStyle(ballColor, 0.3);
    g.fillEllipse(0, 0, ellipseW * 1.3, ellipseH * 1.3);
    g.fillStyle(ballColor, 1);
    g.fillEllipse(0, 0, ellipseW, ellipseH);
    g.lineStyle(2, 0xffffff, 1);
    g.strokeEllipse(0, 0, ellipseW, ellipseH);
    g.fillStyle(0xffffff, 0.8);
    g.fillCircle(0, 0, ballSize * 0.3);
    g.fillCircle(-ballSize * 0.2, -ballSize * 0.2, ballSize * 0.3);
    // Static crackle lines (rotating ones go on shared Graphics at runtime)
    g.lineStyle(1, 0xffffff, 0.5);
    g.lineBetween(-ballSize * 0.5, 0, ballSize * 0.5, 0);
    g.lineBetween(0, -ballSize * 0.5, 0, ballSize * 0.5);
  }
}

function drawMissileShape(
  g: Phaser.GameObjects.Graphics,
  quality: string,
  isBomblet: boolean,
): void {
  const size = isBomblet ? 5 : 8;
  const bodyColor = isBomblet ? 0xffaa44 : 0x4488ff;
  const darkColor = isBomblet ? 0xff6622 : 0x2266dd;

  if (quality === 'low') {
    g.fillStyle(bodyColor, 1);
    g.fillRect(-size, -size / 2, size * 2, size);
    g.fillStyle(darkColor, 1);
    g.fillTriangle(-size, -size / 2, -size, size / 2, -size * 1.5, 0);
  } else if (isBomblet) {
    // Medium/High bomblet: 5-vertex streamlined shape
    g.fillStyle(bodyColor, 1);
    g.beginPath();
    g.moveTo(size * 1.2, 0);
    g.lineTo(size * 0.3, -size * 0.5);
    g.lineTo(-size * 0.8, -size * 0.3);
    g.lineTo(-size * 0.8, size * 0.3);
    g.lineTo(size * 0.3, size * 0.5);
    g.closePath();
    g.fillPath();
  } else {
    // Medium/High main missile: 7-vertex streamlined silhouette
    g.fillStyle(bodyColor, 1);
    g.beginPath();
    g.moveTo(size * 1.8, 0);
    g.lineTo(size * 0.5, -size * 0.6);
    g.lineTo(-size * 0.8, -size * 0.5);
    g.lineTo(-size * 1.2, -size * 0.9);
    g.lineTo(-size, 0);
    g.lineTo(-size * 1.2, size * 0.9);
    g.lineTo(-size * 0.8, size * 0.5);
    g.lineTo(size * 0.5, size * 0.6);
    g.closePath();
    g.fillPath();
    // White nose highlight
    g.fillStyle(0xaaddff, 0.8);
    g.fillTriangle(size * 1.8, 0, size * 1.0, -size * 0.3, size * 1.0, size * 0.3);

    if (quality === 'high') {
      // Hull panel lines
      g.lineStyle(1, 0xffffff, 0.3);
      g.beginPath();
      g.moveTo(size * 0.5, -size * 0.6);
      g.lineTo(size * 0.5, size * 0.6);
      g.strokePath();
      g.beginPath();
      g.moveTo(-size * 0.2, -size * 0.55);
      g.lineTo(-size * 0.2, size * 0.55);
      g.strokePath();
      // Wing nubs
      g.fillStyle(0x3377dd, 1);
      g.fillTriangle(0, -size * 0.6, -size * 0.4, -size * 0.6, -size * 0.2, -size * 1.0);
      g.fillTriangle(0, size * 0.6, -size * 0.4, size * 0.6, -size * 0.2, size * 1.0);
    }
  }
}

function drawShurikenShape(
  g: Phaser.GameObjects.Graphics,
  quality: string,
  isCyclone: boolean,
): void {
  const baseSize = 12;
  const size = isCyclone ? baseSize * 2 : baseSize;
  const bladeColor = isCyclone ? 0xffdd44 : 0x4488ff;
  const centerColor = isCyclone ? 0xffaa22 : 0x2266dd;
  const bladeCount = isCyclone ? 6 : 4;

  // Draw blades at angle=0 (rotation applied at runtime)
  for (let i = 0; i < bladeCount; i++) {
    const pointAngle = (i * Math.PI * 2) / bladeCount;

    if (quality === 'low') {
      g.fillStyle(bladeColor, 1);
      g.beginPath();
      g.moveTo(0, 0);
      g.lineTo(
        Math.cos(pointAngle - 0.3) * size * 0.4,
        Math.sin(pointAngle - 0.3) * size * 0.4,
      );
      g.lineTo(Math.cos(pointAngle) * size, Math.sin(pointAngle) * size);
      g.lineTo(
        Math.cos(pointAngle + 0.3) * size * 0.4,
        Math.sin(pointAngle + 0.3) * size * 0.4,
      );
      g.closePath();
      g.fillPath();
    } else {
      // Medium/High: 5-vertex scythe blade
      const leadingEdgeX = Math.cos(pointAngle - 0.25) * size * 0.5;
      const leadingEdgeY = Math.sin(pointAngle - 0.25) * size * 0.5;
      const tipX = Math.cos(pointAngle) * size;
      const tipY = Math.sin(pointAngle) * size;
      const trailingOuterX = Math.cos(pointAngle + 0.35) * size * 0.6;
      const trailingOuterY = Math.sin(pointAngle + 0.35) * size * 0.6;
      const trailingInnerX = Math.cos(pointAngle + 0.25) * size * 0.2;
      const trailingInnerY = Math.sin(pointAngle + 0.25) * size * 0.2;

      g.fillStyle(bladeColor, 1);
      g.beginPath();
      g.moveTo(0, 0);
      g.lineTo(leadingEdgeX, leadingEdgeY);
      g.lineTo(tipX, tipY);
      g.lineTo(trailingOuterX, trailingOuterY);
      g.lineTo(trailingInnerX, trailingInnerY);
      g.closePath();
      g.fillPath();

      if (quality === 'high') {
        g.lineStyle(1, 0xffffff, 0.7);
        g.lineBetween(leadingEdgeX, leadingEdgeY, tipX, tipY);
      }
    }
  }

  // Center circle
  g.fillStyle(centerColor, 1);
  g.fillCircle(0, 0, size * 0.25);
  g.lineStyle(2, 0xffffff, 1);
  g.strokeCircle(0, 0, size * 0.25);
}

function drawDroneProjectileShape(
  g: Phaser.GameObjects.Graphics,
  quality: string,
  isSynchronized: boolean,
): void {
  const size = 4;
  const projColor = isSynchronized ? 0xffd700 : 0x4488ff;
  const projSize = isSynchronized ? size * 1.3 : size;

  if (quality === 'low') {
    g.fillStyle(projColor, 1);
    g.fillCircle(0, 0, projSize);
    g.lineStyle(2, 0xffffff, 1);
    g.strokeCircle(0, 0, projSize);
  } else {
    // Diamond shape pointing right
    g.fillStyle(projColor, 1);
    g.beginPath();
    g.moveTo(projSize * 1.5, 0);
    g.lineTo(0, -projSize * 0.8);
    g.lineTo(-projSize, 0);
    g.lineTo(0, projSize * 0.8);
    g.closePath();
    g.fillPath();
    g.lineStyle(1, 0xffffff, 0.8);
    g.lineBetween(-projSize * 0.5, 0, projSize * 1.0, 0);
  }
}

function drawDroneBodyShape(
  g: Phaser.GameObjects.Graphics,
  quality: string,
): void {
  const size = 10;

  if (quality === 'low') {
    g.fillStyle(0x44aaff, 1);
    g.fillEllipse(0, 0, size * 2, size);
    g.fillStyle(0x88ddff, 1);
    g.fillCircle(0, 0, size * 0.4);
  } else {
    // Angular hull: 6-vertex polygon
    g.fillStyle(0x44aaff, 1);
    g.beginPath();
    g.moveTo(size * 1.2, 0);
    g.lineTo(size * 0.4, -size * 0.6);
    g.lineTo(-size * 0.8, -size * 0.5);
    g.lineTo(-size * 1.0, 0);
    g.lineTo(-size * 0.8, size * 0.5);
    g.lineTo(size * 0.4, size * 0.6);
    g.closePath();
    g.fillPath();

    // Trapezoidal cockpit
    g.fillStyle(0x88ddff, 1);
    g.beginPath();
    g.moveTo(size * 0.6, -size * 0.25);
    g.lineTo(size * 0.1, -size * 0.35);
    g.lineTo(size * 0.1, size * 0.35);
    g.lineTo(size * 0.6, size * 0.25);
    g.closePath();
    g.fillPath();

    if (quality === 'high') {
      g.lineStyle(1, 0x2288dd, 0.3);
      g.lineBetween(-size * 0.3, -size * 0.45, -size * 0.3, size * 0.45);
      g.lineBetween(size * 0.1, -size * 0.5, -size * 0.8, -size * 0.3);
      g.lineBetween(size * 0.1, size * 0.5, -size * 0.8, size * 0.3);
      // Wing nubs
      g.fillStyle(0x3399dd, 1);
      g.fillTriangle(0, -size * 0.6, -size * 0.4, -size * 0.5, -size * 0.2, -size * 0.8);
      g.fillTriangle(0, size * 0.6, -size * 0.4, size * 0.5, -size * 0.2, size * 0.8);
    }
  }

  // Thrusters (static mounting points)
  g.fillStyle(0x2288dd, 1);
  g.fillRect(-size * 0.8, size * 0.3, size * 0.4, size * 0.3);
  g.fillRect(-size * 0.8, -size * 0.6, size * 0.4, size * 0.3);
}

// ============================================================================
// Atlas Generation
// ============================================================================

const SOUL_COLORS: { fill: number; trail: number }[] = [
  { fill: 0x66ccff, trail: 0x99ddff },  // Blue (0 kills)
  { fill: 0xaa66ff, trail: 0xcc99ff },  // Purple (1 kill)
  { fill: 0xffd700, trail: 0xffec8b },  // Gold (2 kills)
  { fill: 0xffffff, trail: 0xffffff },  // White (3 kills)
];

const QUALITIES = ['low', 'medium', 'high'] as const;

/**
 * Pre-renders all projectile shapes into a single texture atlas.
 * Call once during scene initialization, before weapons fire.
 */
export function generateProjectileAtlases(scene: Phaser.Scene): void {
  if (scene.textures.exists(PROJECTILE_ATLAS_KEY)) return;

  const tempGraphics = scene.add.graphics();
  tempGraphics.setVisible(false);

  const atlasWidth = PADDED_SIZE * COL_COUNT;
  const atlasHeight = PADDED_SIZE * ROW_COUNT;
  const renderTexture = scene.add.renderTexture(0, 0, atlasWidth, atlasHeight);
  renderTexture.setVisible(false);

  for (let qualityIdx = 0; qualityIdx < QUALITIES.length; qualityIdx++) {
    const quality = QUALITIES[qualityIdx];
    const rowY = PADDED_SIZE * qualityIdx + PADDED_SIZE / 2;

    // ProjectileWeapon: 4 soul colors
    for (let colorIdx = 0; colorIdx < 4; colorIdx++) {
      tempGraphics.clear();
      drawProjectileShape(tempGraphics, quality, SOUL_COLORS[colorIdx].fill, SOUL_COLORS[colorIdx].trail);
      const colX = PADDED_SIZE * (COL_PROJ_BLUE + colorIdx) + PADDED_SIZE / 2;
      renderTexture.draw(tempGraphics, colX, rowY);
    }

    // RicochetWeapon: normal + echo
    for (let echoIdx = 0; echoIdx < 2; echoIdx++) {
      tempGraphics.clear();
      drawRicochetShape(tempGraphics, quality, echoIdx === 1);
      const colX = PADDED_SIZE * (COL_RICOCHET_NORMAL + echoIdx) + PADDED_SIZE / 2;
      renderTexture.draw(tempGraphics, colX, rowY);
    }

    // HomingMissileWeapon: missile + bomblet
    for (let bombletIdx = 0; bombletIdx < 2; bombletIdx++) {
      tempGraphics.clear();
      drawMissileShape(tempGraphics, quality, bombletIdx === 1);
      const colX = PADDED_SIZE * (COL_MISSILE_MAIN + bombletIdx) + PADDED_SIZE / 2;
      renderTexture.draw(tempGraphics, colX, rowY);
    }

    // ShurikenWeapon: normal + cyclone
    for (let cycloneIdx = 0; cycloneIdx < 2; cycloneIdx++) {
      tempGraphics.clear();
      drawShurikenShape(tempGraphics, quality, cycloneIdx === 1);
      const colX = PADDED_SIZE * (COL_SHURIKEN_NORMAL + cycloneIdx) + PADDED_SIZE / 2;
      renderTexture.draw(tempGraphics, colX, rowY);
    }

    // DroneProjectile: normal + synced
    for (let syncIdx = 0; syncIdx < 2; syncIdx++) {
      tempGraphics.clear();
      drawDroneProjectileShape(tempGraphics, quality, syncIdx === 1);
      const colX = PADDED_SIZE * (COL_DRONE_PROJ_NORMAL + syncIdx) + PADDED_SIZE / 2;
      renderTexture.draw(tempGraphics, colX, rowY);
    }

    // DroneBody
    tempGraphics.clear();
    drawDroneBodyShape(tempGraphics, quality);
    const droneBodyColX = PADDED_SIZE * COL_DRONE_BODY + PADDED_SIZE / 2;
    renderTexture.draw(tempGraphics, droneBodyColX, rowY);
  }

  renderTexture.saveTexture(PROJECTILE_ATLAS_KEY);

  // Define named frames
  const texture = scene.textures.get(PROJECTILE_ATLAS_KEY);
  for (let row = 0; row < ROW_COUNT; row++) {
    for (let col = 0; col < COL_COUNT; col++) {
      const frame = frameIndex(row, col);
      texture.add(
        frame, 0,
        PADDED_SIZE * col, PADDED_SIZE * row,
        PADDED_SIZE, PADDED_SIZE,
      );
    }
  }

  renderTexture.destroy();
  tempGraphics.destroy();
}

/**
 * Destroys the projectile atlas texture. Call on scene shutdown.
 */
export function destroyProjectileAtlases(scene: Phaser.Scene): void {
  if (scene.textures.exists(PROJECTILE_ATLAS_KEY)) {
    scene.textures.remove(PROJECTILE_ATLAS_KEY);
  }
}
