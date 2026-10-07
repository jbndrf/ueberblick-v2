import { describe, expect, it } from 'vitest';
import { sseToolDoorbell, type EventSourceLike } from './sse';

function source() {
  const listeners = new Map<string, (e: { data: unknown }) => void>();
  const s: EventSourceLike & { closed: boolean; emit(type: string, data: unknown): void } = {
    closed: false,
    addEventListener: (t, l) => void listeners.set(t, l),
    close: () => {
      s.closed = true;
    },
    emit: (t, data) => listeners.get(t)?.({ data }),
  };
  return s;
}

describe('tool doorbell over SSE', () => {
  it('rings with the tool key of an `event: tool`, ignores other events and junk', () => {
    const s = source();
    const rung: string[] = [];
    const off = sseToolDoorbell(() => s).subscribe((k) => rung.push(k));
    s.emit('tool', '{"tool":"chat"}');
    s.emit('tool', 'not json');
    s.emit('tool', '{"tool":""}');
    s.emit('seq', '{"tool":"chat"}');
    expect(rung).toEqual(['chat']);
    off();
    expect(s.closed).toBe(true);
  });
});
