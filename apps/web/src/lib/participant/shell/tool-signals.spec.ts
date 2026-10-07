// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { bindToolSignals, withChat } from './tool-signals';

describe('withChat', () => {
  it('opens the chat once and leaves an open one alone', () => {
    expect(withChat(['feature'])).toEqual(['feature', 'chat']);
    const open = ['tools', 'chat'] as const;
    expect(withChat(open)).toBe(open);
  });
});

describe('bindToolSignals', () => {
  it('forwards badges and open requests, and stops both', () => {
    const subs: (() => void)[] = [];
    const reqs: (() => void)[] = [];
    const stopBadges = vi.fn();
    const stopChat = vi.fn();
    const device = {
      toolBadges: {
        current: () => ({}),
        subscribe: (f: () => void) => (subs.push(f), stopBadges),
      },
      chat: { onOpenRequest: (f: () => void) => (reqs.push(f), stopChat) },
    };
    const badges = vi.fn();
    const openChat = vi.fn();
    const stop = bindToolSignals(device as never, { badges, openChat });
    subs[0]?.();
    reqs[0]?.();
    expect(badges).toHaveBeenCalledWith({});
    expect(openChat).toHaveBeenCalledOnce();
    stop();
    expect(stopBadges).toHaveBeenCalled();
    expect(stopChat).toHaveBeenCalled();
  });
});
