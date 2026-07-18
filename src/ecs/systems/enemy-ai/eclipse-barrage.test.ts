import { describe, it, expect } from 'vitest';
import {
  planEclipseChannel,
  eclipseChannelEnd,
  eclipseStrikeDamage,
  eclipseFuseForPhase,
  eclipsePulseIntervalForPhase,
  eclipsePulseCountForPhase,
  eclipseSafeRadiusForPhase,
  ECLIPSE_BLAST_RADIUS,
  ECLIPSE_MAX_DRIFT,
  ECLIPSE_ANCHORS,
} from './eclipse-barrage';

describe('eclipse roving-umbra channel', () => {
  it('fires one pulse group per pulse and always spares at least one tile (the umbra)', () => {
    for (const phase of [1, 2, 3]) {
      const strikes = planEclipseChannel(640, 360, 640, 360, phase);
      const byDelay = new Map<number, number>();
      for (const strike of strikes) {
        byDelay.set(strike.telegraphDelay, (byDelay.get(strike.telegraphDelay) ?? 0) + 1);
      }
      expect(byDelay.size).toBe(eclipsePulseCountForPhase(phase)); // one group per pulse
      for (const count of byDelay.values()) {
        expect(count).toBeGreaterThan(0);
        expect(count).toBeLessThan(24); // < the full 6x4 board → ≥1 tile spared
      }
    }
  });

  it('stays pool-safe: interval > fuse, so pulses never overlap in the 32-slot pool', () => {
    for (const phase of [1, 2, 3]) {
      expect(eclipsePulseIntervalForPhase(phase)).toBeGreaterThan(eclipseFuseForPhase(phase));
    }
  });

  it('leaves a genuine safe core — umbra radius exceeds the blast, blast under tile spacing', () => {
    for (const phase of [1, 2, 3]) {
      expect(eclipseSafeRadiusForPhase(phase)).toBeGreaterThan(ECLIPSE_BLAST_RADIUS);
    }
    expect(ECLIPSE_BLAST_RADIUS).toBeLessThan(180); // under min tile-centre spacing (fair)
  });

  it('drifts a capped distance toward the anchor and the safe hole moves', () => {
    const end = eclipseChannelEnd(200, 200, ECLIPSE_ANCHORS[2].x, ECLIPSE_ANCHORS[2].y);
    const dist = Math.hypot(end.x - 200, end.y - 200);
    expect(dist).toBeGreaterThan(0);
    expect(dist).toBeLessThanOrEqual(ECLIPSE_MAX_DRIFT + 1e-6);
    // A moving umbra: with distinct start/end the first and last pulse spare
    // different tiles (the hole moves), so the player must follow it.
    const strikes = planEclipseChannel(200, 200, end.x, end.y, 3);
    const lastDelay = Math.max(...strikes.map((s) => s.telegraphDelay));
    const holeAt = (delay: number) => {
      const struck = new Set(
        strikes.filter((s) => s.telegraphDelay === delay).map((s) => `${s.x},${s.y}`),
      );
      // A tile is "safe" this pulse if no strike targets it.
      const safe: string[] = [];
      for (let row = 0; row < 4; row++) {
        for (let col = 0; col < 6; col++) {
          const key = `${col * (1280 / 6) + 1280 / 12},${row * (720 / 4) + 720 / 8}`;
          if (!struck.has(key)) safe.push(key);
        }
      }
      return new Set(safe);
    };
    const firstHole = holeAt(0);
    const lastHole = holeAt(lastDelay);
    expect([...firstHole].some((k) => !lastHole.has(k))).toBe(true);
  });

  it('keeps every strike centre inside the arena and scales damage by phase', () => {
    for (const strike of planEclipseChannel(640, 360, 320, 180, 3)) {
      expect(strike.x).toBeGreaterThanOrEqual(0);
      expect(strike.x).toBeLessThanOrEqual(1280);
      expect(strike.y).toBeGreaterThanOrEqual(0);
      expect(strike.y).toBeLessThanOrEqual(720);
    }
    expect(eclipseStrikeDamage(1)).toBe(18);
    expect(eclipseStrikeDamage(3)).toBe(28);
    expect(eclipseStrikeDamage(1)).toBeLessThan(eclipseStrikeDamage(3));
  });
});
