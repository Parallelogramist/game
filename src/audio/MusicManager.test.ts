import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';

// In-memory stand-in for the encrypted storage so music prefs round-trip without
// touching crypto/localStorage. Same specifier ('../storage') as the production
// import, so Vitest swaps the real module for this one. MusicManager stores three
// keys: a JSON string-array of enabled track ids, a playback-mode enum string,
// and a numeric volume string — so the tamper vectors are a non-array / junk-id
// payload for the set, an off-whitelist string for the mode, and an
// out-of-range / non-finite string (e.g. '1e999' → Infinity) for the volume.
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
import { MusicManager } from './MusicManager';
import { MUSIC_CATALOG } from '../data/MusicCatalog';

// Mirror the production key constants (not exported from the module).
const KEY_ENABLED = 'survivor-music-enabled';
const KEY_MODE = 'survivor-music-mode';
const KEY_VOLUME = 'survivor-music-volume';

const ALL_KEYS = [KEY_ENABLED, KEY_MODE, KEY_VOLUME];

const DEFAULT_VOLUME = 0.4;
const TOTAL_TRACKS = MUSIC_CATALOG.length;
const FIRST_TRACK_ID = MUSIC_CATALOG[0].id;
const SECOND_TRACK_ID = MUSIC_CATALOG[1].id;

/** Seed a RAW string under a key, then build a fresh manager so it loads it. */
function seed(key: string, raw: string): MusicManager {
  SecureStorage.setItem(key, raw);
  return new MusicManager();
}

describe('MusicManager', () => {
  beforeEach(() => {
    for (const key of ALL_KEYS) SecureStorage.removeItem(key);
    // The corruption paths deliberately exercise the catch/warn branches; keep
    // the test output pristine without hiding real failures.
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ══════════════════════════════════════════════════════════════════════════
  // Volume corruption / out-of-range resilience (the BUG-SETTINGS-CORRUPT class)
  //
  // SecureStorage is the anti-cheat layer, so a corrupt/tampered value is the
  // threat model. setVolume clamps to [0,1], but loadVolume only did
  // `parseFloat(stored)` with NO finite/range check — so an out-of-range value,
  // INCLUDING Infinity (parseFloat('1e999')), loaded straight into `this.volume`.
  // A non-finite volume reaches `gainNode.gain.value = volume * intensity`
  // (loadTrack/setVolume/setIntensity), and a non-finite AudioParam value throws
  // a TypeError in Web Audio — setIntensity runs EVERY frame via the intensity
  // driver, so a NaN/Infinity volume is a per-frame exception storm, and
  // getVolume() feeds NaN to the settings slider UI.
  // ══════════════════════════════════════════════════════════════════════════

  test('an Infinity volume (1e999) is rejected to the default, not loaded as Infinity', () => {
    const manager = seed(KEY_VOLUME, '1e999');
    expect(Number.isFinite(manager.getVolume())).toBe(true);
    expect(manager.getVolume()).toBe(DEFAULT_VOLUME);
  });

  test('a non-numeric volume falls back to the default', () => {
    const manager = seed(KEY_VOLUME, 'loud');
    expect(Number.isFinite(manager.getVolume())).toBe(true);
    expect(manager.getVolume()).toBe(DEFAULT_VOLUME);
  });

  test('a huge finite volume is clamped to the 1.0 max', () => {
    expect(seed(KEY_VOLUME, '50').getVolume()).toBe(1);
  });

  test('a negative volume is clamped to 0', () => {
    expect(seed(KEY_VOLUME, '-1').getVolume()).toBe(0);
  });

  test('a valid in-range volume loads through unchanged (real path)', () => {
    expect(seed(KEY_VOLUME, '0.7').getVolume()).toBeCloseTo(0.7, 10);
  });

  // ══════════════════════════════════════════════════════════════════════════
  // Enabled-tracks corruption resilience
  //
  // loadEnabledTracks did `new Set(JSON.parse(stored) as string[])` with no
  // shape check. A JSON STRING payload ("hello") is iterable, so it did NOT
  // throw — it became a Set of single characters ({'h','e','l','o'}), none of
  // which match a catalog id → an empty playlist (no music), and those garbage
  // ids get re-persisted on the next toggle. Non-string / unknown array members
  // leaked through the same way.
  // ══════════════════════════════════════════════════════════════════════════

  test('a JSON-string payload does not become a Set of characters', () => {
    const manager = seed(KEY_ENABLED, JSON.stringify('hello'));
    // No single-character junk ids survived…
    expect(manager.isTrackEnabled('h')).toBe(false);
    expect(manager.isTrackEnabled('e')).toBe(false);
    // …and a non-array payload carries no intent → default to all tracks enabled.
    expect(manager.getEnabledTrackCount()).toBe(TOTAL_TRACKS);
  });

  test('a non-array JSON payload (number) falls back to all tracks enabled', () => {
    expect(seed(KEY_ENABLED, '123').getEnabledTrackCount()).toBe(TOTAL_TRACKS);
  });

  test('malformed JSON falls back to all tracks enabled', () => {
    expect(seed(KEY_ENABLED, '{not json').getEnabledTrackCount()).toBe(TOTAL_TRACKS);
  });

  test('an array keeps only known string catalog ids, dropping junk', () => {
    const manager = seed(
      KEY_ENABLED,
      JSON.stringify([FIRST_TRACK_ID, 'not-a-real-track', 123, null, SECOND_TRACK_ID])
    );
    expect(manager.isTrackEnabled(FIRST_TRACK_ID)).toBe(true);
    expect(manager.isTrackEnabled(SECOND_TRACK_ID)).toBe(true);
    expect(manager.isTrackEnabled('not-a-real-track')).toBe(false);
    expect(manager.getEnabledTrackCount()).toBe(2);
  });

  test('an empty array is preserved as the valid "all disabled" state', () => {
    // Must NOT be over-corrected back to all-enabled — disableAllTracks() writes [].
    expect(seed(KEY_ENABLED, '[]').getEnabledTrackCount()).toBe(0);
  });

  test('a valid enabled-tracks subset round-trips unchanged (real path)', () => {
    const manager = seed(KEY_ENABLED, JSON.stringify([FIRST_TRACK_ID]));
    expect(manager.getEnabledTrackCount()).toBe(1);
    expect(manager.isTrackEnabled(FIRST_TRACK_ID)).toBe(true);
    expect(manager.isTrackEnabled(SECOND_TRACK_ID)).toBe(false);
  });

  // ══════════════════════════════════════════════════════════════════════════
  // Playback mode — already whitelisted (characterization, locks junk-immunity)
  // ══════════════════════════════════════════════════════════════════════════

  test('a valid playback mode loads; junk falls back to sequential', () => {
    expect(seed(KEY_MODE, 'shuffle').getPlaybackMode()).toBe('shuffle');
    expect(seed(KEY_MODE, 'off').getPlaybackMode()).toBe('off');
    expect(seed(KEY_MODE, 'bogus').getPlaybackMode()).toBe('sequential');
    expect(seed(KEY_MODE, '{}').getPlaybackMode()).toBe('sequential');
  });

  // ══════════════════════════════════════════════════════════════════════════
  // Characterization — defaults + setter round-trips (byte-identical real path)
  // ══════════════════════════════════════════════════════════════════════════

  test('a fresh manager with no storage starts at the defaults', () => {
    const manager = new MusicManager();
    expect(manager.getVolume()).toBe(DEFAULT_VOLUME);
    expect(manager.getPlaybackMode()).toBe('sequential');
    expect(manager.getEnabledTrackCount()).toBe(TOTAL_TRACKS);
  });

  test('setVolume round-trips through a fresh manager', () => {
    const writer = new MusicManager();
    writer.setVolume(0.3);
    expect(new MusicManager().getVolume()).toBeCloseTo(0.3, 10);
  });

  test('a disabled track round-trips through a fresh manager', () => {
    const writer = new MusicManager();
    writer.setTrackEnabled(FIRST_TRACK_ID, false);
    const reader = new MusicManager();
    expect(reader.isTrackEnabled(FIRST_TRACK_ID)).toBe(false);
    expect(reader.getEnabledTrackCount()).toBe(TOTAL_TRACKS - 1);
  });
});
