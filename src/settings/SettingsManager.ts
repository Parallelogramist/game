/**
 * SettingsManager - Centralized game settings with SecureStorage persistence.
 * Handles SFX, screen shake, FPS counter, damage numbers, and status text settings.
 */

import { SecureStorage } from '../storage';

// Storage keys
const STORAGE_KEY_SFX_ENABLED = 'settings-sfx-enabled';
const STORAGE_KEY_SFX_VOLUME = 'settings-sfx-volume';
const STORAGE_KEY_SCREEN_SHAKE = 'settings-screen-shake';
const STORAGE_KEY_GRID_EFFECTS = 'settings-grid-effects';
const STORAGE_KEY_FPS_COUNTER = 'settings-fps-counter';
const STORAGE_KEY_DAMAGE_NUMBERS_MODE = 'settings-damage-numbers-mode';
const STORAGE_KEY_STATUS_TEXT = 'settings-status-text';
const STORAGE_KEY_UI_SCALE = 'settings-ui-scale';
const STORAGE_KEY_TUTORIAL_SEEN = 'settings-tutorial-seen';
const STORAGE_KEY_REDUCED_MOTION = 'settings-reduced-motion';
const STORAGE_KEY_DIRECTOR_DEBUG = 'settings-director-debug';
const STORAGE_KEY_SCREEN_SHAKE_INTENSITY = 'settings-screen-shake-intensity';
const STORAGE_KEY_COLORBLIND_MODE = 'settings-colorblind-mode';
const STORAGE_KEY_HIGH_CONTRAST = 'settings-high-contrast';
export type DamageNumbersMode = 'all' | 'crits' | 'perfect_crits' | 'off';

/** Color-vision-deficiency correction modes applied as a full-screen post-FX filter. */
export type ColorblindMode = 'off' | 'protanopia' | 'deuteranopia' | 'tritanopia';

export interface GameSettings {
  sfxEnabled: boolean;
  sfxVolume: number;
  screenShakeEnabled: boolean;
  gridEffectsEnabled: boolean;
  fpsCounterEnabled: boolean;
  damageNumbersMode: DamageNumbersMode;
  statusTextEnabled: boolean;
  uiScale: number;
  tutorialSeen: boolean;
  reducedMotion: boolean;
  directorDebugEnabled: boolean;
  /** Screen-shake intensity multiplier, 0 (off) to 1 (full). Replaces the old on/off toggle. */
  screenShakeIntensity: number;
  colorblindMode: ColorblindMode;
  /** Boosts gameplay contrast (brighter enemy projectiles, stronger danger vignette). */
  highContrast: boolean;
}

const DEFAULTS: GameSettings = {
  sfxEnabled: true,
  sfxVolume: 0.5,
  screenShakeEnabled: true,
  gridEffectsEnabled: true,
  fpsCounterEnabled: false,
  damageNumbersMode: 'perfect_crits',
  statusTextEnabled: true,
  uiScale: 1.0,
  tutorialSeen: false,
  reducedMotion: false,
  directorDebugEnabled: false,
  screenShakeIntensity: 1.0,
  colorblindMode: 'off',
  highContrast: false,
};

export class SettingsManager {
  private settings: GameSettings;

  constructor() {
    this.settings = {
      sfxEnabled: this.loadBoolean(STORAGE_KEY_SFX_ENABLED, DEFAULTS.sfxEnabled),
      // Bounds mirror each setter's clamp: volume [0,1], uiScale [0.5,2.0] in
      // 0.1 steps, shake intensity [0,1] in 0.01 steps.
      sfxVolume: this.loadBoundedNumber(STORAGE_KEY_SFX_VOLUME, DEFAULTS.sfxVolume, 0, 1),
      screenShakeEnabled: this.loadBoolean(STORAGE_KEY_SCREEN_SHAKE, DEFAULTS.screenShakeEnabled),
      gridEffectsEnabled: this.loadBoolean(STORAGE_KEY_GRID_EFFECTS, DEFAULTS.gridEffectsEnabled),
      fpsCounterEnabled: this.loadBoolean(STORAGE_KEY_FPS_COUNTER, DEFAULTS.fpsCounterEnabled),
      damageNumbersMode: this.loadDamageNumbersMode(),
      statusTextEnabled: this.loadBoolean(STORAGE_KEY_STATUS_TEXT, DEFAULTS.statusTextEnabled),
      uiScale: this.loadBoundedNumber(STORAGE_KEY_UI_SCALE, DEFAULTS.uiScale, 0.5, 2.0, 10),
      tutorialSeen: this.loadBoolean(STORAGE_KEY_TUTORIAL_SEEN, DEFAULTS.tutorialSeen),
      reducedMotion: this.loadBoolean(STORAGE_KEY_REDUCED_MOTION, DEFAULTS.reducedMotion),
      directorDebugEnabled: this.loadBoolean(STORAGE_KEY_DIRECTOR_DEBUG, DEFAULTS.directorDebugEnabled),
      // Migrate from the legacy on/off shake toggle: if the player had shake off, start at 0 intensity.
      screenShakeIntensity: this.loadBoundedNumber(
        STORAGE_KEY_SCREEN_SHAKE_INTENSITY,
        this.loadBoolean(STORAGE_KEY_SCREEN_SHAKE, true) ? DEFAULTS.screenShakeIntensity : 0,
        0,
        1,
        100
      ),
      colorblindMode: this.loadColorblindMode(),
      highContrast: this.loadBoolean(STORAGE_KEY_HIGH_CONTRAST, DEFAULTS.highContrast),
    };
  }

  private loadColorblindMode(): ColorblindMode {
    try {
      const stored = SecureStorage.getItem(STORAGE_KEY_COLORBLIND_MODE);
      if (stored && ['off', 'protanopia', 'deuteranopia', 'tritanopia'].includes(stored)) {
        return stored as ColorblindMode;
      }
    } catch {
      console.warn('Could not load colorblind mode setting');
    }
    return DEFAULTS.colorblindMode;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Load helpers
  // ═══════════════════════════════════════════════════════════════════════════

  private loadBoolean(key: string, defaultValue: boolean): boolean {
    try {
      const stored = SecureStorage.getItem(key);
      if (stored !== null) {
        return stored === 'true';
      }
    } catch {
      console.warn(`Could not load setting: ${key}`);
    }
    return defaultValue;
  }

  /**
   * Load a numeric setting, enforcing the SAME bounds (and rounding) its setter
   * applies. The setters all clamp, but the load path used to only reject NaN
   * (`parseFloat` + `!isNaN`) with no range check — so a corrupt/tampered
   * SecureStorage value outside the valid range loaded straight past the
   * clamps. Crucially `parseFloat('1e999')` is `Infinity`, which `!isNaN` lets
   * through; an Infinity/huge `screenShakeIntensity` then reaches
   * `cameras.main.shake(d, intensity * shakeScale)` unclamped → an Infinity
   * shake offset → NaN camera scroll → the render breaks for the rest of the
   * run. SecureStorage is the anti-cheat layer, so an out-of-range payload is
   * the threat model. Clamping here keeps every loaded value to one the setter
   * could itself have produced, so no consumer is ever fed a malformed
   * scale/volume/shake amplitude.
   *
   * `roundFactor` mirrors the setter's rounding step (e.g. 10 → 0.1, 100 →
   * 0.01); 0 = no rounding. On the real path this is a no-op (saved values are
   * already clamped + rounded by the setter), so loading stays byte-identical.
   */
  private loadBoundedNumber(
    key: string,
    defaultValue: number,
    min: number,
    max: number,
    roundFactor = 0
  ): number {
    try {
      const stored = SecureStorage.getItem(key);
      if (stored !== null) {
        const parsed = parseFloat(stored);
        if (Number.isFinite(parsed)) {
          const rounded = roundFactor > 0 ? Math.round(parsed * roundFactor) / roundFactor : parsed;
          return Math.max(min, Math.min(max, rounded));
        }
      }
    } catch {
      console.warn(`Could not load setting: ${key}`);
    }
    return defaultValue;
  }

  private loadDamageNumbersMode(): DamageNumbersMode {
    try {
      const stored = SecureStorage.getItem(STORAGE_KEY_DAMAGE_NUMBERS_MODE);
      if (stored && ['all', 'crits', 'perfect_crits', 'off'].includes(stored)) {
        return stored as DamageNumbersMode;
      }
    } catch {
      console.warn('Could not load damage numbers mode setting');
    }
    return DEFAULTS.damageNumbersMode;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Save helpers
  // ═══════════════════════════════════════════════════════════════════════════

  private saveBoolean(key: string, value: boolean): void {
    try {
      SecureStorage.setItem(key, value.toString());
    } catch {
      console.warn(`Could not save setting: ${key}`);
    }
  }

  private saveNumber(key: string, value: number): void {
    try {
      SecureStorage.setItem(key, value.toString());
    } catch {
      console.warn(`Could not save setting: ${key}`);
    }
  }

  private saveString(key: string, value: string): void {
    try {
      SecureStorage.setItem(key, value);
    } catch {
      console.warn(`Could not save setting: ${key}`);
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // SFX Settings
  // ═══════════════════════════════════════════════════════════════════════════

  isSfxEnabled(): boolean {
    return this.settings.sfxEnabled;
  }

  setSfxEnabled(enabled: boolean): void {
    this.settings.sfxEnabled = enabled;
    this.saveBoolean(STORAGE_KEY_SFX_ENABLED, enabled);
  }

  getSfxVolume(): number {
    return this.settings.sfxVolume;
  }

  setSfxVolume(volume: number): void {
    this.settings.sfxVolume = Math.max(0, Math.min(1, volume));
    this.saveNumber(STORAGE_KEY_SFX_VOLUME, this.settings.sfxVolume);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Visual Settings
  // ═══════════════════════════════════════════════════════════════════════════

  /** True when shake intensity is above zero. Kept for call sites that only need on/off. */
  isScreenShakeEnabled(): boolean {
    return this.settings.screenShakeIntensity > 0;
  }

  setScreenShakeEnabled(enabled: boolean): void {
    this.setScreenShakeIntensity(enabled ? 1.0 : 0);
  }

  /** Screen-shake intensity multiplier, 0 (off) to 1 (full). */
  getScreenShakeIntensity(): number {
    return this.settings.screenShakeIntensity;
  }

  setScreenShakeIntensity(intensity: number): void {
    const clamped = Math.max(0, Math.min(1, Math.round(intensity * 100) / 100));
    this.settings.screenShakeIntensity = clamped;
    // Keep the legacy boolean in sync so older save data / call sites stay consistent.
    this.settings.screenShakeEnabled = clamped > 0;
    this.saveNumber(STORAGE_KEY_SCREEN_SHAKE_INTENSITY, clamped);
    this.saveBoolean(STORAGE_KEY_SCREEN_SHAKE, clamped > 0);
  }

  isGridEffectsEnabled(): boolean {
    return this.settings.gridEffectsEnabled;
  }

  setGridEffectsEnabled(enabled: boolean): void {
    this.settings.gridEffectsEnabled = enabled;
    this.saveBoolean(STORAGE_KEY_GRID_EFFECTS, enabled);
  }

  isFpsCounterEnabled(): boolean {
    return this.settings.fpsCounterEnabled;
  }

  setFpsCounterEnabled(enabled: boolean): void {
    this.settings.fpsCounterEnabled = enabled;
    this.saveBoolean(STORAGE_KEY_FPS_COUNTER, enabled);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Combat Text Settings
  // ═══════════════════════════════════════════════════════════════════════════

  getDamageNumbersMode(): DamageNumbersMode {
    return this.settings.damageNumbersMode;
  }

  setDamageNumbersMode(mode: DamageNumbersMode): void {
    this.settings.damageNumbersMode = mode;
    this.saveString(STORAGE_KEY_DAMAGE_NUMBERS_MODE, mode);
  }

  isStatusTextEnabled(): boolean {
    return this.settings.statusTextEnabled;
  }

  setStatusTextEnabled(enabled: boolean): void {
    this.settings.statusTextEnabled = enabled;
    this.saveBoolean(STORAGE_KEY_STATUS_TEXT, enabled);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // UI Scale Settings
  // ═══════════════════════════════════════════════════════════════════════════

  getUiScale(): number {
    return this.settings.uiScale;
  }

  setUiScale(scale: number): void {
    this.settings.uiScale = Math.max(0.5, Math.min(2.0, Math.round(scale * 10) / 10));
    this.saveNumber(STORAGE_KEY_UI_SCALE, this.settings.uiScale);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Accessibility
  // ═══════════════════════════════════════════════════════════════════════════

  isReducedMotionEnabled(): boolean {
    return this.settings.reducedMotion;
  }

  setReducedMotion(enabled: boolean): void {
    this.settings.reducedMotion = enabled;
    this.saveBoolean(STORAGE_KEY_REDUCED_MOTION, enabled);
  }

  getColorblindMode(): ColorblindMode {
    return this.settings.colorblindMode;
  }

  setColorblindMode(mode: ColorblindMode): void {
    this.settings.colorblindMode = mode;
    this.saveString(STORAGE_KEY_COLORBLIND_MODE, mode);
  }

  isHighContrastEnabled(): boolean {
    return this.settings.highContrast;
  }

  setHighContrast(enabled: boolean): void {
    this.settings.highContrast = enabled;
    this.saveBoolean(STORAGE_KEY_HIGH_CONTRAST, enabled);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Debug Overlays
  // ═══════════════════════════════════════════════════════════════════════════

  /** Toggle for the in-run director debug overlay (strategy + credit balance). */
  isDirectorDebugEnabled(): boolean {
    return this.settings.directorDebugEnabled;
  }

  setDirectorDebugEnabled(enabled: boolean): void {
    this.settings.directorDebugEnabled = enabled;
    this.saveBoolean(STORAGE_KEY_DIRECTOR_DEBUG, enabled);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Tutorial
  // ═══════════════════════════════════════════════════════════════════════════

  isTutorialSeen(): boolean {
    return this.settings.tutorialSeen;
  }

  setTutorialSeen(seen: boolean): void {
    this.settings.tutorialSeen = seen;
    this.saveBoolean(STORAGE_KEY_TUTORIAL_SEEN, seen);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Utility
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Get all settings as a readonly object.
   */
  getAllSettings(): Readonly<GameSettings> {
    return { ...this.settings };
  }

  /**
   * Reset all settings to defaults.
   */
  resetToDefaults(): void {
    this.setSfxEnabled(DEFAULTS.sfxEnabled);
    this.setSfxVolume(DEFAULTS.sfxVolume);
    this.setScreenShakeEnabled(DEFAULTS.screenShakeEnabled);
    this.setGridEffectsEnabled(DEFAULTS.gridEffectsEnabled);
    this.setFpsCounterEnabled(DEFAULTS.fpsCounterEnabled);
    this.setDamageNumbersMode(DEFAULTS.damageNumbersMode);
    this.setStatusTextEnabled(DEFAULTS.statusTextEnabled);
    this.setUiScale(DEFAULTS.uiScale);
    this.setTutorialSeen(DEFAULTS.tutorialSeen);
    this.setReducedMotion(DEFAULTS.reducedMotion);
    this.setDirectorDebugEnabled(DEFAULTS.directorDebugEnabled);
    this.setScreenShakeIntensity(DEFAULTS.screenShakeIntensity);
    this.setColorblindMode(DEFAULTS.colorblindMode);
    this.setHighContrast(DEFAULTS.highContrast);
  }
}

// Singleton instance
let settingsManagerInstance: SettingsManager | null = null;

/**
 * Get the singleton SettingsManager instance.
 */
export function getSettingsManager(): SettingsManager {
  if (!settingsManagerInstance) {
    settingsManagerInstance = new SettingsManager();
  }
  return settingsManagerInstance;
}
