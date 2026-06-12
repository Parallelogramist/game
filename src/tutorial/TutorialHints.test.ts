import { describe, test, expect } from 'vitest';
import {
  TUTORIAL_HINT_DEFS,
  getTutorialHintDef,
  getHintDescription,
  evaluateDashDangerHint,
  findBlockedEvolution,
  formatEvolutionHint,
  type TutorialHintId,
} from './TutorialHints';

describe('TUTORIAL_HINT_DEFS integrity', () => {
  test('hint ids are unique', () => {
    const ids = TUTORIAL_HINT_DEFS.map((def) => def.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test('every def has nonempty title, description, icon and a valid color/duration', () => {
    for (const def of TUTORIAL_HINT_DEFS) {
      expect(def.title.length, def.id).toBeGreaterThan(0);
      expect(def.description.length, def.id).toBeGreaterThan(0);
      expect(def.icon.length, def.id).toBeGreaterThan(0);
      expect(Number.isFinite(def.color), def.id).toBe(true);
      expect(def.duration, def.id).toBeGreaterThan(0);
    }
  });

  test('getTutorialHintDef resolves every declared id', () => {
    for (const def of TUTORIAL_HINT_DEFS) {
      expect(getTutorialHintDef(def.id)).toBe(def);
    }
  });

  test('the dash hint carries a touch-device variant', () => {
    const dashDef = getTutorialHintDef('dash-danger');
    expect(dashDef.descriptionTouch).toBeTruthy();
  });

  test('getHintDescription picks the touch variant only on touch devices', () => {
    const dashDef = getTutorialHintDef('dash-danger');
    expect(getHintDescription(dashDef, true)).toBe(dashDef.descriptionTouch);
    expect(getHintDescription(dashDef, false)).toBe(dashDef.description);
  });

  test('getHintDescription falls back to description when no touch variant exists', () => {
    const minibossDef = getTutorialHintDef('first-miniboss');
    expect(minibossDef.descriptionTouch).toBeUndefined();
    expect(getHintDescription(minibossDef, true)).toBe(minibossDef.description);
  });
});

describe('evaluateDashDangerHint', () => {
  test('shows when dash is ready and the player has never dashed this run', () => {
    expect(evaluateDashDangerHint({ dashReady: true, hasDashedThisRun: false })).toBe('show');
  });

  test('defers (stays unseen) when dash is on cooldown', () => {
    expect(evaluateDashDangerHint({ dashReady: false, hasDashedThisRun: false })).toBe('defer');
  });

  test('dismisses silently when the player already dashed this run', () => {
    expect(evaluateDashDangerHint({ dashReady: true, hasDashedThisRun: true })).toBe('dismiss');
    expect(evaluateDashDangerHint({ dashReady: false, hasDashedThisRun: true })).toBe('dismiss');
  });
});

describe('findBlockedEvolution', () => {
  // Real recipe: katana evolves at weapon level 5 + swiftness level 5 → Blade Dancer.
  const katanaAtFive = { id: 'katana', name: 'Katana', level: 5, isEvolved: false };
  const swiftnessAt = (level: number) => [{ id: 'swiftness', name: 'Swiftness', currentLevel: level }];

  test('reports a weapon at required level whose stat lags behind', () => {
    const blocked = findBlockedEvolution([katanaAtFive], swiftnessAt(3));
    expect(blocked).not.toBeNull();
    expect(blocked!.weaponId).toBe('katana');
    expect(blocked!.weaponName).toBe('Katana');
    expect(blocked!.evolvedName).toBe('Blade Dancer');
    expect(blocked!.statId).toBe('swiftness');
    expect(blocked!.statName).toBe('Swiftness');
    expect(blocked!.requiredStatLevel).toBe(5);
  });

  test('returns null when the weapon is below the required level', () => {
    const katanaAtFour = { ...katanaAtFive, level: 4 };
    expect(findBlockedEvolution([katanaAtFour], swiftnessAt(3))).toBeNull();
  });

  test('returns null when the stat already meets the requirement (evolution would fire)', () => {
    expect(findBlockedEvolution([katanaAtFive], swiftnessAt(5))).toBeNull();
    expect(findBlockedEvolution([katanaAtFive], swiftnessAt(6))).toBeNull();
  });

  test('skips already-evolved weapons', () => {
    const evolvedKatana = { ...katanaAtFive, isEvolved: true };
    expect(findBlockedEvolution([evolvedKatana], swiftnessAt(3))).toBeNull();
  });

  test('skips weapons with no evolution recipe', () => {
    const unknown = { id: 'no-such-weapon', name: 'Mystery', level: 9, isEvolved: false };
    expect(findBlockedEvolution([unknown], swiftnessAt(0))).toBeNull();
  });

  test('honors the evolution level reduction', () => {
    const katanaAtFour = { ...katanaAtFive, level: 4 };
    expect(findBlockedEvolution([katanaAtFour], swiftnessAt(0), 1)).not.toBeNull();
    expect(findBlockedEvolution([katanaAtFour], swiftnessAt(0), 0)).toBeNull();
  });

  test('a stat missing from the upgrade list counts as level 0 with the id as fallback name', () => {
    const blocked = findBlockedEvolution([katanaAtFive], []);
    expect(blocked).not.toBeNull();
    expect(blocked!.statName).toBe('swiftness');
  });

  test('returns the first blocked weapon in array order', () => {
    const projectileAtFive = { id: 'projectile', name: 'Projectile', level: 5, isEvolved: false };
    const blocked = findBlockedEvolution([projectileAtFive, katanaAtFive], []);
    expect(blocked!.weaponId).toBe('projectile');
  });
});

describe('formatEvolutionHint', () => {
  test('names the weapon, stat, required level, and evolved form', () => {
    const blocked = findBlockedEvolution(
      [{ id: 'katana', name: 'Katana', level: 5, isEvolved: false }],
      [{ id: 'swiftness', name: 'Swiftness', currentLevel: 2 }]
    )!;
    expect(formatEvolutionHint(blocked)).toBe(
      'Katana can evolve — get Swiftness to Lv 5 to unlock Blade Dancer!'
    );
  });
});

// Compile-time check: the id union and the defs table stay in sync.
const _allIds: TutorialHintId[] = TUTORIAL_HINT_DEFS.map((def) => def.id);
void _allIds;
