/**
 * Gem3DRenderer - True 3D octahedron rendering for XP gems
 *
 * Renders gems as rotating 3D octahedrons with:
 * - Real Y-axis rotation using transformation matrices
 * - Face sorting (painter's algorithm) for correct depth
 * - Normal-based shading for realistic lighting
 * - Bright edge rendering for clear facet distinction
 */

// ============================================================================
// Types
// ============================================================================

interface Vec3 {
  x: number;
  y: number;
  z: number;
}

interface Vec2 {
  x: number;
  y: number;
}

interface TransformedFace {
  screenVerts: Vec2[];     // Triangle vertices in screen space
  centroidZ: number;       // Average Z for depth sorting
  brightness: number;      // 0-1 lighting intensity
}

// ============================================================================
// Octahedron Geometry (Unit Size)
// ============================================================================

// 6 vertices forming a double-pyramid (octahedron)
// Y-axis is vertical, rotation will be around Y
// Width is 0.5 (half of height) for a sleek gem look
const OCTAHEDRON_VERTICES: Vec3[] = [
  { x: 0, y: 1, z: 0 },       // 0: Top apex
  { x: 0.5, y: 0, z: 0 },     // 1: Right (+X) - half width
  { x: 0, y: 0, z: 0.5 },     // 2: Front (+Z) - half depth
  { x: -0.5, y: 0, z: 0 },    // 3: Left (-X) - half width
  { x: 0, y: 0, z: -0.5 },    // 4: Back (-Z) - half depth
  { x: 0, y: -1, z: 0 },      // 5: Bottom apex
];

// 8 triangular faces (vertex indices, counter-clockwise winding for front faces)
// Winding order determines which way the normal points
const OCTAHEDRON_FACES: [number, number, number][] = [
  // Upper pyramid (4 faces pointing outward-up)
  [0, 2, 1],   // Top-Front-Right
  [0, 3, 2],   // Top-Front-Left
  [0, 4, 3],   // Top-Back-Left
  [0, 1, 4],   // Top-Back-Right
  // Lower pyramid (4 faces pointing outward-down)
  [5, 1, 2],   // Bottom-Front-Right
  [5, 2, 3],   // Bottom-Front-Left
  [5, 3, 4],   // Bottom-Back-Left
  [5, 4, 1],   // Bottom-Back-Right
];

// 12 edges connecting vertices (for edge rendering)
const OCTAHEDRON_EDGES: [number, number][] = [
  // Equator edges (middle ring)
  [1, 2], [2, 3], [3, 4], [4, 1],
  // Top edges (to apex)
  [0, 1], [0, 2], [0, 3], [0, 4],
  // Bottom edges (to apex)
  [5, 1], [5, 2], [5, 3], [5, 4],
];

// ============================================================================
// Lighting Configuration
// ============================================================================

// Light direction (normalized) - coming from upper-right-front
const LIGHT_DIR: Vec3 = normalizeVec3({ x: 0.5, y: 0.7, z: 0.5 });

// Ambient light (minimum brightness for faces in shadow)
const AMBIENT_LIGHT = 0.35;

// ============================================================================
// Object Pools (Avoid per-frame allocations)
// ============================================================================

// Reusable arrays for transformed data
const transformedVerts: Vec3[] = OCTAHEDRON_VERTICES.map(() => ({ x: 0, y: 0, z: 0 }));
const screenVerts: Vec2[] = OCTAHEDRON_VERTICES.map(() => ({ x: 0, y: 0 }));
const visibleFaces: TransformedFace[] = [];

// ============================================================================
// Vector Math Utilities
// ============================================================================

function normalizeVec3(v: Vec3): Vec3 {
  const length = Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z);
  if (length === 0) return { x: 0, y: 0, z: 0 };
  return { x: v.x / length, y: v.y / length, z: v.z / length };
}

function dotProduct(a: Vec3, b: Vec3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

/**
 * Calculate face normal using cross product of two edges.
 * Returns normalized vector perpendicular to the face.
 */
function calculateFaceNormal(v0: Vec3, v1: Vec3, v2: Vec3): Vec3 {
  // Edge vectors
  const edge1x = v1.x - v0.x;
  const edge1y = v1.y - v0.y;
  const edge1z = v1.z - v0.z;

  const edge2x = v2.x - v0.x;
  const edge2y = v2.y - v0.y;
  const edge2z = v2.z - v0.z;

  // Cross product
  const nx = edge1y * edge2z - edge1z * edge2y;
  const ny = edge1z * edge2x - edge1x * edge2z;
  const nz = edge1x * edge2y - edge1y * edge2x;

  // Normalize
  const length = Math.sqrt(nx * nx + ny * ny + nz * nz);
  if (length === 0) return { x: 0, y: 0, z: 1 };

  return { x: nx / length, y: ny / length, z: nz / length };
}

// ============================================================================
// 3D Transformations
// ============================================================================

/**
 * Rotate a vertex around the Y-axis.
 * Uses standard Y-axis rotation matrix.
 */
function rotateY(v: Vec3, cosAngle: number, sinAngle: number, out: Vec3): void {
  out.x = v.x * cosAngle + v.z * sinAngle;
  out.y = v.y;
  out.z = -v.x * sinAngle + v.z * cosAngle;
}

/**
 * Project 3D vertex to 2D screen space (orthographic projection).
 * Scale determines the size of the gem in pixels.
 */
function projectToScreen(v: Vec3, scale: number, out: Vec2): void {
  out.x = v.x * scale;
  out.y = -v.y * scale;  // Flip Y (screen Y increases downward)
}

// ============================================================================
// Color Utilities
// ============================================================================

/**
 * Apply brightness to a color (ambient + diffuse lighting model).
 */
function shadeColor(baseColor: number, brightness: number): number {
  const r = (baseColor >> 16) & 0xff;
  const g = (baseColor >> 8) & 0xff;
  const b = baseColor & 0xff;

  const shadedR = Math.floor(r * brightness);
  const shadedG = Math.floor(g * brightness);
  const shadedB = Math.floor(b * brightness);

  return (shadedR << 16) | (shadedG << 8) | shadedB;
}

// ============================================================================
// Main Rendering Function
// ============================================================================

/**
 * Render a 3D octahedron gem with rotation, shading, and edge highlighting.
 *
 * @param graphics - Phaser Graphics object to draw on
 * @param rotationY - Current Y-axis rotation angle in radians
 * @param scale - Size multiplier (halfHeight of the gem)
 * @param gemColor - Base fill color (hex)
 * @param edgeColor - Edge/outline color (hex)
 */
export function renderGem3D(
  graphics: Phaser.GameObjects.Graphics,
  rotationY: number,
  scale: number,
  gemColor: number,
  edgeColor: number
): void {
  // Pre-calculate sin/cos for rotation
  const cosAngle = Math.cos(rotationY);
  const sinAngle = Math.sin(rotationY);

  // Transform all vertices
  for (let i = 0; i < OCTAHEDRON_VERTICES.length; i++) {
    rotateY(OCTAHEDRON_VERTICES[i], cosAngle, sinAngle, transformedVerts[i]);
    projectToScreen(transformedVerts[i], scale, screenVerts[i]);
  }

  // Process faces: cull backfaces, calculate shading, prepare for sorting
  visibleFaces.length = 0;

  for (let i = 0; i < OCTAHEDRON_FACES.length; i++) {
    const [i0, i1, i2] = OCTAHEDRON_FACES[i];

    const v0 = transformedVerts[i0];
    const v1 = transformedVerts[i1];
    const v2 = transformedVerts[i2];

    // Calculate face normal (in rotated space)
    const normal = calculateFaceNormal(v0, v1, v2);

    // Backface culling: skip faces pointing away from camera
    // Camera looks down -Z axis, so visible faces have positive Z normal
    if (normal.z <= 0) continue;

    // Calculate lighting intensity
    const lightIntensity = Math.max(0, dotProduct(normal, LIGHT_DIR));
    const brightness = AMBIENT_LIGHT + (1 - AMBIENT_LIGHT) * lightIntensity;

    // Calculate centroid Z for depth sorting
    const centroidZ = (v0.z + v1.z + v2.z) / 3;

    // Store screen vertices for this face
    visibleFaces.push({
      screenVerts: [
        { x: screenVerts[i0].x, y: screenVerts[i0].y },
        { x: screenVerts[i1].x, y: screenVerts[i1].y },
        { x: screenVerts[i2].x, y: screenVerts[i2].y },
      ],
      centroidZ,
      brightness,
    });
  }

  // Sort faces back-to-front (painter's algorithm)
  visibleFaces.sort((a, b) => a.centroidZ - b.centroidZ);

  // Draw faces
  for (const face of visibleFaces) {
    const shadedColor = shadeColor(gemColor, face.brightness);

    graphics.fillStyle(shadedColor, 1);
    graphics.fillTriangle(
      face.screenVerts[0].x, face.screenVerts[0].y,
      face.screenVerts[1].x, face.screenVerts[1].y,
      face.screenVerts[2].x, face.screenVerts[2].y
    );
  }

  // Draw all edges on top for clear facet distinction
  graphics.lineStyle(1, edgeColor, 0.9);

  for (const [i0, i1] of OCTAHEDRON_EDGES) {
    const sv0 = screenVerts[i0];
    const sv1 = screenVerts[i1];
    graphics.lineBetween(sv0.x, sv0.y, sv1.x, sv1.y);
  }
}

/**
 * Render a simplified 2D diamond for very small gems.
 * Used when scale < 6px for performance and visual clarity.
 *
 * @param graphics - Phaser Graphics object to draw on
 * @param halfWidth - Half the width of the diamond
 * @param halfHeight - Half the height of the diamond
 * @param gemColor - Fill color (hex)
 * @param outlineColor - Outline color (hex)
 */
export function renderSimplifiedGem(
  graphics: Phaser.GameObjects.Graphics,
  halfWidth: number,
  halfHeight: number,
  gemColor: number,
  outlineColor: number
): void {
  // Simple filled diamond with outline
  graphics.fillStyle(gemColor, 1);
  graphics.lineStyle(1, outlineColor, 1);

  graphics.beginPath();
  graphics.moveTo(0, -halfHeight);       // Top
  graphics.lineTo(halfWidth, 0);         // Right
  graphics.lineTo(0, halfHeight);        // Bottom
  graphics.lineTo(-halfWidth, 0);        // Left
  graphics.closePath();
  graphics.fillPath();
  graphics.strokePath();

  // Add a simple center highlight line
  const lighterColor = lightenColorSimple(gemColor, 0.4);
  graphics.lineStyle(1, lighterColor, 0.6);
  graphics.lineBetween(0, -halfHeight * 0.6, 0, halfHeight * 0.6);
}

/**
 * Simple color lightening without external dependencies.
 */
function lightenColorSimple(color: number, amount: number): number {
  const r = Math.min(255, ((color >> 16) & 0xff) + 255 * amount);
  const g = Math.min(255, ((color >> 8) & 0xff) + 255 * amount);
  const b = Math.min(255, (color & 0xff) + 255 * amount);
  return (Math.floor(r) << 16) | (Math.floor(g) << 8) | Math.floor(b);
}
