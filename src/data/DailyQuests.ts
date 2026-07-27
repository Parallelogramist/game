import { mulberry32, hashStringToSeed, shuffleWithRng } from '../utils/dailySeed';

/** The finished-run facts a quest can measure. Every field is one the two
 *  GameScene run-end sites already have in hand — quests add no in-run tracking. */
export interface DailyQuestRunData {
  wasVictory: boolean;
  killCount: number;
  levelReached: number;
  survivalTimeSeconds: number;
  damageDealt: number;
  damageTaken: number;
  goldEarned: number;
  highestCombo: number;
}

/**
 * How a run folds into the day's tally:
 *   'best' — a single-run feat; the day keeps the highest run value.
 *   'sum'  — a cumulative total; every run adds to it.
 */
export type QuestAggregate = 'best' | 'sum';

export interface DailyQuestDefinition {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly icon: string;
  readonly target: number;
  readonly gold: number;
  readonly aggregate: QuestAggregate;
  readonly measure: (run: DailyQuestRunData) => number;
  /** 'time' renders progress as m:ss instead of a plain count. */
  readonly format?: 'time';
  /** True when the quest can only be judged on a FINISHED run (it counts run
   *  completions), so the in-run live watcher must never fire it early. */
  readonly settleOnly?: boolean;
}

export const DAILY_QUEST_COUNT = 3;

export const DAILY_QUESTS: readonly DailyQuestDefinition[] = [
  {
    id: 'kills_run_400',
    name: 'Swarm Breaker',
    description: 'Destroy 400 enemies in a single run',
    icon: 'skull',
    target: 400,
    gold: 250,
    aggregate: 'best',
    measure: (run) => run.killCount,
  },
  {
    id: 'kills_day_1200',
    name: 'Extermination Quota',
    description: 'Destroy 1,200 enemies today',
    icon: 'skull-bones',
    target: 1200,
    gold: 300,
    aggregate: 'sum',
    measure: (run) => run.killCount,
  },
  {
    id: 'survive_run_600',
    name: 'Ten Minutes',
    description: 'Survive 10 minutes in a single run',
    icon: 'timer',
    target: 600,
    gold: 250,
    aggregate: 'best',
    measure: (run) => run.survivalTimeSeconds,
    format: 'time',
  },
  {
    id: 'survive_run_900',
    name: 'Long Haul',
    description: 'Survive 15 minutes in a single run',
    icon: 'timer',
    target: 900,
    gold: 400,
    aggregate: 'best',
    measure: (run) => run.survivalTimeSeconds,
    format: 'time',
  },
  {
    id: 'level_run_25',
    name: 'Ascendant',
    description: 'Reach level 25 in a single run',
    icon: 'star',
    target: 25,
    gold: 250,
    aggregate: 'best',
    measure: (run) => run.levelReached,
  },
  {
    id: 'victory_day_1',
    name: 'Champion',
    description: 'Win a run today',
    icon: 'trophy',
    target: 1,
    gold: 500,
    aggregate: 'sum',
    measure: (run) => (run.wasVictory ? 1 : 0),
  },
  {
    id: 'runs_day_3',
    name: 'Persistence',
    description: 'Finish 3 runs today',
    icon: 'refresh',
    target: 3,
    gold: 200,
    aggregate: 'sum',
    measure: () => 1,
    settleOnly: true,
  },
  {
    id: 'damage_day_500k',
    name: 'Overwhelming Force',
    description: 'Deal 500,000 damage today',
    icon: 'explosion',
    target: 500000,
    gold: 300,
    aggregate: 'sum',
    measure: (run) => run.damageDealt,
  },
  {
    id: 'damage_run_150k',
    name: 'Devastator',
    description: 'Deal 150,000 damage in a single run',
    icon: 'fire',
    target: 150000,
    gold: 300,
    aggregate: 'best',
    measure: (run) => run.damageDealt,
  },
  {
    id: 'combo_run_50',
    name: 'Chain Reaction',
    description: 'Reach a 50x combo in a single run',
    icon: 'lightning',
    target: 50,
    gold: 250,
    aggregate: 'best',
    measure: (run) => run.highestCombo,
  },
  {
    id: 'gold_day_1500',
    name: 'Prospector',
    description: 'Earn 1,500 gold today',
    icon: 'coins',
    target: 1500,
    gold: 250,
    aggregate: 'sum',
    measure: (run) => run.goldEarned,
  },
  {
    // The 3-minute floor stops a 5-second suicide run from clearing this for free.
    id: 'untouched_run',
    name: 'Untouchable',
    description: 'Finish a 3-minute run taking under 200 damage',
    icon: 'shield',
    target: 1,
    gold: 400,
    aggregate: 'best',
    measure: (run) =>
      run.survivalTimeSeconds >= 180 && run.damageTaken < 200 ? 1 : 0,
  },
];

/** Today's board: DAILY_QUEST_COUNT distinct quests, stable for a given date. */
export function getQuestsForDate(dateString: string): DailyQuestDefinition[] {
  const rng = mulberry32(hashStringToSeed(`quests:${dateString}`));
  return shuffleWithRng([...DAILY_QUESTS], rng).slice(0, DAILY_QUEST_COUNT);
}

/** Progress/target rendering: seconds as m:ss, everything else grouped. */
export function formatQuestValue(quest: DailyQuestDefinition, value: number): string {
  const safe = Math.max(0, Math.floor(value));
  if (quest.format === 'time') {
    const minutes = Math.floor(safe / 60);
    const seconds = safe % 60;
    return `${minutes}:${String(seconds).padStart(2, '0')}`;
  }
  return safe.toLocaleString();
}
