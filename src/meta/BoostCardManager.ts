/**
 * BoostCardManager — the single armed boost card carried between runs
 * (FEAT-CARDS-3 in docs/superpowers/specs/2026-07-03-card-collection-meta-design.md).
 *
 * Flow: a miniboss flux cache calls rollFluxCache() mid-run, which queues one
 * boost ("armed for next run"); GameScene consumes it at the start of the
 * NEXT FRESH run only — a boost armed mid-run must survive save-restore of
 * the CURRENT run untouched, so restore paths never touch this manager.
 * Only one boost is held at a time: rollFluxCache() returns null while one
 * is queued (the flux cache simply doesn't drop again until it's spent).
 *
 * Uses SecureStorage (anti-cheat) — key registered in StorageBootstrap.
 */

import {
  ALL_BOOST_CARDS,
  BoostCardDefinition,
  getBoostCardById,
  rollBoostCard,
} from '../data/BoostCards';
import { SecureStorage } from '../storage';

const STORAGE_KEY_BOOSTS = 'survivor-meta-boosts';

/** Known boost ids — the corruption-hardened loader accepts these only. */
const KNOWN_BOOST_IDS: ReadonlySet<string> = new Set(ALL_BOOST_CARDS.map((boost) => boost.id));

export class BoostCardManager {
  private pending: string | null;
  /** Injectable for deterministic tests; must return values in [0, 1). */
  private readonly rng: () => number;

  constructor(rng: () => number = Math.random) {
    this.rng = rng;
    this.pending = null;
    this.load();
  }

  // ─────────────────────────────────────────────────────────────
  // Pending boost (flux cache → next fresh run)
  // ─────────────────────────────────────────────────────────────

  /** The armed boost without consuming it (null when none). No side effects. */
  getPending(): BoostCardDefinition | null {
    return this.pending === null ? null : getBoostCardById(this.pending) ?? null;
  }

  /** Arm a boost for the next fresh run. Unknown ids are ignored; persists. */
  queueBoost(id: string): void {
    if (!KNOWN_BOOST_IDS.has(id)) return;
    this.pending = id;
    this.save();
  }

  /**
   * Pop the armed boost (null when none). Called ONLY from the fresh-run
   * start path — consuming on restore would burn a boost armed mid-run.
   * Clears and persists.
   */
  consumePending(): BoostCardDefinition | null {
    if (this.pending === null) return null;
    const boost = getBoostCardById(this.pending) ?? null;
    this.pending = null;
    this.save();
    return boost;
  }

  /**
   * Flux cache drop path: uniform roll → queue for the next fresh run.
   * Returns null WITHOUT rolling while a boost is already held — one boost
   * at a time, and a held boost is never re-rolled or replaced (callers
   * skip the drop entirely on null).
   */
  rollFluxCache(): BoostCardDefinition | null {
    if (this.pending !== null) return null;
    const boost = rollBoostCard(this.rng);
    this.queueBoost(boost.id);
    return boost;
  }

  // ─────────────────────────────────────────────────────────────
  // Persistence (SecureStorage)
  // ─────────────────────────────────────────────────────────────

  /**
   * Corruption-hardened loader. SecureStorage is the anti-cheat layer, so a
   * tampered/corrupt payload is the threat model (same class as
   * CardCollectionManager.load): accept `pending` only when it names a known
   * boost id; any parse failure, non-object payload, or junk field falls
   * back to the fresh-profile default (nothing armed).
   */
  private load(): void {
    try {
      const stored = SecureStorage.getItem(STORAGE_KEY_BOOSTS);
      if (!stored) return;
      const parsed: unknown = JSON.parse(stored);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return;
      const record = parsed as Record<string, unknown>;

      const pending = record.pending;
      if (typeof pending === 'string' && KNOWN_BOOST_IDS.has(pending)) {
        this.pending = pending;
      }
    } catch {
      console.warn('Could not load boost card state from storage');
    }
  }

  private save(): void {
    try {
      SecureStorage.setItem(STORAGE_KEY_BOOSTS, JSON.stringify({ pending: this.pending }));
    } catch {
      console.warn('Could not save boost card state to storage');
    }
  }
}

// ─────────────────────────────────────────────────────────────
// Singleton Instance
// ─────────────────────────────────────────────────────────────

let boostCardInstance: BoostCardManager | null = null;

/**
 * Get the singleton BoostCardManager instance.
 */
export function getBoostCardManager(): BoostCardManager {
  if (!boostCardInstance) {
    boostCardInstance = new BoostCardManager();
  }
  return boostCardInstance;
}

/**
 * Drop the singleton so the next getBoostCardManager() re-reads storage.
 * TEST-ONLY escape hatch — production code must never re-create the manager
 * (state would silently fork from any captured references).
 */
export function resetBoostCardManagerForTests(): void {
  boostCardInstance = null;
}
