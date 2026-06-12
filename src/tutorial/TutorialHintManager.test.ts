import { describe, test, expect, vi, beforeEach } from 'vitest';

// In-memory stand-in for the encrypted storage so seen-flag round-trips work
// without touching crypto/localStorage. Same specifier ('../storage') as the
// production import, so Vitest swaps the real module for this one.
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
import {
  getTutorialHintManager,
  resetTutorialHintManagerForTesting,
} from './TutorialHintManager';

const STORAGE_KEY = 'survivor-tutorial-hints';

describe('TutorialHintManager', () => {
  beforeEach(() => {
    SecureStorage.removeItem(STORAGE_KEY);
    resetTutorialHintManagerForTesting();
  });

  test('maybeShow returns true the first time and false afterwards', () => {
    const manager = getTutorialHintManager();
    expect(manager.maybeShow('first-miniboss')).toBe(true);
    expect(manager.maybeShow('first-miniboss')).toBe(false);
  });

  test('hints are tracked independently per id', () => {
    const manager = getTutorialHintManager();
    expect(manager.maybeShow('first-miniboss')).toBe(true);
    expect(manager.maybeShow('dash-danger')).toBe(true);
    expect(manager.maybeShow('first-miniboss')).toBe(false);
  });

  test('markSeen suppresses the hint without showing it', () => {
    const manager = getTutorialHintManager();
    expect(manager.hasSeen('dash-danger')).toBe(false);
    manager.markSeen('dash-danger');
    expect(manager.hasSeen('dash-danger')).toBe(true);
    expect(manager.maybeShow('dash-danger')).toBe(false);
  });

  test('seen flags persist across manager instances (storage round-trip)', () => {
    getTutorialHintManager().maybeShow('shop');
    resetTutorialHintManagerForTesting();
    expect(getTutorialHintManager().maybeShow('shop')).toBe(false);
  });

  test('markSeen is idempotent', () => {
    const manager = getTutorialHintManager();
    manager.markSeen('shop');
    manager.markSeen('shop');
    const stored = JSON.parse(SecureStorage.getItem(STORAGE_KEY)!);
    expect(stored).toEqual(['shop']);
  });

  // ── Corruption / tamper resilience ──

  test('corrupt (non-JSON) storage yields a fresh seen-set instead of throwing', () => {
    SecureStorage.setItem(STORAGE_KEY, '{not valid json');
    expect(() => getTutorialHintManager()).not.toThrow();
    expect(getTutorialHintManager().maybeShow('first-miniboss')).toBe(true);
  });

  test('a "null" payload yields a fresh seen-set', () => {
    SecureStorage.setItem(STORAGE_KEY, 'null');
    expect(getTutorialHintManager().maybeShow('first-miniboss')).toBe(true);
  });

  test('a non-array payload (object) yields a fresh seen-set', () => {
    SecureStorage.setItem(STORAGE_KEY, JSON.stringify({ 'first-miniboss': true }));
    expect(getTutorialHintManager().maybeShow('first-miniboss')).toBe(true);
  });

  test('unknown and non-string entries are filtered while valid ids survive', () => {
    SecureStorage.setItem(
      STORAGE_KEY,
      JSON.stringify(['first-miniboss', 'bogus-hint', 42, null])
    );
    const manager = getTutorialHintManager();
    expect(manager.hasSeen('first-miniboss')).toBe(true);
    expect(manager.maybeShow('first-miniboss')).toBe(false);
    // The next write persists only the cleaned set plus the new flag.
    manager.markSeen('shop');
    const stored = JSON.parse(SecureStorage.getItem(STORAGE_KEY)!);
    expect(stored.sort()).toEqual(['first-miniboss', 'shop']);
  });
});
