import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FromWorker, ToWorker } from './protocol';

const warmUp = vi.fn();
vi.mock('./warm', () => ({ warmUp: () => warmUp() }));

describe('cluster worker entry (WP-584)', () => {
  beforeEach(() => {
    vi.resetModules();
    warmUp.mockClear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('warms up exactly once at start, and still handles a message posted afterwards', async () => {
    const replies: FromWorker[] = [];
    const scope: { postMessage(m: FromWorker): void; onmessage: ((e: { data: ToWorker }) => void) | null } = {
      postMessage: (m) => replies.push(m),
      onmessage: null,
    };
    vi.stubGlobal('self', scope);
    await import('./worker');
    expect(warmUp).toHaveBeenCalledTimes(1);
    expect(scope.onmessage).not.toBeNull();
    scope.onmessage?.({
      data: { type: 'apply', add: [{ id: 'a', lng: 10, lat: 50 }], update: [], remove: [] },
    });
    scope.onmessage?.({ data: { type: 'query', reqId: 7, bbox: [0, 0, 20, 60], zoom: 10 } });
    expect(warmUp).toHaveBeenCalledTimes(1);
    expect(replies).toHaveLength(1);
    expect(replies[0]).toMatchObject({ type: 'clusters', reqId: 7 });
  });
});
