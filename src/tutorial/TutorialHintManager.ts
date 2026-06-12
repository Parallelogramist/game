/**
 * TutorialHintManager - persistent "has the player seen this hint" flags.
 *
 * One SecureStorage key holds a JSON array of seen hint ids, so each
 * contextual hint fires exactly once per install (not once per run). The
 * manager is Phaser-free: callers ask `maybeShow(id)` and render the toast
 * themselves when it returns true.
 */

import { SecureStorage } from '../storage';
import { TUTORIAL_HINT_DEFS, TutorialHintId } from './TutorialHints';

const STORAGE_KEY = 'survivor-tutorial-hints';

const KNOWN_IDS = new Set<string>(TUTORIAL_HINT_DEFS.map((def) => def.id));

export class TutorialHintManager {
  private seen: Set<TutorialHintId>;

  constructor() {
    this.seen = this.load();
  }

  /** Corruption-hardened load: anything that isn't an array of known ids resets cleanly. */
  private load(): Set<TutorialHintId> {
    try {
      const stored = SecureStorage.getItem(STORAGE_KEY);
      if (!stored) return new Set();
      const parsed: unknown = JSON.parse(stored);
      if (!Array.isArray(parsed)) return new Set();
      return new Set(
        parsed.filter(
          (entry): entry is TutorialHintId => typeof entry === 'string' && KNOWN_IDS.has(entry)
        )
      );
    } catch {
      console.warn('Could not load tutorial hint flags; starting fresh');
      return new Set();
    }
  }

  private persist(): void {
    try {
      SecureStorage.setItem(STORAGE_KEY, JSON.stringify([...this.seen]));
    } catch {
      console.warn('Could not save tutorial hint flags');
    }
  }

  hasSeen(id: TutorialHintId): boolean {
    return this.seen.has(id);
  }

  /** Flags a hint as seen without showing it (player demonstrated the mechanic on their own). */
  markSeen(id: TutorialHintId): void {
    if (this.seen.has(id)) return;
    this.seen.add(id);
    this.persist();
  }

  /** True exactly once per install: marks the hint seen and tells the caller to display it. */
  maybeShow(id: TutorialHintId): boolean {
    if (this.seen.has(id)) return false;
    this.markSeen(id);
    return true;
  }
}

let instance: TutorialHintManager | null = null;

export function getTutorialHintManager(): TutorialHintManager {
  if (!instance) {
    instance = new TutorialHintManager();
  }
  return instance;
}

/** Drops the singleton so tests can re-read storage with fresh state. */
export function resetTutorialHintManagerForTesting(): void {
  instance = null;
}
