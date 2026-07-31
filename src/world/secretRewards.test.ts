import { describe, expect, it } from 'vitest';
import { SECRET_REWARDS, rollSecretReward } from './secretRewards';
import type { SecretRewardId, SecretTier } from './secretRewards';

const TIERS: readonly SecretTier[] = ['cache', 'hiddenSector', 'puzzle'];
const DEPTHS = [0, 1, 2, 3, 4, 5, 6, 8, 12];

describe('secret rewards', () => {
  it('rolls the same reward every time for one secret in one world', () => {
    for (const tier of TIERS) {
      for (const depth of DEPTHS) {
        const first = rollSecretReward({
          worldSeed: 20260727, secretId: 'poi:3,4:0', depth, tier,
        });
        const second = rollSecretReward({
          worldSeed: 20260727, secretId: 'poi:3,4:0', depth, tier,
        });
        expect(second.id).toBe(first.id);
      }
    }
  });

  it('can pay every reward in the table', () => {
    const seen = new Set<SecretRewardId>();
    for (const tier of TIERS) {
      for (const depth of DEPTHS) {
        for (let index = 0; index < 400; index++) {
          seen.add(rollSecretReward({
            worldSeed: 20260727, secretId: `poi:${index}`, depth, tier,
          }).id);
        }
      }
    }
    expect([...seen].sort()).toEqual(SECRET_REWARDS.map(reward => reward.id).slice().sort());
  });

  it('keeps the twin-chest jackpot out of the shallow ring at every tier', () => {
    for (const tier of TIERS) {
      for (const depth of [0, 1, 2]) {
        for (let index = 0; index < 500; index++) {
          expect(rollSecretReward({
            worldSeed: 20260727, secretId: `poi:${index}`, depth, tier,
          }).id).not.toBe('secret_twin_chests');
        }
      }
    }
  });
});
