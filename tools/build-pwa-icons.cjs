/**
 * Build PWA Icons
 *
 * Renders the app icon set from public/favicon.svg.
 *
 * Usage: node tools/build-pwa-icons.cjs
 *
 * Requires: npm install --save-dev sharp
 */

const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

const SOURCE_SVG = path.join(__dirname, '..', 'public', 'favicon.svg');
const OUTPUT_DIR = path.join(__dirname, '..', 'public', 'icons');

// favicon.svg's viewBox; the render density is derived from it so the glow
// filter is rasterized at the target size instead of being upscaled.
const SOURCE_VIEWBOX = 32;

// The favicon's own plate colour. Home-screen icons must be opaque — iOS
// renders transparent pixels black, and a maskable icon's padding has to be
// filled or the launcher's mask cuts into the artwork.
const BACKGROUND = { r: 10, g: 10, b: 26, alpha: 1 };

// Maskable icons must keep their artwork inside the safe zone (the centre 80%);
// 60% leaves margin for the most aggressive launcher masks.
const MASKABLE_INNER_RATIO = 0.6;

async function renderIcon(size, innerSize, filename) {
  const source = fs.readFileSync(SOURCE_SVG);
  const inner = await sharp(source, { density: Math.ceil((96 * innerSize) / SOURCE_VIEWBOX) })
    .resize(innerSize, innerSize)
    .png()
    .toBuffer();

  const outputPath = path.join(OUTPUT_DIR, filename);
  await sharp({ create: { width: size, height: size, channels: 4, background: BACKGROUND } })
    .composite([{ input: inner, gravity: 'centre' }])
    .flatten({ background: BACKGROUND })
    .png({ compressionLevel: 9 })
    .toFile(outputPath);

  console.log(`  ${filename}  ${size}x${size}  ${fs.statSync(outputPath).size} bytes`);
}

async function buildIcons() {
  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }

  console.log('Building PWA icons from favicon.svg...');
  await renderIcon(192, 192, 'pwa-192.png');
  await renderIcon(512, 512, 'pwa-512.png');
  await renderIcon(512, Math.round(512 * MASKABLE_INNER_RATIO), 'pwa-maskable-512.png');
  await renderIcon(180, 180, 'apple-touch-icon.png');
  console.log('Done.');
}

buildIcons().catch((error) => {
  console.error(error);
  process.exit(1);
});
