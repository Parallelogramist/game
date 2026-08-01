import type { SuppressedToast } from '../achievements/AchievementTypes';

/**
 * What a run's END earned the player: hidden unlocks, achievements and daily quests
 * that settle after the run-end overlay is already on screen. Each of those raises a
 * toast at OverlayDepths.HUD (1000), under the end overlays at PAUSE_MENU (2100), so
 * the end screen is the only surface that can report them.
 */
export type RunEarningTag =
  | 'SHIP'
  | 'WEAPON'
  | 'STAGE'
  | 'COSMETIC'
  | 'ACHIEVEMENT'
  | 'QUEST'
  | 'FOUND';

export interface RunEarning {
  tag: RunEarningTag;
  /** The thing earned: unlock display name, achievement name, quest name. */
  name: string;
  /** One short clause of context: how it was earned, or what it paid. */
  detail: string;
}

const UNLOCK_TARGET_TAGS: Record<'weapon' | 'ship' | 'cosmetic' | 'stage', RunEarningTag> = {
  ship: 'SHIP',
  weapon: 'WEAPON',
  stage: 'STAGE',
  cosmetic: 'COSMETIC',
};

export interface RunEarningSources {
  unlocks: { displayName: string; hintText: string; target: 'weapon' | 'ship' | 'cosmetic' | 'stage' }[];
  achievements: { name: string; detail: string }[];
  quests: { name: string; gold: number }[];
}

/**
 * The single ordering both run-end paths use: unlocks first (permanent and the rarest),
 * then achievements, then quests. Built here rather than at the two call sites so the
 * death and victory screens cannot drift apart.
 */
export function buildRunEarnings(sources: RunEarningSources): RunEarning[] {
  return [
    ...sources.unlocks.map((unlock) => ({
      tag: UNLOCK_TARGET_TAGS[unlock.target],
      name: unlock.displayName,
      detail: unlock.hintText,
    })),
    ...sources.achievements.map((achievement) => ({
      tag: 'ACHIEVEMENT' as const,
      name: achievement.name,
      detail: achievement.detail,
    })),
    ...sources.quests.map((quest) => ({
      tag: 'QUEST' as const,
      name: quest.name,
      detail: `+${quest.gold} gold`,
    })),
  ];
}

/** Names shown inline on the victory overlay before the count takes over. */
const VICTORY_LINE_NAMES = 2;

/**
 * One-line readout for the victory overlay, which has no room for a panel. Null when
 * the run earned nothing.
 */
export function formatRunEarningsLine(
  earnings: RunEarning[],
  label: string = 'EARNED',
): string | null {
  if (earnings.length === 0) return null;
  const shown = earnings.slice(0, VICTORY_LINE_NAMES).map((earning) => earning.name);
  const overflow = earnings.length - shown.length;
  const parts = overflow > 0 ? [...shown, `+${overflow} more`] : shown;
  return `${label}   ${parts.join('   ·   ')}`;
}

/**
 * What `recordEarlyRunEnd` hands back to the END RUN dialog. Notices arrive already built
 * because only GameScene can reach the run's ToastManager.
 */
export interface EarlyRunEndRecord extends Pick<RunEarningSources, 'unlocks' | 'achievements'> {
  notices: RunEarning[];
}

/**
 * What the toast diet recorded instead of drawing. A run repeats the same title (sectors
 * charted, relics, quest steps), so identical titles collapse into one counted row rather
 * than filling the panel with near-duplicates.
 */
export function buildRunNotices(notices: SuppressedToast[]): RunEarning[] {
  const byTitle = new Map<string, { detail: string; count: number }>();
  for (const notice of notices) {
    const existing = byTitle.get(notice.title);
    if (existing) {
      existing.count++;
      continue;
    }
    byTitle.set(notice.title, {
      detail: notice.description.replace(/\s*\n+\s*/g, ' · ').trim(),
      count: 1,
    });
  }
  return [...byTitle.entries()].map(([title, { detail, count }]) => ({
    tag: 'FOUND' as const,
    name: count > 1 ? `${title} ×${count}` : title,
    detail,
  }));
}
