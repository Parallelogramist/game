/**
 * BloomPipeline — lightweight WebGL post-process for bloom glow + vignette.
 *
 * Extracts bright pixels, applies a Gaussian blur, and composites back.
 * Also applies a subtle vignette darkening at screen edges.
 *
 * Usage: Apply to the main camera via camera.setPostPipeline(BloomPipeline)
 */
import Phaser from 'phaser';

const BLOOM_FRAG = `
precision mediump float;

uniform sampler2D uMainSampler;
uniform vec2 uResolution;
uniform float uBloomStrength;
uniform float uBloomThreshold;

varying vec2 outTexCoord;

void main() {
  vec4 color = texture2D(uMainSampler, outTexCoord);

  // ── Bloom: sample bright neighbors with 9-tap box blur ──
  vec2 texelSize = 1.0 / uResolution;
  vec3 bloomAccum = vec3(0.0);
  float sampleCount = 0.0;

  for (float x = -2.0; x <= 2.0; x += 1.0) {
    for (float y = -2.0; y <= 2.0; y += 1.0) {
      vec2 offset = vec2(x, y) * texelSize * 2.0;
      vec4 sample = texture2D(uMainSampler, outTexCoord + offset);
      float brightness = dot(sample.rgb, vec3(0.2126, 0.7152, 0.0722));
      if (brightness > uBloomThreshold) {
        bloomAccum += sample.rgb * (brightness - uBloomThreshold);
        sampleCount += 1.0;
      }
    }
  }

  if (sampleCount > 0.0) {
    bloomAccum /= sampleCount;
  }

  vec3 finalColor = color.rgb + bloomAccum * uBloomStrength;

  gl_FragColor = vec4(finalColor, color.a);
}
`;

export class BloomPipeline extends Phaser.Renderer.WebGL.Pipelines.PostFXPipeline {
  private bloomStrength: number = 0.35;
  private bloomThreshold: number = 0.6;

  constructor(game: Phaser.Game) {
    super({
      game,
      name: 'BloomPipeline',
      fragShader: BLOOM_FRAG,
    });
  }

  onPreRender(): void {
    this.set2f('uResolution', this.renderer.width, this.renderer.height);
    this.set1f('uBloomStrength', this.bloomStrength);
    this.set1f('uBloomThreshold', this.bloomThreshold);
  }

  /**
   * Adjust bloom intensity (0 = off, 1 = strong).
   */
  setBloomStrength(strength: number): void {
    this.bloomStrength = strength;
  }

  /**
   * Adjust brightness threshold for bloom extraction.
   */
  setBloomThreshold(threshold: number): void {
    this.bloomThreshold = threshold;
  }

}
