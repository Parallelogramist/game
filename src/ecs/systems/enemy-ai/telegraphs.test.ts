import { describe, test, expect } from 'vitest';
import {
  zigzagDartTelegraph,
  dasherDashTelegraph,
  chargerChargeTelegraph,
  wardenSlamTelegraph,
  giantStompTelegraph,
  exploderFuseTelegraph,
  hordeKingSlamTelegraph,
  voidWyrmSweepTelegraph,
  voidWyrmRingTelegraph,
  theMachineLaserTelegraphs,
  spawnTelegraph,
  type TelegraphSpec,
  type LineTelegraphSpec,
} from './telegraphs';
import { EXPLODER_FUSE_SECONDS, EXPLODER_BLAST_RADIUS } from './exploder-fuse';

/**
 * Pure "AI windup → telegraph spec" mapping. The contract under test: every
 * telegraph's duration matches the windup it warns about, and every ring's
 * footprint covers the damage radius of the attack. Telegraphs are pure
 * readability — these specs never feed back into damage or timing, so the
 * only way they can be wrong is silently (a lying warning), which is what
 * these tests lock against.
 *
 * Damage/windup constants mirrored from the AI handlers (regular enemies in
 * the sibling behavior modules, minibosses/bosses in ../EnemyAISystem.ts) and
 * are asserted exactly so spec drift is a deliberate, reviewed change.
 */

// ── Attack ground truth (from the AI handlers) ──────────────────────────────
const ZIGZAG_DART_WINDUP = 0.35;      // updateZigzagAI state 1 duration
const DASHER_DASH_DURATION = 0.5;     // dash telegraph drawn as the lunge starts
const CHARGER_WINDUP = 0.8;           // updateChargerAI windup before charge
const WARDEN_PLANT_WINDUP = 0.8;      // updateWardenAI state 1 plant duration
const WARDEN_SLAM_RADIUS = 50;        // groundSlamCallback(x, y, 50, ...)
const GIANT_STOMP_WINDUP = 1.0;       // updateGiantAI state 1 duration
const GIANT_STOMP_RADIUS = 80;        // groundSlamCallback(x, y, 80, ...)
// Exploder fuse/blast ground truth is imported from ./exploder-fuse — those
// constants ARE what GameScene arms and detonates with, so asserting against
// them locks spec == fuse == blast by construction.
const HORDE_KING_SLAM_WINDUP = 1.0;   // updateHordeKingAI state 2 duration
const hordeKingSlamRadius = (phase: number) => 150 + phase * 30; // state 3 execute
const VOID_WYRM_SWEEP_WINDUP = 0.8;   // updateVoidWyrmAI state 1 duration
const VOID_WYRM_RING_DELAY = 0.3;     // state 3 fires the projectile ring at t=0.3
const MACHINE_CHARGE_WINDUP = 1.5;    // updateTheMachineAI state 2 duration
const MACHINE_LASER_LENGTH = 800;     // state 3 laserLength

function expectWellFormed(spec: TelegraphSpec): void {
  expect(Number.isFinite(spec.duration)).toBe(true);
  expect(spec.duration).toBeGreaterThan(0);
  expect(Number.isInteger(spec.color)).toBe(true);
  expect(spec.color).toBeGreaterThanOrEqual(0);
  expect(spec.color).toBeLessThanOrEqual(0xffffff);
  if (spec.shape === 'ring') {
    expect(Number.isFinite(spec.radius)).toBe(true);
    expect(spec.radius).toBeGreaterThan(0);
  } else {
    expect(Number.isFinite(spec.angle)).toBe(true);
    expect(Number.isFinite(spec.length)).toBe(true);
    expect(spec.length).toBeGreaterThan(0);
    expect(spec.thickness).toBeGreaterThan(0);
  }
}

describe('telegraph specs — every spec is well-formed', () => {
  test('all spec factories produce finite, positive geometry and valid colors', () => {
    const samples: TelegraphSpec[] = [
      zigzagDartTelegraph(1.2),
      dasherDashTelegraph(-0.4),
      chargerChargeTelegraph(2.0),
      wardenSlamTelegraph(),
      giantStompTelegraph(),
      exploderFuseTelegraph(),
      hordeKingSlamTelegraph(1),
      hordeKingSlamTelegraph(2),
      hordeKingSlamTelegraph(3),
      voidWyrmSweepTelegraph(100, 100, 400, 300),
      voidWyrmRingTelegraph(),
      ...theMachineLaserTelegraphs(640, 360, 200, 500),
    ];
    for (const spec of samples) expectWellFormed(spec);
  });
});

describe('durations match the windups they warn about', () => {
  test('zigzag dart telegraph lasts exactly the dart windup', () => {
    expect(zigzagDartTelegraph(0).duration).toBe(ZIGZAG_DART_WINDUP);
  });

  test('dasher dash telegraph matches the dash overlay duration', () => {
    expect(dasherDashTelegraph(0).duration).toBe(DASHER_DASH_DURATION);
  });

  test('charger charge telegraph lasts exactly the charge windup', () => {
    expect(chargerChargeTelegraph(0).duration).toBe(CHARGER_WINDUP);
  });

  test('warden slam telegraph lasts exactly the plant windup', () => {
    expect(wardenSlamTelegraph().duration).toBe(WARDEN_PLANT_WINDUP);
  });

  test('giant stomp telegraph lasts exactly the stomp windup', () => {
    expect(giantStompTelegraph().duration).toBe(GIANT_STOMP_WINDUP);
  });

  test('exploder fuse telegraph lasts exactly the death fuse', () => {
    expect(exploderFuseTelegraph().duration).toBe(EXPLODER_FUSE_SECONDS);
  });

  test('horde king slam telegraph lasts exactly the slam windup', () => {
    expect(hordeKingSlamTelegraph(1).duration).toBe(HORDE_KING_SLAM_WINDUP);
    expect(hordeKingSlamTelegraph(3).duration).toBe(HORDE_KING_SLAM_WINDUP);
  });

  test('void wyrm sweep telegraph lasts exactly the sweep windup', () => {
    expect(voidWyrmSweepTelegraph(0, 0, 100, 0).duration).toBe(VOID_WYRM_SWEEP_WINDUP);
  });

  test('void wyrm ring telegraph lasts exactly the pre-fire delay', () => {
    expect(voidWyrmRingTelegraph().duration).toBe(VOID_WYRM_RING_DELAY);
  });

  test('machine laser telegraphs last exactly the charge windup', () => {
    for (const beam of theMachineLaserTelegraphs(0, 0, 100, 100)) {
      expect(beam.duration).toBe(MACHINE_CHARGE_WINDUP);
    }
  });
});

describe('ring footprints cover the damage they warn about', () => {
  test('warden telegraph radius covers the slam radius', () => {
    expect(wardenSlamTelegraph().radius).toBeGreaterThanOrEqual(WARDEN_SLAM_RADIUS);
  });

  test('giant telegraph radius covers the stomp radius', () => {
    expect(giantStompTelegraph().radius).toBeGreaterThanOrEqual(GIANT_STOMP_RADIUS);
  });

  test('exploder fuse telegraph radius covers the blast radius', () => {
    expect(exploderFuseTelegraph().radius).toBeGreaterThanOrEqual(EXPLODER_BLAST_RADIUS);
  });

  test('horde king telegraph radius covers the phase-scaled slam radius', () => {
    for (const phase of [1, 2, 3]) {
      expect(hordeKingSlamTelegraph(phase).radius).toBeGreaterThanOrEqual(hordeKingSlamRadius(phase));
    }
  });

  test('horde king telegraph grows monotonically with phase', () => {
    expect(hordeKingSlamTelegraph(2).radius).toBeGreaterThan(hordeKingSlamTelegraph(1).radius);
    expect(hordeKingSlamTelegraph(3).radius).toBeGreaterThan(hordeKingSlamTelegraph(2).radius);
  });
});

describe('line telegraphs point where the attack goes', () => {
  test('dash-style specs pass the attack angle through unchanged', () => {
    expect(zigzagDartTelegraph(1.234).angle).toBe(1.234);
    expect(dasherDashTelegraph(-2.5).angle).toBe(-2.5);
    expect(chargerChargeTelegraph(0.75).angle).toBe(0.75);
  });

  test('void wyrm sweep aims at the stored sweep target', () => {
    const spec = voidWyrmSweepTelegraph(100, 200, 400, 600);
    expect(spec.angle).toBeCloseTo(Math.atan2(600 - 200, 400 - 100), 10);
  });

  test('void wyrm sweep lane covers the full path to the target', () => {
    const spec = voidWyrmSweepTelegraph(0, 0, 300, 400); // distance 500
    expect(spec.length).toBeGreaterThanOrEqual(500);
  });

  test('void wyrm sweep at zero distance stays finite', () => {
    const spec = voidWyrmSweepTelegraph(50, 50, 50, 50);
    expect(Number.isFinite(spec.angle)).toBe(true);
    expect(spec.length).toBeGreaterThan(0);
  });

  test('machine fires three beams: main at target, crosses perpendicular', () => {
    const beams = theMachineLaserTelegraphs(640, 360, 940, 360); // target due east
    expect(beams).toHaveLength(3);
    const mainAngle = Math.atan2(0, 300);
    expect(beams[0].angle).toBeCloseTo(mainAngle, 10);
    expect(beams[1].angle).toBeCloseTo(mainAngle + Math.PI / 2, 10);
    expect(beams[2].angle).toBeCloseTo(mainAngle - Math.PI / 2, 10);
  });

  test('machine beams span the in-game laser length', () => {
    for (const beam of theMachineLaserTelegraphs(0, 0, 1, 1)) {
      expect(beam.length).toBe(MACHINE_LASER_LENGTH);
    }
  });
});

describe('spawnTelegraph — spec → manager routing', () => {
  interface RingCall { x: number; y: number; maxRadius: number; duration: number; color: number }
  interface LineCall { x: number; y: number; angle: number; length: number; duration: number; color: number; thickness: number }

  function makeFakeManager() {
    const rings: RingCall[] = [];
    const lines: LineCall[] = [];
    return {
      rings,
      lines,
      manager: {
        spawnRing(x: number, y: number, maxRadius: number, duration: number, color: number) {
          rings.push({ x, y, maxRadius, duration, color });
        },
        spawnLine(x: number, y: number, angle: number, length: number, duration: number, color: number, thickness: number) {
          lines.push({ x, y, angle, length, duration, color, thickness });
        },
      },
    };
  }

  test('null manager is a safe no-op', () => {
    expect(() => spawnTelegraph(null, 10, 20, giantStompTelegraph())).not.toThrow();
  });

  test('ring specs route to spawnRing with the spec geometry', () => {
    const fake = makeFakeManager();
    const spec = giantStompTelegraph();
    spawnTelegraph(fake.manager, 111, 222, spec);
    expect(fake.lines).toHaveLength(0);
    expect(fake.rings).toEqual([
      { x: 111, y: 222, maxRadius: spec.radius, duration: spec.duration, color: spec.color },
    ]);
  });

  test('line specs route to spawnLine with the spec geometry', () => {
    const fake = makeFakeManager();
    const spec: LineTelegraphSpec = chargerChargeTelegraph(1.5);
    spawnTelegraph(fake.manager, 33, 44, spec);
    expect(fake.rings).toHaveLength(0);
    expect(fake.lines).toEqual([
      {
        x: 33, y: 44, angle: spec.angle, length: spec.length,
        duration: spec.duration, color: spec.color, thickness: spec.thickness,
      },
    ]);
  });
});
