/**
 * SecureStorage - Drop-in replacement for localStorage in managers.
 *
 * Provides a synchronous interface backed by encrypted async storage:
 * - getItem: Reads from pre-populated cache (sync)
 * - setItem: Updates cache immediately, queues async encryption
 * - removeItem: Removes from cache and storage
 *
 * IMPORTANT: StorageEncryption must be initialized and all keys pre-loaded
 * via initializeStorage() before using SecureStorage.
 */

import { StorageEncryption } from './StorageEncryption';

/**
 * Secure storage interface matching localStorage API subset.
 * Use this as a drop-in replacement for localStorage in all managers.
 */
export const SecureStorage = {
  /**
   * Get an item from secure storage (synchronous).
   * Returns null if the key doesn't exist.
   *
   * @param key - The storage key
   * @returns The decrypted value or null
   */
  getItem(key: string): string | null {
    return StorageEncryption.getInstance().getCached(key);
  },

  /**
   * Set an item in secure storage.
   * Updates the cache immediately (synchronous) and queues
   * async encryption + persistence to localStorage.
   *
   * @param key - The storage key
   * @param value - The value to store (will be encrypted)
   */
  setItem(key: string, value: string): void {
    StorageEncryption.getInstance().setCache(key, value);
  },

  /**
   * Remove an item from secure storage.
   * Clears from cache immediately and removes from localStorage.
   *
   * @param key - The storage key to remove
   */
  removeItem(key: string): void {
    StorageEncryption.getInstance().removeFromCache(key);
  },
};
