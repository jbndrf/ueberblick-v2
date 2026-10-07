import { describe, expect, it } from 'vitest';
import type { Instant } from '@ueberblick/core/model';
import { createDeviceIds, uuidv7 } from './ids';

const fixed = (n: number) => new Uint8Array(n).fill(0xab);

describe('device ids', () => {
  it('a UUIDv7 carries the millisecond time, version 7 and the RFC variant', () => {
    const ms = Date.parse('2026-09-30T10:00:00.000Z');
    const id = uuidv7(ms, fixed);
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(parseInt(id.replace('-', '').slice(0, 12), 16)).toBe(ms);
  });

  it('ids sort by time and are distinct when the random source differs', () => {
    let t = '2026-09-30T10:00:00.000Z';
    let n = 0;
    const ids = createDeviceIds({ now: () => t as Instant }, (len) => new Uint8Array(len).fill(++n % 256));
    const a = ids.runId();
    t = '2026-09-30T10:00:00.001Z';
    const b = ids.runId();
    expect(a < b).toBe(true);
    expect(new Set([a, b, ids.featureId()]).size).toBe(3);
  });
});
