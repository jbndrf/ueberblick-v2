import { describe, expect, it } from 'vitest';
import { sharedEvents, type EventSourceCtor } from './browser-events';

class FakeSource {
  static all: FakeSource[] = [];
  closed = false;
  listeners = new Map<string, Set<(e: { data: unknown }) => void>>();
  constructor(readonly url: string) {
    FakeSource.all.push(this);
  }
  addEventListener(type: string, l: (e: { data: unknown }) => void): void {
    (this.listeners.get(type) ?? this.listeners.set(type, new Set()).get(type))?.add(l);
  }
  removeEventListener(type: string, l: (e: { data: unknown }) => void): void {
    this.listeners.get(type)?.delete(l);
  }
  close(): void {
    this.closed = true;
  }
  emit(type: string, data: unknown = ''): void {
    this.listeners.get(type)?.forEach((l) => l({ data }));
  }
}

describe('sharedEvents: one EventSource per project for the sync doorbell and the tool doorbell', () => {
  it('opens one connection for two listeners and closes it when the last lets go', () => {
    FakeSource.all = [];
    const events = sharedEvents(FakeSource as unknown as EventSourceCtor);
    const seq: string[] = [];
    const tool: string[] = [];
    const a = events.open('demo');
    a.addEventListener('seq', () => seq.push('ring'));
    const b = events.open('demo');
    b.addEventListener('tool', (e) => tool.push(String(e.data)));
    expect(FakeSource.all).toHaveLength(1);
    expect(FakeSource.all[0]?.url).toBe('/api/p/demo/sync/events');
    FakeSource.all[0]?.emit('seq');
    FakeSource.all[0]?.emit('tool', '{"tool":"chat"}');
    expect([seq, tool]).toEqual([['ring'], ['{"tool":"chat"}']]);
    a.close();
    expect(FakeSource.all[0]?.closed).toBe(false);
    FakeSource.all[0]?.emit('seq'); // a's listener is gone
    expect(seq).toHaveLength(1);
    b.close();
    expect(FakeSource.all[0]?.closed).toBe(true);
    // a later subscription opens a new connection
    events.open('demo').close();
    expect(FakeSource.all).toHaveLength(2);
  });

  it('keeps projects apart', () => {
    FakeSource.all = [];
    const events = sharedEvents(FakeSource as unknown as EventSourceCtor);
    events.open('a');
    events.open('b');
    expect(FakeSource.all.map((s) => s.url)).toEqual(['/api/p/a/sync/events', '/api/p/b/sync/events']);
  });
});
