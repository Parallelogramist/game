/**
 * DistortionPipeline — screen-space UV displacement post-process.
 *
 * Creates shockwave / ripple distortion effects by displacing pixel UVs
 * outward from specified world-space origins. Supports multiple concurrent
 * distortion sources (boss attacks, death ripples, weapon impacts).
 *
 * Usage: Apply to camera, then call addDistortion() for each source.
 */
import Phaser from 'phaser';

const MAX_DISTORTIONS = 8;

const DISTORTION_FRAG = `
precision mediump float;

uniform sampler2D uMainSampler;
uniform vec2 uResolution;

// Up to 8 distortion sources: xy = screen-space center, z = radius, w = strength
uniform vec4 uDistortions[${MAX_DISTORTIONS}];
uniform int uDistortionCount;

varying vec2 outTexCoord;

void main() {
  vec2 uv = outTexCoord;
  vec2 pixelCoord = uv * uResolution;

  // Accumulate displacement from all active distortion sources
  vec2 totalDisplacement = vec2(0.0);

  for (int i = 0; i < ${MAX_DISTORTIONS}; i++) {
    if (i >= uDistortionCount) break;

    vec2 center = uDistortions[i].xy;
    float radius = uDistortions[i].z;
    float strength = uDistortions[i].w;

    vec2 toPixel = pixelCoord - center;
    float dist = length(toPixel);

    // Ring-shaped distortion (strongest at the wavefront)
    float bandWidth = radius * 0.3;
    float bandDist = abs(dist - radius);
    if (bandDist < bandWidth) {
      float falloff = 1.0 - (bandDist / bandWidth);
      falloff = falloff * falloff; // Squared falloff for sharper ring
      vec2 direction = normalize(toPixel);
      totalDisplacement += direction * strength * falloff / uResolution;
    }
  }

  gl_FragColor = texture2D(uMainSampler, uv + totalDisplacement);
}
`;

interface DistortionSource {
  screenX: number;
  screenY: number;
  radius: number;
  maxRadius: number;
  strength: number;
  speed: number;       // pixels per second expansion
  decay: number;       // strength decay per second
  active: boolean;
}

export class DistortionPipeline extends Phaser.Renderer.WebGL.Pipelines.PostFXPipeline {
  private distortions: DistortionSource[] = [];

  constructor(game: Phaser.Game) {
    super({
      game,
      name: 'DistortionPipeline',
      fragShader: DISTORTION_FRAG,
    });

    // Pre-allocate distortion slots
    for (let i = 0; i < MAX_DISTORTIONS; i++) {
      this.distortions.push({
        screenX: 0, screenY: 0,
        radius: 0, maxRadius: 0,
        strength: 0, speed: 0, decay: 0,
        active: false,
      });
    }
  }

  /**
   * Add a ripple distortion from a world position.
   * @param screenX Screen-space X
   * @param screenY Screen-space Y
   * @param maxRadius Maximum expansion radius in pixels
   * @param strength UV displacement strength (0.01 = subtle, 0.05 = strong)
   * @param speed Expansion speed in pixels per second
   */
  addDistortion(screenX: number, screenY: number, maxRadius: number = 200, strength: number = 0.02, speed: number = 400): void {
    for (const distortion of this.distortions) {
      if (!distortion.active) {
        distortion.screenX = screenX;
        distortion.screenY = screenY;
        distortion.radius = 0;
        distortion.maxRadius = maxRadius;
        distortion.strength = strength;
        distortion.speed = speed;
        distortion.decay = strength / (maxRadius / speed); // decay over full expansion
        distortion.active = true;
        return;
      }
    }
    // All slots full — skip this distortion
  }

  onPreRender(): void {
    this.set2f('uResolution', this.renderer.width, this.renderer.height);

    // Update distortions and upload uniforms
    const deltaSeconds = this.game.loop.delta * 0.001;
    let activeCount = 0;

    for (let i = 0; i < MAX_DISTORTIONS; i++) {
      const distortion = this.distortions[i];
      if (!distortion.active) continue;

      // Expand radius
      distortion.radius += distortion.speed * deltaSeconds;
      distortion.strength -= distortion.decay * deltaSeconds;

      // Deactivate when expired
      if (distortion.radius >= distortion.maxRadius || distortion.strength <= 0) {
        distortion.active = false;
        continue;
      }

      // Upload as vec4: xy = screen center, z = radius, w = strength
      this.set4f(
        `uDistortions[${activeCount}]`,
        distortion.screenX,
        distortion.screenY,
        distortion.radius,
        distortion.strength
      );
      activeCount++;
    }

    this.set1i('uDistortionCount', activeCount);
  }
}
