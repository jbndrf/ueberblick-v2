// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { authSync } from './auth-sync';

describe('auth-sync: sign-in and sign-out reach the other tabs of the browser', () => {
  it('a message on the channel reaches the other instance, not the sender', async () => {
    const a = authSync();
    const b = authSync();
    const atA = vi.fn();
    const atB = vi.fn();
    a.listen(atA);
    b.listen(atB);
    a.post('signed-out');
    await vi.waitFor(() => expect(atB).toHaveBeenCalledWith('signed-out'));
    expect(atA).not.toHaveBeenCalled();
    a.close();
    b.close();
  });

  it('without BroadcastChannel the storage event carries it', () => {
    const original = globalThis.BroadcastChannel;
    vi.stubGlobal('BroadcastChannel', undefined);
    try {
      const sync = authSync();
      const seen = vi.fn();
      sync.listen(seen);
      window.dispatchEvent(
        new StorageEvent('storage', { key: 'ueberblick-admin-auth', newValue: 'signed-in:1' }),
      );
      window.dispatchEvent(new StorageEvent('storage', { key: 'other', newValue: 'signed-out:2' }));
      expect(seen).toHaveBeenCalledTimes(1);
      expect(seen).toHaveBeenCalledWith('signed-in');
      sync.close();
    } finally {
      vi.stubGlobal('BroadcastChannel', original);
    }
  });
});
