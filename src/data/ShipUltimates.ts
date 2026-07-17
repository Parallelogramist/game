import type { TimedStatField } from '../systems/TimedStatBuffs';

/**
 * Per-ship ultimates. The Overdrive meter is shared (see UltimateSystem.ts — charge,
 * suppression and nova scaling all stay there); this registry only says what firing it
 * *does* for the ship you are flying.
 *
 * Effects compose verified primitives and every one is unconditionally live — nothing
 * here is gated behind an upgrade, so no ship can be sold an ultimate that silently
 * does nothing. (Shield charges are deliberately absent: they no-op without the Shield
 * Barrier upgrade. The defensive ultimates grant iframes instead.)
 *
 * `nova.*Multiplier` scales computeUltimateNova()'s output, so central nova tuning
 * still reaches every ship.
 */
export type ShipUltimateId =
  | 'overdrive'
  | 'temporal_rip'
  | 'siege_pulse'
  | 'insight_surge'
  | 'bulwark_slam'
  | 'void_collapse'
  | 'execution_mark'
  | 'pristine_aegis'
  | 'critical_cascade'
  | 'culling_field'
  | 'apex_ascendance';

export interface UltimateNovaShape {
  /** Scales computeUltimateNova().radius. */
  radiusMultiplier: number;
  /** Scales computeUltimateNova().damage. */
  damageMultiplier: number;
  /** Absolute knockback force (replaces the nova's default). */
  knockback: number;
}

export interface UltimateStatBuff {
  stat: TimedStatField;
  /** Multiplier, e.g. 2.5 = x2.5 while active. */
  magnitude: number;
  seconds: number;
}

export interface ShipUltimateDefinition {
  id: ShipUltimateId;
  /** Shown on the ship-select card. */
  name: string;
  /** Shown on the ship-select card. One short sentence. */
  description: string;

  nova: UltimateNovaShape;

  /** Applied to enemies left alive inside the nova radius. Durations are MILLISECONDS. */
  freeze?: { slowMultiplier: number; durationMs: number };
  burn?: { damage: number; durationMs: number };
  poison?: { stacks: number; durationMs: number };

  /** Fraction of maxHealth healed (0.25 = 25%). Routed through healPlayer (healingBoost applies). */
  healFraction?: number;
  /** Seconds of invulnerability (damageCooldown). */
  iframeSeconds?: number;
  /** Seconds added to slowTimeRemaining (75% game speed). */
  slowTimeSeconds?: number;
  statBuffs?: UltimateStatBuff[];

  slowMo: { durationMs: number; scale: number; rampMs: number };
  /** playDeathBurst tint. */
  burstColor: number;
  flash: { durationMs: number; red: number; green: number; blue: number };
  shake: { durationMs: number; intensity: number };
}

export const SHIP_ULTIMATES: ShipUltimateDefinition[] = [
  {
    id: 'overdrive',
    name: 'Overdrive',
    description: 'Screen-clearing nova.',
    nova: { radiusMultiplier: 1.0, damageMultiplier: 1.0, knockback: 380 },
    slowMo: { durationMs: 900, scale: 0.2, rampMs: 300 },
    burstColor: 0xffcc33,
    flash: { durationMs: 450, red: 255, green: 220, blue: 120 },
    shake: { durationMs: 320, intensity: 0.022 },
  },
  {
    id: 'temporal_rip',
    name: 'Temporal Rip',
    description: 'Tears the clock: 8s of slowed time, plus a light blast.',
    nova: { radiusMultiplier: 0.7, damageMultiplier: 0.5, knockback: 260 },
    slowTimeSeconds: 8,
    slowMo: { durationMs: 700, scale: 0.25, rampMs: 250 },
    burstColor: 0x66ff99,
    flash: { durationMs: 400, red: 140, green: 255, blue: 190 },
    shake: { durationMs: 260, intensity: 0.016 },
  },
  {
    id: 'siege_pulse',
    name: 'Siege Pulse',
    description: 'Short, very heavy blast. Repairs 25% HP.',
    nova: { radiusMultiplier: 0.6, damageMultiplier: 2.0, knockback: 300 },
    healFraction: 0.25,
    slowMo: { durationMs: 900, scale: 0.2, rampMs: 300 },
    burstColor: 0xff5544,
    flash: { durationMs: 450, red: 255, green: 140, blue: 110 },
    shake: { durationMs: 380, intensity: 0.03 },
  },
  {
    id: 'insight_surge',
    name: 'Insight Surge',
    description: 'x3 XP and x2 gem value for 12s.',
    nova: { radiusMultiplier: 0.8, damageMultiplier: 0.4, knockback: 200 },
    statBuffs: [
      { stat: 'xpMultiplier', magnitude: 3, seconds: 12 },
      { stat: 'gemValueMultiplier', magnitude: 2, seconds: 12 },
    ],
    slowMo: { durationMs: 700, scale: 0.3, rampMs: 250 },
    burstColor: 0xaa66ff,
    flash: { durationMs: 400, red: 200, green: 150, blue: 255 },
    shake: { durationMs: 200, intensity: 0.012 },
  },
  {
    id: 'bulwark_slam',
    name: 'Bulwark Slam',
    description: 'Massive shockwave. 2s invulnerable.',
    nova: { radiusMultiplier: 1.1, damageMultiplier: 1.2, knockback: 1200 },
    iframeSeconds: 2,
    slowMo: { durationMs: 1000, scale: 0.2, rampMs: 300 },
    burstColor: 0xffd700,
    flash: { durationMs: 480, red: 255, green: 230, blue: 150 },
    shake: { durationMs: 450, intensity: 0.035 },
  },
  {
    id: 'void_collapse',
    name: 'Void Collapse',
    description: 'Blasts, then freezes every survivor for 5s.',
    nova: { radiusMultiplier: 1.0, damageMultiplier: 1.3, knockback: 200 },
    freeze: { slowMultiplier: 0.12, durationMs: 5000 },
    slowMo: { durationMs: 900, scale: 0.2, rampMs: 300 },
    burstColor: 0xff66cc,
    flash: { durationMs: 450, red: 255, green: 150, blue: 220 },
    shake: { durationMs: 300, intensity: 0.02 },
  },
  {
    id: 'execution_mark',
    name: 'Execution Mark',
    description: 'Ignites every survivor — heavy burn for 10s.',
    nova: { radiusMultiplier: 0.9, damageMultiplier: 0.8, knockback: 240 },
    burn: { damage: 60, durationMs: 10000 },
    slowMo: { durationMs: 800, scale: 0.22, rampMs: 280 },
    burstColor: 0xff4422,
    flash: { durationMs: 430, red: 255, green: 120, blue: 80 },
    shake: { durationMs: 320, intensity: 0.024 },
  },
  {
    id: 'pristine_aegis',
    name: 'Pristine Aegis',
    description: 'Full repair and 3s invulnerable.',
    nova: { radiusMultiplier: 0.8, damageMultiplier: 0.6, knockback: 400 },
    healFraction: 1.0,
    iframeSeconds: 3,
    slowMo: { durationMs: 900, scale: 0.25, rampMs: 300 },
    burstColor: 0xffffff,
    flash: { durationMs: 500, red: 255, green: 255, blue: 255 },
    shake: { durationMs: 240, intensity: 0.014 },
  },
  {
    id: 'critical_cascade',
    name: 'Critical Cascade',
    description: 'x2.5 damage for 10s.',
    nova: { radiusMultiplier: 0.7, damageMultiplier: 0.8, knockback: 240 },
    statBuffs: [{ stat: 'damageMultiplier', magnitude: 2.5, seconds: 10 }],
    slowMo: { durationMs: 700, scale: 0.25, rampMs: 250 },
    burstColor: 0xff66cc,
    flash: { durationMs: 420, red: 255, green: 120, blue: 200 },
    shake: { durationMs: 300, intensity: 0.022 },
  },
  {
    id: 'culling_field',
    name: 'Culling Field',
    description: 'Blast plus max poison stacks on every survivor.',
    nova: { radiusMultiplier: 1.0, damageMultiplier: 0.9, knockback: 260 },
    poison: { stacks: 10, durationMs: 12000 },
    slowMo: { durationMs: 800, scale: 0.22, rampMs: 280 },
    burstColor: 0x66ff66,
    flash: { durationMs: 420, red: 150, green: 255, blue: 150 },
    shake: { durationMs: 300, intensity: 0.02 },
  },
  {
    id: 'apex_ascendance',
    name: 'Apex Ascendance',
    description: 'Wider, heavier nova. x1.8 damage for 10s and repairs 30% HP.',
    nova: { radiusMultiplier: 1.2, damageMultiplier: 1.4, knockback: 500 },
    healFraction: 0.3,
    statBuffs: [{ stat: 'damageMultiplier', magnitude: 1.8, seconds: 10 }],
    slowMo: { durationMs: 1100, scale: 0.18, rampMs: 320 },
    burstColor: 0xffd700,
    flash: { durationMs: 520, red: 255, green: 240, blue: 180 },
    shake: { durationMs: 480, intensity: 0.032 },
  },
];

const DEFAULT_ULTIMATE_ID: ShipUltimateId = 'overdrive';

/**
 * Resolve an ultimate by id. An unknown id falls back to Overdrive rather than
 * throwing — a corrupt/legacy ship id must never break run start. ShipUltimates.test.ts
 * pins that every shipped ship resolves without needing the fallback.
 */
export function getShipUltimate(id: ShipUltimateId | undefined): ShipUltimateDefinition {
  const found = SHIP_ULTIMATES.find((ultimate) => ultimate.id === id);
  return found ?? SHIP_ULTIMATES.find((u) => u.id === DEFAULT_ULTIMATE_ID)!;
}

export function getUltimateForShip(ship: { ultimateId?: ShipUltimateId }): ShipUltimateDefinition {
  return getShipUltimate(ship.ultimateId);
}
