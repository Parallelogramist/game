/**
 * Ship Mod Tracks — per-ship meta-progression catalog. Each of the 11 ships
 * gets 3 short mod tracks (3 levels each, 400/700/1200 gold) that reinforce
 * that ship's identity: the Interceptor gets faster, the Juggernaut gets
 * tougher. Bought with gold from the shop's HANGAR tab.
 *
 * Scope guard (spec: docs/superpowers/specs/2026-07-03-ship-mod-tracks-design.md):
 * the global shop already covers broad stat growth, so tracks are deliberately
 * NARROW (identity stats only) and SMALL (a maxed track ≈ one mid-tier shop
 * level) — flavor+attachment, not a parallel power system. Magnitudes are a
 * conservative first pass; BALANCE-SHIP-MODS owns tuning after real play.
 *
 * Tracks are drawn from a shared archetype table (hull, thrusters, weapons…)
 * so the same track id always means the same effect no matter which ship it
 * appears on — the UI and the aggregation can treat ids as stable semantics.
 */

import { SHIP_CHARACTERS } from './ShipCharacters';

/**
 * The stat delta ONE LEVEL of a track grants. All fields optional per track;
 * aggregateShipModBonuses folds a ship's levels into a Required<ShipModEffect>
 * with identity defaults (multipliers 1, adds 0) so the run-start consumer
 * never branches on presence — mirroring Cards.ts's CardBonus contract.
 *
 * The *Mult fields are PER-LEVEL multipliers (hull = 1.04) that COMPOUND per
 * level (value^level); the *Add fields scale linearly (value·level).
 */
export type ShipModEffect = Partial<{
  maxHealthMult: number;
  moveSpeedMult: number;
  damageMult: number;
  cooldownMult: number;
  goldMult: number;
  xpMult: number;
  critChanceAdd: number;
  armorAdd: number;
  regenAdd: number;
  lifeStealAdd: number;
  bossDamageAdd: number;
  luckAdd: number;
}>;

export interface ShipModTrack {
  id: string;
  name: string;
  /** States the per-level effect ('+4% max HP per level') for the HANGAR card. */
  description: string;
  /** Semantic icon key resolved through IconMap.getIconFrame (HANGAR card art). */
  icon: string;
  maxLevel: number;
  /** Gold cost of each level; costs.length === maxLevel. */
  costs: readonly number[];
  effectPerLevel: ShipModEffect;
}

// ---------------------------------------------------------------------------
// Economy (first pass — BALANCE-SHIP-MODS owns tuning)
// ---------------------------------------------------------------------------

// Every track shares the same 3-level cost curve: 2,300 gold per track, 6,900
// per ship, ~76k for the full fleet — a long-tail endgame sink sitting between
// the Scanner's 500/roll and the shop's deep tracks.
const TRACK_COSTS: readonly number[] = [400, 700, 1200];
const TRACK_MAX_LEVEL = TRACK_COSTS.length;

// ---------------------------------------------------------------------------
// Track archetypes
// ---------------------------------------------------------------------------

function makeTrack(
  id: string,
  name: string,
  description: string,
  icon: string,
  effectPerLevel: ShipModEffect,
): ShipModTrack {
  return { id, name, description, icon, maxLevel: TRACK_MAX_LEVEL, costs: TRACK_COSTS, effectPerLevel };
}

/**
 * The 12 track archetypes ships draw from. Ships share these objects by
 * reference, which is what guarantees "same track id ⇒ same effect" across
 * the whole table (ShipMods.test.ts verifies it anyway).
 *
 * Note on `cooldown`: the spec's catalog table sketched a linear discount
 * (×(1 − 0.015·level)) but the public API contract defines ONE aggregation
 * rule for all *Mult fields — compounding value^level — and other code
 * compiles against that contract, so compounding wins. The drift is
 * negligible at maxLevel (0.9857³ ≈ 0.9577 vs 0.955) and inside
 * BALANCE-SHIP-MODS's tuning noise floor.
 */
const ARCHETYPES = {
  hull: makeTrack('hull', 'Reinforced Hull', '+4% max HP per level', 'heart', { maxHealthMult: 1.04 }),
  thrusters: makeTrack('thrusters', 'Vector Thrusters', '+2% move speed per level', 'rocket', {
    moveSpeedMult: 1.02,
  }),
  weapons: makeTrack('weapons', 'Weapon Tuning', '+2% damage per level', 'sword', { damageMult: 1.02 }),
  targeting: makeTrack('targeting', 'Targeting Suite', '+1% crit chance per level', 'target', {
    critChanceAdd: 0.01,
  }),
  salvage: makeTrack('salvage', 'Salvage Rig', '+3% gold per level', 'coins', { goldMult: 1.03 }),
  datalink: makeTrack('datalink', 'Data Uplink', '+3% XP per level', 'brain', { xpMult: 1.03 }),
  cooldown: makeTrack('cooldown', 'Cycler Coils', '-1.5% weapon cooldown per level', 'timer', {
    cooldownMult: 0.985,
  }),
  armor: makeTrack('armor', 'Ablative Plating', '+1 armor per level', 'shield', { armorAdd: 1 }),
  regen: makeTrack('regen', 'Nanite Weave', '+0.2 HP/s regen per level', 'bandage', { regenAdd: 0.2 }),
  lifesteal: makeTrack('lifesteal', 'Siphon Array', '+0.5% life steal per level', 'vampire', {
    lifeStealAdd: 0.005,
  }),
  boss: makeTrack('boss', 'Executioner Protocol', '+5% boss damage per level', 'skull', {
    bossDamageAdd: 0.05,
  }),
  luck: makeTrack('luck', 'Fortune Core', '+1% luck per level', 'clover', { luckAdd: 0.01 }),
} as const satisfies Record<string, ShipModTrack>;

// ---------------------------------------------------------------------------
// Per-ship track assignment (identity-reinforcing)
// ---------------------------------------------------------------------------

/**
 * Mod tracks per ship id — every id in SHIP_CHARACTERS, exactly 3 tracks each
 * (ShipMods.test.ts enforces the pairing so a roster change can't silently
 * leave a ship without a hangar).
 */
export const SHIP_MOD_TRACKS: Readonly<Record<string, readonly ShipModTrack[]>> = {
  // Sparrow — balanced all-rounder: a little of everything core.
  ship_default: [ARCHETYPES.weapons, ARCHETYPES.hull, ARCHETYPES.thrusters],
  // Interceptor — speed/CDR identity.
  ship_interceptor: [ARCHETYPES.thrusters, ARCHETYPES.cooldown, ARCHETYPES.targeting],
  // Dreadnought — bruiser: sustain + hitting harder.
  ship_dreadnought: [ARCHETYPES.hull, ARCHETYPES.regen, ARCHETYPES.weapons],
  // Scholar — XP/utility.
  ship_scholar: [ARCHETYPES.datalink, ARCHETYPES.armor, ARCHETYPES.luck],
  // Juggernaut — fortress.
  ship_juggernaut: [ARCHETYPES.hull, ARCHETYPES.armor, ARCHETYPES.regen],
  // Void Walker — glass crit.
  ship_void_walker: [ARCHETYPES.weapons, ARCHETYPES.targeting, ARCHETYPES.cooldown],
  // Boss Hunter — boss damage + gold economy.
  ship_boss_hunter: [ARCHETYPES.boss, ARCHETYPES.salvage, ARCHETYPES.lifesteal],
  // Flawless — gold / clean play.
  ship_flawless: [ARCHETYPES.salvage, ARCHETYPES.targeting, ARCHETYPES.regen],
  // Glass Cannon — all-in damage.
  ship_glass_cannon: [ARCHETYPES.weapons, ARCHETYPES.cooldown, ARCHETYPES.lifesteal],
  // Elite Slayer — hunter.
  ship_elite_slayer: [ARCHETYPES.weapons, ARCHETYPES.datalink, ARCHETYPES.targeting],
  // Apex — pinnacle.
  ship_apex: [ARCHETYPES.hull, ARCHETYPES.weapons, ARCHETYPES.luck],
};

// Fail fast in dev if the roster and the mod table drift apart — the test
// suite catches this too, but a loud console error surfaces it even when the
// game is run without tests.
for (const ship of SHIP_CHARACTERS) {
  if (!SHIP_MOD_TRACKS[ship.id]) {
    console.error(`ShipMods: ship "${ship.id}" has no mod tracks assigned`);
  }
}

// ---------------------------------------------------------------------------
// Lookups
// ---------------------------------------------------------------------------

const NO_TRACKS: readonly ShipModTrack[] = [];

/** Mod tracks for a ship; [] for unknown ship ids so callers never branch. */
export function getShipModTracks(shipId: string): readonly ShipModTrack[] {
  return SHIP_MOD_TRACKS[shipId] ?? NO_TRACKS;
}

/**
 * Gold cost of the NEXT level given the current one (costs[currentLevel]).
 * Infinity at/past maxLevel — and for out-of-domain levels (negative,
 * fractional, non-finite) — so a corrupt level can never buy a discount:
 * any comparison `gold >= cost` fails safe.
 */
export function getShipModCost(track: ShipModTrack, currentLevel: number): number {
  if (!Number.isInteger(currentLevel) || currentLevel < 0 || currentLevel >= track.maxLevel) {
    return Infinity;
  }
  return track.costs[currentLevel];
}

// ---------------------------------------------------------------------------
// Aggregation
// ---------------------------------------------------------------------------

/** Multiplier fields — compound per level (value^level). */
const MULT_KEYS = [
  'maxHealthMult',
  'moveSpeedMult',
  'damageMult',
  'cooldownMult',
  'goldMult',
  'xpMult',
] as const;

/** Additive fields — scale linearly per level (value·level). */
const ADD_KEYS = [
  'critChanceAdd',
  'armorAdd',
  'regenAdd',
  'lifeStealAdd',
  'bossDamageAdd',
  'luckAdd',
] as const;

/**
 * Fold a ship's mod levels into one bonus block for the run-start meta-bonus
 * application (applied immediately AFTER the ship/character bonuses — mods
 * modify the ship you fly). Identity defaults (multipliers 1, adds 0) mean no
 * purchases is a strict no-op; multiplier effects compound (value^level),
 * additive effects scale linearly (value·level).
 *
 * Defensive by design — `levels` may come straight from persisted state:
 * unknown track ids are ignored, and levels are floored to integers and
 * clamped to [0, maxLevel] (non-finite ⇒ 0) so junk can never over- or
 * under-apply a track.
 */
export function aggregateShipModBonuses(
  shipId: string,
  levels: Readonly<Record<string, number>>,
): Required<ShipModEffect> {
  const result: Required<ShipModEffect> = {
    maxHealthMult: 1,
    moveSpeedMult: 1,
    damageMult: 1,
    cooldownMult: 1,
    goldMult: 1,
    xpMult: 1,
    critChanceAdd: 0,
    armorAdd: 0,
    regenAdd: 0,
    lifeStealAdd: 0,
    bossDamageAdd: 0,
    luckAdd: 0,
  };

  for (const track of getShipModTracks(shipId)) {
    const raw = levels[track.id];
    const level =
      typeof raw === 'number' && Number.isFinite(raw)
        ? Math.max(0, Math.min(track.maxLevel, Math.floor(raw)))
        : 0;
    if (level === 0) continue;

    for (const key of MULT_KEYS) {
      const value = track.effectPerLevel[key];
      if (value !== undefined) result[key] *= value ** level;
    }
    for (const key of ADD_KEYS) {
      const value = track.effectPerLevel[key];
      if (value !== undefined) result[key] += value * level;
    }
  }

  return result;
}
