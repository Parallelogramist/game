/**
 * UltimateSystem — the player's charged "Overdrive" ability.
 *
 * A charge meter fills from kills and damage dealt. Once full, the player can
 * unleash a screen-clearing nova (scaling with their damage) plus a brief slow.
 *
 * Module-level state pattern (mirrors ComboSystem) — no class, just exported
 * functions. Call resetUltimateSystem() in GameScene.create() to clear state
 * between runs. The pure scaling math (computeUltimateNova) and the corruption-
 * hardened save round-trip live here so they are unit-testable without Phaser.
 */

// ---------------------------------------------------------------------------
// Constants (tuning — feel goes to the playtest queue)
// ---------------------------------------------------------------------------

/** Charge required to fire the ultimate. Charge is tracked on a 0..MAX scale. */
export const MAX_ULTIMATE_CHARGE = 100;

/** Charge granted per enemy kill (~40 kills fills it from kills alone). */
export const ULTIMATE_CHARGE_PER_KILL = 2.5;

/** Charge granted per point of damage dealt (~8.3k damage fills it alone). */
export const ULTIMATE_CHARGE_PER_DAMAGE = 0.012;

/** Screen-clearing nova radius (px) — slightly wider than the BOMB consumable. */
export const ULTIMATE_NOVA_RADIUS = 760;

/** Base nova damage before the player damage multiplier and time growth. */
export const ULTIMATE_NOVA_BASE_DAMAGE = 450;

/** Extra nova damage added per second of run time (keeps it relevant late). */
export const ULTIMATE_NOVA_DAMAGE_PER_SECOND = 4;

/** Knockback applied by the nova. */
export const ULTIMATE_NOVA_KNOCKBACK = 380;

/** Slow-motion window opened on activation (ms / time scale / ramp ms). */
export const ULTIMATE_SLOWMO_DURATION_MS = 900;
export const ULTIMATE_SLOWMO_SCALE = 0.2;
export const ULTIMATE_SLOWMO_RAMP_MS = 300;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface UltimateNova {
  radius: number;
  damage: number;
  knockback: number;
}

export interface UltimateSnapshot {
  charge: number;
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let charge = 0;
/** While true, all charge gain is dropped — guards the nova from recharging itself. */
let chargeSuppressed = false;
/** Meta-progression scale on all charge gain (card bonuses); 1 = baseline. */
let chargeRateMultiplier = 1;

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

export function resetUltimateSystem(): void {
  charge = 0;
  chargeSuppressed = false;
  chargeRateMultiplier = 1;
}

/**
 * Scale all subsequent charge gain (kills and damage alike). Set once at run
 * start from aggregated card bonuses, after resetUltimateSystem(). Non-finite
 * or non-positive values are rejected so a corrupt meta save can never stall
 * or overdrive the meter.
 */
export function setUltimateChargeRateMultiplier(multiplier: number): void {
  if (!Number.isFinite(multiplier) || multiplier <= 0) return;
  chargeRateMultiplier = multiplier;
}

// ---------------------------------------------------------------------------
// Charge accumulation
// ---------------------------------------------------------------------------

/** Add raw charge, clamped to [0, MAX]. Dropped entirely while suppressed. */
export function addUltimateCharge(amount: number): void {
  if (chargeSuppressed) return;
  if (!Number.isFinite(amount) || amount <= 0) return;
  charge = Math.min(MAX_ULTIMATE_CHARGE, charge + amount * chargeRateMultiplier);
}

export function addUltimateChargeFromKill(): void {
  addUltimateCharge(ULTIMATE_CHARGE_PER_KILL);
}

export function addUltimateChargeFromDamage(damage: number): void {
  if (!Number.isFinite(damage) || damage <= 0) return;
  addUltimateCharge(damage * ULTIMATE_CHARGE_PER_DAMAGE);
}

/**
 * Toggle charge suppression. The activation path sets this true around the nova
 * detonation (which routes back through damageEnemy and would otherwise re-fill
 * the meter), then clears it.
 */
export function setUltimateChargeSuppressed(suppressed: boolean): void {
  chargeSuppressed = suppressed;
}

// ---------------------------------------------------------------------------
// Readiness & activation
// ---------------------------------------------------------------------------

export function getUltimateCharge(): number {
  return charge;
}

export function getUltimateChargeRatio(): number {
  return Math.min(1, charge / MAX_ULTIMATE_CHARGE);
}

export function isUltimateReady(): boolean {
  return charge >= MAX_ULTIMATE_CHARGE;
}

/**
 * Fire the ultimate if ready. Consumes the full charge and returns true; returns
 * false (no state change) when the meter is not full.
 */
export function tryActivateUltimate(): boolean {
  if (!isUltimateReady()) return false;
  charge = 0;
  return true;
}

// ---------------------------------------------------------------------------
// Nova scaling (pure)
// ---------------------------------------------------------------------------

/**
 * Compute the nova's damage/radius/knockback for the given player damage
 * multiplier and elapsed run time. Non-finite inputs fall back to safe defaults
 * so a corrupt PlayerStats value can never produce a NaN-damage detonation.
 */
export function computeUltimateNova(damageMultiplier: number, gameTime: number): UltimateNova {
  const safeMultiplier = Number.isFinite(damageMultiplier) && damageMultiplier > 0 ? damageMultiplier : 1;
  const safeTime = Number.isFinite(gameTime) && gameTime > 0 ? gameTime : 0;
  const baseDamage = ULTIMATE_NOVA_BASE_DAMAGE + safeTime * ULTIMATE_NOVA_DAMAGE_PER_SECOND;
  return {
    radius: ULTIMATE_NOVA_RADIUS,
    damage: baseDamage * safeMultiplier,
    knockback: ULTIMATE_NOVA_KNOCKBACK,
  };
}

// ---------------------------------------------------------------------------
// Save / restore (corruption-hardened — save store is an encrypted tamper surface)
// ---------------------------------------------------------------------------

export function getUltimateState(): UltimateSnapshot {
  return { charge };
}

export function restoreUltimateState(snapshot: UltimateSnapshot | null | undefined): void {
  const raw = snapshot?.charge;
  if (!Number.isFinite(raw)) {
    // NaN/undefined/missing → empty; Infinity is clamped to MAX below.
    charge = raw === Number.POSITIVE_INFINITY ? MAX_ULTIMATE_CHARGE : 0;
    return;
  }
  charge = Math.max(0, Math.min(MAX_ULTIMATE_CHARGE, raw as number));
}
