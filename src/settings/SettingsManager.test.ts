import { describe, test, expect, beforeEach, vi } from 'vitest';

// In-memory stand-in for the encrypted storage so settings round-trip without
// touching crypto/localStorage. Same specifier ('../storage') as the production
// import, so Vitest swaps the real module for this one. SettingsManager stores
// each setting under its OWN string key (not one JSON blob), so the tamper
// vector is a single out-of-range string value per key — e.g. '1e999' for a
// numeric setting, which parseFloat turns into Infinity.
vi.mock('../storage', () => {
  const store = new Map<string, string>();
  return {
    SecureStorage: {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, value),
      removeItem: (key: string) => void store.delete(key),
    },
    __store: store,
  };
});

import { SecureStorage } from '../storage';
import { SettingsManager } from './SettingsManager';

// Mirror the production key constants (not exported from the module).
const KEY_SFX_ENABLED = 'settings-sfx-enabled';
const KEY_SFX_VOLUME = 'settings-sfx-volume';
const KEY_SCREEN_SHAKE = 'settings-screen-shake';
const KEY_SCREEN_SHAKE_INTENSITY = 'settings-screen-shake-intensity';
const KEY_UI_SCALE = 'settings-ui-scale';
const KEY_DAMAGE_NUMBERS_MODE = 'settings-damage-numbers-mode';
const KEY_COLORBLIND_MODE = 'settings-colorblind-mode';
const KEY_FPS_COUNTER = 'settings-fps-counter';

const ALL_KEYS = [
  KEY_SFX_ENABLED,
  KEY_SFX_VOLUME,
  KEY_SCREEN_SHAKE,
  KEY_SCREEN_SHAKE_INTENSITY,
  KEY_UI_SCALE,
  KEY_DAMAGE_NUMBERS_MODE,
  KEY_COLORBLIND_MODE,
  KEY_FPS_COUNTER,
];

/** Seed a RAW string under a key, then build a fresh manager so it loads it. */
function seed(key: string, raw: string): SettingsManager {
  SecureStorage.setItem(key, raw);
  return new SettingsManager();
}

describe('SettingsManager', () => {
  beforeEach(() => {
    for (const key of ALL_KEYS) SecureStorage.removeItem(key);
  });

  // ══════════════════════════════════════════════════════════════════════════
  // Corruption / out-of-range resilience (the bug this fixes)
  //
  // SecureStorage is the anti-cheat layer, so a corrupt/tampered value is the
  // threat model. The setters clamp every numeric setting, but the LOAD path
  // only rejected NaN (`parseFloat` + `!isNaN`) and applied no bounds — so an
  // out-of-range value, INCLUDING `Infinity` (`parseFloat('1e999')`, which
  // `!isNaN` lets through), loaded straight past the setters' clamps. Worst
  // case is screenShakeIntensity: GameScene.shakeCamera does
  // `cameras.main.shake(d, intensity * shakeScale)` with no clamp, so an
  // Infinity/huge intensity drives an Infinity camera-shake offset → NaN camera
  // scroll → the render breaks for the rest of the run. uiScale feeds HudScale
  // (every HUD/menu layout) and sfxVolume feeds the audio gain on 26 call sites.
  // ══════════════════════════════════════════════════════════════════════════

  // ── uiScale: setter clamps to [0.5, 2.0] in 0.1 steps; the loader must too ──

  test('an Infinity uiScale (1e999) is rejected to the default, not loaded as Infinity', () => {
    // parseFloat('1e999') is Infinity — non-finite garbage carries no intent,
    // so it falls back to the default (the clean rule the corruption vein uses:
    // non-finite → default; finite-but-out-of-range → clamp).
    const manager = seed(KEY_UI_SCALE, '1e999');
    expect(Number.isFinite(manager.getUiScale())).toBe(true);
    expect(manager.getUiScale()).toBe(1.0);
  });

  test('a huge finite uiScale is clamped to the 2.0 max', () => {
    expect(seed(KEY_UI_SCALE, '999').getUiScale()).toBe(2.0);
  });

  test('a negative uiScale is clamped to the 0.5 min', () => {
    expect(seed(KEY_UI_SCALE, '-5').getUiScale()).toBe(0.5);
  });

  test('a non-numeric uiScale falls back to the 1.0 default', () => {
    expect(seed(KEY_UI_SCALE, 'abc').getUiScale()).toBe(1.0);
  });

  test('an off-step fractional uiScale is rounded to the setter step (0.1)', () => {
    // Matches setUiScale: Math.round(scale * 10) / 10, then clamp.
    expect(seed(KEY_UI_SCALE, '1.37').getUiScale()).toBeCloseTo(1.4, 10);
  });

  // ── screenShakeIntensity: setter clamps to [0, 1] in 0.01 steps ──

  test('an Infinity shake intensity stays finite + bounded so the camera can never blow up', () => {
    // The executable form of the bug: shakeCamera does shake(d, intensity *
    // shakeScale), so the loaded value must stay finite and within [0,1] — then
    // an Infinity tamper can never drive an Infinity camera-shake offset.
    const manager = seed(KEY_SCREEN_SHAKE_INTENSITY, '1e999');
    const intensity = manager.getScreenShakeIntensity();
    expect(Number.isFinite(intensity)).toBe(true);
    expect(intensity).toBeGreaterThanOrEqual(0);
    expect(intensity).toBeLessThanOrEqual(1);
    expect(Number.isFinite(0.015 * intensity)).toBe(true);
  });

  test('a huge finite shake intensity is clamped to the 1.0 max', () => {
    expect(seed(KEY_SCREEN_SHAKE_INTENSITY, '500').getScreenShakeIntensity()).toBe(1);
  });

  test('a negative shake intensity is clamped to 0 (treated as off)', () => {
    const manager = seed(KEY_SCREEN_SHAKE_INTENSITY, '-2');
    expect(manager.getScreenShakeIntensity()).toBe(0);
    expect(manager.isScreenShakeEnabled()).toBe(false);
  });

  // ── sfxVolume: setter clamps to [0, 1] (no rounding) ──

  test('an Infinity sfx volume is rejected to the 0.5 default, not loaded as Infinity', () => {
    const manager = seed(KEY_SFX_VOLUME, '1e999');
    expect(Number.isFinite(manager.getSfxVolume())).toBe(true);
    expect(manager.getSfxVolume()).toBe(0.5);
  });

  test('a huge finite sfx volume is clamped to the 1.0 max', () => {
    expect(seed(KEY_SFX_VOLUME, '50').getSfxVolume()).toBe(1);
  });

  test('a negative sfx volume is clamped to 0', () => {
    expect(seed(KEY_SFX_VOLUME, '-1').getSfxVolume()).toBe(0);
  });

  test('a non-numeric sfx volume falls back to the 0.5 default', () => {
    expect(seed(KEY_SFX_VOLUME, 'loud').getSfxVolume()).toBe(0.5);
  });

  // ══════════════════════════════════════════════════════════════════════════
  // Characterization — the existing contract + byte-identical-on-real-path.
  // These pass before and after the fix; they lock that hardening the load path
  // did NOT change any valid behaviour.
  // ══════════════════════════════════════════════════════════════════════════

  test('a fresh manager with no storage starts at the defaults', () => {
    const manager = new SettingsManager();
    expect(manager.getUiScale()).toBe(1.0);
    expect(manager.getSfxVolume()).toBe(0.5);
    expect(manager.getScreenShakeIntensity()).toBe(1.0);
    expect(manager.isSfxEnabled()).toBe(true);
    expect(manager.getDamageNumbersMode()).toBe('perfect_crits');
    expect(manager.getColorblindMode()).toBe('off');
  });

  test('valid in-range numeric values load through unchanged (real path)', () => {
    SecureStorage.setItem(KEY_UI_SCALE, '1.5');
    SecureStorage.setItem(KEY_SFX_VOLUME, '0.7');
    SecureStorage.setItem(KEY_SCREEN_SHAKE_INTENSITY, '0.5');
    const manager = new SettingsManager();
    expect(manager.getUiScale()).toBe(1.5);
    expect(manager.getSfxVolume()).toBeCloseTo(0.7, 10);
    expect(manager.getScreenShakeIntensity()).toBe(0.5);
  });

  test('setter writes round-trip back through a fresh manager identically', () => {
    const writer = new SettingsManager();
    writer.setUiScale(1.5);
    writer.setSfxVolume(0.3);
    writer.setScreenShakeIntensity(0.25);
    const reader = new SettingsManager();
    expect(reader.getUiScale()).toBe(1.5);
    expect(reader.getSfxVolume()).toBeCloseTo(0.3, 10);
    expect(reader.getScreenShakeIntensity()).toBe(0.25);
  });

  test('booleans are immune to junk: only the exact string "true" is true', () => {
    // loadBoolean returns `stored === 'true'`, so no junk can leak a non-boolean.
    expect(seed(KEY_FPS_COUNTER, 'true').isFpsCounterEnabled()).toBe(true);
    expect(seed(KEY_FPS_COUNTER, 'false').isFpsCounterEnabled()).toBe(false);
    expect(seed(KEY_FPS_COUNTER, 'yes').isFpsCounterEnabled()).toBe(false);
    expect(seed(KEY_FPS_COUNTER, '1').isFpsCounterEnabled()).toBe(false);
  });

  test('enum modes are whitelisted: a valid mode loads, junk falls back to default', () => {
    expect(seed(KEY_DAMAGE_NUMBERS_MODE, 'crits').getDamageNumbersMode()).toBe('crits');
    expect(seed(KEY_DAMAGE_NUMBERS_MODE, 'bogus').getDamageNumbersMode()).toBe('perfect_crits');
    expect(seed(KEY_COLORBLIND_MODE, 'deuteranopia').getColorblindMode()).toBe('deuteranopia');
    expect(seed(KEY_COLORBLIND_MODE, 'rainbow').getColorblindMode()).toBe('off');
  });

  test('legacy shake-toggle migration: intensity absent + shake "false" starts at 0', () => {
    // No intensity key yet (old save); the legacy on/off bool drives the default.
    SecureStorage.setItem(KEY_SCREEN_SHAKE, 'false');
    expect(new SettingsManager().getScreenShakeIntensity()).toBe(0);
  });

  test('legacy shake-toggle migration: intensity absent + no legacy key defaults to full', () => {
    expect(new SettingsManager().getScreenShakeIntensity()).toBe(1.0);
  });
});
