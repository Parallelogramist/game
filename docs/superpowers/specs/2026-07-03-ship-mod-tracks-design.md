# Ship Mod Tracks — Per-Ship Meta-Progression (FEAT-SHIP-MODS)

The last piece of the Sky Force Reloaded meta loop (see
`2026-07-03-card-collection-meta-design.md` for the mapping): ships should
feel like they GROW individually, not only through the global shop. Each ship
gets **3 short mod tracks** (3 levels each) that reinforce that ship's
identity — the Interceptor gets faster, the Juggernaut gets tougher — bought
with gold from the shop's new HANGAR tab.

Scope guard: the global shop already covers broad stat growth. Mod tracks are
deliberately NARROW (identity stats only) and SMALL (a maxed track ≈ one
mid-tier shop level), so they read as flavor+attachment, not a parallel
power system. Economy numbers below are a conservative first pass —
**BALANCE-SHIP-MODS in the playtest queue owns tuning after real play.**

## Economy (first pass — tune in playtest)

Every track: 3 levels, costing **400 / 700 / 1200 gold** (2,300 per track,
6,900 per ship, ~76k for the full 11-ship fleet — a long-tail endgame sink
sitting between the scanner's 500/roll and the shop's deep tracks).

## Track catalog (archetypes; per-level effects, linear)

| id | name | per-level effect |
|---|---|---|
| hull | Reinforced Hull | +4% max HP (mult) |
| thrusters | Vector Thrusters | +2% move speed (mult) |
| weapons | Weapon Tuning | +2% damage (mult) |
| targeting | Targeting Suite | +1% crit chance (add) |
| salvage | Salvage Rig | +3% gold (mult) |
| datalink | Data Uplink | +3% XP (mult) |
| cooldown | Cycler Coils | −1.5% weapon cooldown (mult, 0.985^level style compounding NOT used — linear: ×(1 − 0.015·level)) |
| armor | Ablative Plating | +1 armor (add) |
| regen | Nanite Weave | +0.2 HP/s regen (add) |
| lifesteal | Siphon Array | +0.5% life steal (add) |
| boss | Executioner Protocol | +5% boss damage (add to bossDamageMultiplier) |
| luck | Fortune Core | +1% luck (add) |

## Per-ship track assignment (identity-reinforcing)

- **Sparrow** (all-rounder): weapons, hull, thrusters
- **Interceptor** (speed/CDR): thrusters, cooldown, targeting
- **Dreadnought** (bruiser): hull, regen, weapons
- **Scholar** (XP/utility): datalink, armor, luck
- **Juggernaut** (fortress): hull, armor, regen
- **Void Walker** (glass crit): weapons, targeting, cooldown
- **Boss Hunter** (boss/gold): boss, salvage, lifesteal
- **Flawless** (gold/clean play): salvage, targeting, regen
- **Glass Cannon** (all-in damage): weapons, cooldown, lifesteal
- **Elite Slayer** (hunter): weapons, datalink, targeting
- **Apex** (pinnacle): hull, weapons, luck

## Public API contract (implementers compile against this)

`src/data/ShipMods.ts`:
- `type ShipModEffect = Partial<{ maxHealthMult, moveSpeedMult, damageMult, cooldownMult, goldMult, xpMult, critChanceAdd, armorAdd, regenAdd, lifeStealAdd, bossDamageAdd, luckAdd }>` (all numbers; the *Mult fields are PER-LEVEL multipliers, e.g. hull = 1.04)
- `interface ShipModTrack { id: string; name: string; description: string; maxLevel: number; costs: readonly number[]; effectPerLevel: ShipModEffect }` (`costs.length === maxLevel`; description states the per-level effect)
- `const SHIP_MOD_TRACKS: Readonly<Record<string, readonly ShipModTrack[]>>` keyed by ship id — EVERY id in `SHIP_CHARACTERS` present, exactly 3 tracks each
- `function getShipModTracks(shipId: string): readonly ShipModTrack[]` ([] for unknown ships)
- `function getShipModCost(track: ShipModTrack, currentLevel: number): number` (costs[currentLevel]; `Infinity` at/past maxLevel)
- `function aggregateShipModBonuses(shipId: string, levels: Readonly<Record<string, number>>): Required<ShipModEffect>` — identity defaults (mults 1, adds 0); mult fields compound per level (`value^level`), add fields scale linearly (`value·level`); unknown track ids in `levels` ignored; levels clamped to [0, maxLevel]

`src/meta/ShipModManager.ts` (singleton `getShipModManager()`, plus `resetShipModManagerForTests()`):
- `getLevel(shipId, trackId): number`
- `purchase(shipId, trackId): boolean` — increments if below maxLevel and persists; **spends NOTHING itself** (caller spends gold via MetaProgressionManager first, mirroring CardCollectionManager.scan()); returns false (no state change) at cap or for unknown ids
- `getAggregatedBonuses(shipId): Required<ShipModEffect>`
- `getTotalLevels(shipId): number` / `getMaxTotalLevels(shipId): number` (for "3/9 MODS" readouts)

Persistence: `survivor-meta-ship-mods` via SecureStorage → `{ [shipId]: { [trackId]: level } }`.
MUST be registered in `StorageBootstrap.ALL_STORAGE_KEYS`. Loader
corruption-hardened: rebuild from known ship/track ids only, coerce levels to
integers clamped [0, maxLevel], drop junk, tolerate non-objects.

## Application (run start)

GameScene meta block, immediately AFTER the ship/character bonuses (mods
modify the ship you fly): maxHealth ×= then round + currentHealth resync,
moveSpeed/damage/cooldown/gold/xp ×=, critChance/armor/regenPerSecond/
lifeStealPercent/luck +=, bossDamageMultiplier += bossDamageAdd (defaulting
the stat to 1 if the ship didn't set it).

## UI — HANGAR tab in ShopScene

New tab after the existing categories. Content: the mod tracks of every
UNLOCKED ship (same availability rule as WeaponSelectScene, via
`isUnlockRequirementMet` + hidden unlocks) as cards in the existing shop
grid/scroll/navigator machinery — card shows ship name kicker, track name,
level pips (n/3), per-level effect line, cost or MAXED. Locked ships show a
single teaser card ("UNLOCK <ship> TO ACCESS ITS HANGAR") only if at least
one locked ship exists; no per-track cards. Purchases: gold check →
`metaManager.spendGold` → `shipModManager.purchase` → refresh card + gold
readout (mirror the shop's purchase flow incl. sound + insufficient-gold
feedback).

## Phases

- **FEAT-SHIP-MODS-1**: data + manager + tests, run-start application,
  HANGAR tab. (Built 2026-07-03.)
- **FEAT-SHIP-MODS-2**: ship-select integration (show mod levels on the ship
  card in WeaponSelectScene), mod-icon art pass, maybe per-ship mod
  achievements. Needs FEAT-SHIP-MODS-1 playtest feedback first.
- **BALANCE-SHIP-MODS**: costs/magnitudes after real play (playtest queue).
