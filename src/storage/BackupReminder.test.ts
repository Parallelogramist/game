import { describe, expect, it } from 'vitest';
import {
  BACKUP_NUDGE_COOLDOWN_MS,
  BACKUP_NUDGE_MIN_RUNS,
  BACKUP_STALE_MS,
  describeLastBackup,
  shouldShowBackupNudge,
} from './BackupReminder';

const NOW = 1_800_000_000_000;
const DAY_MS = 24 * 60 * 60 * 1000;

function nudgeInput(overrides: Partial<Parameters<typeof shouldShowBackupNudge>[0]> = {}) {
  return {
    runsCompleted: BACKUP_NUDGE_MIN_RUNS,
    lastExportAt: null,
    lastNudgeAt: null,
    now: NOW,
    ...overrides,
  };
}

describe('shouldShowBackupNudge', () => {
  it('stays quiet below the run threshold', () => {
    expect(shouldShowBackupNudge(nudgeInput({ runsCompleted: BACKUP_NUDGE_MIN_RUNS - 1 }))).toBe(false);
  });

  it('fires for an invested profile that has never backed up', () => {
    expect(shouldShowBackupNudge(nudgeInput())).toBe(true);
  });

  it('stays quiet for a non-finite run count', () => {
    expect(shouldShowBackupNudge(nudgeInput({ runsCompleted: Number.NaN }))).toBe(false);
  });

  it('stays quiet when a recent backup exists', () => {
    expect(shouldShowBackupNudge(nudgeInput({ lastExportAt: NOW - BACKUP_STALE_MS + DAY_MS }))).toBe(false);
  });

  it('fires again once the backup has gone stale', () => {
    expect(shouldShowBackupNudge(nudgeInput({ lastExportAt: NOW - BACKUP_STALE_MS - DAY_MS }))).toBe(true);
  });

  it('treats a future backup timestamp as recent rather than nagging', () => {
    expect(shouldShowBackupNudge(nudgeInput({ lastExportAt: NOW + BACKUP_STALE_MS }))).toBe(false);
  });

  it('stays quiet inside the nudge cooldown', () => {
    expect(shouldShowBackupNudge(nudgeInput({ lastNudgeAt: NOW - BACKUP_NUDGE_COOLDOWN_MS + DAY_MS }))).toBe(false);
  });

  it('fires again once the cooldown has passed', () => {
    expect(shouldShowBackupNudge(nudgeInput({ lastNudgeAt: NOW - BACKUP_NUDGE_COOLDOWN_MS - DAY_MS }))).toBe(true);
  });
});

describe('describeLastBackup', () => {
  it('names the never-backed-up state', () => {
    expect(describeLastBackup(null, NOW)).toContain('Never backed up');
  });

  it('reads "today" for a backup made moments ago', () => {
    expect(describeLastBackup(NOW - 1000, NOW)).toBe('Backed up today.');
  });

  it('counts whole days for an older backup', () => {
    expect(describeLastBackup(NOW - DAY_MS, NOW)).toBe('Backed up yesterday.');
    expect(describeLastBackup(NOW - 9 * DAY_MS, NOW)).toBe('Backed up 9 days ago.');
  });
});
