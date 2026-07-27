import { describe, it, expect } from 'vitest';
import { computeRunNetGold, formatRunEconomyLine } from './RunEconomy';

describe('run economy', () => {
  it('nets the payout, what the run found and quest gold against what it spent', () => {
    expect(computeRunNetGold({ payout: 1200, found: 300, spent: 800, questGold: 150 })).toBe(850);
  });

  it('nets negative when a run spent more than it earned', () => {
    expect(computeRunNetGold({ payout: 100, found: 50, spent: 900, questGold: 0 })).toBe(-750);
  });

  it('reports no line when the run moved no gold of its own, however large the payout', () => {
    expect(formatRunEconomyLine({ payout: 5000, found: 0, spent: 0, questGold: 0 })).toBeNull();
  });

  it('omits zero terms and trails with net', () => {
    const line = formatRunEconomyLine({ payout: 1000, found: 0, spent: 400, questGold: 0 });
    expect(line).toContain('spent -400');
    expect(line).toContain('net +600');
    expect(line).not.toContain('found');
    expect(line).not.toContain('quests');
  });

  it('renders a negative net with a single minus sign', () => {
    const line = formatRunEconomyLine({ payout: 100, found: 50, spent: 900, questGold: 0 });
    expect(line?.endsWith('net -750')).toBe(true);
  });
});
