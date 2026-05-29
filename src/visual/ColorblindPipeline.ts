/**
 * ColorblindPipeline — full-screen post-process for color-vision-deficiency (CVD)
 * correction plus an optional contrast boost.
 *
 * Uses the standard "daltonization" algorithm (GPUGems-style fixed RGB matrices):
 *   1. Simulate the dichromat's perceived color.
 *   2. Compute the error (lost information) = original - simulated.
 *   3. Shift that error into channels the viewer CAN distinguish.
 *   4. Add the shifted error back to the original.
 *
 * Reads its mode/contrast live from SettingsManager each frame, so toggling the
 * setting takes effect without re-binding the pipeline. When mode is "off" and
 * contrast is neutral the shader is a pass-through (negligible cost).
 *
 * Usage: registered in main.ts and applied to the GameScene camera alongside
 * BloomPipeline / DistortionPipeline.
 */
import Phaser from 'phaser';
import { getSettingsManager, ColorblindMode } from '../settings';

const COLORBLIND_FRAG = `
precision mediump float;

uniform sampler2D uMainSampler;
// 0 = off, 1 = protanopia, 2 = deuteranopia, 3 = tritanopia
uniform float uMode;
// Extra contrast multiplier around mid-grey (1.0 = neutral).
uniform float uContrast;

varying vec2 outTexCoord;

void main() {
  vec4 texel = texture2D(uMainSampler, outTexCoord);
  vec3 color = texel.rgb;

  // ── Color-vision-deficiency correction (daltonization) ──
  if (uMode > 0.5) {
    // Simulation matrix for the selected deficiency (column-major rows below).
    vec3 sim;
    if (uMode < 1.5) {
      // Protanopia
      sim = vec3(
        dot(color, vec3(0.567, 0.433, 0.000)),
        dot(color, vec3(0.558, 0.442, 0.000)),
        dot(color, vec3(0.000, 0.242, 0.758))
      );
    } else if (uMode < 2.5) {
      // Deuteranopia
      sim = vec3(
        dot(color, vec3(0.625, 0.375, 0.000)),
        dot(color, vec3(0.700, 0.300, 0.000)),
        dot(color, vec3(0.000, 0.300, 0.700))
      );
    } else {
      // Tritanopia
      sim = vec3(
        dot(color, vec3(0.950, 0.050, 0.000)),
        dot(color, vec3(0.000, 0.433, 0.567)),
        dot(color, vec3(0.000, 0.475, 0.525))
      );
    }

    // Error = information lost to the deficiency.
    vec3 err = color - sim;

    // Shift the error into distinguishable channels (standard daltonize matrix).
    vec3 shift = vec3(
      0.0,
      dot(err, vec3(0.7, 1.0, 0.0)),
      dot(err, vec3(0.7, 0.0, 1.0))
    );

    color = clamp(color + shift, 0.0, 1.0);
  }

  // ── Optional contrast boost (high-contrast accessibility mode) ──
  if (abs(uContrast - 1.0) > 0.001) {
    color = clamp((color - 0.5) * uContrast + 0.5, 0.0, 1.0);
  }

  gl_FragColor = vec4(color, texel.a);
}
`;

const MODE_TO_INDEX: Record<ColorblindMode, number> = {
  off: 0,
  protanopia: 1,
  deuteranopia: 2,
  tritanopia: 3,
};

export class ColorblindPipeline extends Phaser.Renderer.WebGL.Pipelines.PostFXPipeline {
  constructor(game: Phaser.Game) {
    super({
      game,
      name: 'ColorblindPipeline',
      fragShader: COLORBLIND_FRAG,
    });
  }

  onPreRender(): void {
    const settings = getSettingsManager();
    this.set1f('uMode', MODE_TO_INDEX[settings.getColorblindMode()] ?? 0);
    // High-contrast nudges contrast up modestly; neutral otherwise.
    this.set1f('uContrast', settings.isHighContrastEnabled() ? 1.18 : 1.0);
  }
}
