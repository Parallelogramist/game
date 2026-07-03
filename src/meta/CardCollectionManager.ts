/**
 * CardCollectionManager — persistent card-collection state across runs:
 * which cards are discovered, the Scanner pity counter, and the pending
 * end-screen reveal queued by an in-run data cache pickup.
 *
 * Discovery flows (spec: docs/superpowers/specs/2026-07-03-card-collection-meta-design.md):
 * - Data cache drop (in-run): rollCacheDiscovery() rolls and QUEUES the card
 *   for the end screen — discovery itself is deferred to
 *   consumePendingReveal() so the card stays hidden (archive slot, bonuses)
 *   until its reveal moment actually plays, even if the run is abandoned;
 *   null means the archive is complete and the caller awards gold instead.
 * - Scanner lottery (Cards scene): scan() rolls with a pity guarantee
 *   (epic-or-better at least every PITY_THRESHOLD scans). scan() spends
 *   NOTHING itself — the caller spends SCAN_COST gold via
 *   MetaProgressionManager first and only calls scan() on success.
 *
 * Uses SecureStorage (anti-cheat) — key registered in StorageBootstrap.
 */

import {
  ALL_CARDS,
  CardBonus,
  CardDefinition,
  CardRarity,
  CARD_RARITY_DROP_WEIGHTS,
  aggregateCardBonuses,
  getCardById,
  pickUndiscoveredCard,
  rollCardRarity,
} from '../data/Cards';
import { SecureStorage } from '../storage';

const STORAGE_KEY_CARDS = 'survivor-meta-cards';

/** Gold cost of one Scanner DECRYPT. Spent by the caller, not by scan(). */
export const SCAN_COST = 500;

/** Every PITY_THRESHOLD-th scan without an epic+ result is upgraded to one. */
export const PITY_THRESHOLD = 8;

/**
 * scansSincePity counts scans since the last epic-or-better result, so its
 * meaningful range is [0, PITY_THRESHOLD - 1]: at the cap the NEXT scan is
 * guaranteed. Persisted values are clamped into this range.
 */
const MAX_SCANS_SINCE_PITY = PITY_THRESHOLD - 1;

/** Known card ids — the corruption-hardened loader rebuilds state from these only. */
const KNOWN_CARD_IDS: ReadonlySet<string> = new Set(ALL_CARDS.map((card) => card.id));

function isEpicOrBetter(rarity: CardRarity): boolean {
  return rarity === 'epic' || rarity === 'legendary';
}

export class CardCollectionManager {
  private discovered: Set<string>;
  private scansSincePity: number;
  private pendingReveal: string | null;
  /** Injectable for deterministic tests; must return values in [0, 1). */
  private readonly rng: () => number;

  constructor(rng: () => number = Math.random) {
    this.rng = rng;
    this.discovered = new Set();
    this.scansSincePity = 0;
    this.pendingReveal = null;
    this.load();
  }

  // ─────────────────────────────────────────────────────────────
  // Collection state
  // ─────────────────────────────────────────────────────────────

  getDiscoveredIds(): ReadonlySet<string> {
    return this.discovered;
  }

  isDiscovered(id: string): boolean {
    return this.discovered.has(id);
  }

  /** Mark a card discovered. Idempotent; unknown ids are ignored; persists. */
  discoverCard(id: string): void {
    if (!KNOWN_CARD_IDS.has(id) || this.discovered.has(id)) return;
    this.discovered.add(id);
    this.save();
  }

  /** Aggregate permanent bonuses of the discovered collection (run-start block). */
  getAggregatedBonuses(): Required<CardBonus> {
    return aggregateCardBonuses(this.discovered);
  }

  // ─────────────────────────────────────────────────────────────
  // Pending reveal (data cache → end screen)
  // ─────────────────────────────────────────────────────────────

  /** Queue a card for the end-screen reveal. Unknown ids are ignored; persists. */
  queuePendingReveal(id: string): void {
    if (!KNOWN_CARD_IDS.has(id)) return;
    this.pendingReveal = id;
    this.save();
  }

  /** The queued reveal without consuming it (null when none). No side effects. */
  peekPendingReveal(): CardDefinition | null {
    return this.pendingReveal === null ? null : getCardById(this.pendingReveal) ?? null;
  }

  /**
   * Pop the queued reveal (null when none) and DISCOVER it — consumption is
   * the reveal moment, so this is where the card becomes visible in the
   * archive and its bonus starts counting. Clears and persists.
   */
  consumePendingReveal(): CardDefinition | null {
    if (this.pendingReveal === null) return null;
    const card = getCardById(this.pendingReveal) ?? null;
    this.pendingReveal = null;
    if (card) this.discovered.add(card.id);
    this.save();
    return card;
  }

  /**
   * Discovered ids plus the pending reveal — the pool discovery rolls must
   * exclude, so the Scanner can never land the card a cache already holds.
   */
  private effectiveDiscovered(): ReadonlySet<string> {
    if (this.pendingReveal === null) return this.discovered;
    const set = new Set(this.discovered);
    set.add(this.pendingReveal);
    return set;
  }

  // ─────────────────────────────────────────────────────────────
  // Discovery rolls
  // ─────────────────────────────────────────────────────────────

  /**
   * Data cache drop path: weighted rarity roll → undiscovered card of that
   * (or nearest fallback) rarity → QUEUE the end-screen reveal. Discovery is
   * deferred to consumePendingReveal() so an abandoned run doesn't spoil the
   * reveal (the card would otherwise sit visible in the archive with its
   * bonus active before the reveal ever plays). Returns null only when the
   * archive is complete — the caller awards gold instead. Note: a second
   * roll while one is queued would overwrite it — callers guard with a
   * once-per-run cache limit.
   */
  rollCacheDiscovery(): CardDefinition | null {
    const rarity = rollCardRarity(this.rng);
    const card = pickUndiscoveredCard(this.effectiveDiscovered(), rarity, this.rng);
    if (!card) return null;
    this.queuePendingReveal(card.id);
    return card;
  }

  /**
   * Scanner lottery. The caller has already spent SCAN_COST gold; this only
   * rolls and discovers. Pity: when scansSincePity has hit the cap (this is
   * the PITY_THRESHOLD-th scan without an epic+) and the natural roll came
   * in below epic, the roll is upgraded to epic-or-legendary — preferring
   * whichever premium tier still has undiscovered cards. The counter resets
   * whenever the LANDED card is epic+ (natural or pity), else increments.
   * Returns { card: null, pityUsed: false } when the archive is complete
   * (callers disable the Scanner on ARCHIVE COMPLETE, so this is a guard).
   */
  scan(): { card: CardDefinition | null; pityUsed: boolean } {
    let rarity = rollCardRarity(this.rng);
    let pityUsed = false;
    if (this.scansSincePity >= MAX_SCANS_SINCE_PITY && !isEpicOrBetter(rarity)) {
      rarity = this.pickPityRarity();
      pityUsed = true;
    }

    const card = pickUndiscoveredCard(this.effectiveDiscovered(), rarity, this.rng);
    if (!card) return { card: null, pityUsed: false };

    // A pity upgrade only "counts" if a premium card actually landed — with
    // all epic+ cards discovered the fallback lands lower and the guarantee
    // stays armed (counter pinned at the cap) rather than being consumed.
    pityUsed = pityUsed && isEpicOrBetter(card.rarity);

    this.discovered.add(card.id);
    if (isEpicOrBetter(card.rarity)) {
      this.scansSincePity = 0;
    } else {
      this.scansSincePity = Math.min(this.scansSincePity + 1, MAX_SCANS_SINCE_PITY);
    }
    this.save();

    return { card, pityUsed };
  }

  /** Scans remaining until the epic+ guarantee (1 = the next scan is guaranteed). */
  getScansUntilPity(): number {
    return Math.max(1, PITY_THRESHOLD - this.scansSincePity);
  }

  /**
   * Rarity for a pity-upgraded roll: whichever premium tier still has
   * undiscovered cards; when both do, re-roll between them at their base
   * drop-weight ratio so legendaries stay rare even under pity.
   */
  private pickPityRarity(): CardRarity {
    const epicLeft = this.hasUndiscoveredOfRarity('epic');
    const legendaryLeft = this.hasUndiscoveredOfRarity('legendary');
    if (epicLeft && !legendaryLeft) return 'epic';
    if (legendaryLeft && !epicLeft) return 'legendary';
    // Both available (or neither — pickUndiscoveredCard's fallback handles
    // the exhausted case): weighted 9:1, mirroring the base table.
    const epicWeight = CARD_RARITY_DROP_WEIGHTS.epic;
    const totalWeight = epicWeight + CARD_RARITY_DROP_WEIGHTS.legendary;
    return this.rng() * totalWeight < epicWeight ? 'epic' : 'legendary';
  }

  private hasUndiscoveredOfRarity(rarity: CardRarity): boolean {
    const taken = this.effectiveDiscovered();
    return ALL_CARDS.some((card) => card.rarity === rarity && !taken.has(card.id));
  }

  // ─────────────────────────────────────────────────────────────
  // Persistence (SecureStorage)
  // ─────────────────────────────────────────────────────────────

  /**
   * Corruption-hardened loader. SecureStorage is the anti-cheat layer, so a
   * tampered/corrupt payload is the threat model (same class as
   * MusicManager.loadEnabledTracks): rebuild `discovered` from KNOWN card ids
   * only (dropping non-string junk and stale ids for removed cards), clamp
   * the pity counter to its sane range rejecting non-finite values, and
   * accept pendingReveal only when it names a known card. Any parse failure
   * or non-object payload falls back to the fresh-profile defaults.
   */
  private load(): void {
    try {
      const stored = SecureStorage.getItem(STORAGE_KEY_CARDS);
      if (!stored) return;
      const parsed: unknown = JSON.parse(stored);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return;
      const record = parsed as Record<string, unknown>;

      if (Array.isArray(record.discovered)) {
        for (const id of record.discovered) {
          if (typeof id === 'string' && KNOWN_CARD_IDS.has(id)) this.discovered.add(id);
        }
      }

      const counter = record.scansSincePity;
      if (typeof counter === 'number' && Number.isFinite(counter)) {
        this.scansSincePity = Math.max(0, Math.min(Math.floor(counter), MAX_SCANS_SINCE_PITY));
      }

      const pending = record.pendingReveal;
      if (typeof pending === 'string' && KNOWN_CARD_IDS.has(pending)) {
        this.pendingReveal = pending;
      }
    } catch {
      console.warn('Could not load card collection from storage');
    }
  }

  private save(): void {
    try {
      SecureStorage.setItem(
        STORAGE_KEY_CARDS,
        JSON.stringify({
          discovered: [...this.discovered],
          scansSincePity: this.scansSincePity,
          pendingReveal: this.pendingReveal,
        }),
      );
    } catch {
      console.warn('Could not save card collection to storage');
    }
  }
}

// ─────────────────────────────────────────────────────────────
// Singleton Instance
// ─────────────────────────────────────────────────────────────

let cardCollectionInstance: CardCollectionManager | null = null;

/**
 * Get the singleton CardCollectionManager instance.
 */
export function getCardCollectionManager(): CardCollectionManager {
  if (!cardCollectionInstance) {
    cardCollectionInstance = new CardCollectionManager();
  }
  return cardCollectionInstance;
}

/**
 * Drop the singleton so the next getCardCollectionManager() re-reads storage.
 * TEST-ONLY escape hatch — production code must never re-create the manager
 * (state would silently fork from any captured references).
 */
export function resetCardCollectionManagerForTests(): void {
  cardCollectionInstance = null;
}
