import { ConsumableKind } from '../ecs/systems/ConsumablePickupSystem';
import type { TimedStatField } from '../systems/TimedStatBuffs';

/**
 * Field boosts: floor consumables that grant a timed PlayerStats surge instead of an
 * instant effect. They ride the existing consumable spawn/magnetize/collect rail and the
 * existing `TimedStatBuffs` expiry clock, so they survive refresh-recovery for free.
 */
export interface FieldBoostDefinition {
  kind: ConsumableKind;
  name: string;
  /** Effect noun used in the pickup toast, e.g. "+50% damage for 20s." */
  effectLabel: string;
  stat: TimedStatField;
  magnitude: number;
  durationSeconds: number;
  /** Semantic IconMap key for the pickup toast. */
  icon: string;
}

export const FIELD_BOOSTS: readonly FieldBoostDefinition[] = [
  {
    kind: ConsumableKind.OVERDRIVE_CELL,
    name: 'Overdrive Cell',
    effectLabel: 'damage',
    stat: 'damageMultiplier',
    magnitude: 1.5,
    durationSeconds: 20,
    icon: 'lightning',
  },
  {
    kind: ConsumableKind.SCHOLAR_LENS,
    name: 'Scholar Lens',
    effectLabel: 'XP',
    stat: 'xpMultiplier',
    magnitude: 2,
    durationSeconds: 15,
    icon: 'telescope',
  },
  {
    kind: ConsumableKind.PROSPECTOR_BEACON,
    name: 'Prospector Beacon',
    effectLabel: 'gem value',
    stat: 'gemValueMultiplier',
    magnitude: 2,
    durationSeconds: 15,
    icon: 'gem',
  },
  {
    kind: ConsumableKind.AFTERBURNER_CANISTER,
    name: 'Afterburner Canister',
    effectLabel: 'move speed',
    stat: 'moveSpeed',
    magnitude: 1.4,
    durationSeconds: 12,
    icon: 'boot',
  },
];

export function getFieldBoostByKind(kind: ConsumableKind): FieldBoostDefinition | undefined {
  return FIELD_BOOSTS.find((boost) => boost.kind === kind);
}
