/**
 * The gold a single run moved, and the one net formula both run-end overlays must
 * agree on. `payout` is the end-of-run formula's award; `found`/`spent` are what the
 * run itself moved through the wallet before that landed; `questGold` is the
 * daily-quest settle paid at run end (after the ledger snapshot, so it is never in
 * `found`).
 */
export interface RunEconomy {
  payout: number;
  found: number;
  spent: number;
  questGold: number;
}

export function computeRunNetGold(economy: RunEconomy): number {
  return economy.payout + economy.found + economy.questGold - economy.spent;
}

/** True when the run moved gold of its own — i.e. there is more to report than the payout. */
export function hasRunEconomyDetail(economy: RunEconomy): boolean {
  return economy.found > 0 || economy.spent > 0 || economy.questGold > 0;
}

/**
 * One-line economy readout for an overlay with no room for a stat grid (the victory
 * screen). Zero terms are omitted; `net` always trails. Null when the run moved no
 * gold of its own and the payout line already says everything.
 */
export function formatRunEconomyLine(economy: RunEconomy): string | null {
  if (!hasRunEconomyDetail(economy)) return null;
  const parts: string[] = [];
  if (economy.found > 0) parts.push(`found +${economy.found}`);
  if (economy.questGold > 0) parts.push(`quests +${economy.questGold}`);
  if (economy.spent > 0) parts.push(`spent -${economy.spent}`);
  const net = computeRunNetGold(economy);
  parts.push(`net ${net < 0 ? '-' : '+'}${Math.abs(net)}`);
  return parts.join('   ·   ');
}
