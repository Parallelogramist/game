import { describe, test, expect } from 'vitest';
import {
  STAGES,
  getStageById,
  getDefaultStage,
  BASE_AMBIENT_DARKNESS,
  MIN_STAGE_DRIFT_FACTOR,
  resolveStageAmbientDarkness,
  resolveStageDriftFactor,
} from './Stages';
import { HIDDEN_UNLOCKS } from '../meta/HiddenUnlocks';

// The gate syntaxes the StageDefinition doc promises (the shared parser in
// src/data/UnlockGates.ts also accepts 'account:<n>', but no stage uses it —
// widen this lock consciously if one ever should). Anything else falls through
// to "always unlocked" silently — so a typo'd gate ships as a free stage.
// These patterns keep that failure loud.
const HIDDEN_GATE_PATTERN = /^hidden:([a-z0-9_]+)$/;
const WORLD_LEVEL_GATE_PATTERN = /^worldLevel:([1-9][0-9]*)$/;

describe('STAGES — table integrity', () => {
  test('stage ids are unique and non-empty', () => {
    const ids = STAGES.map((stage) => stage.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id.length).toBeGreaterThan(0);
  });

  test('every stage has a player-facing name and description', () => {
    for (const stage of STAGES) {
      expect(stage.name.trim().length, stage.id).toBeGreaterThan(0);
      expect(stage.description.trim().length, stage.id).toBeGreaterThan(0);
    }
  });

  test('all gameplay multipliers are finite and positive', () => {
    for (const stage of STAGES) {
      for (const [field, value] of [
        ['enemyHealthMultiplier', stage.enemyHealthMultiplier],
        ['enemyDamageMultiplier', stage.enemyDamageMultiplier],
        ['xpMultiplier', stage.xpMultiplier],
        ['goldMultiplier', stage.goldMultiplier],
      ] as const) {
        expect(Number.isFinite(value), `${stage.id}.${field}`).toBe(true);
        expect(value, `${stage.id}.${field}`).toBeGreaterThan(0);
      }
    }
  });

  test('palette colors are integers in the 24-bit RGB range', () => {
    for (const stage of STAGES) {
      for (const [field, color] of [
        ['gridLineColor', stage.gridLineColor],
        ['gridPulseColor', stage.gridPulseColor],
        ['gridWarpHighlightColor', stage.gridWarpHighlightColor],
        ['ambientOverlayColor', stage.ambientOverlayColor],
      ] as const) {
        expect(Number.isInteger(color), `${stage.id}.${field}`).toBe(true);
        expect(color, `${stage.id}.${field}`).toBeGreaterThanOrEqual(0x000000);
        expect(color, `${stage.id}.${field}`).toBeLessThanOrEqual(0xffffff);
      }
    }
  });

  test('ambient overlay alpha stays in [0, 1]', () => {
    for (const stage of STAGES) {
      expect(stage.ambientOverlayAlpha, stage.id).toBeGreaterThanOrEqual(0);
      expect(stage.ambientOverlayAlpha, stage.id).toBeLessThanOrEqual(1);
    }
  });

  test('a stage with no darkness boost resolves to exactly the shipped baseline', () => {
    for (const stage of STAGES) {
      if (stage.ambientDarknessBoost === undefined) {
        expect(resolveStageAmbientDarkness(stage), stage.id).toBe(BASE_AMBIENT_DARKNESS);
      }
    }
  });

  test('every resolved ambient darkness stays inside [0, 1]', () => {
    for (const stage of STAGES) {
      const resolved = resolveStageAmbientDarkness(stage);
      expect(resolved, stage.id).toBeGreaterThanOrEqual(0);
      expect(resolved, stage.id).toBeLessThanOrEqual(1);
    }
  });

  test('a stage with no drift factor handles exactly as every stage always did', () => {
    for (const stage of STAGES) {
      if (stage.driftFactor === undefined) {
        expect(resolveStageDriftFactor(stage), stage.id).toBe(1);
      }
    }
  });

  test('every resolved drift factor stays inside the clamp', () => {
    for (const stage of STAGES) {
      const resolved = resolveStageDriftFactor(stage);
      expect(resolved, stage.id).toBeGreaterThanOrEqual(MIN_STAGE_DRIFT_FACTOR);
      expect(resolved, stage.id).toBeLessThanOrEqual(1);
    }
  });

  test('a drift factor the table must never author cannot immobilise the ship', () => {
    expect(resolveStageDriftFactor({ ...STAGES[0], driftFactor: Number.NaN })).toBe(1);
    expect(resolveStageDriftFactor({ ...STAGES[0], driftFactor: 0 })).toBe(MIN_STAGE_DRIFT_FACTOR);
    expect(resolveStageDriftFactor({ ...STAGES[0], driftFactor: 5 })).toBe(1);
  });
});

describe('STAGES — unlock gates', () => {
  test('every gate uses a syntax the unlock filter actually parses', () => {
    for (const stage of STAGES) {
      if (!stage.unlockRequirement) continue;
      const parses =
        HIDDEN_GATE_PATTERN.test(stage.unlockRequirement) ||
        WORLD_LEVEL_GATE_PATTERN.test(stage.unlockRequirement);
      expect(parses, `${stage.id} gate "${stage.unlockRequirement}"`).toBe(true);
    }
  });

  test('every hidden: gate points at a real stage unlock condition for this stage', () => {
    for (const stage of STAGES) {
      const match = stage.unlockRequirement?.match(HIDDEN_GATE_PATTERN);
      if (!match) continue;
      const condition = HIDDEN_UNLOCKS.find((definition) => definition.id === match[1]);
      expect(condition, `${stage.id} gate condition "${match[1]}"`).toBeDefined();
      expect(condition!.target, `${stage.id} gate condition target`).toBe('stage');
      expect(condition!.unlockId, `${stage.id} gate condition unlockId`).toBe(stage.id);
    }
  });

  test('every stage-targeting hidden unlock gates a real stage (bidirectional)', () => {
    for (const condition of HIDDEN_UNLOCKS) {
      if (condition.target !== 'stage') continue;
      const stage = getStageById(condition.unlockId);
      expect(stage, `condition ${condition.id} → stage ${condition.unlockId}`).toBeDefined();
      expect(stage!.unlockRequirement).toBe(`hidden:${condition.id}`);
    }
  });
});

describe('stage helpers', () => {
  test('getStageById round-trips every defined stage', () => {
    for (const stage of STAGES) {
      expect(getStageById(stage.id)).toBe(stage);
    }
  });

  test('getStageById returns undefined for an unknown id', () => {
    expect(getStageById('stage_does_not_exist')).toBeUndefined();
  });

  test('the default stage is the first entry, ungated, and strictly neutral', () => {
    const defaultStage = getDefaultStage();
    expect(defaultStage).toBe(STAGES[0]);
    expect(defaultStage.unlockRequirement).toBeUndefined();
    expect(defaultStage.enemyHealthMultiplier).toBe(1.0);
    expect(defaultStage.enemyDamageMultiplier).toBe(1.0);
    expect(defaultStage.xpMultiplier).toBe(1.0);
    expect(defaultStage.goldMultiplier).toBe(1.0);
    expect(defaultStage.ambientOverlayAlpha).toBe(0);
  });
});
