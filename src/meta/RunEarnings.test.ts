import { describe, it, expect } from 'vitest';
import { buildRunEarnings, formatRunEarningsLine } from './RunEarnings';

describe('buildRunEarnings', () => {
  it('returns nothing when the run earned nothing', () => {
    expect(buildRunEarnings({ unlocks: [], achievements: [], quests: [] })).toEqual([]);
    expect(formatRunEarningsLine([])).toBeNull();
  });

  it('orders unlocks before achievements before quests, and tags each', () => {
    const earnings = buildRunEarnings({
      unlocks: [{ displayName: 'Void Runner', hintText: 'Win without dying', target: 'ship' }],
      achievements: [{ name: 'Centurion', detail: '+250 gold' }],
      quests: [{ name: 'Cull the Swarm', gold: 120 }],
    });
    expect(earnings.map((earning) => earning.tag)).toEqual(['SHIP', 'ACHIEVEMENT', 'QUEST']);
    expect(earnings[0].name).toBe('Void Runner');
    expect(earnings[0].detail).toBe('Win without dying');
  });

  it('spells a quest reward as its gold', () => {
    const [quest] = buildRunEarnings({
      unlocks: [],
      achievements: [],
      quests: [{ name: 'Cull the Swarm', gold: 120 }],
    });
    expect(quest.detail).toBe('+120 gold');
  });

  it('names two on the victory line and counts the rest', () => {
    const earnings = buildRunEarnings({
      unlocks: [
        { displayName: 'Void Runner', hintText: 'a', target: 'ship' },
        { displayName: 'Ion Lance', hintText: 'b', target: 'weapon' },
      ],
      achievements: [{ name: 'Centurion', detail: '+250 gold' }],
      quests: [{ name: 'Cull the Swarm', gold: 120 }],
    });
    expect(formatRunEarningsLine(earnings)).toBe('EARNED   Void Runner   ·   Ion Lance   ·   +2 more');
    expect(formatRunEarningsLine(earnings.slice(0, 1))).toBe('EARNED   Void Runner');
  });
});
