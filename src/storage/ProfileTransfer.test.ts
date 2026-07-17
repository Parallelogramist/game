import { describe, expect, it } from 'vitest';
import { ALL_STORAGE_KEYS } from './StorageBootstrap';
import {
  PROFILE_BLOB_VERSION,
  TRANSFERABLE_STORAGE_KEYS,
  checksumKeys,
  packProfile,
  planProfileApply,
  validateProfilePayload,
} from './ProfileTransfer';
import { decodeProfileBlob, encodeProfileBlob } from './ProfileArchive';

describe('checksumKeys', () => {
  it('is order-independent', () => {
    const a = checksumKeys({ foo: '1', bar: '2' });
    const b = checksumKeys({ bar: '2', foo: '1' });
    expect(a).toBe(b);
  });

  it('changes when a value changes', () => {
    const a = checksumKeys({ foo: '1', bar: '2' });
    const b = checksumKeys({ foo: '1', bar: '3' });
    expect(a).not.toBe(b);
  });
});

describe('packProfile / validateProfilePayload', () => {
  it('round-trips as ok: true', () => {
    const payload = packProfile({ 'survivor-meta-gold': '100' }, 12345);
    const result = validateProfilePayload(payload);
    expect(result.ok).toBe(true);
  });

  it('rejects a non-object', () => {
    const result = validateProfilePayload('not an object');
    expect(result).toEqual({ ok: false, error: 'This is not a profile code.' });
  });

  it('rejects the wrong app', () => {
    const payload = packProfile({}, 1);
    const result = validateProfilePayload({ ...payload, app: 'some-other-game' });
    expect(result).toEqual({ ok: false, error: 'This is not a Pew Pew Survivor profile code.' });
  });

  it('rejects a version newer than this build supports', () => {
    const payload = packProfile({}, 1);
    const result = validateProfilePayload({ ...payload, v: PROFILE_BLOB_VERSION + 1 });
    expect(result).toEqual({ ok: false, error: 'This profile code was made by a newer version of the game.' });
  });

  it('rejects a non-string key value', () => {
    const payload = packProfile({ foo: 'bar' }, 1);
    const result = validateProfilePayload({ ...payload, keys: { foo: 42 } });
    expect(result).toEqual({ ok: false, error: 'This profile code is corrupted.' });
  });

  it('rejects a tampered checksum', () => {
    const payload = packProfile({ foo: 'bar' }, 1);
    const result = validateProfilePayload({ ...payload, checksum: 'deadbeef' });
    expect(result).toEqual({ ok: false, error: 'This profile code is corrupted.' });
  });
});

describe('planProfileApply', () => {
  it('replaces rather than merges: present keys land in sets, absent transferable keys land in removes', () => {
    const payload = packProfile({ 'survivor-meta-gold': '500' }, 1);
    const plan = planProfileApply(payload);
    expect(plan.sets['survivor-meta-gold']).toBe('500');
    expect(plan.removes).toContain('survivor-meta-upgrades');
    expect(plan.sets['survivor-meta-upgrades']).toBeUndefined();
  });

  it('always removes the in-run save', () => {
    const payload = packProfile({}, 1);
    const plan = planProfileApply(payload);
    expect(plan.removes).toContain('survivor-game-state');
  });

  it('ignores unknown keys without writing them', () => {
    const payload = packProfile({ 'some-future-key': 'v' }, 1);
    const plan = planProfileApply(payload);
    expect(plan.ignoredKeys).toContain('some-future-key');
    expect(plan.sets['some-future-key']).toBeUndefined();
    expect(plan.removes).not.toContain('some-future-key');
  });
});

describe('TRANSFERABLE_STORAGE_KEYS', () => {
  it('excludes the in-run save and the device-local backup markers, and otherwise matches ALL_STORAGE_KEYS', () => {
    const deviceLocal = ['survivor-game-state', 'survivor-last-export-at', 'survivor-backup-nudge-at'];
    for (const key of deviceLocal) expect(TRANSFERABLE_STORAGE_KEYS).not.toContain(key);
    expect(new Set(TRANSFERABLE_STORAGE_KEYS)).toEqual(
      new Set(ALL_STORAGE_KEYS.filter((key) => !deviceLocal.includes(key))),
    );
  });
});

describe('portable codec round-trip', () => {
  it('decodes without the exporting device salt', async () => {
    const payload = packProfile({ 'survivor-meta-gold': '777' }, 999);
    const blob = await encodeProfileBlob(payload);
    const result = await decodeProfileBlob(blob);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.payload.keys).toEqual(payload.keys);
    }
  });

  it('rejects garbage text', async () => {
    const result = await decodeProfileBlob('not a profile code at all');
    expect(result.ok).toBe(false);
  });

  it('rejects a truncated envelope', async () => {
    const payload = packProfile({ 'survivor-meta-gold': '1' }, 1);
    const blob = await encodeProfileBlob(payload);
    const truncated = blob.slice(0, blob.length - 10);
    const result = await decodeProfileBlob(truncated);
    expect(result).toEqual({ ok: false, error: 'This profile code is incomplete or corrupted.' });
  });
});
