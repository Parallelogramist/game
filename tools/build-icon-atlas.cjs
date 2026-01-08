/**
 * Build Icon Atlas
 *
 * Converts SVG icons from game-icons.net into a single PNG sprite atlas
 * with Phaser-compatible JSON metadata.
 *
 * Usage: node tools/build-icon-atlas.js
 *
 * Requires: npm install --save-dev sharp
 */

const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

// Configuration
const ICON_SIZE = 64; // Output size for each icon (64x64 px)
const ICONS_PER_ROW = 10;
const SOURCE_DIR = path.join(__dirname, 'icon-sources');
const OUTPUT_DIR = path.join(__dirname, '..', 'public', 'icons');
const OUTPUT_PNG = 'game-icons.png';
const OUTPUT_JSON = 'game-icons.json';

async function buildAtlas() {

  // Ensure output directory exists
  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }

  // Get all SVG files
  const svgFiles = fs.readdirSync(SOURCE_DIR)
    .filter(file => file.endsWith('.svg'))
    .sort();

  if (svgFiles.length === 0) {
    console.error('No SVG files found in', SOURCE_DIR);
    process.exit(1);
  }


  // Calculate atlas dimensions
  const totalIcons = svgFiles.length;
  const rows = Math.ceil(totalIcons / ICONS_PER_ROW);
  const cols = Math.min(totalIcons, ICONS_PER_ROW);
  const atlasWidth = cols * ICON_SIZE;
  const atlasHeight = rows * ICON_SIZE;


  // Convert SVGs to PNGs and prepare composite data
  const composites = [];
  const frameData = {};

  for (let i = 0; i < svgFiles.length; i++) {
    const svgFile = svgFiles[i];
    const frameName = path.basename(svgFile, '.svg');
    const col = i % ICONS_PER_ROW;
    const row = Math.floor(i / ICONS_PER_ROW);
    const x = col * ICON_SIZE;
    const y = row * ICON_SIZE;

    try {
      // Read and convert SVG to PNG buffer
      const svgPath = path.join(SOURCE_DIR, svgFile);
      const svgBuffer = fs.readFileSync(svgPath);

      const pngBuffer = await sharp(svgBuffer)
        .resize(ICON_SIZE, ICON_SIZE, {
          fit: 'contain',
          background: { r: 0, g: 0, b: 0, alpha: 0 }
        })
        .png()
        .toBuffer();

      composites.push({
        input: pngBuffer,
        left: x,
        top: y
      });

      // Record frame data for Phaser atlas JSON
      frameData[frameName] = {
        frame: { x, y, w: ICON_SIZE, h: ICON_SIZE },
        rotated: false,
        trimmed: false,
        spriteSourceSize: { x: 0, y: 0, w: ICON_SIZE, h: ICON_SIZE },
        sourceSize: { w: ICON_SIZE, h: ICON_SIZE }
      };

      process.stdout.write(`\rProcessing: ${i + 1}/${svgFiles.length} - ${frameName}`);
    } catch (error) {
      console.error(`\nError processing ${svgFile}:`, error.message);
    }
  }

  // Create base transparent image and composite all icons
  const atlasBuffer = await sharp({
    create: {
      width: atlasWidth,
      height: atlasHeight,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 }
    }
  })
    .composite(composites)
    .png()
    .toBuffer();

  // Write atlas PNG
  const pngOutputPath = path.join(OUTPUT_DIR, OUTPUT_PNG);
  fs.writeFileSync(pngOutputPath, atlasBuffer);

  // Create Phaser atlas JSON
  const atlasJson = {
    frames: frameData,
    meta: {
      app: 'game-icons-atlas-builder',
      version: '1.0',
      image: OUTPUT_PNG,
      format: 'RGBA8888',
      size: { w: atlasWidth, h: atlasHeight },
      scale: '1'
    }
  };

  // Write atlas JSON
  const jsonOutputPath = path.join(OUTPUT_DIR, OUTPUT_JSON);
  fs.writeFileSync(jsonOutputPath, JSON.stringify(atlasJson, null, 2));

}

// Run the build
buildAtlas().catch(error => {
  console.error('Build failed:', error);
  process.exit(1);
});
