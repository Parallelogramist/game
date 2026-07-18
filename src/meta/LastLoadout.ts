import { SecureStorage } from '../storage';
import { isDirectorStrategy, type DirectorStrategy } from '../systems/DirectorSystem';

const STORAGE_KEY_LAST_LOADOUT = 'survivor-last-loadout';

/**
 * The player-chosen pre-run configuration, captured at the end of the pre-run
 * funnel so a run can be replayed in one tap. Randomly-rolled run modifiers are
 * deliberately NOT stored — they are re-rolled fresh on each replay.
 */
export interface LastLoadout {
  startingWeapon: string;
  shipId?: string;
  stageId?: string;
  pactIds: string[];
  directorStrategy?: DirectorStrategy;
  threatLevel: number;
  gauntletMode: boolean;
}

export function saveLastLoadout(loadout: LastLoadout): void {
  try {
    SecureStorage.setItem(STORAGE_KEY_LAST_LOADOUT, JSON.stringify(loadout));
  } catch {
    // Best-effort: a failed capture just means no one-tap replay is offered next time.
  }
}

export function loadLastLoadout(): LastLoadout | null {
  const raw = SecureStorage.getItem(STORAGE_KEY_LAST_LOADOUT);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<LastLoadout>;
    if (typeof parsed.startingWeapon !== 'string' || parsed.startingWeapon.length === 0) {
      return null;
    }
    const threat = typeof parsed.threatLevel === 'number' && Number.isFinite(parsed.threatLevel)
      ? Math.max(0, Math.floor(parsed.threatLevel))
      : 0;
    return {
      startingWeapon: parsed.startingWeapon,
      shipId: typeof parsed.shipId === 'string' ? parsed.shipId : undefined,
      stageId: typeof parsed.stageId === 'string' ? parsed.stageId : undefined,
      pactIds: Array.isArray(parsed.pactIds)
        ? parsed.pactIds.filter((id): id is string => typeof id === 'string')
        : [],
      directorStrategy: isDirectorStrategy(parsed.directorStrategy) ? parsed.directorStrategy : undefined,
      threatLevel: threat,
      gauntletMode: parsed.gauntletMode === true,
    };
  } catch {
    return null;
  }
}
