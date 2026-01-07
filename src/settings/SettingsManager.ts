/**
 * SettingsManager - Centralized game settings with encrypted localStorage persistence.
 * Handles SFX, screen shake, FPS counter, damage numbers, and status text settings.
 */

import { SecureStorage } from '../storage';

// Storage keys
const STORAGE_KEY_SFX_ENABLED = 'settings-sfx-enabled';
const STORAGE_KEY_SFX_VOLUME = 'settings-sfx-volume';
const STORAGE_KEY_SCREEN_SHAKE = 'settings-screen-shake';
const STORAGE_KEY_FPS_COUNTER = 'settings-fps-counter';
const STORAGE_KEY_DAMAGE_NUMBERS_MODE = 'settings-damage-numbers-mode';
const STORAGE_KEY_STATUS_TEXT = 'settings-status-text';

export type DamageNumbersMode = 'all' | 'crits' | 'perfect_crits' | 'off';

export interface GameSettings {
  sfxEnabled: boolean;
  sfxVolume: number;
  screenShakeEnabled: boolean;
  fpsCounterEnabled: boolean;
  damageNumbersMode: DamageNumbersMode;
  statusTextEnabled: boolean;
}

const DEFAULTS: GameSettings = {
  sfxEnabled: true,
  sfxVolume: 0.5,
  screenShakeEnabled: true,
  fpsCounterEnabled: false,
  damageNumbersMode: 'all',
  statusTextEnabled: true,
};

export class SettingsManager {
  private settings: GameSettings;

  constructor() {
    this.settings = {
      sfxEnabled: this.loadBoolean(STORAGE_KEY_SFX_ENABLED, DEFAULTS.sfxEnabled),
      sfxVolume: this.loadNumber(STORAGE_KEY_SFX_VOLUME, DEFAULTS.sfxVolume),
      screenShakeEnabled: this.loadBoolean(STORAGE_KEY_SCREEN_SHAKE, DEFAULTS.screenShakeEnabled),
      fpsCounterEnabled: this.loadBoolean(STORAGE_KEY_FPS_COUNTER, DEFAULTS.fpsCounterEnabled),
      damageNumbersMode: this.loadDamageNumbersMode(),
      statusTextEnabled: this.loadBoolean(STORAGE_KEY_STATUS_TEXT, DEFAULTS.statusTextEnabled),
    };
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

  private loadNumber(key: string, defaultValue: number): number {
    try {
      const stored = SecureStorage.getItem(key);
      if (stored !== null) {
        const value = parseFloat(stored);
        if (!isNaN(value)) {
          return value;
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

  isScreenShakeEnabled(): boolean {
    return this.settings.screenShakeEnabled;
  }

  setScreenShakeEnabled(enabled: boolean): void {
    this.settings.screenShakeEnabled = enabled;
    this.saveBoolean(STORAGE_KEY_SCREEN_SHAKE, enabled);
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
    this.setFpsCounterEnabled(DEFAULTS.fpsCounterEnabled);
    this.setDamageNumbersMode(DEFAULTS.damageNumbersMode);
    this.setStatusTextEnabled(DEFAULTS.statusTextEnabled);
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
