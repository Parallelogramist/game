/**
 * Storage module - Encrypted storage for anti-cheat protection.
 *
 * Usage:
 * 1. Call initializeStorage() in main.ts before creating Phaser game
 * 2. Replace all localStorage calls with SecureStorage in managers
 *
 * Example migration:
 *   Before: localStorage.getItem('key')
 *   After:  SecureStorage.getItem('key')
 */

export { StorageEncryption } from './StorageEncryption';
export { SecureStorage } from './SecureStorage';
export { initializeStorage, flushStorage, ALL_STORAGE_KEYS } from './StorageBootstrap';
export * from './ProfileTransfer';
export {
  encodeProfileBlob, decodeProfileBlob, collectProfileKeys, exportProfileBlob, applyProfilePayload,
} from './ProfileArchive';
export {
  BACKUP_NUDGE_MIN_RUNS, BACKUP_STALE_MS, BACKUP_NUDGE_COOLDOWN_MS,
  shouldShowBackupNudge, describeLastBackup,
  loadLastExportAt, saveLastExportAt, loadLastNudgeAt, saveLastNudgeAt,
} from './BackupReminder';
export type { BackupNudgeInput } from './BackupReminder';
