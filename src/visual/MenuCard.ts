/**
 * MenuCard — flat, sharp panel primitive for menu scenes.
 *
 * A crisp rounded panel with a soft ambient shadow and a "light up" hover
 * state. Each card can be styled with an accent banner across the top and
 * an arbitrary body fill — caller supplies the colors so role-coding (gold
 * for daily, blue for primary, etc.) reads across the menu. Cards sit flat:
 * no tilt, no wobble — clean lines only.
 *
 * The card exposes its `frame` container so callers can drop arbitrary
 * children (text, icons, ship previews) inside, and a `tickIdle(now)` hook
 * that the host scene drives on each UPDATE event.
 *
 * Hover/focus behavior: subtle scale + brightened accent ring + a soft glow
 * pulse + light flecks that briefly ride along the rim then peel off
 * outward and fade.
 */

import Phaser from 'phaser';

export interface MenuCardOptions {
  x: number;
  y: number;
  width: number;
  height: number;
  /** Per-card phase seed so halo pulses stay out of sync across cards. */
  pulseSeed?: number;
  /** Body fill — overrides the default dark-glass fill. */
  bodyFillColor?: number;
  bodyFillAlpha?: number;
  /** Accent color for the top banner + border. */
  accentColor?: number;
  /** Banner thickness across the card top in pixels. */
  bannerHeight?: number;
  /** Border thickness (the accent line around the card). */
  borderWidth?: number;
  /** Border color override — defaults to the accent color. */
  borderColor?: number;
  cornerRadius?: number;
  shadowOffsetX?: number;
  shadowOffsetY?: number;
  shadowAlpha?: number;
  interactive?: boolean;
}

export interface MenuCard {
  container: Phaser.GameObjects.Container;
  frame: Phaser.GameObjects.Container;
  width: number;
  height: number;
  hitZone: Phaser.GameObjects.Zone;
  /** Top-left corner of the banner in card-local coords (y is negative half-height). */
  bannerTopY: number;
  /** Bottom of the banner in card-local coords. */
  bannerBottomY: number;
  setHoverState(hovered: boolean): void;
  setFocusState(focused: boolean): void;
  tickIdle(timeSeconds: number): void;
  destroy(): void;
}

const DEFAULT_SHADOW_OFFSET_X = 0;
const DEFAULT_SHADOW_OFFSET_Y = 6;
const DEFAULT_SHADOW_ALPHA = 0.5;
const DEFAULT_CORNER_RADIUS = 6;
const HOVER_SCALE = 1.03;
const HOVER_TWEEN_MS = 140;

// ── Fleck emission tuning ────────────────────────────────────────────────
// Sparks spawn at a random point on the rounded-rect border, slide
// tangentially along the rim for a moment, and accelerate outward along
// the local normal before fading — a subtle energy shimmer on the rim.
const FLECK_BASE_RADIUS = 2.6;
const FLECK_POOL_MIN = 16;
const FLECK_POOL_MAX = 36;
/** Roughly one fleck slot per 70 px of perimeter so density is consistent. */
const FLECK_POOL_PER_PERIMETER_PX = 1 / 70;
/** Emissions per second when hover/focus is fully active. */
const FLECK_SPAWN_RATE_PER_SEC = 34;
const FLECK_LIFETIME_MIN = 0.5;
const FLECK_LIFETIME_MAX = 1.05;
const FLECK_TANGENT_SPEED_MIN = 35;
const FLECK_TANGENT_SPEED_MAX = 95;
/** Initial outward speed; accel takes over to peel the spark off the rim. */
const FLECK_OUTWARD_INITIAL_SPEED = 14;
const FLECK_OUTWARD_ACCEL = 85;

/** Default dark glass body fill. */
const DEFAULT_BODY = 0x121a2c;

export function createMenuCard(scene: Phaser.Scene, options: MenuCardOptions): MenuCard {
  const {
    x,
    y,
    width,
    height,
    pulseSeed = Math.random() * 1000,
    bodyFillColor,
    bodyFillAlpha,
    accentColor,
    bannerHeight = 0,
    borderWidth,
    borderColor,
    cornerRadius,
    shadowOffsetX = DEFAULT_SHADOW_OFFSET_X,
    shadowOffsetY = DEFAULT_SHADOW_OFFSET_Y,
    shadowAlpha = DEFAULT_SHADOW_ALPHA,
    interactive = true,
  } = options;

  const container = scene.add.container(x, y);

  // Soft ambient drop shadow directly beneath the panel.
  const shadow = scene.add.graphics();
  drawCardShadow(shadow, width, height, shadowOffsetX, shadowOffsetY, shadowAlpha, cornerRadius);
  container.add(shadow);

  // Glow ring — a soft halo behind the panel that pulses on hover/focus.
  const glow = scene.add.graphics();
  glow.setAlpha(0);
  container.add(glow);

  const frame = scene.add.container(0, 0);
  container.add(frame);

  const panel = scene.add.graphics();
  drawCardPanel(panel, width, height, {
    bodyFillColor,
    bodyFillAlpha,
    accentColor,
    bannerHeight,
    borderWidth,
    borderColor,
    cornerRadius,
  });
  frame.add(panel);

  const halfH = height / 2;
  const bannerTopY = -halfH;
  const bannerBottomY = -halfH + bannerHeight;

  const hitZone = scene.add.zone(0, 0, width, height).setOrigin(0.5);
  if (interactive) {
    hitZone.setInteractive({ useHandCursor: true });
  }
  frame.add(hitZone);

  // ── Border sampling for fleck emission ───────────────────────────────────
  // Flecks spawn at a random point on the rounded-rect outline. Walking the
  // perimeter as 8 segments (4 straights + 4 quarter-arcs) gives every
  // sample a precise position plus an outward normal + tangent, so each
  // spark can ride the rim tangentially then accelerate outward.
  const resolvedCornerRadius = cornerRadius ?? DEFAULT_CORNER_RADIUS;
  const halfWidthInner = width / 2;
  const halfHeightInner = height / 2;
  const straightHorizontalLength = Math.max(0, width - 2 * resolvedCornerRadius);
  const straightVerticalLength = Math.max(0, height - 2 * resolvedCornerRadius);
  const arcSegmentLength = (Math.PI / 2) * resolvedCornerRadius;
  const borderPerimeter =
    2 * straightHorizontalLength + 2 * straightVerticalLength + 4 * arcSegmentLength;

  const cornerCenters = {
    topRight: { x: halfWidthInner - resolvedCornerRadius, y: -halfHeightInner + resolvedCornerRadius },
    bottomRight: { x: halfWidthInner - resolvedCornerRadius, y: halfHeightInner - resolvedCornerRadius },
    bottomLeft: { x: -halfWidthInner + resolvedCornerRadius, y: halfHeightInner - resolvedCornerRadius },
    topLeft: { x: -halfWidthInner + resolvedCornerRadius, y: -halfHeightInner + resolvedCornerRadius },
  };

  interface BorderSample {
    x: number;
    y: number;
    /** Outward unit normal (perpendicular to border, pointing away from card). */
    normalX: number;
    normalY: number;
    /** Unit tangent along the border in the clockwise walk direction. */
    tangentX: number;
    tangentY: number;
  }

  // Walks 8 segments clockwise from the top-left straight start.
  const sampleBorderAtArcLength = (arcLengthAlong: number): BorderSample => {
    let remaining =
      ((arcLengthAlong % borderPerimeter) + borderPerimeter) % borderPerimeter;

    // 1. Top straight (going right) — normal up, tangent right.
    if (remaining < straightHorizontalLength) {
      return {
        x: -halfWidthInner + resolvedCornerRadius + remaining,
        y: -halfHeightInner,
        normalX: 0,
        normalY: -1,
        tangentX: 1,
        tangentY: 0,
      };
    }
    remaining -= straightHorizontalLength;

    // 2. Top-right arc (-π/2 → 0).
    if (remaining < arcSegmentLength) {
      const theta = -Math.PI / 2 + remaining / resolvedCornerRadius;
      const normalX = Math.cos(theta);
      const normalY = Math.sin(theta);
      return {
        x: cornerCenters.topRight.x + normalX * resolvedCornerRadius,
        y: cornerCenters.topRight.y + normalY * resolvedCornerRadius,
        normalX,
        normalY,
        tangentX: -normalY,
        tangentY: normalX,
      };
    }
    remaining -= arcSegmentLength;

    // 3. Right straight (going down) — normal right, tangent down.
    if (remaining < straightVerticalLength) {
      return {
        x: halfWidthInner,
        y: -halfHeightInner + resolvedCornerRadius + remaining,
        normalX: 1,
        normalY: 0,
        tangentX: 0,
        tangentY: 1,
      };
    }
    remaining -= straightVerticalLength;

    // 4. Bottom-right arc (0 → π/2).
    if (remaining < arcSegmentLength) {
      const theta = remaining / resolvedCornerRadius;
      const normalX = Math.cos(theta);
      const normalY = Math.sin(theta);
      return {
        x: cornerCenters.bottomRight.x + normalX * resolvedCornerRadius,
        y: cornerCenters.bottomRight.y + normalY * resolvedCornerRadius,
        normalX,
        normalY,
        tangentX: -normalY,
        tangentY: normalX,
      };
    }
    remaining -= arcSegmentLength;

    // 5. Bottom straight (going left) — normal down, tangent left.
    if (remaining < straightHorizontalLength) {
      return {
        x: halfWidthInner - resolvedCornerRadius - remaining,
        y: halfHeightInner,
        normalX: 0,
        normalY: 1,
        tangentX: -1,
        tangentY: 0,
      };
    }
    remaining -= straightHorizontalLength;

    // 6. Bottom-left arc (π/2 → π).
    if (remaining < arcSegmentLength) {
      const theta = Math.PI / 2 + remaining / resolvedCornerRadius;
      const normalX = Math.cos(theta);
      const normalY = Math.sin(theta);
      return {
        x: cornerCenters.bottomLeft.x + normalX * resolvedCornerRadius,
        y: cornerCenters.bottomLeft.y + normalY * resolvedCornerRadius,
        normalX,
        normalY,
        tangentX: -normalY,
        tangentY: normalX,
      };
    }
    remaining -= arcSegmentLength;

    // 7. Left straight (going up) — normal left, tangent up.
    if (remaining < straightVerticalLength) {
      return {
        x: -halfWidthInner,
        y: halfHeightInner - resolvedCornerRadius - remaining,
        normalX: -1,
        normalY: 0,
        tangentX: 0,
        tangentY: -1,
      };
    }
    remaining -= straightVerticalLength;

    // 8. Top-left arc (π → 3π/2).
    const theta = Math.PI + remaining / resolvedCornerRadius;
    const normalX = Math.cos(theta);
    const normalY = Math.sin(theta);
    return {
      x: cornerCenters.topLeft.x + normalX * resolvedCornerRadius,
      y: cornerCenters.topLeft.y + normalY * resolvedCornerRadius,
      normalX,
      normalY,
      tangentX: -normalY,
      tangentY: normalX,
    };
  };

  // ── Fleck pool ──────────────────────────────────────────────────────────
  // Live inside `frame` so emission tracks the card's hover scale —
  // sparks should peel off the visual rim, not an axis-aligned bbox.
  const accentTint = accentColor ?? 0x88ccff;
  const fleckPoolSize = Math.max(
    FLECK_POOL_MIN,
    Math.min(FLECK_POOL_MAX, Math.round(borderPerimeter * FLECK_POOL_PER_PERIMETER_PX)),
  );
  interface FleckState {
    active: boolean;
    spawnX: number;
    spawnY: number;
    normalX: number;
    normalY: number;
    tangentX: number;
    tangentY: number;
    /** Signed tangential speed — randomized each spawn so sparks slide both ways. */
    tangentSpeed: number;
    age: number;
    lifetime: number;
    baseRadius: number;
    graphics: Phaser.GameObjects.Graphics;
  }
  const flecks: FleckState[] = [];
  const fleckLayer = scene.add.container(0, 0);
  frame.add(fleckLayer);
  fleckLayer.setVisible(false);
  for (let fleckIndex = 0; fleckIndex < fleckPoolSize; fleckIndex++) {
    const fleckGraphics = scene.add.graphics();
    fleckGraphics.setVisible(false);
    fleckLayer.add(fleckGraphics);
    flecks.push({
      active: false,
      spawnX: 0,
      spawnY: 0,
      normalX: 0,
      normalY: 0,
      tangentX: 0,
      tangentY: 0,
      tangentSpeed: 0,
      age: 0,
      lifetime: 0,
      baseRadius: FLECK_BASE_RADIUS,
      graphics: fleckGraphics,
    });
  }

  const emitFleck = (): void => {
    let inactiveSlot = -1;
    for (let i = 0; i < flecks.length; i++) {
      if (!flecks[i].active) {
        inactiveSlot = i;
        break;
      }
    }
    if (inactiveSlot < 0) return;
    const fleck = flecks[inactiveSlot];
    const sample = sampleBorderAtArcLength(Math.random() * borderPerimeter);
    const tangentDirection = Math.random() < 0.5 ? -1 : 1;
    const tangentMagnitude =
      FLECK_TANGENT_SPEED_MIN +
      Math.random() * (FLECK_TANGENT_SPEED_MAX - FLECK_TANGENT_SPEED_MIN);
    fleck.active = true;
    fleck.spawnX = sample.x;
    fleck.spawnY = sample.y;
    fleck.normalX = sample.normalX;
    fleck.normalY = sample.normalY;
    fleck.tangentX = sample.tangentX;
    fleck.tangentY = sample.tangentY;
    fleck.tangentSpeed = tangentDirection * tangentMagnitude;
    fleck.age = 0;
    fleck.lifetime =
      FLECK_LIFETIME_MIN + Math.random() * (FLECK_LIFETIME_MAX - FLECK_LIFETIME_MIN);
    fleck.baseRadius = FLECK_BASE_RADIUS * (0.75 + Math.random() * 0.55);
    drawFleck(fleck.graphics, accentTint, fleck.baseRadius);
    fleck.graphics.setPosition(sample.x, sample.y);
    fleck.graphics.setAlpha(0);
    fleck.graphics.setScale(1);
    fleck.graphics.setVisible(true);
  };

  let fleckSpawnAccumulator = 0;

  // ── State ────────────────────────────────────────────────────────────────
  let isHovered = false;
  let isFocused = false;
  let lastTickSeconds = 0;
  /** Smoothed 0..1 — gates fleck emission rate + halo alpha. */
  let fleckActivity = 0;
  const baseShadowAlpha = shadowAlpha;

  const applyHoverPose = () => {
    scene.tweens.killTweensOf([frame, shadow, glow]);
    scene.tweens.add({
      targets: frame,
      scaleX: HOVER_SCALE,
      scaleY: HOVER_SCALE,
      duration: HOVER_TWEEN_MS,
      ease: 'Sine.Out',
    });
    scene.tweens.add({
      targets: shadow,
      alpha: 1,
      duration: HOVER_TWEEN_MS,
      ease: 'Sine.Out',
    });
    drawCardGlow(glow, width, height, accentTint, cornerRadius);
    fleckLayer.setVisible(true);
  };

  const releaseHoverPose = () => {
    scene.tweens.killTweensOf([frame, shadow, glow]);
    scene.tweens.add({
      targets: frame,
      scaleX: 1,
      scaleY: 1,
      duration: HOVER_TWEEN_MS,
      ease: 'Sine.Out',
    });
    scene.tweens.add({
      targets: shadow,
      alpha: baseShadowAlpha,
      duration: HOVER_TWEEN_MS,
      ease: 'Sine.Out',
    });
  };

  const refreshActive = () => {
    if (isHovered || isFocused) applyHoverPose();
    else releaseHoverPose();
  };

  shadow.setAlpha(baseShadowAlpha);

  return {
    container,
    frame,
    width,
    height,
    hitZone,
    bannerTopY,
    bannerBottomY,
    setHoverState(hovered) {
      if (isHovered === hovered) return;
      isHovered = hovered;
      refreshActive();
    },
    setFocusState(focused) {
      if (isFocused === focused) return;
      isFocused = focused;
      refreshActive();
    },
    tickIdle(timeSeconds) {
      const dt = Math.max(0, Math.min(0.08, timeSeconds - lastTickSeconds));
      lastTickSeconds = timeSeconds;
      const target = isHovered || isFocused ? 1 : 0;
      // Exponential smoothing — ~140ms time constant — gates emission ramp.
      fleckActivity = fleckActivity + (target - fleckActivity) * Math.min(1, dt * 7.5);

      // Halo pulse: 1.0 ± 0.18 over ~1.6s, attenuated by current activity.
      const haloPulse = 0.85 + Math.sin(timeSeconds * 4 + pulseSeed) * 0.18;
      glow.setAlpha(fleckActivity * haloPulse);

      // Emit new flecks proportional to activity. Accumulator keeps spawn
      // cadence smooth across variable frame times.
      fleckSpawnAccumulator += dt * fleckActivity * FLECK_SPAWN_RATE_PER_SEC;
      while (fleckSpawnAccumulator >= 1) {
        emitFleck();
        fleckSpawnAccumulator -= 1;
      }

      // Advance + render flecks. Position is analytic: tangent slides along
      // the rim, normal velocity grows from FLECK_OUTWARD_ACCEL so each
      // spark briefly rides the border before peeling off outward.
      let anyFleckActive = false;
      for (let i = 0; i < flecks.length; i++) {
        const fleck = flecks[i];
        if (!fleck.active) continue;
        fleck.age += dt;
        if (fleck.age >= fleck.lifetime) {
          fleck.active = false;
          fleck.graphics.setVisible(false);
          continue;
        }
        anyFleckActive = true;
        const ageSeconds = fleck.age;
        const tangentDistance = fleck.tangentSpeed * ageSeconds;
        const outwardDistance =
          FLECK_OUTWARD_INITIAL_SPEED * ageSeconds +
          0.5 * FLECK_OUTWARD_ACCEL * ageSeconds * ageSeconds;
        const renderX =
          fleck.spawnX +
          fleck.tangentX * tangentDistance +
          fleck.normalX * outwardDistance;
        const renderY =
          fleck.spawnY +
          fleck.tangentY * tangentDistance +
          fleck.normalY * outwardDistance;
        const lifeProgress = ageSeconds / fleck.lifetime;
        // Quick fade-in, long ember-fade-out.
        const fadeInPortion = 0.12;
        const opacity =
          lifeProgress < fadeInPortion
            ? lifeProgress / fadeInPortion
            : 1 - (lifeProgress - fadeInPortion) / (1 - fadeInPortion);
        const renderScale = 1 - lifeProgress * 0.3;
        fleck.graphics.setPosition(renderX, renderY);
        fleck.graphics.setAlpha(opacity > 0 ? opacity : 0);
        fleck.graphics.setScale(renderScale);
      }

      // Hide the layer entirely when fully idle to skip per-frame container costs.
      if (!anyFleckActive && fleckActivity < 0.02) {
        fleckLayer.setVisible(false);
      } else {
        fleckLayer.setVisible(true);
      }
    },
    destroy() {
      scene.tweens.killTweensOf([container, frame, shadow, glow]);
      container.destroy();
    },
  };
}

// ── draw helpers ──────────────────────────────────────────────────────────

function drawCardShadow(
  graphics: Phaser.GameObjects.Graphics,
  width: number,
  height: number,
  offsetX: number,
  offsetY: number,
  alpha: number,
  cornerRadius?: number,
): void {
  const radius = cornerRadius ?? DEFAULT_CORNER_RADIUS;
  const halfW = width / 2;
  const halfH = height / 2;
  graphics.clear();
  // Layered shadow — soft bloom around the rim, hard center for grounding.
  graphics.fillStyle(0x000000, alpha * 0.45);
  graphics.fillRoundedRect(
    -halfW + offsetX - 4,
    -halfH + offsetY - 4,
    width + 8,
    height + 8,
    radius + 4,
  );
  graphics.fillStyle(0x000000, alpha);
  graphics.fillRoundedRect(-halfW + offsetX, -halfH + offsetY, width, height, radius);
}

/**
 * Soft accent halo behind the card. Drawn once on hover; the alpha pulses in
 * `tickIdle` so we don't redraw the geometry per frame.
 */
function drawCardGlow(
  graphics: Phaser.GameObjects.Graphics,
  width: number,
  height: number,
  accentColor: number,
  cornerRadius?: number,
): void {
  const radius = cornerRadius ?? DEFAULT_CORNER_RADIUS;
  const halfW = width / 2;
  const halfH = height / 2;
  graphics.clear();

  // Three concentric expanding halos — outermost faint + inner stronger.
  const layers = [
    { spread: 18, alpha: 0.12 },
    { spread: 10, alpha: 0.22 },
    { spread: 4, alpha: 0.36 },
  ];
  for (const layer of layers) {
    graphics.fillStyle(accentColor, layer.alpha);
    graphics.fillRoundedRect(
      -halfW - layer.spread,
      -halfH - layer.spread,
      width + layer.spread * 2,
      height + layer.spread * 2,
      radius + layer.spread,
    );
  }
}

function drawFleck(graphics: Phaser.GameObjects.Graphics, accentColor: number, baseRadius: number): void {
  graphics.clear();
  // Outer soft halo — wide, faint, gives the spark its glow footprint.
  graphics.fillStyle(accentColor, 0.20);
  graphics.fillCircle(0, 0, baseRadius * 2.6);
  // Mid tint — accent-colored body.
  graphics.fillStyle(accentColor, 0.55);
  graphics.fillCircle(0, 0, baseRadius * 1.5);
  // Bright white core — the eye-catching pop.
  graphics.fillStyle(0xffffff, 1);
  graphics.fillCircle(0, 0, baseRadius * 0.65);
}

function drawCardPanel(
  graphics: Phaser.GameObjects.Graphics,
  width: number,
  height: number,
  opts: {
    bodyFillColor?: number;
    bodyFillAlpha?: number;
    accentColor?: number;
    bannerHeight: number;
    borderWidth?: number;
    borderColor?: number;
    cornerRadius?: number;
  },
): void {
  const radius = opts.cornerRadius ?? DEFAULT_CORNER_RADIUS;
  const borderWidth = opts.borderWidth ?? 2;
  const borderColor = opts.borderColor ?? (opts.accentColor ?? 0x4488cc);
  const bodyColor = opts.bodyFillColor ?? DEFAULT_BODY;
  const bodyAlpha = opts.bodyFillAlpha ?? 0.95;
  const halfW = width / 2;
  const halfH = height / 2;

  graphics.clear();

  // Outer accent/black border (drawn as filled rect slightly larger than inner).
  graphics.fillStyle(borderColor, 1);
  graphics.fillRoundedRect(
    -halfW - borderWidth,
    -halfH - borderWidth,
    width + borderWidth * 2,
    height + borderWidth * 2,
    radius + borderWidth * 0.5,
  );

  // Body fill.
  graphics.fillStyle(bodyColor, bodyAlpha);
  graphics.fillRoundedRect(-halfW, -halfH, width, height, radius);

  // Top banner (clipped to top corners). Sits above body fill.
  if (opts.bannerHeight > 0 && opts.accentColor !== undefined) {
    graphics.fillStyle(opts.accentColor, 1);
    graphics.fillRoundedRect(-halfW, -halfH, width, opts.bannerHeight, {
      tl: radius,
      tr: radius,
      bl: 0,
      br: 0,
    });
    graphics.fillStyle(0x000000, 0.5);
    graphics.fillRect(-halfW, -halfH + opts.bannerHeight, width, 2);
    graphics.fillStyle(0xffffff, 0.18);
    graphics.fillRect(-halfW + radius * 0.5, -halfH + 1, width - radius, 1);
  }

  // Subtle inner shadow along the bottom for depth.
  graphics.fillStyle(0x000000, 0.22);
  graphics.fillRoundedRect(-halfW, halfH - 4, width, 4, {
    tl: 0, tr: 0, bl: radius, br: radius,
  });
}
