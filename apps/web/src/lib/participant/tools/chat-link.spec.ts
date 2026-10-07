import { describe, expect, it, vi } from 'vitest';
import { createChatLink } from './chat-link';

describe('ChatLink ("Im Chat erwähnen", v3 +page.svelte:2254-2258)', () => {
  it('seeds "#<id> " and asks the shell to open the chat; the seed is taken once', () => {
    const link = createChatLink();
    const open = vi.fn();
    link.onOpenRequest(open);
    link.mention('f1');
    expect(open).toHaveBeenCalledTimes(1);
    expect(link.seed.take()).toBe('#f1 ');
    expect(link.seed.take()).toBeUndefined();
  });

  it('two mentions before the panel took the seed make one seed', () => {
    const link = createChatLink();
    link.mention('f1');
    link.mention('f2');
    expect(link.seed.take()).toBe('#f1 #f2 ');
  });

  it('tells an open panel through the seed subscription', () => {
    const link = createChatLink();
    const ring = vi.fn();
    const stop = link.seed.subscribe(ring);
    link.mention('f1');
    expect(ring).toHaveBeenCalledTimes(1);
    stop();
    link.mention('f2');
    expect(ring).toHaveBeenCalledTimes(1);
  });

  it('an open request waits for the slot that mounts later, and is taken once', () => {
    const link = createChatLink();
    link.mention('f1');
    expect(link.takeOpenRequest()).toBe(true);
    expect(link.takeOpenRequest()).toBe(false);
  });

  it('a request that a subscriber saw is not left waiting', () => {
    const link = createChatLink();
    link.onOpenRequest(() => link.takeOpenRequest());
    link.mention('f1');
    expect(link.takeOpenRequest()).toBe(false);
  });
});
