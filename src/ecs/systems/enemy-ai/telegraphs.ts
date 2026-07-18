import type { TelegraphManager } from '../../../effects/TelegraphManager';

/**
 * Pure "AI windup → telegraph spec" mapping — the single source of truth for
 * attack-telegraph geometry, timing, and color. EnemyAISystem feeds these
 * specs to the injected TelegraphManager at windup-state transitions.
 *
 * Contract (locked by telegraphs.test.ts): a telegraph's duration equals the
 * windup it warns about, and a ring's footprint covers the attack's damage
 * radius (rings overshoot slightly so the warning is conservative). Specs are
 * pure readability — nothing here feeds back into damage or attack timing.
 */

export interface RingTelegraphSpec {
  shape: 'ring';
  radius: number;
  duration: number;
  color: number;
}

export interface LineTelegraphSpec {
  shape: 'line';
  angle: number;
  length: number;
  thickness: number;
  duration: number;
  color: number;
}

export type TelegraphSpec = RingTelegraphSpec | LineTelegraphSpec;

/** Zigzag Runner dart lunge — lane toward the player during the 0.35s windup. */
export function zigzagDartTelegraph(angle: number): LineTelegraphSpec {
  return { shape: 'line', angle, length: 140, thickness: 8, duration: 0.35, color: 0xff8833 };
}

/** Dasher dash — trajectory overlay drawn as the 0.5s lunge starts. */
export function dasherDashTelegraph(angle: number): LineTelegraphSpec {
  return { shape: 'line', angle, length: 360, thickness: 16, duration: 0.5, color: 0xff9933 };
}

/** Charger miniboss — charge lane across the screen during the 0.8s windup. */
export function chargerChargeTelegraph(angle: number): LineTelegraphSpec {
  return { shape: 'line', angle, length: 520, thickness: 26, duration: 0.8, color: 0xff5533 };
}

/** Warden ground slam — AOE footprint during the 0.8s plant (damage radius 50). */
export function wardenSlamTelegraph(): RingTelegraphSpec {
  return { shape: 'ring', radius: 56, duration: 0.8, color: 0xff5555 };
}

/** Giant stomp — AOE footprint during the 1.0s shake windup (damage radius 80). */
export function giantStompTelegraph(): RingTelegraphSpec {
  return { shape: 'ring', radius: 88, duration: 1.0, color: 0xff5555 };
}

/**
 * Exploder death fuse — blast footprint shown while the corpse is armed
 * (BALANCE-EXPLODER-FUSE). Duration equals the 0.4s fuse GameScene ticks via
 * ./exploder-fuse.ts; the +6 overshoots the blast radius (60) so the warning
 * is conservative, like the other AOE rings. VOLATILE elite detonations stay
 * instant and untelegraphed (parked in BACKLOG.md).
 */
export function exploderFuseTelegraph(): RingTelegraphSpec {
  return { shape: 'ring', radius: 66, duration: 0.4, color: 0xff5555 };
}

/**
 * Horde King ground slam — phase-scaled footprint during the 1.0s windup.
 * Damage radius at execute is 150 + phase × 30; the +10 overshoot also absorbs
 * the boss's shake-jitter drift between windup start and the slam.
 */
export function hordeKingSlamTelegraph(phase: number): RingTelegraphSpec {
  return { shape: 'ring', radius: 160 + phase * 30, duration: 1.0, color: 0xff5555 };
}

/**
 * Void Wyrm sweep — lane from the wyrm to its stored sweep target during the
 * 0.8s prepare state. The +80 overshoot covers the wyrm carrying past the
 * target before the sweep state ends.
 */
export function voidWyrmSweepTelegraph(
  enemyX: number,
  enemyY: number,
  targetX: number,
  targetY: number
): LineTelegraphSpec {
  const dx = targetX - enemyX;
  const dy = targetY - enemyY;
  const distance = Math.sqrt(dx * dx + dy * dy);
  return {
    shape: 'line',
    angle: Math.atan2(dy, dx),
    length: distance + 80,
    thickness: 30,
    duration: 0.8,
    color: 0xff5533,
  };
}

/** Void Wyrm projectile ring — pulse around the wyrm before the t=0.3 burst. */
export function voidWyrmRingTelegraph(): RingTelegraphSpec {
  return { shape: 'ring', radius: 90, duration: 0.3, color: 0xff5555 };
}

/**
 * The Machine laser grid — main beam toward the stored target plus the two
 * perpendicular cross beams, drawn for the full 1.5s charge. Length matches
 * the in-game laser (800).
 */
export function theMachineLaserTelegraphs(
  enemyX: number,
  enemyY: number,
  targetX: number,
  targetY: number
): LineTelegraphSpec[] {
  const mainAngle = Math.atan2(targetY - enemyY, targetX - enemyX);
  const beam = (angle: number): LineTelegraphSpec => ({
    shape: 'line',
    angle,
    length: 800,
    thickness: 12,
    duration: 1.5,
    color: 0xff3366,
  });
  return [beam(mainAngle), beam(mainAngle + Math.PI / 2), beam(mainAngle - Math.PI / 2)];
}

/**
 * The Bastion mortar shell — impact footprint at the planned strike point for
 * the shell's whole flight time (impactDelay from bastion-barrage planning).
 * The +8 overshoots the blast radius (70) so the warning is conservative,
 * like the other AOE rings.
 */
export function bastionMortarTelegraph(impactDelay: number): RingTelegraphSpec {
  return { shape: 'ring', radius: 78, duration: impactDelay, color: 0xff7733 };
}

/**
 * The Pulsar strike warning. Damage radius at execute is 60; the +8 overshoots
 * it so the ring is a conservative warning. Duration = the strike's flight time
 * (the ring fills exactly as the strike lands).
 */
export function pulsarStrikeTelegraph(impactDelay: number): RingTelegraphSpec {
  return { shape: 'ring', radius: 68, duration: impactDelay, color: 0xff6633 };
}

/**
 * The Obelisk wall-strike warning. Damage radius at execute is 88; the +8
 * overshoots it so the ring is a conservative warning. Duration = the strike's
 * flight time (the ring fills exactly as the strike lands).
 */
export function obeliskStrikeTelegraph(impactDelay: number): RingTelegraphSpec {
  return { shape: 'ring', radius: 96, duration: impactDelay, color: 0x44ff99 };
}

/**
 * The Helix spiral-strike warning. Damage radius at execute is 60; the +8
 * overshoots it so the ring is a conservative warning. Duration = the strike's
 * flight time (the ring fills exactly as the strike lands).
 */
export function helixStrikeTelegraph(impactDelay: number): RingTelegraphSpec {
  return { shape: 'ring', radius: 68, duration: impactDelay, color: 0xcc66ff };
}

/**
 * The Tessellator tile-strike warning. Damage radius at execute is 108; the +8
 * overshoots it so the ring is a conservative warning. Duration = the strike's
 * fuse (the ring fills exactly as the strike lands).
 */
export function tessellatorStrikeTelegraph(impactDelay: number): RingTelegraphSpec {
  return { shape: 'ring', radius: 116, duration: impactDelay, color: 0x44ccff };
}

/**
 * The Tremor shockwave-strike warning. Damage radius at execute is 140; the +8
 * overshoots it so the ring is a conservative warning. Duration = the strike's
 * fuse (the ring fills exactly as the shockwave reaches the tile).
 */
export function tremorStrikeTelegraph(impactDelay: number): RingTelegraphSpec {
  return { shape: 'ring', radius: 148, duration: impactDelay, color: 0xff8822 };
}

/**
 * The Diviner scrying-cage warning. Damage radius at execute is 88; the +8
 * overshoots it so the ring is a conservative warning. Duration = the cage fuse
 * (the ring fills exactly as the cage snaps shut).
 */
export function divinerStrikeTelegraph(impactDelay: number): RingTelegraphSpec {
  return { shape: 'ring', radius: 96, duration: impactDelay, color: 0xff44dd };
}

/**
 * The Bombard mortar strike warning. Damage radius at execute is 62; the +8
 * overshoots it so the ring is a conservative warning. Duration = the strike's
 * fuse (the ring fills exactly as the shell lands).
 */
export function bombardStrikeTelegraph(impactDelay: number): RingTelegraphSpec {
  return { shape: 'ring', radius: 70, duration: impactDelay, color: 0xffaa33 };
}

/**
 * The Stalker predictive-strike warning. Damage radius at execute is 58; the +8
 * overshoots it so the ring is a conservative warning. Duration = the strike's flight
 * time (the ring fills exactly as the strike lands).
 */
export function stalkerStrikeTelegraph(impactDelay: number): RingTelegraphSpec {
  return { shape: 'ring', radius: 66, duration: impactDelay, color: 0xff33aa };
}

/** Routes a spec to the manager's ring/line spawner. No-op when manager is null. */
export function spawnTelegraph(
  manager: Pick<TelegraphManager, 'spawnRing' | 'spawnLine'> | null,
  x: number,
  y: number,
  spec: TelegraphSpec
): void {
  if (!manager) return;
  if (spec.shape === 'ring') {
    manager.spawnRing(x, y, spec.radius, spec.duration, spec.color);
  } else {
    manager.spawnLine(x, y, spec.angle, spec.length, spec.duration, spec.color, spec.thickness);
  }
}
