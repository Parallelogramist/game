export interface ThreatTier {
  readonly tier: number;
  readonly name: string;
  readonly description: string;
  readonly reward: string;
  readonly curseAdd: number;
  readonly goldMult: number;
  readonly color: number;
}

export const THREAT_TIERS: readonly ThreatTier[] = [
  { tier: 0, name: 'THREAT 0', description: 'Standard difficulty. No scaling.', reward: 'Normal rewards',  curseAdd: 0.0,  goldMult: 1.0,  color: 0x88ccaa },
  { tier: 1, name: 'THREAT 1', description: 'Enemies +15% HP & damage.',        reward: '+15% gold',       curseAdd: 0.15, goldMult: 1.15, color: 0xbfd873 },
  { tier: 2, name: 'THREAT 2', description: 'Enemies +30% HP & damage.',        reward: '+30% gold',       curseAdd: 0.3,  goldMult: 1.3,  color: 0xe8c65a },
  { tier: 3, name: 'THREAT 3', description: 'Enemies +50% HP & damage.',        reward: '+55% gold',       curseAdd: 0.5,  goldMult: 1.55, color: 0xf0a04a },
  { tier: 4, name: 'THREAT 4', description: 'Enemies +75% HP & damage.',        reward: '+85% gold',       curseAdd: 0.75, goldMult: 1.85, color: 0xf07444 },
  { tier: 5, name: 'THREAT 5', description: 'Enemies +105% HP & damage.',       reward: '+120% gold',      curseAdd: 1.05, goldMult: 2.2,  color: 0xff4d4d },
];

export const MAX_THREAT_TIER = THREAT_TIERS.length - 1;

export function clampThreatTier(value: unknown): number {
  const floored = typeof value === 'number' ? Math.floor(value) : NaN;
  if (!Number.isFinite(floored) || floored < 0) return 0;
  return Math.min(floored, MAX_THREAT_TIER);
}

export function getThreatTier(tier: number): ThreatTier {
  return THREAT_TIERS[clampThreatTier(tier)];
}
