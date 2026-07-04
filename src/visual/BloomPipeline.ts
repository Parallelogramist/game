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

  // ── Bloom: Gaussian-weighted bright-pass blur ──
  // Normalized by TOTAL kernel weight, not just the passing samples: the old
  // passing-only divisor gave any pixel with a single bright neighbor that
  // neighbor's full excess brightness, painting a flat hard-edged halo around
  // every bright shape (HUD text, gems) instead of a soft falloff.
  vec2 texelSize = 1.0 / uResolution;
  vec3 bloomAccum = vec3(0.0);
  float totalWeight = 0.0;

  for (float x = -2.0; x <= 2.0; x += 1.0) {
    for (float y = -2.0; y <= 2.0; y += 1.0) {
      vec2 offset = vec2(x, y) * texelSize * 2.0;
      vec4 samp = texture2D(uMainSampler, outTexCoord + offset);
      float weight = exp(-(x * x + y * y) * 0.25);
      float brightness = dot(samp.rgb, vec3(0.2126, 0.7152, 0.0722));
      bloomAccum += samp.rgb * max(brightness - uBloomThreshold, 0.0) * weight;
      totalWeight += weight;
    }
  }

  vec3 finalColor = color.rgb + (bloomAccum / totalWeight) * uBloomStrength;

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
