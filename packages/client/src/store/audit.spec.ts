// WP-306: the device store keeps the audit fields a sync page carries and returns them from `Facts`, also after reopen.
import { describe, expect, it } from 'vitest';
import { openDeviceStore } from './open';
import { cursorAt, fakeEnv, feature, fid, memoryMarker, rows } from './test-env';

const audited = (n: number, seq: number) => ({
  ...feature(n, seq),
  createdBy: 'anna',
  createdAt: '2026-05-01T08:00:00.000Z',
  changedAt: '2026-05-02T09:30:00.000Z',
});

describe('device store audit fields', () => {
  it('returns createdBy, createdAt and changedAt, and keeps them across a reopen', async () => {
    const env = fakeEnv();
    const marker = memoryMarker();
    const a = await openDeviceStore('p1-audit', { env, marker });
    await a.applyPage(rows({ features: [audited(1, 5)] }), cursorAt(5));
    expect(a.facts.feature(fid(1))).toMatchObject({
      createdBy: 'anna',
      createdAt: '2026-05-01T08:00:00.000Z',
      changedAt: '2026-05-02T09:30:00.000Z',
    });
    a.close();
    const b = await openDeviceStore('p1-audit', { env, marker });
    expect(b.facts.feature(fid(1))?.createdBy).toBe('anna');
    expect(b.facts.feature(fid(1))?.changedAt).toBe('2026-05-02T09:30:00.000Z');
  });

  it('a feature without audit fields stays without (nothing invented)', async () => {
    const a = await openDeviceStore('p1-audit-none', { env: fakeEnv(), marker: memoryMarker() });
    await a.applyPage(rows({ features: [feature(2, 3)] }), cursorAt(3));
    expect(a.facts.feature(fid(2))).not.toHaveProperty('createdBy');
  });
});
