import { describe, it, expect } from 'vitest';
import { buildRunEarnings, buildRunNotices, formatRunEarningsLine } from './RunEarnings';

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

describe('buildRunNotices', () => {
  const notice = (title: string, description: string) => ({
    title,
    description,
    icon: 'star',
    color: 0xffffff,
    tier: 'notable' as const,
  });

  it('returns nothing when the diet suppressed nothing', () => {
    expect(buildRunNotices([])).toEqual([]);
  });

  it('tags every row FOUND and keeps them in the order they happened', () => {
    const rows = buildRunNotices([
      notice('SIGNAL DECRYPTED', 'A lead was filed'),
      notice('NEW ROUTES', 'Two apertures opened'),
    ]);
    expect(rows.map((row) => row.tag)).toEqual(['FOUND', 'FOUND']);
    expect(rows.map((row) => row.name)).toEqual(['SIGNAL DECRYPTED', 'NEW ROUTES']);
  });

  it('collapses repeats of one title into a counted row keeping the first detail', () => {
    const rows = buildRunNotices([
      notice('SECTOR CHARTED', 'North ridge'),
      notice('SECTOR CHARTED', 'East flats'),
      notice('SECTOR CHARTED', 'South basin'),
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0].name).toBe('SECTOR CHARTED ×3');
    expect(rows[0].detail).toBe('North ridge');
  });

  it('flattens a multi-line description into one row-safe line', () => {
    const rows = buildRunNotices([notice('MILESTONE', 'Cleared the vault\n+250 gold')]);
    expect(rows[0].detail).toBe('Cleared the vault · +250 gold');
  });
});

describe('formatRunEarningsLine label', () => {
  it('defaults to EARNED and accepts an override', () => {
    const rows = buildRunNotices([
      {
        title: 'VAULT UNSEALED',
        description: 'x',
        icon: 'star',
        color: 0xffffff,
        tier: 'notable' as const,
      },
    ]);
    expect(formatRunEarningsLine(rows)).toBe('EARNED   VAULT UNSEALED');
    expect(formatRunEarningsLine(rows, 'FOUND')).toBe('FOUND   VAULT UNSEALED');
  });
});
