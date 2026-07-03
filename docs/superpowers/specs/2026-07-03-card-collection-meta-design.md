# Card Collection & Scanner Lottery — Meta-Progression Design

Inspiration: Sky Force Reloaded's meta loop — ship upgrades, card
collection/discovery, and a light gold-lottery for card finds. The goal is the
*feel* (compounding permanent progress, discovery moments, one-more-run pull),
not a genre change. This spec is the durable source of truth; BACKLOG items
FEAT-CARDS-* track implementation phases.

## How this maps onto what already exists

- **Ship upgrades** — already covered by the permanent upgrade shop
  (`ShopScene` + `MetaProgressionManager`): gold → incremental stat tracks is
  exactly SFR's upgrade grind. Do NOT duplicate it. A future per-ship "mod
  tracks" layer (each ship gets 3 short tracks that reinforce its identity) is
  filed as FEAT-SHIP-MODS — needs human economy sign-off first.
- **Cards** — NEW system, spec'd below.
- **Lottery** — NEW "Scanner" sink for gold, spec'd below.

## Card system (phase 1 target)

~24 collectible cards, each a small **permanent passive** applied at run start
in GameScene's meta-bonus block (alongside `metaManager.getStartingX()`).
Rarity mirrors the relic model (`src/data/Relics.ts` is the template):
common / rare / epic / legendary with weights 60/30/9/1.

Magnitude bands (keep them SMALL — cards are seasoning, the shop is the meal):
- common (~10 cards): +2–3% single stat (damage, attack speed, gold, XP,
  magnet radius, move speed, +10 HP, +1% crit, small armor, small dash CDR)
- rare (~8): +4–6% single stat, or +0.05 luck, +1 reroll, +1 banish
- epic (~4): dual small stats (+4%/+4%) or +8% single, +10% ult charge rate
- legendary (~2): identity cards — e.g. "Head Start" (begin at level 2),
  "Golden Compass" (+12% gold and +0.08 luck)

### Discovery sources

1. **Data cache drops (in-run):** rolled in `handleEnemyDeath` — boss 100%,
   miniboss ~20%, elite ~2%. A cache queues ONE pending discovery (weighted
   rarity roll → random undiscovered card in that rarity; fall back to the
   nearest rarity with undiscovered cards; if the archive is complete, award
   +250 gold instead). Show a toast on pickup ("DATA CACHE RECOVERED") — the
   actual card is **revealed on the end screen** (death or victory), SFR-style.
   **Discovery is deferred to the reveal** (FEAT-CARDS-2): a queued card stays
   hidden — not in the archive grid, bonus inactive, excluded from Scanner
   rolls — until `consumePendingReveal()` fires on an end screen, so an
   abandoned run can never spoil the reveal moment.
2. **Scanner lottery (menu):** in the Cards scene, DECRYPT costs 500 gold and
   rolls the same rarity table (no luck bias — luck is an in-run stat).
   **Pity:** a persisted counter guarantees epic-or-better every 8th scan
   without one. Scanner disables with "ARCHIVE COMPLETE" when everything is
   discovered. No dupes ever — a roll always lands on an undiscovered card of
   the rolled (or nearest fallback) rarity.

### Collection screen — `CardsScene`

Fifth entry in the BootScene progression deck. Grid of card slots in the
neon-tech language: undiscovered = dark slot, rarity-colored hairline frame,
"?" glyph; discovered = mini MenuCard with icon, name, bonus line, rarity
accent. Header: collection count + aggregate bonus summary. Side panel:
Scanner with DECRYPT button, gold readout, pity hint ("rare+ guaranteed in
N"). Reveal = card-flip/glow moment (reduced-motion: simple fade). Full
keyboard/gamepad nav via MenuNavigator; staggered entrance; sweep transitions.

### Persistence

`survivor-meta-cards` via SecureStorage — MUST be registered in
`StorageBootstrap.ALL_STORAGE_KEYS` (see BUG-STORAGE-PRELOAD-GAPS) and the
loader must be corruption-hardened like every other meta loader (rebuild from
known card ids; drop junk; tolerate missing fields). Persisted shape:
`{ discovered: string[], scansSincePity: number, pendingReveal: string | null }`.

### Public API contract (implementers compile against this)

`src/data/Cards.ts`:
- `type CardRarity = 'common' | 'rare' | 'epic' | 'legendary'`
- `interface CardDefinition { id: string; name: string; description: string; rarity: CardRarity; icon: string; bonus: CardBonus }`
- `type CardBonus = Partial<{ damageMult, attackSpeedMult, goldMult, xpMult, magnetRadiusMult, moveSpeedMult, maxHealthAdd, critChanceAdd, armorAdd, luckAdd, rerollsAdd, banishesAdd, ultChargeRateMult, startAtLevel }>` (all numbers)
- `const ALL_CARDS: readonly CardDefinition[]`
- `function rollCardRarity(rng?: () => number): CardRarity`
- `function pickUndiscoveredCard(discoveredIds: ReadonlySet<string>, rarity: CardRarity, rng?: () => number): CardDefinition | null` (with nearest-rarity fallback; null only when archive complete)
- `function aggregateCardBonuses(discoveredIds: ReadonlySet<string>): Required<CardBonus>` (identity defaults: mults 1, adds 0, startAtLevel 1)

`src/meta/CardCollectionManager.ts` (singleton, `getCardCollectionManager()`):
- `getDiscoveredIds(): ReadonlySet<string>` · `isDiscovered(id): boolean`
- `discoverCard(id): void` (idempotent, persists)
- `queuePendingReveal(id): void` / `peekPendingReveal(): CardDefinition | null`
  (no side effects) / `consumePendingReveal(): CardDefinition | null`
  (**consumption IS the discovery moment** — clears the queue, discovers,
  persists)
- `rollCacheDiscovery(): CardDefinition | null` (drop path: roll + queue only;
  discovery deferred to `consumePendingReveal()`; the queued card is excluded
  from all further rolls so it can never dupe)
- `scan(): { card: CardDefinition | null; pityUsed: boolean }` (lottery: spends NOTHING itself — caller spends gold via MetaProgressionManager first; applies pity; discovers immediately — the Scanner reveal is in-scene)
- `getScansUntilPity(): number` · `SCAN_COST = 500` exported const
- `getAggregatedBonuses(): Required<CardBonus>`

Collection milestones (FEAT-CARDS-2): four `cards_discovered` achievements
(1/6/12/24 → gold, tier chain `cards_discovered_*` in
`AchievementDefinitions.ts`). Feed via
`AchievementManager.recordCardsDiscovered(totalCount)` — called wherever a
discovery lands (end-screen reveal consumption in GameScene, Scanner decrypt
+ entry sync in CardsScene). Menu-context delivery: `AchievementManager` only
auto-claims when an unlock callback is wired; CardsScene wires its own
(gold + banner) and detaches it on shutdown, and unclaimed rewards are
retro-claimed by AchievementScene.

## Phases

- **FEAT-CARDS-1** (this session): data + manager + tests, run-start bonus
  application, cache drops, end-screen reveal, CardsScene with scanner.
- **FEAT-CARDS-2**: reveal juice (flip animation polish, sfx), card icons
  pass, collection milestones (own N cards → gold bonus achievements),
  balance pass on drop rates/costs after real play.
- **FEAT-CARDS-3**: consider timed/next-run boost cards (SFR's temporary
  cards) — needs design; interacts with save-restore.
- **FEAT-SHIP-MODS**: per-ship mod tracks (human sign-off first).

## Feel checklist (playtest against this)

Discovery must feel earned + surprising (end-screen reveal, not mid-combat
noise). Scanner should tease (pity countdown visible). Bonuses small enough
that a full archive ≈ one shop tier, not a difficulty cliff. Every reveal
animation respects reduced motion.
