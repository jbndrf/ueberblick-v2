import { describe, expect, it } from 'vitest';
import type { QueueStatus, SyncStatus } from '@ueberblick/client';
import { freshness, syncNotice } from './status';

const queue = (over: Partial<QueueStatus> = {}): QueueStatus => ({
  pending: 0,
  awaitingPull: 0,
  oldestPendingAgeMs: undefined,
  sending: undefined,
  refused: [],
  review: [],
  hold: undefined,
  awaitingConfig: [],
  retryInMs: undefined,
  serverProtocol: undefined,
  unpredicted: [],
  ...over,
});
const sync = (over: Partial<SyncStatus> = {}): SyncStatus => ({
  phase: 'idle',
  lastSyncedAt: undefined,
  lastSyncedSeq: undefined,
  lastError: undefined,
  featuresLoaded: 0,
  ...over,
});

describe('syncNotice', () => {
  const at = (q: Partial<QueueStatus>, s: Partial<SyncStatus> = {}) =>
    syncNotice({ queue: queue(q), sync: sync(s), locale: 'en' });

  it('says nothing while all is well', () => {
    expect(at({})).toBeUndefined();
    expect(at({ hold: 'backoff' })).toBeUndefined(); // a retry is not news
    expect(at({ hold: 'awaiting_config' })).toBeUndefined();
  });

  it('an incompatible protocol is loud, names the server version and the runs kept on the device', () => {
    const n = at({ hold: 'incompatible_protocol', serverProtocol: 2, pending: 3 });
    expect(n?.kind).toBe('incompatible_protocol');
    expect(n?.text).toContain('protocol 2');
    expect(n?.text).toContain('3 unsent');
  });

  it('an expired session offers signing in again and keeps the runs', () => {
    const n = at({ hold: 'auth_expired', pending: 1 });
    expect(n).toMatchObject({ kind: 'auth_expired', signIn: true });
  });

  it('a stopped sync (protocol or store failure) shows the reason; a transport failure does not', () => {
    const failed = at({}, { lastError: { kind: 'store', code: 'quota_exceeded', message: 'Disk full' } });
    expect(failed).toMatchObject({ kind: 'sync_stopped' });
    expect(failed?.text).toContain('Disk full');
    expect(at({}, { lastError: { kind: 'transport', code: undefined, message: 'offline' } })).toBeUndefined();
  });
});

describe('freshness', () => {
  const now = Date.parse('2026-10-01T12:00:00Z');
  it('a device that never synced has no age and is not stale', () => {
    expect(freshness(null, now, 'de')).toEqual({ ago: undefined, staleDays: undefined });
  });
  it('says how long ago in the person language', () => {
    expect(freshness('2026-10-01T11:55:00Z', now, 'en').ago).toBe('5 minutes ago');
    expect(freshness('2026-10-01T11:55:00Z', now, 'de').ago).toBe('vor 5 Minuten');
    expect(freshness('2026-10-01T09:00:00Z', now, 'en').ago).toBe('3 hours ago');
    expect(freshness('2026-09-29T12:00:00Z', now, 'en').ago).toBe('2 days ago');
  });
  it('warns from seven days on, never for a future timestamp', () => {
    expect(freshness('2026-09-25T12:00:00Z', now, 'en').staleDays).toBeUndefined();
    expect(freshness('2026-09-24T12:00:00Z', now, 'en').staleDays).toBe(7);
    expect(freshness('2026-10-05T12:00:00Z', now, 'en').staleDays).toBeUndefined();
  });
});
