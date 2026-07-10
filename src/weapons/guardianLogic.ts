/**
 * Guardian trigger core — the pure model for the Guardian weapon.
 *
 * Every other weapon in the arsenal fires on a fixed cooldown timer that ticks
 * regardless of what the enemy does. The Guardian is the arsenal's first
 * *reactive* weapon: it fires only when the PLAYER takes damage, retaliating with
 * a radial nova of shards. That rewards aggressive, face-tank play (armor / thorns
 * builds) instead of pure kiting.
 *
 * The one piece of real logic — and the one that needs to be right — is the
 * trigger gating: a swarm can land several hits in the span the player's i-frames
 * lapse, and without an internal cooldown the orb would chain-detonate on every
 * one of them. So the orb arms an internal cooldown on each retaliation and
 * refuses to fire again until it lapses. That gate, plus the hit-scaled damage
 * formula, lives here (Phaser-free, unit-tested — mirrors `sentryLogic` /
 * `singularityLogic`); the weapon class drives the shard pool, collision, and
 * visuals around it.
 */

export interface GuardianState {
  /** Seconds until the orb can retaliate again (0 = ready to fire). */
  cooldownRemaining: number;
}

export interface GuardianTrigger {
  /** Whether the retaliation fires this hit (internal cooldown had elapsed). */
  triggered: boolean;
  /** The state after the attempt — armed with a fresh cooldown when triggered. */
  state: GuardianState;
}

/** Fresh orb, ready to retaliate on the first hit. */
export function createGuardianState(): GuardianState {
  return { cooldownRemaining: 0 };
}

/**
 * Advance the internal cooldown by one frame, never below 0. Returns the same
 * object once ready so a ready orb allocates nothing on the common per-frame path.
 */
export function tickGuardian(state: GuardianState, dt: number): GuardianState {
  if (state.cooldownRemaining <= 0) return state;
  return { cooldownRemaining: Math.max(0, state.cooldownRemaining - dt) };
}

/**
 * Attempt to retaliate on a player hit. If the internal cooldown has elapsed the
 * orb fires (triggered=true) and re-arms with a fresh `cooldown`; otherwise the
 * hit is absorbed silently (triggered=false, state unchanged) — this is what
 * stops a multi-hit swarm from chain-detonating the orb.
 */
export function tryTrigger(state: GuardianState, cooldown: number): GuardianTrigger {
  if (state.cooldownRemaining > 0) {
    return { triggered: false, state };
  }
  return { triggered: true, state: { cooldownRemaining: Math.max(0, cooldown) } };
}

/**
 * Retaliation damage per shard: the weapon's base damage plus a fraction of the
 * hit that provoked it, so face-tanking a big hit fires back harder. The bonus is
 * capped at a multiple of base damage so a single crushing boss blow can't spike
 * the nova into absurd territory.
 */
export function computeRetaliationDamage(
  baseDamage: number,
  hitDamage: number,
  hitFraction: number,
  maxBonusMultiple: number
): number {
  const rawBonus = Math.max(0, hitDamage) * hitFraction;
  const bonus = Math.min(rawBonus, baseDamage * maxBonusMultiple);
  return baseDamage + bonus;
}
