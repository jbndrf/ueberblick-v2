import { describe, expect, it } from 'vitest';
import { createDoorbell, type DoorbellMessage } from './doorbell';

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

describe('doorbell', () => {
  it('rings once per committed seq range, carrying only the range and the head', () => {
    let head = 10;
    const bell = createDoorbell({ head: () => head, pollMs: 0 });
    const seen: DoorbellMessage[] = [];
    const off = bell.subscribe((m) => seen.push(m));
    bell.ring();
    expect(seen).toEqual([]); // nothing new
    head = 14;
    bell.ring();
    bell.ring(); // a second ring without a commit says nothing
    head = 15;
    bell.ring();
    expect(seen).toEqual([
      { from: 11, to: 14, head: 14 },
      { from: 15, to: 15, head: 15 },
    ]);
    off();
    expect(bell.listeners).toBe(0);
  });

  it('notices a writer that does not ring (another process) while someone listens', async () => {
    let head = 0;
    const bell = createDoorbell({ head: () => head, pollMs: 10 });
    const seen: DoorbellMessage[] = [];
    const off = bell.subscribe((m) => seen.push(m));
    head = 3;
    await sleep(60);
    expect(seen).toEqual([{ from: 1, to: 3, head: 3 }]);
    off();
    head = 9;
    await sleep(40);
    expect(seen).toHaveLength(1); // nobody listens: no polling
  });

  it('a new listener starts from the head it finds, not from the past', () => {
    let head = 5;
    const bell = createDoorbell({ head: () => head, pollMs: 0 });
    bell.subscribe(() => undefined)();
    head = 8;
    const seen: DoorbellMessage[] = [];
    bell.subscribe((m) => seen.push(m));
    head = 9;
    bell.ring();
    expect(seen).toEqual([{ from: 9, to: 9, head: 9 }]);
  });
});
