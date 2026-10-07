import { describe, expect, it } from 'vitest';
import { createToolBell, toolEvent } from './tool-bell';

describe('tool bell', () => {
  it('tells the listeners of one project the tool key, and stops after unsubscribe', () => {
    const bell = createToolBell();
    const heard: string[] = [];
    const off = bell.subscribe('a', (t) => heard.push(t));
    bell.ring('b', 'chat');
    bell.ring('a', 'chat');
    off();
    bell.ring('a', 'chat');
    expect(heard).toEqual(['chat']);
  });

  it('writes the wire event with the tool key and nothing else (H5)', () => {
    expect(toolEvent('chat')).toBe('event: tool\ndata: {"tool":"chat"}\n\n');
  });
});
