/**
 * StorageEncryption - AES-GCM encryption wrapper for localStorage.
 * Provides async encryption/decryption with transparent migration from plaintext.
 *
 * Security Model:
 * - AES-256-GCM provides authenticated encryption (tampering detection)
 * - Key derived from embedded material + per-installation salt via PBKDF2
 * - Prevents casual save editing; not secure against determined reverse engineering
 */

// Prefix to identify encrypted values vs legacy plaintext
const ENCRYPTED_PREFIX = 'enc_v1:';

// localStorage key for the per-installation salt (stored unencrypted)
const SALT_STORAGE_KEY = 'survivor-encryption-salt';

// Embedded key material - combined with salt for actual key derivation
const BASE_KEY_MATERIAL = 'rogue-survivor-storage-key-v1-2024-anti-cheat';

// Write debounce delay in milliseconds
const WRITE_DEBOUNCE_MS = 100;

/**
 * Converts a Uint8Array to a base64 string
 */
function arrayToBase64(array: Uint8Array): string {
  return btoa(String.fromCharCode(...array));
}

/**
 * Converts a base64 string to a Uint8Array
 */
function base64ToArray(base64: string): Uint8Array {
  const binaryString = atob(base64);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

/**
 * Core encryption singleton that manages AES-GCM operations and caching.
 */
export class StorageEncryption {
  private cryptoKey: CryptoKey | null = null;
  private initPromise: Promise<void> | null = null;
  private cache: Map<string, string | null> = new Map();
  private writeQueue: Map<string, { value: string | null; timeout: number }> = new Map();

  // Singleton instance
  private static instance: StorageEncryption | null = null;

  /**
   * Get the singleton instance of StorageEncryption.
   */
  static getInstance(): StorageEncryption {
    if (!StorageEncryption.instance) {
      StorageEncryption.instance = new StorageEncryption();
    }
    return StorageEncryption.instance;
  }

  /**
   * Initialize the encryption key. Must be called before any operations.
   * Safe to call multiple times - will return immediately if already initialized.
   */
  async initialize(): Promise<void> {
    if (this.cryptoKey) return;
    if (this.initPromise) return this.initPromise;

    this.initPromise = this.deriveKey();
    await this.initPromise;
  }

  /**
   * Derive the AES-256-GCM key from embedded material and per-installation salt.
   */
  private async deriveKey(): Promise<void> {
    // Get or generate per-installation salt
    let saltBase64 = localStorage.getItem(SALT_STORAGE_KEY);
    let salt: Uint8Array;

    if (!saltBase64) {
      // First run - generate random 16-byte salt
      salt = crypto.getRandomValues(new Uint8Array(16));
      saltBase64 = arrayToBase64(salt);
      localStorage.setItem(SALT_STORAGE_KEY, saltBase64);
    } else {
      salt = base64ToArray(saltBase64);
    }

    // Import base key material for PBKDF2
    const baseKey = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(BASE_KEY_MATERIAL),
      { name: 'PBKDF2' },
      false,
      ['deriveBits', 'deriveKey']
    );

    // Derive AES-256-GCM key using PBKDF2
    this.cryptoKey = await crypto.subtle.deriveKey(
      {
        name: 'PBKDF2',
        salt: salt.buffer as ArrayBuffer,
        iterations: 100000,
        hash: 'SHA-256',
      },
      baseKey,
      { name: 'AES-GCM', length: 256 },
      false, // Not extractable
      ['encrypt', 'decrypt']
    );
  }

  /**
   * Encrypt a plaintext string and return the encrypted format string.
   * Format: enc_v1:<base64-iv>:<base64-ciphertext>
   */
  async encrypt(plaintext: string): Promise<string> {
    if (!this.cryptoKey) {
      throw new Error('StorageEncryption not initialized. Call initialize() first.');
    }

    // Generate random 12-byte IV for AES-GCM
    const iv = crypto.getRandomValues(new Uint8Array(12));

    // Encrypt the plaintext
    const encodedPlaintext = new TextEncoder().encode(plaintext);
    const ciphertext = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv: iv },
      this.cryptoKey,
      encodedPlaintext
    );

    // Format: prefix:iv:ciphertext (both base64 encoded)
    const ivBase64 = arrayToBase64(iv);
    const ciphertextBase64 = arrayToBase64(new Uint8Array(ciphertext));

    return `${ENCRYPTED_PREFIX}${ivBase64}:${ciphertextBase64}`;
  }

  /**
   * Decrypt an encrypted format string and return the plaintext.
   * Throws if decryption fails (tampering detected or corrupt data).
   */
  async decrypt(encrypted: string): Promise<string> {
    if (!this.cryptoKey) {
      throw new Error('StorageEncryption not initialized. Call initialize() first.');
    }

    if (!encrypted.startsWith(ENCRYPTED_PREFIX)) {
      throw new Error('Invalid encrypted format: missing prefix');
    }

    // Parse the encrypted format
    const payload = encrypted.slice(ENCRYPTED_PREFIX.length);
    const colonIndex = payload.indexOf(':');
    if (colonIndex === -1) {
      throw new Error('Invalid encrypted format: missing separator');
    }

    const ivBase64 = payload.slice(0, colonIndex);
    const ciphertextBase64 = payload.slice(colonIndex + 1);

    const iv = base64ToArray(ivBase64);
    const ciphertext = base64ToArray(ciphertextBase64);

    // Decrypt (will throw if auth tag doesn't match - tampering detected)
    const plaintext = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: iv.buffer as ArrayBuffer },
      this.cryptoKey,
      ciphertext.buffer as ArrayBuffer
    );

    return new TextDecoder().decode(plaintext);
  }

  /**
   * Check if a stored value is encrypted (vs legacy plaintext).
   */
  isEncrypted(value: string): boolean {
    return value.startsWith(ENCRYPTED_PREFIX);
  }

  /**
   * Load a key from localStorage, decrypt if needed, cache the result.
   * Handles auto-migration from plaintext to encrypted format.
   */
  async loadAndCache(key: string): Promise<void> {
    const rawValue = localStorage.getItem(key);

    if (rawValue === null) {
      // No data exists for this key
      this.cache.set(key, null);
      return;
    }

    if (this.isEncrypted(rawValue)) {
      // Already encrypted - decrypt and cache
      try {
        const plaintext = await this.decrypt(rawValue);
        this.cache.set(key, plaintext);
      } catch (error) {
        // Decryption failed - data may be corrupt or tampered
        console.warn(`Failed to decrypt ${key}, using null:`, error);
        this.cache.set(key, null);
      }
    } else {
      // Plaintext (legacy) - cache value and migrate to encrypted
      this.cache.set(key, rawValue);

      // Re-encrypt and save
      try {
        const encrypted = await this.encrypt(rawValue);
        localStorage.setItem(key, encrypted);
        console.log(`Migrated ${key} to encrypted storage`);
      } catch (error) {
        console.warn(`Failed to migrate ${key} to encrypted storage:`, error);
      }
    }
  }

  /**
   * Get a value from the cache (synchronous).
   * Returns null if not cached or key doesn't exist.
   */
  getCached(key: string): string | null {
    const value = this.cache.get(key);
    return value === undefined ? null : value;
  }

  /**
   * Set a value in the cache (synchronous) and queue async persistence.
   */
  setCache(key: string, value: string): void {
    this.cache.set(key, value);
    this.queuePersist(key, value);
  }

  /**
   * Remove a key from the cache and storage.
   */
  removeFromCache(key: string): void {
    this.cache.set(key, null);
    this.queuePersist(key, null);
  }

  /**
   * Queue an async persist operation with debouncing.
   * Prevents rapid writes from causing performance issues.
   */
  private queuePersist(key: string, value: string | null): void {
    // Cancel any pending write for this key
    const existing = this.writeQueue.get(key);
    if (existing) {
      clearTimeout(existing.timeout);
    }

    // Queue new write with debounce
    const timeout = window.setTimeout(() => {
      this.writeQueue.delete(key);
      this.persistNow(key, value);
    }, WRITE_DEBOUNCE_MS);

    this.writeQueue.set(key, { value, timeout });
  }

  /**
   * Immediately persist a value to localStorage (async).
   */
  private async persistNow(key: string, value: string | null): Promise<void> {
    if (value === null) {
      localStorage.removeItem(key);
      return;
    }

    try {
      const encrypted = await this.encrypt(value);
      localStorage.setItem(key, encrypted);
    } catch (error) {
      console.error(`Failed to persist ${key}:`, error);
    }
  }

  /**
   * Flush all pending writes immediately (for cleanup/shutdown).
   */
  async flushPendingWrites(): Promise<void> {
    const pending: Promise<void>[] = [];

    for (const [key, { value, timeout }] of this.writeQueue.entries()) {
      clearTimeout(timeout);
      pending.push(this.persistNow(key, value));
    }

    this.writeQueue.clear();
    await Promise.all(pending);
  }
}
